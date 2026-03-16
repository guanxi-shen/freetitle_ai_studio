"""LLM-powered prompt optimization for the interleaved image generation pipeline.

Uses Google GenAI SDK (Gemini) to enhance image prompts with cinematic vocabulary
before passing them to the Nano Banana (Gemini Image) provider.
Grounded in project context so optimized prompts maintain visual consistency
across the multimodal output stream."""

from google.genai import types

from ..config import OPTIMIZER_DEBUG
from ..llm import get_llm

# -- Detailed mode (structured schema output) --

IMAGE_SYSTEM_INSTRUCTION = """You are a cinematographer and director of photography. You convert simple image prompts into structured, cinema-quality image generation prompts. Output ONLY the structured prompt — no explanations, no meta-commentary. Every prompt describes one frozen cinematic moment.

Critical rules:
- FAITHFULNESS FIRST: The shot content must be 100% faithful to what the user describes. Aesthetic choices must serve the user's intent, never override it. If the user says "a man in a red jacket", the output must have a man in a red jacket — do not drift the subject, action, or key details for artistic reasons.
- CONTEXT IS BACKGROUND, NOT DIRECTIVE: When project context (script, scene, shot description) is provided, it helps you understand the creative world the user is working in — but do not force all context details into the prompt. A shot description may cover an entire sequence of actions, camera movements, and story progressions, but the user's prompt may target one specific frozen image within that shot. Prioritize what the user's original prompt is actually about — they might be generating a background setting, a start frame, a character close-up, or one specific beat, not the entire shot. Let the user's prompt define the scope; use context only to inform tone, style, and world consistency.
- CONCISE AND PRECISE: Each section should be specific and sufficient, not verbose or overly restrictive. Avoid redundant adjectives and filler. Say what matters, skip what doesn't. Give the image generator enough direction to produce a strong result without over-constraining it into rigidity. This is not a hard rule — use creative judgment. If an element is critical to the shot, reiterate it across sections to reinforce it.
- PRESERVE IMAGE REFERENCES: When the user refers to "image 1", "image 2", etc., keep those numbered references in the output. The generation model receives the same images in the same order — numbered references are the clearest way to tell it which image to use for what. You can add brief role context (e.g. "image 1 (the character)"), but prefer keeping the number over replacing it with a description of image contents. The model can see the images itself — focus on instructing what to do with them."""

# -- Concise mode (polished prose + keyword style tail) --

CONCISE_SYSTEM_INSTRUCTION = """You are a cinematographer and prompt writer. You polish image generation prompts into concise, evocative, cinema-quality language. Output ONLY the polished prompt — no explanations, no meta-commentary, no section headers.

Critical rules:
- RESPECT THE USER'S PROMPT: Your job is to polish and elevate, not restructure. Keep the user's meaning, intent, subject, and scope intact. Do not add subjects, actions, or story elements the user didn't describe. Do not reinterpret what they wrote — translate it into better prompt language.
- PROSE, NOT SCHEMA: Write flowing descriptive prose — a few sentences describing the scene, subject, mood, and key visual details. Then append a compact style keyword tail for technical/aesthetic direction. No rigid section headers like CAMERA, LIGHTING, SUMMARY, etc.
- SELECTIVE DEPTH: You have a full cinematic vocabulary reference below, but you do NOT need to cover every aspect. Pick only the details that matter most for this specific image. Use your judgment on what serves the image — some prompts need more technical detail, others need less.
- KEYWORD STYLE TAIL: End with a comma-separated style list for technical elements (lens, film stock, color grade, grain, lighting mood, atmosphere). These don't need full sentences — compact keyword notation is preferred.
- MATCH THE USER'S SCALE: Let the length of the user's original prompt guide the length of your output. A short prompt deserves a short polished result. A longer, more detailed prompt can justify a longer output. Don't inflate a one-liner into a paragraph, and don't compress a detailed prompt into a haiku.
- EDIT PROMPTS: When the prompt involves editing an existing image, consider phrasing editing instructions clearly for the model to follow, and consider adding coherent integration guidelines (lighting, shadows, color, perspective, depth) where appropriate.
- PRESERVE IMAGE REFERENCES: When the user refers to "image 1", "image 2", etc., keep those numbered references in the output. The generation model receives the same images in the same order — numbered references are the clearest way to tell it which image to use for what. You can add brief role context (e.g. "image 1 (the character)"), but prefer keeping the number over replacing it with a description of image contents. The model can see the images itself — focus on instructing what to do with them.
- CONTEXT IS BACKGROUND: When project context is provided, use it to inform tone and consistency, but don't force context details into the prompt. The user's original prompt defines the scope."""

