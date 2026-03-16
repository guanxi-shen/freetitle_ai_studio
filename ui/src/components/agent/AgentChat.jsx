import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Markdown from 'react-markdown'
import './AgentChat.css'

const SUGGESTIONS_MINI = [
  'Create storyboards from script',
  'First draft: script to video',
  'Brainstorm aesthetics and style',
  'Review my storyboard',
]

const SUGGESTIONS_EXPANDED = [
  'Help me create all storyboards based on the script',
  'Do a first draft from script to video for every shot',
  'Brainstorm the aesthetics and style for this project',
  'Review my storyboard structure and give feedback',
]

const ChatIcon = () => (
  <img src="/favicon.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />
)

const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2L2 8.5l4.5 1.8L14 2zM6.5 10.3L8.3 14.8 14 2" />
  </svg>
)

const StopIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
    <rect x="1" y="1" width="8" height="8" rx="1" />
  </svg>
)

const UploadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 10V3M8 3L5 6M8 3l3 3" />
    <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
  </svg>
)

const ChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10l4-4 4 4" />
  </svg>
)

const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6l4 4 4-4" />
  </svg>
)

const MinimizeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8h8" />
  </svg>
)

const PencilIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
  </svg>
)

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M8 3v10M3 8h10" />
  </svg>
)

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5" /><path d="M3 4l1 10h8l1-10" />
  </svg>
)

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

function TypingIndicator() {
  return (
    <div className="agent-typing">
      <div className="agent-typing-dot" />
      <div className="agent-typing-dot" />
      <div className="agent-typing-dot" />
    </div>
  )
}

const TOOL_LABELS = {
  load_skill: 'Loaded skill',
  get_project_context: 'Read project context',
  generate_image: 'Generating image',
  generate_video: 'Generating video',
  modify_project: 'Modifying project',
  run_sub_agent: 'Running sub-agent',
}

const PILL_TOOLS = new Set(['generate_image', 'generate_video'])

function formatToolCall(name) {
  return TOOL_LABELS[name] || name
}

function ThinkingBlock({ thinking, isStreaming, hasContent }) {
  const [expanded, setExpanded] = useState(false)
  if (!thinking) return null
  // Streaming, no content yet: first line of thinking + inline expand button
  if (isStreaming && !hasContent) {
    const firstLine = thinking.split('\n')[0].slice(0, 150)
    return (
      <div className="agent-thinking">
        <div className="agent-thinking-content agent-thinking-inline">
          {expanded ? thinking : firstLine + (thinking.length > firstLine.length ? '...' : '')}
          <button className="agent-thinking-toggle" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp /> : <ChevronDown />}
          </button>
        </div>
      </div>
    )
  }
  // Done: clickable "Thinking" label to expand
  return (
    <div className="agent-thinking" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
      <div className="agent-thinking-label">Thinking {expanded ? <ChevronUp /> : <ChevronDown />}</div>
      {expanded && <div className="agent-thinking-content">{thinking}</div>}
    </div>
  )
}

