"""FreeTitle AI Studio -- Configuration

Google Cloud-native creative production system.
All generation providers use the Google GenAI SDK (Vertex AI).
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv
from google.oauth2 import service_account

# Load environment variables from local .env
ENV_PATH = Path(__file__).parent.parent / ".env"
load_dotenv(ENV_PATH)

# ---------------------------------------------------------------------------
# Agent configuration
# ---------------------------------------------------------------------------

# Full agent pipeline logging (timing, tool calls, state events)
AGENT_DEBUG = True

# Persist full request traces to GCS for debugging and demo replay
AGENT_TRACE = True

# Sub-agent concurrency limit per request
MAX_PARALLEL_SUB_AGENTS = 8

# Multimodal FC responses: return generated images/videos to the agent
# so Gemini can reason about its own outputs in subsequent turns.
# Tools convert CDN URLs to gs:// URIs via url_to_blob_path + blob_path_to_gs_uri
AGENT_MULTIMODAL_IMAGES = True
AGENT_MULTIMODAL_VIDEOS = True

# ---------------------------------------------------------------------------
# Google Cloud Platform
# ---------------------------------------------------------------------------

GCP_PROJECT_ID = os.getenv('GCP_PROJECT_ID')
BUCKET_NAME = os.getenv('BUCKET_NAME')
PUBLIC_BUCKET_NAME = os.getenv('PUBLIC_BUCKET_NAME')

# ---------------------------------------------------------------------------
# Nano Banana -- image generation via Google GenAI SDK (Vertex AI)
# Uses Gemini's native image output for storyboard frames, characters, assets.
# ---------------------------------------------------------------------------

NANO_BANANA_CONFIG = {
    "model": "gemini-3-pro-image-preview",
    "max_wait_time": 120,
    "poll_interval": 1,
    "aspect_ratios": {
        "vertical": "9:16",
        "horizontal": "16:9",
        "square": "1:1",
        "cinematic": "21:9",
        "portrait": "3:4",
        "landscape": "4:3",
        "3:2": "3:2",
        "2:3": "2:3",
        "5:4": "5:4",
        "4:5": "4:5",
        "9:16": "9:16",
        "16:9": "16:9",
        "1:1": "1:1",
        "4:3": "4:3",
        "3:4": "3:4",
        "21:9": "21:9",
    }
}

# ---------------------------------------------------------------------------
# Veo -- video generation via Google GenAI SDK (Vertex AI)
# Generates video clips from prompts + optional start/end frame images.
# ---------------------------------------------------------------------------

VEO_CONFIG = {
    "model": "veo-3.1-generate-preview",
    "default_size": "1080p",
    "sizes": ["720p", "1080p"],
    "aspect_ratios": {
        "vertical": "9:16",
        "horizontal": "16:9",
    }
}

# Video generation polling defaults
VIDEO_POLL_CONFIG = {
    "max_wait_time": 600,  # 10 minutes
    "poll_interval": 3
}

# ---------------------------------------------------------------------------
# LLM / prompt optimizer
# ---------------------------------------------------------------------------

OPTIMIZER_DEBUG = True

# ---------------------------------------------------------------------------
# GCP credentials -- used by all Google GenAI SDK clients and GCS
# ---------------------------------------------------------------------------

CREDENTIALS = None

def initialize_credentials():
    """Initialize GCP credentials from environment.
    Supports both inline JSON (credentials_dict) and file path (GOOGLE_APPLICATION_CREDENTIALS).
    """
    global CREDENTIALS

    credentials_json = os.getenv('credentials_dict')
    if credentials_json:
        try:
            credentials_info = json.loads(credentials_json)
            CREDENTIALS = service_account.Credentials.from_service_account_info(
                credentials_info,
                scopes=['https://www.googleapis.com/auth/cloud-platform']
            )
            print("[Config] Initialized credentials from credentials_dict")
            return CREDENTIALS
        except Exception as e:
            print(f"[Config] Error parsing credentials_dict: {e}")

    creds_file = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if creds_file and os.path.exists(creds_file):
        try:
            CREDENTIALS = service_account.Credentials.from_service_account_file(
                creds_file,
                scopes=['https://www.googleapis.com/auth/cloud-platform']
            )
            print(f"[Config] Initialized credentials from file: {creds_file}")
            return CREDENTIALS
        except Exception as e:
            print(f"[Config] Error loading credentials file: {e}")

    print("[Config] Warning: No GCP credentials found")
    return None

# Initialize on import
initialize_credentials()
