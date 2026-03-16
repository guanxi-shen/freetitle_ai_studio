import { useState, useRef, useCallback, useEffect } from 'react'
import { generateForProvider, getTaskStatus } from '../services/api'
import { buildRequestBody } from './useGeneration'

const POLL_INTERVAL = 2000
const TERMINAL_STATUSES = ['succeed', 'failed', 'timeout', 'error']
const IMAGE_PROVIDERS = ['nano_banana']

export default function useTaskManager({ addResultToShot, updateResultUrlInShot, addResultToVideoShot, updateResultUrlInVideoShot, projectRef, updatePendingTasks }) {
  const [taskMap, setTaskMap] = useState({}) // { shotId: [task, ...] }
  const taskMapRef = useRef({})
  const pollingRef = useRef(false)
  const cancelledRef = useRef(false)
  const updatePendingRef = useRef(updatePendingTasks)
  updatePendingRef.current = updatePendingTasks

  useEffect(() => {
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  const updateTaskMap = useCallback((updater) => {
    setTaskMap(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      taskMapRef.current = next
      return next
    })
  }, [])

  // Remove a single task from pending_tasks
  const removePendingTask = useCallback((taskId, provider) => {
    if (!updatePendingRef.current) return
    updatePendingRef.current(prev => prev.filter(t => !(t.taskId === taskId && t.provider === provider)))
  }, [])

  const pollLoop = useCallback(async () => {
    if (pollingRef.current) return
    pollingRef.current = true

    while (!cancelledRef.current) {
      // Collect all non-terminal tasks across all shots
      const activeTasks = []
      const map = taskMapRef.current
      for (const shotId of Object.keys(map)) {
        for (const task of map[shotId]) {
          if (!TERMINAL_STATUSES.includes(task.status) && task.status !== 'submitting') {
            activeTasks.push(task)
          }
        }
      }
      if (activeTasks.length === 0) break

      for (const task of activeTasks) {
        if (cancelledRef.current) break
        try {
          const data = await getTaskStatus(task.provider, task.taskId, {
            projectType: 'storyboard',
            projectName: projectRef.current?.name,
          })
          const resultUrl = data.gcs_url || null

          // Check if this is a new completion before updating
          const current = taskMapRef.current[task.shotId]?.find(
            t => t.taskId === task.taskId && t.provider === task.provider
          )
          const isNewCompletion = data.status === 'succeed' && resultUrl && current && !current.resultUrl

          updateTaskMap(prev => {
            const shotTasks = prev[task.shotId]
            if (!shotTasks) return prev
            return {
              ...prev,
              [task.shotId]: shotTasks.map(t => {
                if (t.taskId !== task.taskId || t.provider !== task.provider) return t
                return { ...t, status: data.status, resultUrl, thumbUrl: data.thumb_url || null, mediumUrl: data.medium_url || null, error: data.error || null }
              }),
            }
          })

          // Remove from pending_tasks on terminal status
          if (TERMINAL_STATUSES.includes(data.status)) {
            console.log('[TaskManager] terminal:', task.taskId, data.status,
              resultUrl ? 'hasUrl' : 'noUrl',
              data.gcs_url ? 'hasGcsUrl' : 'noGcsUrl',
              isNewCompletion ? 'newCompletion' : '')
            removePendingTask(task.taskId, task.provider)
          }

          if (isNewCompletion) {
            const resultId = data.result_id || crypto.randomUUID()
            const isImage = IMAGE_PROVIDERS.includes(task.provider)
            // Warn on non-HTTPS URLs
            if (resultUrl && !resultUrl.startsWith('https://')) {
              console.warn('[TaskManager] non-HTTPS result URL:', task.taskId, resultUrl?.split('/')[2])
            }
            console.log('[TaskManager] addResultToShot:', task.sceneId, task.shotId, 'frame:', task.frameNumber || 1, 'urlOk:', !!resultUrl)

            const resultData = {
              url: resultUrl,
              thumb_url: data.thumb_url || null,
              medium_url: data.medium_url || null,
              provider: task.provider,
              version: task.version,
              is_image: isImage,
              prompt: task.prompt,
              config: task.config,
              id: resultId,
              timestamp: new Date().toISOString(),
            }

            if (task.isVideoShot) {
              addResultToVideoShot(task.sceneId, task.shotId, resultData)
            } else {
              addResultToShot(task.sceneId, task.shotId, resultData, task.frameNumber || 1)
            }
          }

          // Promote failed/error/timeout tasks as error results
          const isNewFailure = TERMINAL_STATUSES.includes(data.status) && data.status !== 'succeed'
            && current && !TERMINAL_STATUSES.includes(current.status)
          if (isNewFailure) {
            const errorResult = {
              url: null,
              provider: task.provider,
              version: task.version,
              is_image: IMAGE_PROVIDERS.includes(task.provider),
              prompt: task.prompt,
              config: task.config,
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              status: data.status,
              error: data.error || 'Generation failed',
            }
            if (task.isVideoShot) {
              addResultToVideoShot(task.sceneId, task.shotId, errorResult)
            } else {
              addResultToShot(task.sceneId, task.shotId, errorResult, task.frameNumber || 1)
            }
          }
        } catch (err) {
          console.error('Poll error:', err)
        }
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL))
    }

    pollingRef.current = false
  }, [updateTaskMap, addResultToShot, updateResultUrlInShot, addResultToVideoShot, updateResultUrlInVideoShot, projectRef, removePendingTask])

  const submit = useCallback(async (sceneId, shotId, providers, prompt, formState, frameNumber = 1, isVideoShot = false) => {
    const providerList = Array.isArray(providers) ? providers : [providers]

    // Immediate UI feedback before API round-trip (one per provider per version)
    const numVersions = formState.versions || 1
    const placeholders = providerList.flatMap((p, pi) =>
      Array.from({ length: numVersions }, (_, vi) => ({
        sceneId, shotId, frameNumber, provider: p, isVideoShot,
        taskId: `__placeholder_${Date.now()}_${pi}_${vi}`,
        version: vi + 1,
        status: 'submitting',
        error: null,
        resultUrl: null,
        startTime: Date.now(),
        prompt,
        config: { ...formState, providers: providerList },
      }))
    )
    updateTaskMap(prev => ({
      ...prev,
      [shotId]: [...placeholders, ...(prev[shotId] || [])],
    }))

    const newTasks = []

    const results = await Promise.allSettled(
      providerList.map(async (provider) => {
        const body = buildRequestBody(provider, prompt, formState)
        body.project_type = 'storyboard'
        body.project_name = projectRef.current?.name || ''
        const data = await generateForProvider(provider, body)

        if (!data.task_ids) throw new Error(`${provider} returned no task_ids`)

        data.task_ids.forEach((taskId, i) => {
          if (typeof taskId === 'object') {
            newTasks.push({
              sceneId, shotId, frameNumber, provider, isVideoShot,
              taskId: `error_${Date.now()}_${i}`,
              version: i + 1,
              status: 'failed',
              error: taskId.error,
              resultUrl: null,
              startTime: Date.now(),
              prompt,
              config: { ...formState, providers: providerList },
            })
          } else {
            newTasks.push({
              sceneId, shotId, frameNumber, provider, isVideoShot,
              taskId: String(taskId),
              version: i + 1,
              status: 'submitted',
              error: null,
              resultUrl: null,
              startTime: Date.now(),
              prompt,
              config: { ...formState, providers: providerList },
            })
          }
        })
      })
    )

    const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message)

    updateTaskMap(prev => ({
      ...prev,
      [shotId]: [...newTasks, ...(prev[shotId] || []).filter(t => t.status !== 'submitting')],
    }))

    // Promote submit-time failures as error results
    for (const t of newTasks) {
      if (t.status === 'failed') {
        const errorResult = {
          url: null, provider: t.provider, version: t.version,
          is_image: IMAGE_PROVIDERS.includes(t.provider),
          prompt: t.prompt, config: t.config,
          id: crypto.randomUUID(), timestamp: new Date().toISOString(),
          status: 'failed', error: t.error || 'Generation failed',
        }
        if (isVideoShot) addResultToVideoShot(sceneId, shotId, errorResult)
        else addResultToShot(sceneId, shotId, errorResult, frameNumber)
      }
    }

    // Persist non-failed tasks to project_state
    if (updatePendingRef.current) {
      const active = newTasks.filter(t => !TERMINAL_STATUSES.includes(t.status))
      const source = isVideoShot ? 'video_shot' : 'shot'
      updatePendingRef.current(prev => [
        ...prev,
        ...active.map(t => ({ ...t, source })),
      ])
    }

    // Start polling
    setTimeout(pollLoop, 1000)

    return { errors }
  }, [updateTaskMap, pollLoop])

  // Recover tasks from persisted pending_tasks (after page refresh)
  const recoverTasks = useCallback((pendingTasks) => {
    if (!pendingTasks?.length) return
    console.log('[TaskManager] recoverTasks:', pendingTasks.length, 'tasks', pendingTasks.map(t => `${t.taskId}@${t.shotId}`))
    const byShot = {}
    for (const task of pendingTasks) {
      const sid = task.shotId
      if (!byShot[sid]) byShot[sid] = []
      byShot[sid].push(task)
    }
    updateTaskMap(prev => {
      const next = { ...prev }
      for (const [shotId, tasks] of Object.entries(byShot)) {
        next[shotId] = [...tasks, ...(prev[shotId] || [])]
      }
      return next
    })
    setTimeout(pollLoop, 500)
  }, [updateTaskMap, pollLoop])

  const getTasksForShot = useCallback((shotId) => {
    return taskMap[shotId] || []
  }, [taskMap])

  return { taskMap, submit, getTasksForShot, recoverTasks }
}
