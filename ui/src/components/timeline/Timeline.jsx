import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import SceneLane from './SceneLane'
import CharacterLane from './CharacterLane'
import SupplementaryLane from './SupplementaryLane'
import AudioLane from './AudioLane'
import EditedVideoLane from './EditedVideoLane'
import ZoomControls from './ZoomControls'
import './AudioLane.css'
import './EditedVideoLane.css'
import CanvasContextMenu, { detectContext } from './CanvasContextMenu'
import NoteInput from './NoteInput'
import StickyNote from './StickyNote'
import InlineAssistant from './InlineAssistant'
import { closeChat } from '../../chat'
import './Timeline.css'

const MIN_SCALE = 0.3
const MAX_SCALE = 3

// SVG overlay drawing lines from anchored notes to their asset icons
function NoteLinks({ notes, contentEl, scale }) {
  const svgRef = useRef(null)

  useEffect(() => {
    if (!contentEl || !svgRef.current) return

    function update() {
      const svg = svgRef.current
      if (!svg || !contentEl) return
      const contentRect = contentEl.getBoundingClientRect()
      const isDark = document.body.classList.contains('dark-mode')
      svg.innerHTML = ''

      for (const note of notes) {
        // Find the icon element for this anchor
        let iconEl = null
        if (note.anchor === 'shot' || note.anchor === 'video-shot') {
          const card = contentEl.querySelector(`[data-shot-id="${note.anchorId}"]`)
          iconEl = card?.querySelector('.shot-note-icon') || card
        } else if (note.anchor === 'character') {
          const card = contentEl.querySelector(`[data-character-id="${note.anchorId}"]`)
          iconEl = card?.querySelector('.char-note-icon') || card
        } else if (note.anchor === 'supplement') {
          const card = contentEl.querySelector(`[data-supplement-id="${note.anchorId}"]`)
          iconEl = card?.querySelector('.supp-note-icon') || card
        } else if (note.anchor === 'scene') {
          const sceneEl = contentEl.querySelector(`[data-scene-id="${note.anchorId}"]`)
          iconEl = sceneEl?.querySelector('.scene-note-icon') || sceneEl
        } else if (note.anchor === 'character-lane') {
          iconEl = contentEl.querySelector('.character-lane .lane-note-icon')
        } else if (note.anchor === 'supplementary-lane') {
          iconEl = contentEl.querySelector('.supplementary-lane .lane-note-icon')
        }
        if (!iconEl) continue

        const iconRect = iconEl.getBoundingClientRect()
        const ax = (iconRect.left + iconRect.width / 2 - contentRect.left) / scale
        const ay = (iconRect.top + iconRect.height / 2 - contentRect.top) / scale

        // Read note position from DOM for smooth dragging
        const noteEl = contentEl.querySelector(`[data-note-id="${note.id}"]`)
        let nx, ny
        if (noteEl) {
          const noteRect = noteEl.getBoundingClientRect()
          nx = (noteRect.left + noteRect.width / 2 - contentRect.left) / scale
          ny = (noteRect.top + noteRect.height / 2 - contentRect.top) / scale
        } else {
          nx = note.x + (note.width || 200) / 2
          ny = note.y + 20
        }

        // Curved bezier path
        const dx = ax - nx, dy = ay - ny
        const cx1 = nx + dx * 0.4, cy1 = ny
        const cx2 = ax - dx * 0.4, cy2 = ay
        const d = `M${nx},${ny} C${cx1},${cy1} ${cx2},${cy2} ${ax},${ay}`
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', d)
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke', isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)')
        path.setAttribute('stroke-width', isDark ? 1 : 1.2)
        svg.appendChild(path)
      }
    }

    update()

    const canvas = contentEl.parentElement
    const onScroll = () => requestAnimationFrame(update)
    if (canvas) canvas.addEventListener('scroll', onScroll)
    window.addEventListener('resize', onScroll)
    const interval = setInterval(update, 150)

    return () => {
      if (canvas) canvas.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      clearInterval(interval)
    }
  }, [notes, contentEl, scale])

  if (!notes.length) return null
  return <svg ref={svgRef} className="note-links-svg" />
}

