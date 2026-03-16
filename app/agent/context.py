"""Project context builder -- grounding system that prevents agent hallucination.

Every tool call and response is grounded in actual project data loaded fresh each
request. The ContextIndex indexes real scenes, shots, characters, and assets so the
agent operates on verified state rather than generating plausible-sounding but
incorrect references. This grounding architecture is central to reliable interleaved
multimodal output -- text, images, video, and audio all reference the same
authoritative project state.

Dual interface:
  get_starting_context() -- auto-injected project overview (preamble)
  get_project_context()  -- FC tool, dict-based section queries with scope filters

ContextIndex: precomputed lookups over project_state + scenes. Data access, no rendering.

Two rendering subsystems share the same ContextIndex:
  Preamble: get_starting_context -> _preamble_* helpers
  FC Tool:  get_project_context  -> _get_*_context handlers (CONTEXT_HANDLERS)
"""

import logging

from ..gcs_utils import url_to_blob_path, blob_path_to_gs_uri

logger = logging.getLogger(__name__)

# Fields to exclude from generation metadata (UI-internal state)
_BLOCKLIST = {'formState', 'dragOrder', '_internal', 'provider_task_id'}

def _to_gs(signed_url: str) -> str | None:
    """Signed URL -> gs:// URI for display. External URLs pass through. None if empty."""
    if not signed_url:
        return None
    bp = url_to_blob_path(signed_url)
    if bp != signed_url:
        return blob_path_to_gs_uri(bp)
    return signed_url


_NOTE_COLORS = {
    '#fef3c7': 'yellow', '#fce7f3': 'pink', '#dbeafe': 'blue',
    '#d1fae5': 'green', '#ede9fe': 'purple', '#fed7aa': 'orange',
}


def _format_note(note: dict) -> str | None:
    """Format a note for LLM consumption. Returns None if minimized or empty."""
    if note.get('minimized'):
        return None
    text = note.get('text', '')
    if not text:
        return None
    label = note.get('contextLabel', note.get('anchor', ''))
    color = _NOTE_COLORS.get(note.get('color', ''), '')
    tag = ', '.join(filter(None, [label, color]))
    return f"- [{tag}] {text}" if tag else f"- {text}"


