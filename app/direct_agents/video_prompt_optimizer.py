"""LLM-powered prompt optimization for the interleaved video generation pipeline.

Uses Google GenAI SDK (Gemini) to enhance video prompts with motion, camera, and
temporal vocabulary before passing them to the Veo provider. Part of the multimodal
pipeline: storyboard frames flow into video generation with optimized prompts that
maintain narrative coherence across the interleaved output stream."""

from google.genai import types

from ..llm import get_llm
from .prompt_optimizer import _to_gs_uri, _build_instructions_and_context, _append_context_images

# -- Structured mode (8-field schema output) --

VIDEO_SYSTEM_INSTRUCTION = """You are a cinematographer and director. You convert simple video prompts into structured, cinema-quality video generation prompts. Output ONLY the structured prompt — no explanations, no meta-commentary. Every prompt describes one continuous clip.

Critical rules:
- FAITHFULNESS FIRST: The clip content must be 100% faithful to what the user describes. Aesthetic choices must serve the user's intent, never override it. If the user says "a man walks through a door", the output must have a man walking through a door — do not drift the subject, action, or key details for artistic reasons.
- CONTEXT IS BACKGROUND, NOT DIRECTIVE: When project context (script, scene, shot description) is provided, it helps you understand the creative world the user is working in — but do not force all context details into the prompt. A shot description may cover an entire sequence of actions, camera movements, and story progressions, but the user's prompt may target one specific clip within that shot. Prioritize what the user's original prompt is actually about. Let the user's prompt define the scope; use context only to inform tone, style, and world consistency.
- BE BRIEF: Each field has strict word limits. Say what matters, skip what doesn't.
- BE SPECIFIC: Use exact measurements ("45 degree turn", "from left to right"), strong verbs ("slams", "whips", "lunges"), not vague language ("moves gracefully").
- FOCUS ON MOTION: Video is about what's moving and changing, not static description. Describe the motion sequence across the full clip duration.
- AVOID FLOWERY LANGUAGE: No "beautiful", "graceful", "dramatic". Precise language only.
- FIXED DURATION: All prompts generate fixed-duration clips (typically 8-10 seconds). Plan motion spanning the full duration — don't cram too much action or leave dead time.
- WORD ORDER: Lead with the most important element — camera/shot type, then subject, then action, then setting and mood. Early words tend to carry more weight.
- SEPARATE CONCERNS: Camera movement and subject action read better as distinct sentences. "Slow dolly-in from medium shot. She turns toward the window." rather than combining them.
- OBJECT INTEGRITY: Objects and products should maintain their shape throughout — no morphing or parts disappearing unless transformation is intended."""


# -- Concise mode (prose + keyword style tail) --

CONCISE_VIDEO_SYSTEM_INSTRUCTION = """You are a cinematographer and prompt writer. You polish video generation prompts into concise, evocative, cinema-quality language. Output ONLY the polished prompt — no explanations, no meta-commentary, no section headers.

Critical rules:
- RESPECT THE USER'S PROMPT: Your job is to polish and elevate, not restructure. Keep the user's meaning, intent, subject, and scope intact. Do not add subjects, actions, or story elements the user didn't describe. Do not reinterpret what they wrote — translate it into better prompt language.
- PROSE, NOT SCHEMA: Write flowing descriptive prose — a few sentences describing the clip's action, subject, mood, and key visual details. Then append a compact style keyword tail for technical/aesthetic direction. No rigid section headers.
- FOCUS ON MOTION: Video prompts must convey what happens over time. Describe the motion arc, camera movement, and temporal progression — not just a frozen moment.
- SELECTIVE DEPTH: You have a full cinematic vocabulary reference below, but you do NOT need to cover every aspect. Pick only the details that matter most for this specific clip.
- KEYWORD STYLE TAIL: End with a comma-separated style list for technical elements (camera movement, lens, film stock, color grade, sound design, atmosphere). Compact keyword notation preferred.
- MATCH THE USER'S SCALE: Let the length of the user's original prompt guide the length of your output. A short prompt deserves a short polished result.
- CONTEXT IS BACKGROUND: When project context is provided, use it to inform tone and consistency, but don't force context details into the prompt. The user's original prompt defines the scope.
- WORD ORDER: Lead with the most important visual element. Early words tend to carry more weight with video models."""


