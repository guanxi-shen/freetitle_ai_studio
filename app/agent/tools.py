"""Tool closures factory -- creates tool functions with request context bound via closure.

Each tool is a closure capturing request-scoped state (project context, clients,
stream callback, tracer). This design keeps the agent's function calling interface
clean while grounding every tool invocation in actual project data -- preventing
hallucination by ensuring the agent operates on real scenes, shots, and assets.

Tools:
  load_skill, get_project_context -- context + skill loading
  generate_image, generate_video  -- multimodal content generation (Google GenAI SDK)
  edit_video                      -- post-production editing (FFmpeg)
  generate_audio                  -- music generation (Google Lyria)
  run_sub_agent                   -- parallel specialist delegation
"""

import time
import uuid as _uuid
import threading
import logging

from . import skill_loader
from .context import ContextIndex, get_project_context as _get_context
from ..config import AGENT_DEBUG, AGENT_MULTIMODAL_IMAGES, AGENT_MULTIMODAL_VIDEOS, MAX_PARALLEL_SUB_AGENTS
from ..gcs_utils import url_to_blob_path, sign_url, blob_path_to_gs_uri

logger = logging.getLogger(__name__)


def _new_id():
    return str(_uuid.uuid4())


def _dbg(msg, *args):
    if AGENT_DEBUG:
        logger.info("[AGENT TOOL] " + msg, *args)


def _resolve_shot_ids(idx, destination: dict) -> dict:
    """Resolve sceneNumber/shotNumber to UUID-based sceneId/shotId.
    Agent sees numbers in context; frontend needs UUIDs for addResultToShot.
    """
    if not idx:
        return {"error": "No project data available to resolve scene/shot"}
    scene_num = destination.get("sceneNumber")
    shot_num = destination.get("shotNumber")
    if scene_num is None or shot_num is None:
        if destination.get("sceneId") and destination.get("shotId"):
            _dbg("shot IDs passed as raw UUIDs: scene=%s shot=%s", destination["sceneId"], destination["shotId"])
            return {}
        return {"error": "Shot destination requires sceneNumber and shotNumber"}
    scene = idx.scenes_by_number.get(int(scene_num))
    if not scene:
        _dbg("scene %s not found. available scenes: %s", scene_num, list(idx.scenes_by_number.keys()))
        return {"error": f"Scene {scene_num} not found in project"}
    shot = idx.shots_by_key.get(f"{int(scene_num)}_{int(shot_num)}")
    if not shot:
        available = [k for k in idx.shots_by_key if k.startswith(f"{int(scene_num)}_")]
        _dbg("shot %s_%s not found. available in scene %s: %s", scene_num, shot_num, scene_num, available)
        return {"error": f"Shot {shot_num} not found in scene {scene_num}"}
    resolved = {"sceneId": str(scene.get("id")), "shotId": str(shot.get("id"))}
    _dbg("resolved scene %s shot %s -> sceneId=%s shotId=%s", scene_num, shot_num, resolved["sceneId"], resolved["shotId"])
    return resolved


def _resolve_video_shot_ids(idx, destination: dict) -> dict:
    """Resolve sceneNumber/shotNumber to UUIDs for video shots."""
    if not idx:
        return {"error": "No project data available to resolve scene/shot"}
    scene_num = destination.get("sceneNumber")
    shot_num = destination.get("shotNumber")
    if scene_num is None or shot_num is None:
        if destination.get("sceneId") and destination.get("shotId"):
            _dbg("video shot IDs passed as raw UUIDs: scene=%s shot=%s", destination["sceneId"], destination["shotId"])
            return {}
        return {"error": "video_shot destination requires sceneNumber and shotNumber"}
    scene = idx.scenes_by_number.get(int(scene_num))
    if not scene:
        _dbg("scene %s not found. available scenes: %s", scene_num, list(idx.scenes_by_number.keys()))
        return {"error": f"Scene {scene_num} not found in project"}
    vshot = idx.video_shots_by_key.get(f"{int(scene_num)}_{int(shot_num)}")
    if not vshot:
        available = [k for k in idx.video_shots_by_key if k.startswith(f"{int(scene_num)}_")]
        _dbg("video shot %s_%s not found. available in scene %s: %s", scene_num, shot_num, scene_num, available)
        return {"error": f"Video shot {shot_num} not found in scene {scene_num}"}
    resolved = {"sceneId": str(scene.get("id")), "shotId": str(vshot.get("id"))}
    _dbg("resolved video scene %s shot %s -> sceneId=%s shotId=%s", scene_num, shot_num, resolved["sceneId"], resolved["shotId"])
    return resolved


_SCOPE_SKILL_MAP = {
    "scene": "storyboard-generation",
    "shot": "storyboard-generation",
    "character": "character-design",
    "video_shot": "video-generation",
    "supplement": "supplementary-generation",
}


