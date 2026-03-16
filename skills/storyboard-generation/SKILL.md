---
name: storyboard-generation
description: "Shot keyframe image generation from scripts. Single or dual-frame mode. Writes detailed frame prompts with cinematic vocabulary. Use when user says 'generate storyboard', 'create frames for scene X', or 'visualize the shots'."
include:
  - dual-frame
  - _shared/image-prompt-guide
  - _shared/image-cinematic-keywords
---

# Storyboard Generation

## Scope

Default: generate frames for ALL shots in ALL scenes unless user specifies a subset. When user says "generate storyboard for scene 3", generate all shots in scene 3.

## Provider Selection

- **Nano Banana** (default): Final production frames. High fidelity, minimal hallucination, supports multiple reference images simultaneously.

## Frame Prompt Approach

1. Read the shot's script details (shot_type, shot_purpose, dialogue, key_visual_elements, visual_direction).
2. Apply `style_guide` from production_notes -- this is the primary visual DNA for the entire project.
3. Use cinematic keywords (from the image-cinematic-keywords reference below) for technical precision: lens, aperture, lighting setup, color grade.
4. Enrich non-referenced aspects with extreme detail -- without detailed environment descriptions, models default to minimalist backgrounds.
5. Describe a single frozen moment within the shot, not the entire shot sequence.

## Single vs Dual-Frame Decision

Default is single-frame. Follow the script: if a shot defines only `start_frame`, generate single-frame. If it defines both `start_frame` and `end_frame`, generate dual-frame. Do not invent dual-frame when the script did not design for it. Only override when the user or context (notes, instructions) explicitly requests it.

## Procedure

1. `get_project_context({"script": {"scene": N}})` -- get shot details for the target scene.
2. For each shot: decide single vs dual-frame, select provider, write prompt.
3. Single-frame: `generate_image(prompt, provider, {"type": "shot", "sceneNumber": N, "shotNumber": M, "frameNumber": 1})`
4. Dual-frame: two separate `generate_image` calls:
   - Frame 1 (start): `{"type": "shot", "sceneNumber": N, "shotNumber": M, "frameNumber": 1}`
   - Frame 2 (end): `{"type": "shot", "sceneNumber": N, "shotNumber": M, "frameNumber": 2}`
5. Submit independent shots as parallel function calls. Blocking calls (`wait_for_result=True`) especially benefit from parallel submission.

## Reference Images

Use `get_project_context` to retrieve URLs for character turnarounds, supplementary items, and existing frames. Pass as `reference_images` for Nano Banana.

Common reference patterns:
- Character close-up: turnaround URL as `reference_images` for consistency
- Environment shot: supplementary environment URL as `reference_images` for setting accuracy
- Style consistency: existing frame URL as `reference_images` for cross-shot color/mood matching

## Text & Logo Handling

- Text screens: state exact text content -- "Text reading 'GET READY' in bold white letters"
- Emphasize text spelling must be valid and exactly as specified -- image models often generate garbled text
- Empty frames (text animates in later): state "no text visible", describe background only
- UI/interfaces: list all visible text labels, buttons, menu items with exact spelling
- Logo: must be recreated accurately, without alteration or misaligned designs. If reference logo provided, replicate exactly

## On-Demand Guides

- Continuity principles: `load_skill("storyboard-generation/continuity")`