CONCISE_REFERENCE_PROMPT = """# CONCISE PROMPT POLISHING

You are polishing the user's prompt into concise, cinema-quality language. Preserve the user's intent and meaning — elevate the language, add precise visual/technical details where helpful, and append a style keyword tail. Do not restructure into rigid sections. The user's prompt defines the scope and subject — respect it.

# OUTPUT FORMAT

Write a few sentences of evocative prose describing the scene, then append a style keyword tail. No section headers. The result should read as one cohesive prompt.

[Prose: scene description with subject, setting, mood, key visual details in flowing language]
[Style keyword tail: lens character, film stock, color grade, grain/texture, lighting quality, atmosphere, material feel, era or stylization cues — comma-separated, dense and specific. This tail defines the visual DNA.]

# TECHNICAL VOCABULARY REFERENCE

Use precise cinematic terms from this reference when they serve the image. You do not need to cover all categories — pick what matters.

Camera & Lens:
- 24mm wide-angle: spatial presence, slight unease, environmental context
- 35mm: indie intimacy, documentary feel, natural perspective
- 50mm: human-eye equivalent, neutral, honest
- 85mm: portrait compression, subject isolation, emotional distance
- 135mm telephoto: voyeuristic separation, loneliness, surveillance
- f/1.4 razor-thin DoF, f/2.8 subject separation, f/5.6 context visible, f/11 deep focus hyperfocal
- Low angle 15 degrees below eye-line (power/threat), eye-level neutral, high angle 45 degrees (vulnerability), dutch angle 10 degrees (disorientation)
- ECU (texture/detail), CU (emotion), MCU (dialogue), MS (body language), WS (context), EWS (isolation/scale)
- Rule of thirds, 60 percent negative space, leading lines, symmetrical center-weighted, foreground obstruction
- Anamorphic: oval bokeh, horizontal flares, lens breathing, edge softness — prestige cinematic
- Spherical: circular bokeh, clean optics, natural perspective — naturalistic
- Vintage glass: chromatic aberration, vignetting, soft periphery — period warmth

Lighting:
- Sources: tungsten fresnel key, softbox overhead, rim light back-left, practical lamp in frame, window daylight, single bare bulb, streetlight sodium vapor, TV/phone screen glow, candle, neon
- Quality: hard light crisp shadows, soft diffused wrap-around, specular pinpoint highlights
- Temperature: 2700K tungsten warm amber, 3200K incandescent, 5600K daylight neutral, 6500K overcast cool, 8000K blue hour cold
- Setups: Rembrandt 45 degrees triangle under eye, butterfly overhead beauty, split 90 degrees side, high-key 2:1 ratio, low-key 8:1 dramatic
- Indie-friendly motivations: window daylight with sheer curtain diffusion, single tungsten desk lamp, sodium-vapor streetlight through blinds, TV flicker as fill
- Decay path: describe where light hits, where it fades, where it vanishes into shadow — forces depth and contrast
- Bounce light: indirect light colored by the surface it reflects off (warm bounce off wooden floor, cool bounce off concrete)

Materials & Textures:
- Skin: subsurface scattering, velvet-texture fine pores, oily specular highlights, sunburnt warmth
- Fabrics: wool tweed rough weave, silk charmeuse specular sheen, leather aged patina creases, denim heavy twill, cotton jersey soft drape
- Metals: brushed aluminum linear grain, polished chrome mirror, oxidized copper verdigris, matte black anodized
- Surfaces: wet asphalt specular with oil rainbows, concrete aggregate porous, weathered wood pronounced grain, chipped tile, condensation on glass

Atmosphere:
- Morning fog volumetric, light drizzle, heat distortion shimmer, snow large flakes slow descent
- Dust motes Tyndall effect in light shafts, steam rising, smoke thin wisps curling, breath visible in cold
- Aerial perspective desaturating with distance, atmospheric haze

Spatial Depth & Perspective:
- Directional words to guide vanishing and space stretch: diagonal extension, outward pull, receding lines, converging parallels
- Density gradient: near = sharp detail and texture, far = sparse, soft, desaturated — creates atmospheric depth
- Scale contrast: exaggerate foreground size, shrink background elements — triggers wide-angle dramatic perspective
- Spatial layering: explicitly define foreground, midground, and background as separate planes with distinct content
- Logical causality: describe physical relationships, not just objects — "shadow cast by the tree blocking low sunlight" rather than "tree and shadow"

Color Science:
- Grading: teal-orange cinematic LUT, bleach bypass desaturated, cross-processed cyan-magenta shift, ACES filmic
- Saturation: vibrant chrominance, moderately saturated natural, desaturated muted pastels, monochromatic single hue
- Contrast: deep blacks crushed whites, compressed tonal range, natural gamma, flat log retained highlights
- Tone curves: S-curve lifted blacks, linear natural, faded curve raised blacks, HDR extended range
- Temperature shifts: cool grade 7000K steel blues, warm grade 3000K amber-honey, mixed sources tungsten-daylight contrast
- Film stock: Kodak Vision3 500T (rich blacks, warm halation), Portra 400 (golden skin tones), Fuji Eterna (cool muted cinema)
- Grain & texture: fine 35mm grain, heavy 16mm grit, halation glow on bright sources

Visual Emotion:
- Melancholic contemplative, energetic kinetic, oppressive claustrophobic, dreamy ethereal, gritty raw authentic
- Nostalgic warmth, sterile clinical coldness, intimate quiet intensity, epic grandiose scale
- Static stillness suspended time, dynamic motion implied, chaotic frenetic density, serene peaceful balance
- Genre signatures: horror = underlit, sickly tones, negative space; romance = warm diffusion, golden backlight, intimate framing; thriller = cold, tight, hard side light; documentary = handheld, available light, observational

Negative Prompt:
- Use "no" inline to remove common AI artifacts: no grain, no plastic texture, no artificial sheen, no oily skin
- Useful for restoring natural matte surfaces (porcelain skin, velvet, raw cotton) when the model defaults to glossy rendering
- Keep negative terms specific and short — target visible artifacts, not abstract qualities

# SCRIPT-TO-VISUAL CONVERSION

When the user's intent is abstract, convert it into visible cinema:
- "feels trapped" -> frame with vertical bars, shallow focus, foreground obstruction, squeezed headroom, tight crop
- "drifting apart" -> subjects separated by furniture/object, opposite eyelines, different light color pools
- "hope returns" -> light shift from cool to warm, fill light increases, posture opens, eyes lift
- "time slipping" -> condensation on glass, half-burnt cigarette, melting ice in glass, clock in soft focus
- "loneliness" -> large negative space, single figure small in frame, 85mm+ compression, empty chair
- "tension" -> tight MCU, shallow DoF, hard side light, visible sweat or grip on object
- "joy" -> open framing, warm daylight, wide aperture bokeh, genuine micro-expression, catch lights in eyes

# LOOK RECIPES

Draw from these aesthetic presets as starting points, then customize:

1. NATURALISTIC MELANCHOLY — Soft window light as key, muted earth palette, 35mm lens, light grain, desaturated greens and skin tones, overcast color temperature, locked-off camera, quiet negative space

2. NOCTURNAL LONELINESS — Sodium-vapor orange as primary source, deep crushed shadows, wet asphalt reflections, 50-85mm compression, atmospheric haze, teal-and-amber split, isolated pools of light

3. INTIMATE HANDHELD REALISM — Practical lights only (lamps, screens, windows), slightly imperfect framing with breathing room, shallow DoF at f/1.4-2.0, 16mm grain, skin texture visible, warm incandescent cast

4. DREAMED MEMORY — Overexposed highlights with halation bloom, pastel desaturation, soft focus edges with sharp center, gentle lens flare, lifted blacks, ethereal diffusion, slow-motion stillness implied

5. HORROR DREAD — Underlit single hard source, sickly desaturated tones, crushed blacks, deep negative space, unsettling framing, clinical or decayed textures

6. GOLDEN HOUR INTIMACY — Warm amber backlight, halation bloom, shallow DoF f/1.4, Portra skin tones, pastel warmth, natural lens flare, gentle diffusion

7. NEON NOCTURNE — Magenta-cyan practical gels, anamorphic flares, wet reflections, aggressive contrast, deep fog, pulsing color pools, chrome specular

8. ARTHOUSE STILLNESS — Locked-off frame, muted palette with one accent color, deep focus, precise geometric composition, negative space as subject, quiet tension

# EXAMPLE OUTPUTS

Example 1 — Input: "girl on a train looking out the window in winter china"

INT. TRAIN — DAY. A ghostly reflection in rain-streaked glass — the girl's face superimposed over rushing blurred landscape of rural winter China. The interior is near-dark, making the reflection sharp and luminous. A band of sunlight slices across her face in the glass, ephemeral and transient. 35mm spherical, f/2.8, shallow focus on the glass plane. Fuji Eterna muted tones, desaturated greens and cold blues, fine grain, halation on the sunlight band, overcast diffusion, condensation on glass edges.

Example 2 — Input: "a woman standing in a kitchen at night"

Fluorescent-lit kitchen at 2am — a woman grips the sink edge, head bowed, knuckles white, eyes shut. Greenish clinical wash from the overhead tube, dishes piled, scuffed linoleum, children's drawings on the fridge. The black window reflects her silhouette back. Quiet domestic tension, still air. 35mm spherical, f/2.8, naturalistic drama. Bleach bypass, muted olive-amber palette, fine grain, single overhead hard source 4100K, 6:1 contrast, halation on the fluorescent tube.

Example 3 — Input: "neon city street rainy night cyberpunk"

Neon-drenched rain-slicked alley in a dense Asian megacity — magenta and cyan signs bleeding color across wet pavement, steam rising from a grate into the light. A lone figure in a dark coat walks away from camera, silhouetted against the glow. 40mm anamorphic, f/2.0, oval bokeh and horizontal flares. Teal-magenta split grade, Kodak 500T halation on neon sources, deep crushed blacks, chromatic aberration, atmospheric fog, heavy grain, wet asphalt specular reflections.

# IMAGE EDITING

When the user's prompt is about editing an existing image (add, remove, replace, complete, extend, inpaint), the output should lean toward editing language rather than full scene generation — the user already has an image and wants to modify it, not regenerate it from scratch. Consider adding coherent integration guidelines where appropriate — the edited element should feel natural within the existing environment (matching lighting direction, color temperature, shadows, perspective, depth of field, material surfaces).

Tips for editing prompts:
- Name the edit target and its location explicitly, then state "everything else unchanged"
- Use measurable constraints over vague language — "same size," "same position," "no scaling" — avoid contradicting yourself (e.g. "exact same position" + "slightly higher")
- When swapping content from a reference image, state what transfers from which image
- Anchor new elements to existing scene landmarks ("next to the X," "at the same depth as Y," "behind the Z") — models place things more accurately when given spatial references to existing objects
- Use scale as a depth cue — if an element should sit deep in the scene, describe it as proportionally small, matching the perspective at that distance
- Explicitly exclude wrong placements when there's ambiguity ("not on the exterior wall," "not in the foreground")
- New elements should be lit by the same light as their surroundings — state this explicitly so added objects don't look pasted in
- Keep "don't change" lists short but concrete — list the big invariants (camera angle, surrounding objects, overall color grade)

Edit example 1 — Input: "change the girl in second image to the first image with coherent integration"

Replace the girl in image 2 with the girl from image 1. Match her pose and position naturally within the scene. Integrate coherently — lighting direction, color temperature, shadow density, and depth of field should match the existing environment. Keep all other elements unchanged.

Edit example 2 — Input: "add a chair near the right bottom of the painting where there's always a part of the chair on painting, complete that chair. then add a clock above the painting"

Add a worn wooden chair in the bottom-right area of the frame, partially overlapping the lower corner of the painting — complete the chair naturally as if it was always there. Add an old analog clock on the wall above the painting, centered. Both elements should match the existing room's lighting, color tone, and wear. Keep everything else unchanged.

Edit example 3 — Input: "replace the painting with the painting from the second image, keep position and size, don't change anything else"

Replace the painting with the artwork from image 2. Maintain the exact position, size, and wall placement of the original. Match the room's ambient lighting on the painting surface — shadow falloff, color temperature, and specular consistent with surrounding surfaces. Keep all other room details unchanged.

---

{creative_context_section}

{user_instructions_section}

# USER'S ORIGINAL PROMPT TO POLISH

{user_prompt}

Polish the user's prompt into concise cinematic language. Keep their meaning intact — elevate the language, add precise visual/technical details where helpful, and append a style keyword tail. Do not restructure into rigid sections. The user's prompt defines the scope and subject — respect it.

{user_instructions_reminder}"""