class ContextIndex:
    """Precomputed lookups over project_state + scenes. Data access, no rendering."""

    def __init__(self, project_state: dict, scenes: list):
        self.ps = project_state or {}
        self.scenes = scenes or []
        self.script = self.ps.get('generated_scripts') or {}
        self.details = self.script.get('script_details') or {}
        self.production = self.script.get('production_notes') or {}
        self.audio_design = self.script.get('audio_design') or {}
        self.characters_list = self.script.get('characters') or []
        self.character_gallery = self.ps.get('character_gallery') or {}

        self.characters_by_name = {
            ch.get('name', 'Unknown'): ch for ch in self.characters_list
        }

        # Script scenes indexed by scene_number
        self._script_scenes = {}
        for s in (self.details.get('scenes') or []):
            sn = s.get('scene_number')
            if sn is not None:
                self._script_scenes[sn] = s

        # Storyboard scenes and shots indexed
        self.scenes_by_number = {}
        self.shots_by_key = {}
        for sc in self.scenes:
            sn = sc.get('scene_number', sc.get('original_scene_number', 0))
            self.scenes_by_number[sn] = sc
            for shot in (sc.get('shots') or []):
                shot_num = shot.get('shot_number', shot.get('original_shot_number', 0))
                self.shots_by_key[f"{sn}_{shot_num}"] = shot

        # Video shots indexed
        self.video_shots_by_key = {}
        for sc in self.scenes:
            sn = sc.get('scene_number', sc.get('original_scene_number', 0))
            for vsh in (sc.get('video_shots') or []):
                vsh_num = vsh.get('shot_number', 0)
                self.video_shots_by_key[f"{sn}_{vsh_num}"] = vsh

        # Reverse index: character name -> charId
        self.character_by_name = {}
        for cid, data in self.character_gallery.items():
            if isinstance(data, dict) and data.get('name'):
                self.character_by_name[data['name'].lower()] = cid

        # Supplementary
        self.supplements_by_id = self.ps.get('generated_supplementary') or {}
        self.supplements_by_shot = self.ps.get('shot_supplements') or {}

        # Notes indexed by anchor key
        self._notes_by_anchor = {}
        canvas_notes = self.ps.get('canvas_notes') or {}
        for note in (canvas_notes.values() if isinstance(canvas_notes, dict) else []):
            if not isinstance(note, dict):
                continue
            anchor = note.get('anchor', 'canvas')
            anchor_id = note.get('anchorId', '')
            key = f"{anchor}:{anchor_id}" if anchor_id else anchor
            self._notes_by_anchor.setdefault(key, []).append(note)

    # --- Data access methods ---

    def script_scene(self, scene_num: int) -> dict:
        return self._script_scenes.get(scene_num, {})

    def script_shot(self, scene_num: int, shot_num: int) -> dict:
        for s in (self.script_scene(scene_num).get('shots') or []):
            if s.get('shot_number') == shot_num:
                return s
        return {}

    def cover_result(self, shot: dict) -> dict | None:
        """Preferred cover: ranked first, or first image, or first result."""
        results = shot.get('results') or []
        if not results:
            return None
        ranked = shot.get('ranked_result_ids') or []
        if ranked:
            for r in results:
                if r.get('id') == ranked[0]:
                    return r
        return results[0]

    def supplements_for_shot(self, shot_id: str) -> list[tuple]:
        """Returns [(sid, item_dict)] for supplements attached to shot."""
        shot_supps = self.supplements_by_shot.get(str(shot_id)) or {}
        return [(sid, self.supplements_by_id[sid])
                for sid in shot_supps
                if sid in self.supplements_by_id
                and isinstance(self.supplements_by_id[sid], dict)]

    def notes_for(self, anchor: str, anchor_id: str = '') -> list[dict]:
        """Notes for a specific anchor type and ID."""
        key = f"{anchor}:{anchor_id}" if anchor_id else anchor
        return self._notes_by_anchor.get(key, [])

    def notes_for_scene(self, scene: dict) -> list[dict]:
        """All notes anchored to a scene or any shot/video-shot within it."""
        if not scene:
            return []
        scene_id = str(scene.get('id', ''))
        result = list(self.notes_for('scene', scene_id))
        for sh in (scene.get('shots') or []):
            shot_id = str(sh.get('id', ''))
            result.extend(self.notes_for('shot', shot_id))
        for vsh in (scene.get('video_shots') or []):
            vsh_id = str(vsh.get('id', ''))
            result.extend(self.notes_for('video-shot', vsh_id))
        return result

    def all_notes(self) -> list[dict]:
        """All notes flattened."""
        return [n for notes in self._notes_by_anchor.values() for n in notes]


# ---------------------------------------------------------------------------
# Preamble: auto-injected starting context
# ---------------------------------------------------------------------------

