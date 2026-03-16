import { useState, useRef, useCallback, useEffect } from 'react'
import { saveProject as apiSaveProject, getProject, listProjects as apiListProjects, deleteProject as apiDeleteProject, copyProject as apiCopyProject, renameProjectApi, migrateFile } from '../services/api'

function uuid() {
  return crypto.randomUUID()
}

function recomputeFilenames(scenes) {
  return scenes.map(s => ({
    ...s,
    shots: s.shots.map(sh => ({
      ...sh,
      results: sh.results.map(r => {
        const scn = String(s.scene_number).padStart(2, '0')
        const shn = String(sh.shot_number).padStart(2, '0')
        const isImage = r.is_image !== false
        const ext = isImage ? 'png' : 'mp4'
        const fr = r.frame_number || 1
        const ver = r.version_number || 1
        const filename = isImage
          ? `sc${scn}_sh${shn}_fr${fr}_v${ver}.${ext}`
          : `sc${scn}_sh${shn}_video_v${ver}.${ext}`
        return { ...r, scene_number: s.scene_number, shot_number: sh.shot_number, filename }
      }),
    })),
    video_shots: (s.video_shots || []).map(sh => ({
      ...sh,
      results: sh.results.map(r => {
        const scn = String(s.scene_number).padStart(2, '0')
        const shn = String(sh.shot_number).padStart(2, '0')
        const ver = r.version_number || 1
        const filename = `sc${scn}_vsh${shn}_video_v${ver}.mp4`
        return { ...r, scene_number: s.scene_number, shot_number: sh.shot_number, filename }
      }),
    })),
  }))
}

function renumberScenes(scenes) {
  const numbered = scenes.map((s, i) => ({
    ...s,
    scene_number: i + 1,
    shots: s.shots.map((sh, j) => ({ ...sh, shot_number: j + 1 })),
    video_shots: (s.video_shots || []).map((sh, j) => ({ ...sh, shot_number: j + 1 })),
  }))
  return recomputeFilenames(numbered)
}

function createShot(shotNumber, externalId) {
  return {
    id: externalId || uuid(),
    shot_number: shotNumber,
    original_shot_number: shotNumber,
    description: '',
    results: [],
    ranked_result_ids: [],
    video_ranked_result_ids: [],
    frame_metadata: {},
    next_image_version: 1,
    next_video_version: 1,
    locked: false,
    video_locked: false,
    gen_state: null,
    dual_frame: false,
    frames: {
      start: { ranked_result_ids: [], video_ranked_result_ids: [], gen_state: null, next_image_version: 1, next_video_version: 1 },
      end:   { ranked_result_ids: [], video_ranked_result_ids: [], gen_state: null, next_image_version: 1, next_video_version: 1 },
    },
  }
}

function createVideoShot(shotNumber, externalId) {
  return {
    id: externalId || uuid(),
    shot_number: shotNumber,
    description: '',
    results: [],
    ranked_result_ids: [],
    locked: false,
    gen_state: null,
    next_video_version: 1,
  }
}

function trashItem(url, thumbUrl, mediumUrl, source, data) {
  return {
    id: uuid(),
    url: url || null,
    thumb_url: thumbUrl || null,
    medium_url: mediumUrl || null,
    deleted_at: new Date().toISOString(),
    source,
    data,
  }
}

function createEmptyProject(name) {
  return {
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    scenes: [
      {
        id: uuid(),
        scene_number: 1,
        original_scene_number: 1,
        title: '',
        description: '',
        collapsed: false,
        locked: false,
        show_storyboard: true,
        show_videos: false,
        shots: [createShot(1)],
        video_shots: [],
      },
    ],
    layout: 'horizontal',
    viewport: null,
    video_viewport: null,
    agent_source: null,
    script_data: null,
    project_state: {
      generated_scripts: null,
      generated_characters: null,
      creative_mode: 'commercial',
      style_direction: '',
      production_notes: null,
      character_gallery: {},
      character_gallery_order: [],
      generated_supplementary: {},
      supplementary_order: [],
      shot_supplements: {},
      generated_storyboards: { storyboards: [] },
      trash: [],
      pending_tasks: [],
      generated_audio: [],
      edited_videos: [],
    },
  }
}

// Find primary image from a ranked list + results filtered by frame_number.
function findPrimary(results, rankedIds, frameNum, isImage) {
  const filtered = results.filter(r => (r.is_image !== false) === isImage && (r.frame_number || 1) === frameNum)
  if (rankedIds?.length) {
    const found = filtered.find(r => r.id === rankedIds[0])
    if (found) return found
  }
  return filtered[0] || null
}

// Derive storyboard schema from timeline scenes — primary frame + video per shot.
function buildStoryboards(scenes) {
  const storyboards = []
  for (const scene of scenes) {
    for (const shot of (scene.shots || [])) {
      const results = shot.results || []

      if (shot.dual_frame && shot.frames) {
        // Dual-frame: two frame entries
        const startRanked = shot.frames.start?.ranked_result_ids || []
        const endRanked = shot.frames.end?.ranked_result_ids || []
        const startImage = findPrimary(results, startRanked, 1, true)
        const endImage = findPrimary(results, endRanked, 2, true)
        const startVideo = findPrimary(results, startRanked, 1, false)

        const frames = []
        if (startImage) frames.push({ frame_number: 1, url: startImage.url, filename: startImage.filename, provider: startImage.provider, version: startImage.version_number })
        if (endImage) frames.push({ frame_number: 2, url: endImage.url, filename: endImage.filename, provider: endImage.provider, version: endImage.version_number })

        storyboards.push({
          scene_number: scene.scene_number,
          shot_number: shot.shot_number,
          dual_frame: true,
          frames,
          video: startVideo ? { url: startVideo.url, filename: startVideo.filename, provider: startVideo.provider, version: startVideo.version_number } : null,
          generated: frames.length > 0 || !!startVideo,
        })
      } else {
        // Single-frame
        const ranked = shot.ranked_result_ids || []
        const primaryImage = findPrimary(results, ranked, 1, true)
        const primaryVideo = findPrimary(results, ranked, 1, false)

        const frames = primaryImage ? [{
          frame_number: 1,
          url: primaryImage.url,
          filename: primaryImage.filename,
          provider: primaryImage.provider,
          version: primaryImage.version_number,
        }] : []

        storyboards.push({
          scene_number: scene.scene_number,
          shot_number: shot.shot_number,
          frames,
          video: primaryVideo ? { url: primaryVideo.url, filename: primaryVideo.filename, provider: primaryVideo.provider, version: primaryVideo.version_number } : null,
          generated: frames.length > 0 || !!primaryVideo,
        })
      }
    }
  }
  return { storyboards }
}

