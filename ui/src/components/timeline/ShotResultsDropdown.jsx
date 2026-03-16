import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const PROVIDER_LABELS = { nano_banana: 'NB', upload: 'UP', veo: 'VEO' }
const PROVIDER_CLASSES = { nano_banana: 'nb', upload: 'upload', veo: 'veo' }

function providerLabel(p) { return PROVIDER_LABELS[p] || p }
function providerClass(p) { return PROVIDER_CLASSES[p] || '' }
function resultFilename(r) { return r.filename || `${providerLabel(r.provider)}_v${r.version || 1}` }

function SortableListThumb({ result, id, onResultClick, onDelete, selected, isVideo }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div ref={setNodeRef} style={style} className={`dropdown-thumb ${selected ? 'selected' : ''}`}>
      <div className="dropdown-drag-handle" {...attributes} {...listeners}>
        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
          <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
          <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
          <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
        </svg>
      </div>
      <div style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }} onClick={() => onResultClick?.(result)}>
        {isVideo ? (
          <div className="strip-video-thumb" style={{ display: 'inline-block' }}>
            <video src={result.url} preload="metadata" style={{ width: 50, height: 32, objectFit: 'cover', borderRadius: 3 }} />
          </div>
        ) : (
          <img src={result.thumb_url || result.url} alt="" />
        )}
        {result.isNew && <div className="new-dot small" />}
      </div>
      <span className={`provider-badge ${providerClass(result.provider)}`}>{providerLabel(result.provider)}</span>
      <span className="dropdown-filename">{resultFilename(result)}</span>
      {onDelete && (
        <button className="dropdown-delete-btn" onClick={e => { e.stopPropagation(); onDelete(result.id, e) }}>
          <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      )}
    </div>
  )
}

