import { useState, useRef, memo } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import ShotCard from './ShotCard'
import ShotResultsDropdown from './ShotResultsDropdown'
import AgentIndicator from './AgentIndicator'

// Sortable wrapper for video shot cards
function SortableVideoShot({ id, disabled, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className="shot-wrapper">
      {children({ dragHandleProps: disabled ? {} : { ...attributes, ...listeners } })}
    </div>
  )
}

// Filter results by frame number
function frameResults(shot, frameNum) {
  return shot.results.filter(r => (r.frame_number || 1) === frameNum)
}

// Ranked results for a specific frame (or all results for single-frame)
function rankedFrameResults(shot, frameKey, mediaType = 'image') {
  const isVideo = mediaType === 'video'
  const filterFn = isVideo ? (r => r.is_image === false) : (r => r.is_image !== false)

  if (!frameKey) {
    const rankKey = isVideo ? 'video_ranked_result_ids' : 'ranked_result_ids'
    const rankedIds = shot[rankKey] || []
    const filtered = shot.results.filter(filterFn)
    if (rankedIds.length > 0) {
      return rankedIds.map(id => filtered.find(r => r.id === id)).filter(Boolean)
    }
    return [...filtered].reverse()
  }
  const frameNum = frameKey === 'end' ? 2 : 1
  const results = frameResults(shot, frameNum).filter(filterFn)
  const rankKey = isVideo ? 'video_ranked_result_ids' : 'ranked_result_ids'
  const ranked = shot.frames?.[frameKey]?.[rankKey] || []
  if (ranked.length > 0) {
    return ranked.map(id => results.find(r => r.id === id)).filter(Boolean)
  }
  return [...results].reverse()
}

