"""
Nano Banana image generation -- Google GenAI SDK (Gemini 3 Pro Image via Vertex AI).

Part of the interleaved multimodal pipeline: the creative agent generates text
explanations while simultaneously producing images through this client. Results
stream to the frontend as SSE events, appearing in the timeline alongside the
agent's conversational output.

Uses response_modalities=["IMAGE"] for production-quality generation via FC tools.
The agent also has access to response_modalities=["TEXT", "IMAGE"] for inline
concept sketches during conversation (handled in llm.py).

Generated images upload to GCS for cloud-native persistence and are served
via signed URLs.
"""

import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Dict, Any, Optional, List

from google import genai
from google.genai import types
from google.cloud import storage

from ..config import GCP_PROJECT_ID, CREDENTIALS, BUCKET_NAME
from ..gcs_utils import sign_url

logger = logging.getLogger(__name__)

# Thread pool for background Gemini generation calls
_executor = ThreadPoolExecutor(max_workers=6)

# Aspect ratio mapping: preset names and pass-through ratios
ASPECT_RATIOS = {
    "vertical": "9:16",
    "horizontal": "16:9",
    "square": "1:1",
    "portrait": "3:4",
    "landscape": "4:3",
    "cinematic": "21:9",
    "9:16": "9:16",
    "16:9": "16:9",
    "1:1": "1:1",
    "3:4": "3:4",
    "4:3": "4:3",
    "21:9": "21:9",
}

# Temp GCS folder for generated images before callers migrate them to project storage
_TEMP_FOLDER = "nano_banana_temp"


def _build_contents(
    prompt: str,
    reference_images: Optional[List[str]] = None,
) -> list:
    """Build Gemini content parts: optional reference images followed by text prompt."""
    parts = []
    if reference_images:
        for uri in reference_images:
            # gs:// URIs and HTTP URLs both supported via Part.from_uri
            parts.append(types.Part.from_uri(file_uri=uri, mime_type="image/png"))
    parts.append(types.Part.from_text(text=prompt))
    return parts


def _run_generation(
    prompt: str,
    aspect_ratio: str,
    reference_images: Optional[List[str]],
    task_id: str,
) -> Dict[str, Any]:
    """Synchronous Gemini image generation call. Runs inside the thread pool.

    Sends a multimodal request to Gemini 3 Pro Image via the Google GenAI SDK,
    extracts the generated image bytes, and uploads to GCS.
    """
    gemini_ratio = ASPECT_RATIOS.get(aspect_ratio, "16:9")

    client = genai.Client(
        vertexai=True,
        project=GCP_PROJECT_ID,
        location="global",
        credentials=CREDENTIALS,
    )

    contents = _build_contents(prompt, reference_images)

    try:
        response = client.models.generate_content(
            model="gemini-3-pro-image-preview",
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(aspect_ratio=gemini_ratio),
            ),
        )
    except Exception as e:
        logger.error("[NanoBanana] Gemini generation error: %s", e)
        return {"status": "failed", "error": str(e)}

    # Extract image bytes from the multimodal response
    image_bytes = None
    if response.candidates:
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                image_bytes = part.inline_data.data
                break

    if not image_bytes:
        return {"status": "failed", "error": "No image data in Gemini response"}

    # Upload to GCS temp location
    try:
        storage_client = storage.Client(credentials=CREDENTIALS)
        bucket = storage_client.bucket(BUCKET_NAME)
        blob_path = f"{_TEMP_FOLDER}/{task_id}.png"
        blob = bucket.blob(blob_path)
        blob.upload_from_string(image_bytes, content_type="image/png")
        logger.info("[NanoBanana] Uploaded to GCS: %s (%d bytes)", blob_path, len(image_bytes))
        return {"status": "succeed", "blob_path": blob_path}
    except Exception as e:
        logger.error("[NanoBanana] GCS upload error: %s", e)
        return {"status": "failed", "error": f"GCS upload failed: {e}"}


class NanoBananaClient:
    """Image generation client using Google GenAI SDK (Gemini 3 Pro Image).

    Provides storyboard frame generation, character design, and supplementary
    content as part of the multimodal creative pipeline. Uses Vertex AI for
    inference and GCS for result storage.
    """

    def __init__(self, api_key: Optional[str] = None):
        # In-flight generation futures keyed by task_id
        self._futures: Dict[str, Future] = {}
        # Completed results keyed by task_id
        self._results: Dict[str, Dict[str, Any]] = {}
        logger.info("[NanoBanana] Provider: gemini (Google GenAI SDK)")

    def generate_image(
        self,
        prompt: str,
        aspect_ratio: str = "horizontal",
        reference_images: Optional[List[str]] = None,
        image_size: str = "2K",
    ) -> Dict[str, Any]:
        """Submit an image generation request via Gemini 3 Pro Image.

        Returns immediately with a synthetic task_id. The actual generation
        runs in a background thread. Poll with query_task() for results.

        Args:
            prompt: Text description of the image to generate.
            aspect_ratio: Preset name or ratio string (e.g. 'horizontal', '16:9').
            reference_images: Optional gs:// URIs or URLs for reference-guided generation.
            image_size: Accepted for interface compat; Gemini controls output via aspect_ratio.
        """
        task_id = uuid.uuid4().hex[:16]

        logger.info(
            "[NanoBanana] Submitting task %s (%s, refs=%d): %.80s",
            task_id,
            aspect_ratio,
            len(reference_images or []),
            prompt,
        )

        future = _executor.submit(
            _run_generation, prompt, aspect_ratio, reference_images, task_id
        )
        self._futures[task_id] = future

        return {"success": True, "task_id": task_id, "provider": "nano_banana"}

    def query_task(self, task_id) -> Dict[str, Any]:
        """Check generation status. Returns signed GCS URL as result_url on success.

        Callers (main.py, tools.py) download from result_url and persist
        to project-scoped GCS storage.
        """
        task_id = str(task_id)

        # Already resolved
        if task_id in self._results:
            return self._results[task_id]

        future = self._futures.get(task_id)
        if future is None:
            return {"task_id": task_id, "status": "failed", "error": "Unknown task_id"}

        if not future.done():
            return {"task_id": task_id, "status": "processing"}

        # Resolve the future
        try:
            result = future.result()
        except Exception as e:
            logger.error("[NanoBanana] Task %s raised: %s", task_id, e)
            result = {"status": "failed", "error": str(e)}

        del self._futures[task_id]

        if result.get("status") == "succeed":
            blob_path = result["blob_path"]
            signed = sign_url(blob_path)
            resolved = {
                "task_id": task_id,
                "status": "succeed",
                "result_url": signed,
                "blob_path": blob_path,
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
        task_id,
        max_wait: int = None,
        check_interval: int = None,
    ) -> Dict[str, Any]:
        """Poll until the task completes or times out."""
        max_wait = max_wait or 120
        check_interval = check_interval or 1
        start = time.time()

        while time.time() - start < max_wait:
            result = self.query_task(task_id)
            status = result.get("status")

            if status in ("succeed", "failed"):
                return result

            elapsed = int(time.time() - start)
            logger.info("[NanoBanana] Task %s: %s (%ds)", task_id, status, elapsed)
            time.sleep(check_interval)

        return {"task_id": str(task_id), "status": "timeout", "error": f"Timeout after {max_wait}s"}