// Normalize a raw supplementary item (from any source) into a consistent asset shape.
function normalizeSupplementaryItem(raw) {
  return {
    url: raw.url || raw.content_url || '',
    thumb_url: raw.thumb_url || null,
    medium_url: raw.medium_url || null,
    source: raw.source || raw.provider || '',
    title: raw.title || '',
    description: raw.description || '',
    content_type: raw.content_type || raw.category || '',
    prompt: raw.prompt || '',
    aspect_ratio: raw.aspect_ratio || raw.config?.aspect_ratio || '',
    is_image: raw.is_image !== false,
    timestamp: raw.timestamp || '',
    soulboard_origin: raw.soulboard_origin || null,
  }
}

// Rebuild supplementary schema — normalize all items to consistent shape.
function buildSupplementary(generatedSupplementary, shotSupplements) {
  const items = {}
  for (const [key, raw] of Object.entries(generatedSupplementary || {})) {
    items[key] = normalizeSupplementaryItem(raw)
  }
  const shots = {}
  for (const [shotId, shotItems] of Object.entries(shotSupplements || {})) {
    const normalized = {}
    for (const [key, raw] of Object.entries(shotItems || {})) {
      normalized[key] = normalizeSupplementaryItem(raw)
    }
    if (Object.keys(normalized).length) shots[shotId] = normalized
  }
  return { items, shots }
}

const ACTIVE_PROJECT_KEY = 'active-project'

