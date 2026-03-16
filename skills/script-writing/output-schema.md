# Output Schema

JSON structure for `generated_scripts`. Pass this object to `write_script(script)`.

## Top Level

```json
{
  "characters": [...],
  "script_details": {...},
  "production_notes": {...},
  "audio_design": {...}
}
```

Required: `script_details`, `production_notes`. Characters array is optional (omit when no recurring entities).

## characters[]

Each entry defines an entity needing visual consistency across shots.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Character or product name. Use brand/model names for products. |
| `role` | string | 1-3 word function/archetype: "lead hero", "hero product", "comic relief", "flagship device". |
| `attributes` | string | For products: factual physical attributes (color, shape, brand, materials). For people: personality traits, demeanor, motivations. 30-50 words max. |

## script_details

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Video title. |
| `duration` | string | Target duration for final cut (e.g., "30 seconds", "2 minutes"). |
| `video_summary` | string | Brief overview of the video concept and story. |
| `creative_vision` | string | User's specific needs, goals, creative direction, and coverage strategy note. |
| `aspect_ratio` | string | "horizontal" (16:9) or "vertical" (9:16). |
| `scenes` | array | Scene objects. |

## script_details.scenes[]

| Field | Type | Description |
|-------|------|-------------|
| `scene_number` | integer | Sequential scene number. |
| `scene_summary` | string | 1-2 sentence overview of what happens. |
| `setting` | string | Format: "INT/EXT. LOCATION - TIME". Design rich, specific environments. |
| `duration` | string | Scene duration (e.g., "24 seconds"). |
| `characters` | string[] | Character names present in this scene. |
| `consistency_notes` | string | Elements that must stay consistent across shots within this scene. |
| `visual_direction` | string | Scene-level visual direction notes. |
| `shots` | array | Shot objects. |

## script_details.scenes[].shots[]

Shot numbers reset per scene (Scene 1: shots 1-3, Scene 2: shots 1-2).

| Field | Type | Description |
|-------|------|-------------|
| `shot_number` | integer | Per-scene sequential number. |
| `shot_type` | string | WIDE, MEDIUM, CLOSE-UP, EXTREME CLOSE-UP, etc. |
| `duration` | string | Always "8 seconds" (fixed constraint). |
| `subject` | string | What/who the camera focuses on. |
| `description` | string | What happens in this shot. Include visual elements, atmosphere, mood. |
| `shot_purpose` | string | Strategic/narrative intent -- what this shot achieves. |
| `start_frame` | string | **Required.** Exact beginning state: positions, poses, expressions, environment. |
| `end_frame` | string | **Optional.** Only for dual-frame workflow when precise ending state is needed. |
| `progression` | string | **Required.** Complete motion/transformation from start state: movement paths, intermediate states, camera movement. |
| `key_visual_elements` | string[] | Critical props, costumes, positions for downstream agents. |
| `visual_reference` | object[] | Shots sharing visual/narrative elements: `[{"shot_id": "sc1_sh2", "description": "same background"}]`. |
| `continuity_notes` | object | See below. |
| `dialogue` | object[] | See below. |

### Dual-Frame Fields

`start_frame` + `progression` describe the A-to-B transition. `end_frame` provides the precise ending state.

Use dual-frame when:
- Product shots with camera movement or rotation (prevents shape distortion).
- Partial subject reveals where camera exposes initially hidden areas.
- Text animations or logo integrity requirements.
- Precise transformations with exact endpoints.
- Fake one-take sequences where end_frame must match next shot's start_frame.

Default to single-frame (start_frame + progression only) for natural/organic motion, exploratory shots, and open-ended creative generation where the AI model benefits from freedom.

### continuity_notes

| Field | Type | Description |
|-------|------|-------------|
| `from_previous` | string | How this shot's start relates to previous shot's end. |
| `to_next` | string | How this shot's end relates to next shot's start. |
| `transition_suggestion` | string | Optional. Type + duration: "fade 0.5s", "fadeblack 0.3s", "hblur 0.5s", "zoomin 0.5s". Available types: fade, fadeslow, fadeblack, fadewhite, hblur, coverleft, coverright, revealleft, revealright, zoomin, squeezeh, squeezev, dissolve, fade_in, fade_out. |
| `editing_intent` | string | Optional. Creative priority and flexibility guidance for the editor. |

### dialogue[]

| Field | Type | Description |
|-------|------|-------------|
| `character` | string | Character name, "NARRATOR", or "VOICE-OVER". |
| `line` | string | Spoken dialogue or narration text. |
| `audio_notes` | string | Voice characteristics for consistent AI voice generation. Required: gender, age, tone. Optional: accent, pitch, pace, energy. |
| `is_voiceover` | boolean | `true` for voice-over narration (no on-screen speaker), `false` otherwise. |

## production_notes

| Field | Type | Description |
|-------|------|-------------|
| `style_guide` | string | Single comprehensive visual direction description. Address five dimensions: visual surface, camera behavior, editorial rhythm, emotional atmosphere, narrative attitude. Use specific cinematic vocabulary. |
| `tone` | string | Video tone and mood. |
| `key_themes` | string[] | Thematic keywords. |
| `consistency_guide` | string | Overall consistency elements across the entire video: recurring visual elements, spatial relationships, color/lighting patterns, props/costumes. |

## audio_design

| Field | Type | Description |
|-------|------|-------------|
| `music_direction` | string | Style + mood + genre + energy progression (1-2 sentences). |
| `instrumentation` | string | Instruments, tempo/BPM (60-160+), vocals vs instrumental. Product demos default to instrumental. |
| `notes` | string | Brand audio identity, thematic elements, emotional arc of the score. |
