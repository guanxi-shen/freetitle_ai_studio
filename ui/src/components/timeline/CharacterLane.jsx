import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AgentIndicator from './AgentIndicator'

function SortableCharBlock({ char, onEdit, onItemClick, onDelete, onRename, onExplore, noteCount = 0, onNoteToggle, generating, agentScopeKey, onAgentClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: char.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const [localName, setLocalName] = useState(char.name || '')
  const nameRef = useRef(null)

  // Separate turnarounds and variations by ranking
  const { cover, thumbs, totalExtra } = useMemo(() => {
    const rankItems = (items, rankedIds) => {
      const byId = {}
      for (const img of (items || [])) byId[img.id] = img
      const ordered = []
      const seen = new Set()
      for (const id of (rankedIds || [])) {
        if (byId[id] && !seen.has(id)) { seen.add(id); ordered.push(byId[id]) }
      }
      for (const img of Object.values(byId)) {
        if (!seen.has(img.id)) ordered.push(img)
      }
      return ordered
    }
    const turnarounds = rankItems(char.turnarounds, char.turnaround_ranked_ids)
    const variations = rankItems(char.variations, char.variation_ranked_ids)

    const _cover = turnarounds[0] || variations[0] || null
    let _thumbs
    if (variations.length > 0) {
      _thumbs = _cover === variations[0]
        ? variations.slice(1, 4)
        : variations.slice(0, 3)
    } else {
      _thumbs = turnarounds.slice(1, 4)
    }
    const total = turnarounds.length + variations.length
    const shown = 1 + _thumbs.length
    return { cover: _cover, thumbs: _thumbs, totalExtra: total > shown ? total - shown : 0 }
  }, [char.turnarounds, char.variations, char.turnaround_ranked_ids, char.variation_ranked_ids])

  useEffect(() => {
    if (nameRef.current !== document.activeElement) {
      setLocalName(char.name || '')
    }
  }, [char.name])

  return (
    <div ref={setNodeRef} style={style} className="char-block" data-context-type="character" data-character-id={char.id} data-character-name={char.name} {...attributes} {...listeners}>
      <div className="char-images" onPointerDown={(e) => e.stopPropagation()}>
        <div className="char-cover" onClick={(e) => {
          if (cover) onItemClick?.(cover)
          else onEdit?.(char.id)
        }}>
          {cover
            ? <img src={cover.thumb_url || cover.url} alt="" />
            : generating
              ? null
              : <span className="char-placeholder">+</span>
          }
          {generating && (
            <div className="shot-generating-indicator">
              <div className="mini-spinner" />
            </div>
          )}
          {noteCount > 0 && (
            <button className="char-note-icon" onClick={(e) => { e.stopPropagation(); onNoteToggle?.(char.id) }} title={`${noteCount} note${noteCount > 1 ? 's' : ''}`}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.7">
                <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
                <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
              </svg>
            </button>
          )}
        </div>
        {thumbs.length > 0 && (
          <div className="char-thumbs">
            {thumbs.map(img => (
              <div key={img.id} className="char-thumb-slot" onClick={(e) => {
                e.stopPropagation(); onItemClick?.(img)
              }}>
                <img src={img.thumb_url || img.url} alt="" />
              </div>
            ))}
            {totalExtra > 0 && <span className="char-more-badge">+{totalExtra}</span>}
          </div>
        )}
        <div className="char-name-overlay">
          <input
            ref={nameRef}
            className="char-name-input"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={(e) => {
              const val = e.target.value.trim()
              if (val && val !== char.name) onRename?.(char.id, val)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
          <svg className="char-name-pen" width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
            <path d="M8.5 1.5l2 2L4 10H2v-2z" />
          </svg>
        </div>
      </div>
      {agentScopeKey && (
        <AgentIndicator
          scopeKey={agentScopeKey}
          hasNewDot={false}
          onClick={e => onAgentClick?.(agentScopeKey, e)}
        />
      )}
      {onEdit && (
        <button
          className="char-block-edit"
          onClick={(e) => { e.stopPropagation(); onEdit(char.id) }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Edit character"
        >
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.5 1.5l3 3L5 14H2v-3z" />
          </svg>
        </button>
      )}
      {onExplore && (
        <button
          className="char-block-explore"
          onClick={(e) => { e.stopPropagation(); onExplore(char.id) }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Explore with Soulboard"
        >
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2" />
            <circle cx="8" cy="8" r="5" />
            <circle cx="8" cy="8" r="7" />
          </svg>
        </button>
      )}
      <button
        className="char-block-delete"
        onClick={(e) => { e.stopPropagation(); onDelete?.(char.id, e) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
          <line x1="2" y1="2" x2="8" y2="8" />
          <line x1="8" y1="2" x2="2" y2="8" />
        </svg>
      </button>
    </div>
  )
}

export default function CharacterLane({ items = [], layout = 'horizontal', onGenerate, onEdit, onRename, onItemClick, onItemDelete, onReorder, onExplore, notesByCharId = {}, onNoteToggle, laneNoteCount = 0, onLaneNoteToggle, loading, generatingCharacters, agentScopeMap = {}, onAgentIndicatorClick }) {
  const [collapsed, setCollapsed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const confirmPosRef = useRef(null)
  const viewMode = layout === 'vertical' ? 'grid' : 'row'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const itemIds = items.map(i => i.id)

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
    <div className={`character-lane ${layout} ${collapsed ? 'collapsed' : ''} ${!items.length ? 'empty' : ''}`} data-context-type="character-lane">
      <div className="char-header" onClick={collapsed ? () => setCollapsed(false) : onGenerate} style={{ cursor: 'pointer' }}>
        {items.length > 0 && (
          <button className="char-collapse" onClick={(e) => { e.stopPropagation(); setCollapsed(c => !c) }}>
            <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
              {collapsed
                ? (layout === 'horizontal' ? <path d="M3 1l5 4-5 4z" /> : <path d="M3 1l5 4-5 4z" />)
                : (layout === 'horizontal' ? <path d="M9 3l-5 4 5 4z" /> : <path d="M1 3l4 5 4-5z" />)
              }
            </svg>
          </button>
        )}
        <span className="char-title">Characters</span>
        {items.length > 0 && <span className="char-count">{items.length}</span>}
        {loading && <div className="mini-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
        {generatingCharacters?.size > 0 && <span className="char-generating-count">{generatingCharacters.size}</span>}
        {laneNoteCount > 0 && (
          <button className="lane-note-icon" onClick={e => { e.stopPropagation(); onLaneNoteToggle?.('character-lane') }} title={`${laneNoteCount} lane note${laneNoteCount > 1 ? 's' : ''}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.5">
              <path d="M2 1h6a1 1 0 011 1v5.5L6.5 10H2a1 1 0 01-1-1V2a1 1 0 011-1z" />
              <path d="M6.5 7.5V10L9 7.5H6.5z" fill="currentColor" opacity="0.3" />
            </svg>
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="char-body">
          {items.length > 0 && (
            <div className={`char-items ${viewMode}`}>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={itemIds} strategy={strategy}>
                  {items.map(item => (
                    <SortableCharBlock
                      key={item.id}
                      char={item}
                      noteCount={notesByCharId[item.id] || 0}
                      onEdit={onEdit}
                      onItemClick={onItemClick}
                      onExplore={onExplore}
                      onDelete={(id, e) => {
                        if (e) {
                          const rect = e.currentTarget.getBoundingClientRect()
                          confirmPosRef.current = { left: rect.left + rect.width / 2, top: rect.bottom + 4 }
                        }
                        setConfirmDelete(id)
                      }}
                      onRename={onRename}
                      onNoteToggle={onNoteToggle}
                      generating={generatingCharacters?.has(item.id)}
                      agentScopeKey={agentScopeMap[item.id] || null}
                      onAgentClick={onAgentIndicatorClick}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}
          <button className="char-add-btn" onClick={onGenerate}>+ Add</button>
        </div>
      )}

      {confirmDelete && createPortal(
        <div className="confirm-overlay-fixed" onClick={() => setConfirmDelete(null)}>
          <div
            className="confirm-box"
            onClick={e => e.stopPropagation()}
            style={confirmPosRef.current ? { position: 'fixed', left: confirmPosRef.current.left, top: confirmPosRef.current.top, transform: 'translate(-50%, 0)' } : undefined}
          >
            <p>Delete this character?</p>
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
