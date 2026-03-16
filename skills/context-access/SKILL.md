---
name: context-access
description: "How to use get_project_context to access project data."
---

# Context Access Guide

## Project Overview (What You Already Have)

You automatically receive a project overview at the start of each conversation. This includes:

**Always present (all agent types):**
- Script overview: title, duration, aspect_ratio, video_summary, creative_vision
- Production notes: style_guide, tone, key_themes, consistency_guide
- Characters: name, role, attributes, image count
- Supplementary: total count + counts by category

**Main agent (full project) also gets:**
- Per-scene details: setting, scene_summary, duration, characters, consistency_notes, visual_direction
- Per-shot cover metadata: provider, prompt (for the preferred/first frame)
- Per-scene video shot counts and clip counts (when present)
- All canvas notes with text and anchor labels

Do NOT call `get_project_context` to re-fetch overview information you already have.

## When to Use get_project_context

Call `get_project_context` when you need **detail beyond the overview**:
- Script audio design (music_direction, instrumentation, sound design)
- Per-shot script details (shot_type, shot_purpose, dialogue, start_frame, progression, key_visual_elements)
- All frame results for a shot (not just the cover)
- Supplementary item details (descriptions, providers)
- Character gallery image metadata (types, providers, prompts)
- Filtered or scoped queries

## Section Reference

Pass a dict of `{section_name: scope_filters}`. Empty `{}` scope = all data for that section.

| Section | Scope Options | Returns |
|---------|--------------|---------|
| `script` | `{}`, `{"scene": N}`, `{"scene": N, "shot": M}` | Audio design, per-scene details (setting, duration, visual_direction, dialogue), per-shot fields (shot_type, shot_purpose, dialogue, start_frame, progression, key_visual_elements). Overview/production notes are in your project overview. Use `characters` section for character details. |
| `storyboard` | `{}`, `{"scene": N}`, `{"scene": N, "shots": [M...]}` | Frame results with generation metadata |
| `characters` | `{}`, `{"name": "CharName"}` | Character profile + gallery images |
| `supplementary` | `{}`, `{"shot": "1_2"}`, `{"category": "props"}` | Items with URLs, prompts, provider |
| `videos` | `{}`, `{"scene": N}`, `{"scene": N, "shot": M}` | Video shot clips with generation metadata (description, provider, prompt) |
| `notes` | `{}`, `{"anchor": "shot:1_2"}`, `{"include_minimized": true}` | Note text, color, anchor label. Minimized notes hidden by default; pass `include_minimized: true` to include them (tagged `[minimized]`). |

## Common Patterns

Single section with scope:
```
get_project_context({"script": {"scene": 2}})
```

Multiple sections in one call (saves ~6s vs separate calls):
```
get_project_context({"script": {"scene": 1}, "characters": {}, "storyboard": {"scene": 1}})
```

Specific character:
```
get_project_context({"characters": {"name": "Mia"}})
```

Shot with supplements:
```
get_project_context({"storyboard": {"scene": 1, "shots": [2]}, "supplementary": {"shot": "1_2"}})
```

## Notes

- Supplement scoping: `{"shot": "1_2"}` returns per-shot supplements. `{}` returns all.
- Entity bundling: requesting a storyboard shot returns its frames + per-shot supplements + notes.
- Generation metadata (prompt, provider, config) is included with assets -- use it to understand what was generated.
- Each function call takes ~6s. Use multi-section calls and your project overview to minimize calls.

## Staleness

Project context can change between calls -- parallel agents or user operations may modify the project while you work. Refetch context when you need current data, especially before generating content that depends on existing project state.
