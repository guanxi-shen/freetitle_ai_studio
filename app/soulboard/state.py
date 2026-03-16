"""Soulboard state schema and in-memory storage with multi-session support + auto-eviction"""

import time
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# In-memory state keyed by "project_name:session_id"
_sessions: Dict[str, Dict[str, Any]] = {}
_last_access: Dict[str, float] = {}

# Evict sessions idle for more than 1 hour
EVICTION_TIMEOUT = 3600


def _key(project_name: str, session_id: str) -> str:
    return f"{project_name}:{session_id}"


def _evict_stale():
    """Remove sessions idle longer than EVICTION_TIMEOUT"""
    now = time.time()
    stale = [k for k, t in _last_access.items() if now - t > EVICTION_TIMEOUT]
    for k in stale:
        _sessions.pop(k, None)
        _last_access.pop(k, None)
    if stale:
        logger.info(f"[Soulboard] Evicted {len(stale)} idle sessions")


def get_state(project_name: str, session_id: str) -> Optional[Dict[str, Any]]:
    _evict_stale()
    k = _key(project_name, session_id)
    state = _sessions.get(k)
    if state:
        _last_access[k] = time.time()
    return state


def set_state(project_name: str, session_id: str, state: Dict[str, Any]):
    k = _key(project_name, session_id)
    _sessions[k] = state
    _last_access[k] = time.time()


def clear_state(project_name: str, session_id: str):
    k = _key(project_name, session_id)
    _sessions.pop(k, None)
    _last_access.pop(k, None)


def list_in_memory(project_name: str) -> Dict[str, Dict[str, Any]]:
    """Return all in-memory sessions for a project, keyed by session_id."""
    _evict_stale()
    prefix = f"{project_name}:"
    return {
        k[len(prefix):]: v
        for k, v in _sessions.items()
        if k.startswith(prefix)
    }


# --- Pure state functions ---

def create_initial_state(
    session_id: str,
    query: str,
    reference_images: List[str] = None,
    preferences: Dict[str, Any] = None,
    context: str = "standalone",
    shot_id: str = None,
    character_id: str = None,
) -> Dict[str, Any]:
    prefs = preferences or {}
    return {
        "session_id": session_id,
        "status": "active",
        "context": context,
        "shot_id": shot_id,
        "character_id": character_id,
        "session_config": {
            "initial_query": query,
            "reference_images": reference_images or [],
            "preferences": {
                "aspect_ratio": "vertical",
                "style_direction": "",
                **prefs,
            }
        },
        "iterations": [],
        "finalized_items": [],
        "all_items_index": {},
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }


def create_session_metadata(
    session_id: str,
    query: str,
    context: str = "standalone",
    shot_id: str = None,
    character_id: str = None,
) -> Dict[str, Any]:
    """Lightweight metadata stored in project state"""
    return {
        "id": session_id,
        "query": query,
        "thumbnail_urls": [],
        "item_count": 0,
        "liked_count": 0,
        "context": context,
        "shot_id": shot_id,
        "character_id": character_id,
        "forked_from": None,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }


def create_exploration_item(
    item_id: str,
    source: str,
    content_url: str,
    generation_params: Dict[str, Any],
    metadata: Dict[str, Any]
) -> Dict[str, Any]:
    return {
        "item_id": item_id,
        "type": "image",
        "source": source,
        "content_url": content_url,
        "thumb_url": None,
        "medium_url": None,
        "generation_params": {
            "prompt": generation_params.get("prompt", ""),
            "keywords": generation_params.get("keywords", []),
            "reference_images": generation_params.get("reference_images", []),
            "subject_reference": generation_params.get("subject_reference"),
            "style_reference": generation_params.get("style_reference"),
            "aspect_ratio": generation_params.get("aspect_ratio", "vertical"),
            "search_query": generation_params.get("search_query"),
            "rationale": generation_params.get("rationale", ""),
        },
        "metadata": {
            "title": metadata.get("title", ""),
            "description": metadata.get("description", ""),
            "original_url": metadata.get("original_url"),
            "hashtags": metadata.get("hashtags", []),
        },
        "feedback": None,
        "feedback_note": None,
        "feedback_iteration": None
    }


def rebuild_item_index(sb_state: Dict[str, Any]) -> None:
    """Rebuild all_items_index from iterations. Required after loading from GCS."""
    sb_state["all_items_index"] = {}
    for iter_idx, iteration in enumerate(sb_state.get("iterations", [])):
        for item_idx, item in enumerate(iteration.get("items", [])):
            sb_state["all_items_index"][item["item_id"]] = {
                "iteration": iter_idx,
                "index": item_idx,
            }


def next_item_id(sb_state: Dict[str, Any]) -> str:
    existing = sb_state.get("all_items_index", {})
    item_id = f"sb_{uuid.uuid4().hex[:8]}"
    while item_id in existing:
        item_id = f"sb_{uuid.uuid4().hex[:8]}"
    return item_id


def register_item(sb_state: Dict[str, Any], item: Dict[str, Any], iteration_index: int, item_index: int):
    item_id = item["item_id"]
    if item_id in sb_state.get("all_items_index", {}):
        logger.warning(f"[Soulboard] Duplicate item_id {item_id} — overwriting index")
    sb_state["all_items_index"][item["item_id"]] = {
        "iteration": iteration_index,
        "index": item_index
    }


def get_item_by_id(sb_state: Dict[str, Any], item_id: str) -> Optional[Dict[str, Any]]:
    location = sb_state.get("all_items_index", {}).get(item_id)
    if not location:
        return None
    try:
        return sb_state["iterations"][location["iteration"]]["items"][location["index"]]
    except (IndexError, KeyError):
        return None


def get_items_by_feedback(sb_state: Dict[str, Any], feedback: str) -> List[Dict[str, Any]]:
    items = []
    for iteration in sb_state.get("iterations", []):
        for item in iteration.get("items", []):
            if item.get("feedback") == feedback:
                items.append(item)
    return items
