/**
 * Soulboard state management hook with multi-session support.
 * Lifted to Storyboard level so SSE streams persist across view changes.
 */
import { useState, useCallback, useRef, useMemo } from 'react'
import * as api from '../services/soulboardApi'

const STATUS = {
  IDLE: 'idle',
  STARTING: 'starting',
  GENERATING: 'generating',
  AWAITING_FEEDBACK: 'awaiting_feedback',
  FINALIZING: 'finalizing',
  FINALIZED: 'finalized',
  ERROR: 'error',
}

export { STATUS }

export default function useSoulboard(projectName) {
  const [status, setStatus] = useState(STATUS.IDLE)
  const [error, setError] = useState(null)
  const [iterations, setIterations] = useState([])
  const [initialQuery, setInitialQuery] = useState('')
  const [initialRefImages, setInitialRefImages] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [isReadOnly, setIsReadOnly] = useState(false)
  // Session's stored context from backend (persists across reloads)
  const [sessionContext, setSessionContext] = useState(null)
  const [sessionShotId, setSessionShotId] = useState(null)
  const [sessionCharacterId, setSessionCharacterId] = useState(null)
  const [preferences, setPreferences] = useState(null)

  // Transient thinking text (not persisted in iterations)
  const [thinkingText, setThinkingText] = useState('')

  const feedbackRef = useRef({})
  const feedbackTimerRef = useRef(null)
  const feedbackSnapshotRef = useRef({}) // item_id -> last known action ('liked'|'disliked'|null)
  const seenItemsRef = useRef(new Set())
  const pendingContextRef = useRef(null)
  const abortRef = useRef(null)
  const lastStartParamsRef = useRef(null)

  // --- SSE event handler ---
  const handleEvent = useCallback((data) => {
    const type = data.type

    if (type === 'art_director_thinking') {
      setThinkingText(prev => prev + data.text)
    } else if (type === 'iteration_started') {
      setStatus(STATUS.GENERATING)
      setError(null)
      setThinkingText('')
      const ctx = pendingContextRef.current
      pendingContextRef.current = null
      setIterations(prev => [
        ...prev,
        {
          number: data.iteration_number,
          reasoning: '',
          expectedItems: 0,
          completedItems: 0,
          failedItems: 0,
          items: [],
          done: false,
          userMessage: ctx?.message || null,
        },
      ])
    } else if (type === 'art_director_plan') {
      setThinkingText('')
      setIterations(prev => {
        const next = [...prev]
        const last = { ...next[next.length - 1] }
        last.reasoning = data.reasoning
        last.expectedItems = data.expected_items
        const placeholders = (data.planned_items || []).map((cfg, i) => ({
          item_id: `_ph_${Date.now()}_${i}`,
          _placeholder: true,
          source: cfg.source,
          aspect_ratio: cfg.aspect_ratio || 'vertical',
          metadata: { title: cfg.title || '', description: cfg.description || '' },
          content_url: null,
          feedback: null,
        }))
        last.items = [...last.items, ...placeholders]
        next[next.length - 1] = last
        return next
      })
    } else if (type === 'item_generated') {
      const item = data.item
      setIterations(prev => {
        const next = [...prev]
        const last = { ...next[next.length - 1] }
        const phIdx = last.items.findIndex(i => i._placeholder && i.source === item.source)
        if (phIdx !== -1) {
          last.items = [...last.items]
          last.items[phIdx] = item
        } else {
          last.items = [...last.items, item]
        }
        last.completedItems = last.completedItems + 1
        next[next.length - 1] = last
        return next
      })
    } else if (type === 'item_failed') {
      setIterations(prev => {
        const next = [...prev]
        const last = { ...next[next.length - 1] }
        if (data.source) {
          const phIdx = last.items.findIndex(i => i._placeholder && i.source === data.source)
          if (phIdx !== -1) {
            last.items = last.items.filter((_, i) => i !== phIdx)
          }
        }
        last.failedItems = last.failedItems + 1
        next[next.length - 1] = last
        return next
      })
    } else if (type === 'iteration_complete') {
      setStatus(STATUS.AWAITING_FEEDBACK)
      setIterations(prev => {
        const next = [...prev]
        const last = { ...next[next.length - 1] }
        last.done = true
        last.elapsed = data.elapsed_seconds
        last.items = last.items.filter(item => !item._placeholder)
        next[next.length - 1] = last
        return next
      })
      abortRef.current = null
    } else if (type === 'error') {
      setError(data.error)
      setIterations(prev => prev.map((iter, i) =>
        i === prev.length - 1
          ? { ...iter, items: iter.items.filter(item => !item._placeholder) }
          : iter
      ))
      setStatus(prev => prev === STATUS.GENERATING ? STATUS.AWAITING_FEEDBACK : prev === STATUS.STARTING ? STATUS.IDLE : prev)
      abortRef.current = null
    } else if (type === 'interrupted') {
      setStatus(STATUS.AWAITING_FEEDBACK)
      setIterations(prev => prev.map((iter, i) =>
        i === prev.length - 1
          ? { ...iter, items: iter.items.filter(item => !item._placeholder) }
          : iter
      ))
      abortRef.current = null
    }
  }, [])

  // --- Session management ---

  const loadSession = useCallback(async (sessionId) => {
    if (!projectName || !sessionId) return false
    try {
      const sbState = await api.getState(projectName, sessionId)
      if (!sbState || sbState.status === 'no_session') return false

      const serverIters = (sbState.iterations || []).map((iter, idx) => ({
        number: iter.iteration_number ?? idx + 1,
        reasoning: iter.art_director_reasoning || '',
        expectedItems: (iter.items || []).length,
        completedItems: (iter.items || []).length,
        failedItems: 0,
        items: [...(iter.items || [])].sort((a, b) =>
          (a.item_id || '').localeCompare(b.item_id || '', undefined, { numeric: true })
        ),
        done: true,
        userMessage: iter.user_message || null,
      }))

      setActiveSessionId(sessionId)
      setSessionContext(sbState.context || 'standalone')
      setSessionShotId(sbState.shot_id || null)
      setSessionCharacterId(sbState.character_id || null)
      setInitialQuery(sbState.session_config?.initial_query || '')
      setInitialRefImages(sbState.session_config?.reference_images || [])
      setPreferences(sbState.session_config?.preferences || null)
      setIterations(serverIters)
      setStatus(serverIters.length > 0 ? STATUS.AWAITING_FEEDBACK : STATUS.IDLE)
      setIsReadOnly(false)
      setError(null)
      feedbackRef.current = {}
      feedbackSnapshotRef.current = {}
      for (const iter of serverIters) {
        for (const item of iter.items) {
          if (item.feedback) feedbackSnapshotRef.current[item.item_id] = item.feedback
        }
      }
      return { loaded: true, context: sbState.context || 'standalone', shot_id: sbState.shot_id || null, character_id: sbState.character_id || null }
    } catch {
      return false
    }
  }, [projectName])

  const loadSessionReadOnly = useCallback(async (sessionId) => {
    const result = await loadSession(sessionId)
    if (result) setIsReadOnly(true)
    return result
  }, [loadSession])

  const createSession = useCallback(async (params = {}) => {
    if (!projectName) return null
    console.log('[Soulboard] createSession params:', JSON.stringify(params))
    const metadata = await api.createSession(projectName, params)
    // Clear stale state from any previous session
    setIterations([])
    setInitialQuery('')
    setInitialRefImages([])
    setPreferences(null)
    setStatus(STATUS.IDLE)
    setError(null)
    feedbackRef.current = {}
    feedbackSnapshotRef.current = {}
    pendingContextRef.current = null
    setActiveSessionId(metadata.id)
    setSessionContext(params.context || 'standalone')
    setSessionShotId(params.shot_id || null)
    setSessionCharacterId(params.character_id || null)
    setIsReadOnly(false)
    return metadata
  }, [projectName])

  const forkSession = useCallback(async (sourceSessionId, params = {}) => {
    if (!projectName) return null
    const result = await api.forkSession(projectName, sourceSessionId, params)
    setActiveSessionId(result.session_id)
    if (params.context) setSessionContext(params.context)
    if (params.shot_id !== undefined) setSessionShotId(params.shot_id || null)
    if (params.character_id !== undefined) setSessionCharacterId(params.character_id || null)
    setIsReadOnly(false)
    return result
  }, [projectName])

  // --- Actions ---

  const start = useCallback((query, preferences = {}, referenceImages = [], projectState = null, scenes = null) => {
    if (!activeSessionId || !projectName) return
    lastStartParamsRef.current = { query, preferences, referenceImages, projectState, scenes }
    setInitialQuery(query)
    setInitialRefImages(referenceImages)
    setStatus(STATUS.STARTING)
    setIterations([])
    setError(null)
    feedbackRef.current = {}
    feedbackSnapshotRef.current = {}

    const params = {
      query,
      preferences,
      reference_images: referenceImages,
      project_state: projectState,
    }
    if (scenes) params.scenes = scenes
    const controller = api.startIteration(projectName, activeSessionId, params, handleEvent)
    abortRef.current = controller
  }, [projectName, activeSessionId, handleEvent])

  const retry = useCallback(() => {
    const params = lastStartParamsRef.current
    if (!params) return
    start(params.query, params.preferences, params.referenceImages, params.projectState, params.scenes)
  }, [start])

  const generateMore = useCallback(async (message = null, referenceImages = [], newPrefs = {}, projectState = null, scenes = null) => {
    if (!activeSessionId || !projectName) return
    setStatus(STATUS.GENERATING)
    setPreferences(newPrefs)
    setInitialRefImages(referenceImages)
    await _submitPendingFeedback()
    pendingContextRef.current = { message }

    const params = {
      message,
      reference_images: referenceImages,
      preferences: newPrefs,
      project_state: projectState,
    }
    if (scenes) params.scenes = scenes
    const controller = api.iterateMore(projectName, activeSessionId, params, handleEvent)
    abortRef.current = controller
  }, [projectName, activeSessionId, handleEvent])

  const interrupt = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (projectName && activeSessionId) {
      api.interrupt(projectName, activeSessionId).catch(() => {})
    }
    setStatus(STATUS.AWAITING_FEEDBACK)
    setIterations(prev => prev.map((iter, i) =>
      i === prev.length - 1
        ? { ...iter, items: iter.items.filter(item => !item._placeholder) }
        : iter
    ))
  }, [projectName, activeSessionId])

  // Schedule a debounced feedback submit (1s after last change)
  const _scheduleFeedbackSubmit = () => {
    clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => _submitPendingFeedback(), 1000)
  }

  const toggleLike = useCallback((itemId) => {
    const current = feedbackRef.current[itemId]
    const isLiked = current
      ? current.action === 'liked'
      : feedbackSnapshotRef.current[itemId] === 'liked'
    const action = isLiked ? null : 'liked'
    feedbackRef.current[itemId] = { action, note: current?.note || null }
    feedbackSnapshotRef.current[itemId] = action
    _applyFeedbackToItems(itemId, action)
    _scheduleFeedbackSubmit()
  }, [])

  const toggleDislike = useCallback((itemId) => {
    const current = feedbackRef.current[itemId]
    const isDisliked = current
      ? current.action === 'disliked'
      : feedbackSnapshotRef.current[itemId] === 'disliked'
    const action = isDisliked ? null : 'disliked'
    feedbackRef.current[itemId] = { action, note: current?.note || null }
    feedbackSnapshotRef.current[itemId] = action
    _applyFeedbackToItems(itemId, action)
    _scheduleFeedbackSubmit()
  }, [])

  const setNote = useCallback((itemId, note) => {
    if (!feedbackRef.current[itemId]) {
      feedbackRef.current[itemId] = { action: feedbackSnapshotRef.current[itemId] || null, note }
    } else {
      feedbackRef.current[itemId].note = note
    }
    _applyNoteToItems(itemId, note)
    _scheduleFeedbackSubmit()
  }, [])

  const _applyFeedbackToItems = (itemId, action) => {
    setIterations(prev => prev.map(iter => ({
      ...iter,
      items: iter.items.map(item =>
        item.item_id === itemId ? { ...item, feedback: action } : item
      ),
    })))
  }

  const _applyNoteToItems = (itemId, note) => {
    setIterations(prev => prev.map(iter => ({
      ...iter,
      items: iter.items.map(item =>
        item.item_id === itemId ? { ...item, feedback_note: note } : item
      ),
    })))
  }

  const _submitPendingFeedback = async () => {
    const entries = Object.entries(feedbackRef.current)
    if (entries.length === 0 || !projectName || !activeSessionId) return
    const feedback = entries.map(([itemId, fb]) => ({
      item_id: itemId,
      action: fb.action,
      note: fb.note,
    }))
    try {
      await api.submitFeedback(projectName, activeSessionId, feedback)
      feedbackRef.current = {}
    } catch (e) {
      console.error('[Soulboard] Failed to submit feedback:', e)
    }
  }

  const doFinalize = useCallback(async (selectedIds, categories = {}) => {
    if (!activeSessionId || !projectName) return
    await _submitPendingFeedback()
    setStatus(STATUS.FINALIZING)
    try {
      const result = await api.finalize(projectName, activeSessionId, selectedIds, categories)
      setStatus(STATUS.AWAITING_FEEDBACK)
      return result
    } catch (e) {
      setError(e.message)
      setStatus(STATUS.AWAITING_FEEDBACK)
      throw e
    }
  }, [projectName, activeSessionId])

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    clearTimeout(feedbackTimerRef.current)
    setIterations([])
    setThinkingText('')
    setInitialQuery('')
    setInitialRefImages([])
    setActiveSessionId(null)
    setIsReadOnly(false)
    setSessionContext(null)
    setSessionShotId(null)
    setSessionCharacterId(null)
    setStatus(STATUS.IDLE)
    setError(null)
    feedbackRef.current = {}
    feedbackSnapshotRef.current = {}
    pendingContextRef.current = null
  }, [])

  const removeInitialRef = useCallback((index) => {
    setInitialRefImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const closeSession = useCallback(() => {
    // Close active session without aborting background generation
    setActiveSessionId(null)
    setIsReadOnly(false)
    setSessionContext(null)
    setSessionShotId(null)
    setSessionCharacterId(null)
  }, [])

  // --- Derived state ---
  const allItems = useMemo(() => {
    const items = []
    const lastIdx = iterations.length - 1
    for (let i = 0; i < iterations.length; i++) {
      for (const item of iterations[i].items) {
        // Tag items from the latest iteration as new (only when 2+ iterations, not yet seen)
        item._isNew = lastIdx > 0 && i === lastIdx && !seenItemsRef.current.has(item.item_id)
        items.push(item)
      }
    }
    return items
  }, [iterations])

  const likedItems = useMemo(() => {
    const items = []
    for (const iter of iterations) {
      for (const item of iter.items) {
        if (item.feedback === 'liked') items.push(item)
      }
    }
    return items
  }, [iterations])

  const currentIteration = iterations.length > 0 ? iterations[iterations.length - 1] : null

  const markSeen = useCallback((itemId) => {
    if (seenItemsRef.current.has(itemId)) return
    seenItemsRef.current.add(itemId)
    // Re-derive allItems to clear the dot
    setIterations(prev => [...prev])
  }, [])

  return {
    status, error, iterations, initialQuery, initialRefImages, preferences,
    allItems, likedItems, currentIteration, thinkingText,
    activeSessionId, isReadOnly, sessionContext, sessionShotId, sessionCharacterId,
    // Session management
    loadSession, loadSessionReadOnly, createSession, forkSession,
    closeSession, reset,
    // Actions
    start, retry, generateMore, interrupt, toggleLike, toggleDislike, setNote, markSeen, removeInitialRef,
    finalize: doFinalize,
    STATUS,
  }
}
