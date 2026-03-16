"""Agent SSE streaming + REST endpoints -- interleaved multimodal delivery.

SSE streams interleave text tokens, thinking output, tool calls, and state_changed
events (image/video/audio generation results) into a single event stream. The
frontend renders these concurrently: text flows into the chat while generated assets
appear in the timeline -- creating a fluid, non-turn-based creative experience.

Trace integration: creates TraceCollector per request when AGENT_TRACE is on.
"""

import asyncio
import json
import threading
import time
import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..config import AGENT_DEBUG, AGENT_TRACE
from ..auth import get_current_user
from .runtime import handle_agent_chat

logger = logging.getLogger(__name__)

agent_router = APIRouter(prefix="/api/agent", tags=["agent"])

_running_tasks = {}
_semaphore = asyncio.Semaphore(3)


@agent_router.post("/chat")
async def agent_chat(body: dict = Body(...), user: dict = Depends(get_current_user)):
    from .runtime import _tlog
    _tlog(f"/chat request from {user.get('email', 'unknown')}")
    session_key = body.get("session_id", f"agent_{user['uid']}")

    # 409 if already running for this session
    existing = _running_tasks.get(session_key)
    if existing and not existing.done():
        raise HTTPException(status_code=409, detail="Agent chat already running for this session")

    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    t_request = time.time()

    # Create tracer if enabled
    tracer = None
    log_handler = None
    if AGENT_TRACE:
        from .tracer import TraceCollector, TraceLogHandler
        from ..llm import DEFAULT_MODEL
        project_name = body.get("session_id", "").split(":")[0]
        thread_id = body.get("session_id", "").split(":")[-1] if ":" in body.get("session_id", "") else ""
        tracer = TraceCollector(
            project_name=project_name,
            thread_id=thread_id,
            user_email=user.get("email", ""),
            model=DEFAULT_MODEL,
        )
        log_handler = TraceLogHandler(tracer)
        logging.getLogger("app").addHandler(log_handler)

    # Capture events for GCS persistence (recovery after page refresh)
    captured_events = []
    events_lock = threading.Lock()

    def stream_callback(event_type, data):
        if AGENT_DEBUG and event_type == 'state_changed':
            logger.info("[AGENT SSE] state_changed -> client: taskId=%s source=%s shotId=%s",
                        data.get("taskId") if isinstance(data, dict) else "?",
                        data.get("source") if isinstance(data, dict) else "?",
                        data.get("shotId") if isinstance(data, dict) else "?")
        if tracer:
            tracer.record_sse(event_type)
        # Capture state_changed and tool_call events for GCS result
        if event_type in ('state_changed', 'tool_call'):
            with events_lock:
                captured_events.append({"type": event_type, "data": data if isinstance(data, dict) else data})
        loop.call_soon_threadsafe(queue.put_nowait, {
            "type": event_type,
            "data": data if isinstance(data, dict) else data,
        })

    # Late import to avoid circular dependency (main.py imports agent_router)
    from ..main import nano_banana_client, veo_client, lyria_client
    gen_clients = {
        "nano_banana": nano_banana_client,
        "veo": veo_client,
        "lyria": lyria_client,
    }

    async def run():
        async with _semaphore:
            try:
                result = await loop.run_in_executor(None, lambda: handle_agent_chat(
                    message=body.get("message", ""),
                    conversation=body.get("conversation"),
                    conversation_contents=body.get("conversation_contents"),
                    project_state=body.get("project_state"),
                    scenes=body.get("scenes"),
                    scope=body.get("scope"),
                    pre_inject_skills=body.get("pre_inject_skills",
                        ["creative-direction", "context-access"]),
                    is_sub_agent=body.get("is_sub_agent", False),
                    is_inline=body.get("is_inline", False),
                    stream_callback=stream_callback,
                    clients=gen_clients,
                    project_name=body.get("session_id", "").split(":")[0],
                    tracer=tracer,
                ))
                done_event = {"type": "done", "text": result["text"], "thinking": result.get("thinking", ""), "contents_history": result.get("contents_history", [])}
                if tracer:
                    done_event["trace_id"] = tracer.trace_id
                await queue.put(done_event)
                # Save agent result to GCS for recovery after page refresh
                _save_result(body, result, captured_events, events_lock, tracer, user)
                # Finalize and save trace after the done event is queued
                if tracer:
                    _save_trace(tracer, "success", user)
            except asyncio.CancelledError:
                await queue.put({"type": "interrupted"})
                if tracer:
                    _save_trace(tracer, "interrupted", user)
            except Exception as e:
                logger.exception("Agent chat error")
                await queue.put({"type": "error", "error": str(e)})
                if tracer:
                    from .tracer import format_error_for_trace
                    _save_trace(tracer, "error", user, error=format_error_for_trace(e))
            finally:
                if log_handler:
                    logging.getLogger("app").removeHandler(log_handler)

    task = asyncio.create_task(run())
    _running_tasks[session_key] = task

    async def sse_stream():
        first_event = True
        try:
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=300)
                if first_event and AGENT_DEBUG:
                    from .runtime import _tlog
                    _tlog(f"First SSE event to client (type={event.get('type')})", t_request)
                    first_event = False
                yield f"data: {json.dumps(event, default=str)}\n\n"
                if event.get("type") in ("done", "error", "interrupted"):
                    if AGENT_DEBUG:
                        from .runtime import _tlog
                        _tlog("SSE stream ended", t_request)
                    break
        except asyncio.TimeoutError:
            yield f'data: {json.dumps({"type": "error", "error": "timeout"})}\n\n'
        finally:
            _running_tasks.pop(session_key, None)

    return StreamingResponse(
        sse_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _save_trace(tracer, status, user, error=None):
    """Finalize and save trace to GCS. Never crashes the request."""
    try:
        doc = tracer.finalize(status=status, error=error)
        from ..gcs_utils import save_agent_trace
        user_prefix = user.get("uid", "")
        save_agent_trace(tracer.project_name, tracer.trace_id, doc, user_prefix=user_prefix)
    except Exception:
        logger.warning("Failed to save agent trace %s", tracer.trace_id, exc_info=True)


def _save_result(body, result, captured_events, events_lock, tracer, user):
    """Save completed agent result to GCS for recovery after page refresh. Never crashes."""
    try:
        session_id = body.get("session_id", "")
        parts = session_id.split(":")
        project_name = parts[0] if parts else ""
        thread_id = parts[1] if len(parts) > 1 else ""
        if not project_name or not thread_id:
            return

        with events_lock:
            tool_calls = [e["data"] for e in captured_events if e["type"] == "tool_call"]
            state_changes = [e["data"] for e in captured_events if e["type"] == "state_changed"]

        from ..gcs_utils import save_agent_result
        save_agent_result(project_name, thread_id, {
            "text": result.get("text", ""),
            "thinking": result.get("thinking", ""),
            "contents_history": result.get("contents_history", []),
            "tool_calls": tool_calls,
            "state_changes": state_changes,
            "trace_id": tracer.trace_id if tracer else None,
            "timestamp": int(time.time()),
        }, user_prefix=user.get("uid", ""))
    except Exception:
        logger.warning("Failed to save agent result", exc_info=True)


@agent_router.post("/interrupt")
async def interrupt(body: dict = Body(...), user: dict = Depends(get_current_user)):
    key = body.get("session_id", f"agent_{user['uid']}")
    task = _running_tasks.get(key)
    if task and not task.done():
        task.cancel()
        return {"success": True}
    return {"success": False, "error": "No active session"}


# --- Trace REST endpoints ---

@agent_router.get("/traces/{project_name}")
async def list_traces(project_name: str, limit: int = Query(50, le=100), user: dict = Depends(get_current_user)):
    """List recent traces for a project."""
    from ..gcs_utils import list_agent_traces
    user_prefix = user.get("uid", "")
    traces = list_agent_traces(project_name, user_prefix=user_prefix, limit=limit)
    return {"traces": traces}


@agent_router.get("/traces/{project_name}/{trace_id}")
async def get_trace(project_name: str, trace_id: str, user: dict = Depends(get_current_user)):
    """Get a single trace by ID."""
    from ..gcs_utils import get_agent_trace
    user_prefix = user.get("uid", "")
    trace = get_agent_trace(project_name, trace_id, user_prefix=user_prefix)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace


# --- Agent Result recovery endpoint ---

@agent_router.get("/results/{project_name}")
async def get_results(project_name: str, user: dict = Depends(get_current_user)):
    """Get saved agent results for recovery after page refresh."""
    from ..gcs_utils import get_agent_results
    user_prefix = user.get("uid", "")
    return {"results": get_agent_results(project_name, user_prefix=user_prefix)}