function SortableGridThumb({ result, id, onResultClick, onDelete, selected, isVideo }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div ref={setNodeRef} style={style} className={`dropdown-grid-thumb ${selected ? 'selected' : ''}`}>
      <div className="dropdown-grid-drag-handle" {...attributes} {...listeners}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
          <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
          <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
        </svg>
      </div>
      <div style={{ cursor: 'pointer' }} onClick={() => onResultClick?.(result)}>
        {isVideo ? (
          <video src={result.url} preload="metadata" style={{ width: '100%', display: 'block', borderRadius: 4 }} />
        ) : (
          <img src={result.thumb_url || result.url} alt="" />
        )}
      </div>
      {result.isNew && <div className="new-dot small" />}
      <span className={`grid-badge ${providerClass(result.provider)}`}>{providerLabel(result.provider)}</span>
      {onDelete && (
        <button className="dropdown-delete-btn" onClick={e => { e.stopPropagation(); onDelete(result.id, e) }}>
          <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default function ShotResultsDropdown({ shot, anchorEl, onClose, onResultClick, onRemoveResult, onRankChange, scale = 1, mediaType = 'image' }) {
  const [sortMode, setSortMode] = useState('preference')
  const [viewMode, setViewMode] = useState('list')
  const [gridCols, setGridCols] = useState(3) // 1-4 columns
  const dropdownRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const confirmPosRef = useRef(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id || !onRankChange) return
    const ids = shot.ranked_result_ids
    const oldIndex = ids.indexOf(active.id)
    const newIndex = ids.indexOf(over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      onRankChange(arrayMove(ids, oldIndex, newIndex))
    }
  }

  // Position below the anchor, account for dropdown's scaled size
  useEffect(() => {
    if (!anchorEl) return
    function update() {
      const rect = anchorEl.getBoundingClientRect()
      const dd = dropdownRef.current
      const ddHeight = dd ? dd.offsetHeight * scale : 300
      const ddWidth = dd ? dd.offsetWidth * scale : 220

      let top = rect.bottom + 4
      let left = rect.left

      if (left + ddWidth > window.innerWidth) {
        left = window.innerWidth - ddWidth - 8
      }
      if (left < 4) left = 4
      if (top + ddHeight > window.innerHeight) {
        top = rect.top - ddHeight - 4
      }
      if (top < 4) top = 4

      setPos({ top, left })
    }
    update()
    requestAnimationFrame(update)
  }, [anchorEl, scale])

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) && !anchorEl?.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, anchorEl])

  const rankedResults = sortMode === 'preference'
    ? shot.ranked_result_ids
        .map(id => shot.results.find(r => r.id === id))
        .filter(Boolean)
    : [...shot.results].reverse()

  const selectedId = shot.ranked_result_ids[0] || null

  if (shot.results.length === 0) {
    return (
      <div ref={dropdownRef} className="shot-dropdown" style={pos ? { top: pos.top, left: pos.left, transform: `scale(${scale})`, transformOrigin: 'top left' } : { visibility: 'hidden' }}>
        <div className="dropdown-header">
          <span>No results</span>
          <button className="dropdown-close" onClick={onClose}>&times;</button>
        </div>
      </div>
    )
  }

  return (
    <div ref={dropdownRef} className="shot-dropdown" style={pos ? { top: pos.top, left: pos.left, transform: `scale(${scale})`, transformOrigin: 'top left' } : { visibility: 'hidden' }}>
      <div className="dropdown-header">
        <div className="sort-toggle">
          <button
            className={sortMode === 'preference' ? 'active' : ''}
            onClick={() => setSortMode('preference')}
          >
            By Preference
          </button>
          <button
            className={sortMode === 'time' ? 'active' : ''}
            onClick={() => setSortMode('time')}
          >
            By Time
          </button>
        </div>
        <div className="dropdown-header-right">
          <button
            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="0" y1="2" x2="12" y2="2" />
              <line x1="0" y1="6" x2="12" y2="6" />
              <line x1="0" y1="10" x2="12" y2="10" />
            </svg>
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Gallery view"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="0.5" y="0.5" width="4.5" height="4.5" rx="0.5" />
              <rect x="7" y="0.5" width="4.5" height="4.5" rx="0.5" />
              <rect x="0.5" y="7" width="4.5" height="4.5" rx="0.5" />
              <rect x="7" y="7" width="4.5" height="4.5" rx="0.5" />
            </svg>
          </button>
          <button className="dropdown-close" onClick={onClose}>&times;</button>
        </div>
      </div>
      {viewMode === 'grid' && (
        <div className="grid-zoom-row">
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            value={5 - gridCols}
            onChange={e => setGridCols(5 - Number(e.target.value))}
          />
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="dropdown-results">
          {sortMode === 'preference' ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={shot.ranked_result_ids} strategy={verticalListSortingStrategy}>
                {rankedResults.map(r => (
                  <SortableListThumb key={r.id} id={r.id} result={r} onResultClick={onResultClick} onDelete={onRemoveResult ? (id, e) => { const r = e?.currentTarget?.getBoundingClientRect(); confirmPosRef.current = r ? { left: r.left, top: r.top + r.height + 4 } : null; setConfirmDeleteId(id) } : null} selected={r.id === selectedId} isVideo={mediaType === 'video'} />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            rankedResults.map(r => (
              <div key={r.id} className={`dropdown-thumb ${r.id === selectedId ? 'selected' : ''}`}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {mediaType === 'video' ? (
                    <video src={r.url} preload="metadata" onClick={e => { e.stopPropagation(); onResultClick?.(r) }} style={{ width: 50, height: 32, objectFit: 'cover', borderRadius: 3, cursor: 'pointer' }} />
                  ) : (
                    <img src={r.thumb_url || r.url} alt="" onClick={e => { e.stopPropagation(); onResultClick?.(r) }} />
                  )}
                  {r.isNew && <div className="new-dot small" />}
                </div>
                <span className={`provider-badge ${providerClass(r.provider)}`}>{providerLabel(r.provider)}</span>
                <span className="dropdown-filename">{resultFilename(r)}</span>
                {onRemoveResult && (
                  <button className="dropdown-delete-btn" onClick={e => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); confirmPosRef.current = { left: rect.left, top: rect.top + rect.height + 4 }; setConfirmDeleteId(r.id) }}>
                    <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                      <line x1="2" y1="2" x2="8" y2="8" />
                      <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="dropdown-results grid" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
          {sortMode === 'preference' ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={shot.ranked_result_ids} strategy={rectSortingStrategy}>
                {rankedResults.map(r => (
                  <SortableGridThumb key={r.id} id={r.id} result={r} onResultClick={onResultClick} onDelete={onRemoveResult ? (id, e) => { const r = e?.currentTarget?.getBoundingClientRect(); confirmPosRef.current = r ? { left: r.left, top: r.top + r.height + 4 } : null; setConfirmDeleteId(id) } : null} selected={r.id === selectedId} isVideo={mediaType === 'video'} />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            rankedResults.map(r => (
              <div key={r.id} className={`dropdown-grid-thumb ${r.id === selectedId ? 'selected' : ''}`}>
                {mediaType === 'video' ? (
                  <video src={r.url} preload="metadata" onClick={e => { e.stopPropagation(); onResultClick?.(r) }} style={{ width: '100%', display: 'block', cursor: 'pointer', borderRadius: 4 }} />
                ) : (
                  <img src={r.thumb_url || r.url} alt="" onClick={e => { e.stopPropagation(); onResultClick?.(r) }} />
                )}
                {r.isNew && <div className="new-dot small" />}
                <span className={`grid-badge ${providerClass(r.provider)}`}>{providerLabel(r.provider)}</span>
                {onRemoveResult && (
                  <button className="dropdown-delete-btn" onClick={e => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); confirmPosRef.current = { left: rect.left, top: rect.top + rect.height + 4 }; setConfirmDeleteId(r.id) }}>
                    <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                      <line x1="2" y1="2" x2="8" y2="8" />
                      <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {confirmDeleteId && createPortal(
        <div className="confirm-overlay-fixed" onClick={() => setConfirmDeleteId(null)}>
          <div
            className="confirm-box"
            onClick={e => e.stopPropagation()}
            style={confirmPosRef.current ? { position: 'fixed', left: confirmPosRef.current.left, top: confirmPosRef.current.top, transform: 'translate(-100%, 0)' } : undefined}
          >
            <p>Delete this result?</p>
            <div className="confirm-actions">
              <button onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button className="confirm-delete" onClick={() => { onRemoveResult(confirmDeleteId); setConfirmDeleteId(null) }}>Delete</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
