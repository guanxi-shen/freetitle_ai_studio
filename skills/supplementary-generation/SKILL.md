---
name: supplementary-generation
description: "Props, environments, costumes, effects, concept art generation. Creative visual development for production consistency and aesthetic exploration. Use when user says 'generate props', 'create environments', 'design costumes', or 'add supplementary items'."
include:
  - _shared/image-prompt-guide
  - _shared/image-cinematic-keywords
---

# Supplementary Generation

## Creative Abundance Philosophy

Think as a visual reference artist providing comprehensive creative support. What would enrich this production? What visual elements boost production quality? What diverse references expand creative possibilities beyond user materials? Anticipate what would be valuable -- do not limit to what is explicitly requested.

User-uploaded references inform but do not constrain your creative vision -- expand, vary, and elevate beyond their aesthetic qualities when appropriate.

Think coverage: does each shot have ample supplementary support? Some references serve multiple shots. Key elements like settings benefit from multiple angles and distances to support varied shot composition. Judge the appropriate number based on creative needs.

## Proactive Recurring Element Detection

Scan script context for settings, environments, and important objects appearing across multiple shots. Generate consistency references (settings, recurring props) before aesthetic materials (mood boards, concept art).
- Extract and generate all locations/settings mentioned in script (interiors, exteriors, recurring locations).
- Check if elements already exist in the characters list (skip those -- character design handles them separately).
- For reusable props: turnaround design showing multiple angles (front, side, back, 3/4 view).
- For environments/settings: variation and diversity in angles, perspectives, and time-of-day.

## Style Consistency

Before generating, identify the production's visual style (priority order):
1. `production_notes.style_guide` in script context (primary source).
2. User query for explicit style mentions.
3. Previously generated assets for established visual language.

All generations must match the production style. If style_guide specifies "2D animation", generate 2D -- not photorealistic. Style consistency takes priority over creative variety.

## Tool Selection

- **Nano Banana**: Default. High fidelity with minimal hallucination. Use for all supplementary content -- environments, props, concept art, mood boards, and items needing precise reference matching, text accuracy, or logos.

## Content Categories

Supplementary content spans: environments, props, costumes, effects, concept art, reference images, mood boards. Think about which categories the production needs and generate across them.

## On-Demand Category Guidance

For per-category creative guidelines: `load_skill("supplementary-generation/content-categories")`

## Iterative Refinement

When modifying existing items, include the original as a reference image to maintain consistency. Skip when user intent is total redesign rather than refinement.

## Procedure

1. Fetch existing state: `get_project_context({"script": {}, "supplementary": {}})`.
2. Identify what the production needs based on script, user request, and existing assets.
3. Generate: `generate_image(prompt, provider, {"type": "supplementary", "title": "Item Name", "description": "Brief description", "category": "environment"})`. Include `title`, `description`, and `category` in the destination so items are labeled in the project.
4. For batch work, submit independent items as parallel function calls. Blocking calls (`wait_for_result=True`) especially benefit from parallel submission.
