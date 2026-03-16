"""Soulboard art director agent -- interleaved visual exploration pipeline.

Plans and executes image generation in parallel via Google GenAI SDK (Nano Banana).
Generated images stream to the frontend as SSE events, creating an interleaved
experience where the art director's reasoning and visual results appear together.
Stores blob paths in state, signs URLs for frontend, uses gs:// URIs for Gemini
multimodal context."""

import json
import time
import asyncio
import logging
import traceback
from datetime import datetime
from typing import Dict, Any, List, Optional, Callable

from google.genai import types

from ..llm import get_llm, SAFETY_SETTINGS_NONE
from ..gcs_utils import upload_bytes_to_gcs, download_to_bytes, sign_url, blob_path_to_gs_uri, is_blob_path, url_to_blob_path, generate_thumbnail
from .state import (
    create_initial_state, create_exploration_item, next_item_id,
    register_item, get_items_by_feedback, get_state, set_state,
)
from .prompts import (
    ART_DIRECTOR_SYSTEM_INSTRUCTION, ART_DIRECTOR_USER_PROMPT,
    FIRST_ITERATION_GUIDANCE, SUBSEQUENT_ITERATION_GUIDANCE
)

logger = logging.getLogger(__name__)

# Verbose art director logging — set True to log full prompts, thinking, configs, feedback
SOULBOARD_DEBUG = True

# Structured output schema for art director response
ART_DIRECTOR_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "reasoning": {"type": "STRING"},
        "configs": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "source": {"type": "STRING", "enum": ["nano_banana"]},
                    "prompt": {"type": "STRING"},
                    "reference_images": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "subject_reference": {"type": "STRING"},
                    "style_reference": {"type": "STRING"},
                    "aspect_ratio": {"type": "STRING", "enum": ["vertical", "horizontal", "square"]},
                    "rationale": {"type": "STRING"},
                    "title": {"type": "STRING"},
                    "description": {"type": "STRING"},
                },
                "required": ["source", "prompt", "rationale", "title", "description"]
            }
        }
    },
    "required": ["reasoning", "configs"]
}

# Lazy-initialized image client singleton
_nano_client = None


def _get_nano_client():
    """Lazy-init Nano Banana image generation client"""
    global _nano_client
    if _nano_client is None:
        from ..clients.nano_banana import NanoBananaClient
        _nano_client = NanoBananaClient()
    return _nano_client


