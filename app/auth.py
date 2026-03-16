"""Firebase authentication and user scoping for FreeTitle AI Studio.

Uses Firebase Admin SDK for token verification and Firestore for email whitelist.
"""

import time
from typing import Optional

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials, firestore
from fastapi import Request, HTTPException

from .config import CREDENTIALS

# Firebase Admin SDK init (reuses existing GCP service account credentials)
_firebase_app = None
_firestore_client = None


def _get_firebase_app():
    global _firebase_app
    if _firebase_app is None:
        cred = credentials.Certificate(CREDENTIALS.service_account_email) if False else None
        # Use the existing service account JSON from env
        import os, json
        creds_json = os.getenv("credentials_dict")
        if creds_json:
            cred = credentials.Certificate(json.loads(creds_json))
        _firebase_app = firebase_admin.initialize_app(cred)
    return _firebase_app


def _get_firestore_client():
    global _firestore_client
    if _firestore_client is None:
        _get_firebase_app()
        _firestore_client = firestore.client()
    return _firestore_client


# Whitelist cache: {emails: set, fetched_at: float}
_whitelist_cache = {"emails": set(), "fetched_at": 0}
_CACHE_TTL = 300  # 5 minutes


def _get_allowed_emails() -> set:
    now = time.time()
    if now - _whitelist_cache["fetched_at"] < _CACHE_TTL:
        return _whitelist_cache["emails"]
    try:
        db = _get_firestore_client()
        docs = db.collection("allowed_emails").stream()
        emails = {doc.id for doc in docs}
        _whitelist_cache["emails"] = emails
        _whitelist_cache["fetched_at"] = now
        return emails
    except Exception as e:
        print(f"[Auth] Firestore whitelist fetch failed: {e}")
        return _whitelist_cache["emails"]


async def get_current_user(request: Request) -> dict:
    """FastAPI dependency: verify Firebase ID token and check whitelist.
    Returns {"uid": "...", "email": "..."}."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = header[7:]
    try:
        _get_firebase_app()
        decoded = firebase_auth.verify_id_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    email = decoded.get("email", "")
    uid = decoded.get("uid", "")

    allowed = _get_allowed_emails()
    # Empty whitelist = allow all authenticated users (dev convenience)
    if allowed and email not in allowed:
        raise HTTPException(status_code=403, detail="Email not authorized")

    return {"uid": uid, "email": email}


def user_prefix(user: dict) -> str:
    """Build GCS path prefix for a user: users/{uid}"""
    return f"users/{user['uid']}"
