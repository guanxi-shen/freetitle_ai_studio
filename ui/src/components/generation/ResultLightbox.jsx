import { useState, useEffect } from 'react'

const IMAGE_PROVIDERS = ['nano_banana']

// Return only the input images actually used by this provider
function collectInputImages(config, provider) {
  if (!config) return []
  const images = []
  if (provider === 'veo') {
    if (config.startFrameUrl) images.push({ url: config.startFrameUrl, label: 'Start Frame' })
    if (config.endFrameUrl) images.push({ url: config.endFrameUrl, label: 'End Frame' })
  } else {
    // nano_banana: generic reference images
    if (config.referenceImages) {
      config.referenceImages.forEach((url, i) => {
        images.push({ url, label: `Reference ${i + 1}` })
      })
    }
  }
  return images
}

// item: { resultUrl, provider, prompt, config, version }
// allItems: optional array of navigable items for prev/next
export default function ResultLightbox({ item, allItems = [], onClose, onItemChange, onEdit, onReapply, onOpenEditor, onDraw, onEditCharacter }) {
  const [compare, setCompare] = useState(null)

  // Reset compare mode when item changes
  useEffect(() => { setCompare(null) }, [item?.resultUrl])

  const currentIndex = allItems.findIndex(t => t.resultUrl === item.resultUrl)
  const isImage = item.is_image != null ? item.is_image : (!item.provider || IMAGE_PROVIDERS.includes(item.provider))

  function navigate(dir) {
    if (currentIndex < 0) return
    const next = currentIndex + dir
    if (next >= 0 && next < allItems.length) onItemChange?.(allItems[next])
  }

  function enterCompareView(clickedUrl) {
    const images = collectInputImages(item.config, item.provider)
    const startIndex = images.findIndex(img => img.url === clickedUrl)
    setCompare({ images, index: startIndex >= 0 ? startIndex : 0 })
  }

  function navigateCompare(dir) {
    setCompare(prev => {
      const next = prev.index + dir
      if (next < 0 || next >= prev.images.length) return prev
      return { ...prev, index: next }
    })
  }

  useEffect(() => {
    const handler = (e) => {
      if (compare) {
        if (e.key === 'Escape') setCompare(null)
        else if (e.key === 'ArrowLeft') navigateCompare(-1)
        else if (e.key === 'ArrowRight') navigateCompare(1)
      } else {
        if (e.key === 'Escape') onClose()
        else if (e.key === 'ArrowLeft') navigate(-1)
        else if (e.key === 'ArrowRight') navigate(1)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  const inputImages = collectInputImages(item.config, item.provider)
  const hasInputImages = inputImages.length > 0

  // Character context: count images belonging to the same character
  const charName = item._charName
  let charIndex = -1, charTotal = 0
  if (charName) {
    const charItems = allItems.filter(t => t._charName === charName)
    charTotal = charItems.length
    charIndex = charItems.findIndex(t => t.resultUrl === item.resultUrl)
  }

  return (
    <div className="lightbox active" onClick={() => compare ? setCompare(null) : onClose()}>
      <button className="close-btn" onClick={e => { e.stopPropagation(); onClose() }}>&times;</button>

      {compare ? (
        <>
          <button className="compare-back-btn" onClick={e => { e.stopPropagation(); setCompare(null) }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="7" x2="2" y2="7" />
              <polyline points="6,3 2,7 6,11" />
            </svg>
            Back
          </button>
          <div className="lightbox-compare" onClick={e => e.stopPropagation()}>
            <div className="compare-panel">
              <div className="compare-label">Reference</div>
              <div className="compare-image">
                <img src={compare.images[compare.index].url} alt="reference" />
              </div>
              {compare.images.length > 1 && (
                <div className="compare-nav">
                  <button
                    className="compare-arrow"
                    disabled={compare.index === 0}
                    onClick={() => navigateCompare(-1)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6" /></svg>
                  </button>
                  <div className="compare-thumbs">
                    {compare.images.map((img, i) => (
                      <img
                        key={i}
                        src={img.thumb_url || img.url}
                        alt={img.label}
                        className={i === compare.index ? 'active' : ''}
                        onClick={() => setCompare(prev => ({ ...prev, index: i }))}
                      />
                    ))}
                  </div>
                  <button
                    className="compare-arrow"
                    disabled={compare.index === compare.images.length - 1}
                    onClick={() => navigateCompare(1)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9,6 15,12 9,18" /></svg>
                  </button>
                </div>
              )}
              <div className="compare-image-label">{compare.images[compare.index].label}</div>
            </div>
            <div className="compare-divider" />
            <div className="compare-panel">
              <div className="compare-label">Result</div>
              <div className="compare-image">
                {isImage
                  ? <img src={item.resultUrl} alt="result" />
                  : <video src={item.resultUrl} controls autoPlay />
                }
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {currentIndex > 0 && (
            <button className="lightbox-arrow left" onClick={e => { e.stopPropagation(); navigate(-1) }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6" /></svg>
            </button>
          )}
          {currentIndex >= 0 && currentIndex < allItems.length - 1 && (
            <button className="lightbox-arrow right" onClick={e => { e.stopPropagation(); navigate(1) }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9,6 15,12 9,18" /></svg>
            </button>
          )}
          {charName && (
            <div className="lightbox-char-bar" onClick={e => e.stopPropagation()}>
              <div className="lightbox-char-info">
                <span className="lightbox-char-name">{charName}</span>
                {charTotal > 1 && <span className="lightbox-char-pos">{charIndex + 1} / {charTotal}</span>}
              </div>
              {onEditCharacter && (
                <button className="lightbox-char-edit" onClick={onEditCharacter}>
                  Edit Character
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 3l5 5-5 5" />
                  </svg>
                </button>
              )}
            </div>
          )}
          <div className="lightbox-scroll">
            <div className="lightbox-content" onClick={e => e.stopPropagation()}>
              {currentIndex >= 0 && !charName && (
                <div className="lightbox-counter" onClick={e => e.stopPropagation()}>
                  {currentIndex + 1} / {allItems.length}
                </div>
              )}
              {isImage
                ? <img src={item.resultUrl} alt="result" />
                : <video src={item.resultUrl} controls autoPlay />
              }
              {(onOpenEditor || onReapply || (onEdit && isImage) || (onDraw && isImage)) && (
                <div className="lightbox-actions-pill">
                  {onOpenEditor && (
                    <button onClick={onOpenEditor} title="Open in editor">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                      </svg>
                    </button>
                  )}
                  {onDraw && isImage && (
                    <button onClick={() => { onDraw(item); onClose() }} title="Draw on image">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11.5 1.5l3 3-9 9H2.5v-3z" />
                        <path d="M9.5 3.5l3 3" />
                      </svg>
                    </button>
                  )}
                  {onReapply && (
                    <button onClick={() => { onReapply(item); onClose() }} title="Reuse settings">
                      <svg width="14" height="14" viewBox="2 2 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="17 1 21 5 17 9" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <polyline points="7 23 3 19 7 15" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    </button>
                  )}
                  {onEdit && isImage && (
                    <button onClick={() => { onEdit(item); onClose() }} title="Use as input image">
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="12" height="12" rx="2" />
                        <path d="M8 11V5.5" />
                        <polyline points="5.5,8 8,5.5 10.5,8" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
            {(item.prompt || item.provider) && (
              <div className="lightbox-details active" onClick={e => e.stopPropagation()}>
                {hasInputImages && (
                  <details open>
                    <summary>Input Images</summary>
                    <div className="lightbox-input-images">
                      {inputImages.map((img, i) => (
                        <img key={i} src={img.url} alt={img.label} title={img.label} onClick={() => enterCompareView(img.url)} />
                      ))}
                    </div>
                  </details>
                )}
                {item.prompt && (
                  <details>
                    <summary>Prompt</summary>
                    <div className="prompt-text">{item.prompt}</div>
                  </details>
                )}
                {item.config && (
                  <details>
                    <summary>Settings</summary>
                    <div className="lightbox-meta">
                      {item.provider && <div><span>Provider:</span> {item.provider}</div>}
                      {item.version && <div><span>Version:</span> {item.version}</div>}
                      {item.config.imageRatio && <div><span>Ratio:</span> {item.config.imageRatio}</div>}
                      {item.config.nanoSize && <div><span>Size:</span> {item.config.nanoSize}</div>}
                      {item.config.veoSize && <div><span>Resolution:</span> {item.config.veoSize}</div>}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
