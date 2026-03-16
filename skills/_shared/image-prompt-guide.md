# Image Prompt Guide

Rules for writing image generation prompts and provider-specific formatting.

## Core Rules

- **Faithfulness first**: Aesthetic choices enhance, never override, what the user/script asked for.
- **Visual language only**: Describe what the camera sees. No narrative or abstract concepts.
- **Preserve references**: Keep numbered references ("image 1", "image 2") in prompts with brief role context.
- **Concise and precise**: Say what matters, skip what doesn't.

## Provider Formatting

**Nano Banana (NB)** -- Structured flowing paragraph. Layer these dimensions naturally:
1. One-line summary of the image
2. Subject and action (who/what, micro-action, expression, wardrobe)
3. Setting (location, time, practical light sources, tactile details)
4. Camera (shot size, lens mm, aperture, angle, framing)
5. Lighting (motivated source, quality, color temperature, contrast ratio)
6. Color and atmosphere (palette, grade, film stock, grain, lens artifacts, material textures)
7. Stylization (era cues, filmmaker references -- weave in naturally)

Good: "Neon-drenched rain-slicked alley -- a lone figure silhouetted against bleeding magenta-cyan reflections, steam rising from a grate. 40mm anamorphic f/2.0, oval bokeh, Kodak 500T halation, teal-magenta split grade, crushed blacks, heavy grain."
Bad: "cinematic lighting, moody colors."

## Reference Behavior

- **NB**: "as shown in reference image" connects prompt to reference. Best for precision, products, logos.
- Never use filenames or character names in prompts. Describe visual appearance instead.

## Reference Matching

- NB `reference_images` for general guidance, mixing character + product + style
- Character variations: always include turnaround as reference with "character appearance matching 100%"

## Natural Integration

All elements must feel unified. Use synthesis language ("Character naturally integrated with matching 2700K lighting and coherent shadows") not assembly language ("Place character on background").

Lighting coherence: color temperature unified, shadow directions match, specular highlights consistent, falloff physically accurate.

## Enrichment

Without detailed descriptions, models default to minimalist backgrounds. When using references for some elements but not others, describe non-referenced aspects in extreme detail -- textures, materials, lighting, atmosphere.

## Editing Language

When modifying an existing image:
- Name the edit target explicitly, then "everything else unchanged"
- Anchor new elements to existing landmarks ("next to the X", "at the same depth as Y")
- State what transfers from which image ("Replace the girl in image 2 with the girl from image 1")
- New elements must match existing lighting -- state explicitly

## Negative Language

- **NB**: "no" inline in prompt. Keep specific: "no grain, no plastic texture, no oily skin."
- Always include "no split screens" in storyboard prompts to prevent paneled layouts from turnaround references.
