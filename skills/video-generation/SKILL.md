---
name: video-generation
description: "Video prompt writing and task submission from storyboard frames. 8-field structured prompts for Veo. Use when user says 'generate videos', 'create video for shot X', or 'submit video generation'."
include:
  - prompt-schema
  - prompt-examples
  - motion-keywords
  - sound-keywords
---

# Video Generation

## Visual Inspection First

Analyze storyboard frames (what the camera sees) as the primary source. Use script details (shot_type, dialogue, key_visual_elements) as supporting context, not as the sole prompt source. If storyboard frames exist, describe what is visually present -- do not invent details from script that contradict the frames.

## Frame Modes

- **Single-frame**: `start_frame_url` from storyboard. Video continues from that visual. Preferred default.
- **Dual-frame**: Both `start_frame_url` and `end_frame_url`. Video interpolates between two keyframes. Best for precise A-to-B transitions.
- **Text-only**: No frame URLs. Full scene described in prompt only. Less consistent with storyboard.

Prefer single-frame or dual-frame for visual consistency with storyboard. Fall back to text-only when no storyboard frames exist.

## Product Shots

If any clip involves products, load `load_skill("video-generation/product-video-rules")`. Product video prompts are nuanced -- the file covers safety constraints, safe motion language, negative checklist, and worked examples.

## Procedure

1. `get_project_context({"script": {"scene": N}, "storyboard": {"scene": N}})` -- get shot details and storyboard frame URLs.
2. For each shot: write prompt using the 8-field schema (see the prompt-schema reference below).
3. Extract frame URL from storyboard context for `start_frame_url`. For dual-frame storyboard shots, also extract frame 2 URL for `end_frame_url`.
4. Submit `generate_video` with prompt, destination, and frame URLs. Submit independent shots as parallel function calls.

## Prompt Writing Key Rules

- "no music" in summary by default, unless script specifies music
- Always include "subtitles" in negative field
- Dialogue format: on-screen characters described by appearance ("Woman in red jacket says: '...'"), not by name
- Motion: use specific verbs (walks, grips, leans) not vague ones (moves, goes)
- Camera: state angle AND movement in 10-15 words
- Sound: ambient + foley as distinct sentences, always "no music, no singing" unless scripted

## Prompt Quality

Concise, structured 8-field prompts outperform long paragraphs. Each field targets a specific generation dimension. The model weighs early tokens more heavily -- front-load the most important visual element in each field.

## Frame Selection

Start and end frames must be storyboard images. Character turnarounds, supplementary assets, and user uploads serve as context references but should not be used as video generation keyframes.

See the prompt-schema, prompt-examples, motion-keywords, and sound-keywords references below for full vocabulary.