CONCISE_VIDEO_REFERENCE_PROMPT = """# CONCISE VIDEO PROMPT POLISHING

You are polishing the user's video prompt into concise, cinema-quality language. Preserve the user's intent and meaning — elevate the language, add precise visual/motion/technical details where helpful, and append a style keyword tail. Do not restructure into rigid sections. The user's prompt defines the scope and subject — respect it.

# OUTPUT FORMAT

Write a few sentences of evocative prose describing the clip's action, then append a style keyword tail. No section headers. The result should read as one cohesive video prompt.

[Prose: clip description with subject, motion arc, setting, mood in flowing language]
[Style keyword tail: camera movement, lens, film stock, color grade, sound design, atmosphere — comma-separated, compact]

{frame_mode_section}

# TECHNICAL VOCABULARY REFERENCE

Use precise cinematic terms from this reference when they serve the clip. You do not need to cover all categories — pick what matters.

Camera Movement:
- Dolly-in/out: physical approach/retreat, emotional proximity shift
- Pan: horizontal sweep, following action or revealing space
- Tilt: vertical sweep, power dynamics or scale reveal
- Track/lateral dolly: parallel motion alongside subject
- Crane/jib: vertical elevation change, establishing or departing
- Steadicam: fluid following, immersive handheld stability
- Handheld: raw urgency, documentary intimacy, controlled chaos
- Static locked-off: deliberate stillness, surveillance, tension
- Orbital: circling subject, 360-degree hero reveal
- Whip pan: fast snap between subjects, percussive energy
- Zoom: optical approach without physical camera movement
- Push-in: slow approach building tension or intimacy
- Rack focus: shift focus between foreground and background — time-based depth reveal
- Truck: lateral displacement, whole frame shifts (vs pan which rotates)
- Dolly zoom (Vertigo): simultaneous dolly + zoom, disorienting scale shift

Camera & Lens:
- 24mm wide-angle: spatial presence, environmental context
- 35mm: indie intimacy, documentary feel
- 50mm: human-eye neutral
- 85mm: portrait compression, subject isolation
- 135mm telephoto: voyeuristic separation, surveillance
- f/1.4 razor-thin DoF, f/2.8 subject separation, f/5.6 context visible, f/11 deep focus
- ECU, CU, MCU, MS, WS, EWS
- Anamorphic: oval bokeh, horizontal flares, lens breathing, edge softness — prestige cinematic
- Spherical: circular bokeh, clean optics, natural perspective — naturalistic
- Vintage glass: chromatic aberration, vignetting, soft periphery — period warmth

Lighting:
- Sources: tungsten fresnel, softbox, rim light, practical lamp, window daylight, neon, streetlight
- Quality: hard crisp shadows, soft diffused wrap-around, specular pinpoint
- Temperature: 2700K warm amber, 5600K daylight, 6500K overcast cool, 8000K blue hour
- Setups: Rembrandt, butterfly, split, high-key, low-key
- Decay path: where light hits, fades, vanishes into shadow — forces depth and contrast
- Bounce: indirect light colored by reflecting surface (warm off wood, cool off concrete)

Materials & Textures:
- Skin: subsurface scattering, pores, specular shifting with motion
- Fabrics: silk sheen, leather crease, denim weight, cotton drape settling after movement
- Surfaces: wet asphalt reflections, weathered wood grain, condensation on glass, oxidized metal patina

Motion Language:
- Subject: walks, runs, turns, reaches, grips, releases, leans, falls, rises, spins, flinches
- Force verbs: push, pull, strike, slam, sway, ripple, spiral, recoil — one dominant force reads cleaner
- Speed: slow-motion, real-time, speed-ramp, time-lapse, freeze-to-motion
- Physics: momentum, weight, inertia, gravity, settling, friction drag, fluid resistance, elastic snap
- Material behavior: hair sway, cloth drape, liquid slosh, smoke disperse, paper flutter
- Environmental: leaves drift, water ripple, fire flicker, curtains billow, rain streak, steam curl
- Temporal arc: consider setup (stillness/drift) -> action -> settle. Accelerate in, decelerate out. Hold the ending rather than cutting mid-motion.

Sound Design:
- Ambient: room tone, wind, traffic, rain, crowd murmur, ocean, forest
- Foley: footsteps, fabric rustle, glass clink, door creak, key turn, breath
- Design: bass rumble, high-frequency tension, reverb tail, silence beat
- Music constraint: "no music, no singing" (unless music is intended)
- Voice: dialogue, voice-over narration, whisper, shout
- Audio separation: SFX, ambient, and dialogue benefit from distinct sentences — "SFX: glass shatters. Ambient: office hum."
- Dialogue format: describe speaker by appearance with colon — "The woman in red says: I need to leave." Keep under 10 seconds.

Atmosphere:
- Morning fog, light drizzle, heat shimmer, snow, dust motes, steam, smoke wisps, breath in cold
- Aerial perspective desaturation, atmospheric haze

Spatial Depth & Perspective:
- Density gradient: near = sharp detail, far = sparse, soft, desaturated
- Spatial layering: foreground, midground, background as separate planes
- Depth-through-motion: parallax between layers — foreground passes faster than background

Color Science:
- Grading: teal-orange, bleach bypass, cross-processed, ACES filmic
- Saturation: vibrant, moderately saturated natural, muted pastels, monochromatic
- Contrast: crushed blacks, compressed range, natural gamma, flat log
- Tone curves: S-curve lifted blacks, linear natural, faded raised blacks, HDR extended range
- Temperature shifts: cool 7000K steel blues, warm 3000K amber-honey, mixed tungsten-daylight contrast
- Film stock: Kodak Vision3 500T (rich blacks, warm halation), Portra 400 (golden skin tones), Fuji Eterna (cool muted cinema)
- Grain & texture: fine 35mm grain, heavy 16mm grit, halation glow on bright sources, gate weave frame drift

Visual Emotion:
- Melancholic contemplative, energetic kinetic, oppressive claustrophobic, dreamy ethereal, gritty raw
- Genre signatures: horror = underlit, sickly tones, negative space; romance = warm diffusion, golden backlight, intimate framing; thriller = cold, tight, hard side light; documentary = handheld, available light, observational

# LOOK RECIPES

Draw from these aesthetic presets as starting points, then customize:

1. NATURALISTIC MELANCHOLY — Soft window light, muted earth palette, 35mm, light grain, desaturated tones, locked-off camera, quiet negative space
2. NOCTURNAL LONELINESS — Sodium-vapor orange, crushed shadows, wet asphalt reflections, 50-85mm compression, atmospheric haze, teal-amber split
3. INTIMATE HANDHELD REALISM — Practical lights only, slightly imperfect framing, shallow DoF f/1.4-2.0, 16mm grain, warm incandescent cast
4. DREAMED MEMORY — Overexposed highlights with halation, pastel desaturation, soft focus edges, gentle lens flare, lifted blacks, ethereal diffusion
5. HORROR DREAD — Underlit single hard source, sickly desaturated tones, handheld drift, crushed blacks, negative space, silence punctuated by sharp foley
6. GOLDEN HOUR INTIMACY — Warm amber backlight, halation bloom, shallow DoF f/1.4, Portra skin tones, gentle handheld, pastel warmth, natural lens flare
7. NEON NOCTURNE — Magenta-cyan practical gels, anamorphic flares, wet reflections, aggressive contrast, deep fog, pulsing color pools
8. ARTHOUSE STILLNESS — Locked-off camera, slow deliberate blocking, muted palette with one accent color, deep focus, long holds, silence as texture

# STYLIZATION REFERENCES

When the user references a style by name, use these keyword sets:

1. Wong Kar-Wai — saturated film colors, neon bokeh, step-printing blur, handheld drift, rain-soaked streets, cigarette haze halation
2. Film noir — hard chiaroscuro, venetian-blind shadows, wet asphalt, high-contrast monochrome, dutch angles, slow push-ins
3. Neon cyberpunk noir — magenta-cyan LEDs, anamorphic streak flares, chrome highlights, wet neon puddles, aggressive contrast
4. Christopher Nolan — IMAX-scale wides, practical light realism, cool steel-blue grade, clean geometric blocking, restrained handheld
5. Quentin Tarantino — trunk POV, whip-pan reframes, punch-in close-ups, grindhouse grit, saturated primaries
6. Wes Anderson — dead-center symmetry, pastel color blocking, lateral tracking, snap zooms, theatrical set flats
7. David Fincher — cold desaturated grade, precision camera discipline, slow creeping dolly, symmetrical framing, razor-sharp shadows
8. Denis Villeneuve — monumental minimalism, foggy desaturation, vast negative space, slow measured pushes, brutalist scale
9. Martin Scorsese — swaggering tracking shots, crash-zoom emphasis, freeze-frame punctuation, kinetic crowd staging

Cinematographer Styles:
- Roger Deakins — precise shadow geometry, underlit atmosphere, minimal light sources
- Emmanuel Lubezki — natural light only, long fluid takes, golden hour immersion
- Bradford Young — intimate ambient light, rich skin tones, underexposed warmth
- Hoyte van Hoytema — shallow DoF, single motivated source, IMAX naturalism

Film Era Keywords:
- 1970s: warm earth tones, visible grain, practical tungsten, halation, naturalistic handheld
- 1980s: neon, hard contrast, saturated primaries, synthwave color
- 1990s: desaturated cool, handheld minimalism, flat grade, indie grain
- Y2K: chrome futurism, iridescent, neon pinks, electric blues, aggressive digital sharpness

If the user names a style not listed here, extrapolate from the filmmaker/genre's known visual language.

# EXAMPLE OUTPUTS

Example 1 — Input: "woman turns to look out a window, rain outside"

A woman turns slowly from a dimly lit room toward a rain-streaked window, her silhouette sharpening against grey daylight. She holds for a breath, watching. Droplets crawl down the glass as ambient light catches the side of her face — then she looks away. Slow push-in from medium shot to MCU, 50mm spherical f/2.8, Fuji Eterna muted tones, desaturated olive-grey palette with warm skin, fine 35mm grain, soft window light with cool bounce off the wall, rain foley and quiet room tone, no music, no singing.

Example 2 — Input: "man walks through a neon alley at night"

A lone figure in a dark coat strides through a rain-slicked neon alley, magenta and cyan signs bleeding color across wet pavement. Steam rises from a grate as he passes, curling into the haze. He slows, glances back over his shoulder — coat fabric settles — then continues into fog. Lateral tracking at shoulder height, 40mm anamorphic with horizontal flares, teal-magenta split grade, Kodak 500T halation on neon, crushed blacks, atmospheric fog, wet asphalt reflections, footsteps on concrete and distant bass hum, no music.

Example 3 — Input: "old man tends a garden at dawn"

An elderly man kneels in a small garden as early light breaks across damp soil, his weathered hands pressing a seedling into earth. Steam rises faintly from the ground. He pauses, looks up at the brightening sky, then returns to the row. Locked-off wide shot, 35mm spherical, deep focus, golden hour side-light with long shadows and halation on the horizon, Kodak Portra warmth, fine grain, birdsong layered over soil foley and distant wind, no music.

---

{creative_context_section}

{user_instructions_section}

# USER'S ORIGINAL PROMPT TO POLISH

{user_prompt}

Polish the user's video prompt into concise cinematic language. Keep their meaning intact — elevate the language, add precise motion/visual/technical details where helpful, and append a style keyword tail. Do not restructure into rigid sections. The user's prompt defines the scope and subject — respect it.

{user_instructions_reminder}"""


