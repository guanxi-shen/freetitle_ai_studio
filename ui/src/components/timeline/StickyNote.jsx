import { useState, useRef, useEffect, useCallback } from 'react'
import './StickyNote.css'

const COLORS = ['#fef3c7', '#fce7f3', '#dbeafe', '#d1fae5', '#ede9fe', '#fed7aa']

function MiniIcon({ color }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="sticky-mini-svg">
      <path d="M3 1h14a2 2 0 012 2v11l-5 5H3a2 2 0 01-2-2V3a2 2 0 012-2z" fill={color} />
      <path d="M14 14v5l5-5h-5z" fill="rgba(0,0,0,0.08)" />
      <path d="M14 14v5l5-5h-5z" fill={color} opacity="0.6" />
    </svg>
  )
}

export default function StickyNote({ note, scale = 1, draggable = false, onUpdate, onDelete, onHover, onDragChange }) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(note.text)
  const [showColors, setShowColors] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const textRef = useRef(null)
  const displayRef = useRef(null)
  const noteRef = useRef(null)
  const dragStart = useRef(null)
  const resizeStart = useRef(null)

  const counterScale = 1 / Math.max(scale, 0.3)

  useEffect(() => { setEditText(note.text) }, [note.text])

  const [editHeight, setEditHeight] = useState(null)

  function handleDoubleClick() {
    if (note.minimized) return
    const h = displayRef.current?.offsetHeight
    setEditHeight(h || null)
    setEditing(true)
    setTimeout(() => {
      const el = textRef.current
      if (!el) return
      el.focus()
      el.selectionStart = el.selectionEnd = el.value.length
    }, 30)
  }

  function handleBlur() {
    setEditing(false)
    const trimmed = editText.trim()
    if (trimmed !== note.text) onUpdate?.({ text: trimmed })
  }

  // Drag handlers
  const handleMouseDown = useCallback((e) => {
    if (!draggable || editing || resizing) return
    if (e.target.closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: note.x, oy: note.y }
    setDragging(true)
    onDragChange?.(note.id, true)
  }, [draggable, editing, resizing, note.x, note.y, note.id, onDragChange])

  useEffect(() => {
    if (!dragging) return
    function onMove(e) {
      if (!dragStart.current) return
      const dx = (e.clientX - dragStart.current.mx) / scale
      const dy = (e.clientY - dragStart.current.my) / scale
      const el = noteRef.current
      if (el) {
        el.style.left = (dragStart.current.ox + dx) + 'px'
        el.style.top = (dragStart.current.oy + dy) + 'px'
      }
    }
    function onUp(e) {
      if (!dragStart.current) return
      const dx = (e.clientX - dragStart.current.mx) / scale
      const dy = (e.clientY - dragStart.current.my) / scale
      onUpdate?.({
        x: Math.round(dragStart.current.ox + dx),
        y: Math.round(dragStart.current.oy + dy),
      })
      dragStart.current = null
      setDragging(false)
      onDragChange?.(note.id, false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging, scale, onUpdate, note.id, onDragChange])

  // Resize: screen pixels map 1:1 to CSS width/height (net scale = 1),
  // but position (x,y) is in canvas coords so divide screen delta by scale
  const handleResizeStart = useCallback((e, direction) => {
    e.preventDefault()
    e.stopPropagation()
    const el = noteRef.current
    resizeStart.current = {
      mx: e.clientX, my: e.clientY,
      x: note.x, y: note.y,
      w: note.width || 200,
      h: note.height || (el ? el.offsetHeight : 100),
      direction,
    }
    setResizing(true)
  }, [note.x, note.y, note.width, note.height])

  useEffect(() => {
    if (!resizing) return
    function onMove(e) {
      const s = resizeStart.current
      if (!s) return
      const dxS = e.clientX - s.mx
      const dyS = e.clientY - s.my
      const el = noteRef.current
      let newX = s.x, newY = s.y, newW = s.w, newH = s.h
      const dir = s.direction

      if (dir.includes('e')) newW = Math.max(120, s.w + dxS)
      if (dir.includes('w')) { newW = Math.max(120, s.w - dxS); newX = s.x + (s.w - newW) / scale }
      if (dir.includes('s')) newH = Math.max(50, s.h + dyS)
      if (dir.includes('n')) { newH = Math.max(50, s.h - dyS); newY = s.y + (s.h - newH) / scale }

      if (el) {
        el.style.left = newX + 'px'
        el.style.top = newY + 'px'
        el.style.width = newW + 'px'
        el.style.height = newH + 'px'
      }
    }
    function onUp(e) {
      const s = resizeStart.current
      if (!s) return
      const dxS = e.clientX - s.mx
      const dyS = e.clientY - s.my
      let newX = s.x, newY = s.y, newW = s.w, newH = s.h
      const dir = s.direction

      if (dir.includes('e')) newW = Math.max(120, s.w + dxS)
      if (dir.includes('w')) { newW = Math.max(120, s.w - dxS); newX = s.x + (s.w - newW) / scale }
      if (dir.includes('s')) newH = Math.max(50, s.h + dyS)
      if (dir.includes('n')) { newH = Math.max(50, s.h - dyS); newY = s.y + (s.h - newH) / scale }

      onUpdate?.({ x: Math.round(newX), y: Math.round(newY), width: Math.round(newW), height: Math.round(newH) })
      resizeStart.current = null
      setResizing(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [resizing, scale, onUpdate])

  // Minimized state
  if (note.minimized) {
    return (
      <div
        ref={noteRef}
        className="sticky-note sticky-minimized"
        data-note-id={note.id}
        style={{
          left: note.x, top: note.y,
          transform: `scale(${counterScale})`,
          transformOrigin: 'top left',
        }}
        title={note.text}
        onClick={() => onUpdate?.({ minimized: false })}
        onMouseDown={draggable ? handleMouseDown : undefined}
        onMouseEnter={() => onHover?.(note.id)}
        onMouseLeave={() => onHover?.(null)}
      >
        <MiniIcon color={note.color} />
      </div>
    )
  }

  const expandedStyle = {
    left: note.x, top: note.y,
    width: note.width || 200,
    backgroundColor: note.color + 'cc',
    transform: `scale(${counterScale})`,
    transformOrigin: 'top left',
  }
  if (note.height) expandedStyle.height = note.height

  return (
    <div
      ref={noteRef}
      className={`sticky-note sticky-expanded ${dragging ? 'dragging' : ''} ${resizing ? 'resizing' : ''}`}
      data-note-id={note.id}
      style={expandedStyle}
      onMouseEnter={() => onHover?.(note.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {note.contextLabel && <span className="sticky-context-label">{note.contextLabel}</span>}
      <div className="sticky-header">
        <div className="sticky-drag-zone" onMouseDown={draggable ? handleMouseDown : undefined} />
        <div className="sticky-controls">
          <button className="sticky-btn" onClick={() => onUpdate?.({ minimized: true })} title="Minimize">
            <svg width="8" height="8" viewBox="0 0 8 2" stroke="currentColor" strokeWidth="1.5"><line x1="0" y1="1" x2="8" y2="1" /></svg>
          </button>
          <button className="sticky-btn" onClick={() => setShowColors(s => !s)} title="Change color">
            <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.5" fill={note.color} stroke="rgba(0,0,0,0.2)" strokeWidth="0.5" /></svg>
          </button>
          <button className="sticky-btn" onClick={() => onDelete?.()} title="Delete note">
            <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2" fill="none">
              <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
            </svg>
          </button>
        </div>
      </div>
      {showColors && (
        <div className="sticky-color-picker">
          {COLORS.map(c => (
            <button
              key={c}
              className={`sticky-color-dot ${c === note.color ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => { onUpdate?.({ color: c }); setShowColors(false) }}
            />
          ))}
        </div>
      )}
      <div className="sticky-body">
        {editing ? (
          <textarea
            ref={textRef}
            className="sticky-text sticky-text-edit"
            style={editHeight ? { height: editHeight } : undefined}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={e => { if (e.key === 'Escape') { setEditText(note.text); setEditing(false) } }}
          />
        ) : (
          <div ref={displayRef} className="sticky-text" onDoubleClick={handleDoubleClick}>{note.text || 'Double-click to edit...'}</div>
        )}
      </div>

      {/* Resize handles: edges + corners */}
      <div className="sticky-resize-n" onMouseDown={e => handleResizeStart(e, 'n')} />
      <div className="sticky-resize-s" onMouseDown={e => handleResizeStart(e, 's')} />
      <div className="sticky-resize-e" onMouseDown={e => handleResizeStart(e, 'e')} />
      <div className="sticky-resize-w" onMouseDown={e => handleResizeStart(e, 'w')} />
      <div className="sticky-resize-ne" onMouseDown={e => handleResizeStart(e, 'ne')} />
      <div className="sticky-resize-nw" onMouseDown={e => handleResizeStart(e, 'nw')} />
      <div className="sticky-resize-se" onMouseDown={e => handleResizeStart(e, 'se')} />
      <div className="sticky-resize-sw" onMouseDown={e => handleResizeStart(e, 'sw')} />
    </div>
  )
}