def _build_user_prompt(sb_state: Dict[str, Any], user_message: str = None, project_state: Dict = None, scenes: List = None) -> str:
    """Build the user prompt with current context"""
    from ..context import get_script_context, CONTEXT_FRAMING

    config = sb_state["session_config"]
    prefs = config["preferences"]
    iterations = sb_state.get("iterations", [])

    guidance = FIRST_ITERATION_GUIDANCE if not iterations else SUBSEQUENT_ITERATION_GUIDANCE

    # Batch size counts from slider preferences (always present)
    gen_count = prefs.get("generations", 6)
    count_lines = []
    count_lines.append(f"- Generate exactly {gen_count} AI image configs (nano_banana)")
    guidance += "\n\nUser-requested batch size (override default counts):\n" + "\n".join(count_lines)

    # Build feedback context
    liked = get_items_by_feedback(sb_state, "liked")
    disliked = get_items_by_feedback(sb_state, "disliked")

    feedback_lines = []
    if liked:
        feedback_lines.append(f"Liked items ({len(liked)}):")
        for item in liked:
            note = f" \u2014 Note: {item['feedback_note']}" if item.get("feedback_note") else ""
            params = item.get("generation_params", {})
            prompt = params.get("prompt", "")
            prompt_line = f"\n    Previous prompt (reference only, do not reuse): {prompt}" if prompt else ""
            url = sign_url(item.get("content_url", ""))
            path_line = f"\n    Image URL (usable as reference_images/subject_reference/style_reference): {url}" if url else ""
            feedback_lines.append(f"  - {item['item_id']}: {item['metadata']['title']} ({item['source']}){note}{path_line}{prompt_line}")
    if disliked:
        feedback_lines.append(f"Disliked items ({len(disliked)}):")
        for item in disliked:
            note = f" \u2014 Note: {item['feedback_note']}" if item.get("feedback_note") else ""
            params = item.get("generation_params", {})
            prompt = params.get("prompt", "")
            prompt_line = f"\n    Previous prompt (avoid this direction): {prompt}" if prompt else ""
            url = sign_url(item.get("content_url", ""))
            url_line = f"\n    Image URL: {url}" if url else ""
            feedback_lines.append(f"  - {item['item_id']}: {item['metadata']['title']} ({item['source']}){note}{url_line}{prompt_line}")
    if not liked and not disliked:
        feedback_lines.append("No feedback yet.")

    # Reference images
    ref_images = config.get("reference_images", [])
    if ref_images:
        path_list = "\n".join(f"  - {sign_url(url)}" for url in ref_images)
        reference_image_context = (
            f"User uploaded {len(ref_images)} reference image(s) (visible above as [USER REFERENCE]). "
            f"Their URLs are:\n{path_list}\n"
            f"Use these URLs in reference_images, subject_reference, or style_reference fields "
            f"to guide generators toward the user's visual direction."
        )
    else:
        reference_image_context = "No reference images."

    # Creative context from project_state via get_script_context()
    creative_lines = []
    if project_state:
        # Determine spatial scope from session context
        context_type = sb_state.get("context", "standalone")
        scene_number = None
        shot_number = None

        if context_type == "shot" and scenes:
            shot_id = sb_state.get("shot_id")
            if shot_id:
                scene_number, shot_number = _resolve_shot_position(scenes, shot_id)

        script_context = get_script_context(
            project_state.get("generated_scripts"),
            scenes=scenes,
            scene_number=scene_number,
            shot_number=shot_number,
            include_all_scenes=(context_type != "shot"),
        )
        if script_context:
            creative_lines.append(script_context)

        if project_state.get("style_direction"):
            creative_lines.append(f"Style direction: {project_state['style_direction']}")

    if creative_lines:
        creative_context = CONTEXT_FRAMING + "\n\n" + "\n".join(creative_lines)
    else:
        creative_context = "No project creative context available."

    # Build conversation history from past iterations
    history_lines = []
    for it in iterations:
        it_num = it.get("iteration_number", "?")
        msg = it.get("user_message")
        reasoning = it.get("art_director_reasoning", "")
        if msg:
            history_lines.append(f"  Round {it_num} user: {msg}")
        if reasoning:
            history_lines.append(f"  Round {it_num} art director: {reasoning}")
    conversation_history = "\n".join(history_lines) if history_lines else "(first iteration)"

    return ART_DIRECTOR_USER_PROMPT.format(
        query=config["initial_query"],
        reference_image_context=reference_image_context,
        creative_context=creative_context,
        style_direction=prefs.get("style_direction", "") or "(not yet established)",
        iteration_guidance=guidance,
        feedback_context="\n".join(feedback_lines),
        conversation_history=conversation_history,
        user_message=user_message or "(none)"
    )


def _resolve_shot_position(scenes: List, shot_id: str) -> tuple:
    """Find 1-based (scene_number, shot_number) for a shot_id in storyboard scenes."""
    for si, scene in enumerate(scenes):
        for shi, shot in enumerate(scene.get("shots") or []):
            if shot.get("id") == shot_id:
                return (si + 1, shi + 1)
    return (None, None)


