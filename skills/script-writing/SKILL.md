---
name: script-writing
description: "Structured screenplays with characters, scenes, shots, and production notes. Commercial and film modes with revision support. Use when user says 'write a script', 'create screenplay', 'revise the script', or 'update scene X'."
include:
  - _shared/project-style-keywords
  - film-mode
---

# Script Writing

## Key Constraints

- Premium, cinematic production quality -- think feature film, high-end commercial. Avoid plain or generic backgrounds; use rich, purposeful environments.
- Each shot is exactly 8 seconds (video generation model limitation, not adjustable).
- Quality over quantity -- fewer well-crafted shots beat many generic ones.
- Vary shot sizes (extreme wide/wide/medium/close-up/extreme close-up), angles (high/low/eye-level/Dutch/bird's eye/worm's eye/over-shoulder), camera movements (static/pan/tilt/dolly/track/zoom/crane/orbit/handheld/steadicam), and focal lengths (wide-angle/standard/telephoto). Repetitive shot patterns feel dull and amateur unless creative vision specifically requires uniformity.
- Faithfulness to user intent takes priority over creative flourishes.
- Default aspect ratio: horizontal (16:9). Only other option: vertical (9:16).
- Default to visual-only storytelling. Include dialogue/voice-over only when user requests it or the script/context calls for it.
- Avoid vague language: never use "maybe", "probably", "perhaps", "possibly", "might" in shot descriptions.

## Characters

Define all entities that need visual consistency across shots:
- **People**: protagonists, supporting cast, recurring extras.
- **Products**: treat as characters in commercial content. Use brand/model names (e.g., "iPhone 15 Pro", "Nike Air Max").
- **Recurring props**: vehicles, weapons, signature objects appearing in 2+ shots.

Do NOT define: generic props, background elements, unnamed extras, voice-over narrators, one-time objects. If no identifiable characters or recurring elements exist, omit the characters array.

## Shot Coverage Planning

Plan more total shot footage than the target duration for editing flexibility:
- Standard videos: 1.5x to 2.5x total footage vs target.
- Dynamic/fast-paced videos: 2.5x to 3.5x total footage vs target.
- Note coverage strategy in the `creative_vision` field.

## Shot Structure

You can plan shots using two approaches - choose based on your creative needs:

SINGLE-FRAME WORKFLOW (Default):
- Define: start_frame, progression
- Each shot defines ONE key frame (the starting state) + progression description
- Video generates FROM the start frame using your progression description
- Best for: Most shots, complex motion, camera movements, general storytelling
- Simpler to plan, works for majority of shots

DUAL-FRAME WORKFLOW (Precision Control):
- Define: start_frame, end_frame, progression
- Video generates BETWEEN the two frames

PRODUCT CAMERA MOVEMENT WARNING: Products with camera movement (orbit, pan, zoom) - consider dual-frame to prevent AI hallucination causing shape distortion.

USE DUAL-FRAME WHEN (Clear Triggers):
- Product shots with camera movement or rotation - prevents shape distortion from hallucinated angles
- Product rotation or angle changes (0 to 90 degrees, front to side view)
- Partial subject reveals - camera exposes initially cropped/hidden areas (e.g., half-view outfit to full reveal, prevents hallucinating concealed portions)
- Unseen angle reveals - rotation or camera movement shows previously hidden sides (e.g., back to front turn, prevents inventing unseen appearance)
- Text animations (empty background to text overlay, blank screen to title card)
- Text or logo integrity required - better control for text accuracy and logo precision
- Precise transformations with exact endpoints (character pose A to pose B)
- Camera + product consistency critical (turntable, reveal shots)
- Fake one-take sequences / continuity designs - when end_frame must match next shot's start_frame for seamless transitions

DUAL-FRAME CREATIVE STRENGTHS:
- Dramatic reveals and transformations (before/after, character reveals, costume changes, emotional shifts)
- Choreographed sequences (dance, action poses, synchronized movements)
- Product demonstrations (clear start-to-finish showing features/benefits)
- Narrative beats (story turning points, climactic moments, emotional arcs)
- Controlled pacing for specific story rhythm

DEFAULT TO SINGLE-FRAME FOR:
- Natural/organic motion (walking, flowing, falling) - AI handles physics better
- Exploratory shots where exact ending state doesn't matter
- Simple actions without precision requirements
- Character-driven narrative moments
- Products without complex design consistency needs - single-frame allows better visual expression, dynamic motion, and camera movements
- Open-ended creative generation - single-frame mode allows video generation model to produce dynamic rich motion, expressive camera movements, and artistic interpretation
- IMPORTANT: Dual-frame can feel dull and rigid when overused or when precision doesn't serve creative purpose. Choose dual-frame when controlled endpoint enhances story (reveals, transformations, beats). Choose single-frame when organic motion enhances story (exploration, natural physics, fluid action). Both are powerful tools - select based on creative intent.

CRITICAL - DUAL-FRAME DESIGN RULES:
When using dual-frame workflow, start_frame and end_frame MUST be significantly different:
- Avoid nearly identical frames - produces static video that wastes dual-frame capability
- Different camera angles even within same setting (low angle to eye level, side to front, close-up to wide)
- Significant motion or state changes - not subtle variations
- Change composition, framing, or subject position substantially
- If keeping same setting, vary camera angle, distance, or perspective dramatically
- Plan transformations that justify the precision of dual-frame control

## Shot Descriptions

- start_frame: The EXACT beginning moment, static state before motion begins
  - Describe subject/object/environment initial state, camera's starting view
  - Be specific: exact positions, poses, expressions
  - Include environmental details visible at start