function ToolCallIndicators({ toolCalls, isStreaming, hasContent }) {
  if (!toolCalls?.length) return null
  const counts = {}
  toolCalls.forEach(tc => { counts[tc.name] = (counts[tc.name] || 0) + 1 })
  const entries = Object.entries(counts)
  if (!isStreaming || hasContent) return null

  const subtle = entries.filter(([name]) => !PILL_TOOLS.has(name))
  const pills = entries.filter(([name]) => PILL_TOOLS.has(name))

  return (
    <>
      {subtle.length > 0 && (
        <div className="agent-tool-calls">
          {subtle.map(([name, count]) => (
            <div key={name} className="agent-tool-call">
              {formatToolCall(name)}{count > 1 ? ` (${count})` : ''}
            </div>
          ))}
        </div>
      )}
      {pills.length > 0 && (
        <div className="agent-tool-pills">
          {pills.map(([name, count]) => (
            <span key={name} className="agent-tool-pill">
              <span className="agent-tool-pill-spinner" />
              {formatToolCall(name)}{count > 1 ? ` x${count}` : ''}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function SubAgentIndicators({ subAgents, isStreaming, hasContent }) {
  if (!subAgents || !Object.keys(subAgents).length) return null
  if (!isStreaming || hasContent) return null
  return (
    <div className="agent-sub-agents">
      {Object.entries(subAgents).map(([id, sub]) => (
        <div key={id} className={`agent-sub-agent-group ${sub.status === 'complete' ? 'complete' : ''}`}>
          <div className="agent-sub-agent-header">
            {sub.status === 'running' && <span className="agent-tool-pill-spinner" />}
            {sub.status === 'complete' && <span className="agent-sub-check">done</span>}
            <span>{sub.scope}</span>
          </div>
          {sub.tool_calls.length > 0 && (
            <div className="agent-sub-agent-pills">
              {sub.tool_calls.map((tc, i) => (
                <span key={i} className="agent-tool-pill agent-tool-pill-nested">
                  {formatToolCall(tc.name)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function MessageBubble({ message, isStreaming, onEdit }) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const isUser = message.role === 'user'

  if (!isUser && !message.content && !message.thinking && !message.tool_calls?.length) return null

  const startEdit = () => {
    setEditText(message.content)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditText('')
  }

  const confirmEdit = () => {
    if (editText.trim()) {
      onEdit(message.id, editText.trim())
    }
    setEditing(false)
    setEditText('')
  }

  // Agent messages: interleaved text + inline images (Gemini native image output)
  if (!isUser) {
    return (
      <div className="agent-bubble agent-bubble-agent">
        <ThinkingBlock thinking={message.thinking} isStreaming={isStreaming} hasContent={!!message.content} />
        <ToolCallIndicators toolCalls={message.tool_calls} isStreaming={isStreaming} hasContent={!!message.content} />
        <SubAgentIndicators subAgents={message.sub_agents} isStreaming={isStreaming} hasContent={!!message.content} />
        {message.content ? <div className="agent-markdown"><Markdown>{message.content}</Markdown></div> : null}
        {/* Interleaved image output: concept sketches generated inline by Gemini */}
        {message.inline_images?.length > 0 && (
          <div className="agent-inline-images">
            {message.inline_images.map((img, i) => (
              <img
                key={i}
                src={img.url || `data:${img.mime_type};base64,${img.data}`}
                alt="Concept sketch"
                className="agent-inline-image"
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // User messages: pencil to the left of bubble, same row
  return (
    <div className="agent-bubble-wrap agent-bubble-wrap-user">
      {!editing && !isStreaming && onEdit && (
        <button className="agent-msg-edit-btn" onClick={startEdit} title="Edit and resend">
          <PencilIcon />
        </button>
      )}
      <div className="agent-bubble agent-bubble-user">
        {editing ? (
          <div className="agent-msg-edit-mode">
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEdit() } if (e.key === 'Escape') cancelEdit() }}
            />
            <div className="agent-msg-edit-actions">
              <button onClick={confirmEdit} className="agent-msg-edit-confirm">Resend</button>
              <button onClick={cancelEdit} className="agent-msg-edit-cancel">Cancel</button>
            </div>
          </div>
        ) : message.content}
      </div>
    </div>
  )
}

function relativeTime(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function ThreadDropdown({ threads, activeThreadId, onSwitch, onCreate, onRename, onHide, onDelete, onClose, titleRef }) {
  const [renamingId, setRenamingId] = useState(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const dropdownRef = useRef(null)

  // Close on outside click (ignore clicks on the title toggle)
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          (!titleRef?.current || !titleRef.current.contains(e.target))) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, titleRef])

  const visible = Object.entries(threads)
    .filter(([, t]) => !t.hidden)
    .sort((a, b) => (b[1].created_at || 0) - (a[1].created_at || 0))

  const startRename = (id, title) => {
    setRenamingId(id)
    setRenameText(title)
    setConfirmDeleteId(null)
  }

  const confirmRename = () => {
    if (renamingId && renameText.trim()) onRename(renamingId, renameText.trim())
    setRenamingId(null)
    setRenameText('')
  }

  return (
    <div className="agent-thread-dropdown" ref={dropdownRef}>
      <button className="agent-thread-new" onClick={() => { onCreate(); onClose() }}>
        <PlusIcon /> New chat
      </button>
      <div className="agent-thread-list">
        {visible.map(([id, thread]) => (
          <div key={id} className={`agent-thread-item ${id === activeThreadId ? 'agent-thread-active' : ''}`}>
            {renamingId === id ? (
              <div className="agent-thread-rename">
                <input
                  value={renameText}
                  onChange={e => setRenameText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenamingId(null) }}
                  autoFocus
                />
              </div>
            ) : confirmDeleteId === id ? (
              <div className="agent-thread-delete-confirm">
                <span>Delete?</span>
                <button onClick={() => { onDelete(id); setConfirmDeleteId(null) }}>Yes</button>
                <button onClick={() => setConfirmDeleteId(null)}>No</button>
              </div>
            ) : (
              <>
                <div className="agent-thread-item-main" onClick={() => { onSwitch(id); onClose() }}>
                  <span className="agent-thread-item-title">{thread.title || 'Chat'}</span>
                  <span className="agent-thread-item-meta">
                    {thread.messages?.length || 0}
                    {' '}
                    {relativeTime(thread.created_at)}
                  </span>
                </div>
                <div className="agent-thread-item-actions">
                  <button onClick={(e) => { e.stopPropagation(); startRename(id, thread.title || 'Chat') }} title="Rename">
                    <PencilIcon />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onHide(id) }} title="Hide">
                    <CloseIcon />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(id); setRenamingId(null) }} title="Delete">
                    <TrashIcon />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AgentChat({
  messages, isLoading, isStreaming, sendMessage, stopStreaming, clearMessages,
  threads, activeThreadId, createThread, switchThread, renameThread, hideThread, deleteThread,
  editAndResend,
  projectName, projectState,
}) {
  const chatId = activeThreadId || 'default'
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [miniInput, setMiniInput] = useState('')
  const [showThreads, setShowThreads] = useState(false)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const miniInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const titleRef = useRef(null)
  const hasMessages = messages.length > 0

  // Per-chat resizable panel size
  const DEFAULT_W = 400
  const DEFAULT_H = 594
  const LS_KEY = 'agent_chat_sizes'
  const chatSizesRef = useRef(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
  })
  if (typeof chatSizesRef.current === 'function') chatSizesRef.current = chatSizesRef.current()
  const size = chatSizesRef.current[chatId] || { w: DEFAULT_W, h: DEFAULT_H }
  const [, forceRender] = useState(0)

  const handleResizeStart = useCallback((e, edge) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = size.w
    const startH = size.h

    const onMove = (ev) => {
      let w = startW, h = startH
      if (edge === 'left' || edge === 'top-left') w = Math.max(320, Math.min(800, startW + (startX - ev.clientX)))
      if (edge === 'top' || edge === 'top-left') h = Math.max(400, Math.min(window.innerHeight - 60, startH + (startY - ev.clientY)))
      chatSizesRef.current[chatId] = { w, h }
      forceRender(n => n + 1)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { localStorage.setItem(LS_KEY, JSON.stringify(chatSizesRef.current)) } catch {}
    }
    document.body.style.cursor = edge === 'top' ? 'ns-resize' : edge === 'left' ? 'ew-resize' : 'nwse-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [chatId, size])

  useEffect(() => {
    if (expanded) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading, expanded])

  useEffect(() => {
    if (expanded) setTimeout(() => textareaRef.current?.focus(), 50)
  }, [expanded])

  const handleSend = useCallback((text) => {
    const val = text || inputValue
    if (!val.trim()) return
    sendMessage(val)
    setInputValue('')
    setMiniInput('')
    if (!expanded) { setExpanded(true); setCollapsed(false) }
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [inputValue, sendMessage, expanded])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleMiniKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSend(miniInput)
    }
  }

  const handleTextareaChange = (e) => {
    setInputValue(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
  }

  const handleSuggestion = (text) => {
    sendMessage(text)
    if (!expanded) { setExpanded(true); setCollapsed(false) }
  }

  // Close dropdown when deleting/hiding leaves <= 1 visible thread
  const handleDeleteThread = useCallback((id) => {
    deleteThread(id)
    const remaining = threads ? Object.entries(threads).filter(([tid, t]) => tid !== id && !t.hidden).length : 0
    if (remaining <= 0) setShowThreads(false)
  }, [deleteThread, threads])

  const handleHideThread = useCallback((id) => {
    hideThread(id)
    const remaining = threads ? Object.entries(threads).filter(([tid, t]) => tid !== id && !t.hidden).length : 0
    if (remaining <= 0) setShowThreads(false)
  }, [hideThread, threads])

  const currentTitle = threads?.[activeThreadId]?.title || 'FreeTitle Creative Assistant'
  const threadCount = threads ? Object.values(threads).filter(t => !t.hidden).length : 0

  const lastMessages = messages.slice(-2)

  if (expanded) {
    return createPortal(
      <div className="agent-container agent-expanded">
        <div className="agent-panel agent-glass" style={{ width: size.w, height: size.h }}>
          <div className="agent-resize-handle agent-resize-left" onMouseDown={e => handleResizeStart(e, 'left')} />
          <div className="agent-resize-handle agent-resize-top" onMouseDown={e => handleResizeStart(e, 'top')} />
          <div className="agent-resize-handle agent-resize-top-left" onMouseDown={e => handleResizeStart(e, 'top-left')} />
          <div className="agent-panel-header">
            <ChatIcon />
            <div
              ref={titleRef}
              className="agent-panel-title agent-panel-title-clickable"
              onClick={() => setShowThreads(prev => !prev)}
            >
              <span className="agent-panel-title-text">{currentTitle}</span>
              {threadCount > 1 && <span className="agent-panel-title-count">{threadCount}</span>}
              <span className="agent-panel-title-caret">{showThreads ? <ChevronUp /> : <ChevronDown />}</span>
            </div>
            <button className="agent-expand-btn" onClick={() => { setExpanded(false); setCollapsed(true) }} title="Collapse to input bar">
              <MinimizeIcon />
            </button>
            <button className="agent-minimize-btn" onClick={() => setExpanded(false)} title="Minimize">
              <ChevronDown />
            </button>
          </div>

          {showThreads && threads && (
            <ThreadDropdown
              threads={threads}
              activeThreadId={activeThreadId}
              onSwitch={switchThread}
              onCreate={createThread}
              onRename={renameThread}
              onHide={handleHideThread}
              onDelete={handleDeleteThread}
              onClose={() => setShowThreads(false)}
              titleRef={titleRef}
            />
          )}

          <div className="agent-messages">
            {messages.length === 0 ? (
              <div className="agent-welcome">
                <div className="agent-welcome-text">
                  Ask me to help with anything in your project. Ideate, brainstorm, stylize, write scripts, generate visuals, plan production, and more.
                </div>
                <div className="agent-welcome-chips">
                  {SUGGESTIONS_EXPANDED.map((s, i) => (
                    <button key={i} className="agent-welcome-chip" onClick={() => handleSuggestion(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isStreaming={isStreaming && msg.role === 'agent' && i === messages.length - 1}
                    onEdit={editAndResend}
                  />
                ))}
                {isLoading && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <div className="agent-input-area">
            <input type="file" ref={fileInputRef} hidden accept="image/*,.pdf" onChange={() => { fileInputRef.current.value = '' }} />
            <button className="agent-send-btn" onClick={() => fileInputRef.current?.click()} title="Upload file" style={{ marginBottom: 2 }}>
              <UploadIcon />
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputValue}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask the assistant..."
            />
            {isStreaming ? (
              <button className="agent-input-send agent-stop-btn" onClick={stopStreaming} title="Stop">
                <StopIcon />
              </button>
            ) : (
              <button
                className="agent-input-send"
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || isLoading}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body
    )
  }

  // Collapsed state
  if (collapsed) {
    return createPortal(
      <div className="agent-container">
        <div className="agent-minimized agent-collapsed agent-glass">
          <div className="agent-minimized-input" onClick={e => e.stopPropagation()}>
            <button className="agent-send-btn" onClick={() => { setCollapsed(false) }} title="Restore">
              <ChevronUp />
            </button>
            <button className="agent-send-btn" onClick={() => { setCollapsed(false); setExpanded(true) }} title="Expand full">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
            </button>
            <input
              ref={miniInputRef}
              value={miniInput}
              onChange={e => setMiniInput(e.target.value)}
              onKeyDown={handleMiniKeyDown}
              placeholder={hasMessages ? 'Reply...' : 'Ask anything...'}
            />
            <button
              className="agent-send-btn"
              onClick={() => handleSend(miniInput)}
              disabled={!miniInput.trim() || isLoading}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  // Minimized state
  return createPortal(
    <div className="agent-container">
      <div className="agent-minimized agent-glass">
        <div className="agent-minimized-header" onClick={() => setExpanded(true)}>
          <ChatIcon />
          <span>{currentTitle}</span>
          <button className="agent-expand-btn" onClick={e => { e.stopPropagation(); setCollapsed(true) }} title="Minimize">
            <MinimizeIcon />
          </button>
          <button className="agent-expand-btn" title="Expand">
            <ChevronUp />
          </button>
        </div>

        {hasMessages ? (
          <div className="agent-minimized-messages" onClick={() => setExpanded(true)}>
            {lastMessages.map(msg => (
              <div key={msg.id} className={`agent-minimized-msg ${msg.role === 'user' ? 'agent-msg-user' : ''}`}>
                {msg.role === 'user' ? 'You: ' : ''}{msg.content}
              </div>
            ))}
          </div>
        ) : (
          <div className="agent-suggestions-mini">
            {SUGGESTIONS_MINI.map((s, i) => (
              <button key={i} className="agent-suggestion-chip" onClick={() => handleSuggestion(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="agent-minimized-input" onClick={e => e.stopPropagation()}>
          <button className="agent-send-btn" onClick={() => fileInputRef.current?.click()} title="Upload file">
            <UploadIcon />
          </button>
          <input
            ref={miniInputRef}
            value={miniInput}
            onChange={e => setMiniInput(e.target.value)}
            onKeyDown={handleMiniKeyDown}
            placeholder={hasMessages ? 'Reply...' : 'Ask anything...'}
          />
          <button
            className="agent-send-btn"
            onClick={() => handleSend(miniInput)}
            disabled={!miniInput.trim() || isLoading}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