def get_starting_context(idx: ContextIndex, scope: dict = None) -> str:
    """Auto-injected project overview for system preamble.

    scope controls context breadth (single key determines type):
      None                      -- full project (main agent)
      {"scene": 3}              -- scene 3 (sub-agent)
      {"shot": [3, 1]}          -- scene 3 shot 1 (sub-agent)
      {"character": "Kai"}      -- character Kai (sub-agent)
      {"custom": {sections}}    -- pre-run get_project_context with sections dict

    Common (ALL agents): script overview, production notes, characters, supp counts.
    Main agent adds: all scenes with cover shots, all notes.
    Sub-agent adds: scoped scene/shot details, scoped frames/supps/notes.
    """
    scope = scope or {}
    scope_key = _scope_key(scope)

    parts = []

    # --- Script overview (ALL agents) ---
    overview = []
    if idx.details.get('title'):
        overview.append(f"Title: {idx.details['title']}")
    if idx.details.get('duration'):
        overview.append(f"Duration: {idx.details['duration']}")
    if idx.details.get('aspect_ratio'):
        overview.append(f"Aspect ratio: {idx.details['aspect_ratio']}")
    if idx.details.get('video_summary'):
        overview.append(f"Summary: {idx.details['video_summary']}")
    if idx.details.get('creative_vision'):
        overview.append(f"Vision: {idx.details['creative_vision']}")
    if overview:
        parts.append("## Script Overview\n" + "\n".join(overview))

    # --- Production notes (ALL agents) ---
    prod_lines = []
    if idx.production.get('style_guide'):
        prod_lines.append(f"Style: {idx.production['style_guide']}")
    if idx.production.get('tone'):
        prod_lines.append(f"Tone: {idx.production['tone']}")
    if idx.production.get('key_themes'):
        prod_lines.append(f"Themes: {', '.join(idx.production['key_themes'])}")
    if idx.production.get('consistency_guide'):
        prod_lines.append(f"Consistency: {idx.production['consistency_guide']}")
    if prod_lines:
        parts.append("## Production Notes\n" + "\n".join(prod_lines))

    # --- Characters (ALL agents; character-scoped: single character) ---
    # Top 1 turnaround URL per character for reference_images.
    # Use get_project_context({"characters": ...}) for more if needed.
    target_char = scope.get('character')
    if idx.characters_list or idx.character_gallery:
        char_lines = []
        for ch in idx.characters_list:
            name = ch.get('name', 'Unknown')
            if target_char and name != target_char:
                continue
            role = ch.get('role', '')
            cid = idx.character_by_name.get(name.lower()) if name else None
            g = idx.character_gallery.get(cid) or idx.character_gallery.get(name) or {}
            turnarounds = g.get('turnarounds') or []
            img_count = len(turnarounds) + len(g.get('variations') or [])
            line = f"- {name}: {role}" if role else f"- {name}"
            if ch.get('attributes'):
                line += f" -- {ch['attributes']}"
            if img_count:
                line += f" ({img_count} images)"
            if turnarounds and isinstance(turnarounds[0], dict):
                gs = _to_gs(turnarounds[0].get('url') or turnarounds[0].get('thumb_url'))
                if gs:
                    line += f"\n  turnaround: {gs}"
            char_lines.append(line)
        # Gallery characters not in script
        if not target_char:
            script_names = {ch.get('name') for ch in idx.characters_list}
            for cid, g in idx.character_gallery.items():
                display_name = g.get('name', cid) if isinstance(g, dict) else cid
                if display_name not in script_names:
                    turnarounds = g.get('turnarounds') or [] if isinstance(g, dict) else []
                    img_count = len(turnarounds) + len(g.get('variations') or [] if isinstance(g, dict) else [])
                    line = f"- {display_name} ({img_count} images)"
                    if turnarounds and isinstance(turnarounds[0], dict):
                        gs = _to_gs(turnarounds[0].get('url') or turnarounds[0].get('thumb_url'))
                        if gs:
                            line += f"\n  turnaround: {gs}"
                    char_lines.append(line)
        if char_lines:
            header = "## Characters (top 1 turnaround shown; use get_project_context for more if needed)"
            parts.append(header + "\n" + "\n".join(char_lines))

    # --- Supplementary counts by category (ALL agents) ---
    if idx.supplements_by_id:
        categories = {}
        for sid, item in idx.supplements_by_id.items():
            cat = item.get('category', 'uncategorized') if isinstance(item, dict) else 'uncategorized'
            categories[cat] = categories.get(cat, 0) + 1
        supp_lines = [f"{len(idx.supplements_by_id)} items total"]
        for cat, count in sorted(categories.items()):
            supp_lines.append(f"- {cat}: {count}")
        parts.append("## Supplementary\n" + "\n".join(supp_lines))

    # --- Scope-specific sections ---
    if scope_key == 'custom':
        result = get_project_context(idx, scope['custom'])
        if result.get('context'):
            parts.append(result['context'])

    elif scope_key == 'shot':
        scene_num, shot_num = scope['shot']
        parts.extend(_preamble_shot(idx, scene_num, shot_num))

    elif scope_key == 'scene':
        scene_num = scope['scene']
        parts.extend(_preamble_scene(idx, scene_num))

    elif scope_key == 'character':
        parts.extend(_preamble_character(idx, target_char))

    else:
        parts.extend(_preamble_main(idx))

    if not parts:
        return ""
    return "\n\n".join(parts)


def _scope_key(scope: dict) -> str | None:
    """Extract scope type from scope dict. Returns None for main agent (empty/no scope)."""
    if not scope:
        return None
    for key in ('shot', 'scene', 'character', 'custom'):
        if key in scope:
            return key
    return None


