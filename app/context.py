"""Context builders that extract LLM-consumable text from project state.

Each builder targets a specific state slice (scripts, characters, etc.)
and accepts spatial scope params (scene_number, shot_number) to control detail level."""

CONTEXT_FRAMING = "The following is creative context from the project's script and production notes. Use it to understand the world, characters, visual style, and tone of the project. This context helps you make decisions that are consistent with the overall creative direction, but it may not all be directly relevant to this specific request. When the user provides explicit instructions, those take priority — treat this context as background reference, not as a directive. In particular, scene descriptions cover multiple shots and broad narrative beats — not all of it is relevant to what the user is currently exploring. Similarly, a shot description may cover an entire sequence of actions, camera movements, and story progressions — the user's current request may target just one specific moment, setting, or element within that shot. Let the user's prompt define the scope."


def get_script_context(
    script: dict,
    scenes: list = None,
    scene_number: int = None,
    shot_number: int = None,
    include_all_scenes: bool = False,
) -> str:
    """Build LLM context string from generated_scripts data.

    Args:
        script: The generated_scripts dict from project_state, or None.
        scenes: Storyboard scenes array (for shot descriptions).
        scene_number: 1-based scene number to focus on.
        shot_number: 1-based shot number within the scene.
        include_all_scenes: Include a one-line summary per scene.

    Returns empty string if script is None or empty.
    """
    if not script:
        return ""

    details = script.get("script_details") or {}
    production = script.get("production_notes") or {}
    characters = script.get("characters") or []
    script_scenes = details.get("scenes") or []

    sections = []

    # --- PROJECT OVERVIEW ---
    overview_lines = []
    if details.get("title"):
        overview_lines.append(f"Title: {details['title']}")
    if details.get("video_summary"):
        overview_lines.append(f"Video summary: {details['video_summary']}")
    if details.get("creative_vision"):
        overview_lines.append(f"Creative vision: {details['creative_vision']}")
    if production.get("style_guide"):
        overview_lines.append(f"Style guide: {production['style_guide']}")
    if production.get("tone"):
        overview_lines.append(f"Tone: {production['tone']}")
    if production.get("key_themes"):
        overview_lines.append(f"Key themes: {', '.join(production['key_themes'])}")
    if production.get("consistency_guide"):
        overview_lines.append(f"Consistency guide: {production['consistency_guide']}")
    if overview_lines:
        sections.append("PROJECT OVERVIEW\n" + "\n".join(overview_lines))

    # --- CHARACTERS ---
    if characters:
        char_lines = []
        # Find which characters appear in the target scene
        scene_chars = set()
        if scene_number:
            for sc in script_scenes:
                if sc.get("scene_number") == scene_number:
                    scene_chars = set(sc.get("characters") or [])
                    break

        for ch in characters:
            name = ch.get("name", "Unknown")
            parts = []
            if ch.get("role"):
                parts.append(ch["role"])
            if ch.get("attributes"):
                parts.append(ch["attributes"])
            line = f"- {name}"
            if parts:
                line += f": {', '.join(parts)}"
            if scene_chars and name in scene_chars:
                line += " [in scene]"
            char_lines.append(line)
        sections.append("CHARACTERS\n" + "\n".join(char_lines))

    # --- ALL SCENES OVERVIEW ---
    if include_all_scenes and script_scenes:
        scene_lines = []
        for sc in script_scenes:
            num = sc.get("scene_number", "?")
            setting = sc.get("setting", "")
            direction = sc.get("visual_direction", "")
            line = f"- Scene {num}: {setting}"
            if direction:
                line += f" -- {direction}"
            scene_lines.append(line)
        sections.append("SCENES OVERVIEW\n" + "\n".join(scene_lines))

    # --- CURRENT SCENE ---
    if scene_number:
        target_scene = None
        for sc in script_scenes:
            if sc.get("scene_number") == scene_number:
                target_scene = sc
                break

        if target_scene:
            scene_lines = [f"Scene {scene_number} (scene-level context, not shot-specific)"]
            if target_scene.get("setting"):
                scene_lines.append(f"Setting: {target_scene['setting']}")
            if target_scene.get("scene_summary"):
                scene_lines.append(f"Summary: {target_scene['scene_summary']}")
            if target_scene.get("consistency_notes"):
                scene_lines.append(f"Consistency notes: {target_scene['consistency_notes']}")

            sections.append("CURRENT SCENE\n" + "\n".join(scene_lines))

    # --- CURRENT SHOT ---
    if scene_number and shot_number and scenes:
        sb_scene = _find_storyboard_scene(scenes, scene_number)
        if sb_scene:
            shots = sb_scene.get("shots") or []
            for shot in shots:
                if shot.get("shot_number") == shot_number:
                    if shot.get("description"):
                        sections.append(f"CURRENT SHOT\nShot {shot_number}: {shot['description']}")
                    break

    if not sections:
        return ""

    return "\n\n".join(sections)


def _find_storyboard_scene(scenes: list, scene_number: int) -> dict | None:
    """Find a storyboard scene by scene_number (1-based) or by index."""
    for sc in scenes:
        if sc.get("scene_number") == scene_number:
            return sc
        # Storyboard scenes use original_scene_number for stable identity
        if sc.get("original_scene_number") == scene_number:
            return sc
    # Fallback: index-based (scene_number is 1-based)
    idx = scene_number - 1
    if 0 <= idx < len(scenes):
        return scenes[idx]
    return None
