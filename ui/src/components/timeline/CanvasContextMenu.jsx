import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './CanvasContextMenu.css'

// Walk DOM upward from target to boundary, checking data-context-type
export function detectContext(target, boundary) {
  let node = target
  while (node && node !== boundary) {
    const type = node.dataset?.contextType
    if (type) {
      // Detect dual-frame hint (start/end) for shot types
      const framePanel = target.closest?.('[data-frame-key]')
      const frameHint = (framePanel && node.contains(framePanel)) ? framePanel.dataset.frameKey : null
      switch (type) {
        case 'shot':
          return {
            type: 'shot',
            label: `Storyboard - Scene ${node.dataset.sceneNumber} Shot ${node.dataset.shotNumber}${frameHint ? ` (${frameHint === 'start' ? 'Start' : 'End'} frame)` : ''}`,
            anchorId: node.dataset.shotId,
            sceneNumber: node.dataset.sceneNumber,
            shotNumber: node.dataset.shotNumber,
            frameHint,
          }
        case 'video-shot':
          return {
            type: 'video-shot',
            label: `Video - Scene ${node.dataset.sceneNumber} Shot ${node.dataset.shotNumber}`,
            anchorId: node.dataset.shotId,
            sceneNumber: node.dataset.sceneNumber,
            shotNumber: node.dataset.shotNumber,
          }
        case 'character':
          return {
            type: 'character',
            label: `Character - ${node.dataset.characterName || 'Unnamed'}`,
            anchorId: node.dataset.characterId,
            characterName: node.dataset.characterName,
          }
        case 'supplement': {
          const title = node.dataset.supplementTitle
          const hasTitle = title && title !== 'N/A' && title.trim()
          return {
            type: 'supplement',
            label: `Supplement${hasTitle ? ' - ' + title.slice(0, 30) : ''}`,
            anchorId: node.dataset.supplementId,
          }
        }
        case 'scene':
          return {
            type: 'scene',
            label: `Scene ${node.dataset.sceneNumber}`,
            anchorId: node.dataset.sceneId,
            sceneNumber: node.dataset.sceneNumber,
          }
        case 'character-lane':
          return { type: 'character-lane', label: 'Character', anchorId: null }
        case 'supplementary-lane':
          return { type: 'supplementary-lane', label: 'Supplementary', anchorId: null }
      }
    }
    node = node.parentElement
  }
  return null
}

export default function CanvasContextMenu({ position, context, onAddNote, onOpenAssistant, onClose }) {
  const menuRef = useRef(null)

  // Close on outside click, Escape, or scroll
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    function handleScroll() { onClose() }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [onClose])

  // Clamp to viewport edges
  const style = { top: position.y, left: position.x }
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) {
      el.style.left = (window.innerWidth - rect.width - 8) + 'px'
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = (window.innerHeight - rect.height - 8) + 'px'
    }
  }, [position])

  return createPortal(
    <div ref={menuRef} className="canvas-ctx-menu" style={style}>
      {context && (
        <div className="ctx-menu-label">{context.label}</div>
      )}
      <button className="ctx-menu-item" onClick={() => { onClose(); onAddNote() }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M3 1.5h8a1.5 1.5 0 011.5 1.5v7L9 13.5H3A1.5 1.5 0 011.5 12V3A1.5 1.5 0 013 1.5z" />
          <path d="M9 10v3.5L12.5 10H9z" />
        </svg>
        <span>Add a Note</span>
      </button>
      <button className="ctx-menu-item" onClick={() => { onClose(); onOpenAssistant() }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" />
        </svg>
        <span>FreeTitle Creative Asst.</span>
      </button>
    </div>,
    document.body
  )
}