def _preamble_main(idx: ContextIndex) -> list:
    """Main agent: all scenes with cover shots, all notes."""
    parts = []

    if idx.scenes:
        scene_lines = []
        for sc in idx.scenes:
            sn = sc.get('scene_number', sc.get('original_scene_number', '?'))
            title = sc.get('title', sc.get('description', ''))
            shots = sc.get('shots') or []
            frames = sum(len(sh.get('results') or []) for sh in shots)
            video_shots = sc.get('video_shots') or []
            clips = sum(len(vsh.get('results') or []) for vsh in video_shots)
            line = f"- Scene {sn}: {title} ({len(shots)} shots, {frames} frames"
            if video_shots:
                line += f", {len(video_shots)} video shots with {clips} clips"
            line += ")"

            ss = idx.script_scene(sn)
            if ss.get('setting'):
                line += f"\n  Setting: {ss['setting']}"
            if ss.get('scene_summary'):
                line += f"\n  Summary: {ss['scene_summary']}"
            if ss.get('duration'):
                line += f"\n  Duration: {ss['duration']}"
            if ss.get('characters'):
                line += f"\n  Characters: {', '.join(ss['characters'])}"
            if ss.get('consistency_notes'):
                line += f"\n  Consistency: {ss['consistency_notes']}"
            if ss.get('visual_direction'):
                line += f"\n  Visual: {ss['visual_direction']}"

            for sh in shots:
                cover = idx.cover_result(sh)
                if cover:
                    sh_num = sh.get('shot_number', sh.get('original_shot_number', '?'))
                    meta = f"  Shot {sh_num} cover: provider={cover.get('provider', '?')}"
                    if cover.get('prompt'):
                        meta += f", prompt=\"{cover['prompt'][:80]}\""
                    line += f"\n{meta}"

            scene_lines.append(line)
        if scene_lines:
            parts.append("## Scenes\n" + "\n".join(scene_lines))

    # All notes (skip minimized)
    notes = idx.all_notes()
    if notes:
        note_lines = [_format_note(n) for n in notes]
        note_lines = [l for l in note_lines if l]
        if note_lines:
            parts.append("## Notes\n" + "\n".join(note_lines))

    return parts


def _preamble_scene(idx: ContextIndex, scene_num: int) -> list:
    """Scene-scoped sub-agent: scene script details, all shots with covers, scene notes."""
    parts = []
    ss = idx.script_scene(scene_num)
    sb_scene = idx.scenes_by_number.get(scene_num)

    # Scene script details
    scene_lines = [f"### Scene {scene_num}"]
    if ss.get('setting'):
        scene_lines.append(f"Setting: {ss['setting']}")
    if ss.get('scene_summary'):
        scene_lines.append(f"Summary: {ss['scene_summary']}")
    if ss.get('duration'):
        scene_lines.append(f"Duration: {ss['duration']}")
    if ss.get('characters'):
        scene_lines.append(f"Characters: {', '.join(ss['characters'])}")
    if ss.get('consistency_notes'):
        scene_lines.append(f"Consistency: {ss['consistency_notes']}")
    if ss.get('visual_direction'):
        scene_lines.append(f"Visual: {ss['visual_direction']}")

    # Per-shot overview with covers
    if sb_scene:
        script_shots = {s.get('shot_number'): s for s in (ss.get('shots') or [])}
        for sh in (sb_scene.get('shots') or []):
            sh_num = sh.get('shot_number', sh.get('original_shot_number', '?'))
            desc = sh.get('description', '')
            s_shot = script_shots.get(sh_num, {})
            shot_line = f"\nShot {sh_num}: {desc}"
            if s_shot.get('shot_type'):
                shot_line += f"\n  Type: {s_shot['shot_type']}"
            cover = idx.cover_result(sh)
            if cover:
                shot_line += f"\n  Cover: provider={cover.get('provider', '?')}"
                if cover.get('prompt'):
                    shot_line += f", prompt=\"{cover['prompt'][:80]}\""
            scene_lines.append(shot_line)

        # Video shots
        for vsh in (sb_scene.get('video_shots') or []):
            vsh_num = vsh.get('shot_number', '?')
            desc = vsh.get('description', '')
            results = vsh.get('results') or []
            shot_line = f"\nVideo Shot {vsh_num}: {desc} ({len(results)} clips)"
            cover = idx.cover_result(vsh)
            if cover:
                shot_line += f"\n  Cover: provider={cover.get('provider', '?')}"
                if cover.get('prompt'):
                    shot_line += f", prompt=\"{cover['prompt'][:80]}\""
            scene_lines.append(shot_line)

    if len(scene_lines) > 1:
        parts.append("\n".join(scene_lines))

    # Scene-scoped supplements
    if sb_scene:
        supp_lines = []
        for sh in (sb_scene.get('shots') or []):
            shot_id = str(sh.get('id', ''))
            for sid, item in idx.supplements_for_shot(shot_id):
                supp_lines.append(f"- {item.get('title', sid)}: {item.get('description', '')} (shot {sh.get('shot_number', '?')})")
        if supp_lines:
            parts.append("## Scene Supplementary\n" + "\n".join(supp_lines))

    # Scene-scoped notes (skip minimized)
    if sb_scene:
        scene_notes = idx.notes_for_scene(sb_scene)
        if scene_notes:
            note_lines = [_format_note(n) for n in scene_notes]
            note_lines = [l for l in note_lines if l]
            if note_lines:
                parts.append("## Scene Notes\n" + "\n".join(note_lines))

    return parts


