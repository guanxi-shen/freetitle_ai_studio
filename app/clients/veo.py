"""
Video generation -- Google GenAI SDK (Veo via Vertex AI).

Part of the interleaved multimodal pipeline: converts storyboard frames into
video clips. The creative agent generates storyboard images, then produces videos
from those frames -- all streaming to the frontend as interleaved SSE events.
Supports image-to-video and dual-frame interpolation for precise scene transitions.

Cloud-native: GCS storage, Vertex AI inference, signed URL delivery.
"""

import uuid
import time
import logging
import requests
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Dict, Any, Optional

from google import genai
from google.genai import types

from ..config import GCP_PROJECT_ID, CREDENTIALS, BUCKET_NAME, VIDEO_POLL_CONFIG
from ..gcs_utils import sign_url, upload_bytes_to_gcs
from ..errors import sanitize_error

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Vertex AI Veo model identifier
VEO_MODEL = "veo-3.1-generate-preview"


def _resolve_image_url(url: Optional[str]) -> Optional[str]:
    """Convert gs:// blob paths to signed HTTPS URLs for the Veo API."""
    if not url:
        return None
    # Blob paths (no scheme) need signing
    if not url.startswith("http") and not url.startswith("gs://"):
        signed = sign_url(url)
        return signed if signed else None
    # gs:// URIs need signing via blob path extraction
    if url.startswith("gs://"):
        # Strip gs://bucket_name/ prefix to get blob path
        parts = url.replace("gs://", "").split("/", 1)
        if len(parts) == 2:
            blob_path = parts[1]
            signed = sign_url(blob_path)
            return signed if signed else None
        return None
    return url


def _download_image_bytes(url: str) -> Optional[bytes]:
    """Download image from URL, return bytes or None on failure."""
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        if len(resp.content) > 0:
            return resp.content
        return None
    except Exception as e:
        logger.warning(f"[Veo] Failed to download image: {e}")
        return None


