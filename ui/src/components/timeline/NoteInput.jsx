import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

const COLORS = ['#fef3c7', '#fce7f3', '#dbeafe', '#d1fae5', '#ede9fe', '#fed7aa']

export default function NoteInput({ position, contextLabel, onSubmit, onBack, onClose }) {
  const [text, setText] = useState('')
  const [color, setColor] = useState(COLORS[2])
  const textRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    setTimeout(() => textRef.current?.focus(), 50)
  }, [])

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Clamp to viewport
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) el.style.left = (window.innerWidth - rect.width - 8) + 'px'
    if (rect.bottom > window.innerHeight - 8) el.style.top = (window.innerHeight - rect.height - 8) + 'px'
  }, [position])

  function handleSubmit() {
    if (!text.trim()) return
    onSubmit(text.trim(), color)
  }

  return createPortal(
    <div ref={panelRef} className="note-input-panel" style={{ top: position.y, left: position.x }}>
      <div className="note-input-header">
        <button className="note-input-back" onClick={onBack || onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7.5 2L3.5 6l4 4" />
          </svg>
        </button>
        <div className="note-input-colors">
          {COLORS.map(c => (
            <button
              key={c}
              className={`note-color-dot ${c === color ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button className="note-input-submit" onClick={handleSubmit} disabled={!text.trim()}>
          Add Note
        </button>
      </div>
      {contextLabel && <div className="note-input-context">{contextLabel}</div>}
      <textarea
        ref={textRef}
        className="note-input-text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit() }}
        placeholder="Type your note..."
        rows={3}
      />
    </div>,
    document.body
  )
}
