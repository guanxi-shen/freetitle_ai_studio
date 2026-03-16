import { useState, useEffect, useRef, useCallback } from 'react'

const TABS = [
  { id: 'shots', label: 'Shots', enabled: true },
  { id: 'characters', label: 'Characters', enabled: true },
  { id: 'supplements', label: 'Supplements', enabled: true },
]

const Chevron = ({ open }) => (
  <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" style={{ flexShrink: 0 }}>
    {open ? <path d="M1 3l4 5 4-5z" /> : <path d="M3 1l5 4-5 4z" />}
  </svg>
)

function applyRanking(images, rankedIds) {
  if (!rankedIds?.length) return images
  const ranked = rankedIds.map(id => images.find(r => r.id === id)).filter(Boolean)
  const rankedSet = new Set(rankedIds)
  const unranked = images.filter(r => !rankedSet.has(r.id))
  return [...ranked, ...unranked]
}

export default function ProjectImagePicker({ scenes, currentShotId, supplementaryItems, characterItems, shotSupplements, mode, maxImages, onSelect, onClose }) {
  const [selected, setSelected] = useState(new Set())
  const [activeTab, setActiveTab] = useState('shots')
  const [preview, setPreview] = useState(null) // full URL for lightbox preview

  // When opened in a shot context, auto-collapse other scenes
  const [collapsedScenes, setCollapsedScenes] = useState(() => {
    if (!currentShotId || !scenes) return new Set()
    const currentSceneId = scenes.find(s => s.shots?.some(sh => sh.id === currentShotId))?.id
    if (!currentSceneId) return new Set()
    return new Set(scenes.filter(s => s.id !== currentSceneId).map(s => s.id))
  })
  const [collapsedShots, setCollapsedShots] = useState(new Set())
  const currentShotRef = useCallback(node => {
    if (node) node.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [])

  useEffect(() => {
    if (!preview) return
    const handler = (e) => { if (e.key === 'Escape') setPreview(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [preview])

  function toggleSelect(url) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(url)) {
        next.delete(url)
      } else {
        if (mode === 'single') return new Set([url])
        if (maxImages && next.size >= maxImages) return prev
        next.add(url)
      }
      return next
    })
  }

  function toggleCollapse(set, setter, id) {
    setter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderThumb(r) {
    const isSelected = selected.has(r.url)
    return (
      <div
        key={r.id || r.url}
        className={`picker-thumb ${isSelected ? 'selected' : ''}`}
        onClick={() => toggleSelect(r.url)}
      >
        <img src={r.thumb_url || r.url} alt={r.filename || 'result'} />
        <button
          className="picker-preview-btn"
          onClick={e => { e.stopPropagation(); setPreview(r.url) }}
          title="Preview"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="7" cy="7" r="4" />
            <line x1="10" y1="10" x2="14" y2="14" />
          </svg>
        </button>
        {mode === 'multi' && <div className={`picker-checkbox ${isSelected ? 'checked' : ''}`} />}
        {mode === 'single' && isSelected && <div className="picker-selected-ring" />}
      </div>
    )
  }

  function handleAdd() {
    if (selected.size === 0) return
    onSelect(Array.from(selected))
    onClose()
  }

  // Collect all image results across scenes/shots (including shot supplements)
  const hasResults = scenes?.some(scene =>
    scene.shots?.some(shot =>
      shot.results?.some(r => r.is_image !== false && r.url)
      || shotSupplements?.[shot.id]
    )
  )

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="picker-modal" onClick={e => e.stopPropagation()}>
        <h3>Select from Project</h3>

        {/* Tabs */}
        <div className="picker-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`picker-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="picker-body">
          {activeTab === 'shots' && (
            !hasResults ? (
              <div className="picker-empty">No image results in this project yet.</div>
            ) : (
              scenes.map((scene, si) => {
                const sceneImages = scene.shots?.some(shot =>
                  shot.results?.some(r => r.is_image !== false && r.url)
                  || shotSupplements?.[shot.id]
                )
                if (!sceneImages) return null
                const sceneOpen = !collapsedScenes.has(scene.id)
                return (
                  <div key={scene.id} className="picker-scene">
                    <div
                      className="picker-scene-header"
                      onClick={() => toggleCollapse(collapsedScenes, setCollapsedScenes, scene.id)}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <Chevron open={sceneOpen} />
                      Scene {si + 1}{scene.description ? ` - "${scene.description}"` : ''}
                    </div>
                    {sceneOpen && scene.shots?.map((shot, shi) => {
                      const allImages = (shot.results || []).filter(r => r.is_image !== false && r.url)
                      // Collect shot-level supplements
                      const suppImages = []
                      const suppEntries = shotSupplements?.[shot.id]
                      if (suppEntries) {
                        for (const [key, item] of Object.entries(suppEntries)) {
                          const url = item.url || item.content_url
                          if (url) suppImages.push({ id: key, url, thumb_url: item.thumb_url, provider: item.source })
                        }
                      }
                      if (allImages.length === 0 && suppImages.length === 0) return null
                      const isCurrent = shot.id === currentShotId
                      const shotOpen = !collapsedShots.has(shot.id)
                      const isDual = shot.dual_frame && shot.frames
                      return (
                        <div key={shot.id} className="picker-shot" ref={isCurrent ? currentShotRef : undefined}>
                          <div
                            className="picker-shot-header"
                            onClick={() => toggleCollapse(collapsedShots, setCollapsedShots, shot.id)}
                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <Chevron open={shotOpen} />
                            Shot {shi + 1}{shot.description ? `: "${shot.description}"` : ''}
                            {isCurrent && <span className="picker-current-badge">(current)</span>}
                          </div>
                          {shotOpen && (isDual ? (
                            <>
                              {[['start', 'Start Frame', 1], ['end', 'End Frame', 2]].map(([key, label, num]) => {
                                const frameImages = allImages.filter(r => (r.frame_number || 1) === num)
                                const ranked = applyRanking(frameImages, shot.frames[key]?.ranked_result_ids)
                                if (ranked.length === 0) return null
                                return (
                                  <div key={key}>
                                    <div className="picker-frame-label">{label}</div>
                                    <div className="picker-thumbs">{ranked.map(r => renderThumb(r))}</div>
                                  </div>
                                )
                              })}
                              {suppImages.length > 0 && (
                                <div className="picker-thumbs">{suppImages.map(r => renderThumb(r))}</div>
                              )}
                            </>
                          ) : (
                            <div className="picker-thumbs">
                              {[...applyRanking(allImages, shot.ranked_result_ids), ...suppImages].map(r => renderThumb(r))}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )
              })
            )
          )}

          {activeTab === 'characters' && (
            !characterItems?.length ? (
              <div className="picker-empty">No characters in this project yet.</div>
            ) : (
              characterItems.map(char => {
                const allImages = [...(char.turnarounds || []), ...(char.variations || [])].filter(r => r.url)
                if (!allImages.length) return null
                return (
                  <div key={char.id} className="picker-scene">
                    <div className="picker-scene-header">{char.name || 'Unnamed'}</div>
                    <div className="picker-thumbs">
                      {allImages.map(r => renderThumb(r))}
                    </div>
                  </div>
                )
              })
            )
          )}

          {activeTab === 'supplements' && (
            !supplementaryItems?.length ? (
              <div className="picker-empty">No supplementary assets yet.</div>
            ) : (
              <div className="picker-scene">
                <div className="picker-scene-header">Supplementary Assets</div>
                <div className="picker-thumbs">
                  {supplementaryItems.map(item => renderThumb(item))}
                </div>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="picker-footer">
          <button className="picker-cancel" onClick={onClose}>Cancel</button>
          <button
            className="picker-add"
            disabled={selected.size === 0}
            onClick={handleAdd}
          >
            Add Selected{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>

      {preview && (
        <div className="picker-lightbox" onClick={(e) => { e.stopPropagation(); setPreview(null) }}>
          <button className="close-btn" onClick={() => setPreview(null)}>&times;</button>
          <img src={preview} alt="preview" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