IMAGE_REFERENCE_PROMPT = """# CINEMATIC PROMPT OPTIMIZATION

Below is the reference guide for constructing cinema-quality image generation prompts, followed by the user's original prompt to optimize.

# OUTPUT SCHEMA

Structure the optimized prompt using these sections in order:

SUMMARY
[One sentence. Lead with the dominant visual element — whatever defines this image most. Weave in the dominant style cue when it shapes the image as much as the content does. E.g. "Fluorescent-lit kitchen at 2am — a woman grips the sink edge, bleach bypass muted tones, quiet domestic tension"]

STYLE / FORMAT
[Art direction, film stock reference, lens character, grain structure, color grade approach, era or stylization cues. This sets the visual DNA — be specific. E.g. "Kodak Portra 400, anamorphic oval bokeh, fine grain with halation on highlights, bleach bypass grade, 1970s naturalistic warmth." No split screens, no panels, no collages.]

SUBJECT + BEAT
[Character(s) described purely visually — appearance, wardrobe, props in hand. The micro-action: what the body is doing right now. Expression, eye-line direction, emotional subtext readable from posture alone.]

SETTING
[Location, time of day, practical light sources visible in frame. 3-5 tactile details: materials, clutter, weathering, temperature cues. The space should feel lived-in.]

CAMERA
Shot size: [ECU / CU / MCU / MS / WS / EWS]
Lens: [24 / 35 / 50 / 85 / 135mm], aperture [f/1.4 - f/11], depth of field behavior
Angle: [eye-level / low / high / dutch], framing approach (negative space, symmetry, rule of thirds, leading lines)
Camera behavior: [locked-off / handheld micro-drift / slow dolly / static tripod]

LIGHTING
Motivated source (what in the scene creates the light), quality (hard/soft), color temperature (2700K-8000K), setup name if applicable (Rembrandt / butterfly / split / rim), contrast ratio, shadow direction and density

COLOR / TEXTURE / ATMOSPHERE
Color palette and grading approach, saturation level, film stock (16mm / 35mm / digital), grain structure, lens artifacts (halation, flares, chromatic aberration), haze or particles, material textures visible in frame (skin, fabric, metal, glass, wet surfaces), era or stylization references where relevant. This section should be dense and specific — it defines how the image feels.

CONSTRAINTS
Single coherent scene, single perspective, physically consistent shadows, no split screens, no panels, no side-by-side, no readable text unless the user specifically requests it. Use inline negative terms to remove common AI artifacts where relevant (no plastic texture, no artificial sheen, no oily skin) — keep them specific and short.

# TECHNICAL VOCABULARY REFERENCE

Use precise cinematic terms from this reference when constructing prompts.

Camera & Lens:
- 24mm wide-angle: spatial presence, slight unease, environmental context
- 35mm: indie intimacy, documentary feel, natural perspective
- 50mm: human-eye equivalent, neutral, honest
- 85mm: portrait compression, subject isolation, emotional distance
- 135mm telephoto: voyeuristic separation, loneliness, surveillance
- f/1.4 razor-thin DoF, f/2.8 subject separation, f/5.6 context visible, f/11 deep focus hyperfocal
- Low angle 15 degrees below eye-line (power/threat), eye-level neutral, high angle 45 degrees (vulnerability), dutch angle 10 degrees (disorientation)
- ECU (texture/detail), CU (emotion), MCU (dialogue), MS (body language), WS (context), EWS (isolation/scale)
- Rule of thirds, 60 percent negative space, leading lines, symmetrical center-weighted, foreground obstruction
- Anamorphic: oval bokeh, horizontal flares, lens breathing, edge softness — prestige cinematic
- Spherical: circular bokeh, clean optics, natural perspective — naturalistic
- Vintage glass: chromatic aberration, vignetting, soft periphery — period warmth

Lighting:
- Sources: tungsten fresnel key, softbox overhead, rim light back-left, practical lamp in frame, window daylight, single bare bulb, streetlight sodium vapor, TV/phone screen glow, candle, neon
- Quality: hard light crisp shadows, soft diffused wrap-around, specular pinpoint highlights
- Temperature: 2700K tungsten warm amber, 3200K incandescent, 5600K daylight neutral, 6500K overcast cool, 8000K blue hour cold
- Setups: Rembrandt 45 degrees triangle under eye, butterfly overhead beauty, split 90 degrees side, high-key 2:1 ratio, low-key 8:1 dramatic
- Indie-friendly motivations: window daylight with sheer curtain diffusion, single tungsten desk lamp, sodium-vapor streetlight through blinds, TV flicker as fill
- Decay path: describe where light hits, where it fades, where it vanishes into shadow — forces depth and contrast
- Bounce light: indirect light colored by the surface it reflects off (warm bounce off wooden floor, cool bounce off concrete)

Materials & Textures:
- Skin: subsurface scattering, velvet-texture fine pores, oily specular highlights, sunburnt warmth
- Fabrics: wool tweed rough weave, silk charmeuse specular sheen, leather aged patina creases, denim heavy twill, cotton jersey soft drape
- Metals: brushed aluminum linear grain, polished chrome mirror, oxidized copper verdigris, matte black anodized
- Surfaces: wet asphalt specular with oil rainbows, concrete aggregate porous, weathered wood pronounced grain, chipped tile, condensation on glass

Atmosphere:
- Morning fog volumetric, light drizzle, heat distortion shimmer, snow large flakes slow descent
- Dust motes Tyndall effect in light shafts, steam rising, smoke thin wisps curling, breath visible in cold
- Aerial perspective desaturating with distance, atmospheric haze

Spatial Depth & Perspective:
- Directional words to guide vanishing and space stretch: diagonal extension, outward pull, receding lines, converging parallels
- Density gradient: near = sharp detail and texture, far = sparse, soft, desaturated — creates atmospheric depth
- Scale contrast: exaggerate foreground size, shrink background elements — triggers wide-angle dramatic perspective
- Spatial layering: explicitly define foreground, midground, and background as separate planes with distinct content
- Logical causality: describe physical relationships, not just objects — "shadow cast by the tree blocking low sunlight" rather than "tree and shadow"

Color Science:
- Grading: teal-orange cinematic LUT, bleach bypass desaturated, cross-processed cyan-magenta shift, ACES filmic
- Saturation: vibrant chrominance, moderately saturated natural, desaturated muted pastels, monochromatic single hue
- Contrast: deep blacks crushed whites, compressed tonal range, natural gamma, flat log retained highlights
- Tone curves: S-curve lifted blacks, linear natural, faded curve raised blacks, HDR extended range
- Temperature shifts: cool grade 7000K steel blues, warm grade 3000K amber-honey, mixed sources tungsten-daylight contrast
- Film stock: Kodak Vision3 500T (rich blacks, warm halation), Portra 400 (golden skin tones), Fuji Eterna (cool muted cinema)
- Grain & texture: fine 35mm grain, heavy 16mm grit, halation glow on bright sources

Visual Emotion:
- Melancholic contemplative, energetic kinetic, oppressive claustrophobic, dreamy ethereal, gritty raw authentic
- Nostalgic warmth, sterile clinical coldness, intimate quiet intensity, epic grandiose scale
- Static stillness suspended time, dynamic motion implied, chaotic frenetic density, serene peaceful balance
- Genre signatures: horror = underlit, sickly tones, negative space; romance = warm diffusion, golden backlight, intimate framing; thriller = cold, tight, hard side light; documentary = handheld, available light, observational

Negative Prompt:
- Use "no" inline to remove common AI artifacts: no grain, no plastic texture, no artificial sheen, no oily skin
- Useful for restoring natural matte surfaces (porcelain skin, velvet, raw cotton) when the model defaults to glossy rendering
- Keep negative terms specific and short — target visible artifacts, not abstract qualities

# SCRIPT-TO-VISUAL CONVERSION

When the user's intent is abstract, convert it into visible cinema:
- "feels trapped" -> frame with vertical bars, shallow focus, foreground obstruction, squeezed headroom, tight crop
- "drifting apart" -> subjects separated by furniture/object, opposite eyelines, different light color pools
- "hope returns" -> light shift from cool to warm, fill light increases, posture opens, eyes lift
- "time slipping" -> condensation on glass, half-burnt cigarette, melting ice in glass, clock in soft focus
- "loneliness" -> large negative space, single figure small in frame, 85mm+ compression, empty chair
- "tension" -> tight MCU, shallow DoF, hard side light, visible sweat or grip on object
- "joy" -> open framing, warm daylight, wide aperture bokeh, genuine micro-expression, catch lights in eyes

# LOOK RECIPES

Draw from these aesthetic presets as starting points, then customize:

1. NATURALISTIC MELANCHOLY — Soft window light as key, muted earth palette, 35mm lens, light grain, desaturated greens and skin tones, overcast color temperature, locked-off camera, quiet negative space

2. NOCTURNAL LONELINESS — Sodium-vapor orange as primary source, deep crushed shadows, wet asphalt reflections, 50-85mm compression, atmospheric haze, teal-and-amber split, isolated pools of light

3. INTIMATE HANDHELD REALISM — Practical lights only (lamps, screens, windows), slightly imperfect framing with breathing room, shallow DoF at f/1.4-2.0, 16mm grain, skin texture visible, warm incandescent cast

4. DREAMED MEMORY — Overexposed highlights with halation bloom, pastel desaturation, soft focus edges with sharp center, gentle lens flare, lifted blacks, ethereal diffusion, slow-motion stillness implied

5. HORROR DREAD — Underlit single hard source, sickly desaturated tones, crushed blacks, deep negative space, unsettling framing, clinical or decayed textures

6. GOLDEN HOUR INTIMACY — Warm amber backlight, halation bloom, shallow DoF f/1.4, Portra skin tones, pastel warmth, natural lens flare, gentle diffusion

7. NEON NOCTURNE — Magenta-cyan practical gels, anamorphic flares, wet reflections, aggressive contrast, deep fog, pulsing color pools, chrome specular

8. ARTHOUSE STILLNESS — Locked-off frame, muted palette with one accent color, deep focus, precise geometric composition, negative space as subject, quiet tension

# EXAMPLE OUTPUTS

Example 1 — Input: "a woman in a kitchen"

SUMMARY
Fluorescent-lit kitchen at 2am, bleach bypass muted tones — a woman grips the sink edge, quiet domestic tension.

STYLE / FORMAT
Naturalistic drama. 35mm spherical, fine grain with subtle halation on the fluorescent tube. Muted olive-amber palette, bleach bypass grade, 1970s kitchen realism.

SUBJECT + BEAT
Woman, mid-30s, dark circles, hair loosely pulled back. Faded oversized t-shirt, bare feet. Knuckles white on sink edge, head bowed, eyes closed, jaw tight.

SETTING
Small apartment kitchen, 2am. Fluorescent tube overhead. Dishes in sink, scuffed linoleum, children's drawings on fridge. Black window reflecting the light.

CAMERA
Shot size: MCU, chest up with hands on sink edge visible
Lens: 35mm, f/2.8, soft background falloff
Angle: slightly below eye-level
Framing: rule of thirds, subject right, negative space toward dark window
Camera: locked-off tripod

LIGHTING
Single overhead fluorescent, 4100K greenish-white, hard-soft with slight wrap. No fill. Shadows under eyes and cheekbones. Faint rim from window reflection. 6:1 contrast.

COLOR / TEXTURE / ATMOSPHERE
Olive greens from fluorescent, warm amber skin tones. Desaturated, crushed blacks, S-curve lifted shadows. Visible skin texture, scuffed linoleum sheen, condensation on cold window. Still air. Fine 35mm grain, subtle halation on the overhead tube.

CONSTRAINTS
Single scene, single perspective, no split screens, no text.

Example 2 — Input: "two people talking on a street at night"

SUMMARY
Rain-slicked side street under sodium-vapor amber — two figures stand apart, unresolved confession in teal shadow and warm light pools.

STYLE / FORMAT
Nocturnal urban realism. Digital with 35mm grain, chromatic aberration on the sodium source. Amber-teal split palette, lifted shadows, Wong Kar-Wai wet-street intimacy.

SUBJECT + BEAT
Man, late 20s, dark jacket, hands in pockets, weight shifted back — retreating. Woman facing him, arms crossed, chin raised, eyes searching his face. Forgotten lit cigarette, ash long.

SETTING
Narrow side street, after midnight. Sodium-vapor streetlamp camera-left. Metal-shuttered storefront behind. Wet asphalt, orange puddle reflections. Cold enough for faint breath.

CAMERA
Shot size: WS, full bodies with street environment
Lens: 50mm, f/2.0, soft background
Angle: eye-level, straight-on
Framing: subjects left-of-center, streetlamp upper-right, wet street leading behind
Camera: static tripod

LIGHTING
Sodium-vapor overhead camera-left, 2200K amber, hard light. Long shadows camera-right. No fill — shadow faces near-black. Faint 7500K ambient on shoulders. Wet asphalt bouncing diffused amber. 8:1 contrast.

COLOR / TEXTURE / ATMOSPHERE
Sodium amber highlights, teal-blue shadows. Moderately desaturated, S-curve lifted blacks. Wet asphalt specular with orange puddle reflections, leather jacket patina, cigarette ember glow. Faint breath visible in cold, atmospheric haze beyond 20m. 35mm grain, chromatic aberration on bright sodium source.

CONSTRAINTS
Single scene, single perspective, no split screens, no text.

---

{creative_context_section}

{user_instructions_section}

# USER'S ORIGINAL PROMPT TO OPTIMIZE

This is the prompt you must transform into a structured cinematic image generation prompt:

{user_prompt}

Using the reference guide above, optimize the user's prompt into the structured cinematic format. Preserve the core intent. The user's prompt may not cover everything described in the project context — that's intentional. Focus on what the user wrote, not on what the context contains. Choose the most fitting look recipe as a starting point, then customize every section for this specific scene. The result must feel like a specific frozen cinematic moment — a frame you could screenshot from a film.

{user_instructions_reminder}"""


