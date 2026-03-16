/**
 * Chat session actions -- processes the interleaved multimodal SSE stream.
 *
 * Stream callbacks write to the external store (not React state) so streams
 * survive component unmount. Events are interleaved: text tokens appear in chat
 * while state_changed events (image/video/audio generation) route to the timeline.
 */

import { updateSession, removeSession } from './store'
import { streamChat } from '../services/agentApi'

const controllers = {}
let idCounter = 0

// Global handlers set once by the app shell (Storyboard)
let _onStateChanged = null
let _onPersist = null

export function setHandlers({ onStateChanged, onPersist } = {}) {
  _onStateChanged = onStateChanged || null
  _onPersist = onPersist || null
}

export function syncIdCounter(messagesArrays) {
  for (const messages of messagesArrays) {
    for (const m of messages) {
      const num = parseInt(m.id?.replace(/^cs-/, '') || '0', 10)
      if (num > idCounter) idCounter = num
    }
  }
}

export function nextId() {
  return `cs-${++idCounter}`
}

export function buildConversationContents(messages) {
  const contents = []
  for (const m of messages) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] })
    } else if (m.role === 'agent' && m.contents_history?.length) {
      contents.push(...m.contents_history)
    } else if (m.role === 'agent' && m.content) {
      contents.push({ role: 'model', parts: [{ text: m.content }] })
    }
  }
  return contents
}

export function sendMessage(sessionKey, userText, requestBody) {
  const userMsgId = nextId()
  const agentMsgId = nextId()

  updateSession(sessionKey, s => ({
    ...s,
    messages: [
      ...s.messages,
      { id: userMsgId, role: 'user', content: userText, timestamp: Date.now() },
      { id: agentMsgId, role: 'agent', content: '', thinking: '', tool_calls: [], contents_history: [], sub_agents: {}, timestamp: Date.now() },
    ],
    isLoading: true,
    toolCalls: [],
  }))

  const controller = streamChat(requestBody, (event) => {
    switch (event.type) {
      case 'token':
        updateSession(sessionKey, s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === agentMsgId ? { ...m, content: m.content + event.data } : m
          ),
        }))
        break

      case 'thinking':
        updateSession(sessionKey, s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === agentMsgId ? { ...m, thinking: event.data } : m
          ),
        }))
        break

      case 'tool_call':
        updateSession(sessionKey, s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === agentMsgId
              ? { ...m, tool_calls: [...(m.tool_calls || []), { name: event.data?.name, args: event.data?.args }] }
              : m
          ),
          toolCalls: [...s.toolCalls, { name: event.data?.name }],
        }))
        break

      case 'done':
        updateSession(sessionKey, s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === agentMsgId ? {
              ...m,
              content: event.text || m.content,
              thinking: event.thinking || m.thinking,
              contents_history: event.contents_history || m.contents_history,
            } : m
          ),
          isLoading: false,
          toolCalls: [],
          traceId: event.trace_id || null,
        }))
        delete controllers[sessionKey]
        console.log('[ChatStore] done, calling persist for', sessionKey, '_onPersist=', !!_onPersist)
        _onPersist?.(sessionKey)
        break

      case 'error':
        updateSession(sessionKey, s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === agentMsgId ? { ...m, content: m.content || `Error: ${event.error}` } : m
          ),
          isLoading: false,
          toolCalls: [],
        }))
        delete controllers[sessionKey]
        _onPersist?.(sessionKey)
        break

      case 'interrupted':
        updateSession(sessionKey, s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === agentMsgId ? { ...m, content: (m.content || '') + '\n\n[Interrupted]' } : m
          ),
          isLoading: false,
          toolCalls: [],
        }))
        delete controllers[sessionKey]
        _onPersist?.(sessionKey)
        break

      case 'sub_agent_event': {
        const { sub_agent_id, scope, event: subEvt, name } = event.data || {}
        updateSession(sessionKey, s => ({
          ...s,
          messages: s.messages.map(m => {
            if (m.id !== agentMsgId) return m
            const subs = { ...(m.sub_agents || {}) }
            const prev = subs[sub_agent_id] || { scope, status: 'running', tool_calls: [] }
            subs[sub_agent_id] = subEvt === 'tool_call'
              ? { ...prev, tool_calls: [...prev.tool_calls, { name }] }
              : (subEvt === 'complete' || subEvt === 'error') ? { ...prev, status: subEvt } : prev
            return { ...m, sub_agents: subs }
          }),
        }))
        break
      }

      // Interleaved image output: Gemini generates images inline alongside text
      // when response_modalities=["TEXT", "IMAGE"]. These appear as concept
      // sketches or visual explanations within the conversation flow.
      case 'inline_image':
        updateSession(sessionKey, s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === agentMsgId
              ? { ...m, inline_images: [...(m.inline_images || []), event.data] }
              : m
          ),
        }))
        break

      case 'state_changed':
        _onStateChanged?.(event.data)
        break
    }
  })

  controllers[sessionKey] = controller

  // Persist user message immediately (survives refresh during streaming)
  _onPersist?.(sessionKey)

  return { userMsgId, agentMsgId }
}

export function abortChat(sessionKey) {
  controllers[sessionKey]?.abort()
  delete controllers[sessionKey]
}

export function closeChat(sessionKey) {
  abortChat(sessionKey)
  removeSession(sessionKey)
}

export function chatIsStreaming(sessionKey) {
  return !!controllers[sessionKey]
}
