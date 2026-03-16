/**
 * Build a preview of the creative context sent to LLM agents.
 * Mirrors the backend get_script_context() format.
 */
export function buildCreativeContext(projectState, scenes, sceneNumber, shotNumber) {
  if (!projectState) return ''
  const script = projectState.generated_scripts
  if (!script) return ''

  const details = script.script_details || {}
  const production = script.production_notes || {}
  const characters = script.characters || []
  const scriptScenes = details.scenes || []

  const sections = []

  // Project overview
  const overview = []
  if (details.title) overview.push(`Title: ${details.title}`)
  if (details.video_summary) overview.push(`Video summary: ${details.video_summary}`)
  if (details.creative_vision) overview.push(`Creative vision: ${details.creative_vision}`)
  if (production.style_guide) overview.push(`Style guide: ${production.style_guide}`)
  if (production.tone) overview.push(`Tone: ${production.tone}`)
  if (production.key_themes?.length) overview.push(`Key themes: ${production.key_themes.join(', ')}`)
  if (production.consistency_guide) overview.push(`Consistency guide: ${production.consistency_guide}`)
  if (overview.length) sections.push('PROJECT OVERVIEW\n' + overview.join('\n'))

  // Characters
  if (characters.length) {
    const sceneChars = new Set()
    if (sceneNumber) {
      const sc = scriptScenes.find(s => s.scene_number === sceneNumber)
      if (sc?.characters) sc.characters.forEach(c => sceneChars.add(c))
    }
    const lines = characters.map(ch => {
      const parts = []
      if (ch.role) parts.push(ch.role)
      if (ch.attributes) parts.push(ch.attributes)
      let line = `- ${ch.name || 'Unknown'}`
      if (parts.length) line += `: ${parts.join(', ')}`
      if (sceneChars.size && sceneChars.has(ch.name)) line += ' [in scene]'
      return line
    })
    sections.push('CHARACTERS\n' + lines.join('\n'))
  }

  // All scenes overview (when not scoped to a specific scene)
  if (!sceneNumber && scriptScenes.length) {
    const lines = scriptScenes.map(sc => {
      let line = `- Scene ${sc.scene_number || '?'}: ${sc.setting || ''}`
      if (sc.visual_direction) line += ` -- ${sc.visual_direction}`
      return line
    })
    sections.push('SCENES OVERVIEW\n' + lines.join('\n'))
  }

  // Current scene
  if (sceneNumber) {
    const target = scriptScenes.find(sc => sc.scene_number === sceneNumber)
    if (target) {
      const lines = [`Scene ${sceneNumber} (scene-level context, not shot-specific)`]
      if (target.setting) lines.push(`Setting: ${target.setting}`)
      if (target.scene_summary) lines.push(`Summary: ${target.scene_summary}`)
      if (target.consistency_notes) lines.push(`Consistency notes: ${target.consistency_notes}`)
      sections.push('CURRENT SCENE\n' + lines.join('\n'))
    }
  }

  // Current shot
  if (sceneNumber && shotNumber && scenes) {
    const scene = scenes[sceneNumber - 1]
    if (scene) {
      const shot = (scene.shots || []).find(s => s.shot_number === shotNumber)
      if (shot?.description) {
        sections.push(`CURRENT SHOT\nShot ${shotNumber}: ${shot.description}`)
      }
    }
  }

  if (projectState.style_direction) {
    sections.push(`STYLE DIRECTION\n${projectState.style_direction}`)
  }

  return sections.join('\n\n')
}
