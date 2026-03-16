# Sound Keywords

Vocabulary for describing audio in video generation prompts.

## Categories

**Ambient:** room tone, wind, traffic hum, rain on window, crowd murmur, ocean waves, machinery hum
**Foley:** footsteps (surface-specific: concrete/hardwood/gravel), fabric rustle, glass clink, door creak, breath, impact
**Sound design:** bass rumble (tension), riser (anticipation), whoosh (fast movement), silence beat (emphasis), reverb tail (space)

## Dialogue Format

On-screen: describe speaker by appearance. "Woman in red jacket says: 'exact line'. Female voice, early-20s, warm tone."
Voice-over: "Voice-over narration: 'exact text'. Deep male voice, slow paced."

## Music Suppression

ALWAYS include "no music, no singing" in sound field unless script specifies music. Veo generates music by default if not actively suppressed. Add "music" to negative field as reinforcement.

## Audio Separation

Write SFX, ambient, and dialogue as distinct sentences.
Good: "SFX: glass shatters. Ambient: office hum. No music, no singing."
Bad: "glass shatters with office sounds in background"