def _to_gs_uri(url: str) -> str:
    """Convert URL or blob path to gs:// URI for Gemini."""
    from ..gcs_utils import blob_path_to_gs_uri
    return blob_path_to_gs_uri(url)


def _build_instructions_and_context(user_instructions: str = None, creative_context: str = None):
    """Build instruction/context sections shared by both modes."""
    instructions_section = ""
    instructions_reminder = ""
    if user_instructions:
        instructions_section = (
            "# USER'S INSTRUCTIONS (TOP PRIORITY)\n\n"
            "The user has provided the following specific instructions for this optimization. "
            "These are the user's explicit directives — they take absolute priority over any other context. "
            "You MUST follow these instructions exactly.\n\n"
            f"{user_instructions}"
        )
        instructions_reminder = (
            "# REMINDER — USER'S INSTRUCTIONS (MUST FOLLOW)\n\n"
            "Before you output, re-read the user's instructions and verify compliance:\n\n"
            f"{user_instructions}"
        )

    context_section = ""
    if creative_context:
        context_section = (
            "# PROJECT CREATIVE CONTEXT (BACKGROUND REFERENCE)\n\n"
            f"{creative_context}"
        )

    return instructions_section, instructions_reminder, context_section


def _build_user_message(prompt: str, user_instructions: str = None, creative_context: str = None, mode: str = "detailed") -> str:
    """Build the full user message. mode='detailed' for structured output, 'concise' for prose+keywords."""
    instructions_section, instructions_reminder, context_section = _build_instructions_and_context(user_instructions, creative_context)

    template = CONCISE_REFERENCE_PROMPT if mode == "concise" else IMAGE_REFERENCE_PROMPT
    return template.format(
        user_prompt=prompt,
        user_instructions_section=instructions_section,
        user_instructions_reminder=instructions_reminder,
        creative_context_section=context_section,
    )


