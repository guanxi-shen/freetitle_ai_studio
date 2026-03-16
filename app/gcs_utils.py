"""GCS utilities -- cloud-native asset storage for the interleaved multimodal pipeline.

All generated content (images, videos, audio, thumbnails, edited videos, traces) is
stored in Google Cloud Storage. Signed URLs provide time-limited access for the
frontend; gs:// URIs are used for Gemini multimodal context. This cloud-native
storage layer ensures generated assets persist across page refreshes and server
restarts while streaming results to the frontend as they are produced."""

import io
import json
import time
import uuid
import requests
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote, unquote
from google.cloud import storage
from google.auth.transport.requests import Request
from PIL import Image
from .config import CREDENTIALS, BUCKET_NAME, PUBLIC_BUCKET_NAME

# Singleton storage client and bucket
_storage_client = None
_bucket = None

SIGNED_URL_EXPIRY = timedelta(hours=12)

# Provider hosts whose URLs expire and should not be persisted.
# All generation now uses Google GenAI SDK (results uploaded to GCS directly),
# so transient hosts are only relevant for legacy data.
_TRANSIENT_HOSTS: set = set()

# Old bucket names for backward-compatible URL parsing
_OLD_BUCKET_NAMES = ["freetitle-public-temp", "vid-gen-sessions"]

# Prefix renamed during migration: vid_gen_tool/ -> freetitle_ai_studio/
_OLD_PATH_PREFIX = "vid_gen_tool/"
_NEW_PATH_PREFIX = "freetitle_ai_studio/"


def _get_storage_client():
    global _storage_client
    if _storage_client is None:
        _storage_client = storage.Client(credentials=CREDENTIALS)
    return _storage_client


def _get_bucket():
    """Get or create bucket instance"""
    global _bucket
    if _bucket is None:
        _bucket = _get_storage_client().bucket(BUCKET_NAME)
    return _bucket


# Keep as alias for code that still references sessions bucket
_get_sessions_bucket = _get_bucket


# --- Signed URL utilities ---

def generate_signed_url(blob_path: str) -> str:
    """Generate a v4 signed URL for a blob path. Returns empty string on failure."""
    if not blob_path:
        return ""
    try:
        blob = _get_bucket().blob(blob_path)
        return blob.generate_signed_url(
            version="v4",
            expiration=SIGNED_URL_EXPIRY,
            method="GET",
            credentials=CREDENTIALS,
        )
    except Exception as e:
        print(f"[GCS] Error signing URL for {blob_path}: {e}")
        return ""


def _rewrite_old_prefix(path: str) -> str:
    """Rename vid_gen_tool/ -> freetitle_ai_studio/ (migration renamed this prefix)."""
    if path.startswith(_OLD_PATH_PREFIX):
        return _NEW_PATH_PREFIX + path[len(_OLD_PATH_PREFIX):]
    return path


def url_to_blob_path(url: str) -> str:
    """Extract blob path from a GCS URL. Returns original string if not a GCS URL.
    Strips transient provider URLs to empty. Applies vid_gen_tool/ -> freetitle_ai_studio/ prefix rename."""
    if not url:
        return ""
    if url.startswith("gs://"):
        parts = url.replace("gs://", "").split("/", 1)
        path = unquote(parts[1]) if len(parts) > 1 else ""
        return _rewrite_old_prefix(path)
    for bucket_name in [BUCKET_NAME] + _OLD_BUCKET_NAMES:
        prefix = f"https://storage.googleapis.com/{bucket_name}/"
        if url.startswith(prefix):
            path = unquote(url[len(prefix):].split("?")[0])
            return _rewrite_old_prefix(path)
    # Strip transient provider URLs so they don't get persisted
    if _is_transient_url(url):
        host = next((h for h in _TRANSIENT_HOSTS if h in url), "unknown")
        print(f"[GCS] Stripping transient URL on save from {host}")
        return ""
    return url


def is_blob_path(value: str) -> bool:
    """Check if a string is a blob path (not a full URL)."""
    if not value:
        return False
    return not value.startswith(("http://", "https://", "gs://"))


def _is_transient_url(value: str) -> bool:
    """Check if a URL belongs to a provider with expiring URLs."""
    for host in _TRANSIENT_HOSTS:
        if host in value:
            return True
    return False