def _preamble_shot(idx: ContextIndex, scene_num: int, shot_num: int) -> list:
    """Shot-scoped sub-agent: full shot script details, top frames, shot supps, shot notes."""
    parts = []
    ss = idx.script_scene(scene_num)

    # Scene context (condensed)
    scene_lines = [f"### Scene {scene_num}"]
    if ss.get('setting'):
        scene_lines.append(f"Setting: {ss['setting']}")
    if ss.get('consistency_notes'):
        scene_lines.append(f"Consistency: {ss['consistency_notes']}")
    if ss.get('visual_direction'):
        scene_lines.append(f"Visual: {ss['visual_direction']}")
    if len(scene_lines) > 1:
        parts.append("\n".join(scene_lines))

    # Full shot script details
    script_shot = idx.script_shot(scene_num, shot_num)
    if script_shot:
        shot_lines = [f"### Shot {shot_num}"]
        for field in ('shot_type', 'duration', 'subject', 'description', 'shot_purpose',
                      'start_frame', 'progression'):
            if script_shot.get(field):
                shot_lines.append(f"{field.replace('_', ' ').title()}: {script_shot[field]}")
        if script_shot.get('key_visual_elements'):
            shot_lines.append(f"Key visuals: {', '.join(script_shot['key_visual_elements'])}")
        if script_shot.get('dialogue'):
            for d in script_shot['dialogue']:
                char = d.get('character', '?')
                line = d.get('line', '')
                shot_lines.append(f"  {char}: \"{line}\"")
        parts.append("\n".join(shot_lines))

    # Find storyboard shot
    sb_shot = idx.shots_by_key.get(f"{scene_num}_{shot_num}")

    # Top N frames (ranked, up to 5)
    if sb_shot:
        results = sb_shot.get('results') or []
        ranked = sb_shot.get('ranked_result_ids') or []
        # Order by rank, then remaining
        ordered = []
        seen = set()
        for rid in ranked:
            for r in results:
                if r.get('id') == rid and rid not in seen:
                    ordered.append(r)
                    seen.add(rid)
        for r in results:
            rid = r.get('id')
            if rid not in seen:
                ordered.append(r)
                seen.add(rid)

        if ordered:
            frame_lines = []
            for i, r in enumerate(ordered[:5]):
                meta = _clean_metadata(r)
                rank = " [cover]" if i == 0 and ranked else ""
                line = f"- frame{rank}: provider={meta.get('provider', '?')}"
                if meta.get('prompt'):
                    line += f", prompt=\"{meta['prompt'][:100]}\""
                frame_lines.append(line)
            if len(ordered) > 5:
                frame_lines.append(f"... and {len(ordered) - 5} more")
            parts.append("## Shot Frames\n" + "\n".join(frame_lines))

    # Shot supplements
    if sb_shot:
        shot_id = str(sb_shot.get('id', ''))
        supp_lines = []
        for sid, item in idx.supplements_for_shot(shot_id):
            supp_lines.append(f"- {item.get('title', sid)}: {item.get('description', '')}")
        if supp_lines:
            parts.append("## Shot Supplementary\n" + "\n".join(supp_lines))

    # Shot notes (skip minimized)
    if sb_shot:
        shot_id = str(sb_shot.get('id', ''))
        shot_notes = idx.notes_for('shot', shot_id)
        note_lines = [_format_note(n) for n in shot_notes]
        note_lines = [l for l in note_lines if l]
        if note_lines:
            parts.append("## Shot Notes\n" + "\n".join(note_lines))

    return parts


