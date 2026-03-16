"""Music generation -- Google Lyria 2 via Vertex AI Prediction API.

Part of the interleaved multimodal pipeline: the creative agent generates music
that complements the visual narrative. Audio tracks stream to the frontend as
SSE events alongside text and image generation, completing the see/hear/create
experience. Cloud-native: generated tracks stored in GCS.
"""

import uuid
import time
import base64
import logging
import requests as http_requests
from typing import Dict, Any
from concurrent.futures import ThreadPoolExecutor, Future

from google.cloud import storage
from google.auth.transport.requests import Request

from ..config import GCP_PROJECT_ID, CREDENTIALS, BUCKET_NAME
from ..gcs_utils import sign_url
from ..errors import sanitize_error

logger = logging.getLogger(__name__)

_TEMP_FOLDER = "lyria_temp"
# Lyria 2 is available in us-central1 via Vertex AI prediction API
_LYRIA_LOCATION = "us-central1"
_LYRIA_MODEL = "lyria-002"


class LyriaClient:
    """Music generation via Lyria 2 (Vertex AI Prediction API).
    Generates 30-second instrumental WAV audio at 48kHz from text prompts."""

    def __init__(self):
        self._credentials = None
        self._init_error = None
        self._pool = ThreadPoolExecutor(max_workers=2)
        self._tasks: Dict[str, Future] = {}
        self._results: Dict[str, Dict[str, Any]] = {}
        self._init_client()

    def _init_client(self):
        try:
            if not GCP_PROJECT_ID:
                self._init_error = "GCP_PROJECT_ID not configured"
                return
            if not CREDENTIALS:
                self._init_error = "GCP credentials not configured"
                return
            self._credentials = CREDENTIALS
            logger.info("[Lyria] Client initialized (Vertex AI, %s)", _LYRIA_LOCATION)
        except Exception as e:
            self._init_error = str(e)
            logger.warning("[Lyria] Init warning: %s", e)

    def _get_auth_token(self) -> str:
        """Get a fresh OAuth2 token for the Vertex AI API."""
        self._credentials.refresh(Request())
        return self._credentials.token

    def generate_music(
        self,
        prompt: str,
        name: str,
        duration_seconds: int = 60,
        instrumental: bool = True,
    ) -> Dict[str, Any]:
        """Submit music generation. Returns {success, task_id, provider}."""
        if self._init_error:
            return {"success": False, "error": f"Lyria not available: {self._init_error}"}

        task_id = f"lyria_{uuid.uuid4().hex[:12]}"

        logger.info(
            "[Lyria] Submitting task %s (%ds, instrumental=%s): %.80s",
            task_id, duration_seconds, instrumental, prompt,
        )

        future = self._pool.submit(
            self._run_generation, prompt, name, duration_seconds, instrumental, task_id
        )
        self._tasks[task_id] = future
        return {"success": True, "task_id": task_id, "provider": "lyria"}

    def _run_generation(
        self,
        prompt: str,
        name: str,
        duration_seconds: int,
        instrumental: bool,
        task_id: str,
    ) -> Dict[str, Any]:
        """Synchronous Lyria 2 generation via Vertex AI prediction endpoint."""
        try:
            endpoint = (
                f"https://{_LYRIA_LOCATION}-aiplatform.googleapis.com/v1/"
                f"projects/{GCP_PROJECT_ID}/locations/{_LYRIA_LOCATION}/"
                f"publishers/google/models/{_LYRIA_MODEL}:predict"
            )

            token = self._get_auth_token()
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
            payload = {
                "instances": [{"prompt": prompt}],
            }

            logger.info("[Lyria] Calling prediction API for task %s", task_id)
            resp = http_requests.post(endpoint, json=payload, headers=headers, timeout=60)

            if resp.status_code != 200:
                error_msg = resp.text[:300]
                logger.error("[Lyria] API error %d: %s", resp.status_code, error_msg)
                return {"task_id": task_id, "status": "failed", "error": sanitize_error(error_msg)}

            data = resp.json()
            predictions = data.get("predictions", [])
            if not predictions:
                return {"task_id": task_id, "status": "failed", "error": "No predictions in response"}

            # Lyria returns base64-encoded WAV audio
            audio_b64 = dict(predictions[0]).get("bytesBase64Encoded", "")
            if not audio_b64:
                return {"task_id": task_id, "status": "failed", "error": "No audio data in prediction"}

            audio_bytes = base64.b64decode(audio_b64)
            logger.info("[Lyria] Got audio: %d bytes", len(audio_bytes))

            # Upload to GCS
            storage_client = storage.Client(credentials=CREDENTIALS)
            bucket = storage_client.bucket(BUCKET_NAME)
            blob_path = f"{_TEMP_FOLDER}/{task_id}_{name}.wav"
            blob = bucket.blob(blob_path)
            blob.upload_from_string(audio_bytes, content_type="audio/wav")
            logger.info("[Lyria] Uploaded to GCS: %s (%d bytes)", blob_path, len(audio_bytes))

            return {
                "task_id": task_id,
                "status": "succeed",
                "blob_path": blob_path,
                "name": name,
                "duration_seconds": 30,  # Lyria 2 outputs fixed 30s
            }

        except Exception as e:
            error_msg = sanitize_error(str(e))
            logger.error("[Lyria] Generation error for task %s: %s", task_id, error_msg)
            return {"task_id": task_id, "status": "failed", "error": error_msg}

    def query_task(self, task_id: str) -> Dict[str, Any]:
        """Check task status. Returns signed GCS URL as result_url on success."""
        task_id = str(task_id)

        if task_id in self._results:
            return self._results[task_id]

        future = self._tasks.get(task_id)
        if not future:
            return {"task_id": task_id, "status": "failed", "error": "Unknown task"}

        if not future.done():
            return {"task_id": task_id, "status": "processing"}

        try:
            result = future.result()
        except Exception as e:
            logger.error("[Lyria] Task %s raised: %s", task_id, e)
            result = {"status": "failed", "error": sanitize_error(str(e))}

        del self._tasks[task_id]

        if result.get("status") == "succeed":
            blob_path = result["blob_path"]
            signed = sign_url(blob_path)
            resolved = {
                "task_id": task_id,
                "status": "succeed",
                "result_url": signed,
                "blob_path": blob_path,
                "name": result.get("name"),
                "duration_seconds": result.get("duration_seconds"),
            }
        else:
            resolved = {
                "task_id": task_id,
                "status": "failed",
                "error": result.get("error", "Generation failed"),
            }

        self._results[task_id] = resolved
        return resolved

    def wait_for_completion(
        self,
        task_id: str,
        max_wait: int = 120,
        check_interval: int = 2,
    ) -> Dict[str, Any]:
        """Poll until the task completes or times out."""
        start = time.time()

        while time.time() - start < max_wait:
            result = self.query_task(task_id)
            status = result.get("status")

            if status in ("succeed", "failed"):
                return result

            elapsed = int(time.time() - start)
            logger.info("[Lyria] Task %s: %s (%ds)", task_id, status, elapsed)
            time.sleep(check_interval)

        return {"task_id": task_id, "status": "timeout", "error": f"Timeout after {max_wait}s"}
