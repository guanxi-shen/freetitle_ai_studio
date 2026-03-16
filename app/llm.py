"""Google GenAI SDK LLM provider -- Gemini via Vertex AI with interleaved multimodal output.

Supports streaming, thinking, JSON schema, retry, and function calling (FC).
FC loop: manual execution with parallel tool dispatch and thought signature preservation.

Interleaved output: when response_modalities includes IMAGE, Gemini generates text and
images in a single response stream. The agent uses this for concept sketches and visual
explanations during conversation, complementing FC-based production generation tools."""

import json
import re
import time
import logging
from typing import NamedTuple, Callable, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from google import genai
from google.genai import types

from .config import GCP_PROJECT_ID, CREDENTIALS, AGENT_DEBUG

logger = logging.getLogger(__name__)

_MAX_429_RETRIES = 3

def _is_resource_exhausted(e):
    """Check if exception is a 429 Resource Exhausted error via type/status code."""
    if type(e).__name__ == "ResourceExhausted":
        logger.warning("429 Resource Exhausted: %s", e)
        return True
    for attr in ("code", "status_code", "grpc_status_code"):
        if getattr(e, attr, None) == 429:
            logger.warning("429 Resource Exhausted: %s", e)
            return True
    return False

def _timing_log(msg):
    if not AGENT_DEBUG:
        return
    logger.info("[AGENT TIMING] %s", msg)

SAFETY_SETTINGS_NONE = [
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
]

DEFAULT_MODEL = "gemini-3.1-pro-preview"
DEFAULT_LOCATION = "global"


class LLMResult(NamedTuple):
    text: str
    thinking: str = ""
    contents_history: list = []