def _preamble_character(idx: ContextIndex, char_name: str = None) -> list:
    """Character-scoped sub-agent: gallery details, character notes.
    If char_name is falsy, lists all characters.
    """
    parts = []
    if char_name:
        names = [char_name]
    else:
        names = list(idx.character_gallery.keys())

    for name in names:
        # Look up gallery entry by name (charId-keyed gallery)
        cid = idx.character_by_name.get(name.lower() if name else '') or name
        g = idx.character_gallery.get(cid) or idx.character_gallery.get(name) or {}
        display_name = g.get('name', name) if isinstance(g, dict) else name

        # Gallery image details (turnarounds + variations)
        turnarounds = g.get('turnarounds') or []
        variations = g.get('variations') or []
        all_images = [(img, 'turnaround') for img in turnarounds] + [(img, 'variation') for img in variations]
        if all_images:
            img_lines = []
            for img, img_type in all_images:
                if not isinstance(img, dict):
                    continue
                meta = _clean_metadata(img)
                line = f"- {img_type}: provider={meta.get('provider', '?')}"
                if meta.get('prompt'):
                    line += f", prompt=\"{meta['prompt'][:80]}\""
                img_lines.append(line)
            if img_lines:
                parts.append(f"## {display_name} Gallery\n" + "\n".join(img_lines))

        # Character notes (skip minimized)
        char_id = cid if cid != name else g.get('id', name)
        char_notes = idx.notes_for('character', str(char_id))
        note_lines = [_format_note(n) for n in char_notes]
        note_lines = [l for l in note_lines if l]
        if note_lines:
            parts.append(f"## {display_name} Notes\n" + "\n".join(note_lines))

    return parts


# ---------------------------------------------------------------------------
# FC tool: section handlers
# ---------------------------------------------------------------------------

def _clean_metadata(data: dict) -> dict:
    """Remove UI-internal fields from a dict."""
    return {k: v for k, v in data.items() if k not in _BLOCKLIST}


def _get_script_context(idx: ContextIndex, scope: dict) -> str:
    """Script section -- scene/shot details + audio design.
    Overview/production notes are in preamble; not duplicated here.
    """
    if not idx.script:
        return ""

    target_scene = scope.get('scene')
    target_shot = scope.get('shot')
    parts = []

    # Navigation header for unscoped calls
    if not target_scene and not target_shot:
        parts.append("(Script overview and production notes are in your starting context. "
                      "Use characters section for character details.)")

    # Audio design (at script level, not script_details)
    if idx.audio_design:
        audio_lines = []
        for key in ('music_direction', 'instrumentation', 'sound_design', 'voiceover'):
            if idx.audio_design.get(key):
                audio_lines.append(f"{key.replace('_', ' ').title()}: {idx.audio_design[key]}")
        if audio_lines:
            parts.append("Audio Design:\n" + "\n".join(audio_lines))

    # Scene/shot details
    for sc in (idx.details.get('scenes') or []):
        sn = sc.get('scene_number')
        if target_scene and sn != target_scene:
            continue

        scene_lines = [f"### Scene {sn}"]
        for field in ('setting', 'scene_summary', 'duration', 'visual_direction', 'consistency_notes'):
            if sc.get(field):
                scene_lines.append(f"{field.replace('_', ' ').title()}: {sc[field]}")
        if sc.get('characters'):
            scene_lines.append(f"Characters: {', '.join(sc['characters'])}")
        if sc.get('audio_notes'):
            scene_lines.append(f"Audio: {sc['audio_notes']}")

        # Scene-level dialogue
        if sc.get('dialogue') and not target_shot:
            for d in sc['dialogue']:
                entry = f"  {d.get('character', '?')}: \"{d.get('line', '')}\""
                if d.get('emotion'):
                    entry += f" ({d['emotion']})"
                scene_lines.append(entry)

        # Shots
        for s_shot in (sc.get('shots') or []):
            sh_num = s_shot.get('shot_number')
            if target_shot and sh_num != target_shot:
                continue
            shot_lines = [f"\nShot {sh_num}:"]
            for field in ('shot_type', 'duration', 'subject', 'description', 'shot_purpose',
                          'start_frame', 'progression'):
                if s_shot.get(field):
                    shot_lines.append(f"  {field.replace('_', ' ').title()}: {s_shot[field]}")
            if s_shot.get('key_visual_elements'):
                shot_lines.append(f"  Key visuals: {', '.join(s_shot['key_visual_elements'])}")
            if s_shot.get('dialogue'):
                for d in s_shot['dialogue']:
                    entry = f"  {d.get('character', '?')}: \"{d.get('line', '')}\""
                    if d.get('emotion'):
                        entry += f" ({d['emotion']})"
                    shot_lines.append(entry)
            scene_lines.extend(shot_lines)

        parts.append("\n".join(scene_lines))

    return "\n\n".join(parts)


