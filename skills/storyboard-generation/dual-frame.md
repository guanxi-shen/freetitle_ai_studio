# Dual-Frame Guide

When dual-frame is specified by the script, user, or context, follow this guide.

Dual-frame generates two keyframes per shot: frame 1 (start state) and frame 2 (end state). Video generation interpolates between them for precise motion control.

## Detection

Read the shot's script data:
- No `end_frame` key, or `end_frame` is empty --> single-frame (generate `frameNumber: 1` only)
- `end_frame` has content --> dual-frame (generate `frameNumber: 1` and `frameNumber: 2`)

Frame 1 visualizes `start_frame`. Frame 2 visualizes `end_frame`.

## Distinctness

Frame 1 and frame 2 MUST be significantly different. Nearly identical frames produce static video.
- Change camera angle or distance (wide to close, low to high)
- Change subject position, pose, or facing
- Change composition, lighting, or environment state

Image models lazily replicate references. When using frame 1 as reference for frame 2, explicitly describe visible differences -- different angle, different surfaces, different camera distance. Background must reflect subject movement (parallax, angle shift, new elements entering frame).

## Setting Consistency

When a dual-frame shot has camera movement (orbit, pan) and needs environment consistency:
- Frame 1: generate with subject references + environment description
- Frame 2: use frame 1's result URL as `reference_images` alongside subject references for the new angle
- Emphasize significant visual difference (new angle, different surfaces) while maintaining setting
- Avoid "exact same" or "seamless continuation" language -- makes frame 2 nearly identical

Generate frame 1 with `wait_for_result=True`, then pass the returned URL as `reference_images` for frame 2.

## Continuity Across Shots

When continuity notes indicate frame reuse (e.g. "end_frame matches next start_frame", "seamless transition", "fake one-take"), use the previous shot's frame 2 result as the next shot's frame 1 reference.

Maintain visual consistency across linked shots: same lighting, wardrobe, color grade, style.

## Execution

Two `generate_image` calls per dual-frame shot -- `frameNumber: 1` (start) and `frameNumber: 2` (end).

Based on creative context, consider whether frame 2 needs frame 1 as a reference input. When both frames should share visual consistency (environment, style, tone, lighting, color grade), generate frame 1 with `wait_for_result=True`, then pass the returned URL as `reference_images` for frame 2 alongside any other references (characters, supplementary). Describe the intended differences clearly (new angle, changed position, different visible surfaces) -- without explicit differences the model replicates frame 1 nearly identically.

Consider this when frames share context that would be hard to reproduce from scratch -- e.g., a product on a stylized set where the camera orbits, or a character in a detailed interior where framing shifts from wide to close-up.

