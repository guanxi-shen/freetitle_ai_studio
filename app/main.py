"""FreeTitle AI Studio -- FastAPI Backend

Creative production system powered by Google GenAI SDK (Vertex AI).
Skill-based agent with function calling orchestrates multimodal content generation:
script writing, character design, storyboard visualization, video generation,
audio production, and post-production editing -- all in an interleaved,
context-aware creative flow.

Hosted on Google Cloud Run with GCS for asset storage and Firebase for auth.
"""

import asyncio
import json as json_module
import uuid as uuid_mod
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, Body, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .auth import get_current_user, user_prefix as _user_prefix

# Google GenAI SDK clients for multimodal generation
from .clients.veo import VeoClient
from .clients.nano_banana import NanoBananaClient
from .clients.lyria import LyriaClient
try:
    from .soulboard import soulboard_router
except ImportError:
    soulboard_router = None
try:
    from .agent import agent_router
except ImportError:
    agent_router = None
from .gcs_utils import (
    upload_file_to_public,
    download_to_bytes,
    save_project_result,
    save_storyboard_project,
    get_storyboard_project,
    list_storyboard_projects,
    delete_storyboard_project,
    save_generation_project,
    get_generation_project,
    list_generation_projects,
    delete_generation_project,
    migrate_file_to_project,
    copy_soulboard_sessions,
    copy_storyboard_files,
    sign_url,
    url_to_blob_path,
    delete_blob,
)

# Read deploy timestamp from CI-generated file, fallback for local dev
VERSION_FILE = Path(__file__).parent.parent / "version.txt"
APP_VERSION = VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else "dev"

app = FastAPI(title="Freetitle Studio")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount soulboard router (optional — module may not exist yet)
if soulboard_router:
    app.include_router(soulboard_router)

# Mount agent router
if agent_router:
    app.include_router(agent_router)

# Generation clients -- Google GenAI SDK for Nano Banana (images) and Veo (video)
veo_client = VeoClient()
nano_banana_client = NanoBananaClient()
lyria_client = LyriaClient()

# Thread pool for parallel generation
executor = ThreadPoolExecutor(max_workers=8)
llm_executor = ThreadPoolExecutor(max_workers=4)

# Track active sessions
active_sessions = {}

# URL fields that need signing when serving data to frontend.
# Values can be strings or lists of strings (e.g. reference_images: ["blob_path", ...]).
# Includes both snake_case (API/metadata) and camelCase (frontend formState in shot configs).
_URL_KEYS = {
    "url", "content_url", "result_url", "gcs_url", "thumb_url", "medium_url", "thumbnail_url",
    "reference_images", "image_urls", "start_frame", "end_frame",
    "style_reference", "subject_reference", "thumbnail_urls", "preview_urls",
    "startFrameUrl", "endFrameUrl",
    "referenceImages",
}


def _sign_data(data):
    """Recursively sign blob paths in dicts/lists before returning to frontend."""
    if isinstance(data, dict):
        out = {}
        for k, v in data.items():
            if k == 'agent_conversations':
                out[k] = v
                continue
            if k in _URL_KEYS:
                if isinstance(v, str):
                    out[k] = sign_url(v)
                elif isinstance(v, list):
                    out[k] = [sign_url(item) if isinstance(item, str) else _sign_data(item) for item in v]
                else:
                    out[k] = _sign_data(v)
            else:
                out[k] = _sign_data(v)
        return out
    if isinstance(data, list):
        return [_sign_data(item) for item in data]
    return data


def _unsign_data(data):
    """Recursively convert signed/public URLs back to blob paths before saving."""
    if isinstance(data, dict):
        out = {}
        for k, v in data.items():
            if k == 'agent_conversations':
                out[k] = v
                continue
            if k in _URL_KEYS:
                if isinstance(v, str):
                    out[k] = url_to_blob_path(v)
                elif isinstance(v, list):
                    out[k] = [url_to_blob_path(item) if isinstance(item, str) else _unsign_data(item) for item in v]
                else:
                    out[k] = _unsign_data(v)
            else:
                out[k] = _unsign_data(v)
        return out
    if isinstance(data, list):
        return [_unsign_data(item) for item in data]
    return data


# Request models
class VeoRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "16:9"
    size: str = "1080p"
    first_frame_url: Optional[str] = None
    last_frame_url: Optional[str] = None
    versions: int = 1
    project_type: str = "generation"
    project_name: str = ""


class NanoBananaRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "horizontal"
    reference_images: Optional[List[str]] = None
    image_size: str = "2K"  # "1K", "2K", or "4K"
    versions: int = 1
    project_type: str = "generation"
    project_name: str = ""


class OptimizePromptRequest(BaseModel):
    prompt: str
    provider: str = "gemini"
    mode: str = "detailed"  # "detailed" (structured schema) or "concise" (prose + keywords)
    media_type: str = "image"  # "image" or "video"
    frame_mode: str = "none"  # "none", "single", or "dual" (video only)
    user_instructions: Optional[str] = None
    image_urls: Optional[list[str]] = None
    context_images: Optional[list[dict]] = None
    project_state: Optional[dict] = None
    scenes: Optional[list] = None
    scene_number: Optional[int] = None
    shot_number: Optional[int] = None


# Storyboard models
class StoryboardShotResult(BaseModel):
    id: str
    url: str
    provider: str
    filename: str = ""
    timestamp: str = ""
    prompt: str = ""
    config: dict = {}

class StoryboardShot(BaseModel):
    id: str = ""
    shot_number: int = 1
    original_shot_number: int = 1
    description: str = ""
    results: List[StoryboardShotResult] = []
    ranked_result_ids: List[str] = []
    frame_metadata: dict = {}

class StoryboardScene(BaseModel):
    id: str = ""
    scene_number: int = 1
    original_scene_number: int = 1
    title: str = ""
    description: str = ""
    collapsed: bool = False
    shots: List[StoryboardShot] = []

class StoryboardProject(BaseModel):
    name: str
    created_at: str = ""
    updated_at: str = ""
    scenes: List[StoryboardScene] = []
    agent_source: Optional[dict] = None
    script_data: Optional[dict] = None
    project_state: dict = {}


class GenerationProject(BaseModel):
    name: str
    created_at: str = ""
    updated_at: str = ""
    tab: str = "image"
    prompt: str = ""
    versions: int = 1
    providers: List[str] = ["nano_banana"]
    form_state: dict = {}
    input_images: dict = {}
    results: List[dict] = []


class ScriptGenerateRequest(BaseModel):
    query: str
    preferences: Optional[dict] = None
    existing_script: Optional[dict] = None
    mode: Optional[str] = "film"


class MigrateFileRequest(BaseModel):
    source_url: str
    project_type: str  # "generation" or "storyboard"
    project_name: str
    filename: str


@app.get("/api/version")
async def get_version():
    return {"version": APP_VERSION}