def _get_storyboard_context(idx: ContextIndex, scope: dict) -> str:
    """Storyboard frames with generation metadata."""
    target_scene = scope.get('scene')
    target_shots = scope.get('shots')
    parts = []

    for sn, sc in sorted(idx.scenes_by_number.items()):
        if target_scene and sn != target_scene:
            continue
        scene_parts = []
        for shot in (sc.get('shots') or []):
            shot_num = shot.get('shot_number', shot.get('original_shot_number', 0))
            if target_shots and shot_num not in target_shots:
                continue
            results = shot.get('results') or []
            if not results:
                continue
            frame_lines = []
            for r in results:
                meta = _clean_metadata(r)
                line = f"  - {meta.get('filename', meta.get('id', '?'))}: provider={meta.get('provider', '?')}"
                gs = _to_gs(meta.get('url') or meta.get('thumb_url'))
                if gs:
                    line += f", url={gs}"
                if meta.get('prompt'):
                    line += f", prompt=\"{meta['prompt'][:100]}\""
                frame_lines.append(line)
            desc = shot.get('description', '')
            scene_parts.append(f"Shot {shot_num}: {desc}\n" + "\n".join(frame_lines))

            # Per-shot supplements
            for sid, item in idx.supplements_for_shot(str(shot.get('id', ''))):
                scene_parts.append(f"  [supplement] {item.get('title', sid)}: {item.get('description', '')}")

            # Per-shot notes (skip minimized)
            for note in idx.notes_for('shot', str(shot.get('id', ''))):
                if not note.get('minimized') and note.get('text'):
                    scene_parts.append(f"  [note] {note.get('text', '')}")

        if scene_parts:
            parts.append(f"### Scene {sn}\n" + "\n".join(scene_parts))

    return "\n\n".join(parts)


def _get_characters_context(idx: ContextIndex, scope: dict) -> str:
    """Character profiles + gallery images."""
    target_name = scope.get('name')
    parts = []

    # Collect gallery display names
    gallery_names = {}
    for cid, data in idx.character_gallery.items():
        display = data.get('name', cid) if isinstance(data, dict) else cid
        gallery_names[display] = cid

    names = [target_name] if target_name else list(set(
        list(idx.characters_by_name.keys()) + list(gallery_names.keys())))

    for name in names:
        ch = idx.characters_by_name.get(name) or {}
        cid = idx.character_by_name.get(name.lower() if name else '') or gallery_names.get(name) or name
        g = idx.character_gallery.get(cid) or idx.character_gallery.get(name) or {}
        lines = [f"### {name}"]
        if ch.get('role'):
            lines.append(f"Role: {ch['role']}")
        if ch.get('attributes'):
            lines.append(f"Attributes: {ch['attributes']}")
        turnarounds = g.get('turnarounds') or []
        variations = g.get('variations') or []
        total = len(turnarounds) + len(variations)
        if total:
            lines.append(f"Images: {total} ({len(turnarounds)} turnarounds, {len(variations)} variations)")
            for img in turnarounds[:3]:
                meta = _clean_metadata(img) if isinstance(img, dict) else {}
                line = f"  - turnaround: provider={meta.get('provider', '?')}"
                gs = _to_gs(meta.get('url') or meta.get('thumb_url'))
                if gs:
                    line += f", url={gs}"
                lines.append(line)
            for img in variations[:3]:
                meta = _clean_metadata(img) if isinstance(img, dict) else {}
                line = f"  - variation: provider={meta.get('provider', '?')}"
                gs = _to_gs(meta.get('url') or meta.get('thumb_url'))
                if gs:
                    line += f", url={gs}"
                lines.append(line)
        # Character notes (skip minimized)
        char_id = cid if cid != name else g.get('id', name)
        for note in idx.notes_for('character', str(char_id)):
            if not note.get('minimized') and note.get('text'):
                lines.append(f"  [note] {note.get('text', '')}")
        parts.append("\n".join(lines))

    return "\n\n".join(parts)


