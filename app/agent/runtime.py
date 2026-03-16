"""Agent runtime -- interleaved multimodal pipeline with per-request reconstruction.

The agent streams text, generates images/video/audio via FC tools, and can produce
inline concept sketches via Gemini's native image output -- all within a single
conversation turn. SSE events interleave text tokens with asset generation
notifications for a fluid creative experience.

Three input categories:
1. System instruction -- identity template + skill catalog + pre-loaded skills.
2. Per-turn context -- fresh project state, prepended to current user message.
3. Conversation -- user messages + agent responses. No skills or context stored.
"""

import os
import time
import logging

from ..config import AGENT_DEBUG
from ..llm import get_llm
from . import skill_loader
from .tools import make_tools
from .context import ContextIndex, get_starting_context

logger = logging.getLogger(__name__)
PROMPTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'prompts')


def _tlog(msg, t0=None):
    """Conditional timing log."""
    if not AGENT_DEBUG:
        return time.time()
    now = time.time()
    if t0 is not None:
        logger.info("[AGENT TIMING] %s (%.3fs)", msg, now - t0)
    else:
        logger.info("[AGENT TIMING] %s", msg)
    return now


def handle_agent_chat(
    message: str,
    system_instruction: str = None,
    conversation: list = None,
    conversation_contents: list = None,
    project_state: dict = None,
    scenes: list = None,
    scope: dict = None,
    pre_inject_skills: list = None,
    stream_callback=None,
    clients: dict = None,
    project_name: str = None,
    tracer=None,
    is_sub_agent: bool = False,
    is_inline: bool = False,
) -> dict:
    """Unified agent runtime. Returns {text, thinking}.

    Rebuilds per request:
      system_instruction = identity + catalog + pre-loaded skills
      contents = [...history, context + user_message]

    tracer: optional TraceCollector for request tracing.
    """
    t_start = _tlog("=== Agent request started ===")

    if tracer:
        tracer.add("request_start", {
            "message": message,
            "conversation": conversation or [],
            "conversation_length": len(conversation or []),
            "has_project_state": bool(project_state),
            "scope": scope,
            "pre_inject_skills": pre_inject_skills or [],
        })

    # 1. System instruction: identity + skill catalog + pre-loaded skills
    t0 = time.time()
    if tracer:
        tracer.start_phase("system_instruction")
    if not system_instruction:
        if is_inline:
            prompt = _load_prompt('inline_agent.md')
            system_instruction = prompt.replace('{context_label}', _scope_label(scope))
        elif is_sub_agent:
            prompt = _load_prompt('sub_agent.md')
            system_instruction = prompt.replace('{context_label}', _scope_label(scope))
        else:
            system_instruction = _load_prompt('main_agent.md')
    catalog = skill_loader.get_catalog()
    # Pre-injected skills are already in system prompt; exclude from loadable catalog
    if pre_inject_skills:
        catalog = {k: v for k, v in catalog.items() if k not in pre_inject_skills}
    system_instruction = system_instruction.replace(
        '{skill_catalog}', _format_catalog(catalog))

    if pre_inject_skills:
        skill_parts = []
        for name in pre_inject_skills:
            body = skill_loader.load(name)
            if body:
                skill_parts.append(f"[Pre-loaded skill: {name}]\n{body}")
                if tracer:
                    tracer.add("skill_loaded", {"name": name, "content": body, "chars": len(body)})
        if skill_parts:
            system_instruction += "\n\n" + "\n\n".join(skill_parts)
    _tlog(f"System instruction ({len(pre_inject_skills or [])} skills)", t0)

    if tracer:
        tracer.end_phase("system_instruction")
        tracer.add("system_instruction", {
            "content": system_instruction,
            "chars": len(system_instruction),
            "catalog": list(catalog.keys()),
        })

    # 2. Build ContextIndex, shared by context and FC tools
    t0 = time.time()
    if tracer:
        tracer.start_phase("context_building")
    idx = ContextIndex(project_state, scenes) if project_state else None

    context_prefix = ""
    if idx:
        _tlog(f"ContextIndex built: {len(idx.scenes_by_number)} scenes, "
              f"{len(idx.shots_by_key)} shots, {len(idx.video_shots_by_key)} video shots, "
              f"{len(idx.supplements_by_id)} supplements")
        if tracer:
            tracer.add("context_index_built", {
                "scenes": len(idx.scenes_by_number),
                "shots": len(idx.shots_by_key),
                "video_shots": len(idx.video_shots_by_key),
                "supplements": len(idx.supplements_by_id),
                "characters": len(idx.character_by_name),
            })
        ctx = get_starting_context(idx, scope=scope)
        if ctx:
            context_prefix = f"[Project Context]\n{ctx}\n\n"
            if tracer:
                tracer.add("starting_context", {"scope": scope, "content": ctx, "chars": len(ctx)})
    else:
        _tlog("No project_state provided, ContextIndex=None")
    _tlog("Context index + starting context", t0)
    if tracer:
        tracer.end_phase("context_building")

    # 3. Build contents: history + current user message with context
    t0 = time.time()
    if tracer:
        tracer.start_phase("contents_assembly")
    contents = []

    # Conversation history: prefer Gemini-native contents (FC history preserved)
    conversation_chars = 0
    if conversation_contents:
        contents.extend(conversation_contents)
        conversation_chars = sum(len(str(c)) for c in conversation_contents)
        if AGENT_DEBUG:
            # Summarize what FC history we received
            fc_calls = []
            for c in conversation_contents:
                if isinstance(c, dict) and c.get('role') == 'model':
                    for p in c.get('parts', []):
                        if isinstance(p, dict) and p.get('function_call'):
                            fc_calls.append(p['function_call'].get('name', '?'))
            logger.info("[FC HISTORY] Received %d conversation_contents items (%d chars), FC calls in history: %s",
                        len(conversation_contents), conversation_chars, fc_calls or "none")
    elif conversation:
        # Legacy dialogue-only fallback
        if AGENT_DEBUG:
            logger.info("[FC HISTORY] No conversation_contents, falling back to dialogue-only (%d msgs)", len(conversation))
        for msg in conversation:
            role = msg.get('role', 'user')
            if role == 'agent':
                role = 'model'
            content = msg.get('content', '')
            conversation_chars += len(content)
            contents.append({'role': role, 'content': content})

    # Prepend per-turn context to user's message as one turn
    contents.append(context_prefix + message)
    _tlog(f"Contents assembly ({len(contents)} items, {len(conversation or [])} history msgs)", t0)

    if tracer:
        tracer.end_phase("contents_assembly")
        # Per-item breakdown for debugging
        items_info = []
        for i, item in enumerate(contents):
            if isinstance(item, str):
                items_info.append({"index": i, "type": "string", "chars": len(item)})
            elif isinstance(item, dict):
                items_info.append({"index": i, "type": "dict", "role": item.get("role"), "chars": len(item.get("content", ""))})
        tracer.add("contents_assembled", {
            "count": len(contents),
            "conversation_msgs": len(conversation or []),
            "conversation_chars": conversation_chars,
            "context_prefix_chars": len(context_prefix),
            "message_chars": len(message),
            "items": items_info,
        })

    # Create tools with request context bound
    t0 = time.time()
    if tracer:
        tracer.start_phase("tool_creation")
    tool_funcs = make_tools(
        idx, stream_callback=stream_callback, clients=clients,
        project_name=project_name, tracer=tracer,
        conversation=conversation, project_state=project_state,
        scenes=scenes, is_sub_agent=is_sub_agent,
    )
    _tlog(f"Tool creation ({len(tool_funcs)} tools)", t0)

    if tracer:
        tracer.end_phase("tool_creation")
        tracer.add("tools_created", {"names": [f.__name__ for f in tool_funcs]})

    # Estimate payload size for diagnostics
    if AGENT_DEBUG:
        total_chars = sum(len(str(c)) for c in contents)
        _tlog(f"Total contents size: {total_chars} chars, system instruction: {len(system_instruction)} chars")

    # Call LLM with FC
    t0 = time.time()
    if tracer:
        tracer.start_phase("llm_generate")
    llm = get_llm()
    result = llm.generate(
        system_instruction=system_instruction,
        contents=contents,
        tools=tool_funcs,
        thinking=True,
        stream_callback=stream_callback,
        tracer=tracer,
    )
    _tlog("LLM generate (total)", t0)
    if tracer:
        tracer.end_phase("llm_generate")
    _tlog(f"=== Agent request complete (response: {len(result.text)} chars, thinking: {len(result.thinking)} chars) ===", t_start)

    if AGENT_DEBUG:
        history = result.contents_history
        fc_names = []
        for c in history:
            if isinstance(c, dict) and c.get('role') == 'model':
                for p in c.get('parts', []):
                    if isinstance(p, dict) and p.get('function_call'):
                        fc_names.append(p['function_call'].get('name', '?'))
        logger.info("[FC HISTORY] Returning %d contents_history items, FC calls: %s, text: %d chars",
                    len(history), fc_names or "none", len(result.text))
    return {"text": result.text, "thinking": result.thinking, "contents_history": result.contents_history}


def _load_prompt(filename: str) -> str:
    path = os.path.join(PROMPTS_DIR, filename)
    with open(path, encoding='utf-8') as f:
        return f.read()


def _scope_label(scope: dict) -> str:
    """Derive human-readable label from scope dict for sub-agent system prompt."""
    if not scope:
        return "Full Project"
    if "shot" in scope:
        s = scope["shot"]
        if isinstance(s, (list, tuple)) and len(s) == 2:
            return f"Scene {s[0]}, Shot {s[1]}"
        return f"Shot {s}"
    if "scene" in scope:
        return f"Scene {scope['scene']}"
    if "character" in scope:
        return f"Character: {scope['character']}"
    if "custom" in scope:
        return "Custom Scope"
    return "Full Project"


def _format_catalog(catalog: dict) -> str:
    if not catalog:
        return "(No skills available)"
    return '\n'.join(f"- **{name}**: {desc}" for name, desc in catalog.items())
