"""Soulboard SSE streaming + REST endpoints -- interleaved visual exploration.

The art director's reasoning and image generation results stream as interleaved
SSE events: thinking output appears alongside generated visual options, creating
a fluid exploration experience. Multi-session support allows parallel exploration.

SSE pattern: background asyncio task runs execute_iteration(), pushes events to
asyncio.Queue, StreamingResponse drains as text/event-stream."""

import json
import asyncio
import logging
import uuid
from copy import deepcopy
from typing import Optional, Dict

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user, user_prefix as _user_prefix
from .agent import execute_iteration, apply_feedback, finalize_items
from .state import get_state, set_state, clear_state, create_session_metadata, create_initial_state, rebuild_item_index
from ..gcs_utils import (
    save_soulboard_state, load_soulboard_state,
    list_soulboard_sessions, delete_soulboard_session,
    sign_url,
)

logger = logging.getLogger(__name__)

soulboard_router = APIRouter(prefix="/api/soulboard", tags=["soulboard"])

# Track running iterations keyed by "project:session" so they can be interrupted
_running_tasks: Dict[str, asyncio.Task] = {}

# Limit concurrent iterations across all sessions
_iteration_semaphore = asyncio.Semaphore(3)


def _sign_state(sb_state: dict) -> dict:
    """Deep-copy soulboard state with all content_urls signed for frontend."""
    from copy import deepcopy
    out = deepcopy(sb_state)
    # Sign reference images
    config = out.get("session_config", {})
    config["reference_images"] = [sign_url(u) for u in config.get("reference_images", [])]
    # Sign content_urls, thumb_urls, medium_urls in iterations
    for iteration in out.get("iterations", []):
        for item in iteration.get("items", []):
            if item.get("content_url"):
                item["content_url"] = sign_url(item["content_url"])
            if item.get("thumb_url"):
                item["thumb_url"] = sign_url(item["thumb_url"])
            if item.get("medium_url"):
                item["medium_url"] = sign_url(item["medium_url"])
            gp = item.get("generation_params")
            if gp:
                if gp.get("reference_images"):
                    gp["reference_images"] = [sign_url(u) for u in gp["reference_images"] if u]
                if gp.get("style_reference"):
                    gp["style_reference"] = sign_url(gp["style_reference"])
                if gp.get("subject_reference"):
                    gp["subject_reference"] = sign_url(gp["subject_reference"])
    return out


# --- Request models ---

class CreateSessionRequest(BaseModel):
    query: str = ""
    context: str = "standalone"
    shot_id: Optional[str] = None
    character_id: Optional[str] = None

class StartRequest(BaseModel):
    query: str
    preferences: dict = {}
    reference_images: list = []
    project_state: Optional[dict] = None
    scenes: Optional[list] = None

class IterateRequest(BaseModel):
    message: Optional[str] = None
    reference_images: list = []
    preferences: dict = {}
    project_state: Optional[dict] = None
    scenes: Optional[list] = None

class FeedbackRequest(BaseModel):
    feedback: list  # [{"item_id": "sb_001", "action": "liked", "note": "..."}]

class FinalizeRequest(BaseModel):
    selected_items: list  # ["sb_001", "sb_003"]
    categories: dict = {}  # {"sb_001": {"content_type": "mood_board"}}

class ForkRequest(BaseModel):
    context: str = "standalone"
    shot_id: Optional[str] = None
    character_id: Optional[str] = None


# --- Helpers ---

def _task_key(project_name: str, session_id: str) -> str:
    return f"{project_name}:{session_id}"


def _iteration_in_flight(project_name: str, session_id: str) -> bool:
    key = _task_key(project_name, session_id)
    task = _running_tasks.get(key)
    return task is not None and not task.done()


async def _execute_and_persist(project_name: str, session_id: str, user_prefix: str = "", **kwargs):
    """Run execute_iteration with semaphore, then save state to GCS."""
    async with _iteration_semaphore:
        await execute_iteration(project_name=project_name, session_id=session_id, user_prefix=user_prefix, **kwargs)
    sb_state = get_state(project_name, session_id)
    if sb_state:
        sb_state["updated_at"] = __import__("datetime").datetime.now().isoformat()
        try:
            await asyncio.to_thread(save_soulboard_state, project_name, session_id, sb_state, user_prefix=user_prefix)
        except Exception as e:
            logger.warning(f"[Soulboard] GCS save failed for {project_name}/{session_id}: {e}")


async def _sse_stream(queue: asyncio.Queue):
    """Yield SSE events from the queue until a terminal event arrives."""
    try:
        while True:
            event = await asyncio.wait_for(queue.get(), timeout=300)
            data = json.dumps(event, default=str)
            yield f"data: {data}\n\n"
            if event.get("type") in ("iteration_complete", "error", "interrupted"):
                break
    except asyncio.TimeoutError:
        yield f"data: {json.dumps({'type': 'error', 'error': 'SSE timeout'})}\n\n"
    except asyncio.CancelledError:
        yield f"data: {json.dumps({'type': 'interrupted'})}\n\n"


# --- Session management endpoints ---