def _get_supplementary_context(idx: ContextIndex, scope: dict) -> str:
    """Supplementary items with URLs and metadata."""
    target_shot = scope.get('shot')
    target_category = scope.get('category')
    parts = []

    if target_shot:
        for sid, item in idx.supplements_for_shot(target_shot):
            parts.append(_format_supplement(item, sid))
    else:
        for sid, item in idx.supplements_by_id.items():
            if target_category and item.get('category', '') != target_category:
                continue
            parts.append(_format_supplement(item, sid))

    return "\n".join(parts)


def _format_supplement(item: dict, sid: str) -> str:
    meta = _clean_metadata(item)
    title = meta.get('title', sid)
    desc = meta.get('description', '')
    provider = meta.get('source', meta.get('provider', ''))
    gs = _to_gs(meta.get('url') or meta.get('thumb_url'))
    line = f"- {title}: {desc}"
    extras = []
    if provider:
        extras.append(f"provider: {provider}")
    if gs:
        extras.append(f"url={gs}")
    if extras:
        line += f" ({', '.join(extras)})"
    return line


def _get_videos_context(idx: ContextIndex, scope: dict) -> str:
    """Video shot clips with generation metadata."""
    target_scene = scope.get('scene')
    target_shot = scope.get('shot')
    parts = []

    for sn, sc in sorted(idx.scenes_by_number.items()):
        if target_scene and sn != target_scene:
            continue
        for vsh in (sc.get('video_shots') or []):
            vsh_num = vsh.get('shot_number', 0)
            if target_shot and vsh_num != target_shot:
                continue
            results = vsh.get('results') or []
            if not results:
                continue
            desc = vsh.get('description', '')
            video_lines = []
            for r in results:
                meta = _clean_metadata(r)
                line = f"  - {meta.get('filename', meta.get('id', '?'))}: provider={meta.get('provider', '?')}"
                gs = _to_gs(meta.get('url') or meta.get('thumb_url'))
                if gs:
                    line += f", url={gs}"
                if meta.get('prompt'):
                    line += f", prompt=\"{meta['prompt'][:100]}\""
                video_lines.append(line)
            header = f"Scene {sn} Video Shot {vsh_num}"
            if desc:
                header += f": {desc}"
            parts.append(header + "\n" + "\n".join(video_lines))

    return "\n\n".join(parts)


def _get_notes_context(idx: ContextIndex, scope: dict) -> str:
    """Canvas notes. Skips minimized by default; pass include_minimized=true to get all."""
    target_anchor = scope.get('anchor')
    include_all = scope.get('include_minimized', False)
    parts = []

    for key, notes in idx._notes_by_anchor.items():
        if target_anchor and key != target_anchor:
            continue
        for note in notes:
            if include_all:
                text = note.get('text', '')
                if not text:
                    continue
                label = note.get('contextLabel', note.get('anchor', ''))
                color = _NOTE_COLORS.get(note.get('color', ''), '')
                minimized = ' [minimized]' if note.get('minimized') else ''
                tag = ', '.join(filter(None, [label, color]))
                parts.append(f"- [{tag}]{minimized} {text}" if tag else f"- {minimized} {text}")
            else:
                formatted = _format_note(note)
                if formatted:
                    parts.append(formatted)

    return "\n".join(parts)


CONTEXT_HANDLERS = {
    'script': _get_script_context,
    'storyboard': _get_storyboard_context,
    'characters': _get_characters_context,
    'supplementary': _get_supplementary_context,
    'videos': _get_videos_context,
    'notes': _get_notes_context,
}


def get_project_context(idx: ContextIndex, sections: dict) -> dict:
    """FC tool implementation.

    sections: dict of {section_name: scope_filters}
    Example: {"script": {"scene": 1}, "characters": {}, "storyboard": {"scene": 1}}
    Returns: {"success": True, "context": "...combined markdown..."}
    """
    parts = []
    for section_name, scope in sections.items():
        handler = CONTEXT_HANDLERS.get(section_name)
        if not handler:
            continue
        try:
            result = handler(idx, scope or {})
            if result:
                parts.append(f"## {section_name.title()}\n{result}")
        except Exception as e:
            logger.warning("Section handler '%s' failed: %s", section_name, e)

    if not parts:
        return {"success": True, "context": "No data available for requested sections."}
    return {"success": True, "context": "\n\n".join(parts)}
