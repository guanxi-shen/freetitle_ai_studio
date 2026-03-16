import { useState, useMemo } from 'react'
import './TrashGallery.css'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return d.toLocaleDateString()
}

function sourceLabel(source) {
  if (!source) return ''
  switch (source.type) {
    case 'shot': return 'Shot'
    case 'video_shot': return 'Video'
    case 'supplementary': return 'Supplementary'
    case 'shot_supplementary': return 'Shot Supp.'
    default: return source.type || ''
  }
}

export default function TrashGallery({ items = [], onRestore, onDelete, onClose }) {
  const [selected, setSelected] = useState(new Set())
  const [lightbox, setLightbox] = useState(null)

  const sorted = useMemo(() =>
    [...items].sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || '')),
    [items]
  )

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === sorted.length) setSelected(new Set())
    else setSelected(new Set(sorted.map(t => t.id)))
  }

  function handleRestore() {
    const ids = [...selected]
    const restoreItems = sorted.filter(t => ids.includes(t.id))
    onRestore?.(restoreItems)
    setSelected(new Set())
  }

  function handleDelete() {
    onDelete?.([...selected])
    setSelected(new Set())
  }

  const selectMode = selected.size > 0

  return (
    <div className="trash-overlay" onClick={onClose}>
      <div className="trash-panel" onClick={e => e.stopPropagation()}>
        <div className="trash-header">
          <h3>Deleted Items</h3>
          <span className="trash-count">{items.length} item{items.length !== 1 ? 's' : ''}</span>
          <button className="trash-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5" fill="none">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {selectMode && (
          <div className="trash-select-bar">
            <span>{selected.size} selected</span>
            <button className="trash-action-btn" onClick={selectAll}>
              {selected.size === sorted.length ? 'Deselect All' : 'Select All'}
            </button>
            <button className="trash-action-btn restore" onClick={handleRestore}>Restore</button>
            <button className="trash-action-btn danger" onClick={handleDelete}>Delete Forever</button>
            <button className="trash-action-btn" onClick={() => setSelected(new Set())}>Cancel</button>
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="trash-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            <p>Trash is empty</p>
          </div>
        ) : (
          <div className="trash-scroll">
          <div className="trash-grid">
            {sorted.map(item => {
              const thumbSrc = item.thumb_url || item.url
              const isVideo = item.data?.is_image === false
              const isSelected = selected.has(item.id)
              return (
                <div
                  key={item.id}
                  className={`trash-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleSelect(item.id)}
                >
                  <div className="trash-item-media">
                    {isVideo ? (
                      <video src={thumbSrc} muted preload="metadata" />
                    ) : (
                      <img src={thumbSrc} alt="" loading="lazy" />
                    )}
                    <div className="trash-item-checkbox">
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <path d="M10.28 2.22a.75.75 0 010 1.06l-5.5 5.5a.75.75 0 01-1.06 0L1.22 6.28a.75.75 0 011.06-1.06L4.5 7.44l4.97-4.97a.75.75 0 011.06-.25z" />
                        </svg>
                      )}
                    </div>
                    <button
                      className="trash-item-expand"
                      title="View full size"
                      onClick={e => { e.stopPropagation(); setLightbox(item) }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 2 2 2 2 6" />
                        <polyline points="10 14 14 14 14 10" />
                      </svg>
                    </button>
                  </div>
                  <div className="trash-item-info">
                    {item.data?.provider && <span className={`provider-badge ${item.data.provider}`}>{item.data.provider.replace('_', ' ')}</span>}
                    <span className="trash-item-source">{sourceLabel(item.source)}</span>
                    <span className="trash-item-date">{formatDate(item.deleted_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
          </div>
        )}

        {!selectMode && sorted.length > 0 && (
          <div className="trash-footer">
            <button className="trash-action-btn" onClick={selectAll}>Select All</button>
          </div>
        )}
      </div>

      {lightbox && (
        <div className="trash-lightbox" onClick={() => setLightbox(null)}>
          <div className="trash-lightbox-content" onClick={e => e.stopPropagation()}>
            {lightbox.data?.is_image === false ? (
              <video src={lightbox.url} controls autoPlay muted />
            ) : (
              <img src={lightbox.url} alt="" />
            )}
            <button className="trash-lightbox-close" onClick={() => setLightbox(null)}>
              <svg width="20" height="20" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5" fill="none">
                <line x1="4" y1="4" x2="12" y2="12" />
                <line x1="12" y1="4" x2="4" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