def sign_url(value: str) -> str:
    """Sign a blob path or convert a GCS URL to signed. Strips transient provider URLs."""
    if not value:
        return ""
    if is_blob_path(value):
        return generate_signed_url(value)
    # Check if it's a GCS URL from our bucket(s)
    bp = url_to_blob_path(value)
    if bp != value:
        return generate_signed_url(bp)
    # Strip expired transient provider URLs (legacy data)
    if _is_transient_url(value):
        host = next((h for h in _TRANSIENT_HOSTS if h in value), "unknown")
        print(f"[GCS] Stripping transient URL from {host}")
        return ""
    return value


def blob_path_to_gs_uri(value: str) -> str:
    """Convert blob path or URL to gs:// URI for Gemini."""
    if not value:
        return ""
    if value.startswith("gs://"):
        return value.split("?")[0]
    if is_blob_path(value):
        return f"gs://{BUCKET_NAME}/{value}"
    bp = url_to_blob_path(value)
    if bp != value:
        return f"gs://{BUCKET_NAME}/{bp}"
    return value


def _get_auth_token():
    """Get a fresh OAuth2 token"""
    if not CREDENTIALS.valid:
        CREDENTIALS.refresh(Request())
    return CREDENTIALS.token


def _gcs_download_fresh(bucket_name: str, blob_path: str) -> Optional[bytes]:
    """Download blob via raw HTTP with cache-busting to guarantee fresh reads"""
    url = f"https://storage.googleapis.com/storage/v1/b/{bucket_name}/o/{quote(blob_path, safe='')}?alt=media&_t={time.time()}"
    resp = requests.get(url, headers={
        "Authorization": f"Bearer {_get_auth_token()}",
        "Cache-Control": "no-cache, no-store",
    })
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.content


def upload_bytes_to_gcs(
    data: bytes,
    folder: str,
    filename: str,
    content_type: Optional[str] = None
) -> str:
    """
    Upload bytes to GCS and return blob path.

    Args:
        data: Bytes data to upload
        folder: Folder path within bucket (e.g., "freetitle_ai_studio/20250101_120000")
        filename: Name of the file
        content_type: Optional MIME type

    Returns:
        Blob path (e.g., "freetitle_ai_studio/20250101_120000/file.png")
    """
    try:
        bucket = _get_bucket()
        blob_name = f"{folder}/{filename}"
        blob = bucket.blob(blob_name)
        blob.upload_from_string(data, content_type=content_type)

        print(f"[GCS] Uploaded: {blob_name}")
        return blob_name

    except Exception as e:
        print(f"[GCS] Error uploading {filename}: {e}")
        return ""


def upload_file_to_public(
    file_bytes: bytes,
    original_filename: str,
    folder: str
) -> str:
    """
    Upload file to GCS and return blob path.

    Args:
        file_bytes: File content as bytes
        original_filename: Original filename to preserve extension
        folder: Folder path (e.g., "freetitle_ai_studio/inputs")

    Returns:
        Blob path
    """
    # Generate unique filename
    ext = original_filename.split('.')[-1] if '.' in original_filename else 'png'
    unique_name = f"{uuid.uuid4().hex[:12]}.{ext}"

    # Determine content type
    content_types = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'webp': 'image/webp',
        'gif': 'image/gif'
    }
    content_type = content_types.get(ext.lower(), 'application/octet-stream')

    return upload_bytes_to_gcs(file_bytes, folder, unique_name, content_type)


def download_to_bytes(url: str) -> Optional[bytes]:
    """
    Download file from URL or blob path to bytes.

    Args:
        url: HTTP(S) URL, gs:// URI, or blob path

    Returns:
        File content as bytes, or None on failure
    """
    try:
        if not url:
            return None
        if url.startswith("gs://"):
            parts = url.replace("gs://", "").split("/", 1)
            bucket_name = parts[0]
            blob_name = parts[1] if len(parts) > 1 else ""
            bucket = storage.Client(credentials=CREDENTIALS).bucket(bucket_name)
            blob = bucket.blob(blob_name)
            return blob.download_as_bytes()
        elif url.startswith(("http://", "https://")):
            response = requests.get(url, timeout=120)
            response.raise_for_status()
            return response.content
        else:
            # Blob path — download from our bucket
            blob = _get_bucket().blob(url)
            return blob.download_as_bytes()
    except Exception as e:
        print(f"[GCS] Error downloading {url}: {e}")
        return None