def _build_multimodal_contents(sb_state: Dict[str, Any], user_prompt: str) -> list:
    """Build multimodal content array with liked/disliked images for Gemini.
    Uses gs:// URIs for GCS blobs, HTTPS for external URLs.
    Gemini caps at 10 image links. Budget: refs first, then guarantee 1 liked + 1 disliked
    if they exist, fill remaining slots liked > disliked."""
    MAX_IMAGES = 10
    contents = []
    config = sb_state["session_config"]

    def _to_gemini_uri(val):
        """Convert blob path or URL to a URI Gemini can consume."""
        if not val:
            return None
        return blob_path_to_gs_uri(val)

    # Collect all image URLs by category
    ref_urls = [_to_gemini_uri(u) for u in config.get("reference_images", []) if u]
    ref_urls = [u for u in ref_urls if u]
    liked = [(item, _to_gemini_uri(item.get("content_url", ""))) for item in get_items_by_feedback(sb_state, "liked") if item.get("content_url")]
    liked = [(item, uri) for item, uri in liked if uri]
    disliked_raw = [item for item in get_items_by_feedback(sb_state, "disliked") if item.get("content_url")]
    disliked_raw.sort(key=lambda it: (not bool(it.get("feedback_note"))))
    disliked = [(item, _to_gemini_uri(item.get("content_url", ""))) for item in disliked_raw]
    disliked = [(item, uri) for item, uri in disliked if uri]

    # Cap refs to 5 on subsequent iterations to leave room for feedback images
    has_feedback = len(liked) > 0 or len(disliked) > 0
    max_refs = 5 if has_feedback else MAX_IMAGES
    ref_urls = ref_urls[:max_refs]

    # Budget: refs -> guarantee 1 each -> fill liked > disliked
    ref_count = min(len(ref_urls), MAX_IMAGES)
    remaining = MAX_IMAGES - ref_count
    # Reserve 1 slot each for liked/disliked if they exist
    like_reserved = min(1, len(liked)) if remaining > 0 else 0
    dislike_reserved = min(1, len(disliked)) if remaining - like_reserved > 0 else 0
    pool = remaining - like_reserved - dislike_reserved
    # Fill pool: liked first, then disliked
    like_extra = min(len(liked) - like_reserved, pool)
    dislike_extra = min(len(disliked) - dislike_reserved, pool - like_extra)
    like_slots = like_reserved + like_extra
    dislike_slots = dislike_reserved + dislike_extra

    if SOULBOARD_DEBUG:
        liked_notes = [f"{it['item_id']}:{it.get('feedback_note','')}" for it, _ in liked]
        disliked_notes = [f"{it['item_id']}:{it.get('feedback_note','')}" for it, _ in disliked]
        logger.info(f"[Soulboard] Multimodal budget: {ref_count} refs, {like_slots}/{len(liked)} liked, {dislike_slots}/{len(disliked)} disliked")
        if liked_notes:
            logger.info(f"[Soulboard] Liked items sent: {liked_notes[:like_slots]}")
        if disliked_notes:
            logger.info(f"[Soulboard] Disliked items sent: {disliked_notes[:dislike_slots]}")

    for url in ref_urls[:ref_count]:
        contents.append(types.Part.from_uri(file_uri=url, mime_type="image/png"))
        filename = url.rsplit("/", 1)[-1].split("?")[0] if "/" in url else "ref"
        contents.append(types.Part.from_text(text=f"[USER REFERENCE: {filename}]"))

    for item, url in liked[:like_slots]:
        contents.append(types.Part.from_uri(file_uri=url, mime_type="image/png"))
        label = f"[LIKED] {item['item_id']}: {item['metadata'].get('title', '')}"
        if item.get("feedback_note"):
            label += f" -- {item['feedback_note']}"
        contents.append(types.Part.from_text(text=label))

    for item, url in disliked[:dislike_slots]:
        contents.append(types.Part.from_uri(file_uri=url, mime_type="image/png"))
        label = f"[DISLIKED] {item['item_id']}: {item['metadata'].get('title', '')}"
        if item.get("feedback_note"):
            label += f" -- {item['feedback_note']}"
        contents.append(types.Part.from_text(text=label))

    contents.append(types.Part.from_text(text=user_prompt))
    return contents