export default function useProject() {
  const [project, setProject] = useState(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const autoSaveTimer = useRef(null)
  const isLoading = useRef(false)
  const saveVersionRef = useRef(0)

  // Viewport stored as ref to avoid resetting auto-save timer on scroll
  const viewportRef = useRef(null)
  const videoViewportRef = useRef(null)
  const viewportDirtyRef = useRef(false)

  const projectRef = useRef(project)
  const isDirtyRef = useRef(isDirty)
  projectRef.current = project
  isDirtyRef.current = isDirty

  // Restore last active project on mount
  useEffect(() => {
    const name = localStorage.getItem(ACTIVE_PROJECT_KEY)
    if (!name) return
    isLoading.current = true
    getProject(name)
      .then(data => {
        viewportRef.current = data.viewport || null
        videoViewportRef.current = data.video_viewport || null
        setProject(data)
        setIsDirty(false)
      })
      .catch(() => localStorage.removeItem(ACTIVE_PROJECT_KEY))
      .finally(() => { isLoading.current = false })
  }, [])

  function buildSaveData(proj) {
    const data = viewportRef.current ? { ...proj, viewport: viewportRef.current } : { ...proj }
    if (videoViewportRef.current) data.video_viewport = videoViewportRef.current
    data.updated_at = new Date().toISOString()
    const ps = data.project_state || {}
    // Derive per-asset notes for agent consumption
    const notesByAsset = {}
    for (const note of Object.values(ps.canvas_notes || {})) {
      if (note.anchorId && ['shot', 'video-shot', 'character', 'supplement'].includes(note.anchor)) {
        if (!notesByAsset[note.anchorId]) notesByAsset[note.anchorId] = []
        notesByAsset[note.anchorId].push({ text: note.text, color: note.color })
      }
    }
    data.project_state = {
      ...ps,
      generated_storyboards: buildStoryboards(data.scenes || []),
      generated_supplementary_schema: buildSupplementary(ps.generated_supplementary, ps.shot_supplements),
      asset_notes: notesByAsset,
    }
    return data
  }

  // Guard against overlapping saves (e.g. manual save + auto-save timer firing together)
  const saveInFlight = useRef(false)

  const doSave = useCallback(async (proj) => {
    if (!proj?.name || saveInFlight.current) return
    saveInFlight.current = true
    const versionAtSave = saveVersionRef.current
    const data = buildSaveData(proj)
    setSaving(true)
    try {
      await apiSaveProject(proj.name, data)
      viewportDirtyRef.current = false
      if (saveVersionRef.current === versionAtSave) {
        setIsDirty(false)
      } else {
        // Edits happened during save — the isDirty useEffect won't re-fire
        // because isDirty stayed true the whole time. Schedule a retry.
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
        autoSaveTimer.current = setTimeout(() => {
          if (!isLoading.current) doSave(projectRef.current)
        }, 3000)
      }
    } catch (err) {
      console.error('Auto-save failed:', err)
    } finally {
      setSaving(false)
      saveInFlight.current = false
    }
  }, [])

  // Auto-save on dirty (skip while loading). Uses ref for latest state.
  // Depends only on isDirty so the timer starts from the first edit, not the last.
  useEffect(() => {
    if (!isDirty || !projectRef.current || isLoading.current) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      if (!isLoading.current) doSave(projectRef.current)
    }, 3000)
    return () => clearTimeout(autoSaveTimer.current)
  }, [isDirty])

  // Save when tab becomes hidden (covers tab switch, minimize, navigate away).
  // More reliable than sendBeacon for large projects (sendBeacon has ~64KB limit).
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden' && projectRef.current?.name) {
        if (isDirtyRef.current || viewportDirtyRef.current) {
          doSave(projectRef.current)
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [doSave])

  // Flush pending save on page unload (best-effort for small projects)
  useEffect(() => {
    function onBeforeUnload() {
      const proj = projectRef.current
      if (!proj?.name) return
      if (!isDirtyRef.current && !viewportDirtyRef.current) return
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      const data = buildSaveData(proj)
      navigator.sendBeacon(
        '/api/storyboard/projects',
        new Blob([JSON.stringify(data)], { type: 'application/json' })
      )
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const updateProject = useCallback((updater) => {
    setProject(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      return { ...next, updated_at: new Date().toISOString() }
    })
    saveVersionRef.current++
    setIsDirty(true)
  }, [])

  // Lightweight viewport update — ref only, no re-render, no auto-save reset
  const updateViewport = useCallback((viewport) => {
    viewportRef.current = viewport
    viewportDirtyRef.current = true
  }, [])

  const updateVideoViewport = useCallback((viewport) => {
    videoViewportRef.current = viewport
    viewportDirtyRef.current = true
  }, [])

  // CRUD operations
  const newProject = useCallback((name) => {
    const proj = createEmptyProject(name)
    setProject(proj)
    setIsDirty(true)
    localStorage.setItem(ACTIVE_PROJECT_KEY, name)
    return proj
  }, [])

  const closeProject = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setProject(null)
    setIsDirty(false)
    localStorage.removeItem(ACTIVE_PROJECT_KEY)
  }, [])

  const loadProject = useCallback(async (name) => {
    isLoading.current = true
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    try {
      const data = await getProject(name)
      viewportRef.current = data.viewport || null
      videoViewportRef.current = data.video_viewport || null
      viewportDirtyRef.current = false
      // Backward compat
      if (data.scenes) {
        for (const scene of data.scenes) {
          if (!scene.video_shots) scene.video_shots = []
          if (scene.show_storyboard === undefined) scene.show_storyboard = true
          for (const shot of scene.shots || []) {
            if (!shot.video_ranked_result_ids) shot.video_ranked_result_ids = []
            if (shot.frames) {
              if (!shot.frames.start?.video_ranked_result_ids) {
                shot.frames.start = { ...shot.frames.start, video_ranked_result_ids: [] }
              }
              if (!shot.frames.end?.video_ranked_result_ids) {
                shot.frames.end = { ...shot.frames.end, video_ranked_result_ids: [] }
              }
            }
          }
        }
      }
      // Backward compat: ensure pending_tasks exists
      if (!data.project_state) data.project_state = {}
      if (!data.project_state.pending_tasks) data.project_state.pending_tasks = []
      setProject(data)
      setIsDirty(false)
      localStorage.setItem(ACTIVE_PROJECT_KEY, name)
      return data
    } finally {
      isLoading.current = false
    }
  }, [])

  const listAllProjects = useCallback(async () => {
    const data = await apiListProjects()
    return data.projects || []
  }, [])

  const removeProject = useCallback(async (name) => {
    await apiDeleteProject(name)
  }, [])

  // Rename: save dirty state, then backend renames atomically and returns fresh signed data
  const renameProject = useCallback(async (oldName, newName) => {
    if (!newName.trim() || oldName === newName) return
    const proj = projectRef.current
    if (!proj || proj.name !== oldName) return
    const trimmed = newName.trim()
    // Show new name immediately
    setProject(prev => ({ ...prev, name: trimmed }))
    localStorage.setItem(ACTIVE_PROJECT_KEY, trimmed)
    try {
      // Save current state so backend has latest data to copy
      await apiSaveProject(oldName, buildSaveData(proj))
      // Backend: copy files + rewrite paths + delete old, returns signed project
      const data = await renameProjectApi(oldName, trimmed)
      setProject(data)
      setIsDirty(false)
    } catch (e) {
      console.error('Rename failed:', e)
      setProject(prev => ({ ...prev, name: oldName }))
      localStorage.setItem(ACTIVE_PROJECT_KEY, oldName)
    }
  }, [])

  // Save As (copy): save dirty state, backend copies and returns fresh signed data
  const saveAsProject = useCallback(async (newName) => {
    const proj = projectRef.current
    if (!proj) return
    const trimmed = (newName || '').trim()
    if (!trimmed || trimmed === proj.name) return doSave(proj)
    const oldName = proj.name
    // Show new name immediately
    setProject(prev => ({ ...prev, name: trimmed }))
    localStorage.setItem(ACTIVE_PROJECT_KEY, trimmed)
    try {
      await apiSaveProject(oldName, buildSaveData(proj))
      // Backend: copy files + rewrite paths, returns signed project
      const data = await apiCopyProject(oldName, trimmed)
      setProject(data)
      setIsDirty(false)
    } catch (e) {
      console.error('Save As failed:', e)
      setProject(prev => ({ ...prev, name: oldName }))
      localStorage.setItem(ACTIVE_PROJECT_KEY, oldName)
    }
  }, [doSave])

  const saveNow = useCallback(async () => {
    if (projectRef.current) {
      await doSave(projectRef.current)
    }
  }, [doSave])

  // Scene operations
  const addScene = useCallback(() => {
    updateProject(prev => {
      const num = prev.scenes.length + 1
      const scene = {
        id: uuid(),
        scene_number: num,
        original_scene_number: num,
        title: '',
        description: '',
        collapsed: false,
        locked: false,
        show_storyboard: true,
        show_videos: false,
        shots: [createShot(1)],
        video_shots: [],
      }
      return { ...prev, scenes: [...prev.scenes, scene] }
    })
  }, [updateProject])

  const removeScene = useCallback((sceneId) => {
    updateProject(prev => ({
      ...prev,
      scenes: renumberScenes(prev.scenes.filter(s => s.id !== sceneId)),
    }))
  }, [updateProject])

  const updateScene = useCallback((sceneId, updates) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, ...updates } : s),
    }))
  }, [updateProject])

  const reorderScenes = useCallback((fromIndex, toIndex) => {
    updateProject(prev => {
      const scenes = [...prev.scenes]
      const [moved] = scenes.splice(fromIndex, 1)
      scenes.splice(toIndex, 0, moved)
      return { ...prev, scenes: renumberScenes(scenes) }
    })
  }, [updateProject])

  // Shot operations
  const addShot = useCallback((sceneId) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        const num = s.shots.length + 1
        return { ...s, shots: [...s.shots, createShot(num)] }
      }),
    }))
  }, [updateProject])

  const removeShot = useCallback((sceneId, shotId) => {
    updateProject(prev => {
      const scenes = prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        const shots = s.shots.filter(sh => sh.id !== shotId).map((sh, i) => ({ ...sh, shot_number: i + 1 }))
        return { ...s, shots }
      })
      return { ...prev, scenes: recomputeFilenames(scenes) }
    })
  }, [updateProject])

  const updateShot = useCallback((sceneId, shotId, updates) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, ...updates } : sh),
        }
      }),
    }))
  }, [updateProject])

  const toggleDualFrame = useCallback((sceneId, shotId) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return {
          ...s,
          shots: s.shots.map(sh => {
            if (sh.id !== shotId) return sh
            const enabling = !sh.dual_frame
            if (enabling) {
              // Copy top-level state into frames.start
              return {
                ...sh,
                dual_frame: true,
                frames: {
                  start: {
                    ranked_result_ids: [...sh.ranked_result_ids],
                    video_ranked_result_ids: [...(sh.video_ranked_result_ids || [])],
                    gen_state: sh.gen_state,
                    next_image_version: sh.next_image_version,
                    next_video_version: sh.next_video_version,
                  },
                  end: { ranked_result_ids: [], video_ranked_result_ids: [], gen_state: null, next_image_version: 1, next_video_version: 1 },
                },
              }
            }
            // Disabling: merge back, reset end-frame results to frame_number 1
            const startFrame = sh.frames?.start || {}
            return {
              ...sh,
              dual_frame: false,
              ranked_result_ids: startFrame.ranked_result_ids || sh.ranked_result_ids,
              video_ranked_result_ids: startFrame.video_ranked_result_ids || sh.video_ranked_result_ids || [],
              gen_state: startFrame.gen_state || sh.gen_state,
              next_image_version: startFrame.next_image_version || sh.next_image_version,
              next_video_version: startFrame.next_video_version || sh.next_video_version,
              results: sh.results.map(r => r.frame_number === 2 ? { ...r, frame_number: 1 } : r),
            }
          }),
        }
      }),
    }))
  }, [updateProject])

  const updateShotFrameState = useCallback((sceneId, shotId, frame, genState) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return {
          ...s,
          shots: s.shots.map(sh => {
            if (sh.id !== shotId || !sh.frames) return sh
            return {
              ...sh,
              frames: { ...sh.frames, [frame]: { ...sh.frames[frame], gen_state: genState } },
            }
          }),
        }
      }),
    }))
  }, [updateProject])

  const reorderShots = useCallback((sceneId, fromIndex, toIndex) => {
    updateProject(prev => {
      const scenes = prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        const shots = [...s.shots]
        const [moved] = shots.splice(fromIndex, 1)
        shots.splice(toIndex, 0, moved)
        return { ...s, shots: shots.map((sh, i) => ({ ...sh, shot_number: i + 1 })) }
      })
      return { ...prev, scenes: recomputeFilenames(scenes) }
    })
  }, [updateProject])

  // Video shot operations
  const addVideoShot = useCallback((sceneId) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        const num = (s.video_shots || []).length + 1
        return { ...s, video_shots: [...(s.video_shots || []), createVideoShot(num)] }
      }),
    }))
  }, [updateProject])

  const removeVideoShot = useCallback((sceneId, shotId) => {
    updateProject(prev => {
      const scenes = prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        const filtered = (s.video_shots || []).filter(sh => sh.id !== shotId)
        return { ...s, video_shots: filtered.map((sh, i) => ({ ...sh, shot_number: i + 1 })) }
      })
      return { ...prev, scenes: recomputeFilenames(scenes) }
    })
  }, [updateProject])

  const updateVideoShot = useCallback((sceneId, shotId, updates) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return { ...s, video_shots: (s.video_shots || []).map(sh => sh.id === shotId ? { ...sh, ...updates } : sh) }
      }),
    }))
  }, [updateProject])

  const reorderVideoShots = useCallback((sceneId, fromIndex, toIndex) => {
    updateProject(prev => {
      const scenes = prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        const shots = [...(s.video_shots || [])]
        const [moved] = shots.splice(fromIndex, 1)
        shots.splice(toIndex, 0, moved)
        return { ...s, video_shots: shots.map((sh, i) => ({ ...sh, shot_number: i + 1 })) }
      })
      return { ...prev, scenes: recomputeFilenames(scenes) }
    })
  }, [updateProject])

  const addResultToVideoShot = useCallback((sceneId, shotId, result) => {
    let computedResult = null
    updateProject(prev => {
      const scene = prev.scenes.find(s => s.id === sceneId)
      const shot = (scene?.video_shots || []).find(sh => sh.id === shotId)
      if (!shot) return prev

      if (result.url && shot.results.some(r => r.url === result.url)) return prev

      const versionNum = shot.next_video_version || 1
      const scn = String(scene.scene_number).padStart(2, '0')
      const shn = String(shot.shot_number).padStart(2, '0')
      const filename = `sc${scn}_vsh${shn}_video_v${versionNum}.mp4`

      const newResult = {
        ...result,
        id: result.id || uuid(),
        is_image: false,
        scene_number: scene.scene_number,
        shot_number: shot.shot_number,
        frame_number: 1,
        version_number: versionNum,
        filename,
        isNew: true,
      }
      computedResult = newResult

      return {
        ...prev,
        scenes: prev.scenes.map(s => {
          if (s.id !== sceneId) return s
          return {
            ...s,
            video_shots: (s.video_shots || []).map(sh => {
              if (sh.id !== shotId) return sh
              const prevRanked = sh.ranked_result_ids || []
              return {
                ...sh,
                results: [...sh.results, newResult],
                ranked_result_ids: prevRanked.length > 0
                  ? [prevRanked[0], newResult.id, ...prevRanked.slice(1)]
                  : [newResult.id],
                next_video_version: versionNum + 1,
              }
            }),
          }
        }),
      }
    })
    return computedResult
  }, [updateProject])

  const removeResultFromVideoShot = useCallback((sceneId, shotId, resultId) => {
    updateProject(prev => {
      const scene = prev.scenes.find(s => s.id === sceneId)
      const shot = (scene?.video_shots || []).find(sh => sh.id === shotId)
      const result = shot?.results?.find(r => r.id === resultId)
      const trash = [...(prev.project_state?.trash || [])]
      if (result) trash.push(trashItem(result.url, result.thumb_url, result.medium_url, { type: 'video_shot', sceneId, shotId }, result))
      return {
        ...prev,
        project_state: { ...prev.project_state, trash },
        scenes: prev.scenes.map(s => {
          if (s.id !== sceneId) return s
          return {
            ...s,
            video_shots: (s.video_shots || []).map(sh => {
              if (sh.id !== shotId) return sh
              return {
                ...sh,
                results: sh.results.filter(r => r.id !== resultId),
                ranked_result_ids: (sh.ranked_result_ids || []).filter(id => id !== resultId),
              }
            }),
          }
        }),
      }
    })
  }, [updateProject])

  const updateResultUrlInVideoShot = useCallback((sceneId, shotId, resultId, newUrl, thumbUrl, mediumUrl) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return {
          ...s,
          video_shots: (s.video_shots || []).map(sh => {
            if (sh.id !== shotId) return sh
            return { ...sh, results: sh.results.map(r => r.id === resultId ? { ...r, url: newUrl, thumb_url: thumbUrl || r.thumb_url, medium_url: mediumUrl || r.medium_url } : r) }
          }),
        }
      }),
    }))
  }, [updateProject])

  const updateVideoShotRanking = useCallback((sceneId, shotId, rankedIds) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return {
          ...s,
          video_shots: (s.video_shots || []).map(sh => {
            if (sh.id !== shotId) return sh
            return {
              ...sh,
              ranked_result_ids: rankedIds,
              results: sh.results.map(r => r.isNew ? { ...r, isNew: false } : r),
            }
          }),
        }
      }),
    }))
  }, [updateProject])

  const clearVideoNewFlags = useCallback((sceneId, shotId, resultId) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return {
          ...s,
          video_shots: (s.video_shots || []).map(sh => {
            if (sh.id !== shotId) return sh
            const updated = sh.results.map(r => {
              if (!r.isNew) return r
              if (resultId && r.id !== resultId) return r
              return { ...r, isNew: false }
            })
            if (updated === sh.results) return sh
            return { ...sh, results: updated }
          }),
        }
      }),
    }))
  }, [updateProject])

  // Result operations
  const addResultToShot = useCallback((sceneId, shotId, result, frameNumber = 1) => {
    let computedResult = null

    // Sanitize: non-HTTPS URLs are likely transient provider URLs
    const sanitized = { ...result }
    if (sanitized.url && !sanitized.url.startsWith('https://')) {
      console.warn('[useProject] stripping non-HTTPS result URL:', sanitized.url?.split('/')[2])
      sanitized.url = null
    }
    if (sanitized.url === null || sanitized.url === '') {
      console.warn('[useProject] addResultToShot with empty URL:', shotId, 'frame:', frameNumber)
    }

    updateProject(prev => {
      const scene = prev.scenes.find(s => s.id === sceneId)
      const shot = scene?.shots.find(sh => sh.id === shotId)
      if (!shot) return prev

      // URL dedup: skip if this URL already exists for the same frame
      if (sanitized.url && shot.results.some(r => r.url === sanitized.url && (r.frame_number || 1) === frameNumber)) return prev

      const isImage = sanitized.is_image !== false
      const counterKey = isImage ? 'next_image_version' : 'next_video_version'
      const frameKey = frameNumber === 2 ? 'end' : 'start'

      return {
        ...prev,
        scenes: prev.scenes.map(s => {
          if (s.id !== sceneId) return s
          return {
            ...s,
            shots: s.shots.map(sh => {
              if (sh.id !== shotId) return sh

              const updated = { ...sh }

              // Auto-enable dual-frame when frame 2 result arrives on a single-frame shot
              if (frameNumber === 2 && !updated.dual_frame) {
                console.log('[useProject] auto-enabling dual-frame:', shotId)
                updated.dual_frame = true
                if (!updated.frames) {
                  updated.frames = {
                    start: {
                      ranked_result_ids: [...(sh.ranked_result_ids || [])],
                      video_ranked_result_ids: [...(sh.video_ranked_result_ids || [])],
                      gen_state: sh.gen_state,
                      next_image_version: sh.next_image_version,
                      next_video_version: sh.next_video_version,
                    },
                    end: { ranked_result_ids: [], video_ranked_result_ids: [], gen_state: null, next_image_version: 1, next_video_version: 1 },
                  }
                }
              }

              const effectiveDualFrame = updated.dual_frame && updated.frames

              // Version counter: per-frame when dual, top-level when single
              const versionNum = effectiveDualFrame
                ? (updated.frames[frameKey]?.[counterKey] || 1)
                : (sh[counterKey] || 1)

              const scn = String(scene.scene_number).padStart(2, '0')
              const shn = String(shot.shot_number).padStart(2, '0')
              const fr = frameNumber
              const ext = isImage ? 'png' : 'mp4'
              const filename = isImage
                ? `sc${scn}_sh${shn}_fr${fr}_v${versionNum}.${ext}`
                : `sc${scn}_sh${shn}_video_v${versionNum}.${ext}`

              const newResult = {
                ...sanitized,
                id: sanitized.id || uuid(),
                scene_number: scene.scene_number,
                shot_number: shot.shot_number,
                frame_number: frameNumber,
                version_number: versionNum,
                filename,
                isNew: true,
              }
              computedResult = newResult

              updated.results = [...sh.results, newResult]

              // Results with no valid URL go to end of ranking, never cover
              const hasValidUrl = !!newResult.url

              if (effectiveDualFrame) {
                const frame = { ...(updated.frames[frameKey] || {}) }
                const rankKey = isImage ? 'ranked_result_ids' : 'video_ranked_result_ids'
                const prevRanked = frame[rankKey] || []
                if (!hasValidUrl) {
                  // Failed result: append to end
                  frame[rankKey] = [...prevRanked, newResult.id]
                } else if (prevRanked.length > 0) {
                  // Check if current cover has a valid URL
                  const coverResult = sh.results.find(r => r.id === prevRanked[0])
                  if (coverResult && !coverResult.url) {
                    // Current cover is broken — promote new result to cover
                    frame[rankKey] = [newResult.id, ...prevRanked]
                  } else {
                    frame[rankKey] = [prevRanked[0], newResult.id, ...prevRanked.slice(1)]
                  }
                } else {
                  frame[rankKey] = [newResult.id]
                }
                frame[counterKey] = versionNum + 1
                updated.frames = { ...updated.frames, [frameKey]: frame }
              } else {
                const rankKey = isImage ? 'ranked_result_ids' : 'video_ranked_result_ids'
                const prevRanked = sh[rankKey] || []
                if (!hasValidUrl) {
                  updated[rankKey] = [...prevRanked, newResult.id]
                } else if (prevRanked.length > 0) {
                  const coverResult = sh.results.find(r => r.id === prevRanked[0])
                  if (coverResult && !coverResult.url) {
                    updated[rankKey] = [newResult.id, ...prevRanked]
                  } else {
                    updated[rankKey] = [prevRanked[0], newResult.id, ...prevRanked.slice(1)]
                  }
                } else {
                  updated[rankKey] = [newResult.id]
                }
                updated[counterKey] = versionNum + 1
              }

              return updated
            }),
          }
        }),
      }
    })
    return computedResult
  }, [updateProject])

  const removeResultFromShot = useCallback((sceneId, shotId, resultId) => {
    updateProject(prev => {
      const scene = prev.scenes.find(s => s.id === sceneId)
      const shot = scene?.shots?.find(sh => sh.id === shotId)
      const result = shot?.results?.find(r => r.id === resultId)
      const trash = [...(prev.project_state?.trash || [])]
      if (result) trash.push(trashItem(result.url, result.thumb_url, result.medium_url, { type: 'shot', sceneId, shotId }, result))
      return {
        ...prev,
        project_state: { ...prev.project_state, trash },
        scenes: prev.scenes.map(s => {
          if (s.id !== sceneId) return s
          return {
            ...s,
            shots: s.shots.map(sh => {
              if (sh.id !== shotId) return sh
              const updated = {
                ...sh,
                results: sh.results.filter(r => r.id !== resultId),
                ranked_result_ids: sh.ranked_result_ids.filter(id => id !== resultId),
                video_ranked_result_ids: (sh.video_ranked_result_ids || []).filter(id => id !== resultId),
              }
              if (sh.frames) {
                updated.frames = {
                  start: {
                    ...sh.frames.start,
                    ranked_result_ids: (sh.frames.start?.ranked_result_ids || []).filter(id => id !== resultId),
                    video_ranked_result_ids: (sh.frames.start?.video_ranked_result_ids || []).filter(id => id !== resultId),
                  },
                  end: {
                    ...sh.frames.end,
                    ranked_result_ids: (sh.frames.end?.ranked_result_ids || []).filter(id => id !== resultId),
                    video_ranked_result_ids: (sh.frames.end?.video_ranked_result_ids || []).filter(id => id !== resultId),
                  },
                }
              }
              return updated
            }),
          }
        }),
      }
    })
  }, [updateProject])

  const updateResultUrlInShot = useCallback((sceneId, shotId, resultId, newUrl, thumbUrl, mediumUrl) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return {
          ...s,
          shots: s.shots.map(sh => {
            if (sh.id !== shotId) return sh
            return {
              ...sh,
              results: sh.results.map(r => r.id === resultId ? { ...r, url: newUrl, thumb_url: thumbUrl || r.thumb_url, medium_url: mediumUrl || r.medium_url } : r),
            }
          }),
        }
      }),
    }))
  }, [updateProject])

  const updateRanking = useCallback((sceneId, shotId, rankedIds, frame = null, mediaType = 'image') => {
    const rankKey = mediaType === 'video' ? 'video_ranked_result_ids' : 'ranked_result_ids'
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        // Check video_shots for video lane reorder
        const inVideoShots = (s.video_shots || []).some(vs => vs.id === shotId)
        if (inVideoShots) {
          return {
            ...s,
            video_shots: s.video_shots.map(vs => {
              if (vs.id !== shotId) return vs
              return { ...vs, ranked_result_ids: rankedIds }
            }),
          }
        }
        return {
          ...s,
          shots: s.shots.map(sh => {
            if (sh.id !== shotId) return sh
            const updated = {
              ...sh,
              results: sh.results.map(r => r.isNew ? { ...r, isNew: false } : r),
            }
            if (frame && sh.frames) {
              updated.frames = { ...sh.frames, [frame]: { ...sh.frames[frame], [rankKey]: rankedIds } }
            } else {
              updated[rankKey] = rankedIds
            }
            return updated
          }),
        }
      }),
    }))
  }, [updateProject])

  // Clear isNew flag on results. If resultId given, clear just that one; otherwise clear all in the shot.
  const clearNewFlags = useCallback((sceneId, shotId, resultId) => {
    updateProject(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => {
        if (s.id !== sceneId) return s
        return {
          ...s,
          shots: s.shots.map(sh => {
            if (sh.id !== shotId) return sh
            const updated = sh.results.map(r => {
              if (!r.isNew) return r
              if (resultId && r.id !== resultId) return r
              return { ...r, isNew: false }
            })
            if (updated === sh.results) return sh
            return { ...sh, results: updated }
          }),
        }
      }),
    }))
  }, [updateProject])

  // Pending tasks helper — update pending_tasks array in project_state
  const updatePendingTasks = useCallback((updater) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const current = ps.pending_tasks || []
      const next = typeof updater === 'function' ? updater(current) : updater
      return { ...prev, project_state: { ...ps, pending_tasks: next } }
    })
  }, [updateProject])

  // ProjectState helpers
  const updateProjectState = useCallback((patch) => {
    updateProject(prev => ({
      ...prev,
      project_state: { ...(prev.project_state || {}), ...patch },
    }))
  }, [updateProject])

  const addCharacter = useCallback((name, charId) => {
    const key = charId || `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    updateProject(prev => {
      const ps = prev.project_state || {}
      const gallery = { ...(ps.character_gallery || {}) }
      const order = [...(ps.character_gallery_order || [])]
      gallery[key] = {
        name: name || 'New Character',
        turnarounds: [],
        turnaround_ranked_ids: [],
        variations: [],
        variation_ranked_ids: [],
      }
      if (!order.includes(key)) order.push(key)
      return { ...prev, project_state: { ...ps, character_gallery: gallery, character_gallery_order: order } }
    })
    return key
  }, [updateProject])

  const addCharacterTurnaround = useCallback((charId, data) => {
    const resultId = data.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const entry = { ...data, id: resultId, timestamp: data.timestamp || new Date().toISOString() }
    updateProject(prev => {
      const ps = prev.project_state || {}
      const gallery = { ...(ps.character_gallery || {}) }
      const char = gallery[charId]
      if (!char) return prev
      gallery[charId] = {
        ...char,
        turnarounds: [...char.turnarounds, entry],
        turnaround_ranked_ids: [resultId, ...char.turnaround_ranked_ids],
      }
      return { ...prev, project_state: { ...ps, character_gallery: gallery } }
    })
    // Migrate file to project storage
    if (data.url) {
      const projectName = projectRef.current?.name
      if (projectName) {
        migrateFile(data.url, 'storyboard', projectName, `char_${charId}_${resultId}.png`)
          .then(({ url: newUrl, thumb_url, medium_url }) => {
            updateProject(p => {
              const g = { ...(p.project_state?.character_gallery || {}) }
              const c = g[charId]
              if (!c) return p
              g[charId] = { ...c, turnarounds: c.turnarounds.map(t => t.id === resultId ? { ...t, url: newUrl, thumb_url: thumb_url || null, medium_url: medium_url || null } : t) }
              return { ...p, project_state: { ...p.project_state, character_gallery: g } }
            })
          })
          .catch(e => console.error('Character turnaround migration failed:', e))
      }
    }
    return resultId
  }, [updateProject])

  const addCharacterVariation = useCallback((charId, data) => {
    const resultId = data.id || `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const entry = { ...data, id: resultId, timestamp: data.timestamp || new Date().toISOString() }
    updateProject(prev => {
      const ps = prev.project_state || {}
      const gallery = { ...(ps.character_gallery || {}) }
      const char = gallery[charId]
      if (!char) return prev
      gallery[charId] = {
        ...char,
        variations: [...char.variations, entry],
        variation_ranked_ids: [resultId, ...char.variation_ranked_ids],
      }
      return { ...prev, project_state: { ...ps, character_gallery: gallery } }
    })
    if (data.url) {
      const projectName = projectRef.current?.name
      if (projectName) {
        migrateFile(data.url, 'storyboard', projectName, `char_${charId}_${resultId}.png`)
          .then(({ url: newUrl, thumb_url, medium_url }) => {
            updateProject(p => {
              const g = { ...(p.project_state?.character_gallery || {}) }
              const c = g[charId]
              if (!c) return p
              g[charId] = { ...c, variations: c.variations.map(v => v.id === resultId ? { ...v, url: newUrl, thumb_url: thumb_url || null, medium_url: medium_url || null } : v) }
              return { ...p, project_state: { ...p.project_state, character_gallery: g } }
            })
          })
          .catch(e => console.error('Character variation migration failed:', e))
      }
    }
    return resultId
  }, [updateProject])

  const removeCharacterResult = useCallback((charId, resultId, type) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const gallery = { ...(ps.character_gallery || {}) }
      const char = gallery[charId]
      if (!char) return prev
      const trash = [...(ps.trash || [])]
      const list = type === 'turnaround' ? char.turnarounds : char.variations
      const item = list.find(r => r.id === resultId)
      if (item) trash.push(trashItem(item.url, item.thumb_url, item.medium_url, { type: 'character_result', charId, resultType: type }, item))
      const rankedKey = type === 'turnaround' ? 'turnaround_ranked_ids' : 'variation_ranked_ids'
      const listKey = type === 'turnaround' ? 'turnarounds' : 'variations'
      gallery[charId] = {
        ...char,
        [listKey]: char[listKey].filter(r => r.id !== resultId),
        [rankedKey]: char[rankedKey].filter(id => id !== resultId),
      }
      return { ...prev, project_state: { ...ps, character_gallery: gallery, trash } }
    })
  }, [updateProject])

  const updateCharacterRanking = useCallback((charId, rankedIds, type) => {
    const rankedKey = type === 'turnaround' ? 'turnaround_ranked_ids' : 'variation_ranked_ids'
    updateProject(prev => {
      const ps = prev.project_state || {}
      const gallery = { ...(ps.character_gallery || {}) }
      const char = gallery[charId]
      if (!char) return prev
      gallery[charId] = { ...char, [rankedKey]: rankedIds }
      return { ...prev, project_state: { ...ps, character_gallery: gallery } }
    })
  }, [updateProject])

  const renameCharacter = useCallback((charId, name) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const gallery = { ...(ps.character_gallery || {}) }
      const char = gallery[charId]
      if (!char) return prev
      gallery[charId] = { ...char, name }
      return { ...prev, project_state: { ...ps, character_gallery: gallery } }
    })
  }, [updateProject])

  const removeCharacter = useCallback((charId) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const gallery = { ...(ps.character_gallery || {}) }
      const char = gallery[charId]
      const trash = [...(ps.trash || [])]
      if (char) {
        for (const t of (char.turnarounds || [])) trash.push(trashItem(t.url, t.thumb_url, t.medium_url, { type: 'character_result', charId, resultType: 'turnaround' }, t))
        for (const v of (char.variations || [])) trash.push(trashItem(v.url, v.thumb_url, v.medium_url, { type: 'character_result', charId, resultType: 'variation' }, v))
      }
      delete gallery[charId]
      const order = (ps.character_gallery_order || []).filter(k => k !== charId)
      return { ...prev, project_state: { ...ps, character_gallery: gallery, character_gallery_order: order, trash } }
    })
  }, [updateProject])

  const reorderCharacters = useCallback((orderedKeys) => {
    updateProject(prev => ({
      ...prev,
      project_state: { ...(prev.project_state || {}), character_gallery_order: orderedKeys },
    }))
  }, [updateProject])

  const addSupplementaryItems = useCallback((items) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const existing = { ...(ps.generated_supplementary || {}) }
      const order = [...(ps.supplementary_order || [])]
      const keysToMigrate = []
      for (const item of items) {
        const key = item.id || `sb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        existing[key] = item
        if (!order.includes(key)) order.push(key)
        if (item.url) keysToMigrate.push({ key, url: item.url })
      }
      // Migrate files to project storage in background
      const projectName = prev.name
      if (projectName) {
        for (const { key, url } of keysToMigrate) {
          migrateFile(url, 'storyboard', projectName, `supp_${key}.png`)
            .then(({ url: newUrl, thumb_url, medium_url }) => {
              updateProject(p => {
                const supp = { ...(p.project_state?.generated_supplementary || {}) }
                if (supp[key]) supp[key] = { ...supp[key], url: newUrl, content_url: newUrl, thumb_url: thumb_url || null, medium_url: medium_url || null }
                return { ...p, project_state: { ...p.project_state, generated_supplementary: supp } }
              })
            })
            .catch(e => console.error('Supplementary migration failed:', e))
        }
      }
      return {
        ...prev,
        project_state: { ...ps, generated_supplementary: existing, supplementary_order: order },
      }
    })
  }, [updateProject])

  const addShotSupplementaryItems = useCallback((shotId, items) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const shotSupps = { ...(ps.shot_supplements || {}) }
      const existing = { ...(shotSupps[shotId] || {}) }
      const keysToMigrate = []
      for (const item of items) {
        const key = item.id || `sb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        existing[key] = item
        if (item.url) keysToMigrate.push({ key, url: item.url })
      }
      shotSupps[shotId] = existing
      // Migrate files to project storage in background
      const projectName = prev.name
      if (projectName) {
        for (const { key, url } of keysToMigrate) {
          migrateFile(url, 'storyboard', projectName, `supp_${key}.png`)
            .then(({ url: newUrl, thumb_url, medium_url }) => {
              updateProject(p => {
                const ss = { ...(p.project_state?.shot_supplements || {}) }
                const items = { ...(ss[shotId] || {}) }
                if (items[key]) items[key] = { ...items[key], url: newUrl, content_url: newUrl, thumb_url: thumb_url || null, medium_url: medium_url || null }
                ss[shotId] = items
                return { ...p, project_state: { ...p.project_state, shot_supplements: ss } }
              })
            })
            .catch(e => console.error('Shot supplementary migration failed:', e))
        }
      }
      return {
        ...prev,
        project_state: { ...ps, shot_supplements: shotSupps },
      }
    })
  }, [updateProject])

  const removeSupplementaryItem = useCallback((itemKey) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const existing = { ...(ps.generated_supplementary || {}) }
      const item = existing[itemKey]
      const trash = [...(ps.trash || [])]
      if (item) trash.push(trashItem(item.url || item.content_url, item.thumb_url, item.medium_url, { type: 'supplementary', key: itemKey }, { ...item, _key: itemKey }))
      delete existing[itemKey]
      const order = (ps.supplementary_order || []).filter(k => k !== itemKey)
      return { ...prev, project_state: { ...ps, generated_supplementary: existing, supplementary_order: order, trash } }
    })
  }, [updateProject])

  const removeShotSupplementaryItem = useCallback((shotId, itemKey) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const shotSupps = { ...(ps.shot_supplements || {}) }
      const existing = { ...(shotSupps[shotId] || {}) }
      const item = existing[itemKey]
      const trash = [...(ps.trash || [])]
      if (item) trash.push(trashItem(item.url || item.content_url, item.thumb_url, item.medium_url, { type: 'shot_supplementary', shotId, key: itemKey }, { ...item, _key: itemKey }))
      delete existing[itemKey]
      shotSupps[shotId] = existing
      return { ...prev, project_state: { ...ps, shot_supplements: shotSupps, trash } }
    })
  }, [updateProject])

  const reorderSupplementary = useCallback((orderedKeys) => {
    updateProject(prev => ({
      ...prev,
      project_state: { ...(prev.project_state || {}), supplementary_order: orderedKeys },
    }))
  }, [updateProject])

  // Audio tracks -- generated by the creative agent's generate_audio FC tool
  const addAudioTrack = useCallback((track) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const tracks = [...(ps.generated_audio || []), track]
      return { ...prev, project_state: { ...ps, generated_audio: tracks } }
    })
  }, [updateProject])

  const deleteAudioTrack = useCallback((nameOrIndex) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const tracks = (ps.generated_audio || []).filter((t, i) =>
        typeof nameOrIndex === 'number' ? i !== nameOrIndex : t.name !== nameOrIndex
      )
      return { ...prev, project_state: { ...ps, generated_audio: tracks } }
    })
  }, [updateProject])

  // Edited videos -- produced by the creative agent's edit_video FC tool
  const addEditedVideo = useCallback((video) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const videos = [...(ps.edited_videos || []), video]
      return { ...prev, project_state: { ...ps, edited_videos: videos } }
    })
  }, [updateProject])

  const deleteEditedVideo = useCallback((nameOrIndex) => {
    updateProject(prev => {
      const ps = prev.project_state || {}
      const videos = (ps.edited_videos || []).filter((v, i) =>
        typeof nameOrIndex === 'number' ? i !== nameOrIndex : v.name !== nameOrIndex
      )
      return { ...prev, project_state: { ...ps, edited_videos: videos } }
    })
  }, [updateProject])

  const removeFromTrash = useCallback((ids) => {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids])
    updateProject(prev => ({
      ...prev,
      project_state: {
        ...(prev.project_state || {}),
        trash: (prev.project_state?.trash || []).filter(t => !idSet.has(t.id)),
      },
    }))
  }, [updateProject])

  const trashCount = project?.project_state?.trash?.length || 0

  // Apply batched operations from agent (auto-create scenes/shots/characters)
  const applyAgentOperations = useCallback((operations) => {
    updateProject(prev => {
      let scenes = [...(prev.scenes || [])]
      let ps = { ...(prev.project_state || {}) }

      for (const op of operations) {
        if (op.action === 'add_scene') {
          // Idempotency: skip if scene already exists (recovery after auto-save)
          if (scenes.some(s => s.id === op.sceneId)) continue
          const num = op.sceneNumber || scenes.length + 1
          const newScene = {
            id: op.sceneId, scene_number: num,
            original_scene_number: num,
            title: op.title || '', description: op.description || '',
            collapsed: false, locked: false,
            show_storyboard: true, show_videos: false,
            shots: [createShot(1, op.shotId)], video_shots: [],
          }
          // Insert at correct position by scene_number
          const insertIdx = scenes.findIndex(s => s.scene_number > num)
          if (insertIdx === -1) scenes.push(newScene)
          else scenes.splice(insertIdx, 0, newScene)
        }
        if (op.action === 'add_shot') {
          scenes = scenes.map(s => {
            if (s.id !== op.sceneId) return s
            // Idempotency: skip if shot already exists
            if (s.shots.some(sh => sh.id === op.shotId)) return s
            const num = s.shots.length + 1
            const shot = createShot(op.shotNumber || num, op.shotId)
            if (op.description) shot.description = op.description
            return { ...s, shots: [...s.shots, shot] }
          })
        }
        if (op.action === 'add_video_shot') {
          scenes = scenes.map(s => {
            if (s.id !== op.sceneId) return s
            // Idempotency: skip if video shot already exists
            if ((s.video_shots || []).some(vs => vs.id === op.shotId)) return s
            const num = (s.video_shots || []).length + 1
            const shot = createVideoShot(op.shotNumber || num, op.shotId)
            if (op.description) shot.description = op.description
            return { ...s, video_shots: [...(s.video_shots || []), shot] }
          })
        }
        if (op.action === 'update_scene') {
          scenes = scenes.map(s => s.id === op.sceneId ? { ...s, ...op.updates } : s)
        }
        if (op.action === 'update_shot') {
          scenes = scenes.map(s => {
            if (s.id !== op.sceneId) return s
            return { ...s, shots: s.shots.map(sh => sh.id === op.shotId ? { ...sh, ...op.updates } : sh) }
          })
        }
        if (op.action === 'add_character') {
          const gallery = { ...(ps.character_gallery || {}) }
          const order = [...(ps.character_gallery_order || [])]
          gallery[op.characterId] = {
            name: op.name || 'New Character',
            turnarounds: [], turnaround_ranked_ids: [],
            variations: [], variation_ranked_ids: [],
          }
          if (!order.includes(op.characterId)) order.push(op.characterId)
          ps = { ...ps, character_gallery: gallery, character_gallery_order: order }
        }
      }
      return { ...prev, scenes, project_state: ps }
    })
  }, [updateProject])

  return {
    project,
    setProject: updateProject,
    closeProject,
    isDirty,
    saving,
    newProject,
    loadProject,
    listAllProjects,
    removeProject,
    renameProject,
    saveAsProject,
    saveNow,
    addScene,
    removeScene,
    updateScene,
    reorderScenes,
    addShot,
    removeShot,
    updateShot,
    toggleDualFrame,
    updateShotFrameState,
    reorderShots,
    addVideoShot,
    removeVideoShot,
    updateVideoShot,
    reorderVideoShots,
    addResultToVideoShot,
    removeResultFromVideoShot,
    updateResultUrlInVideoShot,
    updateVideoShotRanking,
    clearVideoNewFlags,
    addResultToShot,
    removeResultFromShot,
    updateResultUrlInShot,
    updateRanking,
    updateViewport,
    updateVideoViewport,
    clearNewFlags,
    updateProjectState,
    updatePendingTasks,
    addCharacter,
    addCharacterTurnaround,
    addCharacterVariation,
    removeCharacterResult,
    updateCharacterRanking,
    renameCharacter,
    removeCharacter,
    reorderCharacters,
    addSupplementaryItems,
    removeSupplementaryItem,
    reorderSupplementary,
    addShotSupplementaryItems,
    removeShotSupplementaryItem,
    addAudioTrack,
    deleteAudioTrack,
    addEditedVideo,
    deleteEditedVideo,
    removeFromTrash,
    trashCount,
    applyAgentOperations,
  }
}