VIDEO_REFERENCE_PROMPT = """# CINEMATIC VIDEO PROMPT OPTIMIZATION

Below is the reference guide for constructing cinema-quality video generation prompts, followed by the user's original prompt to optimize.

# OUTPUT SCHEMA

Structure the optimized prompt using these sections in order:

SUMMARY
[One sentence. Lead with the dominant visual element — whatever defines this shot most. Weave in the dominant style cue when it shapes the image as much as the content does. End with "no music, no singing" unless music is intended.]

CAMERA
[10-20 words: angle, movement, lens type. E.g. "Slow push-in from medium shot, 50mm spherical, eye level, slightly off-center" or "Lateral tracking at shoulder height, 40mm anamorphic, shallow DoF"]

MOTION
[30-50 words: subject actions and transformations across the clip duration. Consider a temporal arc — setup, action, settle. Describe the motion sequence with environmental detail where it adds depth. For clips with reference frames, describe the A-to-B transformation.]

STYLE
[30-50 words: the visual DNA of the clip. Cover color grade + film stock, lens character, grain/texture, lighting quality, atmosphere, material feel, and era or stylization cues. This section should feel like a DP's lookup table — dense, specific, layered. E.g. "Fuji Eterna muted tones, 35mm spherical with clean circular bokeh, fine grain with halation on window highlights, soft overcast daylight diffused through sheer curtains, warm bounce off wooden table, desaturated greens and olive skin tones, lifted blacks, condensation on glass, 1970s naturalistic warmth"]

DIALOGUE
[If dialogue exists: describe speaker by visual appearance + exact line + voice characteristics. For voice-over: "Voice-over narration: 'exact text'. Voice description." Empty string if no dialogue.]

SOUND
[10-15 words: key audio elements. Always end with "no music, no singing" unless music is intended. E.g. "Footsteps, ambient wind, fabric rustle, no music, no singing"]

NOTE
[10-20 words: consistency requirements, continuity, constraints. E.g. "Maintain facial features throughout. No subtitles." Empty string if not needed.]

NEGATIVE
[15-25 words: list elements directly — "morphing, warped hands, subtitles" not "don't show morphing". Always include "subtitles". Character clips: "blurry, distorted face, warped hands, subtitles, split screen". General: "low quality, color shifts, unnatural transitions, subtitles"]

{frame_mode_section}

# TECHNICAL VOCABULARY REFERENCE

Use precise cinematic terms from this reference when constructing prompts.

Camera Movement:
- Dolly-in/out: physical approach/retreat, emotional proximity shift
- Pan: horizontal sweep, following action or revealing space
- Tilt: vertical sweep, power dynamics or scale reveal
- Track/lateral dolly: parallel motion alongside subject
- Crane/jib: vertical elevation change, establishing or departing
- Steadicam: fluid following, immersive stability
- Handheld: raw urgency, documentary intimacy
- Static locked-off: deliberate stillness, tension
- Orbital: circling subject, hero reveal
- Whip pan: fast snap between subjects
- Push-in: slow approach building tension
- Rack focus: shift focus between foreground and background — time-based depth reveal
- Truck: lateral displacement, whole frame shifts (vs pan which rotates)
- Dolly zoom (Vertigo): simultaneous dolly + zoom, disorienting scale shift

Camera & Lens:
- 24mm wide-angle: spatial presence, environmental context
- 35mm: indie intimacy, documentary feel, natural perspective
- 50mm: human-eye equivalent, neutral, honest
- 85mm: portrait compression, subject isolation, emotional distance
- 135mm telephoto: voyeuristic separation, loneliness
- f/1.4 razor-thin DoF, f/2.8 subject separation, f/5.6 context visible, f/11 deep focus
- Low angle (power/threat), eye-level neutral, high angle (vulnerability), dutch angle (disorientation)
- ECU (texture/detail), CU (emotion), MCU (dialogue), MS (body language), WS (context), EWS (isolation/scale)
- Anamorphic: oval bokeh, horizontal flares, lens breathing, edge softness — prestige cinematic
- Spherical: circular bokeh, clean optics, natural perspective — naturalistic
- Vintage glass: chromatic aberration, vignetting, soft periphery — period warmth

Lighting:
- Sources: tungsten fresnel key, softbox overhead, rim light, practical lamp, window daylight, neon, streetlight sodium vapor
- Quality: hard light crisp shadows, soft diffused wrap-around, specular pinpoint highlights
- Temperature: 2700K warm amber, 3200K incandescent, 5600K daylight, 6500K overcast cool, 8000K blue hour cold
- Setups: Rembrandt, butterfly, split, high-key, low-key
- Decay path: where light hits, fades, vanishes into shadow — forces depth and contrast
- Bounce: indirect light colored by reflecting surface (warm off wood, cool off concrete)

Materials & Textures:
- Skin: subsurface scattering, pores, specular shifting with motion
- Fabrics: silk sheen, leather crease, denim weight, cotton drape settling after movement
- Surfaces: wet asphalt reflections, weathered wood grain, condensation on glass, oxidized metal patina

Motion Language:
- Subject: walks, runs, turns, reaches, grips, releases, leans, rises, falls, spins, flinches, gestures
- Force verbs: push, pull, strike, slam, sway, ripple, spiral, recoil — one dominant force per motion reads cleaner
- Speed: slow-motion, real-time, speed-ramp, time-lapse, freeze-to-motion
- Physics: momentum, weight, inertia, gravity, settling, friction drag, fluid resistance, elastic snap
- Material behavior: hair sways and settles, cloth drapes with weight, liquid sloshes, smoke disperses, paper flutters
- Environmental: leaves drift, water ripples, fire flickers, curtains billow, rain streaks, steam curls from surface
- Temporal arc: consider setup (stillness/drift) -> action -> settle. Accelerate in, decelerate out. Hold the ending rather than cutting mid-motion.
- Body language: posture shift, eyeline change, hand gesture, weight transfer, head turn

Sound Design:
- Ambient: room tone, wind, traffic, rain, crowd murmur, ocean, machinery hum
- Foley: footsteps, fabric rustle, glass clink, door creak, key turn, breath, impact
- Design: bass rumble, high-frequency tension tone, reverb tail, silence beat, riser
- Music constraint: "no music, no singing" unless script specifies music
- Voice: on-screen dialogue, voice-over narration, whisper, shout
- Audio separation: SFX, ambient, and dialogue benefit from distinct sentences — "SFX: glass shatters. Ambient: office hum."
- Dialogue format: describe speaker by appearance with colon — "The woman in red says: I need to leave." Keep under 10 seconds.

Atmosphere:
- Morning fog volumetric, light drizzle, heat shimmer, snow, dust motes Tyndall effect
- Steam rising, smoke wisps, breath visible in cold, atmospheric haze

Spatial Depth & Perspective:
- Density gradient: near = sharp detail and texture, far = sparse, soft, desaturated
- Spatial layering: foreground, midground, background as separate planes with distinct content
- Depth-through-motion: parallax between layers — foreground passes faster than background

Color Science:
- Grading: teal-orange cinematic LUT, bleach bypass, cross-processed, ACES filmic
- Saturation: vibrant, moderately saturated natural, desaturated muted, monochromatic
- Contrast: crushed blacks, compressed tonal range, natural gamma, flat log
- Tone curves: S-curve lifted blacks, linear natural, faded raised blacks, HDR extended range
- Temperature shifts: cool 7000K steel blues, warm 3000K amber-honey, mixed tungsten-daylight contrast
- Film stock: Kodak Vision3 500T (rich blacks, warm halation), Portra 400 (golden skin tones), Fuji Eterna (cool muted cinema)
- Grain & texture: fine 35mm grain, heavy 16mm grit, halation glow on bright sources, gate weave frame drift

Visual Emotion:
- Melancholic contemplative, energetic kinetic, oppressive claustrophobic, dreamy ethereal, gritty raw
- Nostalgic warmth, sterile clinical, intimate quiet intensity, epic grandiose scale
- Genre signatures: horror = underlit, sickly tones, negative space; romance = warm diffusion, golden backlight, intimate framing; thriller = cold, tight, hard side light; documentary = handheld, available light, observational

# SCRIPT-TO-VISUAL CONVERSION

When the user's intent is abstract, convert it into visible motion:
- "feels trapped" -> tight framing, slow push-in, shallow focus, foreground obstruction, restricted movement
- "drifting apart" -> subjects moving to opposite edges, widening shot, different light pools
- "hope returns" -> light shift cool to warm, subject lifts head, posture opens, camera slowly rises
- "time slipping" -> speed-ramp, focus drift, subtle slow-motion, environmental decay details
- "tension" -> tight MCU, slow creeping dolly, hard side light, grip tightening, breath held
- "joy" -> open framing, warm daylight, fluid handheld, genuine expression bloom, catch lights

# LOOK RECIPES

Draw from these aesthetic presets as starting points, then customize:

1. NATURALISTIC MELANCHOLY — Soft window light, muted earth palette, 35mm, light grain, desaturated tones, locked-off camera, quiet negative space, slow deliberate movement
2. NOCTURNAL LONELINESS — Sodium-vapor orange, deep crushed shadows, wet asphalt reflections, 50-85mm compression, atmospheric haze, teal-amber split, isolated pools of light
3. INTIMATE HANDHELD REALISM — Practical lights only, slightly imperfect framing, shallow DoF f/1.4-2.0, 16mm grain, warm incandescent cast, breathing camera
4. DREAMED MEMORY — Overexposed highlights with halation bloom, pastel desaturation, soft focus edges, gentle lens flare, lifted blacks, ethereal diffusion, slow-motion drift
5. HORROR DREAD — Underlit single hard source, sickly desaturated tones, handheld drift, crushed blacks, negative space, silence punctuated by sharp foley
6. GOLDEN HOUR INTIMACY — Warm amber backlight, halation bloom, shallow DoF f/1.4, Portra skin tones, gentle handheld, pastel warmth, natural lens flare
7. NEON NOCTURNE — Magenta-cyan practical gels, anamorphic flares, wet reflections, aggressive contrast, deep fog, pulsing color pools
8. ARTHOUSE STILLNESS — Locked-off camera, slow deliberate blocking, muted palette with one accent color, deep focus, long holds, silence as texture

# STYLIZATION REFERENCES

When the user references a style by name, use these keyword sets:

1. Wong Kar-Wai — saturated film colors, neon bokeh nights, step-printing motion blur, handheld drift, rain-soaked streets, intimate close-ups, cigarette haze halation
2. Film noir — hard chiaroscuro, venetian-blind shadows, wet asphalt, tungsten streetlamps, high-contrast monochrome, dutch angles, slow push-ins
3. Neon cyberpunk noir — magenta-cyan LEDs, anamorphic streak flares, chrome highlights, wet neon puddles, aggressive contrast, glitchy jump cuts
4. Christopher Nolan — IMAX-scale wides, practical light realism, cool steel-blue grade, clean geometric blocking, restrained handheld urgency
5. Quentin Tarantino — trunk POV, whip-pan reframes, punch-in close-ups, grindhouse grit, saturated primaries, needle-drop energy
6. Wes Anderson — dead-center symmetry, pastel color blocking, lateral tracking, snap zooms, theatrical set flats, deadpan timing
7. David Fincher — cold desaturated grade, precision camera discipline, slow creeping dolly, symmetrical framing, razor-sharp shadows, dread pacing
8. Stanley Kubrick — one-point perspective, symmetrical frames, slow hypnotic zooms, wide-angle distortion, clinical lighting, ominous silence
9. Denis Villeneuve — monumental minimalism, foggy desaturation, vast negative space, slow measured pushes, bass-droning sound, brutalist scale
10. Martin Scorsese — swaggering tracking shots, crash-zoom emphasis, freeze-frame punctuation, kinetic crowd staging, voice-over confession tone

Cinematographer Styles:
- Roger Deakins — precise shadow geometry, underlit atmosphere, minimal light sources
- Emmanuel Lubezki — natural light only, long fluid takes, golden hour immersion
- Bradford Young — intimate ambient light, rich skin tones, underexposed warmth
- Hoyte van Hoytema — shallow DoF, single motivated source, IMAX naturalism

Film Era Keywords:
- 1970s: warm earth tones, visible grain, practical tungsten, halation, naturalistic handheld
- 1980s: neon, hard contrast, saturated primaries, synthwave color
- 1990s: desaturated cool, handheld minimalism, flat grade, indie grain
- Y2K: chrome futurism, iridescent, neon pinks, electric blues, aggressive digital sharpness

If the user names a style not listed here, extrapolate from the filmmaker/genre's known visual language.

# EXAMPLE OUTPUTS

Example 1 — Input: "woman sits alone in a cafe, remembering something"

SUMMARY
Muted Eterna tones in a near-empty cafe — a woman sits motionless, gaze drifting to the rain-streaked window as a memory surfaces, no music, no singing.

CAMERA
Slow push-in from medium shot to MCU, 50mm spherical, eye level, slightly off-center framing.

MOTION
Woman's eyes shift from coffee cup to window over 2 seconds, holds stillness. Fingers loosen around the cup. Rain streaks crawl down glass behind her. Steam curls from the cup surface. At 6 seconds, she blinks slowly and looks down. Cloth sleeve settles as her arm relaxes.

STYLE
Fuji Eterna muted tones, fine 35mm grain, soft window daylight with warm bounce off wooden table, desaturated greens and warm skin, lifted blacks, subtle halation on the bright window.

DIALOGUE


SOUND
Rain on glass, distant cafe murmur, ceramic cup set down softly, no music, no singing.

NOTE
Maintain subtle facial continuity throughout — the emotion is internal, not performed. No subtitles.

NEGATIVE
Exaggerated expression, tears, dramatic gestures, morphing, color shifts, subtitles, split screen.

Example 2 — Input: "man walks through neon alley at night, alone"

SUMMARY
Neon-drenched rain-slicked alley, anamorphic flares and Kodak 500T halation — a lone figure in a dark coat moves through bleeding magenta-cyan reflections, no music.

CAMERA
Lateral tracking at shoulder height, 40mm anamorphic, shallow DoF, horizontal flares from neon signs.

MOTION
He strides at steady pace for 3 seconds, passes a steam grate — vapor rises and curls around his legs. Slows at 5 seconds, glances back over shoulder. Coat fabric settles after the turn. He continues into the haze. Neon reflections ripple across wet asphalt as he passes.

STYLE
Teal-magenta split grade, anamorphic oval bokeh, Kodak 500T halation on neon sources, crushed blacks, wet asphalt specular reflections, atmospheric fog, heavy 35mm grain.

DIALOGUE


SOUND
Footsteps on wet concrete, distant bass hum, steam hiss, fabric rustle, no music, no singing.

NOTE
Neon reflections track consistently with his movement. Coat maintains form throughout.

NEGATIVE
Face distortion, warped hands, neon color bleeding unrealistically onto skin, morphing, subtitles, split screen.

Example 3 — Input: "old man tends a garden at dawn"

SUMMARY
Golden hour Portra warmth — an elderly man kneels in a small garden as early light breaks across damp soil, pressing a seedling into earth, no music.

CAMERA
Locked-off wide shot, 35mm spherical, deep focus, slightly low angle.

MOTION
Hands press seedling into dark soil, fingers pat earth around the stem. Steam rises faintly from the ground in the cold morning air. He pauses at 4 seconds, lifts his gaze to the brightening sky. Holds there, then returns to the row. Leaves in the background drift in a light breeze.

STYLE
Kodak Portra warmth, golden hour side-light with long shadows, fine grain, halation bloom on the bright horizon, muted earth palette with green accents, natural lens flare.

DIALOGUE


SOUND
Birdsong, soil compression under hands, distant wind, leaves rustling, no music, no singing.

NOTE
Maintain hand detail and seedling form throughout. No subtitles.

NEGATIVE
Morphing, warping, face distortion, unnatural plant growth, color shifts, subtitles, split screen.

---

{creative_context_section}

{user_instructions_section}

# USER'S ORIGINAL PROMPT TO OPTIMIZE

This is the prompt you must transform into a structured cinematic video generation prompt:

{user_prompt}

Using the reference guide above, optimize the user's prompt into the structured cinematic video format. Preserve the core intent. The user's prompt may not cover everything described in the project context — that's intentional. Focus on what the user wrote, not on what the context contains. The result must feel like a specific continuous clip — motion unfolding over 8-10 seconds of cinema.

{user_instructions_reminder}"""