def _call_art_director(sb_state: Dict[str, Any], user_message: str = None, project_state: Dict = None, scenes: List = None, stream_callback: Callable = None) -> Dict[str, Any]:
    """LLM call with retry -- returns structured JSON plan"""
    llm = get_llm("gemini")

    user_prompt = _build_user_prompt(sb_state, user_message, project_state, scenes)
    contents = _build_multimodal_contents(sb_state, user_prompt)

    if SOULBOARD_DEBUG:
        text_parts = [p.text for p in contents if hasattr(p, "text") and p.text]
        logger.info(f"[Soulboard] Art director INPUT ({len(contents)} parts):\n" + "\n---\n".join(text_parts))

    result = llm.generate(
        system_instruction=ART_DIRECTOR_SYSTEM_INSTRUCTION,
        contents=contents,
        response_schema=ART_DIRECTOR_RESPONSE_SCHEMA,
        safety_settings=SAFETY_SETTINGS_NONE,
        max_retries=3,
        thinking=True,
        stream_callback=stream_callback,
    )
    parsed = json.loads(result.text)

    if SOULBOARD_DEBUG:
        if result.thinking:
            logger.info(f"[Soulboard] Art director THINKING:\n{result.thinking}")
        logger.info(f"[Soulboard] Art director OUTPUT reasoning: {parsed.get('reasoning', '')}")
        for i, cfg in enumerate(parsed.get("configs", [])):
            logger.info(f"[Soulboard] Art director OUTPUT config {i+1}: {json.dumps(cfg, ensure_ascii=False)}")

    return parsed


def _sign_config_refs(configs: List[Dict[str, Any]]) -> None:
    """Sign GCS reference URLs in art director configs so providers can fetch them.
    LLM outputs signed URLs (from prompt text) -- normalize to blob paths first."""
    def _resolve(url: str) -> str:
        blob = url_to_blob_path(url) if not is_blob_path(url) else url
        return sign_url(blob)

    for cfg in configs:
        if cfg.get("reference_images"):
            cfg["reference_images"] = [_resolve(u) for u in cfg["reference_images"]]
        if cfg.get("style_reference"):
            cfg["style_reference"] = _resolve(cfg["style_reference"])
        if cfg.get("subject_reference"):
            cfg["subject_reference"] = _resolve(cfg["subject_reference"])


# --- Image generation wrappers ---

