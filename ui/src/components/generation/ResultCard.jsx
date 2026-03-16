import { useState, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function formatElapsed(startTime) {
  if (!startTime) return ''
  const seconds = Math.floor((Date.now() - startTime) / 1000)
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

function providerBadgeClass(provider) {
  if (provider === 'nano_banana') return 'nb'
  if (provider === 'veo') return 'veo'
  if (provider === 'upload') return 'upload'
  return ''
}

function providerLabel(provider) {
  if (provider === 'nano_banana') return 'NB'
  if (provider === 'upload') return 'UP'
  return provider?.toUpperCase() || ''
}

const IMAGE_PROVIDERS = ['nano_banana']

// Use is_image field when available (uploads), fall back to provider check
function isImage(task) {
  if (task.is_image != null) return task.is_image
  return IMAGE_PROVIDERS.includes(task.provider)
}

export function SortableResultCard({ id, task, isSelected, onClick, onReapply, onRetry, onEdit, onDelete, onClearNew }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="sortable-result-wrapper">
      <div className="drag-handle" {...attributes} {...listeners}>
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="3" cy="3" r="1.5" />
          <circle cx="7" cy="3" r="1.5" />
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="7" cy="8" r="1.5" />
          <circle cx="3" cy="13" r="1.5" />
          <circle cx="7" cy="13" r="1.5" />
        </svg>
      </div>
      <ResultCard task={task} isSelected={isSelected} onClick={onClick} onReapply={onReapply} onRetry={onRetry} onEdit={onEdit} onDelete={onDelete} onClearNew={onClearNew} />
    </div>
  )
}

export default function ResultCard({ task, isSelected, onClick, onReapply, onRetry, onEdit, onDelete, selectable, isChecked, onToggleSelect, onClearNew }) {
  const done = task.status === 'succeed' && task.resultUrl
  const failed = task.status === 'failed' || task.status === 'error' || task.status === 'timeout'
  const processing = task.status === 'submitting' || task.status === 'submitted' || task.status === 'processing'
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Force re-render every second so elapsed timer stays live
  const [, tick] = useState(0)
  useEffect(() => {
    if (!processing) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [processing])

  function handleDownload(e) {
    e.stopPropagation()
    if (!task.resultUrl) return
    const a = document.createElement('a')
    a.href = task.resultUrl
    a.download = `${task.provider}_v${task.version}.${isImage(task) ? 'png' : 'mp4'}`
    a.target = '_blank'
    a.click()
  }

  return (
    <div className={`result-card ${isSelected ? 'selected' : ''}`}>
      <div
        className={`preview ${done ? 'clickable' : ''} ${selectable && (done || failed) ? 'clickable' : ''}`}
        onClick={() => selectable && (done || failed) ? onToggleSelect?.(task) : done ? onClick?.(task) : undefined}
      >
        {task.isNew && done && <div className="new-dot top-right" />}
        {selectable && (done || failed) && (
          <div className={`select-checkbox ${isChecked ? 'checked' : ''}`} />
        )}
        {processing && (
          <>
            <div className="loader" />
            <span className="loader-text">
              {task.status === 'submitting' ? 'Submitting...' : task.status === 'submitted' ? 'Queued...' : 'Processing...'}
              {task.startTime && ` ${formatElapsed(task.startTime)}`}
            </span>
          </>
        )}
        {failed && (
          <span style={{ color: 'var(--error)', fontSize: 13, padding: 12, textAlign: 'center' }}>
            {task.error || (task.status === 'timeout' ? 'Timed out' : 'Generation failed')}
          </span>
        )}
        {done && (
          isImage(task)
            ? <img src={task.mediumUrl || task.resultUrl} alt={`${task.provider} result`} />
            : <video src={task.resultUrl} controls preload="metadata" onPlay={() => { if (task.isNew) onClearNew?.(task.id) }} />
        )}
      </div>
      <div className="info">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`provider-badge ${providerBadgeClass(task.provider)}`}>
            {providerLabel(task.provider)}
          </span>
          {task.version > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{task.version}</span>
          )}
          <span className={`status ${task.status}`}>
            {task.status}
          </span>
        </div>
        <div className="actions">
          {(done || failed) && onReapply && task.provider !== 'upload' && (
            <button className="action-icon-btn" onClick={() => onReapply(task)} title="Reuse settings">
              <svg width="12" height="12" viewBox="2 2 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </button>
          )}
          {failed && onRetry && task.provider !== 'upload' && (
            <button className="action-icon-btn" onClick={() => onRetry(task)} title="Retry">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          {done && onEdit && isImage(task) && (
            <button className="action-icon-btn" onClick={() => onEdit(task)} title="Use as input image">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M8 5v6" />
                <path d="M5 8l3-3 3 3" />
              </svg>
            </button>
          )}
          {done && (
            <button
              className="action-icon-btn"
              onClick={handleDownload}
              title="Download"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v9M4 8l4 4 4-4" />
                <path d="M2 13h12" />
              </svg>
            </button>
          )}
          {onDelete && (done || failed) && (
            <button className="action-icon-btn delete" onClick={() => setConfirmDelete(true)} title="Delete">
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <p>Delete this result?</p>
            <div className="confirm-actions">
              <button onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="confirm-delete" onClick={() => { onDelete(task); setConfirmDelete(false) }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
