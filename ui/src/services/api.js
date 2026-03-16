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

// Image/video generation
export function generateVeo(body) {
  return request('/api/generate/veo', { method: 'POST', body: JSON.stringify(body) })
}

export function generateNanoBanana(body) {
  return request('/api/generate/nano-banana', { method: 'POST', body: JSON.stringify(body) })
}

// Task polling
export function getTaskStatus(provider, taskId, { projectType, projectName } = {}) {
  const params = new URLSearchParams()
  if (projectType) params.set('project_type', projectType)
  if (projectName) params.set('project_name', projectName)
  const qs = params.toString()
  return request(`/api/task/${provider}/${taskId}${qs ? `?${qs}` : ''}`)
}

// File upload (multipart, not JSON)
export async function uploadImage(file) {
  const formData = new FormData()
  formData.append('file', file)
  const headers = await _authHeaders()
  const resp = await fetch(`${BASE}/api/upload-image`, { method: 'POST', body: formData, headers })
  if (!resp.ok) throw new Error('Upload failed')
  return resp.json()
}

// Prompt optimization
export function optimizePrompt(prompt, provider, userInstructions, imageUrls, { projectState, scenes, sceneNumber, shotNumber, mode, mediaType, frameMode } = {}) {
  const payload = { prompt, provider, user_instructions: userInstructions }
  if (mode) payload.mode = mode
  if (mediaType) payload.media_type = mediaType
  if (frameMode) payload.frame_mode = frameMode
  if (imageUrls?.length) payload.image_urls = imageUrls
  if (projectState) payload.project_state = projectState
  if (scenes) payload.scenes = scenes
  if (sceneNumber != null) payload.scene_number = sceneNumber
  if (shotNumber != null) payload.shot_number = shotNumber
  return request('/api/optimize-prompt', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// Prompt optimization with SSE streaming (thinking + final result)
export async function optimizePromptStream(prompt, userInstructions, imageUrls, { projectState, scenes, sceneNumber, shotNumber, mode, mediaType, frameMode, contextImages } = {}, onEvent) {
  const payload = { prompt, provider: 'gemini', user_instructions: userInstructions }
  if (mode) payload.mode = mode
  if (mediaType) payload.media_type = mediaType
  if (frameMode) payload.frame_mode = frameMode
  if (imageUrls?.length) payload.image_urls = imageUrls
  if (contextImages?.length) payload.context_images = contextImages
  if (projectState) payload.project_state = projectState
  if (scenes) payload.scenes = scenes
  if (sceneNumber != null) payload.scene_number = sceneNumber
  if (shotNumber != null) payload.shot_number = shotNumber
  const sseHeaders = await _authHeaders({ 'Content-Type': 'application/json' })
  const resp = await fetch(`${BASE}/api/optimize-prompt-stream`, {
    method: 'POST',
    headers: sseHeaders,
    body: JSON.stringify(payload),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { onEvent(JSON.parse(line.slice(6))) } catch {}
      }
    }
  }
}

// Script generation
export function generateScript(query, preferences, existingScript, mode) {
  return request('/api/script/generate', {
    method: 'POST',
    body: JSON.stringify({ query, preferences, existing_script: existingScript || null, mode: mode || 'film' }),
  })
}

// Script generation with SSE streaming (thinking + final result)
export async function generateScriptStream(query, preferences, existingScript, mode, onEvent) {
  const scriptHeaders = await _authHeaders({ 'Content-Type': 'application/json' })
  const resp = await fetch(`${BASE}/api/script/generate-stream`, {
    method: 'POST',
    headers: scriptHeaders,
    body: JSON.stringify({ query, preferences, existing_script: existingScript || null, mode: mode || 'film' }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { onEvent(JSON.parse(line.slice(6))) } catch {}
      }
    }
  }
}

// Storyboard projects
export function listProjects() {
  return request('/api/storyboard/projects')
}

export function getProject(name) {
  return request(`/api/storyboard/projects/${encodeURIComponent(name)}`)
}

export function saveProject(name, data) {
  return request(`/api/storyboard/projects/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function createProject(data) {
  return request('/api/storyboard/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function deleteProject(name) {
  return request(`/api/storyboard/projects/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

export function copyProject(oldName, newName) {
  return request(`/api/storyboard/projects/${encodeURIComponent(oldName)}/copy`, {
    method: 'POST',
    body: JSON.stringify({ new_name: newName }),
  })
}

export function renameProjectApi(oldName, newName) {
  return request(`/api/storyboard/projects/${encodeURIComponent(oldName)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ new_name: newName }),
  })
}

// Generation projects
export function listGenerationProjects() {
  return request('/api/generation/projects')
}

export function getGenerationProject(name) {
  return request(`/api/generation/projects/${encodeURIComponent(name)}`)
}

export function saveGenerationProject(name, data) {
  return request(`/api/generation/projects/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function createGenerationProject(data) {
  return request('/api/generation/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function deleteGenerationProject(name) {
  return request(`/api/generation/projects/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

// File migration
export function migrateFile(sourceUrl, projectType, projectName, filename) {
  return request('/api/migrate-file', {
    method: 'POST',
    body: JSON.stringify({ source_url: sourceUrl, project_type: projectType, project_name: projectName, filename }),
  })
}

// Provider-to-endpoint mapping
const GENERATE_ENDPOINTS = {
  veo: generateVeo,
  nano_banana: generateNanoBanana,
}

export function generateForProvider(provider, body) {
  const fn = GENERATE_ENDPOINTS[provider]
  if (!fn) throw new Error(`Unknown provider: ${provider}`)
  return fn(body)
}
