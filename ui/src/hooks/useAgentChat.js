import { useState, useCallback, useRef, useEffect } from 'react'
import { interruptChat, getAgentResults } from '../services/agentApi'
import {
  useChatSession, sendMessage as chatSendMessage, abortChat,
  buildConversationContents, loadSession, getSession, removeSession, updateSession,
  getAllSessionKeys,
} from '../chat'

/**
 * Agent chat hook -- manages the interleaved multimodal conversation.
 *
 * The agent streams text, thinking, tool calls (image/video/audio generation),
 * and inline images in a single SSE session. Messages and streaming are managed
 * by the shared ChatSessionStore -- streams survive component unmount and are
 * shared with InlineAssistant for scoped creative conversations.
 */
export default function useAgentChat({ projectName, projectState, scenes, updateProjectState, onStateChanged } = {}) {
  // Thread metadata (title, created_at, hidden) — lightweight, for sidebar rendering
  const [threadMeta, setThreadMeta] = useState({})
  const [activeThreadId, setActiveThreadId] = useState(null)
  const loadedProjectRef = useRef(null)
  const projectStateRef = useRef(projectState)
  projectStateRef.current = projectState
  const activeThreadIdRef = useRef(activeThreadId)
  activeThreadIdRef.current = activeThreadId
  const threadMetaRef = useRef(threadMeta)
  threadMetaRef.current = threadMeta

  // Read active thread's messages/loading from the shared store
  const activeSession = useChatSession(activeThreadId)
  const messages = activeSession.messages
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const isLoading = activeSession.isLoading
  const isStreaming = isLoading

  // Migrate raw Array format to wrapped thread format
  const migrateConversations = (convs) => {
    if (!convs || typeof convs !== 'object') return {}
    const meta = {}
    for (const [key, val] of Object.entries(convs)) {
      if (!key.startsWith('thread-')) continue // skip inline sessions
      if (Array.isArray(val)) {
        meta[key] = { title: val[0]?.content?.slice(0, 50) || 'Chat', created_at: val[0]?.timestamp || Date.now(), hidden: false }
        loadSession(key, { messages: val, title: meta[key].title, created_at: meta[key].created_at, hidden: false })
      } else if (val && typeof val === 'object' && Array.isArray(val.messages)) {
        meta[key] = { title: val.title || 'Chat', created_at: val.created_at || Date.now(), hidden: val.hidden || false }
        loadSession(key, { messages: val.messages, title: meta[key].title, created_at: meta[key].created_at, hidden: meta[key].hidden })
      }
    }
    return meta
  }

  const firstVisibleId = (metaObj) => {
    const visible = Object.entries(metaObj)
      .filter(([, m]) => !m.hidden)
      .sort((a, b) => (b[1].created_at || 0) - (a[1].created_at || 0))
    return visible[0]?.[0] || null
  }

  // Restore conversations from project_state on project load/switch
  useEffect(() => {
    if (!projectName) return
    if (loadedProjectRef.current === projectName) return
    loadedProjectRef.current = projectName

    const convs = projectState?.agent_conversations
    const migrated = migrateConversations(convs)
    setThreadMeta(migrated)
    threadMetaRef.current = migrated

    const firstId = firstVisibleId(migrated)
    if (firstId) {
      setActiveThreadId(firstId)
      activeThreadIdRef.current = firstId
    } else {
      const id = `thread-${Date.now()}`
      const meta = { title: 'New chat', created_at: Date.now(), hidden: false }
      loadSession(id, { messages: [], ...meta })
      const updated = { ...migrated, [id]: meta }
      setThreadMeta(updated)
      threadMetaRef.current = updated
      setActiveThreadId(id)
      activeThreadIdRef.current = id
    }

    // Also load any inline sessions from agent_conversations
    if (convs) {
      const inlineKeys = Object.keys(convs).filter(k => !k.startsWith('thread-'))
      console.log('[AgentChat] loading inline sessions:', inlineKeys.length, inlineKeys)
      for (const [key, val] of Object.entries(convs)) {
        if (!key.startsWith('thread-') && val?.messages?.length) {
          console.log('[AgentChat] loadSession:', key, 'msgs=', val.messages.length, 'seen=', val.seen)
          loadSession(key, { messages: val.messages, seen: val.seen || false })
        }
      }
    }
  }, [projectName]) // Only react to project name changes

  // Recover agent results from GCS after page refresh
  useEffect(() => {
    if (!projectName) return
    const timer = setTimeout(async () => {
      let results
      try { results = await getAgentResults(projectName) } catch { return }
      if (!results || !Object.keys(results).length) return

      for (const [threadId, result] of Object.entries(results)) {
        const session = getSession(threadId)
        if (!session?.messages?.length) continue
        const lastMsg = session.messages[session.messages.length - 1]
        const needsRecovery = lastMsg.role === 'user' ||
          (lastMsg.role === 'agent' && !lastMsg.content)
        if (!needsRecovery) continue
        const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
        if (lastUserMsg && result.timestamp * 1000 < lastUserMsg.timestamp) continue

        const agentMsg = lastMsg.role === 'agent'
          ? { ...lastMsg }
          : { id: `msg-recovery-${Date.now()}`, role: 'agent', timestamp: Date.now() }
        agentMsg.content = result.text || ''
        agentMsg.thinking = result.thinking || ''
        agentMsg.tool_calls = result.tool_calls || []
        agentMsg.contents_history = result.contents_history || []

        const newMsgs = lastMsg.role === 'agent'
          ? session.messages.map(m => m.id === lastMsg.id ? agentMsg : m)
          : [...session.messages, agentMsg]

        updateSession(threadId, s => ({ ...s, messages: newMsgs }))
        persistThread(threadId, newMsgs)

        if (result.state_changes?.length && onStateChanged) {
          const pendingIds = new Set(
            (projectStateRef.current?.pending_tasks || []).map(t => t.taskId)
          )
          for (const sc of result.state_changes) {
            if (sc.change === 'task_submitted' && pendingIds.has(sc.taskId)) continue
            onStateChanged(sc)
          }
        }
        console.debug('[AgentChat] Recovered result for thread', threadId)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [projectName])

  // Persist a single thread to project_state
  const persistThread = useCallback((threadId, msgs, extraMeta) => {
    if (!updateProjectState) return
    const meta = threadMetaRef.current[threadId] || {}
    const capped = (msgs || []).slice(-50)
    const current = projectStateRef.current?.agent_conversations || {}
    updateProjectState({ agent_conversations: { ...current, [threadId]: { ...meta, ...extraMeta, messages: capped } } })
  }, [updateProjectState])

  // Persist all threads (for structural changes like create/delete/hide/rename)
  const persistAllThreads = useCallback((metaOverride) => {
    if (!updateProjectState) return
    const meta = metaOverride || threadMetaRef.current
    const all = {}
    for (const [id, m] of Object.entries(meta)) {
      const session = getSession(id)
      all[id] = { ...m, messages: (session?.messages || []).slice(-50) }
    }
    // Preserve inline sessions
    for (const key of getAllSessionKeys()) {
      if (!all[key]) {
        const session = getSession(key)
        if (session?.messages?.length) {
          const data = { messages: session.messages.slice(-50) }
          if (session.seen) data.seen = true
          all[key] = data
        }
      }
    }
    updateProjectState({ agent_conversations: all })
  }, [updateProjectState])

  const createThread = useCallback(() => {
    if (isStreaming) return null
    const id = `thread-${Date.now()}`
    const meta = { title: 'New chat', created_at: Date.now(), hidden: false }
    loadSession(id, { messages: [], ...meta })
    let result
    setThreadMeta(prev => {
      result = { ...prev, [id]: meta }
      threadMetaRef.current = result
      return result
    })
    persistAllThreads(result)
    setActiveThreadId(id)
    activeThreadIdRef.current = id
    return id
  }, [isStreaming, persistAllThreads])

  const switchThread = useCallback((id) => {
    if (isStreaming) return
    setActiveThreadId(id)
    activeThreadIdRef.current = id
  }, [isStreaming])

  const renameThread = useCallback((id, title) => {
    let result
    setThreadMeta(prev => {
      if (!prev[id]) return prev
      result = { ...prev, [id]: { ...prev[id], title } }
      threadMetaRef.current = result
      return result
    })
    updateSession(id, s => ({ ...s, title }))
    if (result) persistAllThreads(result)
  }, [persistAllThreads])

  const hideThread = useCallback((id) => {
    let result
    setThreadMeta(prev => {
      result = { ...prev, [id]: { ...prev[id], hidden: true } }
      threadMetaRef.current = result

      if (id === activeThreadIdRef.current) {
        const nextVisible = firstVisibleId(result)
        if (nextVisible) {
          setActiveThreadId(nextVisible)
          activeThreadIdRef.current = nextVisible
        } else {
          const newId = `thread-${Date.now()}`
          const meta = { title: 'New chat', created_at: Date.now(), hidden: false }
          loadSession(newId, { messages: [], ...meta })
          result[newId] = meta
          setActiveThreadId(newId)
          activeThreadIdRef.current = newId
        }
      }
      return result
    })
    updateSession(id, s => ({ ...s, hidden: true }))
    if (result) persistAllThreads(result)
  }, [persistAllThreads])

  const deleteThread = useCallback((id) => {
    removeSession(id)
    let result
    setThreadMeta(prev => {
      const { [id]: _, ...rest } = prev
      result = rest

      if (id === activeThreadIdRef.current) {
        const nextVisible = firstVisibleId(result)
        if (nextVisible) {
          setActiveThreadId(nextVisible)
          activeThreadIdRef.current = nextVisible
        } else {
          const newId = `thread-${Date.now()}`
          const meta = { title: 'New chat', created_at: Date.now(), hidden: false }
          loadSession(newId, { messages: [], ...meta })
          result[newId] = meta
          setActiveThreadId(newId)
          activeThreadIdRef.current = newId
        }
      }
      threadMetaRef.current = result
      return result
    })
    if (result) persistAllThreads(result)
  }, [persistAllThreads])

  const revertToMessage = useCallback((msgId) => {
    const threadId = activeThreadIdRef.current
    if (!threadId) return
    const session = getSession(threadId)
    if (!session) return
    const idx = session.messages.findIndex(m => m.id === msgId)
    if (idx < 0) return
    const truncated = session.messages.slice(0, idx + 1)
    updateSession(threadId, s => ({ ...s, messages: truncated }))
    persistThread(threadId, truncated)
  }, [persistThread])

  const sendMessage = useCallback((text) => {
    if (!text.trim() || isLoading) return
    const threadId = activeThreadIdRef.current
    if (!threadId || !getSession(threadId)) return

    // Build conversation history from prior messages
    const conversationContents = buildConversationContents(messagesRef.current)
    const conversation = messagesRef.current.map(m => ({ role: m.role, content: m.content }))

    // Auto-title on first message
    const session = getSession(threadId)
    if (session.messages.length === 0) {
      const title = text.trim().slice(0, 50)
      setThreadMeta(prev => {
        const result = { ...prev, [threadId]: { ...prev[threadId], title } }
        threadMetaRef.current = result
        return result
      })
      updateSession(threadId, s => ({ ...s, title }))
    }

    // Persist user message immediately (survives page refresh mid-generation)
    persistThread(threadId, [...messagesRef.current, { id: 'pending-user', role: 'user', content: text.trim(), timestamp: Date.now() }])

    // Strip UI-internal fields
    let ps = projectState
    if (ps) {
      const { trash, pending_tasks, ...rest } = ps
      ps = rest
    }

    const body = {
      message: text.trim(),
      conversation_contents: conversationContents.length > 0 ? conversationContents : undefined,
      conversation: conversation.length > 0 ? conversation : undefined,
      project_state: ps || undefined,
      scenes: scenes || undefined,
      session_id: projectName ? `${projectName}:${threadId}` : 'default',
    }

    chatSendMessage(threadId, text.trim(), body)
  }, [isLoading, projectState, scenes, projectName, persistThread])

  const stopStreaming = useCallback(() => {
    const threadId = activeThreadIdRef.current
    abortChat(threadId)
    interruptChat(projectName ? `${projectName}:${threadId}` : 'default').catch(() => {})
  }, [projectName])

  const clearMessages = useCallback(() => {
    const threadId = activeThreadIdRef.current
    if (!threadId) return
    updateSession(threadId, s => ({ ...s, messages: [], isLoading: false, toolCalls: [] }))
    persistAllThreads()
  }, [persistAllThreads])

  const editAndResend = useCallback((msgId, newText) => {
    const threadId = activeThreadIdRef.current
    if (!threadId) return
    const session = getSession(threadId)
    if (!session) return
    const idx = session.messages.findIndex(m => m.id === msgId)
    if (idx < 0) return
    const originalText = session.messages[idx].content
    updateSession(threadId, s => ({ ...s, messages: s.messages.slice(0, idx) }))
    setTimeout(() => sendMessage(newText || originalText), 0)
  }, [sendMessage])

  // Expose threadMeta as `threads` — AgentChat only uses .title, .hidden, .created_at
  const threads = threadMeta

  return {
    messages, isLoading, isStreaming,
    threads, activeThreadId,
    sendMessage, stopStreaming, clearMessages, editAndResend,
    createThread, switchThread, renameThread, hideThread, deleteThread,
    revertToMessage,
  }
}
