---
name: character-design
description: "Character turnaround generation (front/3-4/side/back views) and pose variations for visual consistency. Includes product-as-character workflow. Use when user says 'design characters', 'generate turnarounds', or 'visualize the characters'."
include:
  - _shared/image-prompt-guide
---

# Character Design

## When to Generate What

- **Turnaround** (default for new characters): 2x2 reference sheet showing front, 3/4 angle, side profile, back view. Gold standard for consistency. Always generate turnarounds first.
- **Variation**: Single-image alternate poses, expressions, outfits, or contexts. Requires an existing turnaround as visual anchor. Generate after turnaround is established. Only for significant visual differences needing additional references -- skip variations for pose/angle changes that downstream video generation handles from the turnaround.

## Tool Selection

- **Nano Banana**: Default. Best precision, consistency, and product accuracy.

## Consistency Rules

- Turnaround is the consistency anchor. All variations must visually match it.
- For variations with reference: include turnaround as reference image. State "character appearance matching 100% with the provided turnaround image" and describe only what differs (pose, expression, outfit, setting).
- When multiple products are uploaded, incorporate all unless user specifies otherwise.
- For iterative refinement: include original image as reference to maintain consistency. Skip original reference when user intent is total redesign rather than refinement.

## Important: characterType Default

If `characterType` is omitted from the destination, it defaults to `"variation"`. Always pass `"characterType": "turnaround"` explicitly for turnaround generation.

## Procedure (Turnaround)

1. `get_project_context({"characters": {}})` -- check existing characters and gallery state.
2. For each character needing a turnaround, write a prompt following the turnaround format (see below) with character description + style.
3. `generate_image(prompt, "nano_banana", {"type": "character", "characterName": "Name", "characterType": "turnaround"})`.
4. For multiple characters, submit turnaround calls as parallel function calls.

Turnaround prompt format: Include "2x2 turnaround reference sheet" layout instructions directly in the prompt. See `load_skill("character-design/turnaround-guide")` for detailed format specs.

## Procedure (Variation with Turnaround Reference)

1. `get_project_context({"characters": {"name": "CharName"}})` -- get character gallery with turnaround URLs.
2. Extract the turnaround URL from the context output.
3. Write a variation prompt describing the new pose/expression/context, stating "character appearance matching 100% with the provided turnaround image."
4. Pass the turnaround URL as `reference_images` when calling `generate_image`.

## Within-Request Chaining (Turnaround to Variation)

When the user wants both turnarounds and variations in one request, use `wait_for_result=True` to chain them:

1. Generate turnaround with `wait_for_result=True`. The result includes the generated URL and the image itself.
2. Use the returned URL as `reference_images` in the follow-up variation call.
3. For multiple variations from the same turnaround, submit them as parallel function calls -- blocking calls especially benefit from parallel submission to avoid sequential waiting.

## Quality Check

When using `wait_for_result=True`, you see the generated image. Check for major issues only: distorted anatomy/faces/hands, or reference mismatch (wrong logo, wrong brand colors, missing features). Only regenerate if significant problems (max 2 attempts).

## On-Demand Guides

- Turnaround format details: `load_skill("character-design/turnaround-guide")`
- Product-as-character workflow: `load_skill("character-design/product-character")`