def _generate_nano_banana_item(config: Dict[str, Any], project_name: str, item_id: str, session_id: str = None, user_prefix: str = "") -> Dict[str, Any]:
    """Generate via NanoBananaClient: submit -> poll -> download -> upload to GCS"""
    try:
        nano = _get_nano_client()
        result = nano.generate_image(
            prompt=config.get("prompt", ""),
            aspect_ratio=config.get("aspect_ratio", "horizontal"),
            reference_images=config.get("reference_images") or None,
        )
        if not result.get("success"):
            return {"success": False, "error": result.get("error", "submit failed")}

        task_id = result["task_id"]
        sb_pfx = f"{user_prefix}/soulboard" if user_prefix else "soulboard"
        folder = f"{sb_pfx}/{project_name}/{session_id}" if session_id else f"{sb_pfx}/{project_name}"
        # Poll until complete
        for _ in range(120):
            time.sleep(1)
            status = nano.query_task(task_id)
            if status.get("status") == "succeed":
                url = status.get("result_url")
                if url:
                    img_bytes = download_to_bytes(url)
                    if img_bytes:
                        gcs_url = upload_bytes_to_gcs(img_bytes, folder, f"{item_id}.png", "image/png")
                        if gcs_url:
                            result = {"success": True, "content_url": gcs_url, "source": "nano_banana"}
                            sm = generate_thumbnail(img_bytes, max_width=320)
                            if sm:
                                result["thumb_url"] = upload_bytes_to_gcs(sm, folder, f"{item_id}_thumb_sm.jpg", "image/jpeg")
                            md = generate_thumbnail(img_bytes, max_width=640)
                            if md:
                                result["medium_url"] = upload_bytes_to_gcs(md, folder, f"{item_id}_thumb_md.jpg", "image/jpeg")
                            return result
                return {"success": False, "error": "no result URL"}
            elif status.get("status") in ("failed", "error"):
                return {"success": False, "error": status.get("error", "generation failed")}
        return {"success": False, "error": "timeout"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _execute_single_config(config: Dict[str, Any], project_name: str, item_id: str, session_id: str = None, user_prefix: str = "") -> Dict[str, Any]:
    return _generate_nano_banana_item(config, project_name, item_id, session_id, user_prefix=user_prefix)


# --- Main entry point ---

async def execute_iteration(
    project_name: str,
    session_id: str,
    query: str = None,
    user_message: str = None,
    reference_images: List[str] = None,
    preferences: Dict[str, Any] = None,
    project_state: Dict = None,
    scenes: List = None,
    send_event: Callable = None,
    context: str = "standalone",
    shot_id: str = None,
    character_id: str = None,
    user_prefix: str = "",
):
    """Execute one soulboard iteration: art director plans, tools execute in parallel."""
    start_time = time.time()

    async def emit(event_type: str, data: Dict[str, Any] = None):
        if send_event:
            await send_event({"type": event_type, **(data or {}), "timestamp": datetime.now().isoformat()})

    # Load or create state
    sb_state = get_state(project_name, session_id)
    if sb_state is None:
        if not query:
            await emit("error", {"error": "No query provided for new soulboard session"})
            return
        sb_state = create_initial_state(session_id, query, reference_images, preferences, context=context, shot_id=shot_id, character_id=character_id)
    elif query:
        sb_state["session_config"]["initial_query"] = query
        if reference_images:
            sb_state["session_config"]["reference_images"] = reference_images
        if preferences:
            sb_state["session_config"]["preferences"].update(preferences)
    else:
        # Replace (not append) — frontend sends the full active ref list each time
        if reference_images is not None:
            sb_state["session_config"]["reference_images"] = reference_images
        if preferences:
            sb_state["session_config"]["preferences"].update(preferences)

    sb_state["status"] = "generating"
    set_state(project_name, session_id, sb_state)

    iteration_number = len(sb_state["iterations"]) + 1

    try:
        await emit("iteration_started", {"iteration_number": iteration_number})

        loop = asyncio.get_event_loop()

        def thinking_callback(event_type, text):
            if event_type == 'thinking':
                asyncio.run_coroutine_threadsafe(
                    emit("art_director_thinking", {"text": text}),
                    loop
                )

        plan = await loop.run_in_executor(None, _call_art_director, sb_state, user_message, project_state, scenes, thinking_callback)

        configs = plan.get("configs", [])
        _sign_config_refs(configs)
        if not configs:
            await emit("error", {"error": "Art director returned no generation configs"})
            sb_state["status"] = "awaiting_feedback"
            set_state(project_name, session_id, sb_state)
            return

        # Estimate expected items
        expected_items = len(configs)
        planned_items = []
        for cfg in configs:
            planned_items.append({"source": cfg.get("source", "nano_banana"), "aspect_ratio": cfg.get("aspect_ratio", "horizontal"), "title": cfg.get("title", ""), "description": cfg.get("description", "")})

        logger.info(f"[Soulboard] Art director planned {len(configs)} configs (~{expected_items} items)")
        await emit("art_director_plan", {"reasoning": plan.get("reasoning", ""), "expected_items": expected_items, "planned_items": planned_items})

        # Execute configs in parallel
        iteration_items = []
        successful = 0
        failed = 0

        task_map = {}
        for cfg in configs:
            item_id = next_item_id(sb_state)
            task = asyncio.create_task(asyncio.to_thread(_execute_single_config, cfg, project_name, item_id, session_id, user_prefix=user_prefix))
            task_map[task] = (cfg, item_id)

        pending = set(task_map.keys())
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                cfg, item_id = task_map[task]
                try:
                    result = task.result()
                except Exception as e:
                    logger.error(f"[Soulboard] Task exception: {traceback.format_exc()}")
                    result = {"success": False, "error": str(e)}

                if result.get("success"):
                    metadata = {
                        "title": cfg.get("title", ""),
                        "description": cfg.get("description", ""),
                        "original_url": result.get("original_url"),
                        "hashtags": result.get("hashtags", []),
                    }
                    item = create_exploration_item(item_id, result["source"], result["content_url"], cfg, metadata)
                    item["thumb_url"] = result.get("thumb_url")
                    item["medium_url"] = result.get("medium_url")
                    iteration_items.append(item)
                    successful += 1
                    # Emit with signed URLs for frontend; state keeps blob paths
                    sse_item = {
                        **item,
                        "content_url": sign_url(item["content_url"]),
                        "thumb_url": sign_url(item.get("thumb_url") or ""),
                        "medium_url": sign_url(item.get("medium_url") or ""),
                    }
                    await emit("item_generated", {"item": sse_item})
                else:
                    failed += 1
                    logger.warning(f"[Soulboard] {item_id} failed ({cfg.get('source')}): {result.get('error')}")
                    await emit("item_failed", {"item_id": item_id, "source": cfg.get("source"), "error": result.get("error", "Unknown error")})

        # Build iteration record
        iteration_index = len(sb_state["iterations"])
        sb_state["iterations"].append({
            "iteration_number": iteration_number,
            "timestamp": datetime.now().isoformat(),
            "art_director_reasoning": plan.get("reasoning", ""),
            "user_message": user_message,
            "items": iteration_items,
        })

        for idx, item in enumerate(iteration_items):
            register_item(sb_state, item, iteration_index, idx)

        sb_state["status"] = "awaiting_feedback"
        set_state(project_name, session_id, sb_state)

        elapsed = time.time() - start_time
        await emit("iteration_complete", {
            "iteration_number": iteration_number,
            "total_items": successful + failed,
            "successful": successful,
            "failed": failed,
            "elapsed_seconds": round(elapsed, 1),
        })
        logger.info(f"[Soulboard] Iteration {iteration_number}: {successful} ok, {failed} failed, {elapsed:.1f}s")

    except Exception as e:
        logger.error(f"[Soulboard] Iteration error: {traceback.format_exc()}")
        sb_state["status"] = "awaiting_feedback"
        set_state(project_name, session_id, sb_state)
        await emit("error", {"error": str(e), "iteration_number": iteration_number})


def apply_feedback(sb_state: Dict[str, Any], feedback_list: List[Dict[str, Any]]) -> int:
    """Apply feedback to items in-place. Returns count updated."""
    updated = 0
    current_iteration = len(sb_state.get("iterations", []))
    if SOULBOARD_DEBUG:
        logger.info(f"[Soulboard] Feedback received: {len(feedback_list)} items")
    for fb in feedback_list:
        item_id = fb.get("item_id")
        location = sb_state.get("all_items_index", {}).get(item_id)
        if not location:
            if SOULBOARD_DEBUG:
                logger.warning(f"[Soulboard] Feedback LOST: {item_id} not in index")
            continue
        try:
            item = sb_state["iterations"][location["iteration"]]["items"][location["index"]]
            item["feedback"] = fb.get("action")
            item["feedback_note"] = fb.get("note")
            item["feedback_iteration"] = current_iteration
            updated += 1
            if SOULBOARD_DEBUG:
                note_str = f' note="{fb.get("note")}"' if fb.get("note") else ""
                logger.info(f"[Soulboard] Feedback applied: {item_id} -> {fb.get('action')}{note_str}")
        except (IndexError, KeyError):
            if SOULBOARD_DEBUG:
                logger.warning(f"[Soulboard] Feedback FAILED: {item_id} at iter={location.get('iteration')} idx={location.get('index')}")
            continue
    return updated


def finalize_items(sb_state: Dict[str, Any], selected_ids: List[str], categories: Dict[str, Dict] = None) -> List[Dict[str, Any]]:
    """Finalize selected items into a list of supplementary item dicts."""
    categories = categories or {}
    items = []

    for item_id in selected_ids:
        location = sb_state.get("all_items_index", {}).get(item_id)
        if not location:
            continue
        try:
            item = sb_state["iterations"][location["iteration"]]["items"][location["index"]]
        except (IndexError, KeyError):
            continue

        cat = categories.get(item_id, {})
        items.append({
            "id": item_id,
            "url": sign_url(item["content_url"]),
            "source": item["source"],
            "title": item["metadata"].get("title", ""),
            "description": item["metadata"].get("description", ""),
            "prompt": item.get("generation_params", {}).get("prompt", ""),
            "category": cat.get("content_type", "mood_board"),
            "content_name": cat.get("content_name", ""),
            "soulboard_origin": {
                "item_id": item_id,
                "source": item["source"],
                "generation_params": item.get("generation_params", {}),
            },
            "timestamp": datetime.now().isoformat(),
        })

    sb_state["finalized_items"] = selected_ids
    sb_state["status"] = "finalized"
    return items