def generate_thumbnail(image_bytes: bytes, max_width: int = 320, quality: int = 80) -> Optional[bytes]:
    """Resize image to thumbnail JPEG. Returns None on failure or if already small enough."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.width <= max_width:
            return None
        ratio = max_width / img.width
        new_size = (max_width, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()
    except Exception as e:
        print(f"[Thumbnail] Generation failed: {e}")
        return None


def save_project_result(
    content_bytes: bytes,
    project_type: str,
    project_name: str,
    result_id: str,
    is_image: bool = True,
    user_prefix: str = "",
) -> dict:
    """Save generation result directly to project folder. Returns blob_path and optional thumb_blob_path."""
    ext = "png" if is_image else "mp4"
    ct = "image/png" if is_image else "video/mp4"
    base = f"{user_prefix}/{project_type}" if user_prefix else project_type
    folder = f"{base}/{project_name}/results"
    blob_path = upload_bytes_to_gcs(content_bytes, folder, f"{result_id}.{ext}", ct)

    thumb_blob_path = None
    medium_blob_path = None
    if is_image:
        thumb_data = generate_thumbnail(content_bytes, max_width=320)
        if thumb_data:
            thumb_blob_path = upload_bytes_to_gcs(thumb_data, folder, f"{result_id}_thumb_sm.jpg", "image/jpeg")
        medium_data = generate_thumbnail(content_bytes, max_width=640)
        if medium_data:
            medium_blob_path = upload_bytes_to_gcs(medium_data, folder, f"{result_id}_thumb_md.jpg", "image/jpeg")

    return {"blob_path": blob_path, "thumb_blob_path": thumb_blob_path, "medium_blob_path": medium_blob_path}


GENERATION_PREFIX = "generation"


def save_generation_project(name: str, data: dict, user_prefix: str = "") -> str:
    """Save a generation project JSON to sessions bucket"""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{GENERATION_PREFIX}" if user_prefix else GENERATION_PREFIX
        blob = bucket.blob(f"{prefix}/{name}/project.json")
        blob.upload_from_string(
            json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"),
            content_type="application/json"
        )
        print(f"[Generation] Saved project: {name}")
        return name
    except Exception as e:
        print(f"[Generation] Error saving project {name}: {e}")
        raise


def get_generation_project(name: str, user_prefix: str = "") -> Optional[dict]:
    """Load a generation project by name"""
    try:
        prefix = f"{user_prefix}/{GENERATION_PREFIX}" if user_prefix else GENERATION_PREFIX
        raw = _gcs_download_fresh(BUCKET_NAME, f"{prefix}/{name}/project.json")
        return json.loads(raw) if raw else None
    except Exception as e:
        print(f"[Generation] Error loading project {name}: {e}")
        return None


def list_generation_projects(user_prefix: str = "") -> list:
    """List all generation projects"""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{GENERATION_PREFIX}" if user_prefix else GENERATION_PREFIX
        summaries = []
        for blob in bucket.list_blobs(match_glob=f"{prefix}/*/project.json"):
            try:
                raw = _gcs_download_fresh(BUCKET_NAME, blob.name)
                if not raw:
                    continue
                data = json.loads(raw)
                rel = blob.name[len(prefix) + 1:]
                name = rel.split("/")[0]
                summaries.append({
                    "name": name,
                    "created_at": data.get("created_at", ""),
                    "updated_at": data.get("updated_at", ""),
                    "prompt": (data.get("prompt") or "")[:100],
                    "providers": data.get("providers", []),
                    "result_count": len(data.get("results", [])),
                })
            except Exception:
                pass
        summaries.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
        return summaries
    except Exception as e:
        print(f"[Generation] Error listing projects: {e}")
        return []


def delete_generation_project(name: str, user_prefix: str = "") -> bool:
    """Delete a generation project and all its files"""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{GENERATION_PREFIX}" if user_prefix else GENERATION_PREFIX
        blobs = list(bucket.list_blobs(prefix=f"{prefix}/{name}/"))
        if blobs:
            bucket.delete_blobs(blobs)
        print(f"[Generation] Deleted project: {name}")
        return True
    except Exception as e:
        print(f"[Generation] Error deleting project {name}: {e}")
        return False


def migrate_file_to_project(source_url: str, project_type: str, project_name: str, filename: str, user_prefix: str = "") -> Optional[dict]:
    """Copy a file from any URL to permanent project storage. Returns {blob_path, thumb_blob_path}."""
    try:
        content = download_to_bytes(source_url)
        if not content:
            return None
        bucket = _get_bucket()
        base = f"{user_prefix}/{project_type}" if user_prefix else project_type
        blob_path = f"{base}/{project_name}/results/{filename}"
        blob = bucket.blob(blob_path)
        ext = filename.rsplit(".", 1)[-1].lower()
        ct = {"png": "image/png", "jpg": "image/jpeg", "mp4": "video/mp4", "webp": "image/webp"}.get(ext, "application/octet-stream")
        blob.upload_from_string(content, content_type=ct)

        # Generate thumbnails for image files
        thumb_blob_path = None
        medium_blob_path = None
        if ext in ("png", "jpg", "jpeg", "webp"):
            file_base = filename.rsplit(".", 1)[0]
            results_folder = f"{base}/{project_name}/results"
            thumb_data = generate_thumbnail(content, max_width=320)
            if thumb_data:
                thumb_blob_path = upload_bytes_to_gcs(thumb_data, results_folder, f"{file_base}_thumb_sm.jpg", "image/jpeg")
            medium_data = generate_thumbnail(content, max_width=640)
            if medium_data:
                medium_blob_path = upload_bytes_to_gcs(medium_data, results_folder, f"{file_base}_thumb_md.jpg", "image/jpeg")
        return {"blob_path": blob_path, "thumb_blob_path": thumb_blob_path, "medium_blob_path": medium_blob_path}
    except Exception as e:
        print(f"[Migration] Error migrating {filename}: {e}")
        return None


SOULBOARD_PREFIX = "soulboard"


def save_soulboard_state(project_name: str, session_id: str, state: dict, user_prefix: str = "") -> bool:
    """Save soulboard session state JSON to sessions bucket."""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{SOULBOARD_PREFIX}" if user_prefix else SOULBOARD_PREFIX
        blob = bucket.blob(f"{prefix}/{project_name}/{session_id}/state.json")
        blob.upload_from_string(
            json.dumps(state, ensure_ascii=False, default=str).encode("utf-8"),
            content_type="application/json"
        )
        print(f"[Soulboard] Saved state: {project_name}/{session_id}")
        return True
    except Exception as e:
        print(f"[Soulboard] Error saving state {project_name}/{session_id}: {e}")
        return False


def load_soulboard_state(project_name: str, session_id: str, user_prefix: str = "") -> Optional[dict]:
    """Load soulboard session state from sessions bucket."""
    try:
        prefix = f"{user_prefix}/{SOULBOARD_PREFIX}" if user_prefix else SOULBOARD_PREFIX
        raw = _gcs_download_fresh(BUCKET_NAME, f"{prefix}/{project_name}/{session_id}/state.json")
        return json.loads(raw) if raw else None
    except Exception as e:
        print(f"[Soulboard] Error loading state {project_name}/{session_id}: {e}")
        return None


def list_soulboard_sessions(project_name: str, user_prefix: str = "") -> list:
    """List all soulboard sessions for a project by scanning GCS folders."""
    try:
        bucket = _get_sessions_bucket()
        sessions = []
        base = f"{user_prefix}/{SOULBOARD_PREFIX}" if user_prefix else SOULBOARD_PREFIX
        prefix = f"{base}/{project_name}/"
        for blob in bucket.list_blobs(prefix=prefix, match_glob=f"{prefix}*/state.json"):
            try:
                # Extract session_id relative to prefix
                rel = blob.name[len(prefix):]  # e.g. "sb_abc123/state.json"
                sid = rel.split("/")[0]
                if not sid:
                    continue
                raw = _gcs_download_fresh(BUCKET_NAME, blob.name)
                if not raw:
                    continue
                data = json.loads(raw)
                config = data.get("session_config", {})
                iterations = data.get("iterations", [])
                # Count items and liked items
                item_count = sum(len(it.get("items", [])) for it in iterations)
                liked_count = 0
                for it in iterations:
                    liked_count += sum(1 for item in it.get("items", []) if item.get("feedback") == "liked")
                # First few image URLs for thumbnails (prefer thumb_url)
                thumbnails = []
                for it in iterations:
                    for item in it.get("items", []):
                        url = item.get("thumb_url") or item.get("content_url")
                        if url and len(thumbnails) < 3:
                            thumbnails.append(url)
                sessions.append({
                    "id": sid,
                    "query": config.get("initial_query", ""),
                    "thumbnail_urls": thumbnails,
                    "item_count": item_count,
                    "liked_count": liked_count,
                    "context": data.get("context", "standalone"),
                    "shot_id": data.get("shot_id"),
                    "character_id": data.get("character_id"),
                    "forked_from": data.get("forked_from"),
                    "created_at": data.get("created_at", ""),
                    "updated_at": data.get("updated_at", ""),
                })
            except Exception:
                pass
        sessions.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
        return sessions
    except Exception as e:
        print(f"[Soulboard] Error listing sessions for {project_name}: {e}")
        return []


def delete_soulboard_session(project_name: str, session_id: str, user_prefix: str = "") -> bool:
    """Delete a soulboard session and all its files from GCS."""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{SOULBOARD_PREFIX}" if user_prefix else SOULBOARD_PREFIX
        blobs = list(bucket.list_blobs(prefix=f"{prefix}/{project_name}/{session_id}/"))
        if blobs:
            bucket.delete_blobs(blobs)
        # Also delete generated images from public bucket
        pub_bucket = _get_bucket()
        pub_blobs = list(pub_bucket.list_blobs(prefix=f"soulboard/{project_name}/{session_id}/"))
        if pub_blobs:
            pub_bucket.delete_blobs(pub_blobs)
        print(f"[Soulboard] Deleted session: {project_name}/{session_id}")
        return True
    except Exception as e:
        print(f"[Soulboard] Error deleting session {project_name}/{session_id}: {e}")
        return False


def copy_soulboard_sessions(source_project: str, dest_project: str, user_prefix: str = "") -> int:
    """Copy all soulboard session files from one project to another via GCS server-side copy."""
    bucket = _get_sessions_bucket()
    prefix = f"{user_prefix}/{SOULBOARD_PREFIX}" if user_prefix else SOULBOARD_PREFIX
    src_prefix = f"{prefix}/{source_project}/"
    dst_prefix = f"{prefix}/{dest_project}/"
    count = 0
    for blob in bucket.list_blobs(prefix=src_prefix):
        new_name = dst_prefix + blob.name[len(src_prefix):]
        bucket.copy_blob(blob, bucket, new_name)
        count += 1
    return count


def copy_storyboard_files(source_name: str, dest_name: str, user_prefix: str = "") -> int:
    """Copy all storyboard result files (images, videos) from one project to another.
    Skips project.json since it will be written separately."""
    bucket = _get_sessions_bucket()
    prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
    src_prefix = f"{prefix}/{source_name}/"
    dst_prefix = f"{prefix}/{dest_name}/"
    count = 0
    for blob in bucket.list_blobs(prefix=src_prefix):
        if blob.name.endswith("/project.json") or blob.name.endswith("/summary.json"):
            continue
        new_name = dst_prefix + blob.name[len(src_prefix):]
        bucket.copy_blob(blob, bucket, new_name)
        count += 1
    return count


def delete_blob(blob_path: str) -> bool:
    """Delete a single blob by path. Returns True on success, False on failure."""
    if not blob_path or not is_blob_path(blob_path):
        return False
    try:
        _get_bucket().blob(blob_path).delete()
        return True
    except Exception as e:
        print(f"[GCS] Failed to delete blob {blob_path}: {e}")
        return False


STORYBOARD_PREFIX = "storyboard"


def _build_project_summary(name: str, data: dict) -> dict:
    """Extract lightweight metadata from project data for fast listing."""
    scene_count = len(data.get("scenes", []))
    shot_count = sum(len(s.get("shots", [])) for s in data.get("scenes", []))
    max_previews = 8
    preview_urls = []
    # Pass 1: first result from each scene
    for scene in data.get("scenes", []):
        found = False
        for shot in scene.get("shots", []):
            for r in shot.get("results", []):
                url = r.get("thumb_url") or r.get("url")
                if url:
                    preview_urls.append(url)
                    found = True
                    break
            if found:
                break
    # Pass 2: fill remaining sequentially from all shots
    if len(preview_urls) < max_previews:
        for scene in data.get("scenes", []):
            for shot in scene.get("shots", []):
                for r in shot.get("results", []):
                    url = r.get("thumb_url") or r.get("url")
                    if url and url not in preview_urls:
                        preview_urls.append(url)
                    if len(preview_urls) >= max_previews:
                        break
                if len(preview_urls) >= max_previews:
                    break
            if len(preview_urls) >= max_previews:
                break
    # Pass 3: fill from supplementary
    ps = data.get("project_state", {})
    if len(preview_urls) < max_previews:
        for item in (ps.get("generated_supplementary") or {}).values():
            url = item.get("thumb_url") or item.get("url")
            if url and url not in preview_urls:
                preview_urls.append(url)
            if len(preview_urls) >= max_previews:
                break
    # Pass 4: fill from character gallery (ranked turnarounds first, then variations)
    if len(preview_urls) < max_previews:
        gallery = ps.get("character_gallery") or {}
        for char_id in (ps.get("character_gallery_order") or list(gallery.keys())):
            char = gallery.get(char_id, {})
            ranked = char.get("turnaround_ranked_ids") or []
            turnarounds = {t.get("id"): t for t in (char.get("turnarounds") or [])}
            # Ranked turnarounds first, then any unranked
            for rid in ranked:
                t = turnarounds.get(rid)
                if not t:
                    continue
                url = t.get("thumb_url") or t.get("url")
                if url and url not in preview_urls:
                    preview_urls.append(url)
                if len(preview_urls) >= max_previews:
                    break
            if len(preview_urls) >= max_previews:
                break
            # Variations as fallback
            for v in (char.get("variations") or []):
                url = v.get("thumb_url") or v.get("url")
                if url and url not in preview_urls:
                    preview_urls.append(url)
                if len(preview_urls) >= max_previews:
                    break
            if len(preview_urls) >= max_previews:
                break
    return {
        "name": name,
        "created_at": data.get("created_at", ""),
        "updated_at": data.get("updated_at", ""),
        "scene_count": scene_count,
        "shot_count": shot_count,
        "preview_urls": preview_urls,
        # TODO: add team, credits, storage, sharing fields when those features are built
    }


def save_storyboard_project(name: str, data: dict, user_prefix: str = "") -> str:
    """Save a storyboard project JSON + lightweight summary to sessions bucket"""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        blob = bucket.blob(f"{prefix}/{name}/project.json")
        blob.upload_from_string(
            json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"),
            content_type="application/json"
        )
        summary = _build_project_summary(name, data)
        s_blob = bucket.blob(f"{prefix}/{name}/summary.json")
        s_blob.upload_from_string(
            json.dumps(summary, ensure_ascii=False).encode("utf-8"),
            content_type="application/json"
        )
        print(f"[Storyboard] Saved project: {name}")
        return name
    except Exception as e:
        print(f"[Storyboard] Error saving project {name}: {e}")
        raise


def get_storyboard_project(name: str, user_prefix: str = "") -> Optional[dict]:
    """Load a storyboard project by name"""
    try:
        prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        raw = _gcs_download_fresh(BUCKET_NAME, f"{prefix}/{name}/project.json")
        return json.loads(raw) if raw else None
    except Exception as e:
        print(f"[Storyboard] Error loading project {name}: {e}")
        return None


def list_storyboard_projects(user_prefix: str = "") -> list:
    """List all storyboard projects by reading lightweight summary.json files."""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        summaries = []
        for blob in bucket.list_blobs(match_glob=f"{prefix}/*/summary.json"):
            try:
                raw = _gcs_download_fresh(BUCKET_NAME, blob.name)
                if not raw:
                    continue
                summaries.append(json.loads(raw))
            except Exception:
                pass
        summaries.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
        return summaries
    except Exception as e:
        print(f"[Storyboard] Error listing projects: {e}")
        return []


def delete_storyboard_project(name: str, user_prefix: str = "") -> bool:
    """Delete a storyboard project and all its files, including soulboard sessions"""
    try:
        bucket = _get_sessions_bucket()
        sb_pfx = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        soul_pfx = f"{user_prefix}/{SOULBOARD_PREFIX}" if user_prefix else SOULBOARD_PREFIX
        blobs = list(bucket.list_blobs(prefix=f"{sb_pfx}/{name}/"))
        if blobs:
            bucket.delete_blobs(blobs)
        # Clean up soulboard sessions scoped to this project
        sb_blobs = list(bucket.list_blobs(prefix=f"{soul_pfx}/{name}/"))
        if sb_blobs:
            bucket.delete_blobs(sb_blobs)
        print(f"[Storyboard] Deleted project: {name}")
        return True
    except Exception as e:
        print(f"[Storyboard] Error deleting project {name}: {e}")
        return False


# --- Agent Trace storage ---

TRACES_FOLDER = "traces"


def save_agent_trace(project_name: str, trace_id: str, data: dict, user_prefix: str = "") -> bool:
    """Save an agent trace JSON alongside the project in GCS."""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        blob = bucket.blob(f"{prefix}/{project_name}/{TRACES_FOLDER}/{trace_id}.json")
        blob.upload_from_string(
            json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"),
            content_type="application/json",
        )
        print(f"[Trace] Saved: {project_name}/{trace_id}")
        return True
    except Exception as e:
        print(f"[Trace] Error saving {project_name}/{trace_id}: {e}")
        return False


def list_agent_traces(project_name: str, user_prefix: str = "", limit: int = 50) -> list:
    """List recent agent traces for a project (newest first)."""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        traces_prefix = f"{prefix}/{project_name}/{TRACES_FOLDER}/"
        items = []
        for blob in bucket.list_blobs(prefix=traces_prefix):
            if not blob.name.endswith(".json"):
                continue
            name = blob.name.rsplit("/", 1)[-1].replace(".json", "")
            items.append({
                "trace_id": name,
                "updated": blob.updated.isoformat() if blob.updated else "",
                "size": blob.size,
            })
        items.sort(key=lambda x: x["trace_id"], reverse=True)
        return items[:limit]
    except Exception as e:
        print(f"[Trace] Error listing traces for {project_name}: {e}")
        return []


def get_agent_trace(project_name: str, trace_id: str, user_prefix: str = "") -> Optional[dict]:
    """Load a single agent trace by ID."""
    try:
        prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        raw = _gcs_download_fresh(BUCKET_NAME, f"{prefix}/{project_name}/{TRACES_FOLDER}/{trace_id}.json")
        return json.loads(raw) if raw else None
    except Exception as e:
        print(f"[Trace] Error loading {project_name}/{trace_id}: {e}")
        return None


# --- Agent Result persistence (recovery after refresh) ---

AGENT_RESULT_FOLDER = "agent"


def save_agent_result(project_name: str, thread_id: str, data: dict, user_prefix: str = "") -> bool:
    """Save a completed agent result for recovery after page refresh.
    Path: {uid}/storyboard/{project}/agent/{thread_id}.json
    Overwritten on next request to the same thread (natural cleanup).
    """
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        blob = bucket.blob(f"{prefix}/{project_name}/{AGENT_RESULT_FOLDER}/{thread_id}.json")
        blob.upload_from_string(
            json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"),
            content_type="application/json",
        )
        print(f"[AgentResult] Saved: {project_name}/{thread_id}")
        return True
    except Exception as e:
        print(f"[AgentResult] Error saving {project_name}/{thread_id}: {e}")
        return False


def get_agent_results(project_name: str, user_prefix: str = "") -> dict:
    """Load all agent results for a project. Returns {thread_id: data_dict}."""
    try:
        bucket = _get_sessions_bucket()
        prefix = f"{user_prefix}/{STORYBOARD_PREFIX}" if user_prefix else STORYBOARD_PREFIX
        results_prefix = f"{prefix}/{project_name}/{AGENT_RESULT_FOLDER}/"
        results = {}
        for blob in bucket.list_blobs(prefix=results_prefix):
            if not blob.name.endswith(".json"):
                continue
            thread_id = blob.name.rsplit("/", 1)[-1].replace(".json", "")
            try:
                raw = blob.download_as_text()
                results[thread_id] = json.loads(raw)
            except Exception:
                continue
        return results
    except Exception as e:
        print(f"[AgentResult] Error loading results for {project_name}: {e}")
        return {}


