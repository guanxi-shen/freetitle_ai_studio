import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AgentIndicator from './AgentIndicator'

const PROVIDER_LABELS = {
  nano_banana: 'NB',
  soulboard: 'SB',
  upload: 'UP',
}

function SortableCard({ item, onItemClick, onItemDelete, noteCount = 0, onNoteToggle, agentScopeKey, onAgentClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item._key || item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="supp-card" data-context-type="supplement" data-supplement-id={item._key || item.id} data-supplement-title={item.prompt || ''} {...attributes} {...listeners}>
      <div className="supp-card-img" onClick={(e) => { e.stopPropagation(); onItemClick?.(item) }}>
        <img src={item.thumb_url || item.url} alt="" />
      </div>
      {item.source && PROVIDER_LABELS[item.source] && (
        <span className={`supp-card-badge ${item.source}`}>
          {PROVIDER_LABELS[item.source]}
        </span>
      )}
      {noteCount > 0 && (
        <button className="supp-note-icon" onClick={(e) => { e.stopPropagation(); onNoteToggle?.(item._key || item.id) }} onPointerDown={(e) => e.stopPropagation()} title={`${noteCount} note${noteCount > 1 ? 's' : ''}`}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.7">
            <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
            <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
          </svg>
        </button>
      )}
      {agentScopeKey && (
        <AgentIndicator
          scopeKey={agentScopeKey}
          hasNewDot={false}
          onClick={e => onAgentClick?.(agentScopeKey, e)}
        />
      )}
      {onItemDelete && (
        <button
          className="supp-card-delete"
          onClick={e => { e.stopPropagation(); onItemDelete(item._key || item.id, e) }}
        >
          <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default function SupplementaryLane({ items = [], layout = 'horizontal', onGenerate, onItemClick, onItemDelete, onReorder, onExplore, notesBySuppId = {}, onNoteToggle, laneNoteCount = 0, onLaneNoteToggle, loading, generatingCount = 0, agentScopeMap = {}, onAgentIndicatorClick }) {
  const [collapsed, setCollapsed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const confirmPosRef = useRef(null)
  const viewMode = layout === 'vertical' ? 'grid' : 'row'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const itemIds = items.map(i => i._key || i.id)

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id || !onReorder) return
    const oldIndex = itemIds.indexOf(active.id)
    const newIndex = itemIds.indexOf(over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      onReorder(arrayMove(itemIds, oldIndex, newIndex))
    }
  }

  const strategy = viewMode === 'row' ? horizontalListSortingStrategy : rectSortingStrategy

  return (
    <div className={`supplementary-lane ${layout} ${collapsed ? 'collapsed' : ''} ${!items.length ? 'empty' : ''}`} data-context-type="supplementary-lane">
      <div className="supp-header" onClick={collapsed ? () => setCollapsed(false) : onGenerate} style={{ cursor: 'pointer' }}>
        {items.length > 0 && (
          <button className="supp-collapse" onClick={(e) => { e.stopPropagation(); setCollapsed(c => !c) }}>
            <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
              {collapsed
                ? (layout === 'horizontal' ? <path d="M3 1l5 4-5 4z" /> : <path d="M3 1l5 4-5 4z" />)
                : (layout === 'horizontal' ? <path d="M9 3l-5 4 5 4z" /> : <path d="M1 3l4 5 4-5z" />)
              }
            </svg>
          </button>
        )}
        <span className="supp-title">{collapsed ? 'Supplements' : 'Supplementary'}</span>
        {items.length > 0 && <span className="supp-count">{items.length}</span>}
        {loading && <div className="mini-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
        {generatingCount > 0 && <span className="supp-generating-count">{generatingCount}</span>}
        {onExplore && (
          <button
            className="supp-explore-btn"
            onClick={(e) => { e.stopPropagation(); onExplore() }}
            title="Explore with Soulboard"
          >
            <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="2" />
              <circle cx="8" cy="8" r="5" />
              <circle cx="8" cy="8" r="7" />
            </svg>
          </button>
        )}
        {laneNoteCount > 0 && (
          <button className="lane-note-icon" onClick={e => { e.stopPropagation(); onLaneNoteToggle?.('supplementary-lane') }} title={`${laneNoteCount} lane note${laneNoteCount > 1 ? 's' : ''}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
              <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
              <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
            </svg>
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="supp-body">
          {(items.length > 0 || generatingCount > 0) && (
            <div className={`supp-items ${viewMode}`}>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={itemIds} strategy={strategy}>
                  {items.map(item => (
                    <SortableCard
                      key={item._key || item.id}
                      item={item}
                      noteCount={notesBySuppId[item._key || item.id] || 0}
                      onNoteToggle={onNoteToggle}
                      onItemClick={onItemClick}
                      agentScopeKey={agentScopeMap[item._key || item.id] || null}
                      onAgentClick={onAgentIndicatorClick}
                      onItemDelete={(id, e) => {
                        if (e) {
                          const rect = e.currentTarget.getBoundingClientRect()
                          confirmPosRef.current = { left: rect.left + rect.width / 2, top: rect.bottom + 4 }
                        }
                        setConfirmDelete(id)
                      }}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {Array.from({ length: generatingCount }, (_, i) => (
                <div key={`gen-${i}`} className="supp-card supp-card-placeholder">
                  <div className="supp-card-img">
                    <div className="shot-generating-indicator">
                      <div className="mini-spinner" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="supp-add-btn" onClick={onGenerate}>+ Add</button>
        </div>
      )}

      {confirmDelete && createPortal(
        <div className="confirm-overlay-fixed" onClick={() => setConfirmDelete(null)}>
          <div
            className="confirm-box"
            onClick={e => e.stopPropagation()}
            style={confirmPosRef.current ? { position: 'fixed', left: confirmPosRef.current.left, top: confirmPosRef.current.top, transform: 'translate(-50%, 0)' } : undefined}
          >
            <p>Delete this item?</p>
            <div className="confirm-actions">
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="confirm-delete" onClick={() => { onItemDelete?.(confirmDelete); setConfirmDelete(null) }}>Delete</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
