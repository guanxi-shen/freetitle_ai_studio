import { useState, useRef, useCallback, useEffect } from 'react'
import {
  saveGenerationProject,
  getGenerationProject,
  listGenerationProjects as apiListProjects,
  createGenerationProject,
  deleteGenerationProject,
} from '../services/api'

const DEFAULT_FORM_STATE = {
  nanoSize: '2K',
  veoSize: '1080p',
  veoRatio: '16:9',
  imageRatio: 'horizontal',
  referenceImages: [],
  startFrameUrl: null,
  endFrameUrl: null,
}

function createEmptyProject(name) {
  return {
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tab: 'image',
    prompt: '',
    versions: 1,
    providers: ['nano_banana'],
    form_state: { ...DEFAULT_FORM_STATE },
    input_images: {},
    results: [],
    ranked_result_ids: [],
  }
}

export default function useGenerationProject() {
  const [project, setProject] = useState(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const autoSaveTimer = useRef(null)

  // Auto-save with 3s debounce
  useEffect(() => {
    if (!isDirty || !project) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      doSave(project)
    }, 3000)
    return () => clearTimeout(autoSaveTimer.current)
  }, [isDirty, project])

  const doSave = useCallback(async (proj) => {
    if (!proj?.name) return
    setSaving(true)
    try {
      await saveGenerationProject(proj.name, { ...proj, updated_at: new Date().toISOString() })
      setIsDirty(false)
    } catch (err) {
      console.error('Auto-save failed:', err)
    }
    setSaving(false)
  }, [])

  const updateProject = useCallback((updater) => {
    setProject(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      return { ...next, updated_at: new Date().toISOString() }
    })
    setIsDirty(true)
  }, [])

  const newProject = useCallback((name) => {
    const proj = createEmptyProject(name)
    setProject(proj)
    setIsDirty(true)
    return proj
  }, [])

  const loadProject = useCallback(async (name) => {
    const data = await getGenerationProject(name)
    setProject(data)
    setIsDirty(false)
    return data
  }, [])

  const listAllProjects = useCallback(async () => {
    const data = await apiListProjects()
    return data.projects || []
  }, [])

  const removeProject = useCallback(async (name) => {
    await deleteGenerationProject(name)
  }, [])

  const saveNow = useCallback(async () => {
    if (project) await doSave(project)
  }, [project, doSave])

  const addResult = useCallback((result) => {
    updateProject(prev => {
      const id = result.id || crypto.randomUUID()
      return {
        ...prev,
        results: [...(prev.results || []), { ...result, id, timestamp: new Date().toISOString() }],
        ranked_result_ids: [id, ...(prev.ranked_result_ids || [])],
      }
    })
  }, [updateProject])

  const deleteResult = useCallback((resultId) => {
    updateProject(prev => ({
      ...prev,
      results: (prev.results || []).filter(r => r.id !== resultId),
      ranked_result_ids: (prev.ranked_result_ids || []).filter(id => id !== resultId),
    }))
  }, [updateProject])

  const setRankedResultIds = useCallback((ids) => {
    updateProject(prev => ({ ...prev, ranked_result_ids: ids }))
  }, [updateProject])

  const updateResultUrl = useCallback((resultId, newUrl, thumbUrl) => {
    updateProject(prev => ({
      ...prev,
      results: (prev.results || []).map(r =>
        (r.id === resultId || r.filename === resultId) ? { ...r, url: newUrl, thumb_url: thumbUrl } : r
      ),
    }))
  }, [updateProject])

  return {
    project,
    isDirty,
    saving,
    newProject,
    loadProject,
    listAllProjects,
    removeProject,
    saveNow,
    updateProject,
    addResult,
    deleteResult,
    setRankedResultIds,
    updateResultUrl,
  }
}
