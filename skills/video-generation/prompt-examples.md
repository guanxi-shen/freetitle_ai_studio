# Video Prompt Examples

Demonstrating the 8-field prompt schema across different shot types.

## Camera Movement Focus

```json
{
  "summary": "Camera cranes down through rain to reveal woman waiting alone at bus stop, no music, no singing",
  "camera": "Crane down from high angle to eye level, 35mm, slow descent over 8 seconds",
  "motion": "Rain falls steadily. Camera descends past neon signs and wet awnings, revealing woman standing still. She shifts weight, glances at phone, looks up as headlights approach. Puddle reflections ripple.",
  "style": "Kodak 500T warmth, heavy grain, teal-orange grade, anamorphic flares from streetlights",
  "dialogue": "",
  "sound": "Rain patter on awning, distant traffic hum, puddle splash, no music, no singing",
  "note": "Consistent rain density throughout. Neon reflections on wet surfaces. NON-NEGOTIABLE: Do not generate background music",
  "negative": "Dry pavement, inconsistent rain, text overlays, subtitles, broken voice, music"
}
```

## Character Dialogue

```json
{
  "summary": "Chef plates a dish with precise movements while explaining technique, no music, no singing",
  "camera": "Medium close-up, eye level, slow push-in from waist to hands, 85mm shallow DoF",
  "motion": "Chef grips sauce spoon, flicks wrist leaving clean trail across plate. Pivots to garnish station, pinches microgreens, places at center. Steps back, wipes hands on towel.",
  "style": "Warm tungsten kitchen light, soft shadows, documentary texture",
  "dialogue": "Man in white chef coat says: 'The sauce tells the story'. Male voice, mid-30s, calm tone.",
  "sound": "Sauce drizzle on ceramic, fabric wipe, ambient ventilation, no music, no singing",
  "note": "Maintain hand detail throughout. NON-NEGOTIABLE: Do not generate background music",
  "negative": "Blurry hands, distorted face, warped fingers, subtitles, broken voice, music"
}
```

Key patterns: temporal arc (setup/action/settle), strong verbs, speaker described by appearance not name, SFX/ambient/dialogue as separate sentences.

For product examples: `load_skill("video-generation/product-video-rules")`
