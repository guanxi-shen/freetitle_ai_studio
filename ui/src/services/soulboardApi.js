/**
 * Soulboard REST + SSE client with multi-session support.
 * All endpoints are scoped by projectName + sessionId.
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

async function request(url, options = {}) {
  const headers = await _authHeaders({ 'Content-Type': 'application/json', ...options.headers })
  const resp = await fetch(`${BASE}${url}`, {
    ...options,
    headers,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return resp.json()
}

function _encPath(projectName, sessionId) {
  return `/api/soulboard/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}`
}

// --- Session management ---

export function listSessions(projectName) {
  return request(`/api/soulboard/${encodeURIComponent(projectName)}/sessions`)
}

export function createSession(projectName, params = {}) {
  return request(`/api/soulboard/${encodeURIComponent(projectName)}/sessions`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export function deleteSession(projectName, sessionId) {
  return request(`${_encPath(projectName, sessionId)}`, { method: 'DELETE' })
}

export function forkSession(projectName, sessionId, params = {}) {
  return request(`${_encPath(projectName, sessionId)}/fork`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

// --- SSE streams ---

export function startIteration(projectName, sessionId, params, onEvent) {
  const controller = new AbortController()
  const url = `${BASE}${_encPath(projectName, sessionId)}/start`

  _authHeaders({ 'Content-Type': 'application/json' }).then(headers => fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
    signal: controller.signal,
  }))
    .then(resp => {
      if (!resp.ok) throw new Error(`SSE start failed: ${resp.status}`)
      return _readSSE(resp.body, onEvent)
    })
    .catch(err => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', error: err.message })
      }
    })

  return controller
}

export function iterateMore(projectName, sessionId, params, onEvent) {
  const controller = new AbortController()
  const url = `${BASE}${_encPath(projectName, sessionId)}/iterate`

  _authHeaders({ 'Content-Type': 'application/json' }).then(headers => fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
    signal: controller.signal,
  }))
    .then(resp => {
      if (!resp.ok) throw new Error(`SSE iterate failed: ${resp.status}`)
      return _readSSE(resp.body, onEvent)
    })
    .catch(err => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', error: err.message })
      }
    })

  return controller
}

// --- REST ---

export function interrupt(projectName, sessionId) {
  return request(`${_encPath(projectName, sessionId)}/interrupt`, { method: 'POST' })
}

export function submitFeedback(projectName, sessionId, feedback) {
  return request(`${_encPath(projectName, sessionId)}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  })
}

export function finalize(projectName, sessionId, selectedItems, categories = {}) {
  return request(`${_encPath(projectName, sessionId)}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ selected_items: selectedItems, categories }),
  })
}

export function getState(projectName, sessionId) {
  return request(`${_encPath(projectName, sessionId)}/state`)
}

// --- SSE stream reader ---

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
