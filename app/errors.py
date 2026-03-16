"""Sanitize error messages before exposing to users.
Strips internal details and translates common error patterns."""

import re


def sanitize_error(msg: str) -> str:
    """Strip internal details from error messages for user-facing display."""
    if not msg:
        return "Generation failed."

    # Strip URLs that may contain internal endpoints
    msg = re.sub(r'https?://[^\s]*', '[url]', msg)
    return ' '.join(msg.split()) or "Generation failed."
