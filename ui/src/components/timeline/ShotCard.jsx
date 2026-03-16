import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AgentIndicator from './AgentIndicator'

// Find cover result for a specific frame of a dual-frame shot.
// Skips results with null/empty URLs so broken results never show as cover.
function frameCover(shot, frameKey, mediaType = 'image') {
  const frameNum = frameKey === 'end' ? 2 : 1
  const isVideo = mediaType === 'video'
  const rankKey = isVideo ? 'video_ranked_result_ids' : 'ranked_result_ids'
  const ranked = shot.frames?.[frameKey]?.[rankKey] || []
  const frameResults = shot.results.filter(r =>
    (r.frame_number || 1) === frameNum && (isVideo ? r.is_image === false : r.is_image !== false)
  )
  if (ranked.length) {
    for (const rid of ranked) {
      const found = frameResults.find(r => r.id === rid && r.url)
      if (found) return found
    }
  }
  return frameResults.find(r => r.url) || null
}

export default function ShotCard({ shot, locked, hasActiveTasks, hasNewResults, activeTasksByFrame, onClick, onEdit, onExplore, onDescChange, onRemove, onToggleLock, onToggleDualFrame, onView, mediaType = 'image', sceneNumber, noteCount = 0, onNoteClick, agentScopeKey, onAgentClick }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shot.id, disabled: locked })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const [showActionMenu, setShowActionMenu] = useState(false)
  const [menuPos, setMenuPos] = useState(null)
  const menuRef = useRef(null)
  const cardRef = useRef(null)

  const isDual = shot.dual_frame
  const isVideo = mediaType === 'video'

  // Single-frame cover — skip results with null/empty URLs
  const coverResult = !isDual
    ? (() => {
        if (isVideo) {
          const ranked = shot.video_ranked_result_ids || []
          const vids = shot.results.filter(r => r.is_image === false)
          for (const rid of ranked) {
            const found = vids.find(r => r.id === rid && r.url)
            if (found) return found
          }
          return vids.find(r => r.url) || null
        }
        const imgs = shot.results.filter(r => r.is_image !== false)
        for (const rid of (shot.ranked_result_ids || [])) {
          const found = imgs.find(r => r.id === rid && r.url)
          if (found) return found
        }
        return imgs.find(r => r.url) || null
      })()
    : null

  // Dual-frame covers
  const startCover = isDual ? frameCover(shot, 'start', mediaType) : null
  const endCover = isDual ? frameCover(shot, 'end', mediaType) : null

  // Filter results by media type for emptiness check
  const mediaResults = isVideo
    ? shot.results.filter(r => r.is_image === false)
    : shot.results.filter(r => r.is_image !== false)

  const isEmpty = !isDual
    ? mediaResults.length === 0
    : !startCover && !endCover

  // Position and close menu on outside click
  useEffect(() => {
    if (!showActionMenu) return
    // Position below the shot-wrapper (card + strip)
    const wrapper = cardRef.current?.parentElement
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 })
    }
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowActionMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showActionMenu])

  function handleCardClick(e) {
    if (locked) return
    if (isEmpty && onExplore) {
      e.stopPropagation()
      setShowActionMenu(prev => !prev)
      return
    }
    onEdit?.(isDual ? 'start' : null) || onClick?.()
  }

  return (
    <div ref={el => { setNodeRef(el); cardRef.current = el }} style={style} className={`shot-card ${locked ? 'locked' : ''} ${isDual ? 'dual-frame' : ''}`} data-context-type="shot" data-scene-number={sceneNumber} data-shot-number={shot.shot_number} data-shot-id={shot.id} onClick={handleCardClick}>
      <div className="shot-top-bar">
        {isDual ? (
          /* Dual-frame layout */
          locked ? (
            /* Locked dual: eye+lock left, note right */
            <>
              <div className="shot-top-actions">
                {startCover?.url && (
                  <button className="shot-view" onClick={e => { e.stopPropagation(); onView?.(startCover) }} title="View start frame">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="8" rx="7" ry="4" /><circle cx="8" cy="8" r="2" /></svg>
                  </button>
                )}
                <button
                  className="shot-lock active"
                  onClick={e => { e.stopPropagation(); onToggleLock() }}
                  title="Unlock shot"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M3 4V3a2 2 0 114 0v1h1v5H2V4h1zm1-1a1 1 0 112 0v1H4V3z" />
                  </svg>
                </button>
              </div>
              {noteCount > 0 && (
                <button className="shot-note-icon" onClick={e => { e.stopPropagation(); onNoteClick?.() }} title={`${noteCount} note${noteCount > 1 ? 's' : ''}`}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
                    <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                    <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
                  </svg>
                </button>
              )}
            </>
          ) : (
            /* Unlocked dual: two halves */
            <>
              <div className="shot-top-half">
                <div className="shot-drag-handle" {...attributes} {...listeners} />
                <div className="shot-top-actions">
                  <button className="shot-edit" onClick={e => { e.stopPropagation(); onEdit?.('start') }} title="Edit start frame">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" /></svg>
                  </button>
                  {startCover?.url && (
                    <button className="shot-view" onClick={e => { e.stopPropagation(); onView?.(startCover) }} title="View start frame">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="8" rx="7" ry="4" /><circle cx="8" cy="8" r="2" /></svg>
                    </button>
                  )}
                </div>
              </div>
              <div className="shot-top-half">
                <div className="shot-top-actions">
                  <button className="shot-edit" onClick={e => { e.stopPropagation(); onEdit?.('end') }} title="Edit end frame">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" /></svg>
                  </button>
                  {endCover?.url && (
                    <button className="shot-view" onClick={e => { e.stopPropagation(); onView?.(endCover) }} title="View end frame">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="8" rx="7" ry="4" /><circle cx="8" cy="8" r="2" /></svg>
                    </button>
                  )}
                </div>
                <div className="shot-top-actions">
                  <button
                    className={`shot-dual-toggle ${isDual ? 'active' : ''}`}
                    onClick={e => { e.stopPropagation(); onToggleDualFrame?.() }}
                    title="Switch to single frame"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                      <rect x="0.5" y="1" width="9" height="8" rx="1" />
                      <line x1="5" y1="1" x2="5" y2="9" />
                    </svg>
                  </button>
                  <button
                    className="shot-lock"
                    onClick={e => { e.stopPropagation(); onToggleLock() }}
                    title="Lock shot"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <path d="M3 4V3a2 2 0 114 0H6a1 1 0 10-2 0v1H3zm-1 0h6v5H2V4z" />
                    </svg>
                  </button>
                  <button className="shot-delete" onClick={e => { e.stopPropagation(); onRemove(e) }} title="Delete shot">
                    <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                      <line x1="2" y1="2" x2="8" y2="8" />
                      <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                  </button>
                  {noteCount > 0 && (
                    <button className="shot-note-icon" onClick={e => { e.stopPropagation(); onNoteClick?.() }} title={`${noteCount} note${noteCount > 1 ? 's' : ''}`}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
                        <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                        <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </>
          )
        ) : (
          /* Single-frame layout */
          locked ? (
            /* Locked single: eye+lock left, note right */
            <>
              <div className="shot-top-actions">
                {coverResult?.url && (
                  <button className="shot-view" onClick={e => { e.stopPropagation(); onView?.(coverResult) }} title="View result">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="8" rx="7" ry="4" /><circle cx="8" cy="8" r="2" /></svg>
                  </button>
                )}
                <button
                  className="shot-lock active"
                  onClick={e => { e.stopPropagation(); onToggleLock() }}
                  title="Unlock shot"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M3 4V3a2 2 0 114 0v1h1v5H2V4h1zm1-1a1 1 0 112 0v1H4V3z" />
                  </svg>
                </button>
              </div>
              {noteCount > 0 && (
                <button className="shot-note-icon" onClick={e => { e.stopPropagation(); onNoteClick?.() }} title={`${noteCount} note${noteCount > 1 ? 's' : ''}`}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
                    <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                    <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
                  </svg>
                </button>
              )}
            </>
          ) : (
            /* Unlocked single: standard layout */
            <>
              <div className="shot-drag-handle" {...attributes} {...listeners} />
              <div className="shot-top-actions">
                <button className="shot-edit" onClick={e => { e.stopPropagation(); onEdit?.(null) || onClick?.() }} title="Edit / Generate">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" /></svg>
                </button>
                {coverResult?.url && (
                  <button className="shot-view" onClick={e => { e.stopPropagation(); onView?.(coverResult) }} title="View result">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="8" rx="7" ry="4" /><circle cx="8" cy="8" r="2" /></svg>
                  </button>
                )}
                <button
                  className="shot-dual-toggle"
                  onClick={e => { e.stopPropagation(); onToggleDualFrame?.() }}
                  title="Switch to dual frame"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                    <rect x="0.5" y="1" width="9" height="8" rx="1" />
                    <line x1="5" y1="1" x2="5" y2="9" />
                  </svg>
                </button>
                <button
                  className="shot-lock"
                  onClick={e => { e.stopPropagation(); onToggleLock() }}
                  title="Lock shot"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M3 4V3a2 2 0 114 0H6a1 1 0 10-2 0v1H3zm-1 0h6v5H2V4z" />
                  </svg>
                </button>
                <button className="shot-delete" onClick={e => { e.stopPropagation(); onRemove(e) }} title="Delete shot">
                  <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                    <line x1="2" y1="2" x2="8" y2="8" />
                    <line x1="8" y1="2" x2="2" y2="8" />
                  </svg>
                </button>
                {noteCount > 0 && (
                  <button className="shot-note-icon" onClick={e => { e.stopPropagation(); onNoteClick?.() }} title={`${noteCount} note${noteCount > 1 ? 's' : ''}`}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
                      <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                      <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
                    </svg>
                  </button>
                )}
              </div>
            </>
          )
        )}
      </div>

      {isDual ? (
        /* Dual-frame: two side-by-side cover panels */
        <div className="shot-dual-covers">
          {[['start', startCover], ['end', endCover]].map(([fk, cover]) => (
            <div key={fk} className="shot-frame-panel" data-frame-key={fk} onClick={e => {
              e.stopPropagation()
              if (cover?.url) onView?.(cover)
              else if (!locked && isEmpty && onExplore) setShowActionMenu(prev => !prev)
              else if (!locked) onEdit?.(fk)
            }}>
              <div className="shot-cover">
                {cover?.url ? (
                  isVideo ? (
                    <div className="shot-video-cover">
                      <video src={cover.url} preload="metadata" />
                      <div className="play-icon-overlay">
                        <svg viewBox="0 0 24 24"><polygon points="8,5 19,12 8,19" /></svg>
                      </div>
                    </div>
                  ) : (
                    <img src={cover.thumb_url || cover.url} alt={`${fk} frame`} className="shot-cover-img" loading="lazy" decoding="async" />
                  )
                ) : (
                  <div className="shot-empty">S{shot.shot_number} {fk === 'start' ? 'Start' : 'End'}</div>
                )}
                <span className="shot-frame-label">{fk === 'start' ? 'Start' : 'End'}</span>
                {activeTasksByFrame?.[fk] && (
                  <div className="shot-generating-indicator">
                    <div className="mini-spinner" />
                  </div>
                )}
              </div>
            </div>
          ))}
          {hasNewResults && !hasActiveTasks && (
            <div className="new-dot top-right" />
          )}
          {agentScopeKey && (
            <AgentIndicator
              scopeKey={agentScopeKey}
              hasNewDot={hasNewResults && !hasActiveTasks}
              onClick={e => onAgentClick?.(agentScopeKey, e)}
            />
          )}
        </div>
      ) : (
        /* Single-frame cover */
        <div className="shot-cover" onClick={e => {
          e.stopPropagation()
          if (coverResult?.url) { onView?.(coverResult) }
          else if (!locked && isEmpty && onExplore) { setShowActionMenu(prev => !prev) }
          else if (!locked) { onEdit?.(null) || onClick?.() }
        }}>
          {coverResult?.url ? (
            isVideo ? (
              <div className="shot-video-cover">
                <video src={coverResult.url} preload="metadata" />
                <div className="play-icon-overlay">
                  <svg viewBox="0 0 24 24"><polygon points="8,5 19,12 8,19" /></svg>
                </div>
              </div>
            ) : (
              <img src={coverResult.thumb_url || coverResult.url} alt={`Shot ${shot.shot_number}`} className="shot-cover-img" loading="lazy" decoding="async" />
            )
          ) : (
            <div className="shot-empty">S{shot.shot_number}</div>
          )}
          {hasActiveTasks && (
            <div className="shot-generating-indicator">
              <div className="mini-spinner" />
            </div>
          )}
          {hasNewResults && !hasActiveTasks && (
            <div className="new-dot top-right" />
          )}
          {agentScopeKey && (
            <AgentIndicator
              scopeKey={agentScopeKey}
              hasNewDot={hasNewResults && !hasActiveTasks}
              onClick={e => onAgentClick?.(agentScopeKey, e)}
            />
          )}
        </div>
      )}

      <textarea
        className="shot-desc"
        value={shot.description}
        onChange={e => { e.stopPropagation(); onDescChange(e.target.value) }}
        onClick={e => e.stopPropagation()}
        placeholder={`Shot ${shot.shot_number} description...`}
        readOnly={locked}
      />

      {showActionMenu && menuPos && createPortal(
        <div
          ref={menuRef}
          className="shot-action-menu"
          style={{ top: menuPos.top, left: menuPos.left, transform: 'translateX(-50%)' }}
          onClick={e => e.stopPropagation()}
        >
          <button className="shot-action-option explore" onClick={() => { setShowActionMenu(false); onExplore?.() }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="8" cy="8" r="2" />
              <circle cx="8" cy="8" r="5" />
              <circle cx="8" cy="8" r="7" />
            </svg>
            <span className="shot-action-label">Explore & Ideate</span>
          </button>
          <button className="shot-action-option autopilot" onClick={() => {}}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v4l2.5 1.5" />
              <circle cx="8" cy="8" r="6.5" />
              <path d="M4.5 12.5l1-2.5h5l1 2.5" />
            </svg>
            <span className="shot-action-label">Auto Generate by Agent</span>
          </button>
          <button className="shot-action-option generate" onClick={() => { setShowActionMenu(false); onEdit?.(isDual ? 'start' : null) }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11l-1.5-3.5L3 6l3.5-1.5z" />
              <path d="M12 10l.75 1.75L14.5 12.5l-1.75.75L12 15l-.75-1.75L9.5 12.5l1.75-.75z" />
            </svg>
            <span className="shot-action-label">Manual Generate</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