@soulboard_router.get("/{project_name}/sessions")
async def list_sessions(project_name: str, user: dict = Depends(get_current_user)):
    """List all soulboard sessions for a project."""
    sessions = await asyncio.to_thread(list_soulboard_sessions, project_name, user_prefix=_user_prefix(user))
    for s in sessions:
        s["thumbnail_urls"] = [sign_url(u) for u in s.get("thumbnail_urls", [])]
    return {"sessions": sessions}


@soulboard_router.post("/{project_name}/sessions")
async def create_session(project_name: str, req: CreateSessionRequest, user: dict = Depends(get_current_user)):
    """Create a new soulboard session. Returns session metadata."""
    logger.info(f"[Soulboard] create_session: context={req.context!r}, shot_id={req.shot_id!r}, character_id={req.character_id!r}, query={req.query[:50]!r}")
    session_id = f"sb_{uuid.uuid4().hex[:8]}"
    metadata = create_session_metadata(
        session_id=session_id,
        query=req.query,
        context=req.context,
        shot_id=req.shot_id,
        character_id=req.character_id,
    )
    initial_state = create_initial_state(
        session_id=session_id,
        query=req.query,
        context=req.context,
        shot_id=req.shot_id,
        character_id=req.character_id,
    )
    set_state(project_name, session_id, initial_state)
    await asyncio.to_thread(save_soulboard_state, project_name, session_id, initial_state, user_prefix=_user_prefix(user))
    return metadata


@soulboard_router.delete("/{project_name}/sessions/{session_id}")
async def delete_session(project_name: str, session_id: str, user: dict = Depends(get_current_user)):
    """Delete a soulboard session."""
    clear_state(project_name, session_id)
    key = _task_key(project_name, session_id)
    task = _running_tasks.pop(key, None)
    if task and not task.done():
        task.cancel()
    ok = await asyncio.to_thread(delete_soulboard_session, project_name, session_id, user_prefix=_user_prefix(user))
    return {"deleted": ok}


@soulboard_router.get("/{project_name}/sessions/{session_id}/state")
async def get_session_state(project_name: str, session_id: str, user: dict = Depends(get_current_user)):
    """Get session state. Falls back to GCS if not in memory."""
    sb_state = get_state(project_name, session_id)
    if sb_state is None:
        sb_state = await asyncio.to_thread(load_soulboard_state, project_name, session_id, user_prefix=_user_prefix(user))
        if sb_state:
            rebuild_item_index(sb_state)
            set_state(project_name, session_id, sb_state)
    if sb_state is None:
        return {"status": "no_session"}
    return _sign_state(sb_state)


@soulboard_router.post("/{project_name}/sessions/{session_id}/fork")
async def fork_session(project_name: str, session_id: str, req: ForkRequest, user: dict = Depends(get_current_user)):
    """Deep-copy a session under a new ID (for copy-on-modify)."""
    up = _user_prefix(user)
    # Load source session
    sb_state = get_state(project_name, session_id)
    if sb_state is None:
        sb_state = await asyncio.to_thread(load_soulboard_state, project_name, session_id, user_prefix=up)
    if sb_state is None:
        raise HTTPException(status_code=404, detail="Source session not found")

    new_id = f"sb_{uuid.uuid4().hex[:8]}"
    new_state = deepcopy(sb_state)
    new_state["session_id"] = new_id
    new_state["forked_from"] = session_id
    new_state["context"] = req.context
    new_state["shot_id"] = req.shot_id
    new_state["character_id"] = req.character_id

    set_state(project_name, new_id, new_state)
    await asyncio.to_thread(save_soulboard_state, project_name, new_id, new_state, user_prefix=up)

    return {
        "session_id": new_id,
        "forked_from": session_id,
    }


# --- SSE endpoints ---