def _build_context_image_label(img: dict) -> str:
    """Build a descriptive text label for a context image based on its source."""
    source = img.get("source", "unknown")
    prompt = img.get("prompt", "")
    provider = img.get("provider", "")
    if source == "shot_result":
        label = f"[SHOT RESULT]"
        if provider:
            label += f" {provider}"
        if prompt:
            label += f': "{prompt}"'
        label += " -- previous generation result, note what works and what may need improvement"
        return label
    if source in ("supplementary", "character"):
        label = f"[PROJECT {source.upper()}]"
        if prompt:
            label += f': "{prompt}"'
        label += " -- project asset for visual reference"
        return label
    # upload or unknown
    label = "[USER REFERENCE]"
    if prompt:
        label += f': "{prompt}"'
    return label


def _append_context_images(parts: list, context_images: list[dict]):
    """Append labeled context image pairs to a multimodal parts list."""
    parts.append(types.Part.from_text(
        text="\n\n# ADDITIONAL VISUAL CONTEXT\n\n"
             "The following images are additional context the user wants you to consider. "
             "Each image has a label describing its role. Use them to inform your optimization."
    ))
    for img in context_images:
        url = img.get("url", "")
        if not url:
            continue
        label = _build_context_image_label(img)
        parts.append(types.Part.from_text(text=label))
        parts.append(types.Part.from_uri(file_uri=_to_gs_uri(url), mime_type="image/png"))


