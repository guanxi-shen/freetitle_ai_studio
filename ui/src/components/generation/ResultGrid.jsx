import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { uploadImage } from '../../services/api'
import ResultCard, { SortableResultCard } from './ResultCard'
import DestinationPicker from './DestinationPicker'

const TERMINAL_STATUSES = ['succeed', 'failed', 'timeout', 'error']

export default function ResultGrid({ tasks, completedResults, onLightboxOpen, onReapply, onRetry, onEdit, onDelete, rankedResultIds, onRankChange, onResultUpload, onBrowseProject, hasProjectImages, sectionLabel = 'Results', showSelected = true, onSendToDestination, projectScenes, supplementaryItems = [], onSupplementaryClick, onSupplementaryEdit, onSupplementaryDelete, sortMode: sortModeProp, onSortModeChange, onClearNew }) {
  const [sortModeLocal, setSortModeLocal] = useState('preference')
  const sortMode = sortModeProp ?? sortModeLocal
  const setSortMode = onSortModeChange ?? setSortModeLocal
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showDestPicker, setShowDestPicker] = useState(false)

  // First in ranked order is the active/selected result (used as cover in timeline)
  const selectedId = showSelected ? (rankedResultIds?.[0] || null) : null
  // Terminal tasks (succeed/failed/error) move to completedResults via onComplete
  const activeTasks = tasks.filter(t => !TERMINAL_STATUSES.includes(t.status))
  const hasActive = activeTasks.length > 0
  const hasCompleted = completedResults?.length > 0

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const uploadRef = useRef(null)
  const menuRef = useRef(null)
  const destRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAddMenu) return
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowAddMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddMenu])

  const toggleSelect = useCallback((task) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(task.id)) next.delete(task.id)
      else next.add(task.id)
      return next
    })
  }, [])

  const allCompletedIds = useMemo(() => [
    ...(completedResults || []).filter(r => (r.resultUrl || r.url || r.status === 'failed' || r.status === 'error' || r.status === 'timeout')).map(r => r.id),
    ...supplementaryItems.filter(s => s.resultUrl).map(s => s.id),
  ], [completedResults, supplementaryItems])

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
    setShowDestPicker(false)
  }

  function handleSelectAll() {
    setSelectedIds(new Set(allCompletedIds))
  }

  function handleDeleteSelected() {
    for (const id of selectedIds) {
      const item = completedResults.find(r => r.id === id)
      if (item && onDelete) { onDelete(item); continue }
      const supp = supplementaryItems.find(s => s.id === id)
      if (supp && onSupplementaryDelete) onSupplementaryDelete(supp._key)
    }
    exitSelectMode()
  }

  function handleMoveSelected(destination) {
    if (!onSendToDestination) return
    const selected = [
      ...(completedResults || []).filter(r => selectedIds.has(r.id)),
      ...supplementaryItems.filter(s => selectedIds.has(s.id)),
    ]
    onSendToDestination(selected, destination)
    exitSelectMode()
  }

  async function handleUploadFiles(files) {
    if (!files?.length || !onResultUpload) return
    setUploading(true)
    for (const file of Array.from(files)) {
      try {
        const data = await uploadImage(file)
        const isImg = file.type.startsWith('image/')
        onResultUpload({
          url: data.url,
          provider: 'upload',
          is_image: isImg,
          prompt: '',
          config: {},
          timestamp: new Date().toISOString(),
          needsMigration: true,
        })
      } catch (err) {
        console.error('Upload failed:', err)
      }
    }
    setUploading(false)
    if (uploadRef.current) uploadRef.current.value = ''
  }

  if (!hasActive && !hasCompleted && !onResultUpload) return null

  // Order completed results based on sort mode
  let orderedCompleted
  if (sortMode === 'preference' && rankedResultIds?.length > 0) {
    orderedCompleted = rankedResultIds
      .map(id => completedResults.find(r => r.id === id))
      .filter(Boolean)
  } else {
    // Time sort: newest first (results stored chronologically, so reverse)
    orderedCompleted = [...(completedResults || [])].reverse()
  }

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id || !rankedResultIds || !onRankChange) return
    const oldIndex = rankedResultIds.indexOf(active.id)
    const newIndex = rankedResultIds.indexOf(over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      onRankChange(arrayMove(rankedResultIds, oldIndex, newIndex))
    }
  }

  const showSortToggle = hasCompleted && rankedResultIds?.length > 0
  const canSelect = (hasCompleted || supplementaryItems.length > 0) && !!onSendToDestination
  // Disable drag when in select mode
  const isDraggable = !selectMode && sortMode === 'preference' && rankedResultIds?.length > 0

  return (
    <div className="results-section">
      {/* Select mode action bar */}
      {selectMode ? (
        <div className="results-select-bar">
          <span className="results-select-count">{selectedIds.size} selected</span>
          <div className="results-select-actions">
            {selectedIds.size < allCompletedIds.length && (
              <button className="results-select-btn" onClick={handleSelectAll}>Select all</button>
            )}
            {selectedIds.size > 0 && (onDelete || onSupplementaryDelete) && (
              <button className="results-select-btn danger" onClick={handleDeleteSelected}>Delete</button>
            )}
            {selectedIds.size > 0 && (
              <div ref={destRef} style={{ position: 'relative' }}>
                <button className="results-select-btn accent" onClick={() => setShowDestPicker(p => !p)}>Move to</button>
                {showDestPicker && (
                  <DestinationPicker
                    scenes={projectScenes}
                    onSelect={(dest) => { setShowDestPicker(false); handleMoveSelected(dest) }}
                    onClose={() => setShowDestPicker(false)}
                  />
                )}
              </div>
            )}
            <button className="results-select-btn" onClick={exitSelectMode}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="results-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2>{sectionLabel}</h2>
            {onResultUpload && (
              <>
                <input
                  ref={uploadRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => {
                    handleUploadFiles(e.target.files)
                    setShowAddMenu(false)
                  }}
                />
                <div ref={menuRef} style={{ position: 'relative' }}>
                  <button
                    className="result-upload-btn"
                    onClick={() => setShowAddMenu(prev => !prev)}
                    disabled={uploading}
                  >
                    {uploading ? '...' : '+'}
                  </button>
                  {showAddMenu && (
                    <div className="result-add-menu">
                      <button
                        className="result-add-menu-item"
                        onClick={() => {
                          uploadRef.current?.click()
                        }}
                      >
                        Upload
                      </button>
                      {hasProjectImages && onBrowseProject && (
                        <button
                          className="result-add-menu-item"
                          onClick={() => {
                            setShowAddMenu(false)
                            onBrowseProject()
                          }}
                        >
                          Browse project
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showSortToggle && (
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
            )}
            {canSelect && (
              <button className="results-select-toggle" onClick={() => setSelectMode(true)}>Select</button>
            )}
          </div>
        </div>
      )}

      <div className="results-grid">
        {/* Active tasks always at top, not draggable */}
        {activeTasks.map(task => (
          <ResultCard
            key={`${task.provider}-${task.taskId}`}
            task={task}
            onClick={onLightboxOpen}
            onReapply={onReapply}
          />
        ))}

        {/* Completed results: draggable in preference mode (disabled in select mode) */}
        {isDraggable ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={rankedResultIds} strategy={rectSortingStrategy}>
              {orderedCompleted.map(task => (
                <SortableResultCard
                  key={task.id}
                  id={task.id}
                  task={task}
                  isSelected={task.id === selectedId}
                  onClick={onLightboxOpen}
                  onReapply={onReapply}
                  onRetry={onRetry}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onClearNew={onClearNew}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          orderedCompleted.map((task, i) => (
            <ResultCard
              key={task.id || `completed-${i}`}
              task={task}
              isSelected={task.id === selectedId}
              onClick={onLightboxOpen}
              onReapply={onReapply}
              onRetry={onRetry}
              onEdit={onEdit}
              onDelete={onDelete}
              selectable={selectMode}
              isChecked={selectedIds.has(task.id)}
              onToggleSelect={toggleSelect}
              onClearNew={onClearNew}
            />
          ))
        )}

        {/* Supplementary items in select mode */}
        {selectMode && supplementaryItems.length > 0 && (
          <>
            <div className="results-grid-divider">Supplementary</div>
            {supplementaryItems.map(task => (
              <ResultCard
                key={task._key}
                task={task}
                onClick={onSupplementaryClick}
                onEdit={onSupplementaryEdit}
                onDelete={onSupplementaryDelete ? () => onSupplementaryDelete(task._key) : undefined}
                selectable
                isChecked={selectedIds.has(task.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