export default memo(function SceneLane({
  scene,
  layout = 'horizontal',
  onToggleCollapse,
  onDescChange,
  onShotClick,
  onShotExplore,
  onShotDescChange,
  onAddShot,
  onRemoveScene,
  onRemoveShot,
  onToggleSceneLock,
  onToggleShowVideos,
  onToggleShowStoryboard,
  onToggleShotLock,
  onToggleVideoShotLock,
  onToggleDualFrame,
  onLightboxOpen,
  onRemoveResult,
  onVideoShotClick,
  onRankChange,
  onVideoRankChange,
  onAddVideoShot,
  onRemoveVideoShot,
  onRemoveVideoResult,
  onVideoShotDescChange,
  onImportFromStoryboard,
  onReorderVideoShots,
  activeTasks,
  zoomScale,
  noteCountByShot = {},
  sceneNoteCount = 0,
  onNoteToggle,
  agentScopeMap = {},
  onAgentIndicatorClick,
}) {
  const [dropdownShotId, setDropdownShotId] = useState(null)
  const [dropdownFrame, setDropdownFrame] = useState(null) // null | 'start' | 'end'
  const [dropdownMediaType, setDropdownMediaType] = useState('image')
  const dropdownAnchorRef = useRef(null)
  const [confirmDelete, setConfirmDelete] = useState(null) // 'scene' | shotId | null
  const confirmPosRef = useRef(null)

  const locked = scene.locked
  const sbNoteCount = scene.shots.reduce((sum, s) => sum + (noteCountByShot[s.id] || 0), 0)
  const videoNoteCount = (scene.video_shots || []).reduce((sum, v) => sum + (noteCountByShot[v.id] || 0), 0)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: scene.id, disabled: locked })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const shotIds = scene.shots.map(s => s.id)

  function handleDeleteScene(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    confirmPosRef.current = {
      left: rect.left + rect.width / 2,
      top: rect.bottom + 4,
    }
    setConfirmDelete('scene')
  }

  function handleDeleteShot(shotId, e) {
    if (e) {
      const rect = e.currentTarget.getBoundingClientRect()
      confirmPosRef.current = {
        left: rect.left + rect.width / 2,
        top: rect.bottom + 4,
      }
    }
    setConfirmDelete(shotId)
  }

  function confirmAction() {
    if (confirmDelete === 'scene') {
      onRemoveScene(scene.id)
    } else if (typeof confirmDelete === 'string' && confirmDelete.startsWith('video_')) {
      onRemoveVideoShot?.(scene.id, confirmDelete.slice(6))
    } else {
      onRemoveShot(scene.id, confirmDelete)
    }
    setConfirmDelete(null)
  }

  // Check if a shot has active tasks for a specific frame
  function hasActiveTasksForFrame(shotId, frameNum) {
    const tasks = activeTasks?.[shotId] || []
    return tasks.some(t =>
      !['succeed', 'failed', 'timeout', 'error'].includes(t.status) &&
      (t.frameNumber || 1) === frameNum
    )
  }

  function openDropdown(e, shotId, frame = null, mediaType = 'image') {
    e.stopPropagation()
    dropdownAnchorRef.current = e.currentTarget
    if (dropdownShotId === shotId && dropdownFrame === frame && dropdownMediaType === mediaType) {
      setDropdownShotId(null)
      setDropdownFrame(null)
    } else {
      setDropdownShotId(shotId)
      setDropdownFrame(frame)
      setDropdownMediaType(mediaType)
    }
  }

  // Build strip thumbnails for a frame
  function stripThumbs(shot, frameKey, mediaType = 'image') {
    const ranked = rankedFrameResults(shot, frameKey, mediaType)
    return ranked.slice(0, 4)
  }

  // Video cover for a video shot (top-ranked or first result)
  function videoCover(vshot) {
    const ranked = vshot.ranked_result_ids || []
    const results = vshot.results || []
    return (ranked[0] && results.find(r => r.id === ranked[0])) || results[0] || null
  }

  // Strip thumbnails for a video shot
  function videoStripThumbs(vshot) {
    const ranked = vshot.ranked_result_ids || []
    const results = vshot.results || []
    if (ranked.length > 0) {
      return ranked.slice(0, 4).map(id => results.find(r => r.id === id)).filter(Boolean)
    }
    return [...results].reverse().slice(0, 4)
  }

  function handleDeleteVideoShot(shotId, e) {
    if (e) {
      const rect = e.currentTarget.getBoundingClientRect()
      confirmPosRef.current = {
        left: rect.left + rect.width / 2,
        top: rect.bottom + 4,
      }
    }
    setConfirmDelete(`video_${shotId}`)
  }

  const showStoryboard = scene.show_storyboard !== false

  return (
    <div ref={setNodeRef} style={style} className={`scene-group ${locked ? 'locked' : ''} ${scene.collapsed ? 'collapsed' : ''}`} data-context-type="scene" data-scene-id={scene.id} data-scene-number={scene.scene_number}>
      {/* Scene header — shared across lanes */}
      <div className="scene-header-bar">
        <div className="scene-header">
          <button className="scene-collapse" onClick={() => onToggleCollapse(scene.id)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              {scene.collapsed
                ? <path d="M3 1l5 4-5 4V1z" />
                : layout === 'horizontal'
                  ? <path d="M7 1l-5 4 5 4V1z" />
                  : <path d="M1 3l4 5 4-5H1z" />
              }
            </svg>
          </button>
          {!locked && <span className="scene-drag-handle" {...attributes} {...listeners} />}
          <span className="scene-title">Scene {scene.scene_number}</span>
          {sceneNoteCount > 0 && (
            <button className="scene-note-icon" onClick={e => { e.stopPropagation(); onNoteToggle?.(scene.id) }} title={`${sceneNoteCount} note${sceneNoteCount > 1 ? 's' : ''}`}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
                <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
              </svg>
            </button>
          )}
          <input
            className="scene-desc-inline"
            value={scene.description}
            onChange={e => onDescChange(scene.id, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            placeholder="Description..."
            readOnly={locked}
            onClick={e => e.stopPropagation()}
          />
          {scene.collapsed && (
            <span className="scene-shot-count">
              ({scene.shots.length} shot{scene.shots.length !== 1 ? 's' : ''}
              {(scene.video_shots || []).length > 0 && `, ${(scene.video_shots || []).length} video`})
            </span>
          )}
          <div className="scene-header-actions">
            <button
              className={`scene-lock ${locked ? 'active' : ''}`}
              onClick={() => onToggleSceneLock(scene.id)}
              title={locked ? 'Unlock scene' : 'Lock scene'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                {locked
                  ? <path d="M3 4V3a2 2 0 114 0v1h1v5H2V4h1zm1-1a1 1 0 112 0v1H4V3z" />
                  : <path d="M3 4V3a2 2 0 114 0H6a1 1 0 10-2 0v1H3zm-1 0h6v5H2V4z" />
                }
              </svg>
            </button>
            {!locked && (
              <button className="scene-delete" onClick={handleDeleteScene} title="Delete scene">
                <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                  <line x1="2" y1="2" x2="8" y2="8" />
                  <line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Storyboard lane + video button wrapper */}
      {!scene.collapsed && showStoryboard && (
        <div className="storyboard-area">
        <div className="scene-lane">
          <div className="scene-row">
            <span className="scene-row-label">Storyboard</span>
            {sbNoteCount > 0 && (
              <span className="row-note-icon" title={`${sbNoteCount} shot note${sbNoteCount > 1 ? 's' : ''}`}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
                  <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                  <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
                </svg>
              </span>
            )}
          </div>
          <div className="scene-shots">
            <SortableContext items={shotIds} strategy={horizontalListSortingStrategy}>
              {scene.shots.map(shot => {
                const isDual = shot.dual_frame
                const shotTasks = activeTasks?.[shot.id] || []
                const hasAnyActive = shotTasks.some(t => !['succeed', 'failed', 'timeout', 'error'].includes(t.status))
                const hasNew = shot.results.some(r => r.isNew && r.is_image !== false)

                return (
                  <div key={shot.id} className="shot-wrapper">
                    <ShotCard
                      shot={shot}
                      locked={locked || shot.locked}
                      hasActiveTasks={hasAnyActive}
                      hasNewResults={hasNew}
                      activeTasksByFrame={isDual ? {
                        start: hasActiveTasksForFrame(shot.id, 1),
                        end: hasActiveTasksForFrame(shot.id, 2),
                      } : null}
                      sceneNumber={scene.scene_number}
                      noteCount={noteCountByShot[shot.id] || 0}
                      onNoteClick={() => onNoteToggle?.(shot.id)}
                      onEdit={(frame) => onShotClick(scene.id, shot.id, frame)}
                      onExplore={() => onShotExplore?.(scene.id, shot.id)}
                      onDescChange={(desc) => onShotDescChange(scene.id, shot.id, desc)}
                      onRemove={(e) => handleDeleteShot(shot.id, e)}
                      onToggleLock={() => onToggleShotLock(scene.id, shot.id)}
                      onToggleDualFrame={() => onToggleDualFrame?.(scene.id, shot.id)}
                      onView={(result) => onLightboxOpen?.(result, rankedFrameResults(shot, null, 'image'), scene.id, shot.id)}
                      agentScopeKey={agentScopeMap[shot.id] || null}
                      onAgentClick={onAgentIndicatorClick}
                    />

                    {isDual ? (
                      <div className="shot-dual-strips">
                        {['start', 'end'].map(fk => {
                          const fn = fk === 'end' ? 2 : 1
                          const fr = frameResults(shot, fn).filter(r => r.is_image !== false)
                          const thumbs = stripThumbs(shot, fk, 'image')
                          return (
                            <div
                              key={fk}
                              className={`shot-results-strip ${fr.length > 0 ? 'has-results' : ''}`}
                              onClick={(e) => { if (fr.length > 0) openDropdown(e, shot.id, fk, 'image') }}
                            >
                              {fr.length > 0 && (
                                <>
                                  {thumbs.map(r => <img key={r.id} src={r.thumb_url || r.url} alt="" className="strip-thumb" loading="lazy" decoding="async" />)}
                                  <span className="strip-count">{fr.length}</span>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      (() => {
                        const imageResults = shot.results.filter(r => r.is_image !== false)
                        return (
                          <div
                            className={`shot-results-strip ${imageResults.length > 0 ? 'has-results' : ''}`}
                            onClick={(e) => { if (imageResults.length > 0) openDropdown(e, shot.id, null, 'image') }}
                          >
                            {imageResults.length > 0 && (
                              <>
                                {stripThumbs(shot, null, 'image').map(r => (
                                  <img key={r.id} src={r.thumb_url || r.url} alt="" className="strip-thumb" loading="lazy" decoding="async" />
                                ))}
                                <span className="strip-count">{imageResults.length}</span>
                              </>
                            )}
                          </div>
                        )
                      })()
                    )}

                    {dropdownShotId === shot.id && dropdownMediaType === 'image' && createPortal(
                      <ShotResultsDropdown
                        shot={(() => {
                          const isDual = shot.dual_frame
                          if (isDual && dropdownFrame) {
                            return {
                              ...shot,
                              results: frameResults(shot, dropdownFrame === 'end' ? 2 : 1).filter(r => r.is_image !== false),
                              ranked_result_ids: shot.frames?.[dropdownFrame]?.ranked_result_ids || [],
                            }
                          }
                          return {
                            ...shot,
                            results: shot.results.filter(r => r.is_image !== false),
                          }
                        })()}
                        anchorEl={dropdownAnchorRef.current}
                        onClose={() => { setDropdownShotId(null); setDropdownFrame(null) }}
                        onResultClick={(result) => {
                          setDropdownShotId(null)
                          setDropdownFrame(null)
                          onLightboxOpen?.(result, rankedFrameResults(shot, dropdownFrame, 'image'), scene.id, shot.id)
                        }}
                        onRemoveResult={(resultId) => onRemoveResult?.(scene.id, shot.id, resultId)}
                        onRankChange={(ids) => onRankChange?.(scene.id, shot.id, ids, dropdownFrame)}
                        scale={zoomScale}
                      />,
                      document.body
                    )}
                  </div>
                )
              })}
            </SortableContext>
            {!locked && (
              <button className="add-shot-btn" onClick={() => onAddShot(scene.id)}>+ Shot</button>
            )}
          </div>
        </div>

        {/* Video hidden: collapsed bar (has data) or dashed add button (no data) */}
        {!scene.show_videos && (
          (scene.video_shots || []).length > 0 ? (
            <button className="video-collapsed-bar" onClick={() => onToggleShowVideos?.(scene.id)}>
              <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                <path d={layout === 'horizontal' ? 'M1 3l4 5 4-5H1z' : 'M3 1l5 4-5 4V1z'} />
              </svg>
              <span>Video ({(scene.video_shots || []).length})</span>
            </button>
          ) : !locked && (
            <button className="add-video-btn" onClick={() => onToggleShowVideos?.(scene.id)}>+ Video</button>
          )
        )}
        </div>
      )}

      {/* Video lane */}
      {!scene.collapsed && scene.show_videos && (
        <div className="video-lane">
          {!locked && (
            <button className="video-lane-collapse" onClick={() => onToggleShowVideos?.(scene.id)} title="Collapse video lane">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d={layout === 'horizontal' ? 'M1 7l4-5 4 5H1z' : 'M7 1l-5 4 5 4V1z'} />
              </svg>
            </button>
          )}
          <div className="scene-row">
            <span className="scene-row-label">Video</span>
            {videoNoteCount > 0 && (
              <span className="row-note-icon" title={`${videoNoteCount} video note${videoNoteCount > 1 ? 's' : ''}`}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
                  <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                  <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
                </svg>
              </span>
            )}
          </div>
          <div className="scene-shots video-shots">
            <SortableContext items={(scene.video_shots || []).map(v => v.id)} strategy={horizontalListSortingStrategy}>
            {(scene.video_shots || []).map(vshot => {
              const cover = videoCover(vshot)
              const shotLocked = vshot.locked
              const videoResults = vshot.results || []
              const vshotTasks = activeTasks?.[vshot.id] || []
              const hasActiveVideoTasks = vshotTasks.some(t => !['succeed', 'failed', 'timeout', 'error'].includes(t.status))
              const hasNewVideo = videoResults.some(r => r.isNew)

              return (
                <SortableVideoShot key={vshot.id} id={vshot.id} disabled={locked || shotLocked}>
                  {({ dragHandleProps }) => (
                    <>
                  <div className={`shot-card ${shotLocked ? 'locked' : ''}`} data-context-type="video-shot" data-scene-number={scene.scene_number} data-shot-number={vshot.shot_number} data-shot-id={vshot.id}>
                    <div className="shot-top-bar">
                      {!(locked || shotLocked) && <div className="shot-drag-handle" {...dragHandleProps} />}
                      <div className="shot-top-actions">
                        {(noteCountByShot[vshot.id] || 0) > 0 && (
                          <button className="shot-note-icon" onClick={e => { e.stopPropagation(); onNoteToggle?.(vshot.id) }} title={`${noteCountByShot[vshot.id]} note${noteCountByShot[vshot.id] > 1 ? 's' : ''}`}>
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
                              <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                              <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
                            </svg>
                          </button>
                        )}
                        {!shotLocked && (
                          <button className="shot-edit" onClick={e => { e.stopPropagation(); onVideoShotClick?.(scene.id, vshot.id) }} title="Edit video">
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" /></svg>
                          </button>
                        )}
                        {cover?.url && (
                          <button className="shot-view" onClick={e => {
                            e.stopPropagation()
                            onLightboxOpen?.(cover, videoResults.filter(r => r.url), scene.id, vshot.id)
                          }} title="View video">
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="8" rx="7" ry="4" /><circle cx="8" cy="8" r="2" /></svg>
                          </button>
                        )}
                        {!shotLocked && (
                          <button className="shot-import" onClick={e => { e.stopPropagation(); onImportFromStoryboard?.(scene.id, vshot.id) }} title="Import frames from storyboard">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="1.5" y="4.5" width="7" height="5" rx="1" />
                              <path d="M5 1v4M3 3l2 2 2-2" />
                            </svg>
                          </button>
                        )}
                        <button
                          className={`shot-lock ${shotLocked ? 'active' : ''}`}
                          onClick={e => { e.stopPropagation(); onToggleVideoShotLock?.(scene.id, vshot.id) }}
                          title={shotLocked ? 'Unlock video' : 'Lock video'}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                            {shotLocked
                              ? <path d="M3 4V3a2 2 0 114 0v1h1v5H2V4h1zm1-1a1 1 0 112 0v1H4V3z" />
                              : <path d="M3 4V3a2 2 0 114 0H6a1 1 0 10-2 0v1H3zm-1 0h6v5H2V4z" />
                            }
                          </svg>
                        </button>
                        {!shotLocked && (
                          <button className="shot-delete" onClick={e => { e.stopPropagation(); handleDeleteVideoShot(vshot.id, e) }} title="Delete video shot">
                            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                              <line x1="2" y1="2" x2="8" y2="8" />
                              <line x1="8" y1="2" x2="2" y2="8" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="shot-cover" onClick={() => {
                      if (cover?.url) onLightboxOpen?.(cover, videoResults.filter(r => r.url), scene.id, vshot.id)
                      else if (!shotLocked) onVideoShotClick?.(scene.id, vshot.id)
                    }}>
                      {cover?.url ? (
                        <div className="shot-video-cover">
                          <video src={cover.url} preload="metadata" />
                          <div className="play-icon-overlay">
                            <svg viewBox="0 0 24 24"><polygon points="8,5 19,12 8,19" /></svg>
                          </div>
                        </div>
                      ) : (
                        <div className="shot-empty">Sc{scene.scene_number} Sh{vshot.shot_number} Video</div>
                      )}
                      {hasActiveVideoTasks && (
                        <div className="shot-generating-indicator">
                          <div className="mini-spinner" />
                        </div>
                      )}
                      {hasNewVideo && !hasActiveVideoTasks && (
                        <div className="new-dot top-right" />
                      )}
                      {agentScopeMap[vshot.id] && (
                        <AgentIndicator
                          scopeKey={agentScopeMap[vshot.id]}
                          hasNewDot={hasNewVideo && !hasActiveVideoTasks}
                          onClick={e => onAgentIndicatorClick?.(agentScopeMap[vshot.id], e)}
                        />
                      )}
                    </div>

                    <textarea
                      className="shot-desc"
                      value={vshot.description}
                      onChange={e => onVideoShotDescChange?.(scene.id, vshot.id, e.target.value)}
                      placeholder={`Video ${vshot.shot_number}`}
                      readOnly={shotLocked}
                    />
                  </div>

                  <div
                    className={`shot-results-strip ${videoResults.length > 0 ? 'has-results' : ''}`}
                    onClick={(e) => { if (videoResults.length > 0) openDropdown(e, vshot.id, null, 'video') }}
                  >
                    {videoResults.length > 0 && (
                      <>
                        {videoStripThumbs(vshot).map(r => (
                          <div key={r.id} className="strip-video-thumb">
                            <video src={r.url} preload="metadata" className="strip-thumb" />
                          </div>
                        ))}
                        <span className="strip-count">{videoResults.length}</span>
                      </>
                    )}
                  </div>

                  {dropdownShotId === vshot.id && dropdownMediaType === 'video' && createPortal(
                    <ShotResultsDropdown
                      shot={vshot}
                      mediaType="video"
                      anchorEl={dropdownAnchorRef.current}
                      onClose={() => { setDropdownShotId(null); setDropdownFrame(null) }}
                      onResultClick={(result) => {
                        setDropdownShotId(null)
                        setDropdownFrame(null)
                        onLightboxOpen?.(result, videoResults.filter(r => r.url), scene.id, vshot.id)
                      }}
                      onRemoveResult={(resultId) => onRemoveVideoResult?.(scene.id, vshot.id, resultId)}
                      onRankChange={(ids) => onVideoRankChange?.(scene.id, vshot.id, ids)}
                      scale={zoomScale}
                    />,
                    document.body
                  )}
                    </>
                  )}
                </SortableVideoShot>
              )
            })}
            </SortableContext>
            {!locked && (
              <button className="add-shot-btn" onClick={() => onAddVideoShot?.(scene.id)}>+ Shot</button>
            )}
          </div>
        </div>
      )}

      {/* Confirm delete overlay */}
      {confirmDelete && createPortal(
        <div className="confirm-overlay-fixed" onClick={() => setConfirmDelete(null)}>
          <div
            className="confirm-box"
            onClick={e => e.stopPropagation()}
            style={confirmPosRef.current ? {
              position: 'fixed',
              left: confirmPosRef.current.left,
              top: confirmPosRef.current.top,
              transform: 'translate(-50%, 0)',
            } : undefined}
          >
            <p>Delete {confirmDelete === 'scene' ? `Scene ${scene.scene_number}` : typeof confirmDelete === 'string' && confirmDelete.startsWith('video_') ? 'Video Shot' : 'Shot'}?</p>
            <div className="confirm-actions">
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="confirm-delete" onClick={confirmAction}>Delete</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
})