# Frame mode guidance injected into the reference prompt
_FRAME_MODE_SECTIONS = {
    "dual": """# FRAME CONTEXT

Start and end frames are provided. Describe the A-to-B transformation across the clip, based on visible differences between frames.
- Transitions must be physically plausible within the clip duration
- No teleportation or impossible jumps — plan natural, logical motion paths that smoothly connect frame A to frame B
- Describe progressive motion: what changes gradually from start state to end state""",

    "single": """# FRAME CONTEXT

A start frame is provided. Describe motion progressing from the visible start state, spanning the full clip duration.
- Use the start frame as your ground truth for the scene's appearance
- Plan motion that fills the full clip duration naturally from this starting point""",

    "none": "",
}


def _build_video_user_message(prompt: str, user_instructions: str = None, creative_context: str = None, mode: str = "detailed", frame_mode: str = "none") -> str:
    """Build the full user message for video optimization."""
    instructions_section, instructions_reminder, context_section = _build_instructions_and_context(user_instructions, creative_context)

    frame_section = _FRAME_MODE_SECTIONS.get(frame_mode, "")

    template = CONCISE_VIDEO_REFERENCE_PROMPT if mode == "concise" else VIDEO_REFERENCE_PROMPT
    return template.format(
        user_prompt=prompt,
        user_instructions_section=instructions_section,
        user_instructions_reminder=instructions_reminder,
        creative_context_section=context_section,
        frame_mode_section=frame_section,
    )


