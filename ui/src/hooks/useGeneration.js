import { useState, useRef, useCallback, useEffect } from 'react'
import { generateForProvider, getTaskStatus } from '../services/api'

const POLL_INTERVAL = 2000
const TERMINAL_STATUSES = ['succeed', 'failed', 'timeout', 'error']

// Build request body for a given provider
export function buildRequestBody(provider, prompt, formState) {
  const { versions = 1 } = formState

  if (provider === 'veo') {
    return {
      prompt,
      aspect_ratio: formState.veoRatio || '16:9',
      size: formState.veoSize || '1080p',
      first_frame_url: formState.startFrameUrl || null,
      last_frame_url: formState.endFrameUrl || null,
      versions,
    }
  }

  // nano_banana
  return {
    prompt,
    aspect_ratio: formState.imageRatio || 'horizontal',
    image_size: formState.nanoSize || '2K',
    reference_images: formState.referenceImages?.length > 0 ? formState.referenceImages : null,
    versions,
  }
}

export default function useGeneration({ onComplete, projectName, projectType, updatePendingTasks } = {}) {
  const [tasks, setTasks] = useState([])
  const pollingRef = useRef(false)
  const tasksRef = useRef([])
  const cancelledRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const updatePendingRef = useRef(updatePendingTasks)
  updatePendingRef.current = updatePendingTasks

  // Reset on mount (StrictMode remount), stop on unmount
  useEffect(() => {
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  // Keep ref in sync so polling loop sees latest tasks
  const updateTasks = useCallback((updater) => {
    setTasks(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      tasksRef.current = next
      return next
    })
  }, [])

  // Persist non-terminal tasks to project_state (additive — multiple submits accumulate)
  const persistTasks = useCallback((taskList, source) => {
    if (!updatePendingRef.current) return
    const active = taskList.filter(t => !TERMINAL_STATUSES.includes(t.status))
    if (!active.length) return
    updatePendingRef.current(prev => [
      ...prev,
      ...active.map(t => ({ ...t, source })),
    ])
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
      const activeTasks = tasksRef.current.filter(t => !TERMINAL_STATUSES.includes(t.status) && t.status !== 'submitting')
      if (activeTasks.length === 0) break

      for (const task of activeTasks) {
        if (cancelledRef.current) break
        try {
          const data = await getTaskStatus(task.provider, task.taskId, { projectType, projectName })
          const resultUrl = data.gcs_url || null
          const isImage = task.provider === 'nano_banana'

          // Check before update so we can notify after
          const existing = tasksRef.current.find(t => t.taskId === task.taskId && t.provider === task.provider)
          const isNewCompletion = data.status === 'succeed' && resultUrl && existing && !existing.resultUrl

          updateTasks(prev => prev.map(t => {
            if (t.taskId !== task.taskId || t.provider !== task.provider) return t
            return { ...t, status: data.status, resultUrl, thumbUrl: data.thumb_url || null, mediumUrl: data.medium_url || null, error: data.error || null }
          }))

          // Remove from pending_tasks on terminal status
          if (TERMINAL_STATUSES.includes(data.status)) {
            removePendingTask(task.taskId, task.provider)
          }

          if (isNewCompletion) {
            onCompleteRef.current?.({
              url: resultUrl,
              thumb_url: data.thumb_url || null,
              medium_url: data.medium_url || null,
              result_id: data.result_id,
              provider: task.provider,
              version: task.version,
              is_image: isImage,
              prompt: task.prompt,
              config: task.config,
            })
          }

          // Promote failed/error/timeout tasks as error results
          const isNewFailure = TERMINAL_STATUSES.includes(data.status) && data.status !== 'succeed'
            && existing && !TERMINAL_STATUSES.includes(existing.status)
          if (isNewFailure) {
            onCompleteRef.current?.({
              url: null,
              provider: task.provider,
              version: task.version,
              is_image: isImage,
              prompt: task.prompt,
              config: task.config,
              status: data.status,
              error: data.error || 'Generation failed',
            })
          }
        } catch (err) {
          console.error('Poll error:', err)
        }
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL))
    }

    pollingRef.current = false
  }, [updateTasks, projectType, projectName, removePendingTask])

  const submit = useCallback(async (providers, prompt, formState) => {
    const providerList = Array.isArray(providers) ? providers : [providers]

    // Immediate UI feedback before API round-trip (one per provider per version)
    const numVersions = formState.versions || 1
    const placeholders = providerList.flatMap((p, pi) =>
      Array.from({ length: numVersions }, (_, vi) => ({
        provider: p,
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
    updateTasks(prev => [...placeholders, ...prev])

    const newTasks = []

    const results = await Promise.allSettled(
      providerList.map(async (provider) => {
        const body = buildRequestBody(provider, prompt, formState)
        if (projectType) body.project_type = projectType
        if (projectName) body.project_name = projectName
        const data = await generateForProvider(provider, body)

        if (!data.task_ids) throw new Error(`${provider} returned no task_ids`)

        data.task_ids.forEach((taskId, i) => {
          if (typeof taskId === 'object') {
            newTasks.push({
              provider,
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
              provider,
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

    updateTasks(prev => [...newTasks, ...prev.filter(t => t.status !== 'submitting')])

    // Notify parent of submit-time failures as error results
    for (const t of newTasks) {
      if (t.status === 'failed') {
        onCompleteRef.current?.({
          url: null,
          provider: t.provider,
          version: t.version,
          is_image: t.provider === 'nano_banana',
          prompt: t.prompt,
          config: t.config,
          status: 'failed',
          error: t.error || 'Generation failed',
        })
      }
    }

    // Persist non-failed tasks to project_state (source stamped by caller via formState._source)
    const source = formState._source || 'standalone'
    persistTasks(newTasks, source)

    // Start polling
    setTimeout(pollLoop, 1000)

    return { errors }
  }, [updateTasks, pollLoop, projectType, projectName, persistTasks])

  // Recover tasks from persisted pending_tasks (after page refresh)
  const recoverTasks = useCallback((pendingTasks) => {
    if (!pendingTasks?.length) return
    updateTasks(prev => [...pendingTasks, ...prev])
    setTimeout(pollLoop, 500)
  }, [updateTasks, pollLoop])

  const clearTasks = useCallback(() => {
    updateTasks([])
  }, [updateTasks])

  return { tasks, submit, clearTasks, recoverTasks }
}
