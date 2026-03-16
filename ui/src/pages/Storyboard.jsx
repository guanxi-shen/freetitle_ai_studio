import { useState, useCallback, useEffect, useRef, useMemo, useTransition } from 'react'
import useProject from '../hooks/useProject'
import useTaskManager from '../hooks/useTaskManager'
import useGeneration from '../hooks/useGeneration'
import { saveProject as apiSaveProject, copyProject as apiCopyProject, renameProjectApi, migrateFile, generateScriptStream } from '../services/api'
import Timeline from '../components/timeline/Timeline'
import GenerationPanel from '../components/generation/GenerationPanel'
import ResultLightbox from '../components/generation/ResultLightbox'
import useSoulboard from '../hooks/useSoulboard'
import SoulboardView from '../components/soulboard/SoulboardView'
import SoulboardSessionDropdown from '../components/soulboard/SoulboardSessionDropdown'
import ScriptPanel from '../components/script/ScriptPanel'
import TrashGallery from '../components/trash/TrashGallery'
import AgentChat from '../components/agent/AgentChat'
import ActivityMonitor from '../components/agent/ActivityMonitor'
import useAgentChat from '../hooks/useAgentChat'
import { setHandlers as setChatHandlers, getSession as getChatSession } from '../chat'
import './Storyboard.css'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}