def optimize_video_with_gemini(prompt: str, user_instructions: str = None, image_urls: list[str] = None, creative_context: str = None, stream_callback=None, mode: str = "detailed", frame_mode: str = "none", context_images: list[dict] = None) -> str:
    """Optimize video prompt using Gemini. Supports multimodal input with reference frame images."""
    llm = get_llm("gemini")
    system = CONCISE_VIDEO_SYSTEM_INSTRUCTION if mode == "concise" else VIDEO_SYSTEM_INSTRUCTION
    text_message = _build_video_user_message(prompt, user_instructions, creative_context, mode=mode, frame_mode=frame_mode)

    has_images = image_urls or context_images

    # Build multimodal content if frame images provided
    if has_images:
        parts = []
        parts.append(types.Part.from_text(text=text_message))

        # Label frames based on frame_mode
        if image_urls:
            if frame_mode == "dual" and len(image_urls) >= 2:
                parts.append(types.Part.from_text(
                    text="\n\n# START FRAME\n\nThis is the starting frame of the clip. Study its composition, subjects, and visual state."
                ))
                parts.append(types.Part.from_uri(file_uri=_to_gs_uri(image_urls[0]), mime_type="image/png"))
                parts.append(types.Part.from_text(
                    text="\n\n# END FRAME\n\nThis is the ending frame of the clip. Compare with the start frame to understand the motion transformation."
                ))
                parts.append(types.Part.from_uri(file_uri=_to_gs_uri(image_urls[1]), mime_type="image/png"))
                for url in image_urls[2:]:
                    parts.append(types.Part.from_uri(file_uri=_to_gs_uri(url), mime_type="image/png"))
            elif frame_mode == "single" and len(image_urls) >= 1:
                parts.append(types.Part.from_text(
                    text="\n\n# START FRAME\n\nThis is the starting frame of the clip. Use it as ground truth for the scene's visual state."
                ))
                parts.append(types.Part.from_uri(file_uri=_to_gs_uri(image_urls[0]), mime_type="image/png"))
                for url in image_urls[1:]:
                    parts.append(types.Part.from_uri(file_uri=_to_gs_uri(url), mime_type="image/png"))
            else:
                parts.append(types.Part.from_text(
                    text="\n\n# REFERENCE IMAGES\n\nThe following images are visual references. "
                         "Study their composition, lighting, color palette, mood, and style to inform your optimized prompt."
                ))
                for url in image_urls:
                    parts.append(types.Part.from_uri(file_uri=_to_gs_uri(url), mime_type="image/png"))

        if context_images:
            _append_context_images(parts, context_images)

        contents = [types.Content(role="user", parts=parts)]
    else:
        contents = text_message

    return llm.generate(
        system_instruction=system,
        contents=contents,
        model="gemini-3.1-pro-preview",
        location="global",
        thinking=True,
        stream_callback=stream_callback,
    ).text