export default function Timeline({
  scenes,
  layout = 'horizontal',
  initialViewport,
  onViewportChange,
  onToggleCollapse,
  onSceneDescChange,
  onShotClick,
  onShotExplore,
  onShotDescChange,
  onAddScene,
  onAddShot,
  onRemoveScene,
  onRemoveShot,
  onReorderScenes,
  onReorderShots,
  onRankChange,
  onVideoRankChange,
  onToggleSceneLock,
  onToggleShowVideos,
  onToggleShowStoryboard,
  onToggleShotLock,
  onToggleVideoShotLock,
  onToggleDualFrame,
  onLightboxOpen,
  onRemoveResult,
  onVideoShotClick,
  onAddVideoShot,
  onRemoveVideoShot,
  onRemoveVideoResult,
  onVideoShotDescChange,
  onImportFromStoryboard,
  onReorderVideoShots,
  activeTasks,
  characterItems,
  onOpenCharacterGen,
  onCharacterEdit,
  onCharacterRename,
  onCharacterItemClick,
  onCharacterItemDelete,
  onCharacterReorder,
  supplementaryItems,
  onOpenSupplementaryGen,
  onSupplementaryItemClick,
  onSupplementaryItemDelete,
  onSupplementaryReorder,
  onCharacterExplore,
  onSupplementaryExplore,
  canvasNotes = {},
  notesVisible = true,
  onNoteAdd,
  onNoteUpdate,
  onNoteDelete,
  visible = true,
  characterLoading,
  generatingCharacters,
  supplementaryLoading,
  generatingSupplementaryCount = 0,
  projectName,
  projectState,
  scriptOffset = 0,
  // Audio + edited video display (multimodal pipeline output)
  audioTracks = [],
  onDeleteAudioTrack,
  editedVideos = [],
  onDeleteEditedVideo,
}) {
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const suppRef = useRef(null)
  const fabRef = useRef(null)
  const [scale, setScale] = useState(initialViewport?.scale || 1)
  const isHorizontal = layout === 'horizontal'
  const saveTimer = useRef(null)
  const lastScrollRef = useRef({ scrollLeft: 0, scrollTop: 0 })

  const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  // Match + Scene button height to first scene's header + storyboard area
  useEffect(() => {
    const btn = fabRef.current
    if (!btn || !isHorizontal) { if (btn) btn.style.height = ''; return }
    const sibling = btn.previousElementSibling
    if (!sibling) return
    const header = sibling.querySelector('.scene-header-bar')
    const sb = sibling.querySelector('.storyboard-area')
    if (header && sb) {
      btn.style.height = (header.offsetHeight + 8 + sb.offsetHeight) + 'px'
    }
  }, [scenes, isHorizontal, visible])

  // Restore scroll position on mount and when becoming visible again
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !visible) return
    const pos = lastScrollRef.current
    requestAnimationFrame(() => {
      el.scrollLeft = pos.scrollLeft || 0
      el.scrollTop = pos.scrollTop || 0
    })
  }, [visible])

  // Save viewport position on scroll (debounced)
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !onViewportChange) return
    function onScroll() {
      lastScrollRef.current = { scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        onViewportChange({ scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, scale })
      }, 500)
    }
    el.addEventListener('scroll', onScroll)
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(saveTimer.current) }
  }, [onViewportChange, scale])

  // Ctrl+scroll to zoom; wheel scrolls along layout axis, Alt+wheel scrolls cross-axis
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function onWheel(e) {
      // Let scrollable children (textareas, overflow containers) scroll normally
      let node = e.target
      while (node && node !== el) {
        if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
          const style = getComputedStyle(node)
          const ov = style.overflow + style.overflowX + style.overflowY
          if (/auto|scroll/.test(ov)) return
        }
        node = node.parentElement
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = e.deltaY > 0 ? -0.08 : 0.08
        setScale(prev => {
          const next = clampScale(prev * (1 + factor))
          onViewportChange?.({ scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, scale: next })
          return next
        })
      } else if (isHorizontal) {
        if (!e.altKey) {
          e.preventDefault()
          el.scrollLeft += e.deltaY
        }
      } else {
        if (e.altKey) {
          e.preventDefault()
          el.scrollLeft += e.deltaY
        }
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onViewportChange, isHorizontal])

  // Horizontal mode: pin lane horizontally so it stays visible during horizontal scroll
  useEffect(() => {
    const el = viewportRef.current
    const supp = suppRef.current
    if (!el || !supp) return
    if (!isHorizontal) { supp.style.transform = ''; return }
    function pin() {
      supp.style.transform = `translateX(${el.scrollLeft / scale}px)`
    }
    pin()
    el.addEventListener('scroll', pin)
    return () => el.removeEventListener('scroll', pin)
  }, [scale, isHorizontal])

  // Long-press on blank canvas area to drag-pan the viewport
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    let panning = false
    let holdTimer = null
    let origin = null

    function isBlank(target) {
      return target === el || target.classList.contains('timeline-content') || target.classList.contains('timeline-scenes')
    }

    function onMouseDown(e) {
      if (e.button !== 0 || !isBlank(e.target)) return
      origin = { x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
      holdTimer = setTimeout(() => {
        panning = true
        el.classList.add('panning')
      }, 150)
    }

    function onMouseMove(e) {
      if (!panning || !origin) return
      el.scrollLeft = origin.scrollLeft - (e.clientX - origin.x)
      el.scrollTop = origin.scrollTop - (e.clientY - origin.y)
    }

    function onMouseUp() {
      clearTimeout(holdTimer)
      holdTimer = null
      panning = false
      origin = null
      el.classList.remove('panning')
    }

    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      clearTimeout(holdTimer)
    }
  }, [])

  // Context menu, note input, inline assistant state
  const [contextMenu, setContextMenu] = useState(null)
  const [noteInput, setNoteInput] = useState(null)
  const [chatScopes, setChatScopes] = useState({})           // { scopeKey: { context } }
  const [activeAssistant, setActiveAssistant] = useState(null) // { scopeKey, x, y } or null
  const getScopeKey = (ctx) => ctx ? `${ctx.type}:${ctx.anchorId}` : null
  const [activeLineNoteId, setActiveLineNoteId] = useState(null)   // from note hover/drag
  const [activeLineAnchorId, setActiveLineAnchorId] = useState(null) // from asset icon hover
  const draggingNoteRef = useRef(null)
  const lastContextMenuRef = useRef(null)

  function handleContextMenu(e) {
    e.preventDefault()
    const context = detectContext(e.target, viewportRef.current)
    const isPinned = ['character', 'supplement', 'character-lane', 'supplementary-lane'].includes(context?.type)
    let canvasX = 0, canvasY = 0
    if (isPinned && suppRef.current) {
      const rect = suppRef.current.getBoundingClientRect()
      canvasX = Math.round((e.clientX - rect.left) / scale)
      canvasY = Math.round((e.clientY - rect.top) / scale)
    } else if (contentRef.current) {
      const rect = contentRef.current.getBoundingClientRect()
      canvasX = Math.round((e.clientX - rect.left) / scale)
      canvasY = Math.round((e.clientY - rect.top) / scale)
    }
    const menu = { x: e.clientX, y: e.clientY, context, canvasX, canvasY }
    setContextMenu(menu)
    lastContextMenuRef.current = menu
    setNoteInput(null)
    setActiveAssistant(null)
  }

  function handleAddNoteFromMenu() {
    if (!contextMenu) return
    const ctx = contextMenu.context
    const anchor = ctx?.type || 'canvas'
    const anchorId = ctx?.anchorId || null
    setNoteInput({
      x: contextMenu.x, y: contextMenu.y,
      anchor, anchorId,
      canvasX: contextMenu.canvasX, canvasY: contextMenu.canvasY,
      contextLabel: ctx?.label || null,
    })
  }

  function handleNoteInputBack() {
    setNoteInput(null)
    if (lastContextMenuRef.current) {
      setContextMenu(lastContextMenuRef.current)
    }
  }

  function handleNoteSubmit(text, color) {
    if (!noteInput) return
    onNoteAdd?.(noteInput.anchor, noteInput.anchorId, noteInput.canvasX, noteInput.canvasY, text, color, noteInput.contextLabel)
    setNoteInput(null)
  }

  function handleOpenAssistantFromMenu() {
    if (!contextMenu) return
    const ctx = contextMenu.context
    const key = getScopeKey(ctx)
    if (key && !chatScopes[key]) {
      setChatScopes(prev => ({ ...prev, [key]: { context: ctx } }))
    }
    setActiveAssistant({ scopeKey: key, x: contextMenu.x, y: contextMenu.y })
  }

  function handleMinimizeAssistant() {
    setActiveAssistant(null)
  }

  function handleCloseAssistant(scopeKey) {
    closeChat(scopeKey)
    setChatScopes(prev => { const next = { ...prev }; delete next[scopeKey]; return next })
    if (activeAssistant?.scopeKey === scopeKey) setActiveAssistant(null)
  }

  // Agent indicator: map shotId → scopeKey for all inline sessions (mounted + persisted)
  const agentScopeMap = useMemo(() => {
    const map = {}
    for (const key of Object.keys(chatScopes)) {
      if (activeAssistant?.scopeKey === key) continue
      const colonIdx = key.indexOf(':')
      if (colonIdx >= 0) map[key.substring(colonIdx + 1)] = key
    }
    // Include persisted sessions not currently mounted
    for (const key of Object.keys(projectState?.agent_conversations || {})) {
      if (key.startsWith('thread-')) continue
      if (activeAssistant?.scopeKey === key) continue
      const colonIdx = key.indexOf(':')
      if (colonIdx < 0) continue
      const anchorId = key.substring(colonIdx + 1)
      if (!map[anchorId]) map[anchorId] = key
    }
    return map
  }, [chatScopes, activeAssistant, projectState?.agent_conversations])

  // Reconstruct context from scope key + scenes for persisted sessions
  function contextFromScopeKey(key) {
    const colonIdx = key.indexOf(':')
    if (colonIdx < 0) return null
    const type = key.substring(0, colonIdx)
    const anchorId = key.substring(colonIdx + 1)
    if (type === 'character') {
      const char = (characterItems || []).find(c => c.id === anchorId)
      return { type, anchorId, label: `Character - ${char?.name || 'Unnamed'}`, characterName: char?.name }
    }
    if (type === 'supplement') {
      const item = (supplementaryItems || []).find(s => (s._key || s.id) === anchorId)
      const title = item?.prompt
      const hasTitle = title && title !== 'N/A' && title.trim()
      return { type, anchorId, label: `Supplement${hasTitle ? ' - ' + title.slice(0, 30) : ''}` }
    }
    for (const scene of (scenes || [])) {
      const shots = type === 'video-shot' ? (scene.video_shots || []) : scene.shots
      for (const shot of (shots || [])) {
        if (shot.id === anchorId) {
          return { type, anchorId, label: `Scene ${scene.scene_number}, Shot ${shot.shot_number}`, sceneNumber: String(scene.scene_number), shotNumber: String(shot.shot_number) }
        }
      }
    }
    return { type, anchorId, label: type }
  }

  function handleAgentIndicatorClick(scopeKey, e) {
    // Mount InlineAssistant if not already in chatScopes
    if (!chatScopes[scopeKey]) {
      const ctx = contextFromScopeKey(scopeKey)
      if (ctx) setChatScopes(prev => ({ ...prev, [scopeKey]: { context: ctx } }))
    }
    setActiveAssistant({ scopeKey, x: e.clientX, y: e.clientY })
  }

  // Note filtering
  const noteEntries = useMemo(() => Object.values(canvasNotes), [canvasNotes])

  // All notes visible on the canvas (asset-anchored only when expanded)
  const visibleNotes = useMemo(() => {
    if (!notesVisible) return []
    return noteEntries.filter(n => {
      if (['shot', 'video-shot', 'character', 'supplement'].includes(n.anchor)) return !n.minimized
      return true
    })
  }, [noteEntries, notesVisible])

  // Notes with linkage lines (anchored to assets/components with icons)
  const linkedNotes = useMemo(() => {
    return visibleNotes.filter(n => {
      if (n.anchorId && ['shot', 'video-shot', 'character', 'supplement', 'scene'].includes(n.anchor)) return true
      if (['character-lane', 'supplementary-lane'].includes(n.anchor)) return true
      return false
    })
  }, [visibleNotes])

  // Note counts per shot (for ShotCard/video shot icon)
  const noteCountByShot = useMemo(() => {
    const map = {}
    for (const n of noteEntries) {
      if ((n.anchor === 'shot' || n.anchor === 'video-shot') && n.anchorId) {
        map[n.anchorId] = (map[n.anchorId] || 0) + 1
      }
    }
    return map
  }, [noteEntries])

  // Note counts by character and supplement
  const notesByCharId = useMemo(() => {
    const map = {}
    for (const n of noteEntries) {
      if (n.anchor === 'character' && n.anchorId) {
        map[n.anchorId] = (map[n.anchorId] || 0) + 1
      }
    }
    return map
  }, [noteEntries])

  const notesBySuppId = useMemo(() => {
    const map = {}
    for (const n of noteEntries) {
      if (n.anchor === 'supplement' && n.anchorId) {
        map[n.anchorId] = (map[n.anchorId] || 0) + 1
      }
    }
    return map
  }, [noteEntries])

  // Toggle minimized on all notes for a given anchorId
  const handleToggleNotesForAnchor = useCallback((anchorId) => {
    const matching = noteEntries.filter(n => n.anchorId === anchorId)
    if (!matching.length) return
    const anyMinimized = matching.some(n => n.minimized)
    for (const n of matching) {
      onNoteUpdate?.(n.id, { minimized: !anyMinimized })
    }
  }, [noteEntries, onNoteUpdate])

  // Scene note counts
  const noteCountByScene = useMemo(() => {
    const map = {}
    for (const n of noteEntries) {
      if (n.anchor === 'scene' && n.anchorId) {
        map[n.anchorId] = (map[n.anchorId] || 0) + 1
      }
    }
    return map
  }, [noteEntries])

  const charLaneNoteCount = useMemo(() => noteEntries.filter(n => n.anchor === 'character-lane').length, [noteEntries])
  const suppLaneNoteCount = useMemo(() => noteEntries.filter(n => n.anchor === 'supplementary-lane').length, [noteEntries])

  // Split: pinned notes (char/supp related) render in pinned wrapper, rest in content
  const pinnedNotes = useMemo(() => {
    return visibleNotes.filter(n => ['character', 'supplement', 'character-lane', 'supplementary-lane'].includes(n.anchor))
  }, [visibleNotes])

  const unpinnedNotes = useMemo(() => {
    return visibleNotes.filter(n => !['character', 'supplement', 'character-lane', 'supplementary-lane'].includes(n.anchor))
  }, [visibleNotes])

  // Toggle all notes of a given anchor type (for lane-level toggles)
  const handleToggleNotesByType = useCallback((anchorType) => {
    const matching = noteEntries.filter(n => n.anchor === anchorType)
    if (!matching.length) return
    const anyMinimized = matching.some(n => n.minimized)
    for (const n of matching) {
      onNoteUpdate?.(n.id, { minimized: !anyMinimized })
    }
  }, [noteEntries, onNoteUpdate])

  // Note link line visibility: show on hover or drag
  const handleNoteHover = useCallback((noteId) => {
    if (!draggingNoteRef.current) setActiveLineNoteId(noteId)
  }, [])

  const handleNoteDragChange = useCallback((noteId, isDragging) => {
    draggingNoteRef.current = isDragging ? noteId : null
    setActiveLineNoteId(isDragging ? noteId : null)
  }, [])

  // Find which note is anchored to a given asset (for asset-side hover)
  const noteIdByAnchorId = useMemo(() => {
    const map = {}
    for (const n of linkedNotes) {
      const key = n.anchorId || n.anchor
      if (!map[key]) map[key] = []
      map[key].push(n.id)
    }
    return map
  }, [linkedNotes])

  const handleAssetNoteHover = useCallback((anchorId, entering) => {
    if (draggingNoteRef.current) return
    setActiveLineAnchorId(entering ? anchorId : null)
  }, [])

  // Attach hover listeners to asset note icons in DOM
  useEffect(() => {
    const el = contentRef.current
    if (!el || !notesVisible) return
    const icons = el.querySelectorAll('.shot-note-icon, .char-note-icon, .supp-note-icon, .scene-note-icon, .lane-note-icon')
    function enter(e) {
      const card = e.currentTarget.closest('[data-shot-id], [data-character-id], [data-supplement-id], [data-scene-id]')
      const laneEl = e.currentTarget.closest('.character-lane, .supplementary-lane')
      const anchorId = card?.dataset.shotId || card?.dataset.characterId || card?.dataset.supplementId || card?.dataset.sceneId
        || (laneEl?.classList.contains('character-lane') ? 'character-lane' : laneEl?.classList.contains('supplementary-lane') ? 'supplementary-lane' : null)
      if (anchorId) handleAssetNoteHover(anchorId, true)
    }
    function leave() { handleAssetNoteHover(null, false) }
    icons.forEach(icon => { icon.addEventListener('mouseenter', enter); icon.addEventListener('mouseleave', leave) })
    return () => icons.forEach(icon => { icon.removeEventListener('mouseenter', enter); icon.removeEventListener('mouseleave', leave) })
  }, [linkedNotes, notesVisible, handleAssetNoteHover])

  // Filter linked notes to only the hovered/dragged ones
  const activeLinkedNotes = useMemo(() => {
    if (!activeLineNoteId && !activeLineAnchorId) return []
    return linkedNotes.filter(n =>
      n.id === activeLineNoteId ||
      (activeLineAnchorId && (n.anchorId === activeLineAnchorId || n.anchor === activeLineAnchorId))
    )
  }, [linkedNotes, activeLineNoteId, activeLineAnchorId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    if (scenes.some(s => s.id === active.id) && scenes.some(s => s.id === over.id)) {
      const oldIndex = scenes.findIndex(s => s.id === active.id)
      const newIndex = scenes.findIndex(s => s.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1) onReorderScenes(oldIndex, newIndex)
      return
    }

    for (const scene of scenes) {
      const activeIdx = scene.shots.findIndex(sh => sh.id === active.id)
      if (activeIdx !== -1) {
        const overIdx = scene.shots.findIndex(sh => sh.id === over.id)
        if (overIdx !== -1) onReorderShots(scene.id, activeIdx, overIdx)
        return
      }
    }

    for (const scene of scenes) {
      const vShots = scene.video_shots || []
      const activeIdx = vShots.findIndex(sh => sh.id === active.id)
      if (activeIdx !== -1) {
        const overIdx = vShots.findIndex(sh => sh.id === over.id)
        if (overIdx !== -1) onReorderVideoShots?.(scene.id, activeIdx, overIdx)
        return
      }
    }

    for (const scene of scenes) {
      for (const shot of scene.shots) {
        const oldIndex = shot.ranked_result_ids.indexOf(active.id)
        if (oldIndex !== -1) {
          const newIndex = shot.ranked_result_ids.indexOf(over.id)
          if (newIndex !== -1) {
            onRankChange(scene.id, shot.id, arrayMove(shot.ranked_result_ids, oldIndex, newIndex))
          }
          return
        }
      }
    }

    for (const scene of scenes) {
      for (const vshot of (scene.video_shots || [])) {
        const ranked = vshot.ranked_result_ids || []
        const oldIndex = ranked.indexOf(active.id)
        if (oldIndex !== -1) {
          const newIndex = ranked.indexOf(over.id)
          if (newIndex !== -1) {
            onVideoRankChange?.(scene.id, vshot.id, arrayMove(ranked, oldIndex, newIndex))
          }
          return
        }
      }
    }
  }, [scenes, onReorderScenes, onReorderShots, onReorderVideoShots, onRankChange, onVideoRankChange])

  const sceneIds = scenes.map(s => s.id)

  const sceneStrategy = isHorizontal ? horizontalListSortingStrategy : verticalListSortingStrategy

  return (
    <div className="timeline-canvas" ref={viewportRef} onContextMenu={handleContextMenu}>
      <div ref={contentRef} className={`timeline-content ${layout}`} style={{ transform: `scale(${scale})`, '--zoom-scale': Math.sqrt(scale) }}>
        <div ref={suppRef} className="supp-sticky-wrapper">
          <CharacterLane
            items={characterItems}
            layout={layout}
            onGenerate={onOpenCharacterGen}
            onEdit={onCharacterEdit}
            onRename={onCharacterRename}
            onItemClick={onCharacterItemClick}
            onItemDelete={onCharacterItemDelete}
            onReorder={onCharacterReorder}
            onExplore={onCharacterExplore}
            notesByCharId={notesVisible ? notesByCharId : {}}
            onNoteToggle={handleToggleNotesForAnchor}
            laneNoteCount={notesVisible ? charLaneNoteCount : 0}
            onLaneNoteToggle={handleToggleNotesByType}
            loading={characterLoading}
            generatingCharacters={generatingCharacters}
            agentScopeMap={agentScopeMap}
            onAgentIndicatorClick={handleAgentIndicatorClick}
          />
          <SupplementaryLane
            items={supplementaryItems}
            layout={layout}
            onGenerate={onOpenSupplementaryGen}
            onItemClick={onSupplementaryItemClick}
            onItemDelete={onSupplementaryItemDelete}
            onReorder={onSupplementaryReorder}
            onExplore={onSupplementaryExplore}
            notesBySuppId={notesVisible ? notesBySuppId : {}}
            onNoteToggle={handleToggleNotesForAnchor}
            laneNoteCount={notesVisible ? suppLaneNoteCount : 0}
            onLaneNoteToggle={handleToggleNotesByType}
            loading={supplementaryLoading}
            generatingCount={generatingSupplementaryCount}
            agentScopeMap={agentScopeMap}
            onAgentIndicatorClick={handleAgentIndicatorClick}
          />
          {/* Pinned notes render inside wrapper so they stay with char/supp lanes */}
          {pinnedNotes.map(note => (
            <StickyNote
              key={note.id}
              note={note}
              scale={scale}
              draggable
              onUpdate={(patch) => onNoteUpdate?.(note.id, patch)}
              onDelete={() => onNoteDelete?.(note.id)}
              onHover={handleNoteHover}
              onDragChange={handleNoteDragChange}
            />
          ))}
        </div>
        <div className="timeline-scenes">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sceneIds} strategy={sceneStrategy}>
              {scenes.map(scene => (
                <SceneLane
                  key={scene.id}
                  scene={scene}
                  layout={layout}
                  onToggleCollapse={onToggleCollapse}
                  onDescChange={onSceneDescChange}
                  onShotClick={onShotClick}
                  onShotExplore={onShotExplore}
                  onShotDescChange={onShotDescChange}
                  onAddShot={onAddShot}
                  onRemoveScene={onRemoveScene}
                  onRemoveShot={onRemoveShot}
                  onToggleSceneLock={onToggleSceneLock}
                  onToggleShowVideos={onToggleShowVideos}
                  onToggleShowStoryboard={onToggleShowStoryboard}
                  onToggleShotLock={onToggleShotLock}
                  onToggleVideoShotLock={onToggleVideoShotLock}
                  onToggleDualFrame={onToggleDualFrame}
                  onLightboxOpen={onLightboxOpen}
                  onRemoveResult={onRemoveResult}
                  onVideoShotClick={onVideoShotClick}
                  onRankChange={onRankChange}
                  onVideoRankChange={onVideoRankChange}
                  onAddVideoShot={onAddVideoShot}
                  onRemoveVideoShot={onRemoveVideoShot}
                  onRemoveVideoResult={onRemoveVideoResult}
                  onVideoShotDescChange={onVideoShotDescChange}
                  onImportFromStoryboard={onImportFromStoryboard}
                  onReorderVideoShots={onReorderVideoShots}
                  activeTasks={activeTasks}
                  zoomScale={scale}
                  noteCountByShot={notesVisible ? noteCountByShot : {}}
                  sceneNoteCount={notesVisible ? (noteCountByScene[scene.id] || 0) : 0}
                  onNoteToggle={handleToggleNotesForAnchor}
                  agentScopeMap={agentScopeMap}
                  onAgentIndicatorClick={handleAgentIndicatorClick}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button ref={fabRef} className="add-scene-fab" onClick={() => onAddScene()}>+ Scene</button>
        </div>

        {/* Audio + Edited Video lanes -- interleaved multimodal output.
            These lanes render content that streams in alongside text and images
            as the creative agent produces them via generate_audio / edit_video
            FC tools. The full pipeline: script -> characters -> storyboard ->
            video -> audio -> edited video, all interleaved in real time. */}
        <AudioLane
          tracks={audioTracks}
          onDelete={onDeleteAudioTrack}
          scale={scale}
        />
        <EditedVideoLane
          videos={editedVideos}
          onDelete={onDeleteEditedVideo}
          scale={scale}
        />

        {/* Linkage lines from notes to anchor icons (visible on hover/drag) */}
        <NoteLinks notes={activeLinkedNotes} contentEl={contentRef.current} scale={scale} />

        {/* Unpinned sticky notes (canvas, scene, shot) */}
        {unpinnedNotes.map(note => (
          <StickyNote
            key={note.id}
            note={note}
            scale={scale}
            draggable
            onUpdate={(patch) => onNoteUpdate?.(note.id, patch)}
            onDelete={() => onNoteDelete?.(note.id)}
            onHover={handleNoteHover}
            onDragChange={handleNoteDragChange}
          />
        ))}
      </div>

      {/* Context menu portal */}
      {contextMenu && (
        <CanvasContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          context={contextMenu.context}
          onAddNote={handleAddNoteFromMenu}
          onOpenAssistant={handleOpenAssistantFromMenu}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Note input portal */}
      {noteInput && (
        <NoteInput
          position={{ x: noteInput.x, y: noteInput.y }}
          contextLabel={noteInput.contextLabel}
          onSubmit={handleNoteSubmit}
          onBack={handleNoteInputBack}
          onClose={() => setNoteInput(null)}
        />
      )}

      {/* Inline assistant portal */}
      {/* Inline assistants — kept mounted when minimized so streams continue */}
      {Object.entries(chatScopes).map(([key, { context: ctx }]) => {
        const isActive = activeAssistant?.scopeKey === key
        return (
          <InlineAssistant
            key={key}
            sessionKey={key}
            position={isActive ? { x: activeAssistant.x, y: activeAssistant.y } : { x: 0, y: 0 }}
            visible={isActive}
            context={ctx}
            onClose={() => handleCloseAssistant(key)}
            onMinimize={handleMinimizeAssistant}
            projectName={projectName}
            projectState={projectState}
            scenes={scenes}
          />
        )
      })}

      <ZoomControls
        scale={scale}
        leftOffset={scriptOffset}
        onScaleChange={(s) => {
          const next = clampScale(s)
          setScale(next)
          if (onViewportChange) {
            const el = viewportRef.current
            onViewportChange({ scrollLeft: el?.scrollLeft || 0, scrollTop: el?.scrollTop || 0, scale: next })
          }
        }}
        onReset={() => {
          setScale(1)
          if (onViewportChange) {
            const el = viewportRef.current
            onViewportChange({ scrollLeft: el?.scrollLeft || 0, scrollTop: el?.scrollTop || 0, scale: 1 })
          }
        }}
      />
    </div>
  )
}
