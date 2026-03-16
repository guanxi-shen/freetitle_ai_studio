# Video Prompt Schema

8-field structured prompt format for video generation. Each field targets a specific generation dimension. Concise, structured prompts outperform long paragraphs.

## Fields

### summary (1 sentence)
One-sentence overview: key action + emotion. End with "no music, no singing" unless scripted.

### camera (10-15 words)
Starting angle + movement through the shot. Specify shot size, lens, direction of travel.
Product shots: avoid straight-to-camera angles with camera movement -- the model hallucinates unseen angles.

### motion (30-40 words)
Subject actions with a temporal arc: setup, action, settle. Describe the full 8-second sequence. Strong verbs (slams, grips, leans) not vague ones (moves, goes).
Dual-frame: describe the A-to-B transformation. Single-frame: motion develops from visible starting point.

### style (10-15 words)
Visual DNA: film stock, color grade, texture, lens character.

### dialogue
On-screen speech: describe speaker by appearance, not name. Include voice characteristics.
Voice-over: mark clearly, include exact text and voice description.

### sound (10-15 words)
SFX and ambient as distinct sentences. Always end with "no music, no singing" unless scripted.
Music suppression is critical -- Veo generates music by default if not explicitly suppressed.

### note (10-20 words)
Consistency reminders, logo visibility, match-to-previous. Products: structural integrity.

### negative (15-25 words)
Elements to avoid, listed directly. Always include "subtitles, broken voice, music."
Character shots add: "blurry, distorted face, warped hands"
Product shots add: "morphing, shape-shifting, parts disappearing, structural changes"

## Frame Mode Conditioning

- **Dual-frame** (start + end keyframes): "From [frame 1] to [frame 2]." Physically plausible transitions only.
- **Single-frame** (start only): "Starting from [visible frame]." Motion develops forward.
- **Text-only** (no frames): Full scene description needed. Increase detail to compensate.

## Principles

- The model weighs early tokens more heavily -- front-load the most important visual element in each field.
- Plan motion spanning the full clip duration -- no dead time, no cramming.
- Separate camera movement and subject action as distinct sentences.
- Specific over vague. "45 degree turn left" not "turns."
- No flowery language. Precise terms only.