export default function Storyboard({ sidebarOpen, setSidebarOpen, onTitleClick, onBreadcrumbChange, onSaveStatusChange, saveNowRef, trashOpen, setTrashOpen, onTrashCountChange }) {
  const {
    project, setProject, closeProject, isDirty, saving,
    newProject, loadProject, listAllProjects, removeProject, renameProject, saveAsProject, saveNow,
    addScene, removeScene, updateScene, reorderScenes,
    addShot, removeShot, updateShot, toggleDualFrame, updateShotFrameState, reorderShots,
    addVideoShot, removeVideoShot, updateVideoShot, reorderVideoShots,
    addResultToVideoShot, removeResultFromVideoShot, updateResultUrlInVideoShot, updateVideoShotRanking, clearVideoNewFlags,
    addResultToShot, removeResultFromShot, updateResultUrlInShot, updateRanking,
    updateViewport, clearNewFlags,
    addCharacter, addCharacterTurnaround, addCharacterVariation, removeCharacterResult, updateCharacterRanking, renameCharacter, removeCharacter, reorderCharacters,
    addSupplementaryItems, removeSupplementaryItem, reorderSupplementary, addShotSupplementaryItems, removeShotSupplementaryItem,
    addAudioTrack, deleteAudioTrack, addEditedVideo, deleteEditedVideo,
    updateProjectState, updatePendingTasks,
    removeFromTrash, trashCount,
    applyAgentOperations,
  } = useProject()

  const projectRef = useRef(project)
  projectRef.current = project

  const sb = useSoulboard(project?.name)

  const taskManager = useTaskManager({
    addResultToShot,
    updateResultUrlInShot,
    addResultToVideoShot,
    updateResultUrlInVideoShot,
    projectRef,
    updatePendingTasks,
  })

  const [view, setViewRaw] = useState('timeline')
  const [, startTransition] = useTransition()
  const setView = useCallback((v) => startTransition(() => setViewRaw(v)), [])
  const [activeShot, setActiveShot] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [sidebarName, setSidebarName] = useState('')
  const [sidebarBusy, setSidebarBusy] = useState(false)
  const [projectList, setProjectList] = useState([])
  const [projectListLoading, setProjectListLoading] = useState(true)
  const [loadingProjectName, setLoadingProjectName] = useState(() => {
    if (project) return null
    return localStorage.getItem('active-project') || null
  })
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [cardAction, setCardAction] = useState(null) // {name, type: 'rename'|'copy', value}
  const [showNewInput, setShowNewInput] = useState(false)
  const [layout, setLayout] = useState(() => project?.layout || localStorage.getItem('timeline-layout') || 'horizontal')
  const [lightbox, setLightbox] = useState(null)
  const [lightboxItems, setLightboxItems] = useState([])

  // Clear loading screen once project arrives (auto-restore from localStorage)
  useEffect(() => {
    if (project && loadingProjectName) setLoadingProjectName(null)
    if (!project && loadingProjectName) {
      // Fallback: if restore fails (key removed), clear after timeout
      const t = setTimeout(() => {
        if (!localStorage.getItem('active-project')) setLoadingProjectName(null)
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [project, loadingProjectName])

  // Sync sidebar name when project changes (load, rename, etc.)
  useEffect(() => {
    if (project?.name) setSidebarName(project.name)
  }, [project?.name])

  // Dashboard state
  const [dashboardSearch, setDashboardSearch] = useState('')
  const [dashboardSort, setDashboardSort] = useState('recent')
  const [dashboardShowAll, setDashboardShowAll] = useState(false)

  const filteredProjects = useMemo(() => {
    let list = [...projectList]
    if (dashboardSearch) {
      const q = dashboardSearch.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q))
    }
    switch (dashboardSort) {
      case 'name': list.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'shots': list.sort((a, b) => b.shot_count - a.shot_count); break
      default: list.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)); break
    }
    return list
  }, [projectList, dashboardSearch, dashboardSort])

  const totalShots = useMemo(() => projectList.reduce((s, p) => s + p.shot_count, 0), [projectList])

  // Script panel state
  const [scriptOpen, setScriptOpen] = useState(false)
  const [scriptMode, setScriptMode] = useState('float')
  const [scriptGenerating, setScriptGenerating] = useState(false)
  const [scriptThinking, setScriptThinking] = useState('')

  // Standalone generate results — persisted in project_state
  const standaloneResults = project?.project_state?.standalone_results || []
  const standaloneRankedIds = project?.project_state?.standalone_ranked_ids || []

  // Notes state
  const [notesVisible, setNotesVisible] = useState(true)
  const canvasNotes = project?.project_state?.canvas_notes || {}

  const handleAddNote = useCallback((anchor, anchorId, x, y, text, color, contextLabel) => {
    const id = `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
    const note = {
      id, text, color, minimized: false,
      created_at: new Date().toISOString(),
      anchor, anchorId: anchorId || null, x, y,
      contextLabel: contextLabel || null,
    }
    const prev = project?.project_state?.canvas_notes || {}
    updateProjectState({ canvas_notes: { ...prev, [id]: note } })
  }, [project?.project_state?.canvas_notes, updateProjectState])

  const handleUpdateNote = useCallback((noteId, patch) => {
    const prev = project?.project_state?.canvas_notes || {}
    if (!prev[noteId]) return
    updateProjectState({ canvas_notes: { ...prev, [noteId]: { ...prev[noteId], ...patch } } })
  }, [project?.project_state?.canvas_notes, updateProjectState])

  const handleDeleteNote = useCallback((noteId) => {
    const prev = { ...(project?.project_state?.canvas_notes || {}) }
    delete prev[noteId]
    updateProjectState({ canvas_notes: prev })
  }, [project?.project_state?.canvas_notes, updateProjectState])

  // Remove all notes anchored to a given ID (or any of the provided IDs)
  const cleanupNotesForAnchor = useCallback((anchorIds) => {
    const ids = Array.isArray(anchorIds) ? anchorIds : [anchorIds]
    const idSet = new Set(ids)
    const prev = project?.project_state?.canvas_notes || {}
    let changed = false
    const next = {}
    for (const [k, v] of Object.entries(prev)) {
      if (v.anchorId && idSet.has(v.anchorId)) { changed = true }
      else next[k] = v
    }
    if (changed) updateProjectState({ canvas_notes: next })
  }, [project?.project_state?.canvas_notes, updateProjectState])

  // Wrapped delete handlers that also clean up notes
  const handleRemoveScene = useCallback((sceneId) => {
    const scene = project?.scenes?.find(s => s.id === sceneId)
    const shotIds = scene ? [...scene.shots.map(s => s.id), ...(scene.video_shots || []).map(v => v.id)] : []
    cleanupNotesForAnchor([sceneId, ...shotIds])
    removeScene(sceneId)
  }, [project?.scenes, cleanupNotesForAnchor, removeScene])

  const handleRemoveShot = useCallback((sceneId, shotId) => {
    cleanupNotesForAnchor(shotId)
    removeShot(sceneId, shotId)
  }, [cleanupNotesForAnchor, removeShot])

  const handleRemoveVideoShot = useCallback((sceneId, shotId) => {
    cleanupNotesForAnchor(shotId)
    removeVideoShot(sceneId, shotId)
  }, [cleanupNotesForAnchor, removeVideoShot])

  const handleRemoveCharacter = useCallback((charId) => {
    cleanupNotesForAnchor(charId)
    removeCharacter(charId)
  }, [cleanupNotesForAnchor, removeCharacter])

  const handleRemoveSupplementaryItem = useCallback((key) => {
    cleanupNotesForAnchor(key)
    removeSupplementaryItem(key)
  }, [cleanupNotesForAnchor, removeSupplementaryItem])

  // Soulboard context (which shot/scene opened it)
  const [soulboardContext, setSoulboardContext] = useState(null) // null | { context, sceneId?, shotId? }
  const [soulboardDropdown, setSoulboardDropdown] = useState(null) // null | { anchorEl, context, sceneId?, shotId? }
  const soulboardBtnRef = useRef(null)

  // Character generation state
  const [activeCharacterId, setActiveCharacterId] = useState(null)
  const [characterSubMode, setCharacterSubMode] = useState('turnaround')

  const characterGen = useGeneration({
    onComplete: (result) => {
      const charId = result.config?.characterId || activeCharacterId
      if (!charId) return
      const imageData = {
        url: result.url, source: result.provider,
        prompt: result.prompt || '', config: result.config || {},
        is_image: true, timestamp: new Date().toISOString(),
        status: result.status, error: result.error,
      }
      // Use stamped type from task config, fall back to current toggle
      const type = result.config?.characterType || characterSubMode
      if (type === 'variation') addCharacterVariation(charId, imageData)
      else addCharacterTurnaround(charId, imageData)
    },
    projectName: project?.name,
    projectType: 'storyboard',
    updatePendingTasks,
  })

  // Characters with active generation tasks
  const generatingCharacters = useMemo(() => {
    const set = new Set()
    for (const t of characterGen.tasks) {
      const cid = t.config?.characterId
      if (cid && !['succeed', 'failed', 'timeout', 'error'].includes(t.status)) set.add(cid)
    }
    return set
  }, [characterGen.tasks])

  // Active character data for GenerationPanel
  const activeCharacterData = useMemo(() => {
    if (!activeCharacterId) return null
    return project?.project_state?.character_gallery?.[activeCharacterId] || null
  }, [activeCharacterId, project?.project_state?.character_gallery])

  // Separate turnaround and variation results for GenerationPanel
  const activeCharacterTurnarounds = useMemo(() => {
    if (!activeCharacterData) return []
    return (activeCharacterData.turnarounds || []).map(r => ({
      ...r, resultUrl: r.url, provider: r.source, status: 'succeed',
    }))
  }, [activeCharacterData])

  const activeCharacterTurnaroundRankedIds = useMemo(() => {
    if (!activeCharacterData) return []
    return activeCharacterData.turnaround_ranked_ids || []
  }, [activeCharacterData])

  const activeCharacterVariations = useMemo(() => {
    if (!activeCharacterData) return []
    return (activeCharacterData.variations || []).map(r => ({
      ...r, resultUrl: r.url, provider: r.source, status: 'succeed',
    }))
  }, [activeCharacterData])

  const activeCharacterVariationRankedIds = useMemo(() => {
    if (!activeCharacterData) return []
    return activeCharacterData.variation_ranked_ids || []
  }, [activeCharacterData])

  // Sync soulboardContext from session's stored metadata (covers SessionPicker path).
  // Skip when read-only (cross-context browsing) — context was set by handleDropdownSelect.
  useEffect(() => {
    if (!sb.activeSessionId || !sb.sessionContext) return
    if (sb.isReadOnly) return
    if (sb.sessionContext === 'shot' && sb.sessionShotId) {
      const ownerScene = project?.scenes?.find(s => s.shots?.some(sh => sh.id === sb.sessionShotId))
      setSoulboardContext(prev => {
        if (prev?.context === 'shot' && prev?.shotId === sb.sessionShotId) return prev
        return { context: 'shot', sceneId: ownerScene?.id, shotId: sb.sessionShotId, boardLabel: prev?.boardLabel || 'Board' }
      })
    } else if (sb.sessionContext === 'character' && sb.sessionCharacterId) {
      setSoulboardContext(prev => {
        if (prev?.context === 'character' && prev?.characterId === sb.sessionCharacterId) return prev
        return { context: 'character', characterId: sb.sessionCharacterId, boardLabel: prev?.boardLabel || 'Board' }
      })
    } else if (sb.sessionContext === 'supplementary') {
      setSoulboardContext(prev => {
        if (prev?.context === 'supplementary') return prev
        return { context: 'supplementary', boardLabel: prev?.boardLabel || 'Board' }
      })
    }
  }, [sb.activeSessionId, sb.sessionContext, sb.sessionShotId, sb.sessionCharacterId, sb.isReadOnly, project?.scenes])

  // Map character_gallery to structured array for CharacterLane
  const characterItems = useMemo(() => {
    const chars = project?.project_state?.character_gallery || {}
    const order = project?.project_state?.character_gallery_order || []
    const allKeys = new Set(Object.keys(chars))
    const orderedKeys = order.filter(k => allKeys.has(k))
    const unorderedKeys = [...allKeys].filter(k => !order.includes(k))
    return [...orderedKeys, ...unorderedKeys].map(key => ({
      _key: key, id: key, ...chars[key],
    }))
  }, [project?.project_state?.character_gallery, project?.project_state?.character_gallery_order])

  // Map generated_supplementary to flat array for SupplementaryLane and GenerationPanel
  const supplementaryItems = useMemo(() => {
    const supp = project?.project_state?.generated_supplementary || {}
    const order = project?.project_state?.supplementary_order || []
    // Build items from order array first, then append any unordered keys
    const allKeys = new Set(Object.keys(supp))
    const orderedKeys = order.filter(k => allKeys.has(k))
    const unorderedKeys = [...allKeys].filter(k => !order.includes(k))
    return [...orderedKeys, ...unorderedKeys].map(key => {
      const item = supp[key]
      return {
        _key: key, id: key,
        url: item.url || item.content_url,
        thumb_url: item.thumb_url || null,
        medium_url: item.medium_url || null,
        source: item.source || 'unknown',
        prompt: item.prompt || '',
        config: item.config || item.soulboard_origin?.generation_params || {},
        is_image: true,
        timestamp: item.timestamp,
      }
    })
  }, [project?.project_state?.generated_supplementary, project?.project_state?.supplementary_order])

  // Ref-based callback: assigned after all generation hooks are defined (below)
  const agentStateChangedRef = useRef(null)
  const handleAgentStateChanged = useCallback((data) => agentStateChangedRef.current?.(data), [])
  const agentChat = useAgentChat({ projectName: project?.name, projectState: project?.project_state, scenes: project?.scenes, updateProjectState, onStateChanged: handleAgentStateChanged })

  // Handle finalized soulboard items — route to correct destination, then always navigate back
  const handleSoulboardFinalize = useCallback((items, context, destination) => {
    if (items?.length) {
      if (context === 'character' && soulboardContext?.characterId) {
        for (const item of items) {
          addCharacterTurnaround(soulboardContext.characterId, {
            url: item.url, source: item.source,
            prompt: item.prompt || '', config: item.soulboard_origin?.generation_params || {},
            is_image: true, timestamp: item.timestamp,
          })
        }
      } else if (context === 'supplementary') {
        addSupplementaryItems(items)
      } else if (context === 'shot' && soulboardContext?.shotId) {
        addShotSupplementaryItems(soulboardContext.shotId, items)
      } else if (destination?.type === 'shot') {
        addShotSupplementaryItems(destination.shotId, items)
      } else {
        addSupplementaryItems(items)
      }
    }
    const back = soulboardContext?.returnView || (activeShot ? 'shot' : 'timeline')
    setView(back)
  }, [soulboardContext, activeShot, addSupplementaryItems, addShotSupplementaryItems, addCharacterTurnaround, setView])

  // Standalone generate: persist results in project_state
  const handleStandaloneComplete = useCallback((result) => {
    const id = result.id || `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const entry = { ...result, id, url: result.resultUrl || result.url, status: result.status || 'succeed' }
    const prev = project?.project_state || {}
    updateProjectState({
      standalone_results: [...(prev.standalone_results || []), entry],
      standalone_ranked_ids: [id, ...(prev.standalone_ranked_ids || [])],
    })
  }, [project?.project_state, updateProjectState])

  // Standalone generation polling — lives at Storyboard level so tasks survive view changes
  const standaloneGen = useGeneration({ onComplete: handleStandaloneComplete, projectName: project?.name, projectType: 'storyboard', updatePendingTasks })
  const supplementaryGen = useGeneration({
    onComplete: (result) => {
      const cfg = result.config || {}
      const item = {
        url: result.url, source: result.provider,
        prompt: result.prompt || '', config: cfg,
        title: cfg.title || '',
        description: cfg.description || '',
        category: cfg.category || '',
        is_image: result.is_image !== false, timestamp: new Date().toISOString(),
        status: result.status, error: result.error,
      }
      if (cfg.shotId) {
        addShotSupplementaryItems(cfg.shotId, [item])
      } else {
        addSupplementaryItems([item])
      }
    },
    projectName: project?.name,
    projectType: 'storyboard',
    updatePendingTasks,
  })

  // Route agent-submitted generation tasks to existing hooks
  agentStateChangedRef.current = (data) => {
    console.log('[AgentRoute] state_changed received:', data)
    if (!data) return
    if (data.change === 'structure_changed') {
      applyAgentOperations(data.operations)
      return
    }
    // Script generated via write_script FC tool
    if (data.type === 'script_generated' && data.script) {
      updateProjectState({ generated_scripts: data.script })
      setScriptOpen(true)
      return
    }
    // Audio and edited video events from generate_audio / edit_video FC tools
    if (data.type === 'audio_generated') {
      addAudioTrack({ url: data.url, name: data.name, duration_seconds: data.duration_seconds })
      return
    }
    if (data.type === 'edited_video') {
      addEditedVideo({ url: data.url, name: data.name, clips_used: data.clips_used, transitions_applied: data.transitions_applied })
      return
    }
    if (data.change !== 'task_submitted') return
    console.log('[AgentRoute] routing task:', data.source, data.taskId, data.shotId)
    if (updatePendingTasks) updatePendingTasks(prev => [...prev, data])
    const source = data.source
    if (source === 'shot' || source === 'video_shot') taskManager.recoverTasks([data])
    else if (source === 'character') characterGen.recoverTasks([data])
    else if (source === 'supplementary') supplementaryGen.recoverTasks([data])
    else if (source === 'standalone') standaloneGen.recoverTasks([data])
  }

  // Wire the chat session store for state_changed forwarding + persistence
  setChatHandlers({
    onStateChanged: handleAgentStateChanged,
    onPersist: (sessionKey) => {
      console.log('[ChatPersist] called for', sessionKey, 'updateProjectState=', !!updateProjectState)
      if (!updateProjectState) return
      const session = getChatSession(sessionKey)
      console.log('[ChatPersist] session:', sessionKey, 'msgs=', session?.messages?.length, 'seen=', session?.seen)
      if (!session?.messages?.length) return
      const data = { messages: session.messages.slice(-50) }
      if (session.title) data.title = session.title
      if (session.created_at) data.created_at = session.created_at
      if (session.hidden !== undefined) data.hidden = session.hidden
      if (session.seen) data.seen = true
      const current = projectRef.current?.project_state?.agent_conversations || {}
      console.log('[ChatPersist] saving to agent_conversations, existing keys:', Object.keys(current), 'adding:', sessionKey)
      updateProjectState({ agent_conversations: { ...current, [sessionKey]: data } })
    },
  })

  // Aggregate all generation tasks for ActivityMonitor
  const activityTasks = useMemo(() => {
    const all = []
    for (const [, tasks] of Object.entries(taskManager.taskMap)) {
      for (const t of tasks) {
        all.push({ ...t, _type: t.isVideoShot ? 'video' : 'storyboard' })
      }
    }
    for (const t of characterGen.tasks) all.push({ ...t, _type: 'character' })
    for (const t of supplementaryGen.tasks) all.push({ ...t, _type: 'supplementary' })
    for (const t of standaloneGen.tasks) all.push({ ...t, _type: 'standalone' })
    return all
  }, [taskManager.taskMap, characterGen.tasks, supplementaryGen.tasks, standaloneGen.tasks])

  // Supplementary items with active generation tasks
  const generatingSupplementaryCount = useMemo(() => {
    return supplementaryGen.tasks.filter(t =>
      !['succeed', 'failed', 'timeout', 'error'].includes(t.status)
    ).length
  }, [supplementaryGen.tasks])

  // Route selected results to a destination
  const handleSendToDestination = useCallback((selectedResults, destination) => {
    if (!selectedResults?.length) return
    if (destination.type === 'supplementary') {
      addSupplementaryItems(selectedResults.map(r => ({
        url: r.resultUrl || r.url,
        source: r.provider,
        prompt: r.prompt || '',
        config: r.config || {},
        is_image: r.is_image !== false,
        timestamp: new Date().toISOString(),
      })))
    } else if (destination.type === 'shot') {
      for (const r of selectedResults) {
        const result = addResultToShot(destination.sceneId, destination.shotId, {
          url: r.resultUrl || r.url,
          provider: r.provider,
          is_image: r.is_image !== false,
          prompt: r.prompt || '',
          config: r.config || {},
          timestamp: new Date().toISOString(),
          needsMigration: true,
        })
        if (result?.url && project?.name) {
          const ext = result.is_image !== false ? 'png' : 'mp4'
          migrateFile(r.resultUrl || r.url, 'storyboard', project.name, `${result.id}.${ext}`)
            .then(({ url, thumb_url, medium_url }) => updateResultUrlInShot(destination.sceneId, destination.shotId, result.id, url, thumb_url, medium_url))
            .catch(e => console.error('Migration failed:', e))
        }
      }
    }
  }, [addSupplementaryItems, addResultToShot, updateResultUrlInShot, project?.name])

  // Script generation handler
  const creativeMode = project?.project_state?.creative_mode || 'film'
  const setCreativeMode = useCallback((mode) => {
    updateProjectState({ creative_mode: mode })
  }, [updateProjectState])

  const scriptScrollTimer = useRef(null)
  const handleScriptScrollId = useCallback((id) => {
    clearTimeout(scriptScrollTimer.current)
    scriptScrollTimer.current = setTimeout(() => {
      updateProjectState({ script_scroll_id: id })
    }, 500)
  }, [updateProjectState])

  const handleScriptGenerate = useCallback(async (query, preferences, existingScript) => {
    setScriptGenerating(true)
    setScriptThinking('')
    try {
      await generateScriptStream(query, preferences, existingScript, creativeMode, (event) => {
        if (event.type === 'thinking') {
          setScriptThinking(prev => prev + event.text)
        } else if (event.type === 'script_complete') {
          updateProjectState({ generated_scripts: event.script })
        } else if (event.type === 'error') {
          console.error('[Script] Generation failed:', event.error)
        }
      })
    } catch (e) {
      console.error('[Script] Stream failed:', e)
    } finally {
      setScriptGenerating(false)
      setScriptThinking('')
    }
  }, [creativeMode, updateProjectState])

  const handleScriptChange = useCallback((updatedScript) => {
    updateProjectState({ generated_scripts: updatedScript })
  }, [updateProjectState])

  // Map shot result to lightbox format, track which shot it belongs to
  const [lightboxShot, setLightboxShot] = useState(null)

  function handleLightboxOpen(result, allResults, sceneId, shotId) {
    if (result.isNew && sceneId && shotId) {
      if (result.is_image === false) clearVideoNewFlags(sceneId, shotId, result.id)
      else clearNewFlags(sceneId, shotId, result.id)
    }
    const toLightboxItem = (r) => ({
      resultUrl: r.url,
      provider: r.provider,
      is_image: r.is_image,
      prompt: r.prompt,
      config: r.config,
      version: r.version,
      _charName: r._charName,
      _charId: r._charId,
    })
    setLightbox(toLightboxItem(result))
    setLightboxItems((allResults || []).filter(r => r.url).map(toLightboxItem))
    setLightboxShot(sceneId && shotId ? { sceneId, shotId } : null)
  }

  // Load project list on mount
  useEffect(() => {
    setProjectListLoading(true)
    listAllProjects().then(setProjectList).catch(() => setProjectList([])).finally(() => setProjectListLoading(false))
  }, [listAllProjects])

  // Auto-close sidebar when project changes
  useEffect(() => {
    setSidebarOpen(false)
    setTrashOpen(false)
  }, [project])

  // Close script panel when sidebar opens so it doesn't cover the project list
  useEffect(() => {
    if (sidebarOpen) setScriptOpen(false)
  }, [sidebarOpen])

  // Title click: auto-save, return to dashboard
  useEffect(() => {
    if (onTitleClick) onTitleClick.current = async () => {
      if (projectRef.current) {
        try { if (saveNowRef.current) await saveNowRef.current() } catch (e) { console.error('Auto-save:', e) }
      }
      closeProject()
      setView('timeline')
      setSidebarOpen(false)
      refreshProjectList()
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      // Ctrl+S / Cmd+S — save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (saveNowRef.current) saveNowRef.current()
      }
      // Escape — close topmost overlay
      if (e.key === 'Escape') {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (lightbox) { setLightbox(null); return }
        if (trashOpen) { setTrashOpen(false); return }
        if (soulboardDropdown) { setSoulboardDropdown(null); return }
        if (scriptOpen) { setScriptOpen(false); return }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightbox, trashOpen, soulboardDropdown, scriptOpen])

  // Compute and sync breadcrumbs to nav bar
  useEffect(() => {
    if (!project?.name) { onBreadcrumbChange?.([]); return }

    const crumbs = [{ label: project.name, onClick: view !== 'timeline' ? () => setView('timeline') : undefined }]

    if (view === 'shot' && activeShot) {
      const sceneIdx = project.scenes?.findIndex(s => s.id === activeShot.sceneId) ?? -1
      const scene = sceneIdx >= 0 ? project.scenes[sceneIdx] : null
      const shotArr = activeShot.mediaType === 'video' ? (scene?.video_shots || []) : (scene?.shots || [])
      const shotIdx = shotArr.findIndex(sh => sh.id === activeShot.shotId)
      if (sceneIdx >= 0) crumbs.push({ label: `Scene ${sceneIdx + 1}`, onClick: () => setView('timeline') })
      const frameLabel = activeShot.frame ? ` (${activeShot.frame === 'start' ? 'Start' : 'End'})` : ''
      const shotLabel = activeShot.mediaType === 'video' ? 'Video' : 'Shot'
      if (shotIdx >= 0) crumbs.push({ label: `${shotLabel} ${shotIdx + 1}${frameLabel}` })
    }

    if (view === 'soulboard') {
      if (soulboardContext?.context === 'shot' && soulboardContext.sceneId) {
        const sceneIdx = project.scenes?.findIndex(s => s.id === soulboardContext.sceneId) ?? -1
        const scene = sceneIdx >= 0 ? project.scenes[sceneIdx] : null
        const shotIdx = scene?.shots?.findIndex(sh => sh.id === soulboardContext.shotId) ?? -1
        if (sceneIdx >= 0) crumbs.push({ label: `Scene ${sceneIdx + 1}`, onClick: () => setView('timeline') })
        if (shotIdx >= 0) crumbs.push({
          label: `Shot ${shotIdx + 1}`,
          onClick: () => { setActiveShot({ sceneId: soulboardContext.sceneId, shotId: soulboardContext.shotId }); setView('shot') },
        })
      } else if (soulboardContext?.context === 'character' && soulboardContext.characterId) {
        const char = characterItems.find(c => c.id === soulboardContext.characterId)
        crumbs.push({ label: char?.name || 'Character', onClick: () => setView('timeline') })
      } else if (soulboardContext?.context === 'supplementary') {
        crumbs.push({ label: 'Supplementary', onClick: () => setView('timeline') })
      }
      crumbs.push({ label: soulboardContext?.boardLabel || 'Soulboard' })
    }

    if (view === 'supplementary') {
      crumbs.push({ label: 'Supplementary' })
    }

    if (view === 'characters') {
      crumbs.push({ label: 'Characters' })
    }

    if (view === 'generate') {
      crumbs.push({ label: 'Generate' })
    }

    onBreadcrumbChange?.(crumbs)
  }, [project?.name, project?.scenes, view, activeShot, soulboardContext])

  useEffect(() => {
    onSaveStatusChange?.({ isDirty, saving })
  }, [isDirty, saving])

  useEffect(() => {
    if (saveNowRef) saveNowRef.current = saveNow
  }, [saveNow])

  useEffect(() => {
    onTrashCountChange?.(trashCount)
  }, [trashCount])

  // Restore: route items back to their original location based on source.type
  const handleTrashRestore = useCallback((items) => {
    const restoredIds = []
    for (const item of items) {
      const src = item.source || {}
      const data = item.data || {}
      let ok = true
      switch (src.type) {
        case 'shot':
          ok = !!addResultToShot(src.sceneId, src.shotId, { ...data, id: undefined }, data.frame_number || 1)
          break
        case 'video_shot':
          ok = !!addResultToVideoShot(src.sceneId, src.shotId, { ...data, id: undefined })
          break
        case 'supplementary':
          addSupplementaryItems([data])
          break
        case 'shot_supplementary':
          addShotSupplementaryItems(src.shotId, [data])
          break
        case 'character_result':
          if (src.charId && src.resultType) {
            const gallery = projectRef.current?.project_state?.character_gallery
            if (gallery?.[src.charId]) {
              if (src.resultType === 'turnaround') addCharacterTurnaround(src.charId, data)
              else addCharacterVariation(src.charId, data)
            }
          }
          break
      }
      if (ok) restoredIds.push(item.id)
    }
    if (restoredIds.length) removeFromTrash(restoredIds)
  }, [addResultToShot, addResultToVideoShot, addSupplementaryItems, addShotSupplementaryItems, addCharacterTurnaround, addCharacterVariation, removeFromTrash])

  const handleTrashDelete = useCallback((ids) => {
    removeFromTrash(ids)
  }, [removeFromTrash])

  function refreshProjectList() {
    setProjectListLoading(true)
    listAllProjects().then(setProjectList).catch(() => setProjectList([])).finally(() => setProjectListLoading(false))
  }

  // Recover pending tasks on project load
  useEffect(() => {
    if (!project?.project_state?.pending_tasks?.length) return
    const STALE_MS = 20 * 60 * 1000
    const now = Date.now()
    const fresh = project.project_state.pending_tasks.filter(t => now - t.startTime < STALE_MS)
    const stale = project.project_state.pending_tasks.length - fresh.length

    // Clean up stale tasks
    if (stale > 0) {
      updatePendingTasks(fresh)
    }
    if (!fresh.length) return

    // Route tasks to the correct hook by source
    const shotTasks = fresh.filter(t => t.source === 'shot' || t.source === 'video_shot')
    const charTasks = fresh.filter(t => t.source === 'character')
    const suppTasks = fresh.filter(t => t.source === 'supplementary')
    const standaloneTasks = fresh.filter(t => t.source === 'standalone')

    if (shotTasks.length) taskManager.recoverTasks(shotTasks)
    if (charTasks.length) characterGen.recoverTasks(charTasks)
    if (suppTasks.length) supplementaryGen.recoverTasks(suppTasks)
    if (standaloneTasks.length) standaloneGen.recoverTasks(standaloneTasks)
  }, [project?.name])

  // Restore layout and viewport from loaded project
  useEffect(() => {
    if (!project) return
    if (project.layout) setLayout(project.layout)
  }, [project?.name])

  function toggleLayout() {
    const next = layout === 'horizontal' ? 'vertical' : 'horizontal'
    setLayout(next)
    localStorage.setItem('timeline-layout', next)
    setProject(prev => ({ ...prev, layout: next }))
  }

  const handleViewportChange = useCallback((viewport) => {
    updateViewport(viewport)
  }, [updateViewport])

  // Always show session picker dropdown
  function openSoulboard(anchorEl, ctx) {
    setSoulboardDropdown({ anchorEl, ...ctx, returnView: view })
  }

  // Dropdown selected an existing session — load it and go to soulboard view.
  // Cross-shot detection: read-only only when dropdown opened from shot A but session belongs to shot B.
  // Toolbar (standalone, no shotId) always opens sessions read-write.
  const handleDropdownSelect = useCallback(async (sessionId, _readOnly, boardLabel, sessionMeta) => {
    const dropdownCtx = soulboardDropdown
    setSoulboardDropdown(null)
    try {
      const storedShotId = sessionMeta?.shot_id
      // Cross-shot = dropdown opened from shot A, session belongs to shot B
      const isCrossShot = dropdownCtx?.shotId && storedShotId && dropdownCtx.shotId !== storedShotId

      let result = null
      if (sessionId !== sb.activeSessionId) {
        if (isCrossShot) {
          result = await sb.loadSessionReadOnly(sessionId)
        } else {
          result = await sb.loadSession(sessionId)
        }
      }

      const returnView = dropdownCtx?.returnView
      if (isCrossShot) {
        // Cross-shot browsing: keep dropdown's context (fork goes to current working shot)
        setSoulboardContext({ context: dropdownCtx.context, sceneId: dropdownCtx.sceneId, shotId: dropdownCtx.shotId, characterId: dropdownCtx.characterId, boardLabel, returnView })
      } else {
        // Own session or standalone: use session's stored context
        const ctx = result?.context || sessionMeta?.context
        const shotId = result?.shot_id || storedShotId
        const charId = result?.character_id || sessionMeta?.character_id
        if (ctx === 'shot' && shotId) {
          const ownerScene = project?.scenes?.find(s => s.shots?.some(sh => sh.id === shotId))
          setSoulboardContext({ context: 'shot', sceneId: ownerScene?.id, shotId, boardLabel, returnView })
        } else if (ctx === 'character' && charId) {
          setSoulboardContext({ context: 'character', characterId: charId, boardLabel, returnView })
        } else if (ctx === 'supplementary') {
          setSoulboardContext({ context: 'supplementary', boardLabel, returnView })
        } else {
          setSoulboardContext({ context: ctx || dropdownCtx?.context || 'standalone', sceneId: dropdownCtx?.sceneId, shotId: dropdownCtx?.shotId, characterId: dropdownCtx?.characterId, boardLabel, returnView })
        }
      }
      setView('soulboard')
    } catch (e) {
      console.error('[Soulboard] Failed to load session:', e)
    }
  }, [soulboardDropdown, sb, project?.scenes])

  // Dropdown "New Session" — create and go to soulboard view
  const handleDropdownNew = useCallback(async () => {
    const ctx = soulboardDropdown
    setSoulboardDropdown(null)
    try {
      setSoulboardContext({ context: ctx.context, sceneId: ctx.sceneId, shotId: ctx.shotId, characterId: ctx.characterId, boardLabel: 'New Board', returnView: ctx.returnView })
      await sb.createSession({ query: '', context: ctx.context, shot_id: ctx.shotId, character_id: ctx.characterId })
      setView('soulboard')
    } catch (e) {
      console.error('[Soulboard] Failed to create session:', e)
    }
  }, [soulboardDropdown, sb])

  function handleShotClick(sceneId, shotId, frame = null) {
    clearNewFlags(sceneId, shotId)
    setActiveShot({ sceneId, shotId, frame })
    setView('shot')
  }

  function handleVideoShotClick(sceneId, shotId) {
    clearVideoNewFlags(sceneId, shotId)
    setActiveShot({ sceneId, shotId, frame: null, mediaType: 'video' })
    setView('shot')
  }

  // Import preferred storyboard frames + description into corresponding video shot
  function handleImportFromStoryboard(sceneId, videoShotId) {
    const scene = project?.scenes?.find(s => s.id === sceneId)
    if (!scene) return
    const vshot = (scene.video_shots || []).find(sh => sh.id === videoShotId)
    if (!vshot) return
    // Match by shot_number (1-indexed, 1:1 with storyboard)
    const sbShot = scene.shots?.find(sh => sh.shot_number === vshot.shot_number)
    if (!sbShot) return

    const updates = {}

    // Extract preferred image URLs from storyboard shot
    if (sbShot.dual_frame) {
      // Dual-frame: start + end
      const startRanked = sbShot.frames?.start?.ranked_result_ids || []
      const startResults = sbShot.results.filter(r => (r.frame_number || 1) === 1 && r.is_image !== false)
      const startImg = (startRanked[0] && startResults.find(r => r.id === startRanked[0])) || startResults[0]

      const endRanked = sbShot.frames?.end?.ranked_result_ids || []
      const endResults = sbShot.results.filter(r => (r.frame_number || 1) === 2 && r.is_image !== false)
      const endImg = (endRanked[0] && endResults.find(r => r.id === endRanked[0])) || endResults[0]

      if (startImg?.url || endImg?.url) {
        updates.gen_state = {
          ...(vshot.gen_state || {}),
          form_state: {
            ...(vshot.gen_state?.form_state || {}),
            startFrameUrl: startImg?.url || null,
            endFrameUrl: endImg?.url || null,
          },
        }
      }
    } else {
      // Single-frame: start only
      const ranked = sbShot.ranked_result_ids || []
      const images = sbShot.results.filter(r => r.is_image !== false)
      const topImg = (ranked[0] && images.find(r => r.id === ranked[0])) || images[0]

      if (topImg?.url) {
        updates.gen_state = {
          ...(vshot.gen_state || {}),
          form_state: {
            ...(vshot.gen_state?.form_state || {}),
            startFrameUrl: topImg.url,
            endFrameUrl: null,
          },
        }
      }
    }

    // Import description if storyboard shot has one and video shot is empty
    if (sbShot.description && !vshot.description) {
      updates.description = sbShot.description
    }

    if (Object.keys(updates).length > 0) {
      updateVideoShot(sceneId, videoShotId, updates)
    }
  }

  async function handleShotExplore(sceneId, shotId) {
    try {
      setSoulboardContext({ context: 'shot', sceneId, shotId, boardLabel: 'New Board', returnView: 'timeline' })
      await sb.createSession({ query: '', context: 'shot', shot_id: shotId })
      setView('soulboard')
    } catch (e) {
      console.error('[Soulboard] Failed to create session:', e)
    }
  }

  function handleCharacterExplore(charId) {
    openSoulboard(null, { context: 'character', characterId: charId })
  }

  function handleSupplementaryExplore() {
    openSoulboard(null, { context: 'supplementary' })
  }

  const activeShotData = activeShot
    ? (() => {
        const scene = project?.scenes?.find(s => s.id === activeShot.sceneId)
        if (!scene) return null
        if (activeShot.mediaType === 'video') {
          return (scene.video_shots || []).find(sh => sh.id === activeShot.shotId) || null
        }
        return scene.shots?.find(sh => sh.id === activeShot.shotId) || null
      })()
    : null

  // Frame-scoped data for dual-frame shots
  const activeFrameKey = activeShot?.frame // 'start' | 'end' | null
  const activeFrameNum = activeFrameKey === 'end' ? 2 : 1
  const isDualFrameEditing = activeShotData?.dual_frame && activeFrameKey

  const activeShotMediaType = activeShot?.mediaType || 'image'

  const frameScopedResults = useMemo(() => {
    if (!activeShotData) return []
    let results = activeShotData.results || []
    if (activeShotMediaType === 'video') {
      // Video shots only have video results, no frame filtering
      return results
    }
    if (isDualFrameEditing) {
      results = results.filter(r => (r.frame_number || 1) === activeFrameNum)
    }
    results = results.filter(r => r.is_image !== false)
    return results
  }, [activeShotData, isDualFrameEditing, activeFrameNum, activeShotMediaType])

  const frameScopedRanking = useMemo(() => {
    if (!activeShotData) return []
    if (activeShotMediaType === 'video') {
      return activeShotData.ranked_result_ids || []
    }
    if (!isDualFrameEditing) return activeShotData.ranked_result_ids || []
    return activeShotData.frames?.[activeFrameKey]?.ranked_result_ids || []
  }, [activeShotData, isDualFrameEditing, activeFrameKey, activeShotMediaType])

  const frameScopedGenState = isDualFrameEditing
    ? activeShotData?.frames?.[activeFrameKey]?.gen_state
    : activeShotData?.gen_state

  const handleShotResultDelete = useCallback((result) => {
    if (!activeShot) return
    if (activeShotMediaType === 'video') {
      removeResultFromVideoShot(activeShot.sceneId, activeShot.shotId, result.id)
    } else {
      removeResultFromShot(activeShot.sceneId, activeShot.shotId, result.id)
    }
  }, [activeShot, activeShotMediaType, removeResultFromShot, removeResultFromVideoShot])

  function handleToggleCollapse(sceneId) {
    const scene = project.scenes.find(s => s.id === sceneId)
    if (scene) updateScene(sceneId, { collapsed: !scene.collapsed })
  }

  function handleToggleSceneLock(sceneId) {
    const scene = project.scenes.find(s => s.id === sceneId)
    if (scene) updateScene(sceneId, { locked: !scene.locked })
  }

  function handleToggleShowVideos(sceneId) {
    const scene = project.scenes.find(s => s.id === sceneId)
    if (!scene) return
    const enabling = !scene.show_videos
    const updates = { show_videos: enabling }
    // Auto-create first video shot when enabling
    if (enabling && !(scene.video_shots || []).length) {
      addVideoShot(sceneId)
    }
    updateScene(sceneId, updates)
  }

  function handleToggleShowStoryboard(sceneId) {
    const scene = project.scenes.find(s => s.id === sceneId)
    if (!scene) return
    const enabling = scene.show_storyboard === false
    const updates = { show_storyboard: enabling }
    // Auto-create first shot when enabling
    if (enabling && !scene.shots.length) {
      addShot(sceneId)
    }
    updateScene(sceneId, updates)
  }

  function handleToggleShotLock(sceneId, shotId) {
    const scene = project.scenes.find(s => s.id === sceneId)
    const shot = scene?.shots.find(sh => sh.id === shotId)
    if (shot) updateShot(sceneId, shotId, { locked: !shot.locked })
  }

  function handleToggleVideoShotLock(sceneId, shotId) {
    const scene = project.scenes.find(s => s.id === sceneId)
    const shot = (scene?.video_shots || []).find(sh => sh.id === shotId)
    if (shot) updateVideoShot(sceneId, shotId, { locked: !shot.locked })
  }

  async function handleNewProject() {
    if (!projectName.trim()) return
    const proj = newProject(projectName.trim())
    setProjectName('')
    setShowNewInput(false)
    // Save immediately so it appears in the project list
    try {
      await apiSaveProject(proj.name, proj)
      refreshProjectList()
    } catch (e) {
      console.error('Save new project failed:', e)
    }
  }

  async function handleLoadProject(name) {
    setLoadingProjectName(name)
    try {
      await loadProject(name)
    } catch (e) {
      alert('Load failed: ' + e.message)
    } finally {
      setLoadingProjectName(null)
    }
  }

  async function handleDeleteProject(name) {
    try {
      await removeProject(name)
      setProjectList(prev => prev.filter(p => p.name !== name))
      setConfirmDelete(null)
    } catch (e) {
      alert('Delete failed: ' + e.message)
    }
  }

  async function handleCardAction() {
    if (!cardAction) return
    const { name, type, value } = cardAction
    const trimmed = (value || '').trim()
    if (!trimmed || trimmed === name) { setCardAction(null); return }
    setCardAction(null)
    try {
      if (type === 'rename') {
        setProjectList(prev => prev.map(p => p.name === name ? { ...p, name: trimmed } : p))
        // If renaming the active project, use the hook (saves dirty state + updates UI)
        if (project?.name === name) {
          await renameProject(name, trimmed)
        } else {
          await renameProjectApi(name, trimmed)
        }
      } else {
        setProjectList(prev => [{ name: trimmed, scene_count: 0, shot_count: 0, updated_at: new Date().toISOString() }, ...prev])
        await apiCopyProject(name, trimmed)
      }
      refreshProjectList()
    } catch (e) {
      alert(`${type === 'rename' ? 'Rename' : 'Save As'} failed: ${e.message}`)
      refreshProjectList()
    }
  }

  return (
    <div className="storyboard">
      {/* Backdrop to close sidebar */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Left sidebar for project management */}
      <div className={`project-sidebar ${sidebarOpen ? 'open' : ''}`}>
        {project && (
          <div className="sidebar-header">
            <input
              className="sidebar-project-name-input"
              value={sidebarName}
              onChange={e => setSidebarName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            />
            <div className="sidebar-status">
              {isDirty && <span className="dirty-indicator">Unsaved</span>}
              {saving && <span className="saving-indicator">Saving...</span>}
              {sidebarName.trim() && sidebarName.trim() !== project.name && <span className="rename-indicator">Name changed</span>}
            </div>
            <div className="sidebar-save-row" style={sidebarBusy ? { opacity: 0.5, pointerEvents: 'none', cursor: 'wait' } : undefined}>
              <button className="sidebar-btn" onClick={async () => {
                const trimmed = sidebarName.trim()
                if (!trimmed) return
                if (trimmed !== project.name) {
                  const oldName = project.name
                  setProjectList(prev => prev.map(p => p.name === oldName ? { ...p, name: trimmed } : p))
                  setSidebarBusy(true)
                  try { await renameProject(oldName, trimmed) } finally { setSidebarBusy(false) }
                  refreshProjectList()
                } else {
                  saveNow()
                }
              }}>Save</button>
              <button
                className="sidebar-btn sidebar-btn-secondary"
                style={sidebarName.trim() && sidebarName.trim() !== project.name ? undefined : { opacity: 0.4, pointerEvents: 'none' }}
                onClick={async () => {
                  const trimmed = sidebarName.trim()
                  if (!trimmed || trimmed === project.name) return
                  setProjectList(prev => [{ name: trimmed, scene_count: project.scenes?.length || 0, shot_count: 0, updated_at: new Date().toISOString() }, ...prev])
                  setSidebarBusy(true)
                  try { await saveAsProject(trimmed) } finally { setSidebarBusy(false) }
                  refreshProjectList()
                }}
              >Save As</button>
            </div>
            <div className="sidebar-team">
              <div className="sidebar-team-header">
                <span className="sidebar-team-label">Team</span>
                <button className="sidebar-btn-sm" title="Invite members (coming soon)" onClick={() => {}}>+ Invite</button>
              </div>
              <div className="sidebar-team-members">
                <div className="sidebar-team-member">
                  <div className="dashboard-avatar-sm">Y</div>
                  <span>You (Owner)</span>
                </div>
              </div>
            </div>
            <button className="sidebar-share-btn" title="Share project (coming soon)" onClick={() => {}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              Share Project
            </button>
          </div>
        )}

        <div className="sidebar-section">
          <div className="sidebar-section-title">Projects</div>
          <div className="sidebar-new-project">
            {showNewInput ? (
              <div className="sidebar-new-input">
                <input
                  type="text"
                  placeholder="Project name..."
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleNewProject()
                    if (e.key === 'Escape') setShowNewInput(false)
                  }}
                  autoFocus
                />
                <button className="sidebar-btn-sm" onClick={handleNewProject}>Create</button>
              </div>
            ) : (
              <button className="sidebar-btn" onClick={() => setShowNewInput(true)}>+ New Project</button>
            )}
          </div>
          <ul className="sidebar-project-list">
            {projectListLoading && !projectList.length ? (
              <li className="sidebar-empty">Loading...</li>
            ) : projectList.length === 0 ? (
              <li className="sidebar-empty">No projects</li>
            ) : projectList.map(p => (
              <li
                key={p.name}
                className={`sidebar-project-item ${project?.name === p.name ? 'active' : ''}`}
              >
                <div className="sidebar-project-info" onClick={() => handleLoadProject(p.name)}>
                  <span className="sidebar-project-item-name">{p.name}</span>
                  <span className="sidebar-project-meta">
                    {p.scene_count}s / {p.shot_count}sh
                  </span>
                </div>
                {confirmDelete === p.name ? (
                  <div className="sidebar-delete-confirm">
                    <button className="sidebar-btn-sm danger" onClick={() => handleDeleteProject(p.name)}>Yes</button>
                    <button className="sidebar-btn-sm" onClick={() => setConfirmDelete(null)}>No</button>
                  </div>
                ) : (
                  <button className="sidebar-item-delete" onClick={() => setConfirmDelete(p.name)}>
                    <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                      <line x1="2" y1="2" x2="8" y2="8" />
                      <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Float mode: backdrop only (ScriptPanel always mounted inside storyboard-content) */}
      {scriptOpen && scriptMode === 'float' && (
        <div className="script-backdrop" onClick={() => setScriptOpen(false)} />
      )}

      {/* Floating toolbar for view options (hidden in generation view) */}
      {view === 'timeline' && project && <div className="storyboard-toolbar">
        <button
          className="layout-toggle"
          onClick={toggleLayout}
          title={layout === 'horizontal' ? 'Switch to vertical' : 'Switch to horizontal'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            {layout === 'horizontal' ? (
              <>
                <rect x="1" y="4" width="4" height="8" rx="1" />
                <rect x="6" y="4" width="4" height="8" rx="1" />
                <rect x="11" y="4" width="4" height="8" rx="1" />
              </>
            ) : (
              <>
                <rect x="4" y="1" width="8" height="4" rx="1" />
                <rect x="4" y="6" width="8" height="4" rx="1" />
                <rect x="4" y="11" width="8" height="4" rx="1" />
              </>
            )}
          </svg>
        </button>

        {project && (
          <button
            className={`layout-toggle ${scriptOpen ? 'active' : ''}`}
            onClick={() => setScriptOpen(o => !o)}
            title="Script Panel"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 1H4a1.5 1.5 0 00-1.5 1.5v11A1.5 1.5 0 004 15h8a1.5 1.5 0 001.5-1.5V4.5L10 1z" />
              <polyline points="10 1 10 5 13.5 5" />
              <line x1="5.5" y1="8" x2="10.5" y2="8" />
              <line x1="5.5" y1="10.5" x2="10.5" y2="10.5" />
            </svg>
          </button>
        )}

        {project && (
          <button
            ref={soulboardBtnRef}
            className="layout-toggle"
            onClick={() => openSoulboard(soulboardBtnRef.current, { context: 'standalone' })}
            title="Open Soulboard"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="2" />
              <circle cx="8" cy="8" r="5" />
              <circle cx="8" cy="8" r="7" />
            </svg>
          </button>
        )}

        {project && (
          <button
            className="layout-toggle"
            onClick={() => setView('generate')}
            title="Generate"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11l-1.5-3.5L3 6l3.5-1.5z" />
              <path d="M12 10l.75 1.75L14.5 12.5l-1.75.75L12 15l-.75-1.75L9.5 12.5l1.75-.75z" />
            </svg>
          </button>
        )}

        {project && (
          <button
            className={`layout-toggle notes-toggle-btn ${notesVisible ? 'active' : ''}`}
            onClick={() => setNotesVisible(v => !v)}
            title={notesVisible ? 'Hide notes' : 'Show notes'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 1.5h10a1.5 1.5 0 011.5 1.5v8L11 14.5H3A1.5 1.5 0 011.5 13V3A1.5 1.5 0 013 1.5z" />
              <path d="M11 11v3.5L14.5 11H11z" />
            </svg>
            {Object.keys(canvasNotes).length > 0 && (
              <span className="notes-toggle-badge">{Object.keys(canvasNotes).length}</span>
            )}
          </button>
        )}
      </div>}

      {/* Main content wrapper (flex row for push-mode script panel) */}
      <div className="storyboard-content">
        <ScriptPanel
          mode={scriptMode}
          script={project?.project_state?.generated_scripts}
          onScriptChange={handleScriptChange}
          onModeChange={setScriptMode}
          onClose={() => setScriptOpen(false)}
          onGenerate={handleScriptGenerate}
          generating={scriptGenerating}
          thinkingText={scriptThinking}
          creativeMode={creativeMode}
          onCreativeModeChange={setCreativeMode}
          scrollId={project?.project_state?.script_scroll_id}
          onScrollIdChange={handleScriptScrollId}
          visible={scriptOpen}
        />

        <div className="storyboard-canvas">
          {/* Timeline stays mounted (hidden) to preserve image cache in DOM.
             Always show when no project so empty state is visible during view transitions. */}
          <div style={{ display: (view === 'timeline' || !project) ? 'contents' : 'none' }}>
            {project ? (
              <Timeline
                scenes={project.scenes}
                layout={layout}
                visible={view === 'timeline'}
                activeTasks={taskManager.taskMap}
                initialViewport={project.viewport}
                onViewportChange={handleViewportChange}
                onToggleCollapse={handleToggleCollapse}
                onSceneDescChange={(sceneId, desc) => updateScene(sceneId, { description: desc })}
                onShotClick={handleShotClick}
                onShotExplore={handleShotExplore}
                onShotDescChange={(sceneId, shotId, desc) => updateShot(sceneId, shotId, { description: desc })}
                onAddScene={addScene}
                onAddShot={addShot}
                onRemoveScene={handleRemoveScene}
                onRemoveShot={handleRemoveShot}
                onReorderScenes={reorderScenes}
                onReorderShots={reorderShots}
                onRankChange={updateRanking}
                onVideoRankChange={(sceneId, shotId, ids, frame) => updateRanking(sceneId, shotId, ids, frame, 'video')}
                onToggleSceneLock={handleToggleSceneLock}
                onToggleShowVideos={handleToggleShowVideos}
                onToggleShowStoryboard={handleToggleShowStoryboard}
                onToggleShotLock={handleToggleShotLock}
                onToggleVideoShotLock={handleToggleVideoShotLock}
                onToggleDualFrame={toggleDualFrame}
                onLightboxOpen={handleLightboxOpen}
                onRemoveResult={removeResultFromShot}
                onVideoShotClick={handleVideoShotClick}
                onImportFromStoryboard={handleImportFromStoryboard}
                onReorderVideoShots={reorderVideoShots}
                onAddVideoShot={addVideoShot}
                onRemoveVideoShot={handleRemoveVideoShot}
                onRemoveVideoResult={removeResultFromVideoShot}
                onVideoShotDescChange={(sceneId, shotId, desc) => updateVideoShot(sceneId, shotId, { description: desc })}
                characterItems={characterItems}
                onOpenCharacterGen={() => {
                  const newId = addCharacter('New Character')
                  setActiveCharacterId(newId)
                  setCharacterSubMode('turnaround')
                  setView('characters')
                }}
                onCharacterEdit={(charId) => {
                  setActiveCharacterId(charId)
                  setCharacterSubMode('turnaround')
                  setView('characters')
                }}
                onCharacterRename={renameCharacter}
                onCharacterItemClick={(item) => {
                  // Build flat list of all character images, tagged with character name + id
                  const allImages = characterItems.flatMap(c =>
                    [...(c.turnarounds || []), ...(c.variations || [])]
                      .filter(r => r.url)
                      .map(r => ({ url: r.url, provider: r.source, is_image: true, prompt: r.prompt, _charName: c.name, _charId: c.id }))
                  )
                  const clicked = allImages.find(r => r.url === item.url) || { url: item.url, provider: item.source, is_image: true, prompt: item.prompt }
                  handleLightboxOpen(clicked, allImages)
                }}
                onCharacterItemDelete={(charId) => handleRemoveCharacter(charId)}
                onCharacterReorder={reorderCharacters}
                supplementaryItems={supplementaryItems}
                onOpenSupplementaryGen={() => setView('supplementary')}
                onSupplementaryItemClick={(item) => handleLightboxOpen(
                  { url: item.url, provider: item.source, is_image: true, prompt: item.prompt },
                  supplementaryItems.map(i => ({ url: i.url, provider: i.source, is_image: true, prompt: i.prompt })),
                )}
                onSupplementaryItemDelete={(key) => handleRemoveSupplementaryItem(key)}
                onSupplementaryReorder={reorderSupplementary}
                onCharacterExplore={handleCharacterExplore}
                onSupplementaryExplore={handleSupplementaryExplore}
                canvasNotes={canvasNotes}
                notesVisible={notesVisible}
                onNoteAdd={handleAddNote}
                onNoteUpdate={handleUpdateNote}
                onNoteDelete={handleDeleteNote}
                characterLoading={generatingCharacters.size > 0}
                generatingCharacters={generatingCharacters}
                supplementaryLoading={generatingSupplementaryCount > 0}
                generatingSupplementaryCount={generatingSupplementaryCount}
                projectName={project?.name}
                projectState={project?.project_state}
                scriptOffset={scriptOpen && scriptMode === 'push' ? 480 : 0}
                audioTracks={project?.project_state?.generated_audio || []}
                onDeleteAudioTrack={deleteAudioTrack}
                editedVideos={project?.project_state?.edited_videos || []}
                onDeleteEditedVideo={deleteEditedVideo}
              />
            ) : loadingProjectName ? (
              <div className="login-page">
                <div className="login-bg">
                  <div className="login-orb login-orb-1" />
                  <div className="login-orb login-orb-2" />
                  <div className="login-orb login-orb-3" />
                </div>
                <div className="login-brand" style={{ position: 'relative', opacity: 0.6, animation: 'pulse 2s ease-in-out infinite' }}>FreeTitle AI</div>
              </div>
            ) : (
              <div className="dashboard">
                <div className="dashboard-bg">
                  <div className="login-orb login-orb-1" />
                  <div className="login-orb login-orb-2" />
                  <div className="login-orb login-orb-3" />
                </div>
                <div className="dashboard-content">
                  <div className="dashboard-top">
                    <div className="dashboard-brand">FreeTitle AI Studio</div>
                    <span className="dashboard-tier">Free Plan</span>
                  </div>

                  <div className="dashboard-stats">
                    <div className="dashboard-stat">
                      <span className="dashboard-stat-value">--</span>
                      <span className="dashboard-stat-label">Credits left</span>
                    </div>
                    <div className="dashboard-stat-divider" />
                    <div className="dashboard-stat">
                      <span className="dashboard-stat-value">--</span>
                      <span className="dashboard-stat-label">Used this month</span>
                    </div>
                    <div className="dashboard-stat-divider" />
                    <div className="dashboard-stat">
                      <span className="dashboard-stat-value">{projectList.length}</span>
                      <span className="dashboard-stat-label">Projects</span>
                    </div>
                    <div className="dashboard-stat-divider" />
                    <div className="dashboard-stat">
                      <span className="dashboard-stat-value">--</span>
                      <span className="dashboard-stat-label">Storage</span>
                    </div>
                  </div>

                  {projectList.length > 0 && !projectListLoading && (
                    <button className="dashboard-continue" onClick={() => handleLoadProject(projectList[0].name)}>
                      <span className="dashboard-continue-label">Continue</span>
                      <div className="dashboard-continue-card">
                        <div className="dashboard-preview">
                          {projectList[0].preview_urls?.slice(0, 8).map((url, i) => <img key={i} src={url} alt="" />)}
                        </div>
                        <div className="dashboard-continue-info">
                          <span className="dashboard-continue-name">{projectList[0].name}</span>
                          <span className="dashboard-continue-meta">{projectList[0].scene_count} scenes, {projectList[0].shot_count} shots</span>
                        </div>
                        <span className="dashboard-continue-time">{timeAgo(projectList[0].updated_at)}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  )}

                  <div className="dashboard-section-header">
                    <span className="dashboard-section-label">
                      {projectList.length > 0 ? 'All Projects' : 'Projects'}
                    </span>
                    {projectList.length > 3 && (
                      <div className="dashboard-controls">
                        <input
                          className="dashboard-search"
                          type="text"
                          placeholder="Search..."
                          value={dashboardSearch}
                          onChange={e => setDashboardSearch(e.target.value)}
                        />
                        <select className="dashboard-sort" value={dashboardSort} onChange={e => setDashboardSort(e.target.value)}>
                          <option value="recent">Recent</option>
                          <option value="name">Name</option>
                          <option value="shots">Most shots</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {projectListLoading && !projectList.length && (
                    <div className="dashboard-loading">Loading projects...</div>
                  )}

                  <div className="dashboard-grid">
                    {(dashboardShowAll ? filteredProjects : filteredProjects.slice(0, 6)).map(p => (
                      <div
                        key={p.name}
                        className={`dashboard-card ${confirmDelete === p.name ? 'confirming' : ''}`}
                        onClick={() => confirmDelete !== p.name && cardAction?.name !== p.name && handleLoadProject(p.name)}
                      >
                        {confirmDelete === p.name ? (
                          <div className="dashboard-card-confirm">
                            <p>Delete &ldquo;{p.name}&rdquo;?</p>
                            <div className="dashboard-card-confirm-actions">
                              <button onClick={e => { e.stopPropagation(); setConfirmDelete(null) }}>Cancel</button>
                              <button className="danger" onClick={e => { e.stopPropagation(); handleDeleteProject(p.name) }}>Delete</button>
                            </div>
                          </div>
                        ) : cardAction?.name === p.name ? (
                          <div className="dashboard-card-confirm" onClick={e => e.stopPropagation()}>
                            <p>{cardAction.type === 'rename' ? 'Rename' : 'Save As'}</p>
                            <input
                              className="dashboard-card-rename-input"
                              value={cardAction.value}
                              onChange={e => setCardAction(prev => ({ ...prev, value: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') handleCardAction(); if (e.key === 'Escape') setCardAction(null) }}
                              autoFocus
                              onClick={e => e.stopPropagation()}
                            />
                            <div className="dashboard-card-confirm-actions">
                              <button onClick={() => setCardAction(null)}>Cancel</button>
                              <button className="accent" onClick={handleCardAction}>{cardAction.type === 'rename' ? 'Rename' : 'Copy'}</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="dashboard-card-preview">
                              {p.preview_urls?.slice(0, 8).map((url, i) => <img key={i} src={url} alt="" />)}
                              <div className="dashboard-card-actions">
                                <button className="dashboard-card-action" title="Rename" onClick={e => { e.stopPropagation(); setCardAction({ name: p.name, type: 'rename', value: p.name }) }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z" />
                                  </svg>
                                </button>
                                <button className="dashboard-card-action" title="Save As Copy" onClick={e => { e.stopPropagation(); setCardAction({ name: p.name, type: 'copy', value: p.name + ' copy' }) }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" />
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                  </svg>
                                </button>
                                <button className="dashboard-card-action" title="Delete" onClick={e => { e.stopPropagation(); setConfirmDelete(p.name) }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <div className="dashboard-card-name">{p.name}</div>
                            <div className="dashboard-card-stats">
                              <span>{p.scene_count} scenes</span>
                              <span>{p.shot_count} shots</span>
                            </div>
                            <div className="dashboard-card-footer">
                              <div className="dashboard-card-team">
                                <div className="dashboard-avatar-sm" title="You">Y</div>
                              </div>
                              <span className="dashboard-card-time">{timeAgo(p.updated_at)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    ))}

                    <div className="dashboard-card dashboard-card-new" onClick={() => !showNewInput && setShowNewInput(true)}>
                      {showNewInput ? (
                        <div className="dashboard-new-form" onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            placeholder="Project name..."
                            value={projectName}
                            onChange={e => setProjectName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleNewProject()
                              if (e.key === 'Escape') { setShowNewInput(false); setProjectName('') }
                            }}
                            autoFocus
                          />
                          <div className="dashboard-new-actions">
                            <button className="dashboard-new-create" onClick={handleNewProject}>Create</button>
                            <button className="dashboard-new-cancel" onClick={() => { setShowNewInput(false); setProjectName('') }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                          <span>New Project</span>
                        </>
                      )}
                    </div>
                  </div>

                  {!dashboardShowAll && filteredProjects.length > 6 && (
                    <button className="dashboard-show-more" onClick={() => setDashboardShowAll(true)}>
                      Show all {filteredProjects.length} projects
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          {view === 'soulboard' ? (
            project && (
              <SoulboardView
                {...sb}
                projectName={project.name}
                projectState={project.project_state}
                projectScenes={project.scenes}
                context={soulboardContext?.context || 'standalone'}
                shotId={soulboardContext?.shotId}
                sceneId={soulboardContext?.sceneId}
                characterId={soulboardContext?.characterId}
                characters={characterItems}
                onFinalize={handleSoulboardFinalize}
                onClose={() => setView(soulboardContext?.returnView || (activeShot ? 'shot' : 'timeline'))}
              />
            )
          ) : view === 'generate' ? (
            <GenerationPanel
              mode="generate"
              tasks={standaloneGen.tasks}
              onSubmit={standaloneGen.submit}
              onResultComplete={handleStandaloneComplete}
              existingResults={standaloneResults.map(r => ({
                ...r, resultUrl: r.resultUrl || r.url, provider: r.provider, status: r.status || 'succeed',
              }))}
              rankedResultIds={standaloneRankedIds}
              onRankChange={(ids) => updateProjectState({ standalone_ranked_ids: ids })}
              onResultDelete={(task) => {
                const ps = project?.project_state || {}
                updateProjectState({
                  standalone_results: (ps.standalone_results || []).filter(r => r.id !== task.id),
                  standalone_ranked_ids: (ps.standalone_ranked_ids || []).filter(id => id !== task.id),
                })
              }}
              showSelected={false}
              showBackButton
              onBack={() => setView('timeline')}
              projectScenes={project?.scenes}
              projectState={project?.project_state}
              onSendToDestination={handleSendToDestination}
              onOpenSoulboard={(e) => openSoulboard(e.currentTarget, { context: 'standalone' })}
              projectName={project?.name}
            />
          ) : view === 'supplementary' ? (
            <GenerationPanel
              mode="supplementary"
              tasks={supplementaryGen.tasks}
              onSubmit={supplementaryGen.submit}
              onResultComplete={(result) => {
                addSupplementaryItems([{
                  url: result.url, source: result.provider,
                  prompt: result.prompt || '', config: result.config || {},
                  is_image: result.is_image !== false, timestamp: new Date().toISOString(),
                }])
              }}
              onResultDelete={(result) => removeSupplementaryItem(result.id)}
              onResultUpload={(result) => {
                addSupplementaryItems([{
                  url: result.url, source: result.provider || 'upload',
                  prompt: result.prompt || '', config: result.config || {},
                  is_image: result.is_image !== false, timestamp: new Date().toISOString(),
                }])
              }}
              existingResults={supplementaryItems.map(i => ({
                ...i, resultUrl: i.url, provider: i.source, status: 'succeed',
              }))}
              rankedResultIds={supplementaryItems.map(i => i.id)}
              onRankChange={(orderedIds) => reorderSupplementary(orderedIds)}
              showBackButton
              onBack={() => setView('timeline')}
              projectScenes={project?.scenes}
              projectState={project?.project_state}
              onSendToDestination={handleSendToDestination}
              onOpenSoulboard={(e) => openSoulboard(e.currentTarget, { context: 'standalone' })}
              projectName={project?.name}
            />
          ) : view === 'characters' ? (
            <GenerationPanel
              mode="character"
              tasks={characterGen.tasks}
              onSubmit={(providers, prompt, formState) =>
                characterGen.submit(providers, prompt, { ...formState, characterId: activeCharacterId })
              }
              onResultDelete={(result) => {
                if (!activeCharacterId) return
                removeCharacterResult(activeCharacterId, result.id, 'turnaround')
              }}
              onResultUpload={(result) => {
                if (!activeCharacterId) return
                const imageData = {
                  url: result.url, source: result.provider || 'upload',
                  prompt: result.prompt || '', config: result.config || {},
                  is_image: true, timestamp: new Date().toISOString(),
                }
                // Route based on stamped type or current toggle
                const type = result.config?.characterType || characterSubMode
                if (type === 'variation') addCharacterVariation(activeCharacterId, imageData)
                else addCharacterTurnaround(activeCharacterId, imageData)
              }}
              existingResults={activeCharacterTurnarounds}
              rankedResultIds={activeCharacterTurnaroundRankedIds}
              onRankChange={(ids) => {
                if (!activeCharacterId) return
                updateCharacterRanking(activeCharacterId, ids, 'turnaround')
              }}
              characterVariations={activeCharacterVariations}
              characterVariationRankedIds={activeCharacterVariationRankedIds}
              onVariationRankChange={(ids) => {
                if (!activeCharacterId) return
                updateCharacterRanking(activeCharacterId, ids, 'variation')
              }}
              onVariationDelete={(result) => {
                if (!activeCharacterId) return
                removeCharacterResult(activeCharacterId, result.id, 'variation')
              }}
              showBackButton
              onBack={() => setView('timeline')}
              projectScenes={project?.scenes}
              projectState={project?.project_state}
              onSendToDestination={handleSendToDestination}
              onOpenSoulboard={(e) => openSoulboard(e.currentTarget, { context: 'standalone' })}
              projectName={project?.name}
              characterName={activeCharacterData?.name || ''}
              onCharacterNameChange={(name) => activeCharacterId && renameCharacter(activeCharacterId, name)}
              characterSubMode={characterSubMode}
              onCharacterSubModeChange={setCharacterSubMode}
              activeCharacterData={activeCharacterData}
            />
          ) : view === 'shot' && project ? (
            <GenerationPanel
              mode="shot"
              mediaType={activeShotMediaType}
              tasks={taskManager.getTasksForShot(activeShot?.shotId)}
              onSubmit={(providers, prompt, formState) =>
                taskManager.submit(activeShot.sceneId, activeShot.shotId, providers, prompt, formState, isDualFrameEditing ? activeFrameNum : 1, activeShotMediaType === 'video')
              }
              initialState={frameScopedGenState}
              initialPrompt={activeShotData?.description || ''}
              onResultDelete={handleShotResultDelete}
              onStateChange={(genState) => {
                if (activeShotMediaType === 'video') {
                  updateVideoShot(activeShot.sceneId, activeShot.shotId, { gen_state: genState })
                } else if (isDualFrameEditing) {
                  updateShotFrameState(activeShot.sceneId, activeShot.shotId, activeFrameKey, genState)
                } else {
                  updateShot(activeShot.sceneId, activeShot.shotId, { gen_state: genState })
                }
              }}
              existingResults={frameScopedResults}
              rankedResultIds={frameScopedRanking}
              onRankChange={(rankedIds) => {
                if (activeShotMediaType === 'video') {
                  updateVideoShotRanking(activeShot.sceneId, activeShot.shotId, rankedIds)
                } else {
                  updateRanking(activeShot.sceneId, activeShot.shotId, rankedIds, isDualFrameEditing ? activeFrameKey : null)
                }
              }}
              showBackButton
              onBack={() => setView('timeline')}
              projectScenes={project?.scenes}
              currentShotId={activeShot?.shotId}
              projectState={project?.project_state}
              activeFrame={activeFrameKey}
              onFrameSwitch={(frame) => setActiveShot(prev => ({ ...prev, frame }))}
              onClearNew={(resultId) => {
                if (activeShotMediaType === 'video') clearVideoNewFlags(activeShot.sceneId, activeShot.shotId, resultId)
                else clearNewFlags(activeShot.sceneId, activeShot.shotId, resultId)
              }}
              onResultUpload={(result) => {
                const isVideo = activeShotMediaType === 'video'
                const computed = isVideo
                  ? addResultToVideoShot(activeShot.sceneId, activeShot.shotId, result)
                  : addResultToShot(activeShot.sceneId, activeShot.shotId, result, isDualFrameEditing ? activeFrameNum : 1)
                if (result.needsMigration && computed?.url && project?.name) {
                  const ext = computed.is_image !== false ? 'png' : 'mp4'
                  migrateFile(result.url, 'storyboard', project.name, `${computed.id}.${ext}`)
                    .then(({ url, thumb_url, medium_url }) => {
                      if (isVideo) updateResultUrlInVideoShot(activeShot.sceneId, activeShot.shotId, computed.id, url, thumb_url, medium_url)
                      else updateResultUrlInShot(activeShot.sceneId, activeShot.shotId, computed.id, url, thumb_url, medium_url)
                    })
                    .catch(e => console.error('Upload migration failed:', e))
                }
              }}
              shotSupplements={activeShot?.shotId ? Object.entries(project?.project_state?.shot_supplements?.[activeShot.shotId] || {}).map(([key, item]) => ({ ...item, _key: key })) : []}
              onRemoveShotSupplement={(key) => removeShotSupplementaryItem(activeShot.shotId, key)}
              onAddShotSupplement={(item) => addShotSupplementaryItems(activeShot.shotId, [item])}
              onSendToDestination={handleSendToDestination}
              onOpenSoulboard={(e) => {
                openSoulboard(e.currentTarget, { context: 'shot', sceneId: activeShot.sceneId, shotId: activeShot.shotId })
              }}
              projectName={project?.name}
            />
          ) : null}
        </div>
      </div>

      {lightbox && (
        <ResultLightbox
          item={lightbox}
          allItems={lightboxItems}
          onClose={() => setLightbox(null)}
          onItemChange={setLightbox}
          onOpenEditor={lightboxShot ? () => {
            setLightbox(null)
            handleShotClick(lightboxShot.sceneId, lightboxShot.shotId)
          } : undefined}
          onEditCharacter={lightbox._charId ? () => {
            const charId = lightbox._charId
            setLightbox(null)
            setActiveCharacterId(charId)
            setCharacterSubMode('turnaround')
            setView('characters')
          } : undefined}
        />
      )}

      {soulboardDropdown && (
        <SoulboardSessionDropdown
          projectName={project?.name}
          context={soulboardDropdown.context}
          shotId={soulboardDropdown.shotId}
          characterId={soulboardDropdown.characterId}
          scenes={project?.scenes || []}
          characters={characterItems}
          anchorEl={soulboardDropdown.anchorEl}
          onSelect={handleDropdownSelect}
          onNew={handleDropdownNew}
          onClose={() => setSoulboardDropdown(null)}
        />
      )}

      {trashOpen && (
        <TrashGallery
          items={project?.project_state?.trash || []}
          onRestore={handleTrashRestore}
          onDelete={handleTrashDelete}
          onClose={() => setTrashOpen(false)}
        />
      )}

      {project && view !== 'soulboard' && (
        <AgentChat
          messages={agentChat.messages}
          isLoading={agentChat.isLoading}
          isStreaming={agentChat.isStreaming}
          sendMessage={agentChat.sendMessage}
          stopStreaming={agentChat.stopStreaming}
          clearMessages={agentChat.clearMessages}
          editAndResend={agentChat.editAndResend}
          threads={agentChat.threads}
          activeThreadId={agentChat.activeThreadId}
          createThread={agentChat.createThread}
          switchThread={agentChat.switchThread}
          renameThread={agentChat.renameThread}
          hideThread={agentChat.hideThread}
          deleteThread={agentChat.deleteThread}
          projectName={project.name}
          projectState={project.project_state}
        />
      )}

      {project && view !== 'soulboard' && (
        <ActivityMonitor
          tasks={activityTasks}
          scenes={project?.scenes}
          characters={characterItems}
        />
      )}

    </div>
  )
}
