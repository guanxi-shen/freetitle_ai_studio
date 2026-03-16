/**
 * External store for the interleaved multimodal chat sessions.
 *
 * Decoupled from React lifecycle -- the interleaved stream (text + images +
 * audio + video events) continues even when UI components unmount. This is
 * critical for the creative pipeline where long-running generation tasks
 * produce results asynchronously.
 *
 * Consumers subscribe via useSyncExternalStore for per-key re-renders:
 * updating session A does not re-render components subscribed to session B.
 */

let sessions = {}
const listeners = new Set()

function emit() {
  for (const fn of listeners) fn()
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSession(key) {
  return sessions[key] || null
}

export function hasSession(key) {
  return key in sessions
}

export function updateSession(key, updater) {
  const current = sessions[key] || { messages: [], isLoading: false, toolCalls: [] }
  sessions = { ...sessions, [key]: typeof updater === 'function' ? updater(current) : { ...current, ...updater } }
  emit()
}

export function removeSession(key) {
  if (!(key in sessions)) return
  const { [key]: _, ...rest } = sessions
  sessions = rest
  emit()
}

export function loadSession(key, data) {
  sessions = { ...sessions, [key]: { messages: [], isLoading: false, toolCalls: [], ...data } }
  emit()
}

export function getAllSessionKeys() {
  return Object.keys(sessions)
}