- progression: DETAILED motion/transformation from start state
  - Describe the COMPLETE journey: every movement, transformation, state change
  - Specify sequence: "door opens, character enters, door closes"
  - Specify motion paths: "character moves diagonally from bottom-left to top-right"
  - Note intermediate states: "midway through, character pauses to look back"
  - Consider camera movement: "camera pans right following subject"
  - Plan dynamic, engaging motion - combine multiple micro-actions for richer content
  - Complex progressions: Split into multiple shots for clarity
  - Example: "breaks into smile, waves hand upward, steps forward two paces, looks around" (good) vs "slight smile" alone (too minimal)
  - Rich progression = better video generation

## Mode

Film mode is loaded by default. When a product, brand, or business objective is involved, also load `load_skill("script-writing/commercial-mode")` -- it adds 4A agency mindset, business strategy, commercial techniques, and product-as-character workflow.

## Screenwriting Techniques

Not hard rules -- use your creative judgment. These are reference techniques to draw from when they serve the story.

- **Show don't tell**: Convey meaning through action, not exposition.
- **Match cuts**: Visual/action connections between shots (matching motion, shape, color).
- **Motivated movement**: Every camera move or character action serves narrative purpose.
- **Visual motifs**: Recurring elements that reinforce themes or emotional undercurrents.
- **Establishing-Detail pattern**: Orient with wide shot, then reveal details with close-ups.
- **Subtext through framing**: Use composition, negative space, and depth to communicate what characters do not say.

## Advanced Cinematography

Shot Coverage Patterns:
- Shot-reverse-shot: Opposing angles for interactions/testimonials
- ABAB cutting: Parallel action between two subjects
- Reverse angles: 180 degree rule coverage for spatial variety
- Master + singles + inserts: Wide establish, then coverage breakdown
- Cutaway shots: Related details to build context
- Over-the-shoulder (OTS): Foreground framing for depth
- POV shots: First-person perspective
- Reaction shots: Emotional response emphasis
- Two-shot: Two subjects in frame together
- Dutch angle/canted frame: Tilted horizon for tension
- Low angle: Camera below subject for power/dominance
- High angle: Camera above subject for vulnerability
- Eye-level: Neutral perspective
- Bird's eye view: Directly overhead
- Worm's eye view: Ground-level looking up

Reveal & Staging:
- Tease to partial to hero reveal sequence
- Depth staging: Foreground/midground/background layers
- Rack focus: Shift focus between depth planes
- Split diopter: Two depth planes in focus simultaneously
- Motivated reveals: Action-driven unveiling
- 360 degree coverage: Multiple angles around subject (0, 45, 90, 135, 180 degrees)
- Silhouette reveal: Backlit shape to front-lit detail
- Reflection/shadow reveal: Indirect before direct

## Innovative Creative Styles

**Style morph**: Transition between different art styles across shots (photorealistic to anime to watercolor to 3D render). Use as a narrative device to signal shifts in time, memory, or emotional state.

**Music beat sync**: Plan shot changes aligned to beat drops, rhythmic transitions synced to BPM. Each cut lands on a musical accent.

**Continuous long-take illusion**: Chain shots using dual-frame workflow where each shot's end_frame matches next shot's start_frame. Creates the appearance of a seamless unbroken take.

**AI surrealism**: Embrace AI generation's abstract and dreamlike qualities as intentional artistic style. Impossible physics, morphing spaces, fluid reality.

**Cinematic trailer**: Slow vignettes with fade to black, text card accolades, fast-paced action montage, message text card, resolution, ending title card with sound design cues.

## Setting Design

Design rich, detailed settings -- avoid plain or generic backgrounds unless user explicitly requests minimalism. Avoid overused AI cliches (neon-lit scenes, brutalist architecture, cyberpunk) unless relevant to the project.

Settings format: `INT/EXT. LOCATION - TIME`
- Instead of "INT. WHITE STUDIO - DAY" use "INT. DREAMY PASTEL CLOUDSCAPE WITH FLOATING IRIDESCENT BUBBLES - SOFT AFTERNOON LIGHT"
- Instead of "INT. ROOM - DAY" use "INT. RETRO 70S LIVING ROOM WITH BURNT ORANGE VELVET FURNITURE AND WOOD PANELING - WARM TUNGSTEN EVENING"

## Revision Workflow

When revising an existing script:
1. Fetch current state: `get_project_context({"script": {}})`.
2. Modify ONLY the parts the user requested. Keep all unmodified scenes, shots, characters, and fields identical -- do not rephrase or restructure untouched content.
3. Return the complete full script with changes applied.

When user provides their own pre-written script, format it into the required JSON structure and infer missing technical fields from context.

## Dialogue & Voice

Include dialogue/voice-over when the user requests it or the script/context calls for it. Specify voice characteristics in `audio_notes` for every dialogue entry (gender, age, tone). Do not create character entries for voice-over narrators -- use `is_voiceover: true`.

## Audio Design

Define high-level music direction when music enhances the creative vision. Avoid specifying background music in shot-level fields -- use audio_design for global music strategy. Shot-specific music only when required for creative reasons (e.g., diegetic music from radio, transition between music styles).

## Style Guide Composition

Compose `style_guide` using the five dimensions (visual surface, camera behavior, editorial rhythm, emotional atmosphere, narrative attitude) with specific cinematic vocabulary from the project-style-keywords reference below. Avoid generic adjectives.

## Procedure

1. If commercial content: `load_skill("script-writing/commercial-mode")`.
2. If revising: `get_project_context({"script": {}})` to fetch the existing script.
3. For output format reference: `load_skill("script-writing/output-schema")`.
4. Build the complete script JSON object.
5. Call `write_script(script)` to save it to the project. Do NOT output the full JSON in chat.

## Output

Call `write_script(script)` with the complete script object. The script panel opens automatically.
After saving, briefly confirm in chat: title, scene count, and key creative decisions. Do not paste the full JSON.
