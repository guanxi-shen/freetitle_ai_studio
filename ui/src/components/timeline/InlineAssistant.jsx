import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useChatSession, sendMessage as chatSendMessage, buildConversationContents, abortChat } from '../../chat'
import './InlineAssistant.css'

const SUGGESTIONS = {
  shot: ['Generate a frame for this shot', 'Review and improve this shot'],
  'video-shot': ['Generate video for this shot', 'Review and improve this shot'],
  character: ['Refine character design', 'Suggest expressions', 'Describe character traits'],
  supplement: ['Describe this asset', 'Suggest usage in scenes', 'Generate variations'],
  scene: ['Review scene structure', 'Suggest additional shots', 'Improve pacing'],
  default: ['Brainstorm aesthetics', 'Add an asset'],
}

const CONTEXT_SCOPE = {
  shot: ctx => ({ shot: [parseInt(ctx.sceneNumber), parseInt(ctx.shotNumber)] }),
  'video-shot': ctx => ({ shot: [parseInt(ctx.sceneNumber), parseInt(ctx.shotNumber)] }),
  scene: ctx => ({ scene: parseInt(ctx.sceneNumber) }),
  character: ctx => ({ character: ctx.characterName }),
}

const CONTEXT_SKILLS = {
  shot: ['creative-direction', 'context-access', 'storyboard-generation'],
  'video-shot': ['creative-direction', 'context-access', 'video-generation'],
  character: ['creative-direction', 'context-access', 'character-design'],
  supplement: ['creative-direction', 'context-access', 'supplementary-generation'],
  scene: ['creative-direction', 'context-access'],
}

function getSuggestions(contextType) {
  return SUGGESTIONS[contextType] || SUGGESTIONS.default
}

export default function InlineAssistant({ sessionKey, position, context, onClose, onMinimize, visible = true, projectName, projectState, scenes }) {
  const [inputValue, setInputValue] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  // Read from shared chat session store (survives unmount)
  const session = useChatSession(sessionKey)
  const { messages, isLoading, toolCalls } = session
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    if (visible) setTimeout(() => inputRef.current?.focus(), 80)
  }, [visible])

  useEffect(() => {
    if (visible) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading, visible])

  useEffect(() => {
    if (!visible) return
    function handleKey(e) {
      if (e.key === 'Escape') {
        if (showConfirm) { setShowConfirm(false); return }
        if (messages.length > 0 || isLoading) onMinimize()
        else onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, onMinimize, visible, messages.length, isLoading, showConfirm])

  useEffect(() => {
    if (!visible) return
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        if (showConfirm) { setShowConfirm(false); return }
        if (isLoading || messages.length > 0) {
          onMinimize()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, onMinimize, isLoading, messages.length, showConfirm, visible])

  useEffect(() => {
    if (!visible) return
    const el = panelRef.current
    if (!el) return
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      if (rect.right > window.innerWidth - 8) el.style.left = (window.innerWidth - rect.width - 8) + 'px'
      if (rect.bottom > window.innerHeight - 8) el.style.top = (window.innerHeight - rect.height - 8) + 'px'
    })
  }, [position, visible])

  const handleMinimize = useCallback(() => {
    onMinimize?.()
  }, [onMinimize])

  const handleClose = useCallback(() => {
    if (messages.length > 0 || isLoading) {
      setShowConfirm(true)
    } else {
      onClose()
    }
  }, [messages.length, isLoading, onClose])

  const handleConfirmClose = useCallback(() => {
    abortChat(sessionKey)
    onClose()
  }, [sessionKey, onClose])

  const handleSend = useCallback((text) => {
    const val = text || inputValue
    if (!val.trim() || isLoading) return

    const conversationContents = buildConversationContents(messagesRef.current)

    let ps = projectState
    if (ps) {
      const { trash, pending_tasks, ...rest } = ps
      ps = rest
    }

    const scopeFn = CONTEXT_SCOPE[context?.type]
    const scope = scopeFn ? scopeFn(context) : undefined
    if (scope && context?.frameHint) scope.frame_hint = context.frameHint

    const body = {
      message: val.trim(),
      conversation_contents: conversationContents.length > 0 ? conversationContents : undefined,
      project_state: ps || undefined,
      scenes: scenes || undefined,
      scope,
      pre_inject_skills: CONTEXT_SKILLS[context?.type] || ['creative-direction', 'context-access'],
      is_sub_agent: true,
      is_inline: true,
      session_id: projectName ? `${projectName}:${sessionKey}` : 'default',
    }

    chatSendMessage(sessionKey, val.trim(), body)
    setInputValue('')
  }, [sessionKey, inputValue, isLoading, context, onClose, projectName, projectState, scenes])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const contextLabel = context?.label ? `Creative Assistant - ${context.label}` : 'Creative Assistant'
  const suggestions = getSuggestions(context?.type)

  return createPortal(
    <div ref={panelRef} className="inline-assistant" style={{ top: position.y, left: position.x, display: visible ? undefined : 'none' }}>
      <div className="inline-asst-header">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" />
        </svg>
        <span className="inline-asst-title">{contextLabel}</span>
        <button className="inline-asst-minimize" onClick={handleMinimize} title="Minimize">
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
            <line x1="2" y1="8" x2="8" y2="8" />
          </svg>
        </button>
        <button className="inline-asst-close" onClick={handleClose} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
            <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      </div>

      <div className="inline-asst-messages">
        {messages.length === 0 ? (
          <div className="inline-asst-suggestions">
            {suggestions.map((s, i) => (
              <button key={i} className="inline-asst-chip" onClick={() => handleSend(s)}>{s}</button>
            ))}
          </div>
        ) : (
          <>
            {messages.map(msg => {
              if (msg.role === 'agent' && !msg.content) return null
              return (
                <div key={msg.id} className={`inline-asst-bubble ${msg.role === 'user' ? 'user' : 'agent'}`}>
                  {msg.content}
                </div>
              )
            })}
            {isLoading && (
              <>
                {toolCalls.length > 0 && (
                  <div className="inline-asst-tools">
                    {toolCalls.map((tc, i) => (
                      <span key={i} className="inline-asst-tool-pill">
                        <span className="inline-asst-tool-spinner" />
                        {tc.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="inline-asst-typing">
                  <div className="inline-asst-dot" /><div className="inline-asst-dot" /><div className="inline-asst-dot" />
                </div>
              </>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="inline-asst-input">
        <input
          ref={inputRef}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this..."
        />
        <button className="inline-asst-send" onClick={() => handleSend()} disabled={!inputValue.trim() || isLoading}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2L2 8.5l4.5 1.8L14 2zM6.5 10.3L8.3 14.8 14 2" />
          </svg>
        </button>
      </div>

      {showConfirm && (
        <div className="inline-asst-confirm-overlay">
          <span>Close this chat?</span>
          <div className="inline-asst-confirm-actions">
            <button onClick={handleConfirmClose}>Close</button>
            <button onClick={() => setShowConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
