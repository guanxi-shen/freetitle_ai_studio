/**
 * Agent chat REST + SSE client -- interleaved multimodal delivery.
 *
 * SSE events arrive as an interleaved stream: text tokens, thinking output,
 * tool calls (image/video/audio generation), and state_changed events flow
 * concurrently. The frontend renders text in the chat while generated assets
 * appear in the timeline -- creating a fluid, non-turn-based creative experience.
 */

const BASE = ''

let _getToken = null
export function setAuthTokenGetter(fn) { _getToken = fn }

async function _authHeaders(extra = {}) {
  const headers = { ...extra }
  if (_getToken) {
    const token = await _getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/**
 * Stream agent chat via SSE. Returns AbortController for cancellation.
 * body: { message, conversation, project_state, scenes, session_id }
 * onEvent: called with each parsed SSE event object
 */
export function streamChat(body, onEvent) {
  const controller = new AbortController()

  _authHeaders({ 'Content-Type': 'application/json' }).then(headers => fetch(`${BASE}/api/agent/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  }))
    .then(resp => {
      if (resp.status === 409) {
        onEvent({ type: 'error', error: 'Agent is busy, try again in a moment' })
        return
      }
      if (!resp.ok) throw new Error(`Agent chat failed: ${resp.status}`)
      return _readSSE(resp.body, onEvent)
    })
    .catch(err => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', error: err.message })
      }
    })

  return controller
}

/**
 * Interrupt an active agent chat session.
 */
export async function interruptChat(sessionId) {
  const headers = await _authHeaders({ 'Content-Type': 'application/json' })
  return fetch(`${BASE}/api/agent/interrupt`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ session_id: sessionId }),
  })
}

/**
 * Fetch saved agent results for recovery after page refresh.
 */
export async function getAgentResults(projectName) {
  const headers = await _authHeaders()
  const resp = await fetch(`${BASE}/api/agent/results/${encodeURIComponent(projectName)}`, { headers })
  if (!resp.ok) return {}
  const data = await resp.json()
  return data.results || {}
}

async function _readSSE(body, onEvent) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          console.debug('[AgentSSE]', data.type, data.type === 'state_changed' ? data : '')
          onEvent(data)
        } catch (e) {
          // skip malformed events
        }
      }
    }
  }

  if (buffer.startsWith('data: ')) {
    try {
      onEvent(JSON.parse(buffer.slice(6)))
    } catch (e) { /* skip */ }
  }
}