def optimize_with_gemini(prompt: str, user_instructions: str = None, image_urls: list[str] = None, creative_context: str = None, stream_callback=None, mode: str = "detailed", context_images: list[dict] = None):
    """Optimize prompt using Gemini via Vertex AI. Supports multimodal input with reference images.
    Returns plain text string with the optimized prompt."""
    llm = get_llm("gemini")
    system = CONCISE_SYSTEM_INSTRUCTION if mode == "concise" else IMAGE_SYSTEM_INSTRUCTION
    text_message = _build_user_message(prompt, user_instructions, creative_context, mode=mode)

    has_images = image_urls or context_images

    if OPTIMIZER_DEBUG:
        print(f"[PromptOptimizer] mode={mode}, image_urls={len(image_urls or [])}, context_images={len(context_images or [])}, has_creative_context={bool(creative_context)}, prompt={prompt[:100]}")
        if image_urls:
            for i, url in enumerate(image_urls, 1):
                print(f"[PromptOptimizer]   ref_image[{i}]: {url[:80]}...")
        if context_images:
            for i, img in enumerate(context_images):
                print(f"[PromptOptimizer]   ctx_image[{i}]: source={img.get('source')}, url={img.get('url', '')[:60]}...")

    # Build multimodal content if images provided
    if has_images:
        parts = []
        parts.append(types.Part.from_text(text=text_message))
        if image_urls:
            parts.append(types.Part.from_text(
                text="\n\n# REFERENCE IMAGES\n\nThe following images are the user's visual references, "
                     "labeled by number (image 1, image 2, ...). The generation model will receive "
                     "these same images in the same order. If the user's prompt references specific "
                     "images by number, preserve those references in your output."
            ))
            for i, url in enumerate(image_urls, 1):
                gs_uri = _to_gs_uri(url)
                if OPTIMIZER_DEBUG:
                    print(f"[PromptOptimizer]   Image {i} -> gs_uri: {gs_uri[:80]}")
                parts.append(types.Part.from_text(text=f"Image {i}:"))
                parts.append(types.Part.from_uri(file_uri=gs_uri, mime_type="image/png"))
        if context_images:
            _append_context_images(parts, context_images)
        contents = [types.Content(role="user", parts=parts)]
        if OPTIMIZER_DEBUG:
            print(f"[PromptOptimizer] Built multimodal content with {len(parts)} parts")
    else:
        contents = text_message
        if OPTIMIZER_DEBUG:
            print("[PromptOptimizer] Text-only content (no images)")

    return llm.generate(
        system_instruction=system,
        contents=contents,
        model="gemini-3.1-pro-preview",
        location="global",
        thinking=True,
        stream_callback=stream_callback,
    ).text