class VeoClient:
    """Direct Google GenAI SDK client for Veo video generation.
    Direct Vertex AI integration for video generation."""

    def __init__(self):
        self._client = None
        self._init_error = None
        self._pool = ThreadPoolExecutor(max_workers=4)
        # task_id -> Future mapping for async generation
        self._tasks: Dict[str, Future] = {}
        # task_id -> result dict for completed tasks
        self._results: Dict[str, Dict[str, Any]] = {}

        self._init_client()

    def _init_client(self):
        """Initialize the Google GenAI client with Vertex AI credentials."""
        try:
            if not GCP_PROJECT_ID:
                self._init_error = "GCP_PROJECT_ID not configured"
                logger.warning(f"[Veo] {self._init_error}")
                return
            if not CREDENTIALS:
                self._init_error = "GCP credentials not configured"
                logger.warning(f"[Veo] {self._init_error}")
                return

            self._client = genai.Client(
                vertexai=True,
                project=GCP_PROJECT_ID,
                location="global",
                credentials=CREDENTIALS,
            )
            logger.info(f"[Veo] Initialized GenAI client (project={GCP_PROJECT_ID})")
        except Exception as e:
            self._init_error = f"Failed to initialize GenAI client: {e}"
            logger.error(f"[Veo] {self._init_error}")

    def _generate_worker(
        self,
        task_id: str,
        prompt: str,
        first_frame_url: Optional[str],
        last_frame_url: Optional[str],
        aspect_ratio: str,
    ):
        """Background worker: call Veo API, download result, upload to GCS."""
        try:
            # Build generation config
            config_kwargs = {
                "aspect_ratio": aspect_ratio,
                "number_of_videos": 1,
            }

            # Resolve frame URLs to HTTPS for the API
            first_url = _resolve_image_url(first_frame_url)
            last_url = _resolve_image_url(last_frame_url)

            # Build the image for first frame reference
            image = None
            if first_url:
                first_bytes = _download_image_bytes(first_url)
                if first_bytes:
                    image = types.Image(image_bytes=first_bytes, mime_type="image/png")
                    logger.info(f"[Veo] Using first frame ({len(first_bytes)} bytes)")
                else:
                    logger.warning("[Veo] Could not download first frame, proceeding text-only")

            # Dual-frame: pass last frame via config if supported
            if last_url and first_url:
                last_bytes = _download_image_bytes(last_url)
                if last_bytes:
                    config_kwargs["end_image"] = types.Image(
                        image_bytes=last_bytes, mime_type="image/png"
                    )
                    logger.info(f"[Veo] Using last frame ({len(last_bytes)} bytes)")

            config = types.GenerateVideosConfig(**config_kwargs)

            # Call Veo API
            logger.info(f"[Veo] Calling generate_videos: {prompt[:60]}...")

            try:
                operation = self._client.models.generate_videos(
                    model=VEO_MODEL,
                    prompt=prompt,
                    image=image,
                    config=config,
                )
            except AttributeError:
                # generate_videos may not exist in current SDK version
                self._results[task_id] = {
                    "task_id": task_id,
                    "status": "failed",
                    "error": (
                        "Veo generate_videos not available in current google-genai SDK. "
                        "Update to latest version: pip install -U google-genai"
                    ),
                }
                logger.error("[Veo] generate_videos method not found in SDK")
                return

            # Poll the long-running operation
            logger.info("[Veo] Operation submitted, polling for result...")
            max_wait = VIDEO_POLL_CONFIG["max_wait_time"]
            poll_interval = VIDEO_POLL_CONFIG["poll_interval"]
            start = time.time()

            while not operation.done and time.time() - start < max_wait:
                elapsed = int(time.time() - start)
                if elapsed % 15 == 0:
                    logger.info(f"[Veo] Task {task_id}: polling ({elapsed}s)")
                time.sleep(poll_interval)
                operation = self._client.operations.get(operation)

            if not operation.done:
                self._results[task_id] = {
                    "task_id": task_id,
                    "status": "timeout",
                    "error": f"Veo operation timed out after {max_wait}s",
                }
                return

            # Extract video from response
            generated_videos = getattr(operation.response, "generated_videos", None)
            if not generated_videos:
                self._results[task_id] = {
                    "task_id": task_id,
                    "status": "failed",
                    "error": "No video data in Veo response",
                }
                return

            generated_video = generated_videos[0]

            # Extract video bytes directly from response
            video_bytes = getattr(generated_video.video, "video_bytes", None)
            if video_bytes:
                logger.info(f"[Veo] Got video bytes from response ({len(video_bytes)} bytes)")
            else:
                # Fallback: download from URI if bytes not inline
                uri = getattr(generated_video.video, "uri", None)
                if uri:
                    try:
                        resp = requests.get(uri, timeout=120)
                        resp.raise_for_status()
                        video_bytes = resp.content
                        logger.info(f"[Veo] Downloaded video from URI ({len(video_bytes)} bytes)")
                    except Exception as e:
                        logger.error(f"[Veo] URI download failed: {e}")

            # Upload to GCS
            blob_path = ""
            if video_bytes:
                timestamp = time.strftime("%Y%m%d_%H%M%S")
                folder = f"freetitle_ai_studio/veo/{timestamp}"
                filename = f"{task_id}.mp4"
                blob_path = upload_bytes_to_gcs(
                    video_bytes, folder, filename, content_type="video/mp4"
                )
                logger.info(f"[Veo] Uploaded video to GCS: {blob_path}")

            if blob_path:
                signed = sign_url(blob_path)
                self._results[task_id] = {
                    "task_id": task_id,
                    "status": "succeed",
                    "result_url": signed,
                    "blob_path": blob_path,
                }
            else:
                self._results[task_id] = {
                    "task_id": task_id,
                    "status": "failed",
                    "error": "No video data in Veo response",
                }

        except Exception as e:
            logger.error(f"[Veo] Worker error for {task_id}: {e}")
            self._results[task_id] = {
                "task_id": task_id,
                "status": "failed",
                "error": sanitize_error(str(e)),
            }

    def generate_video(
        self,
        prompt: str,
        first_frame_url: Optional[str] = None,
        last_frame_url: Optional[str] = None,
        aspect_ratio: str = "16:9",
        size: str = "720p",
    ) -> Dict[str, Any]:
        """
        Submit video generation to the thread pool.

        Args:
            prompt: Text description for video generation
            first_frame_url: Start frame image URL or blob path (enables img2video)
            last_frame_url: End frame image URL or blob path (dual-frame interpolation)
            aspect_ratio: "16:9" or "9:16"
            size: Resolution hint (passed for interface compat, Veo controls output res)
        """
        if self._init_error:
            return {"success": False, "error": self._init_error}

        if not self._client:
            return {"success": False, "error": "Veo client not initialized"}

        if last_frame_url and not first_frame_url:
            return {"success": False, "error": "last_frame_url requires first_frame_url"}

        if aspect_ratio not in ("16:9", "9:16"):
            logger.warning(f"[Veo] Invalid aspect ratio {aspect_ratio}, defaulting to 16:9")
            aspect_ratio = "16:9"

        task_id = f"veo_{uuid.uuid4().hex[:12]}"

        logger.info(f"[Veo] Submitting {task_id}: {prompt[:50]}...")

        future = self._pool.submit(
            self._generate_worker,
            task_id,
            prompt,
            first_frame_url,
            last_frame_url,
            aspect_ratio,
        )
        self._tasks[task_id] = future

        return {
            "success": True,
            "task_id": task_id,
            "provider": "veo",
        }

    def query_task(self, task_id: str) -> Dict[str, Any]:
        """Check task status. Returns standard polling format."""
        # Completed result cached
        if task_id in self._results:
            return self._results[task_id]

        future = self._tasks.get(task_id)
        if not future:
            return {
                "task_id": task_id,
                "status": "failed",
                "error": "Unknown task ID",
            }

        if future.done():
            # Worker finished but may have stored result
            exc = future.exception()
            if exc:
                return {
                    "task_id": task_id,
                    "status": "failed",
                    "error": sanitize_error(str(exc)),
                }
            # Result should be in self._results by now
            return self._results.get(task_id, {
                "task_id": task_id,
                "status": "failed",
                "error": "Worker completed without storing result",
            })

        return {"task_id": task_id, "status": "processing"}

    def wait_for_completion(
        self,
        task_id: str,
        max_wait: int = None,
        check_interval: int = None,
    ) -> Dict[str, Any]:
        """Wait for task completion with polling."""
        max_wait = max_wait or VIDEO_POLL_CONFIG["max_wait_time"]
        check_interval = check_interval or VIDEO_POLL_CONFIG["poll_interval"]
        start_time = time.time()

        while time.time() - start_time < max_wait:
            result = self.query_task(task_id)
            status = result.get("status")

            if status in ("succeed", "failed"):
                return result

            elapsed = int(time.time() - start_time)
            logger.info(f"[Veo] Task {task_id}: {status} ({elapsed}s)")
            time.sleep(check_interval)

        return {
            "task_id": task_id,
            "status": "timeout",
            "error": f"Timeout after {max_wait}s",
        }
