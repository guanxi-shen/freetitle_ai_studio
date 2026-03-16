import { useSyncExternalStore, useCallback } from 'react'
import { subscribe, getSession } from './store'

export { sendMessage, abortChat, closeChat, buildConversationContents, setHandlers, syncIdCounter, chatIsStreaming, nextId } from './actions'
export { updateSession, loadSession, removeSession, hasSession, getAllSessionKeys, getSession } from './store'

const DEFAULT = Object.freeze({ messages: [], isLoading: false, toolCalls: [] })

/**
 * Subscribe to a single chat session. Only re-renders when THIS session changes --
 * other sessions updating do not trigger a re-render.
 */
export function useChatSession(key) {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => (key ? getSession(key) : null) || DEFAULT, [key])
  )
}