def clean_json(text: str) -> str:
    """Strip markdown fences and fix trailing brace imbalance."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r'^```(?:json)?\s*\n?', '', text)
        text = re.sub(r'\n?```\s*$', '', text)
    text = text.strip()
    for _ in range(3):
        if text.count('}') <= text.count('{'):
            break
        if text.rstrip().endswith('}'):
            text = text.rstrip()[:-1]
        else:
            break
    return text.strip()


def _classify_part(part):
    """Classify a Gemini Part for trace content snapshots."""
    info = {}
    if getattr(part, 'thought', False):
        info["type"] = "thought"
    elif hasattr(part, 'function_call') and part.function_call:
        info["type"] = "function_call"
        info["name"] = part.function_call.name
    elif hasattr(part, 'function_response') and part.function_response:
        info["type"] = "function_response"
    elif hasattr(part, 'text') and part.text:
        info["type"] = "text"
        info["chars"] = len(part.text)
    else:
        info["type"] = "other"
    if getattr(part, 'thought_signature', None):
        info["has_thought_signature"] = True
    return info


class GeminiProvider:
    """Gemini LLM via Google GenAI SDK (Vertex AI).

    Supports interleaved multimodal output (text + images in single response),
    streaming with eager tool execution, and FC history persistence.
    Caches clients per location for connection reuse."""

    def __init__(self):
        self._clients: dict[str, genai.Client] = {}
        self._tool_pool = ThreadPoolExecutor(max_workers=16)

    def _get_client(self, location: str) -> genai.Client:
        if location not in self._clients:
            self._clients[location] = genai.Client(
                vertexai=True,
                project=GCP_PROJECT_ID,
                location=location,
                credentials=CREDENTIALS,
            )
        return self._clients[location]

    def _stream_response(self, client, model, contents, config, stream_callback=None, tracer=None, func_map=None):
        """Stream a single LLM call with optional eager tool execution.

        When func_map is provided, tools are submitted to self._tool_pool as their
        FC chunks arrive during streaming, instead of waiting for stream completion.

        Returns (text, thinking, function_calls, accumulated_parts, usage_metadata, eager_futures).
        eager_futures: list aligned with function_calls — Future per FC, or empty list if no func_map.
        """
        text, thinking = "", ""
        function_calls = []
        accumulated_parts = []
        eager_futures = []
        finish_reason = None
        usage_metadata = None
        t_stream_start = time.time()
        t_first_token = None
        chunk_count = 0

        for chunk in client.models.generate_content_stream(
            model=model, contents=contents, config=config
        ):
            chunk_count += 1
            if t_first_token is None and chunk_count == 1:
                t_first_token = time.time()
                if AGENT_DEBUG:
                    _timing_log(f"  First chunk: {t_first_token - t_stream_start:.3f}s")
                if tracer:
                    tracer.add("fc_first_chunk", {"ttfb_ms": int((t_first_token - t_stream_start) * 1000)})

            if chunk.candidates and chunk.candidates[0].content and chunk.candidates[0].content.parts:
                for part in chunk.candidates[0].content.parts:
                    accumulated_parts.append(part)
                    # Debug: dump every part's key attributes
                    if AGENT_DEBUG:
                        _timing_log(f"  part: thought={getattr(part, 'thought', '?')}, "
                                    f"text={len(getattr(part, 'text', '') or '')}ch, "
                                    f"fc={getattr(part, 'function_call', None) and getattr(part.function_call, 'name', '?')}, "
                                    f"sig={bool(getattr(part, 'thought_signature', None))}")
                    if hasattr(part, 'thought') and part.thought and hasattr(part, 'text') and part.text:
                        thinking += part.text
                        if stream_callback:
                            stream_callback('thinking', part.text)
                    if hasattr(part, 'function_call') and part.function_call is not None:
                        fc = part.function_call
                        function_calls.append(fc)
                        if stream_callback:
                            stream_callback('tool_call', {
                                'name': fc.name,
                                'args': dict(fc.args) if hasattr(fc, 'args') else {}
                            })
                        # Eager execution: submit tool immediately during streaming
                        if func_map:
                            func = func_map.get(fc.name)
                            if func:
                                args = dict(fc.args) if hasattr(fc, 'args') else {}
                                eager_futures.append(self._tool_pool.submit(func, **args))
                            else:
                                eager_futures.append(self._tool_pool.submit(
                                    lambda name=fc.name: {"success": False, "error": f"Unknown tool: {name}"}
                                ))

                    # Interleaved image output: Gemini generates images inline
                    # alongside text when response_modalities=["TEXT", "IMAGE"]
                    if hasattr(part, 'inline_data') and part.inline_data:
                        if stream_callback:
                            stream_callback('inline_image', {
                                'mime_type': part.inline_data.mime_type,
                                'data': part.inline_data.data,
                            })

            if hasattr(chunk, 'text') and chunk.text:
                text += chunk.text
                if stream_callback:
                    stream_callback('token', chunk.text)

            if chunk.candidates and hasattr(chunk.candidates[0], 'finish_reason'):
                finish_reason = chunk.candidates[0].finish_reason

            # Capture usage_metadata from last chunk that has it
            if hasattr(chunk, 'usage_metadata') and chunk.usage_metadata:
                usage_metadata = chunk.usage_metadata

        if AGENT_DEBUG:
            eager_done = sum(1 for f in eager_futures if f.done()) if eager_futures else 0
            _timing_log(f"  Stream complete: {time.time() - t_stream_start:.3f}s ({chunk_count} chunks, {len(thinking)} thinking chars, {len(text)} text chars, {len(function_calls)} FC, {eager_done}/{len(eager_futures)} tools already done)")

        if tracer:
            tracer.add("fc_stream_complete", {
                "duration_ms": int((time.time() - t_stream_start) * 1000),
                "chunk_count": chunk_count,
                "thinking_chars": len(thinking),
                "text_chars": len(text),
                "fc_count": len(function_calls),
                "finish_reason": str(finish_reason),
            })

        if finish_reason and str(finish_reason) not in ("STOP", "FinishReason.STOP", "MAX_TOKENS", "FinishReason.MAX_TOKENS", "None"):
            logger.warning("LLM finish_reason: %s (text=%d chars)", finish_reason, len(text))

        return text, thinking, function_calls, accumulated_parts, usage_metadata, eager_futures

    def generate(
        self,
        system_instruction: str,
        contents,
        response_schema: dict = None,
        model: str = DEFAULT_MODEL,
        location: str = DEFAULT_LOCATION,
        safety_settings: list = None,
        response_modalities: list = None,
        max_retries: int = 1,
        retry_delay: float = 1.0,
        thinking: bool = False,
        stream_callback: Optional[Callable[[str, str], None]] = None,
        tools: list = None,
        max_rounds: int = 10,
        tracer=None,
        **kwargs,
    ) -> LLMResult:
        """Generate text from Gemini using streaming.

        Args:
            system_instruction: System prompt.
            contents: str or list -- passed directly to SDK.
            response_schema: None for plain text, dict for JSON mode with schema.
            model: Gemini model name.
            location: Vertex AI location.
            safety_settings: Override safety settings (default: BLOCK_NONE).
            response_modalities: List of output modalities, e.g. ["TEXT", "IMAGE"]
                for interleaved multimodal output.
            max_retries: Number of attempts. >1 retries on JSONDecodeError.
            retry_delay: Seconds between retries.
            thinking: Enable thinking mode (ThinkingConfig).
            stream_callback: Optional callback(event_type, text) for streaming.
                event_type is 'token', 'thinking', 'tool_call', or 'inline_image'.
            tools: List of callable functions for FC mode. Mutually exclusive with response_schema.
            max_rounds: Max FC loop iterations (default 10).
            tracer: Optional TraceCollector for request tracing.

        Returns:
            LLMResult(text, thinking).
        """
        if tools and response_schema:
            raise ValueError("tools and response_schema are mutually exclusive")

        client = self._get_client(location)

        config_kwargs = {
            "system_instruction": system_instruction,
            "safety_settings": safety_settings or SAFETY_SETTINGS_NONE,
        }

        # Interleaved multimodal output: enables Gemini to generate text + images
        # in a single response stream for concept visualization and creative exploration
        if response_modalities:
            config_kwargs["response_modalities"] = response_modalities

        if response_schema is not None:
            config_kwargs["response_mime_type"] = "application/json"
            config_kwargs["response_schema"] = response_schema

        if tools:
            tool_declarations = []
            for func in tools:
                decl = types.FunctionDeclaration.from_callable(client=client, callable=func)
                tool_declarations.append(decl)
            config_kwargs["tools"] = [types.Tool(function_declarations=tool_declarations)]
            config_kwargs["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(
                disable=True
            )

        if thinking:
            if "gemini-3" in model.lower():
                config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level="medium", include_thoughts=True)
            else:
                config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=-1, include_thoughts=True)

        config = types.GenerateContentConfig(**config_kwargs)

        # Trace model config
        if tracer:
            thinking_info = None
            if thinking:
                if "gemini-3" in model.lower():
                    thinking_info = {"thinking_level": "medium"}
                else:
                    thinking_info = {"thinking_budget": -1}
            tracer.add("model_config", {
                "model": model,
                "location": location,
                "thinking": thinking_info,
                "has_tools": bool(tools),
                "tool_count": len(tools) if tools else 0,
                "has_response_schema": bool(response_schema),
                "max_rounds": max_rounds,
            })

        # Normalize contents: convert dicts to SDK types, fix role alternation
        pre_normalize_count = len(contents) if isinstance(contents, list) else 1
        contents = self._normalize_contents(contents)
        post_normalize_count = len(contents) if isinstance(contents, list) else 1

        # Trace if normalization injected ack messages
        if tracer and post_normalize_count != pre_normalize_count:
            tracer.add("contents_normalized", {
                "pre_count": pre_normalize_count,
                "post_count": post_normalize_count,
                "acks_injected": post_normalize_count - pre_normalize_count,
            })

        # FC path
        if tools:
            return self._fc_loop(client, model, contents, config, tools, max_rounds, stream_callback, tracer)

        # Standard path (no tools)
        last_error = None
        for attempt in range(max_retries):
            for attempt_429 in range(_MAX_429_RETRIES + 1):
                try:
                    text, thinking_text, _, _, _, _ = self._stream_response(
                        client, model, contents, config, stream_callback, tracer
                    )
                    break
                except Exception as e:
                    if _is_resource_exhausted(e) and attempt_429 < _MAX_429_RETRIES:
                        delay = 2 ** (attempt_429 + 1)
                        logger.warning("429 Resource Exhausted, retrying in %ds (%d/%d)",
                                       delay, attempt_429 + 1, _MAX_429_RETRIES)
                        time.sleep(delay)
                        continue
                    raise

            try:
                if thinking_text:
                    logger.debug("LLM thinking:\n%s", thinking_text)

                if response_schema is not None:
                    text = clean_json(text)
                    json.loads(text)  # validate JSON

                return LLMResult(text=text.strip(), thinking=thinking_text)
            except json.JSONDecodeError as e:
                last_error = e
                logger.warning("JSON parse failed (attempt %d/%d): %s", attempt + 1, max_retries, e)
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)

        raise last_error

    def _normalize_contents(self, contents):
        """Convert dict items to SDK Content objects and fix role alternation.
        Strings pass through. Dicts become Content(role, parts).
        Injects model ack between consecutive user-role items."""
        if not contents:
            return contents

        native_dicts = 0
        legacy_dicts = 0
        normalized = []
        for item in contents:
            if isinstance(item, str):
                normalized.append(item)
            elif isinstance(item, dict) and 'role' in item and 'parts' in item:
                normalized.append(types.Content.model_validate(item))
                native_dicts += 1
            elif isinstance(item, dict) and 'role' in item and 'content' in item:
                normalized.append(types.Content(
                    role=item['role'],
                    parts=[types.Part.from_text(text=item['content'])],
                ))
                legacy_dicts += 1
            else:
                normalized.append(item)

        # Fix role alternation: insert model ack between consecutive user-role items,
        # and between tool-role and user-role items.
        # Strings are treated as user role by the SDK.
        acks_injected = 0
        result = []
        for item in normalized:
            is_user = isinstance(item, str) or (isinstance(item, types.Content) and item.role == 'user')
            if is_user and result:
                prev = result[-1]
                prev_is_user = isinstance(prev, str) or (isinstance(prev, types.Content) and prev.role == 'user')
                prev_is_tool = isinstance(prev, types.Content) and prev.role == 'tool'
                if prev_is_user or prev_is_tool:
                    result.append(types.Content(
                        role='model',
                        parts=[types.Part.from_text(text='Understood.')],
                    ))
                    acks_injected += 1
            result.append(item)

        if AGENT_DEBUG and (native_dicts or acks_injected):
            _timing_log(f"_normalize_contents: {len(contents)} items -> {len(result)} "
                        f"(native_dicts={native_dicts}, legacy_dicts={legacy_dicts}, acks={acks_injected})")

        return result

    def _serialize_contents(self, contents, start_index):
        """Serialize new Content objects from this turn for history persistence.
        Skips user-role items (reconstructed from raw text by frontend).
        Strips thought-only parts. Preserves thought_signature on function_call
        parts (Gemini requires it when thinking is enabled)."""
        result = []
        thoughts_stripped = 0
        sigs_stripped = 0
        for item in contents[start_index:]:
            if not isinstance(item, types.Content):
                continue
            if item.role == 'user':
                continue
            try:
                d = item.model_dump(mode='json', exclude_none=True)
            except Exception:
                continue
            # Strip thought-only parts (thought=True without function_call)
            if d.get('parts'):
                filtered = []
                for part in d['parts']:
                    if part.get('thought') and not part.get('function_call'):
                        thoughts_stripped += 1
                        continue
                    # Keep thought_signature on function_call parts (Gemini requires it)
                    if not part.get('function_call') and part.pop('thought_signature', None):
                        sigs_stripped += 1
                    filtered.append(part)
                d['parts'] = filtered
            if d.get('parts'):
                result.append(d)

        if AGENT_DEBUG:
            roles = [r.get('role', '?') for r in result]
            fc_names = []
            for r in result:
                for p in r.get('parts', []):
                    if isinstance(p, dict) and p.get('function_call'):
                        fc_names.append(p['function_call'].get('name', '?'))
            _timing_log(f"_serialize_contents: {len(contents) - start_index} new items -> "
                        f"{len(result)} serialized (roles={roles}, fc={fc_names}, "
                        f"thoughts_stripped={thoughts_stripped}, sigs_stripped={sigs_stripped})")

        return result

    def _fc_loop(self, client, model, contents, config, tools, max_rounds, stream_callback, tracer=None):
        """Function calling loop with eager parallel tool execution.

        Tools execute immediately as FC chunks arrive during streaming,
        rather than waiting for the full stream to complete first.
        """
        # Type guard + defensive copy
        if isinstance(contents, str):
            contents = [contents]
        contents = list(contents)
        initial_len = len(contents)

        all_thinking = ""
        t_fc_start = time.time()
        func_map = {f.__name__: f for f in tools}

        for round_num in range(max_rounds):
            if AGENT_DEBUG:
                _timing_log(f"FC round {round_num + 1} — LLM call")
            if tracer:
                tracer.add("fc_round_start", {"round": round_num + 1})

            for attempt_429 in range(_MAX_429_RETRIES + 1):
                try:
                    text, thinking, function_calls, accumulated_parts, usage_metadata, eager_futures = self._stream_response(
                        client, model, contents, config, stream_callback, tracer, func_map=func_map
                    )
                    break
                except Exception as e:
                    if _is_resource_exhausted(e) and attempt_429 < _MAX_429_RETRIES:
                        delay = 2 ** (attempt_429 + 1)
                        logger.warning("429 Resource Exhausted (FC round %d), retrying in %ds (%d/%d)",
                                       round_num + 1, delay, attempt_429 + 1, _MAX_429_RETRIES)
                        if tracer:
                            tracer.add("fc_429_retry", {"round": round_num + 1, "attempt": attempt_429 + 1, "delay_s": delay})
                        time.sleep(delay)
                        continue
                    if tracer:
                        from .agent.tracer import format_error_for_trace
                        tracer.add("error", {"round": round_num + 1, "error": format_error_for_trace(e)})
                    raise

            if thinking:
                all_thinking += thinking
                if tracer:
                    tracer.add("fc_thinking", {"round": round_num + 1, "text": thinking})

            # Trace usage from this round
            if tracer and usage_metadata:
                tracer.record_usage(round_num + 1, usage_metadata)
                tracer.add("fc_round_usage", {
                    "round": round_num + 1,
                    "input": getattr(usage_metadata, 'prompt_token_count', 0) or 0,
                    "output": getattr(usage_metadata, 'candidates_token_count', 0) or 0,
                    "thinking": getattr(usage_metadata, 'thoughts_token_count', 0) or 0,
                    "total": getattr(usage_metadata, 'total_token_count', 0) or 0,
                    "cached": getattr(usage_metadata, 'cached_content_token_count', 0) or 0,
                })

            # No function calls -- done
            if not function_calls:
                if AGENT_DEBUG:
                    _timing_log(f"FC loop done in {round_num + 1} round(s), {time.time() - t_fc_start:.3f}s total")
                if tracer and text:
                    tracer.add("fc_response_text", {"round": round_num + 1, "text": text})
                history = self._serialize_contents(contents, initial_len)
                if text.strip():
                    history.append({"role": "model", "parts": [{"text": text.strip()}]})
                return LLMResult(text=text.strip(), thinking=all_thinking, contents_history=history)

            # Trace tool calls
            if tracer:
                tracer.add("fc_tool_calls", {
                    "round": round_num + 1,
                    "parallel": len(function_calls) > 1,
                    "calls": [{"name": fc.name, "args": dict(fc.args) if hasattr(fc, 'args') else {}} for fc in function_calls],
                })

            # Preserve thought signatures by appending accumulated parts
            if AGENT_DEBUG:
                fc_parts = [p for p in accumulated_parts if hasattr(p, 'function_call') and p.function_call]
                thought_parts = [p for p in accumulated_parts if getattr(p, 'thought', False)]
                sig_parts = [p for p in accumulated_parts if getattr(p, 'thought_signature', None)]
                has_sig = any(getattr(p, 'thought_signature', None) for p in fc_parts)
                if not has_sig and fc_parts:
                    logger.warning(
                        "FC round %d: NO thought_signature on any FC part! "
                        "parts=%d, thought_parts=%d, fc_parts=%d, sig_parts=%d, "
                        "fc_names=%s, content_blocks=%d, thinking_chars=%d",
                        round_num + 1, len(accumulated_parts), len(thought_parts),
                        len(fc_parts), len(sig_parts),
                        [p.function_call.name for p in fc_parts],
                        len(contents), len(thinking),
                    )
                else:
                    _timing_log(
                        f"FC round {round_num + 1} — thought_sig OK: "
                        f"{len(fc_parts)} FCs, {len(sig_parts)} sig parts, "
                        f"{len(thought_parts)} thought parts"
                    )
            contents.append(types.Content(role="model", parts=accumulated_parts))

            # Trace content block snapshot -- critical for thought_signature debugging
            if tracer:
                blocks = []
                for i, item in enumerate(contents):
                    if isinstance(item, types.Content):
                        part_types = [_classify_part(p) for p in (item.parts or [])]
                        blocks.append({
                            "index": i, "role": item.role,
                            "parts": len(item.parts or []),
                            "types": part_types,
                        })
                    elif isinstance(item, str):
                        blocks.append({"index": i, "type": "string", "chars": len(item)})
                    else:
                        blocks.append({"index": i, "type": type(item).__name__})
                tracer.add("fc_contents_snapshot", {"round": round_num + 1, "blocks": blocks})

            # Collect tool results — tools already running from eager execution
            if AGENT_DEBUG:
                fc_names = [fc.name for fc in function_calls]
                done_count = sum(1 for f in eager_futures if f.done())
                _timing_log(f"FC round {round_num + 1} — collecting {len(eager_futures)} tools ({done_count} already done): {fc_names}")
            t_tools = time.time()
            if tracer:
                tracer.start_phase(f"fc_round_{round_num+1}_tools")
            results = []
            for i, future in enumerate(eager_futures):
                try:
                    result = future.result()
                except Exception as e:
                    result = {"success": False, "error": str(e)}
                results.append((function_calls[i], result))
            if tracer:
                tracer.end_phase(f"fc_round_{round_num+1}_tools")
            if AGENT_DEBUG:
                _timing_log(f"FC round {round_num + 1} — tools done ({time.time() - t_tools:.3f}s)")

            # Build function response parts
            response_parts = []
            for fc, result in results:
                parts = self._build_function_response_parts(fc, result)
                response_parts.extend(parts)

            contents.append(types.Content(role="tool", parts=response_parts))

            # Trace response text if present this round
            if tracer and text:
                tracer.add("fc_response_text", {"round": round_num + 1, "text": text})

        # Max rounds reached -- return last text
        logger.warning("FC loop reached max_rounds (%d)", max_rounds)
        history = self._serialize_contents(contents, initial_len)
        if text.strip():
            history.append({"role": "model", "parts": [{"text": text.strip()}]})
        return LLMResult(text=text.strip(), thinking=all_thinking, contents_history=history)

    def _execute_tools(self, function_calls, tools):
        """Execute function calls in parallel. Returns list of (fc, result) tuples in original order."""
        func_map = {f.__name__: f for f in tools}
        results = [None] * len(function_calls)

        with ThreadPoolExecutor(max_workers=min(len(function_calls), 8)) as pool:
            future_to_idx = {}
            for i, fc in enumerate(function_calls):
                func = func_map.get(fc.name)
                if func:
                    args = dict(fc.args) if hasattr(fc, 'args') else {}
                    future = pool.submit(func, **args)
                    future_to_idx[future] = i
                else:
                    results[i] = (fc, {"success": False, "error": f"Unknown tool: {fc.name}"})

            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                try:
                    result = future.result()
                except Exception as e:
                    result = {"success": False, "error": str(e)}
                results[idx] = (function_calls[idx], result)

        return results

    def _build_function_response_parts(self, fc, result):
        """Build function response Part(s), auto-detecting multimodal content."""
        response_data = {k: v for k, v in result.items() if k != "multimodal_response"}
        multimodal_resp = result.get("multimodal_response")

        if not multimodal_resp:
            return [types.Part.from_function_response(name=fc.name, response=response_data)]

        parts = []
        for item in multimodal_resp.get("images", []):
            filename = item["file_uri"].split("/")[-1]
            response_data[filename] = {"$ref": filename, "description": item["description"]}
            parts.append(types.FunctionResponsePart(
                file_data=types.FunctionResponseFileData(
                    mime_type=item["mime_type"],
                    display_name=filename,
                    file_uri=item["file_uri"],
                )
            ))

        return [types.Part.from_function_response(name=fc.name, response=response_data, parts=parts)]


class LLM:
    """Multi-provider router. Delegates to provider based on model name."""

    def __init__(self):
        self._providers = {}

    def generate(self, system_instruction, contents, model=DEFAULT_MODEL,
                 response_schema=None, max_retries=1, retry_delay=1.0,
                 thinking=False, stream_callback=None,
                 response_modalities=None,
                 tools=None, max_rounds=10, tracer=None, **kwargs) -> LLMResult:
        provider = self._get_provider(model)
        return provider.generate(
            system_instruction, contents, model=model,
            response_schema=response_schema, max_retries=max_retries,
            retry_delay=retry_delay, thinking=thinking,
            stream_callback=stream_callback,
            response_modalities=response_modalities,
            tools=tools,
            max_rounds=max_rounds, tracer=tracer, **kwargs)

    def _get_provider(self, model):
        # Gemini is the only provider currently; extensible for future providers
        return self._providers.setdefault("gemini", GeminiProvider())


_llm = None


def get_llm(provider: str = "gemini") -> LLM:
    """Factory -- returns LLM router instance (singleton).
    Accepts optional provider arg for backward compat (ignored -- routing is by model name)."""
    global _llm
    if _llm is None:
        _llm = LLM()
    return _llm