def make_tools(idx: ContextIndex = None, stream_callback=None, clients=None, project_name=None, tracer=None,
               conversation=None, project_state=None, scenes=None, is_sub_agent=False) -> list:
    """Create tool functions with request context bound via closure.
    Returns list of callables for llm.generate(tools=...).

    tracer: optional TraceCollector. When present, each tool execution is traced
    with name, args, duration, and result. Future sub-agent tools should follow
    the same pattern: wrap the result with a tracer.add("fc_tool_result", ...) call.
    """
    _dbg("make_tools: idx=%s clients=%s project=%s", bool(idx), list((clients or {}).keys()), project_name)

    # Per-request auto-create dedup cache
    _created = {}  # {scene_num: {"sceneId": str, "shots": {shot_num: shotId}, "video_shots": {shot_num: shotId}}}
    _created_characters = {}  # {name_lower: charId}
    _lock = threading.Lock()

    def _fill_shot_gaps(scene_id, scene_num, target_num, cache, ops):
        """Create placeholder shots to fill gaps up to target_num. Returns target shotId."""
        # Determine highest existing shot number
        existing_nums = set(cache.get("shots", {}).keys())
        if idx:
            for k in idx.shots_by_key:
                if k.startswith(f"{scene_num}_"):
                    existing_nums.add(int(k.split("_")[1]))
        max_existing = max(existing_nums) if existing_nums else 0

        # Create gap fillers (max_existing+1 ... target_num)
        target_id = None
        for n in range(max_existing + 1, target_num + 1):
            if n in existing_nums:
                continue
            sid = _new_id()
            cache["shots"][n] = sid
            ops.append({"action": "add_shot", "sceneId": scene_id, "shotId": sid, "shotNumber": n})
            if n == target_num:
                target_id = sid
        if target_id is None:
            target_id = cache["shots"].get(target_num)
        return target_id

    def _auto_create_shot(destination):
        """Auto-create scene/shot if missing. Returns {sceneId, shotId} or {error}."""
        scene_num = int(destination.get("sceneNumber", 0))
        shot_num = int(destination.get("shotNumber", 1))
        if not scene_num:
            return {"error": "sceneNumber required for auto-create"}

        ops = []
        with _lock:
            existing_scene = idx.scenes_by_number.get(scene_num) if idx else None
            cached = _created.get(scene_num)

            if existing_scene:
                scene_id = str(existing_scene.get("id"))
                existing_shot = idx.shots_by_key.get(f"{scene_num}_{shot_num}") if idx else None
                if existing_shot:
                    return {"sceneId": scene_id, "shotId": str(existing_shot.get("id"))}
                if cached and shot_num in cached.get("shots", {}):
                    return {"sceneId": scene_id, "shotId": cached["shots"][shot_num]}
                _created.setdefault(scene_num, {"sceneId": scene_id, "shots": {}, "video_shots": {}})
                target_id = _fill_shot_gaps(scene_id, scene_num, shot_num, _created[scene_num], ops)
                result = {"sceneId": scene_id, "shotId": target_id}

            elif cached:
                scene_id = cached["sceneId"]
                if shot_num in cached.get("shots", {}):
                    return {"sceneId": scene_id, "shotId": cached["shots"][shot_num]}
                target_id = _fill_shot_gaps(scene_id, scene_num, shot_num, cached, ops)
                result = {"sceneId": scene_id, "shotId": target_id}

            else:
                scene_id = _new_id()
                shot1_id = _new_id()
                _created[scene_num] = {"sceneId": scene_id, "shots": {1: shot1_id}, "video_shots": {}}
                ops.append({"action": "add_scene", "sceneId": scene_id, "sceneNumber": scene_num, "shotId": shot1_id})

                if shot_num == 1:
                    result = {"sceneId": scene_id, "shotId": shot1_id}
                else:
                    target_id = _fill_shot_gaps(scene_id, scene_num, shot_num, _created[scene_num], ops)
                    result = {"sceneId": scene_id, "shotId": target_id}

        if ops and stream_callback:
            _dbg("auto_create_shot: emitting structure_changed with %d ops", len(ops))
            stream_callback("state_changed", {"change": "structure_changed", "operations": ops})

        return result

    def _fill_video_shot_gaps(scene_id, scene_num, target_num, cache, ops):
        """Create placeholder video shots to fill gaps up to target_num. Returns target shotId."""
        existing_nums = set(cache.get("video_shots", {}).keys())
        if idx:
            for k in idx.video_shots_by_key:
                if k.startswith(f"{scene_num}_"):
                    existing_nums.add(int(k.split("_")[1]))
        max_existing = max(existing_nums) if existing_nums else 0

        target_id = None
        for n in range(max_existing + 1, target_num + 1):
            if n in existing_nums:
                continue
            sid = _new_id()
            cache["video_shots"][n] = sid
            ops.append({"action": "add_video_shot", "sceneId": scene_id, "shotId": sid, "shotNumber": n})
            if n == target_num:
                target_id = sid
        if target_id is None:
            target_id = cache["video_shots"].get(target_num)
        return target_id

    def _auto_create_video_shot(destination):
        """Auto-create scene/video_shot if missing. Returns {sceneId, shotId} or {error}."""
        scene_num = int(destination.get("sceneNumber", 0))
        shot_num = int(destination.get("shotNumber", 1))
        if not scene_num:
            return {"error": "sceneNumber required for auto-create"}

        ops = []
        with _lock:
            existing_scene = idx.scenes_by_number.get(scene_num) if idx else None
            cached = _created.get(scene_num)

            if existing_scene:
                scene_id = str(existing_scene.get("id"))
                existing_vshot = idx.video_shots_by_key.get(f"{scene_num}_{shot_num}") if idx else None
                if existing_vshot:
                    return {"sceneId": scene_id, "shotId": str(existing_vshot.get("id"))}
                if cached and shot_num in cached.get("video_shots", {}):
                    return {"sceneId": scene_id, "shotId": cached["video_shots"][shot_num]}
                _created.setdefault(scene_num, {"sceneId": scene_id, "shots": {}, "video_shots": {}})
                target_id = _fill_video_shot_gaps(scene_id, scene_num, shot_num, _created[scene_num], ops)
                result = {"sceneId": scene_id, "shotId": target_id}

            elif cached:
                scene_id = cached["sceneId"]
                if shot_num in cached.get("video_shots", {}):
                    return {"sceneId": scene_id, "shotId": cached["video_shots"][shot_num]}
                target_id = _fill_video_shot_gaps(scene_id, scene_num, shot_num, cached, ops)
                result = {"sceneId": scene_id, "shotId": target_id}

            else:
                scene_id = _new_id()
                shot1_id = _new_id()
                _created[scene_num] = {"sceneId": scene_id, "shots": {1: shot1_id}, "video_shots": {}}
                ops.append({"action": "add_scene", "sceneId": scene_id, "sceneNumber": scene_num, "shotId": shot1_id})
                target_id = _fill_video_shot_gaps(scene_id, scene_num, shot_num, _created[scene_num], ops)
                result = {"sceneId": scene_id, "shotId": target_id}

        if ops and stream_callback:
            _dbg("auto_create_video_shot: emitting structure_changed with %d ops", len(ops))
            stream_callback("state_changed", {"change": "structure_changed", "operations": ops})

        return result

    def _resolve_character_id(destination):
        """Resolve character name to charId. Auto-creates if not found. Returns {characterId} or {error}."""
        char_name = destination.get("characterName", "").strip()
        if not char_name:
            # Fall back to characterId if provided directly
            if destination.get("characterId"):
                return {"characterId": destination["characterId"]}
            return {"error": "Character destination requires characterName"}

        # Check existing gallery by name
        if idx:
            cid = idx.character_by_name.get(char_name.lower())
            if cid:
                _dbg("resolve_character: found %s -> %s", char_name, cid)
                return {"characterId": cid}

        # Check auto-created cache
        with _lock:
            cached_id = _created_characters.get(char_name.lower())
            if cached_id:
                return {"characterId": cached_id}

            # Auto-create character
            char_id = f"char_{_new_id()[:8]}"
            _created_characters[char_name.lower()] = char_id

        if stream_callback:
            _dbg("resolve_character: auto-creating %s -> %s", char_name, char_id)
            stream_callback("state_changed", {
                "change": "structure_changed",
                "operations": [{"action": "add_character", "characterId": char_id, "name": char_name}],
            })

        return {"characterId": char_id}

    def load_skill(name: str) -> dict:
        """Load a skill, sub-skill, or knowledge file by path.
        Skills are listed in your system instructions under Available Skills.
        Load the relevant skill before doing domain-specific work.

        Examples:
          load_skill("storyboard-generation")              -- full skill with related knowledge
          load_skill("storyboard-generation/continuity")   -- single reference file
          load_skill("_shared/project-style-keywords")     -- shared knowledge file
        """
        _dbg("load_skill: %s", name)
        t0 = time.time()
        content = skill_loader.load(name)
        if content is None:
            result = {"success": False, "error": f"Skill '{name}' not found"}
            if tracer:
                tracer.add("fc_tool_result", {"name": "load_skill", "args": {"name": name},
                    "duration_ms": int((time.time() - t0) * 1000), "success": False})
            return result
        _dbg("load_skill: %s loaded (%d chars)", name, len(content))
        if tracer:
            tracer.add("fc_tool_result", {"name": "load_skill", "args": {"name": name},
                "duration_ms": int((time.time() - t0) * 1000), "success": True,
                "result_chars": len(content), "content": content})
        return {"success": True, "content": content}

    def get_project_context(sections: dict) -> dict:
        """Get project context by section. Pass a dict of section names with scope filters.

        Sections: script, storyboard, characters, supplementary, videos, notes
        Scope filters vary by section (see the context-access guide above).

        Example: {"script": {"scene": 1}, "characters": {}, "storyboard": {"scene": 1}}
        """
        _dbg("get_project_context: sections=%s", list(sections.keys()))
        t0 = time.time()
        if not idx:
            result = {"success": False, "error": "No project data available"}
            if tracer:
                tracer.add("fc_tool_result", {"name": "get_project_context", "args": {"sections": list(sections.keys())},
                    "duration_ms": int((time.time() - t0) * 1000), "success": False})
            return result
        result = _get_context(idx, sections)
        result["_note"] = "This context is a point-in-time snapshot. It may be stale if there are parallel agent processes or user operations since this was fetched."
        _dbg("get_project_context: returned %d chars", len(result.get("context", "")))
        if tracer:
            tracer.add("fc_tool_result", {"name": "get_project_context", "args": {"sections": list(sections.keys())},
                "duration_ms": int((time.time() - t0) * 1000), "success": True,
                "result_chars": len(result.get("context", "")), "content": result.get("context", "")})
        return result

    def generate_image(
        prompt: str,
        provider: str,
        destination: dict,
        aspect_ratio: str = "horizontal",
        reference_images: list = None,
        image_size: str = "2K",
        versions: int = 1,
        provider_config: dict = None,
        wait_for_result: bool = False,
    ) -> dict:
        """Generate images. Results appear in the project automatically.

        Args:
            prompt: Image generation prompt.
            provider: Must be 'nano_banana'.
            destination: Where the result goes. Dict with 'type' key:
                - Shot frame: {"type": "shot", "sceneNumber": 3, "shotNumber": 1, "frameNumber": 1}
                  Scene/shot created if they don't exist yet.
                - Character: {"type": "character", "characterName": "Kai", "characterType": "turnaround" or "variation"}
                  Character created if not in gallery yet.
                - Supplementary: {"type": "supplementary", "title": "...", "category": "..."}. Add "sceneNumber"/"shotNumber" to link to a shot.
                - Standalone: {"type": "standalone"}
            aspect_ratio: 'horizontal', 'vertical', 'square', or ratio like '16:9'.
            reference_images: URLs of reference images (max 14 for nano_banana).
            image_size: '1K', '2K', '4K'.
            versions: Number of versions to generate (1-4).
            provider_config: Provider-specific params (reserved for future use).
            wait_for_result: If True, waits for completion and returns the result. If False (default), returns immediately after submission.
        """
        _dbg("generate_image: provider=%s dest=%s aspect=%s versions=%d wait=%s prompt=%.80s",
             provider, destination, aspect_ratio, versions, wait_for_result, prompt)

        if not clients:
            return {"success": False, "error": "Generation clients not available"}

        valid_providers = ("nano_banana",)
        if provider not in valid_providers:
            return {"success": False, "error": f"Invalid provider '{provider}'. Must be one of: {valid_providers}"}

        client = clients.get(provider)
        if not client:
            return {"success": False, "error": f"Client for '{provider}' not initialized"}

        # Validate destination
        dest_type = destination.get("type")
        valid_dest = ("shot", "character", "supplementary", "standalone")
        if dest_type not in valid_dest:
            return {"success": False, "error": f"Invalid destination type '{dest_type}'. Must be one of: {valid_dest}"}

        # Resolve scene/shot numbers to UUIDs (agent sees numbers, frontend needs UUIDs)
        if dest_type == "shot":
            resolved = _resolve_shot_ids(idx, destination)
            if resolved.get("error"):
                resolved = _auto_create_shot(destination)
                if resolved.get("error"):
                    return {"success": False, "error": resolved["error"]}
            destination = {**destination, **resolved}

        if dest_type == "shot" and (not destination.get("sceneId") or not destination.get("shotId")):
            return {"success": False, "error": "Shot destination requires sceneNumber and shotNumber"}
        if dest_type == "character":
            resolved = _resolve_character_id(destination)
            if resolved.get("error"):
                return {"success": False, "error": resolved["error"]}
            destination = {**destination, **resolved}

        versions = max(1, min(4, versions))
        provider_config = provider_config or {}

        # Map destination type to source field for task routing
        source = dest_type

        # Build config matching frontend formState structure
        config_dict = {"providers": [provider], "imageRatio": aspect_ratio}

        if provider == "nano_banana":
            config_dict["nanoSize"] = image_size
            if reference_images:
                config_dict["referenceImages"] = reference_images

        # Merge destination-specific fields
        if dest_type == "character":
            config_dict["characterId"] = destination.get("characterId")
            config_dict["characterType"] = destination.get("characterType", "variation")
        elif dest_type == "supplementary":
            if destination.get("sceneNumber") and destination.get("shotNumber"):
                resolved = _resolve_shot_ids(idx, destination)
                if resolved.get("error"):
                    resolved = _auto_create_shot(destination)
                if not resolved.get("error"):
                    destination = {**destination, **resolved}
            config_dict["_source"] = "supplementary"
            config_dict["title"] = destination.get("title")
            config_dict["description"] = destination.get("description")
            config_dict["category"] = destination.get("category")
            config_dict["sceneId"] = destination.get("sceneId")
            config_dict["shotId"] = destination.get("shotId")

        # Sign gs:// URIs so providers receive valid HTTPS URLs
        if reference_images:
            reference_images = [sign_url(u) for u in reference_images]

        task_ids = []
        errors = []

        for v in range(versions):
            try:
                result = client.generate_image(
                        prompt=prompt,
                        aspect_ratio=aspect_ratio,
                        reference_images=reference_images,
                        image_size=image_size,
                    )
                _dbg("client.generate_image v%d result: %s", v + 1, result)

                if not result.get("success"):
                    errors.append(result.get("error", "Unknown error"))
                    continue

                task_id = result["task_id"]
                task_ids.append(str(task_id))

                # Emit state_changed so frontend starts polling
                if stream_callback:
                    task_entry = {
                        "change": "task_submitted",
                        "taskId": str(task_id),
                        "provider": provider,
                        "version": v + 1,
                        "status": "submitted",
                        "startTime": int(time.time() * 1000),
                        "prompt": prompt,
                        "config": config_dict,
                        "source": source,
                        "origin": "agent",
                        "projectType": "storyboard",
                        "projectName": project_name,
                        "sceneId": destination.get("sceneId"),
                        "shotId": destination.get("shotId"),
                        "frameNumber": destination.get("frameNumber", 1),
                        "isVideoShot": False,
                    }
                    _dbg("emitting state_changed: taskId=%s source=%s sceneId=%s shotId=%s",
                         task_entry["taskId"], source, task_entry["sceneId"], task_entry["shotId"])
                    stream_callback("state_changed", task_entry)

            except Exception as e:
                logger.error("[Agent] generate_image error: %s", e)
                errors.append(str(e))

        if not task_ids:
            _dbg("generate_image: no tasks submitted. errors=%s", errors)
            if tracer:
                tracer.add("fc_tool_result", {"name": "generate_image", "provider": provider,
                    "success": False, "errors": errors})
            return {"success": False, "error": "; ".join(errors) if errors else "No tasks submitted"}

        # Blocking wait: poll until completion
        if wait_for_result and task_ids:
            _dbg("generate_image: waiting for %d tasks", len(task_ids))
            results = []
            for tid in task_ids:
                poll_result = client.wait_for_completion(tid)
                _dbg("wait_for_completion %s: %s", tid, poll_result.get("status"))
                task_result = {
                    "task_id": tid,
                    "status": poll_result.get("status", "unknown"),
                    "error": poll_result.get("error"),
                }
                result_url = poll_result.get("result_url") or poll_result.get("url")
                if result_url:
                    bp = url_to_blob_path(result_url)
                    gs_uri = blob_path_to_gs_uri(bp) if bp != result_url else result_url
                    task_result["url"] = gs_uri
                    if AGENT_MULTIMODAL_IMAGES and gs_uri.startswith("gs://"):
                        task_result["multimodal_response"] = {
                            "images": [{"file_uri": gs_uri, "mime_type": "image/png",
                                        "description": f"Generated image (task {tid})"}]
                        }
                results.append(task_result)
            return {"success": True, "tasks_submitted": len(task_ids), "task_ids": task_ids, "results": results}

        _dbg("generate_image: submitted %d tasks: %s", len(task_ids), task_ids)
        result = {"success": True, "tasks_submitted": len(task_ids), "task_ids": task_ids}
        if tracer:
            tracer.add("generation_submitted", {"tool": "generate_image", "provider": provider,
                "task_ids": task_ids, "destination": destination.get("type")})
        return result

    def generate_video(
        prompt: str,
        destination: dict,
        aspect_ratio: str = "16:9",
        start_frame_url: str = None,
        end_frame_url: str = None,
        size: str = "1080p",
        versions: int = 1,
        wait_for_result: bool = False,
    ) -> dict:
        """Generate video using Veo via Google GenAI SDK. Results appear in the project automatically.

        Args:
            prompt: Video generation prompt.
            destination: Where the result goes: {"type": "video_shot", "sceneNumber": 3, "shotNumber": 1}.
                Scene/video_shot created if they don't exist yet.
            aspect_ratio: '16:9' or '9:16'.
            start_frame_url: URL of first frame (optional, for img2video).
            end_frame_url: URL of last frame (optional, for dual-frame).
            size: '720p' or '1080p'.
            versions: Number of versions (1-4).
            wait_for_result: If True, waits for completion and returns the result.
        """
        _dbg("generate_video: dest=%s aspect=%s size=%s versions=%d wait=%s prompt=%.80s",
             destination, aspect_ratio, size, versions, wait_for_result, prompt)

        if not clients:
            return {"success": False, "error": "Generation clients not available"}

        client = clients.get("veo")
        if not client:
            return {"success": False, "error": "Veo client not initialized"}

        dest_type = destination.get("type")
        if dest_type != "video_shot":
            return {"success": False, "error": f"Invalid destination type '{dest_type}'. Must be 'video_shot'"}

        # Resolve scene/shot numbers to UUIDs
        resolved = _resolve_video_shot_ids(idx, destination)
        if resolved.get("error"):
            resolved = _auto_create_video_shot(destination)
            if resolved.get("error"):
                return {"success": False, "error": resolved["error"]}
        destination = {**destination, **resolved}

        if not destination.get("sceneId") or not destination.get("shotId"):
            return {"success": False, "error": "video_shot destination requires sceneNumber and shotNumber"}

        # Sign gs:// URIs so the video provider receives valid HTTPS URLs
        if start_frame_url:
            start_frame_url = sign_url(start_frame_url)
        if end_frame_url:
            end_frame_url = sign_url(end_frame_url)

        versions = max(1, min(4, versions))
        config_dict = {
            "providers": ["veo"],
            "veoSize": size,
            "veoRatio": aspect_ratio,
        }
        if start_frame_url:
            config_dict["startFrameUrl"] = start_frame_url
        if end_frame_url:
            config_dict["endFrameUrl"] = end_frame_url

        task_ids = []
        errors = []

        for v in range(versions):
            try:
                result = client.generate_video(
                    prompt=prompt,
                    first_frame_url=start_frame_url,
                    last_frame_url=end_frame_url,
                    aspect_ratio=aspect_ratio,
                    size=size,
                )

                _dbg("client.generate_video v%d result: %s", v + 1, result)

                if not result.get("success"):
                    errors.append(result.get("error", "Unknown error"))
                    continue

                task_id = result["task_id"]
                task_ids.append(str(task_id))

                if stream_callback:
                    task_entry = {
                        "change": "task_submitted",
                        "taskId": str(task_id),
                        "provider": "veo",
                        "version": v + 1,
                        "status": "submitted",
                        "startTime": int(time.time() * 1000),
                        "prompt": prompt,
                        "config": config_dict,
                        "source": "video_shot",
                        "origin": "agent",
                        "projectType": "storyboard",
                        "projectName": project_name,
                        "sceneId": destination.get("sceneId"),
                        "shotId": destination.get("shotId"),
                        "isVideoShot": True,
                    }
                    _dbg("emitting state_changed: taskId=%s source=video_shot sceneId=%s shotId=%s",
                         task_entry["taskId"], task_entry["sceneId"], task_entry["shotId"])
                    stream_callback("state_changed", task_entry)

            except Exception as e:
                logger.error("[Agent] generate_video error: %s", e)
                errors.append(str(e))

        if not task_ids:
            _dbg("generate_video: no tasks submitted. errors=%s", errors)
            if tracer:
                tracer.add("fc_tool_result", {"name": "generate_video", "provider": "veo",
                    "success": False, "errors": errors})
            return {"success": False, "error": "; ".join(errors) if errors else "No tasks submitted"}

        if wait_for_result and task_ids:
            _dbg("generate_video: waiting for %d tasks", len(task_ids))
            results = []
            for tid in task_ids:
                poll_result = client.wait_for_completion(tid)
                _dbg("wait_for_completion %s: %s", tid, poll_result.get("status"))
                task_result = {
                    "task_id": tid,
                    "status": poll_result.get("status", "unknown"),
                    "error": poll_result.get("error"),
                }
                result_url = poll_result.get("result_url") or poll_result.get("url")
                if result_url:
                    bp = url_to_blob_path(result_url)
                    gs_uri = blob_path_to_gs_uri(bp) if bp != result_url else result_url
                    task_result["url"] = gs_uri
                    if AGENT_MULTIMODAL_VIDEOS and gs_uri.startswith("gs://"):
                        task_result["multimodal_response"] = {
                            "images": [{"file_uri": gs_uri, "mime_type": "video/mp4",
                                        "description": f"Generated video (task {tid})"}]
                        }
                results.append(task_result)
            return {"success": True, "tasks_submitted": len(task_ids), "task_ids": task_ids, "results": results}

        _dbg("generate_video: submitted %d tasks: %s", len(task_ids), task_ids)
        result = {"success": True, "tasks_submitted": len(task_ids), "task_ids": task_ids}
        if tracer:
            tracer.add("generation_submitted", {"tool": "generate_video", "provider": "veo",
                "task_ids": task_ids, "destination": destination.get("type")})
        return result

    def modify_project(operations: list) -> dict:
        """Modify project structure. Operations applied in order.

        Args:
            operations: List of operation dicts. Each has 'action' key:
                {"action": "add_scene", "title": "...", "description": "..."}
                {"action": "add_shot", "sceneNumber": 3, "description": "..."}
                {"action": "add_video_shot", "sceneNumber": 3, "description": "..."}
                {"action": "update_scene", "sceneNumber": 3, "title": "...", "description": "..."}
                {"action": "update_shot", "sceneNumber": 3, "shotNumber": 1, "description": "..."}
                {"action": "add_character", "name": "Kai"}
        """
        _dbg("modify_project: %d operations", len(operations))

        if not operations:
            return {"success": False, "error": "No operations provided"}

        emit_ops = []
        results = []

        with _lock:
            for op in operations:
                action = op.get("action")

                if action == "add_scene":
                    scene_num = op.get("sceneNumber")
                    if not scene_num:
                        scene_num = (max(idx.scenes_by_number.keys()) + 1) if (idx and idx.scenes_by_number) else (max(_created.keys()) + 1 if _created else 1)
                    scene_id = _new_id()
                    shot_id = _new_id()
                    _created[scene_num] = {"sceneId": scene_id, "shots": {1: shot_id}, "video_shots": {}}
                    emit_op = {"action": "add_scene", "sceneId": scene_id, "sceneNumber": scene_num, "shotId": shot_id}
                    if op.get("title"):
                        emit_op["title"] = op["title"]
                    if op.get("description"):
                        emit_op["description"] = op["description"]
                    emit_ops.append(emit_op)
                    results.append({"action": action, "sceneId": scene_id, "sceneNumber": scene_num, "shotId": shot_id})

                elif action == "add_shot":
                    scene_num = int(op.get("sceneNumber", 0))
                    if not scene_num:
                        results.append({"action": action, "error": "sceneNumber required"})
                        continue
                    # Find scene ID from idx or _created
                    scene = idx.scenes_by_number.get(scene_num) if idx else None
                    scene_id = str(scene.get("id")) if scene else (_created.get(scene_num, {}).get("sceneId"))
                    if not scene_id:
                        results.append({"action": action, "error": f"Scene {scene_num} not found"})
                        continue
                    shot_num = op.get("shotNumber")
                    if not shot_num:
                        existing_shots = len(scene.get("shots", [])) if scene else len(_created.get(scene_num, {}).get("shots", {}))
                        shot_num = existing_shots + 1
                    shot_id = _new_id()
                    _created.setdefault(scene_num, {"sceneId": scene_id, "shots": {}, "video_shots": {}})
                    _created[scene_num]["shots"][shot_num] = shot_id
                    emit_op = {"action": "add_shot", "sceneId": scene_id, "shotId": shot_id, "shotNumber": shot_num}
                    if op.get("description"):
                        emit_op["description"] = op["description"]
                    emit_ops.append(emit_op)
                    results.append({"action": action, "sceneId": scene_id, "shotId": shot_id, "shotNumber": shot_num})

                elif action == "add_video_shot":
                    scene_num = int(op.get("sceneNumber", 0))
                    if not scene_num:
                        results.append({"action": action, "error": "sceneNumber required"})
                        continue
                    scene = idx.scenes_by_number.get(scene_num) if idx else None
                    scene_id = str(scene.get("id")) if scene else (_created.get(scene_num, {}).get("sceneId"))
                    if not scene_id:
                        results.append({"action": action, "error": f"Scene {scene_num} not found"})
                        continue
                    shot_num = op.get("shotNumber")
                    if not shot_num:
                        existing_vshots = len(scene.get("video_shots", [])) if scene else len(_created.get(scene_num, {}).get("video_shots", {}))
                        shot_num = existing_vshots + 1
                    vshot_id = _new_id()
                    _created.setdefault(scene_num, {"sceneId": scene_id, "shots": {}, "video_shots": {}})
                    _created[scene_num]["video_shots"][shot_num] = vshot_id
                    emit_op = {"action": "add_video_shot", "sceneId": scene_id, "shotId": vshot_id, "shotNumber": shot_num}
                    if op.get("description"):
                        emit_op["description"] = op["description"]
                    emit_ops.append(emit_op)
                    results.append({"action": action, "sceneId": scene_id, "shotId": vshot_id, "shotNumber": shot_num})

                elif action == "update_scene":
                    scene_num = int(op.get("sceneNumber", 0))
                    if not scene_num:
                        results.append({"action": action, "error": "sceneNumber required"})
                        continue
                    scene = idx.scenes_by_number.get(scene_num) if idx else None
                    scene_id = str(scene.get("id")) if scene else (_created.get(scene_num, {}).get("sceneId"))
                    if not scene_id:
                        results.append({"action": action, "error": f"Scene {scene_num} not found"})
                        continue
                    updates = {k: v for k, v in op.items() if k not in ("action", "sceneNumber")}
                    emit_ops.append({"action": "update_scene", "sceneId": scene_id, "updates": updates})
                    results.append({"action": action, "sceneId": scene_id})

                elif action == "update_shot":
                    scene_num = int(op.get("sceneNumber", 0))
                    shot_num = int(op.get("shotNumber", 0))
                    if not scene_num or not shot_num:
                        results.append({"action": action, "error": "sceneNumber and shotNumber required"})
                        continue
                    scene = idx.scenes_by_number.get(scene_num) if idx else None
                    scene_id = str(scene.get("id")) if scene else (_created.get(scene_num, {}).get("sceneId"))
                    shot = idx.shots_by_key.get(f"{scene_num}_{shot_num}") if idx else None
                    shot_id = str(shot.get("id")) if shot else (_created.get(scene_num, {}).get("shots", {}).get(shot_num))
                    if not scene_id or not shot_id:
                        results.append({"action": action, "error": f"Scene {scene_num} shot {shot_num} not found"})
                        continue
                    updates = {k: v for k, v in op.items() if k not in ("action", "sceneNumber", "shotNumber")}
                    emit_ops.append({"action": "update_shot", "sceneId": scene_id, "shotId": shot_id, "updates": updates})
                    results.append({"action": action, "sceneId": scene_id, "shotId": shot_id})

                elif action == "add_character":
                    char_name = op.get("name", "").strip()
                    if not char_name:
                        results.append({"action": action, "error": "name required"})
                        continue
                    # Check if already exists
                    existing = idx.character_by_name.get(char_name.lower()) if idx else None
                    cached = _created_characters.get(char_name.lower())
                    if existing:
                        results.append({"action": action, "characterId": existing, "note": "already exists"})
                        continue
                    if cached:
                        results.append({"action": action, "characterId": cached, "note": "already created"})
                        continue
                    char_id = f"char_{_new_id()[:8]}"
                    _created_characters[char_name.lower()] = char_id
                    emit_ops.append({"action": "add_character", "characterId": char_id, "name": char_name})
                    results.append({"action": action, "characterId": char_id})

                else:
                    results.append({"action": action, "error": f"Unknown action '{action}'"})

        if emit_ops and stream_callback:
            _dbg("modify_project: emitting structure_changed with %d ops", len(emit_ops))
            stream_callback("state_changed", {"change": "structure_changed", "operations": emit_ops})

        return {"success": True, "results": results}

    # modify_project: kept as internal utility (auto-create uses shared _created/_lock)
    # but not exposed to agent -- auto-create handles structural scaffolding transparently.

    # Sub-agent concurrency enforcement (per make_tools call = per request)
    _sub_agent_count = 0
    _sub_agent_lock = threading.Lock()

    def _scope_display(scope):
        """Human-readable label for sub-agent scope."""
        if not scope:
            return "Full Project"
        if "shot" in scope:
            s = scope["shot"]
            return f"Scene {s[0]}, Shot {s[1]}" if isinstance(s, (list, tuple)) else f"Shot {s}"
        if "scene" in scope:
            return f"Scene {scope['scene']}"
        if "character" in scope:
            return f"Character: {scope['character']}"
        return "Sub-agent"

    # ------------------------------------------------------------------
    # edit_video -- post-production editing via FFmpeg
    # Completes the multimodal pipeline: script -> storyboard -> video -> edit
    # ------------------------------------------------------------------

    def edit_video(editing_plan: dict) -> dict:
        """Execute video editing from an editing plan.

        Combines generated video clips with transitions, trimming, and audio mixing
        into a final edited video. The agent creates the editing plan by analyzing
        clips through Gemini's native video understanding, then calls this tool
        to execute the FFmpeg pipeline.

        Args:
            editing_plan: JSON with selected_videos, transitions, audio settings,
                         aspect_ratio. Schema defined in video-editing skill.
                         selected_videos: [{filename, trim, mute_audio}]
                         transitions: [{from, to, type, duration}]
                         aspect_ratio: vertical | horizontal | square
                         add_audio: bool
                         selected_audio: track name or null
                         audio_volume: 0.0-1.0
        Returns:
            {success, url, edit_name, clips_used, transitions_applied}
        """
        _dbg("edit_video: plan keys=%s", list(editing_plan.keys()) if isinstance(editing_plan, dict) else "not dict")

        if not isinstance(editing_plan, dict):
            return {"success": False, "error": "editing_plan must be a dict"}

        from .tools_editing import combine_videos_with_transitions, add_audio_to_video, prepare_media_for_ffmpeg

        selected = editing_plan.get("selected_videos", [])
        if not selected:
            return {"success": False, "error": "No videos selected in editing plan"}

        # Resolve filenames to GCS URLs from project context
        if not idx:
            return {"success": False, "error": "No project context available"}

        # Build video specs with URLs from project state
        video_specs = []
        video_shots = idx.raw.get("video_shots", {}) if idx.raw else {}

        # Collect all video results from project for filename matching
        all_videos = {}
        for scene in (idx.scenes or []):
            scene_num = scene.get("number", 0)
            for shot in scene.get("video_shots", scene.get("shots", [])):
                shot_num = shot.get("number", 0)
                for result in shot.get("results", []):
                    url = result.get("url") or result.get("content_url")
                    if url:
                        version = result.get("version", 1)
                        fname = f"sc{scene_num:02d}_sh{shot_num:02d}_video_v{version}.mp4"
                        all_videos[fname] = url

        for spec in selected:
            fname = spec.get("filename", "")
            url = all_videos.get(fname)
            if not url:
                # Fuzzy match: try any video with matching scene/shot
                import re
                m = re.match(r'sc(\d+)_sh(\d+)', fname)
                if m:
                    prefix = f"sc{int(m.group(1)):02d}_sh{int(m.group(2)):02d}"
                    for k, v in all_videos.items():
                        if k.startswith(prefix):
                            url = v
                            fname = k
                            break
            if not url:
                _dbg("edit_video: no URL found for %s, available: %s", fname, list(all_videos.keys()))
                continue

            video_specs.append({
                "url": sign_url(url),
                "filename": fname,
                "trim": spec.get("trim"),
                "mute_audio": spec.get("mute_audio"),
            })

        if not video_specs:
            return {"success": False, "error": f"No video URLs resolved. Available: {list(all_videos.keys())}"}

        # Parse transitions
        transitions = {}
        transition_durations = {}
        for t in editing_plan.get("transitions", []):
            key = (t.get("from"), t.get("to"))
            transitions[key] = t.get("type", "fade")
            transition_durations[key] = t.get("duration", 0.5)

        aspect = editing_plan.get("aspect_ratio", "vertical")
        add_audio = editing_plan.get("add_audio", False)

        import tempfile
        use_audio = add_audio and editing_plan.get("selected_audio")

        if use_audio:
            fd, temp_path = tempfile.mkstemp(suffix=".mp4", prefix="edited_")
            import os
            os.close(fd)
            output_path = temp_path
        else:
            output_path = None

        # Combine clips
        combine_result = combine_videos_with_transitions(
            video_specs=video_specs,
            transitions=transitions,
            transition_durations=transition_durations,
            output_path=output_path,
            aspect_ratio=aspect,
            process_audio=use_audio,
        )

        if combine_result.get("status") != "success":
            return {"success": False, "error": combine_result.get("message", "FFmpeg combine failed")}

        # Audio mixing if requested
        final_path = output_path
        if use_audio:
            audio_name = editing_plan.get("selected_audio", "")
            # Find audio URL from project context
            audio_url = None
            for track in (idx.raw or {}).get("generated_audio", []):
                if track.get("name") == audio_name and track.get("url"):
                    audio_url = sign_url(track["url"])
                    break

            if audio_url:
                audio_result = add_audio_to_video(
                    video_path=output_path,
                    audio_path=audio_url,
                    audio_volume=editing_plan.get("audio_volume", 0.7),
                    mix_original=True,
                )
                if audio_result.get("status") == "success":
                    final_path = audio_result["output_path"]

        # Upload to GCS
        edit_name = editing_plan.get("edit_name", "edit")
        if use_audio and final_path:
            with open(final_path, "rb") as f:
                video_bytes = f.read()
            # Cleanup temp files
            import os
            for p in [output_path, final_path]:
                if p and os.path.exists(p):
                    try:
                        os.unlink(p)
                    except Exception:
                        pass
        else:
            buffer = combine_result.get("output_buffer")
            if buffer:
                video_bytes = buffer.read()
            else:
                return {"success": False, "error": "No video output produced"}

        blob_name = f"storyboard/{project_name}/edited/{edit_name}_{_new_id()[:8]}.mp4"
        from google.cloud import storage as _storage
        from ..config import CREDENTIALS as _creds, BUCKET_NAME as _bucket
        try:
            client_storage = _storage.Client(credentials=_creds)
            bucket = client_storage.bucket(_bucket)
            blob = bucket.blob(blob_name)
            blob.upload_from_string(video_bytes, content_type="video/mp4")
            result_url = sign_url(blob_name)
        except Exception as e:
            return {"success": False, "error": f"GCS upload failed: {e}"}

        # Emit state change so frontend can display the edited video
        if stream_callback:
            stream_callback('state_changed', {
                'type': 'edited_video',
                'url': result_url,
                'name': edit_name,
                'clips_used': len(video_specs),
                'transitions_applied': len(transitions),
            })

        if tracer:
            tracer.add("fc_tool_result", {
                "name": "edit_video", "clips": len(video_specs),
                "transitions": len(transitions), "audio": use_audio,
            })

        return {
            "success": True,
            "url": result_url,
            "edit_name": edit_name,
            "clips_used": len(video_specs),
            "transitions_applied": len(transitions),
            "audio_mixed": use_audio,
        }

    # ------------------------------------------------------------------
    # generate_audio -- music generation for the creative pipeline
    # ------------------------------------------------------------------

    def generate_audio(prompt: str, name: str, duration_seconds: int = 60) -> dict:
        """Generate background music for video production.

        Creates a cohesive music track matching the script's emotional arc.
        Part of the interleaved multimodal pipeline -- audio complements
        generated visuals and narration for complete creative output.

        Args:
            prompt: Natural language description of desired music
                   (genre, BPM, instruments, mood, production style).
            name: Track name without extension (filesystem-safe).
            duration_seconds: Lyria 2 outputs fixed 30-second tracks.
        Returns:
            {success, url, name, duration_seconds} or {success: false, error}
        """
        _dbg("generate_audio: name=%s duration=%d prompt=%.80s", name, duration_seconds, prompt)

        if not clients:
            return {"success": False, "error": "Generation clients not available"}

        lyria = clients.get("lyria")
        if not lyria:
            return {"success": False, "error": "Audio generation client not initialized."}

        try:
            result = lyria.generate_music(
                prompt=prompt,
                name=name,
                duration_seconds=duration_seconds,
            )

            if not result.get("success"):
                return {"success": False, "error": result.get("error", "Music generation failed")}

            task_id = result["task_id"]
            # Wait for completion
            final = lyria.wait_for_completion(task_id)

            if final.get("status") == "succeed":
                url = final.get("result_url", "")
                if stream_callback:
                    stream_callback('state_changed', {
                        'type': 'audio_generated',
                        'url': url,
                        'name': name,
                        'duration_seconds': final.get('duration_seconds', 30),
                    })
                return {
                    "success": True,
                    "url": url,
                    "name": name,
                    "duration_seconds": duration_seconds,
                }
            else:
                return {"success": False, "error": final.get("error", "Generation failed")}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def run_sub_agent(task: str, scope: dict = None, skills: list = None) -> dict:
        """Delegate a focused production task to a specialist sub-agent.
        The sub-agent has the same generation tools but works with narrowed context
        and a pre-loaded skill.

        Args:
            task: Clear, self-contained description of what to accomplish.
            scope: Narrows context. Examples: {"scene": 3}, {"shot": [3, 1]},
                   {"character": "Kai"}, or None for full project.
            skills: Domain skills to pre-load (auto-inferred from scope if omitted).
        """
        nonlocal _sub_agent_count

        with _sub_agent_lock:
            if _sub_agent_count >= MAX_PARALLEL_SUB_AGENTS:
                return {"success": False, "error": f"Max parallel sub-agents ({MAX_PARALLEL_SUB_AGENTS}) reached"}
            _sub_agent_count += 1

        t0 = time.time()
        sub_id = f"sub_{_new_id()[:8]}"
        scope_label = _scope_display(scope)
        _dbg("run_sub_agent: task=%s scope=%s skills=%s", task[:80], scope_label, skills)

        if tracer:
            tracer.add("subagent_start", {"task": task, "scope": scope, "skills": skills})

        if stream_callback:
            stream_callback('sub_agent_event', {
                'sub_agent_id': sub_id, 'scope': scope_label,
                'event': 'start', 'task': task[:100],
            })

        try:
            # Determine skills to pre-inject
            pre_inject_skills = list(skills) if skills else []
            if not pre_inject_skills and scope:
                for key in scope:
                    mapped = _SCOPE_SKILL_MAP.get(key)
                    if mapped:
                        pre_inject_skills.append(mapped)
                        break
            if "context-access" not in pre_inject_skills:
                pre_inject_skills.insert(0, "context-access")

            # Filtered callback: pass state_changed and relay tool_call as sub_agent_event
            def sub_cb(evt, data):
                if evt == 'state_changed':
                    stream_callback(evt, data)
                elif evt == 'tool_call':
                    stream_callback('sub_agent_event', {
                        'sub_agent_id': sub_id, 'scope': scope_label,
                        'event': 'tool_call',
                        'name': data.get('name', '') if isinstance(data, dict) else '',
                    })

            # Local import to avoid circular dependency
            from .runtime import handle_agent_chat
            result = handle_agent_chat(
                message=task,
                is_sub_agent=True,
                scope=scope,
                pre_inject_skills=pre_inject_skills,
                conversation=None,
                conversation_contents=None,
                project_state=project_state,
                scenes=scenes,
                stream_callback=sub_cb if stream_callback else None,
                clients=clients,
                project_name=project_name,
                tracer=tracer,
            )

            duration = time.time() - t0
            _dbg("run_sub_agent complete: %.1fs, response=%d chars", duration, len(result.get("text", "")))

            if tracer:
                tracer.add("subagent_complete", {
                    "scope": scope,
                    "skills": pre_inject_skills,
                    "duration_ms": int(duration * 1000),
                    "response_chars": len(result.get("text", "")),
                })

            if stream_callback:
                stream_callback('sub_agent_event', {
                    'sub_agent_id': sub_id, 'scope': scope_label,
                    'event': 'complete',
                })

            return {"success": True, "result": result["text"]}

        except Exception as e:
            duration = time.time() - t0
            logger.error("run_sub_agent failed: %s (%.1fs)", e, duration)
            if tracer:
                tracer.add("subagent_complete", {
                    "scope": scope, "error": str(e),
                    "duration_ms": int(duration * 1000),
                })
            if stream_callback:
                stream_callback('sub_agent_event', {
                    'sub_agent_id': sub_id, 'scope': scope_label,
                    'event': 'error',
                })
            return {"success": False, "error": str(e)}

        finally:
            with _sub_agent_lock:
                _sub_agent_count -= 1

    # ------------------------------------------------------------------
    # write_script -- save script to project state
    # ------------------------------------------------------------------

    def write_script(script: dict) -> dict:
        """Save a generated script to the project.

        Writes the script JSON to project_state.generated_scripts and
        opens the script panel in the frontend. Call this instead of
        outputting the script as chat text.

        Args:
            script: Complete script object matching the output-schema
                   (script_details, production_notes, characters, audio_design).
        Returns:
            {success, title, scene_count}
        """
        _dbg("write_script: keys=%s", list(script.keys()) if isinstance(script, dict) else type(script))

        if not isinstance(script, dict):
            return {"success": False, "error": "script must be a JSON object"}

        # Validate minimum structure
        details = script.get("script_details", {})
        if not details:
            return {"success": False, "error": "script must contain script_details"}

        title = details.get("title", "Untitled")
        scenes = details.get("scenes", [])

        # Emit state change so frontend saves to project_state and opens script panel
        if stream_callback:
            stream_callback('state_changed', {
                'type': 'script_generated',
                'script': script,
            })

        return {
            "success": True,
            "title": title,
            "scene_count": len(scenes),
            "shot_count": sum(len(s.get("shots", [])) for s in scenes),
        }

    if is_sub_agent:
        return [load_skill, get_project_context, generate_image, generate_video, edit_video, generate_audio, write_script]
    return [load_skill, get_project_context, generate_image, generate_video, edit_video, generate_audio, write_script, run_sub_agent]
