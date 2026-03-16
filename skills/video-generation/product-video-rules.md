# Product Video Rules

Product-specific constraints addressing video generation model behaviors: motion artifacts, feature hallucination, and audio contamination.

## Structural Integrity

Products maintain complete physical form throughout the entire clip. No morphing, transforming, shape-shifting, or parts appearing/disappearing. Exception: script explicitly specifies transformation.

## Visual Frame Analysis

Cross-reference storyboard frame visuals and script before describing product features:
- Feature NOT visible in frame AND NOT in script -- assume it does not exist
- Do not describe lights glowing, displays turning on, or mechanisms activating unless confirmed
- When uncertain, default to safe motion: camera movement, product rotation, lighting on surface only

## Safe Motion Language

Use camera-centric and turntable language:
- "camera orbits product", "product rotates on turntable", "lighting reveals surface details"

Avoid anthropomorphic language ("whirs to life", "awakens") -- video models interpret these as transformation sequences. Avoid precise mechanical angles unless motorized parts are confirmed.

## Negative Checklist

Always include for product shots: morphing, shape-shifting, transforming, warping, distortion, parts disappearing, parts vanishing, structural changes, geometry changes, mechanical transformation, humanized behavior

## Example: Static Product (Safe Approach)

```json
{
  "summary": "Camera approaches static device revealing surface details, no music",
  "camera": "Slow dolly-in, eye level, centered on device",
  "motion": "Device remains static, camera approaches revealing surface details, subtle depth shift brings product into sharper focus",
  "style": "Professional tech product photography, clean lighting, high detail",
  "dialogue": "",
  "sound": "Quiet ambient room tone, no music, no singing",
  "note": "Brand markings stay sharp. Device maintains complete structural integrity. NON-NEGOTIABLE: Do not generate background music",
  "negative": "Morphing, lights appearing, displays turning on, parts moving, warping, distortion, structural changes, subtitles, broken voice, music"
}
```

For products WITH documented electronic features (visible in frame + confirmed in script), you may describe those features activating. Apply the Visual Frame Analysis check before every product prompt.