@app.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Upload image to GCS and return signed URL"""
    try:
        content = await file.read()
        folder = "freetitle_ai_studio/inputs"
        blob_path = upload_file_to_public(content, file.filename, folder)

        if not blob_path:
            raise HTTPException(status_code=500, detail="Upload failed")

        return {"url": sign_url(blob_path), "filename": file.filename}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate/veo")
async def generate_veo(request: VeoRequest, user: dict = Depends(get_current_user)):
    """Submit Veo video generation task(s) via Google GenAI SDK"""
    versions = min(max(request.versions, 1), 4)
    task_ids = []

    for i in range(versions):
        result = veo_client.generate_video(
            prompt=request.prompt,
            first_frame_url=request.first_frame_url,
            last_frame_url=request.last_frame_url,
            aspect_ratio=request.aspect_ratio,
            size=request.size,
        )

        if result.get("success"):
            task_id = result["task_id"]
            task_ids.append(task_id)
            active_sessions[f"veo_{task_id}"] = {
                "provider": "veo",
                "task_id": task_id,
                "version": i + 1,
                "project_type": request.project_type,
                "project_name": request.project_name,
                "user_prefix": _user_prefix(user),
            }
        else:
            task_ids.append({"error": result.get("error")})

    return {
        "task_ids": task_ids,
        "count": len([t for t in task_ids if not isinstance(t, dict)]),
    }


@app.post("/api/generate/nano-banana")
async def generate_nano_banana(request: NanoBananaRequest, user: dict = Depends(get_current_user)):
    """Submit Nano Banana image generation task(s)"""
    versions = min(max(request.versions, 1), 4)
    task_ids = []

    for i in range(versions):
        result = nano_banana_client.generate_image(
            prompt=request.prompt,
            aspect_ratio=request.aspect_ratio,
            reference_images=request.reference_images,
            image_size=request.image_size
        )

        if result.get("success"):
            task_id = result["task_id"]
            task_ids.append(task_id)
            active_sessions[f"nano_banana_{task_id}"] = {
                "provider": "nano_banana",
                "task_id": task_id,
                "version": i + 1,
                "project_type": request.project_type,
                "project_name": request.project_name,
                "user_prefix": _user_prefix(user),
            }
        else:
            task_ids.append({"error": result.get("error")})

    return {
        "task_ids": task_ids,
        "count": len([t for t in task_ids if not isinstance(t, dict)]),
    }


@app.get("/api/task/{provider}/{task_id}")
async def get_task_status(provider: str, task_id: str, project_type: str = None, project_name: str = None, user: dict = Depends(get_current_user)):
    """Get task status for any provider"""
    session_key = f"{provider}_{task_id}"
    session_info = active_sessions.get(session_key, {})

    # Reconstruct session_info from query params when active_sessions lost (deploy/restart)
    if not session_info and project_type and project_name:
        session_info = {"provider": provider, "task_id": task_id, "project_type": project_type, "project_name": project_name, "user_prefix": _user_prefix(user)}
        active_sessions[session_key] = session_info
        print(f"[TaskPoll] session reconstructed from query params: {provider}/{task_id} -> {project_type}/{project_name}")

    if provider == "veo":
        result = veo_client.query_task(task_id)
    elif provider == "nano_banana":
        result = nano_banana_client.query_task(task_id)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    # If completed, download and save directly to project folder
    if result.get("status") == "succeed" and result.get("result_url"):
        result_host = result["result_url"].split("/")[2] if "/" in result["result_url"] else "unknown"
        if not session_info:
            print(f"[TaskPoll] WARNING no session context: {provider}/{task_id} host={result_host} — no GCS save")
        download_attempts = session_info.get("download_attempts", 0) if session_info else 0
        max_retries = 3
        if session_info and not session_info.get("gcs_url") and download_attempts < max_retries:
            try:
                print(f"[TaskPoll] downloading: {provider}/{task_id} host={result_host} attempt={download_attempts + 1}/{max_retries}")
                loop = asyncio.get_event_loop()
                content = await loop.run_in_executor(
                    executor, lambda: download_to_bytes(result["result_url"])
                )
                if content:
                    is_image = provider in ("nano_banana",)
                    result_id = uuid_mod.uuid4().hex[:12]
                    proj_type = session_info.get("project_type", "generation")
                    proj_name = session_info.get("project_name", "")
                    up = session_info.get("user_prefix", _user_prefix(user))
                    saved = await loop.run_in_executor(
                        executor,
                        lambda: save_project_result(content, proj_type, proj_name, result_id, is_image, user_prefix=up)
                    )
                    blob_path = saved["blob_path"]
                    thumb_blob_path = saved.get("thumb_blob_path")
                    medium_blob_path = saved.get("medium_blob_path")
                    result["gcs_url"] = sign_url(blob_path)
                    result["result_id"] = result_id
                    if thumb_blob_path:
                        result["thumb_url"] = sign_url(thumb_blob_path)
                    if medium_blob_path:
                        result["medium_url"] = sign_url(medium_blob_path)
                    session_info["gcs_url"] = blob_path
                    session_info["thumb_url"] = thumb_blob_path
                    session_info["medium_url"] = medium_blob_path
                    session_info["result_id"] = result_id
                    print(f"[TaskPoll] saved to GCS: {provider}/{task_id} -> {blob_path} size={len(content)}")
                else:
                    session_info["download_attempts"] = download_attempts + 1
                    print(f"[TaskPoll] download returned empty: {provider}/{task_id} host={result_host} attempt={download_attempts + 1}/{max_retries}")
                    if download_attempts + 1 >= max_retries:
                        result["status"] = "failed"
                        result["error"] = "Image download failed after retries"
                        print(f"[TaskPoll] download exhausted retries: {provider}/{task_id}")
                    else:
                        result["status"] = "processing"
            except Exception as e:
                session_info["download_attempts"] = download_attempts + 1
                print(f"[TaskPoll] download exception: {provider}/{task_id} attempt={download_attempts + 1}/{max_retries} {type(e).__name__}: {e}")
                if download_attempts + 1 >= max_retries:
                    result["status"] = "failed"
                    result["error"] = "Image download failed after retries"
                else:
                    result["status"] = "processing"
        elif session_info and session_info.get("gcs_url"):
            print(f"[TaskPoll] using cached GCS: {provider}/{task_id} -> {session_info['gcs_url']}")
            result["gcs_url"] = sign_url(session_info["gcs_url"])
            result["result_id"] = session_info.get("result_id")
            if session_info.get("thumb_url"):
                result["thumb_url"] = sign_url(session_info["thumb_url"])
            if session_info.get("medium_url"):
                result["medium_url"] = sign_url(session_info["medium_url"])
        elif session_info and download_attempts >= max_retries:
            print(f"[TaskPoll] retries exhausted, skipping: {provider}/{task_id}")
            result["status"] = "failed"
            result["error"] = "Image download failed after retries"

    result["version"] = session_info.get("version", 1)
    # Never expose transient provider URLs to frontend
    result.pop("result_url", None)
    return result


@app.post("/api/optimize-prompt")
async def optimize_prompt(request: OptimizePromptRequest, user: dict = Depends(get_current_user)):
    """Optimize a prompt using LLM providers"""
    from .direct_agents.prompt_optimizer import optimize_with_gemini
    from .direct_agents.video_prompt_optimizer import optimize_video_with_gemini
    from .context import get_script_context, CONTEXT_FRAMING

    # Build script context from project state and prepend to user instructions
    script_context = ""
    if request.project_state:
        script_context = get_script_context(
            request.project_state.get("generated_scripts"),
            scenes=request.scenes,
            scene_number=request.scene_number,
            shot_number=request.shot_number,
        )

    user_instructions = request.user_instructions or None
    creative_context = None
    if script_context:
        creative_context = f"{CONTEXT_FRAMING}\n\n{script_context}"

    results = {}
    errors = {}

    providers = ["gemini"] if request.provider in ("both", "gemini") else [request.provider]
    print(f"[Optimize] provider={request.provider}, media_type={request.media_type}, images={request.image_urls}, context_images={len(request.context_images or [])}, instructions={user_instructions}")

    is_video = request.media_type == "video"

    for provider in providers:
        try:
            if provider == "gemini":
                if is_video:
                    results["gemini"] = optimize_video_with_gemini(
                        request.prompt, user_instructions, request.image_urls, creative_context,
                        mode=request.mode, frame_mode=request.frame_mode,
                        context_images=request.context_images,
                    )
                else:
                    results["gemini"] = optimize_with_gemini(
                        request.prompt, user_instructions, request.image_urls, creative_context,
                        mode=request.mode, context_images=request.context_images,
                    )
        except Exception as e:
            errors[provider] = str(e)

    return {"results": results, "errors": errors if errors else None}


@app.post("/api/optimize-prompt-stream")
async def optimize_prompt_stream(request: OptimizePromptRequest, user: dict = Depends(get_current_user)):
    """Optimize a prompt with SSE streaming (thinking + final result). Gemini only."""
    from .direct_agents.prompt_optimizer import optimize_with_gemini
    from .direct_agents.video_prompt_optimizer import optimize_video_with_gemini
    from .context import get_script_context, CONTEXT_FRAMING

    script_context = ""
    if request.project_state:
        script_context = get_script_context(
            request.project_state.get("generated_scripts"),
            scenes=request.scenes,
            scene_number=request.scene_number,
            shot_number=request.shot_number,
        )

    user_instructions = request.user_instructions or None
    creative_context = None
    if script_context:
        creative_context = f"{CONTEXT_FRAMING}\n\n{script_context}"

    print(f"[OptimizeStream] media_type={request.media_type}, mode={request.mode}, images={len(request.image_urls or [])}, context_images={len(request.context_images or [])}, prompt={request.prompt[:100]}")

    queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def stream_callback(event_type, text):
        loop.call_soon_threadsafe(queue.put_nowait, {"type": event_type, "text": text})

    mode = request.mode
    is_video = request.media_type == "video"
    frame_mode = request.frame_mode

    async def run():
        try:
            ctx_images = request.context_images
            if is_video:
                result = await loop.run_in_executor(
                    llm_executor, lambda: optimize_video_with_gemini(
                        request.prompt, user_instructions, request.image_urls, creative_context,
                        stream_callback, mode=mode, frame_mode=frame_mode,
                        context_images=ctx_images,
                    )
                )
            else:
                result = await loop.run_in_executor(
                    llm_executor, lambda: optimize_with_gemini(
                        request.prompt, user_instructions, request.image_urls, creative_context, stream_callback, mode=mode,
                        context_images=ctx_images,
                    )
                )
            await queue.put({"type": "optimize_complete", "result": result})
        except Exception as e:
            await queue.put({"type": "error", "error": str(e)})

    asyncio.create_task(run())

    async def sse_stream():
        try:
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=300)
                yield f"data: {json_module.dumps(event, default=str)}\n\n"
                if event.get("type") in ("optimize_complete", "error"):
                    break
        except asyncio.TimeoutError:
            yield f"data: {json_module.dumps({'type': 'error', 'error': 'timeout'})}\n\n"

    return StreamingResponse(
        sse_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/download/{provider}/{task_id}")
async def download_result(provider: str, task_id: str, user: dict = Depends(get_current_user)):
    """Download completed result"""
    # Get status first
    if provider == "veo":
        result = veo_client.query_task(task_id)
    elif provider == "nano_banana":
        result = nano_banana_client.query_task(task_id)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    if result.get("status") != "succeed":
        raise HTTPException(status_code=400, detail="Task not completed")

    result_url = result.get("result_url")
    if not result_url:
        raise HTTPException(status_code=404, detail="No result URL")

    # Download and stream
    content = download_to_bytes(result_url)
    if not content:
        raise HTTPException(status_code=500, detail="Download failed")

    is_image = provider in ("nano_banana",)
    ext = "png" if is_image else "mp4"
    media_type = "image/png" if is_image else "video/mp4"
    filename = f"{provider}_{task_id}.{ext}"

    return StreamingResponse(
        iter([content]),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# Generation project CRUD endpoints
@app.get("/api/generation/projects")
def list_generation_projects_endpoint(user: dict = Depends(get_current_user)):
    return {"projects": list_generation_projects(user_prefix=_user_prefix(user))}


@app.post("/api/generation/projects")
def create_generation_project(project: GenerationProject, user: dict = Depends(get_current_user)):
    if not project.name.strip():
        raise HTTPException(status_code=400, detail="Project name is required")
    name = save_generation_project(project.name.strip(), project.model_dump(), user_prefix=_user_prefix(user))
    return {"success": True, "name": name}


@app.get("/api/generation/projects/{name:path}")
def get_generation_project_endpoint(name: str, user: dict = Depends(get_current_user)):
    data = get_generation_project(name, user_prefix=_user_prefix(user))
    if data is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _sign_data(data)


@app.put("/api/generation/projects/{name:path}")
def update_generation_project(name: str, project: GenerationProject, user: dict = Depends(get_current_user)):
    save_generation_project(name, _unsign_data(project.model_dump()), user_prefix=_user_prefix(user))
    return {"success": True, "name": name}


@app.delete("/api/generation/projects/{name:path}")
def delete_generation_project_endpoint(name: str, user: dict = Depends(get_current_user)):
    success = delete_generation_project(name, user_prefix=_user_prefix(user))
    if not success:
        raise HTTPException(status_code=500, detail="Delete failed")
    return {"success": True}


# File migration endpoint
@app.post("/api/migrate-file")
async def migrate_file(request: MigrateFileRequest, user: dict = Depends(get_current_user)):
    up = _user_prefix(user)
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        executor,
        lambda: migrate_file_to_project(request.source_url, request.project_type, request.project_name, request.filename, user_prefix=up)
    )
    if not result:
        raise HTTPException(status_code=500, detail="Migration failed")
    resp = {"url": sign_url(result["blob_path"])}
    if result.get("thumb_blob_path"):
        resp["thumb_url"] = sign_url(result["thumb_blob_path"])
    if result.get("medium_blob_path"):
        resp["medium_url"] = sign_url(result["medium_blob_path"])
    return resp


@app.post("/api/script/generate")
async def generate_script_endpoint(req: ScriptGenerateRequest, user: dict = Depends(get_current_user)):
    """Generate a screenplay from a creative brief"""
    from .direct_agents.script_agent import generate_script
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(llm_executor, generate_script, req.query, req.preferences, req.existing_script, req.mode)
    return result


@app.post("/api/script/generate-stream")
async def generate_script_stream(req: ScriptGenerateRequest, user: dict = Depends(get_current_user)):
    """Generate a screenplay with SSE streaming (thinking + final result)"""
    from .direct_agents.script_agent import generate_script
    queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def stream_callback(event_type, text):
        loop.call_soon_threadsafe(queue.put_nowait, {"type": event_type, "text": text})

    async def run():
        try:
            result = await loop.run_in_executor(
                llm_executor, generate_script, req.query, req.preferences, req.existing_script, req.mode, stream_callback
            )
            await queue.put({"type": "script_complete", "script": result})
        except Exception as e:
            await queue.put({"type": "error", "error": str(e)})

    asyncio.create_task(run())

    async def sse_stream():
        try:
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=300)
                yield f"data: {json_module.dumps(event, default=str)}\n\n"
                if event.get("type") in ("script_complete", "error"):
                    break
        except asyncio.TimeoutError:
            yield f"data: {json_module.dumps({'type': 'error', 'error': 'timeout'})}\n\n"

    return StreamingResponse(
        sse_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


TRASH_TTL_DAYS = 30


def _purge_expired_trash(data: dict, project_name: str) -> bool:
    """Remove trash items older than TRASH_TTL_DAYS and delete their GCS blobs.
    Returns True if any items were purged (caller should re-save)."""
    ps = data.get("project_state") or {}
    trash = ps.get("trash")
    if not trash:
        return False
    cutoff = (datetime.now(timezone.utc) - timedelta(days=TRASH_TTL_DAYS)).strftime("%Y-%m-%dT%H:%M:%S")
    keep, purged = [], False
    for item in trash:
        if item.get("deleted_at", "") < cutoff:
            purged = True
            for key in ("url", "thumb_url", "medium_url"):
                blob_path = item.get(key)
                if blob_path:
                    delete_blob(blob_path)
        else:
            keep.append(item)
    if purged:
        ps["trash"] = keep
        data["project_state"] = ps
    return purged


# Storyboard CRUD endpoints
@app.get("/api/storyboard/projects")
def list_storyboard_projects_endpoint(user: dict = Depends(get_current_user)):
    return _sign_data({"projects": list_storyboard_projects(user_prefix=_user_prefix(user))})


@app.post("/api/storyboard/projects")
def create_storyboard_project(body: dict = Body(...), user: dict = Depends(get_current_user)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")
    save_storyboard_project(name, _unsign_data(body), user_prefix=_user_prefix(user))
    return {"success": True, "name": name}


@app.get("/api/storyboard/projects/{name:path}")
def get_storyboard_project_endpoint(name: str, user: dict = Depends(get_current_user)):
    up = _user_prefix(user)
    data = get_storyboard_project(name, user_prefix=up)
    if data is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if _purge_expired_trash(data, name):
        save_storyboard_project(name, data, user_prefix=up)
    return _sign_data(data)


@app.put("/api/storyboard/projects/{name:path}")
def update_storyboard_project(name: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    save_storyboard_project(name, _unsign_data(body), user_prefix=_user_prefix(user))
    return {"success": True, "name": name}


def _copy_project_core(name: str, new_name: str, up: str, delete_old: bool = False):
    """Copy (or rename) a project: rewrite paths, copy files, return signed data."""
    source = get_storyboard_project(name, user_prefix=up)
    if source is None:
        raise HTTPException(status_code=404, detail="Source project not found")
    raw = json_module.dumps(source)
    old_pfx = f"storyboard/{name}/"
    new_pfx = f"storyboard/{new_name}/"
    rewritten = json_module.loads(raw.replace(old_pfx, new_pfx))
    rewritten["name"] = new_name
    rewritten["updated_at"] = datetime.now().isoformat()
    save_storyboard_project(new_name, rewritten, user_prefix=up)
    copy_storyboard_files(name, new_name, user_prefix=up)
    copy_soulboard_sessions(name, new_name, user_prefix=up)
    if delete_old:
        delete_storyboard_project(name, user_prefix=up)
    return _sign_data(rewritten)


@app.post("/api/storyboard/projects/{name:path}/copy")
def copy_storyboard_project(name: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    """Copy a project to a new name. Returns full signed project data."""
    up = _user_prefix(user)
    new_name = (body.get("new_name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")
    return _copy_project_core(name, new_name, up, delete_old=False)


@app.post("/api/storyboard/projects/{name:path}/rename")
def rename_storyboard_project(name: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    """Rename a project: copy files, rewrite paths, delete old. Returns full signed project data."""
    up = _user_prefix(user)
    new_name = (body.get("new_name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")
    if new_name == name:
        raise HTTPException(status_code=400, detail="new_name must differ")
    return _copy_project_core(name, new_name, up, delete_old=True)


@app.delete("/api/storyboard/projects/{name:path}")
def delete_storyboard_project_endpoint(name: str, user: dict = Depends(get_current_user)):
    success = delete_storyboard_project(name, user_prefix=_user_prefix(user))
    if not success:
        raise HTTPException(status_code=500, detail="Delete failed")
    return {"success": True}


# Static files served by nginx in production (see nginx.conf).
# For local dev, run the Vite dev server (cd ui && npm run dev).


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
