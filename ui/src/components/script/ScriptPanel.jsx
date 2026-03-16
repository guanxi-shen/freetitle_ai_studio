import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import './ScriptPanel.css'

// Persist last scroll position across panel open/close cycles (session-level fallback)
let _lastScrollId = null

const ASPECT_RATIOS = ['horizontal', 'vertical']
const SHOT_TYPES = [
  'WIDE', 'MEDIUM', 'CLOSE-UP', 'EXTREME CLOSE-UP',
  'OVER-THE-SHOULDER', 'POV', 'TRACKING', 'AERIAL',
  'LOW ANGLE', 'HIGH ANGLE', 'DUTCH ANGLE',
]

// Collapsible section wrapper
function ScriptSection({ id, label, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="script-section" id={id}>
      <div className="script-section-header" onClick={() => setOpen(o => !o)}>
        <svg className={`script-section-chevron ${open ? 'open' : ''}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 2l4 4-4 4" />
        </svg>
        <span className="script-section-label">{label}</span>
      </div>
      {open && children}
    </div>
  )
}

// Editable text field via contentEditable
function Editable({ value, onChange, className = '', tag: Tag = 'div', ...props }) {
  const ref = useRef(null)

  const handleBlur = useCallback(() => {
    const text = ref.current?.textContent || ''
    if (text !== value) onChange(text)
  }, [value, onChange])

  return (
    <Tag
      ref={ref}
      className={`script-editable ${className}`}
      contentEditable
      suppressContentEditableWarning
      onBlur={handleBlur}
      {...props}
    >
      {value}
    </Tag>
  )
}

// Inline dropdown selector
function InlineSelect({ value, options, onChange, className = '' }) {
  return (
    <select
      className={`script-inline-select ${className}`}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  )
}

// Duration input — numeric with sec/min unit
function DurationInput({ value, onChange }) {
  const parsed = (value || '').match(/(\d+\.?\d*)\s*(min|minute|minutes|sec|second|seconds|s|m)?/i)
  const num = parsed ? parseFloat(parsed[1]) : 30
  const rawUnit = parsed ? (parsed[2] || '').toLowerCase() : ''
  const isMin = rawUnit.startsWith('min') || rawUnit === 'm'
  const [unit, setUnit] = useState(isMin ? 'min' : 'sec')

  function handleChange(newNum, newUnit) {
    const u = newUnit || unit
    const label = u === 'min'
      ? `${newNum} minute${newNum !== 1 ? 's' : ''}`
      : `${newNum} seconds`
    onChange(label)
  }

  return (
    <span className="script-duration-input">
      <input
        type="number"
        min="1"
        step="1"
        value={Math.round(isMin && unit === 'sec' ? num * 60 : !isMin && unit === 'min' ? num / 60 : num)}
        onChange={e => {
          const v = parseInt(e.target.value) || 1
          handleChange(v, unit)
        }}
      />
      <select value={unit} onChange={e => {
        const newUnit = e.target.value
        const currentNum = isMin && unit === 'sec' ? num * 60 : !isMin && unit === 'min' ? num / 60 : num
        const converted = newUnit === 'min' ? Math.round(currentNum / 60) || 1 : Math.round(currentNum * (unit === 'min' ? 60 : 1))
        setUnit(newUnit)
        handleChange(converted, newUnit)
      }}>
        <option value="sec">sec</option>
        <option value="min">min</option>
      </select>
    </span>
  )
}

// Labeled field row for full data view
function Field({ label, children }) {
  return (
    <div className="script-field">
      <span className="script-field-label">{label}</span>
      <div className="script-field-value">{children}</div>
    </div>
  )
}

// Boolean toggle for full data view
function BoolToggle({ value, onChange }) {
  return (
    <button className={`script-bool-toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
      {value ? 'Yes' : 'No'}
    </button>
  )
}

export default function ScriptPanel({
  script,
  onScriptChange,
  mode = 'float',
  onModeChange,
  onClose,
  onGenerate,
  generating,
  thinkingText = '',
  creativeMode = 'film',
  onCreativeModeChange,
  scrollId: savedScrollId,
  onScrollIdChange,
  visible = true,
}) {
  const [genQuery, setGenQuery] = useState('')
  const [viewMode, setViewMode] = useState('concise') // 'concise' | 'full'
  const [confirmClear, setConfirmClear] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [activeOutlineId, setActiveOutlineId] = useState('script-title')
  const bodyRef = useRef(null)
  const outlineRef = useRef(null)

  const details = script?.script_details || {}
  const characters = script?.characters || []
  const scenes = details.scenes || []
  const production = script?.production_notes || {}
  const audio = script?.audio_design || {}

  function updateField(path, value) {
    if (!script || !onScriptChange) return
    const next = structuredClone(script)
    let obj = next
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]]
      if (!obj) return
    }
    obj[path[path.length - 1]] = value
    onScriptChange(next)
  }

  const hasScript = script && details.title
  const isFull = viewMode === 'full'

  const outlineItems = useMemo(() => {
    if (!hasScript) return []
    const items = [{ id: 'script-title', label: 'Title', level: 0 }]
    if (characters.length > 0) items.push({ id: 'script-chars', label: 'Characters', level: 0 })
    scenes.forEach((scene, si) => {
      const sceneId = `script-scene-${si}`
      items.push({ id: sceneId, label: `Scene ${scene.scene_number || si + 1}`, level: 0, shotCount: (scene.shots || []).length })
      ;(scene.shots || []).forEach((shot, shi) => {
        items.push({
          id: `${sceneId}-shot-${shi}`,
          label: `Shot ${shot.shot_number || shi + 1}`,
          level: 1,
          parent: `Scene ${scene.scene_number || si + 1}`,
        })
      })
    })
    if (production.style_guide || production.tone || production.key_themes?.length > 0 || production.consistency_guide)
      items.push({ id: 'script-prodnotes', label: 'Production Notes', level: 0 })
    if (audio.music_direction || audio.instrumentation || audio.notes)
      items.push({ id: 'script-audio', label: 'Audio Design', level: 0 })
    return items
  }, [hasScript, characters, scenes, production, audio])

  // Restore scroll position when panel reopens (session var > persisted prop)
  useEffect(() => {
    const restoreId = _lastScrollId || savedScrollId
    if (!hasScript || generating || !restoreId) return
    const timer = setTimeout(() => {
      const el = document.getElementById(restoreId)
      if (el) el.scrollIntoView({ block: 'start' })
    }, 50)
    return () => clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll spy — track which section is visible at the top
  const onScrollIdChangeRef = useRef(onScrollIdChange)
  onScrollIdChangeRef.current = onScrollIdChange
  useEffect(() => {
    const body = bodyRef.current
    if (!body || !outlineItems.length) return
    function onScroll() {
      const bodyRect = body.getBoundingClientRect()
      let current = outlineItems[0]?.id
      for (const item of outlineItems) {
        const el = document.getElementById(item.id)
        if (el) {
          const elRect = el.getBoundingClientRect()
          if (elRect.top - bodyRect.top <= 60) current = item.id
        }
      }
      setActiveOutlineId(current)
      _lastScrollId = current
      onScrollIdChangeRef.current?.(current)
    }
    body.addEventListener('scroll', onScroll, { passive: true })
    return () => body.removeEventListener('scroll', onScroll)
  }, [outlineItems, isFull])

  useEffect(() => {
    if (!outlineOpen) return
    function handleClick(e) {
      if (outlineRef.current && !outlineRef.current.contains(e.target)) setOutlineOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [outlineOpen])

  function jumpTo(id) {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setOutlineOpen(false)
  }

  const activeCrumb = useMemo(() => {
    const item = outlineItems.find(i => i.id === activeOutlineId)
    if (!item) return { section: 'Title', sub: '' }
    if (item.parent) return { section: item.parent, sub: item.label }
    return { section: item.label, sub: '' }
  }, [outlineItems, activeOutlineId])

  function handleGenerate() {
    if (!genQuery.trim() || generating) return
    onGenerate?.(genQuery.trim(), null, hasScript ? script : null)
    setGenQuery('')
  }

  return (
    <div className={`script-panel ${mode}`} style={visible ? undefined : { display: 'none' }}>
      {/* Header */}
      <div className="script-header">
        <button className="script-header-btn" onClick={onClose} title="Collapse">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="8 2 3 7 8 12" />
          </svg>
        </button>
        <span className="script-header-title">Script</span>

        <div className="script-mode-toggle">
          <button className={`script-mode-btn ${creativeMode === 'film' ? 'active' : ''}`} onClick={() => onCreativeModeChange?.('film')}>Film</button>
          <button className={`script-mode-btn ${creativeMode === 'commercial' ? 'active' : ''}`} onClick={() => onCreativeModeChange?.('commercial')}>Commercial</button>
        </div>

        {/* View mode toggle — only when script exists */}
        {hasScript && (
          <button
            className={`script-header-btn ${isFull ? 'active' : ''}`}
            onClick={() => setViewMode(v => v === 'concise' ? 'full' : 'concise')}
            title={isFull ? 'Concise view' : 'Full data view'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {isFull ? (
                <>
                  <line x1="2" y1="3" x2="12" y2="3" />
                  <line x1="2" y1="7" x2="12" y2="7" />
                  <line x1="2" y1="11" x2="8" y2="11" />
                </>
              ) : (
                <>
                  <line x1="2" y1="2" x2="12" y2="2" />
                  <line x1="2" y1="5" x2="12" y2="5" />
                  <line x1="2" y1="8" x2="12" y2="8" />
                  <line x1="2" y1="11" x2="12" y2="11" />
                </>
              )}
            </svg>
          </button>
        )}

        {/* Clear script */}
        {hasScript && (
          <button
            className="script-header-btn script-clear-btn"
            onClick={() => setConfirmClear(true)}
            title="Clear script"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4v7.5a1 1 0 001 1h5a1 1 0 001-1V4" />
            </svg>
          </button>
        )}

        {/* Float/push toggle */}
        <button
          className={`script-header-btn ${mode === 'push' ? 'active' : ''}`}
          onClick={() => onModeChange?.(mode === 'float' ? 'push' : 'float')}
          title={mode === 'float' ? 'Pin to side' : 'Float over canvas'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            {mode === 'float' ? (
              <>
                <rect x="1" y="2" width="5" height="10" rx="1" />
                <line x1="8" y1="4" x2="13" y2="4" />
                <line x1="8" y1="7" x2="13" y2="7" />
                <line x1="8" y1="10" x2="13" y2="10" />
              </>
            ) : (
              <>
                <rect x="2" y="2" width="10" height="10" rx="1" />
                <line x1="2" y1="7" x2="12" y2="7" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Outline navigation bar */}
      {hasScript && !generating && (
        <div className="script-outline-wrap" ref={outlineRef}>
          <div className={`script-outline-bar ${outlineOpen ? 'open' : ''}`} onClick={() => setOutlineOpen(o => !o)}>
            <svg className="script-outline-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="3" x2="12" y2="3" />
              <line x1="4" y1="7" x2="12" y2="7" />
              <line x1="4" y1="11" x2="12" y2="11" />
            </svg>
            <div className="script-outline-crumb">
              <span className="script-outline-crumb-section">{activeCrumb.section}</span>
              {activeCrumb.sub && <span className="script-outline-crumb-sep">&rsaquo;</span>}
              {activeCrumb.sub && <span className="script-outline-crumb-sub">{activeCrumb.sub}</span>}
            </div>
            <svg className={`script-outline-chevron ${outlineOpen ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4l3 3 3-3" />
            </svg>
          </div>
          {outlineOpen && (
            <div className="script-outline-dropdown">
              {outlineItems.map(item => (
                <div
                  key={item.id}
                  className={`script-outline-item level-${item.level} ${activeOutlineId === item.id ? 'active' : ''}`}
                  onClick={() => jumpTo(item.id)}
                >
                  <span className="script-outline-item-label">{item.label}</span>
                  {item.shotCount > 0 && <span className="script-outline-item-count">{item.shotCount} shots</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generating state with thinking stream */}
      {generating && (
        <div className="script-generating">
          <div className="script-spinner" />
          {thinkingText
            ? <pre className="script-thinking">{thinkingText}</pre>
            : <p>Generating...</p>
          }
        </div>
      )}

      {/* Script body — concise screenplay view */}
      {hasScript && !generating && !isFull && (
        <div className="script-body" ref={bodyRef}>
          <div className="script-title-page" id="script-title">
            <Editable className="script-title-main" value={details.title || ''} onChange={v => updateField(['script_details', 'title'], v)} />
            {details.duration && (
              <div className="script-title-meta">
                <DurationInput value={details.duration} onChange={v => updateField(['script_details', 'duration'], v)} />
              </div>
            )}
            {details.aspect_ratio && (
              <div className="script-title-meta">
                <InlineSelect value={details.aspect_ratio} options={ASPECT_RATIOS} onChange={v => updateField(['script_details', 'aspect_ratio'], v)} />
              </div>
            )}
            {details.video_summary && (
              <Editable className="script-title-summary" value={details.video_summary} onChange={v => updateField(['script_details', 'video_summary'], v)} />
            )}
          </div>

          {characters.length > 0 && (
            <div className="script-characters" id="script-chars">
              <div className="script-characters-title">Characters</div>
              {characters.map((ch, i) => (
                <div key={i} className="script-character-entry">
                  <span className="script-character-name">{ch.name}</span>
                  {ch.role && <span className="script-character-role"> ({ch.role})</span>}
                  {ch.attributes && (
                    <Editable className="script-character-attrs" value={ch.attributes} onChange={v => updateField(['characters', i, 'attributes'], v)} />
                  )}
                </div>
              ))}
            </div>
          )}

          {scenes.map((scene, si) => (
            <ScriptSection key={si} id={`script-scene-${si}`} label={`Scene ${scene.scene_number || si + 1}`} defaultOpen>
              <div className="script-scene">
                <Editable className="script-scene-heading" value={scene.setting || `SCENE ${si + 1}`} onChange={v => updateField(['script_details', 'scenes', si, 'setting'], v)} />
                {scene.scene_summary && (
                  <Editable className="script-scene-summary" value={scene.scene_summary} onChange={v => updateField(['script_details', 'scenes', si, 'scene_summary'], v)} />
                )}
                {(scene.shots || []).map((shot, shi) => (
                  <div key={shi} className="script-shot" id={`script-scene-${si}-shot-${shi}`}>
                    <div className="script-shot-header">
                      <span className="script-shot-label">SHOT {shot.shot_number || shi + 1}</span>
                      {shot.shot_type && (
                        <InlineSelect className="script-shot-type-select" value={shot.shot_type} options={SHOT_TYPES} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'shot_type'], v)} />
                      )}
                    </div>
                    <Editable className="script-action" value={shot.description || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'description'], v)} />
                    {(shot.dialogue || []).map((d, di) => (
                      <div key={di} className="script-dialogue">
                        <div className="script-dialogue-cue">
                          {d.character}
                          {d.is_voiceover && <span className="script-dialogue-vo"> (V.O.)</span>}
                        </div>
                        {d.audio_notes && (
                          <Editable className="script-dialogue-paren" value={d.audio_notes} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'dialogue', di, 'audio_notes'], v)} />
                        )}
                        <Editable className="script-dialogue-line" value={d.line || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'dialogue', di, 'line'], v)} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ScriptSection>
          ))}

          {(production.style_guide || production.tone || production.key_themes?.length > 0 || production.consistency_guide) && (
            <ScriptSection id="script-prodnotes" label="Production Notes" defaultOpen={false}>
              <div className="script-notes-block">
                {production.style_guide && (<><div className="script-notes-label">Style Guide</div><Editable className="script-notes-text" value={production.style_guide} onChange={v => updateField(['production_notes', 'style_guide'], v)} /></>)}
                {production.tone && (<><div className="script-notes-label">Tone</div><Editable className="script-notes-text" value={production.tone} onChange={v => updateField(['production_notes', 'tone'], v)} /></>)}
                {production.key_themes?.length > 0 && (<><div className="script-notes-label">Key Themes</div><Editable className="script-notes-text" value={production.key_themes.join(', ')} onChange={v => updateField(['production_notes', 'key_themes'], v.split(',').map(s => s.trim()).filter(Boolean))} /></>)}
                {production.consistency_guide && (<><div className="script-notes-label">Consistency Guide</div><Editable className="script-notes-text" value={production.consistency_guide} onChange={v => updateField(['production_notes', 'consistency_guide'], v)} /></>)}
              </div>
            </ScriptSection>
          )}

          {(audio.music_direction || audio.instrumentation || audio.notes) && (
            <ScriptSection id="script-audio" label="Audio Design" defaultOpen={false}>
              <div className="script-notes-block">
                {audio.music_direction && (<><div className="script-notes-label">Music Direction</div><Editable className="script-notes-text" value={audio.music_direction} onChange={v => updateField(['audio_design', 'music_direction'], v)} /></>)}
                {audio.instrumentation && (<><div className="script-notes-label">Instrumentation</div><Editable className="script-notes-text" value={audio.instrumentation} onChange={v => updateField(['audio_design', 'instrumentation'], v)} /></>)}
                {audio.notes && (<><div className="script-notes-label">Notes</div><Editable className="script-notes-text" value={audio.notes} onChange={v => updateField(['audio_design', 'notes'], v)} /></>)}
              </div>
            </ScriptSection>
          )}
        </div>
      )}

      {/* Script body — full data view */}
      {hasScript && !generating && isFull && (
        <div className="script-body script-body-full" ref={bodyRef}>
          <ScriptSection id="script-title" label="Script Details" defaultOpen>
            <div className="script-fields">
              <Field label="Title"><Editable className="script-field-edit" value={details.title || ''} onChange={v => updateField(['script_details', 'title'], v)} /></Field>
              <Field label="Duration"><DurationInput value={details.duration || ''} onChange={v => updateField(['script_details', 'duration'], v)} /></Field>
              <Field label="Aspect Ratio"><InlineSelect value={details.aspect_ratio || 'horizontal'} options={ASPECT_RATIOS} onChange={v => updateField(['script_details', 'aspect_ratio'], v)} /></Field>
              <Field label="Video Summary"><Editable className="script-field-edit" value={details.video_summary || ''} onChange={v => updateField(['script_details', 'video_summary'], v)} /></Field>
              <Field label="Creative Vision"><Editable className="script-field-edit" value={details.creative_vision || ''} onChange={v => updateField(['script_details', 'creative_vision'], v)} /></Field>
            </div>
          </ScriptSection>

          <ScriptSection id="script-chars" label="Characters" defaultOpen>
            {characters.map((ch, i) => (
              <div key={i} className="script-fields script-fields-nested">
                <Field label="Name"><span className="script-field-readonly">{ch.name}</span></Field>
                <Field label="Role"><span className="script-field-readonly">{ch.role}</span></Field>
                <Field label="Attributes"><Editable className="script-field-edit" value={ch.attributes || ''} onChange={v => updateField(['characters', i, 'attributes'], v)} /></Field>
              </div>
            ))}
          </ScriptSection>

          {scenes.map((scene, si) => (
            <ScriptSection key={si} id={`script-scene-${si}`} label={`Scene ${scene.scene_number || si + 1}`} defaultOpen>
              <div className="script-fields">
                <Field label="Setting"><Editable className="script-field-edit" value={scene.setting || ''} onChange={v => updateField(['script_details', 'scenes', si, 'setting'], v)} /></Field>
                <Field label="Summary"><Editable className="script-field-edit" value={scene.scene_summary || ''} onChange={v => updateField(['script_details', 'scenes', si, 'scene_summary'], v)} /></Field>
                <Field label="Duration"><Editable className="script-field-edit" value={scene.duration || ''} onChange={v => updateField(['script_details', 'scenes', si, 'duration'], v)} /></Field>
                <Field label="Characters"><Editable className="script-field-edit" value={(scene.characters || []).join(', ')} onChange={v => updateField(['script_details', 'scenes', si, 'characters'], v.split(',').map(s => s.trim()).filter(Boolean))} /></Field>
                <Field label="Consistency Notes"><Editable className="script-field-edit" value={scene.consistency_notes || ''} onChange={v => updateField(['script_details', 'scenes', si, 'consistency_notes'], v)} /></Field>
              </div>

              {(scene.shots || []).map((shot, shi) => (
                <ScriptSection key={shi} id={`script-scene-${si}-shot-${shi}`} label={`Shot ${shot.shot_number || shi + 1}`} defaultOpen={false}>
                  <div className="script-fields">
                    <Field label="Shot Type"><InlineSelect value={shot.shot_type || 'WIDE'} options={SHOT_TYPES} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'shot_type'], v)} /></Field>
                    <Field label="Duration"><Editable className="script-field-edit" value={shot.duration || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'duration'], v)} /></Field>
                    <Field label="Subject"><Editable className="script-field-edit" value={shot.subject || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'subject'], v)} /></Field>
                    <Field label="Description"><Editable className="script-field-edit" value={shot.description || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'description'], v)} /></Field>
                    <Field label="Shot Purpose"><Editable className="script-field-edit" value={shot.shot_purpose || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'shot_purpose'], v)} /></Field>
                    <Field label="Start Frame"><Editable className="script-field-edit" value={shot.start_frame || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'start_frame'], v)} /></Field>
                    <Field label="Progression"><Editable className="script-field-edit" value={shot.progression || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'progression'], v)} /></Field>
                    <Field label="Key Visual Elements"><Editable className="script-field-edit" value={(shot.key_visual_elements || []).join(', ')} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'key_visual_elements'], v.split(',').map(s => s.trim()).filter(Boolean))} /></Field>

                    {(shot.dialogue || []).map((d, di) => (
                      <div key={di} className="script-fields script-fields-nested">
                        <div className="script-field-group-label">Dialogue {di + 1}</div>
                        <Field label="Character"><span className="script-field-readonly">{d.character}</span></Field>
                        <Field label="Line"><Editable className="script-field-edit" value={d.line || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'dialogue', di, 'line'], v)} /></Field>
                        <Field label="Audio Notes"><Editable className="script-field-edit" value={d.audio_notes || ''} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'dialogue', di, 'audio_notes'], v)} /></Field>
                        <Field label="Voiceover"><BoolToggle value={!!d.is_voiceover} onChange={v => updateField(['script_details', 'scenes', si, 'shots', shi, 'dialogue', di, 'is_voiceover'], v)} /></Field>
                      </div>
                    ))}
                  </div>
                </ScriptSection>
              ))}
            </ScriptSection>
          ))}

          <ScriptSection id="script-prodnotes" label="Production Notes" defaultOpen>
            <div className="script-fields">
              <Field label="Style Guide"><Editable className="script-field-edit" value={production.style_guide || ''} onChange={v => updateField(['production_notes', 'style_guide'], v)} /></Field>
              <Field label="Tone"><Editable className="script-field-edit" value={production.tone || ''} onChange={v => updateField(['production_notes', 'tone'], v)} /></Field>
              <Field label="Key Themes"><Editable className="script-field-edit" value={(production.key_themes || []).join(', ')} onChange={v => updateField(['production_notes', 'key_themes'], v.split(',').map(s => s.trim()).filter(Boolean))} /></Field>
              <Field label="Consistency Guide"><Editable className="script-field-edit" value={production.consistency_guide || ''} onChange={v => updateField(['production_notes', 'consistency_guide'], v)} /></Field>
            </div>
          </ScriptSection>

          <ScriptSection id="script-audio" label="Audio Design" defaultOpen>
            <div className="script-fields">
              <Field label="Music Direction"><Editable className="script-field-edit" value={audio.music_direction || ''} onChange={v => updateField(['audio_design', 'music_direction'], v)} /></Field>
              <Field label="Instrumentation"><Editable className="script-field-edit" value={audio.instrumentation || ''} onChange={v => updateField(['audio_design', 'instrumentation'], v)} /></Field>
              <Field label="Notes"><Editable className="script-field-edit" value={audio.notes || ''} onChange={v => updateField(['audio_design', 'notes'], v)} /></Field>
            </div>
          </ScriptSection>
        </div>
      )}

      {/* Empty state */}
      {!hasScript && !generating && (
        <div className="script-empty">
          <svg className="script-empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <p>Describe your vision, or paste an existing script.</p>
        </div>
      )}

      {/* Bottom prompt bar */}
      {!generating && (
        <div className="script-prompt-bar">
          <div className="script-prompt-input">
            <textarea
              placeholder={hasScript ? 'Ask to revise, add scenes, change tone...' : 'Describe your vision or paste a script...'}
              value={genQuery}
              onChange={e => setGenQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate() } }}
            />
            <button
              className={`script-send-btn ${genQuery.trim() ? 'active' : ''}`}
              onClick={handleGenerate}
              disabled={generating || !genQuery.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="13" x2="8" y2="3" />
                <polyline points="3 7 8 2 13 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Clear script confirmation */}
      {confirmClear && (
        <div className="script-confirm-overlay" onClick={() => setConfirmClear(false)}>
          <div className="script-confirm-box" onClick={e => e.stopPropagation()}>
            <p>Clear script?</p>
            <div className="script-confirm-actions">
              <button onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="script-confirm-delete" onClick={() => { onScriptChange?.(null); setConfirmClear(false) }}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