@soulboard_router.post("/{project_name}/sessions/{session_id}/start")
async def start_iteration(project_name: str, session_id: str, req: StartRequest, user: dict = Depends(get_current_user)):
    """Start a new soulboard exploration. Returns SSE stream."""
    key = _task_key(project_name, session_id)
    if key in _running_tasks and not _running_tasks[key].done():
        raise HTTPException(status_code=409, detail="Generation already running")

    # Load session metadata — GCS fallback so any worker finds the state
    existing = get_state(project_name, session_id)
    if existing is None:
        existing = await asyncio.to_thread(load_soulboard_state, project_name, session_id, user_prefix=_user_prefix(user))
        if existing:
            rebuild_item_index(existing)
            set_state(project_name, session_id, existing)
    session_context = existing.get("context", "standalone") if existing else "standalone"
    session_shot_id = existing.get("shot_id") if existing else None
    session_character_id = existing.get("character_id") if existing else None

    queue = asyncio.Queue()

    async def send_event(event):
        await queue.put(event)

    task = asyncio.create_task(
        _execute_and_persist(
            project_name,
            session_id,
            user_prefix=_user_prefix(user),
            query=req.query,
            reference_images=req.reference_images or None,
            preferences=req.preferences or None,
            project_state=req.project_state,
            scenes=req.scenes,
            send_event=send_event,
            context=session_context,
            shot_id=session_shot_id,
            character_id=session_character_id,
        )
    )
    _running_tasks[key] = task

    return StreamingResponse(
        _sse_stream(queue),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@soulboard_router.post("/{project_name}/sessions/{session_id}/iterate")
async def iterate(project_name: str, session_id: str, req: IterateRequest, user: dict = Depends(get_current_user)):
    """Generate next iteration with optional feedback message. Returns SSE stream."""
    key = _task_key(project_name, session_id)
    if key in _running_tasks and not _running_tasks[key].done():
        raise HTTPException(status_code=409, detail="Generation already running")

    up = _user_prefix(user)
    # Always load from GCS — ensures correct state regardless of which worker handles this
    sb_state = await asyncio.to_thread(load_soulboard_state, project_name, session_id, user_prefix=up)
    if sb_state is None:
        sb_state = get_state(project_name, session_id)
    if sb_state:
        rebuild_item_index(sb_state)
        set_state(project_name, session_id, sb_state)
    if sb_state is None:
        raise HTTPException(status_code=404, detail="No active soulboard session")

    queue = asyncio.Queue()

    async def send_event(event):
        await queue.put(event)

    task = asyncio.create_task(
        _execute_and_persist(
            project_name,
            session_id,
            user_prefix=up,
            user_message=req.message,
            reference_images=req.reference_images,
            preferences=req.preferences or None,
            project_state=req.project_state,
            scenes=req.scenes,
            send_event=send_event,
        )
    )
    _running_tasks[key] = task

    return StreamingResponse(
        _sse_stream(queue),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- REST endpoints ---

@soulboard_router.post("/{project_name}/sessions/{session_id}/interrupt")
async def interrupt(project_name: str, session_id: str, user: dict = Depends(get_current_user)):
    """Cancel running generation."""
    key = _task_key(project_name, session_id)
    task = _running_tasks.get(key)
    if task and not task.done():
        task.cancel()
        return {"status": "interrupted"}
    return {"status": "no_task_running"}


@soulboard_router.post("/{project_name}/sessions/{session_id}/feedback")
async def submit_feedback(project_name: str, session_id: str, req: FeedbackRequest, user: dict = Depends(get_current_user)):
    """Apply like/dislike feedback to items."""
    up = _user_prefix(user)
    in_flight = _iteration_in_flight(project_name, session_id)

    if in_flight:
        # Task running on this worker — use in-memory to preserve same-dict-reference
        sb_state = get_state(project_name, session_id)
        if sb_state is None:
            sb_state = await asyncio.to_thread(load_soulboard_state, project_name, session_id, user_prefix=up)
            if sb_state:
                rebuild_item_index(sb_state)
                set_state(project_name, session_id, sb_state)
    else:
        # No generation on this worker — load authoritative state from GCS
        sb_state = await asyncio.to_thread(load_soulboard_state, project_name, session_id, user_prefix=up)
        if sb_state is None:
            sb_state = get_state(project_name, session_id)
        if sb_state:
            rebuild_item_index(sb_state)
            set_state(project_name, session_id, sb_state)

    if sb_state is None:
        raise HTTPException(status_code=404, detail="No active soulboard session")

    logger.info(f"[Soulboard] Feedback endpoint: session={session_id}, items={[f.get('item_id') + ':' + str(f.get('action')) for f in req.feedback]}")
    updated = apply_feedback(sb_state, req.feedback)
    set_state(project_name, session_id, sb_state)

    # During generation: in-memory only (task's final save will include feedback via shared dict).
    # After generation: save to GCS so feedback survives worker/instance switches.
    if in_flight:
        logger.info(f"[Soulboard] Feedback applied in-memory only (iteration in-flight), session={session_id}")
    else:
        await asyncio.to_thread(save_soulboard_state, project_name, session_id, sb_state, user_prefix=up)
        logger.info(f"[Soulboard] Feedback saved to GCS: {updated} updated, session={session_id}")
    return {"updated": updated}


@soulboard_router.post("/{project_name}/sessions/{session_id}/finalize")
async def finalize(project_name: str, session_id: str, req: FinalizeRequest, user: dict = Depends(get_current_user)):
    """Finalize selected items. Returns item data for frontend to write to project."""
    up = _user_prefix(user)
    sb_state = get_state(project_name, session_id)
    if sb_state is None:
        sb_state = await asyncio.to_thread(load_soulboard_state, project_name, session_id, user_prefix=up)
        if sb_state:
            rebuild_item_index(sb_state)
            set_state(project_name, session_id, sb_state)
    if sb_state is None:
        raise HTTPException(status_code=404, detail="No active soulboard session")

    items = finalize_items(sb_state, req.selected_items, req.categories)
    set_state(project_name, session_id, sb_state)

    if _iteration_in_flight(project_name, session_id):
        logger.info(f"[Soulboard] Finalize applied in-memory only (iteration in-flight), session={session_id}")
    else:
        await asyncio.to_thread(save_soulboard_state, project_name, session_id, sb_state, user_prefix=up)
    return {"items": items, "count": len(items)}
