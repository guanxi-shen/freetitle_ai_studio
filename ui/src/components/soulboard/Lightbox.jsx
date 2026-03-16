import { useState, useEffect, useRef } from 'react'
import { SOURCE_CONFIG } from './constants'

// Collect input/reference images from generation_params
function collectInputImages(params) {
  if (!params) return []
  const images = []
  if (params.style_reference) images.push({ url: params.style_reference, label: 'Style Reference' })
  if (params.subject_reference) images.push({ url: params.subject_reference, label: 'Subject Reference' })
  if (params.reference_images) {
    params.reference_images.forEach((url, i) => {
      if (url) images.push({ url, label: `Reference ${i + 1}` })
    })
  }
  return images
}

export default function Lightbox({
  item, onClose, onLike, onDislike, onNote, onPrev, onNext, currentIndex, totalItems,
}) {
  const source = SOURCE_CONFIG[item.source] || SOURCE_CONFIG.nano_banana
  const liked = item.feedback === 'liked'
  const disliked = item.feedback === 'disliked'
  const [note, setNote] = useState(item.feedback_note || '')
  const noteRef = useRef(null)
  const inputImages = collectInputImages(item.generation_params)

  // Sync note when navigating to a different item
  useEffect(() => {
    setNote(item.feedback_note || '')
  }, [item.item_id])

  function commitNote() {
    const trimmed = note.trim()
    if (trimmed !== (item.feedback_note || '')) {
      onNote?.(trimmed)
    }
  }

  useEffect(() => {
    const handler = (e) => {
      // Skip shortcuts while typing in the textarea
      if (noteRef.current && noteRef.current === document.activeElement) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
      if (e.key === 'l' || e.key === 'L') onLike()
      if (e.key === 'd' || e.key === 'D') onDislike()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext, onLike, onDislike])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-w-[90vw] max-h-[90vh] gap-6">
        <div className="relative flex-shrink-0">
          {item.content_url && (
            <img
              src={item.content_url}
              alt={item.metadata?.title || ''}
              className="max-h-[85vh] max-w-[55vw] object-contain rounded-lg"
            />
          )}

          {onPrev && (
            <button
              onClick={onPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              &larr;
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              &rarr;
            </button>
          )}
        </div>

        <div className="w-72 flex-shrink-0 bg-surface rounded-xl p-5 overflow-y-auto max-h-[85vh] hidden lg:block">
          <button
            onClick={onClose}
            className="absolute top-2 right-2 text-text-muted hover:text-text-primary text-lg"
          >
            x
          </button>

          <h3 className="text-base font-semibold text-text-primary mb-1">
            {item.metadata?.title || item.item_id}
          </h3>

          <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-medium mb-3 ${source.color} ${source.textColor}`}>
            {source.label}
          </span>

          {item.metadata?.description && (
            <p className="text-xs text-text-secondary mb-4 leading-relaxed">
              {item.metadata.description}
            </p>
          )}

          {inputImages.length > 0 && (
            <div className="mb-4">
              <span className="text-[10px] uppercase text-text-muted tracking-wider">Input Images</span>
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                {inputImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img.url}
                      alt={img.label}
                      className="w-14 h-14 object-cover rounded-md border border-border cursor-default"
                    />
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/80 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      {img.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.generation_params && (item.generation_params.aspect_ratio || item.source) && (
            <div className="mb-4">
              <span className="text-[10px] uppercase text-text-muted tracking-wider">Settings</span>
              <div className="mt-1 space-y-0.5 text-xs text-text-secondary">
                {item.source && (
                  <div className="flex justify-between"><span className="text-text-muted">Provider</span><span>{source.label}</span></div>
                )}
                {item.generation_params.aspect_ratio && (
                  <div className="flex justify-between"><span className="text-text-muted">Ratio</span><span>{item.generation_params.aspect_ratio}</span></div>
                )}
                {item.generation_params.search_query && (
                  <div className="flex justify-between"><span className="text-text-muted">Search</span><span className="text-right max-w-[60%] truncate">{item.generation_params.search_query}</span></div>
                )}
              </div>
            </div>
          )}

          {item.generation_params?.prompt && (
            <div className="mb-4">
              <span className="text-[10px] uppercase text-text-muted tracking-wider">Prompt</span>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                {item.generation_params.prompt}
              </p>
            </div>
          )}

          {item.generation_params?.rationale && (
            <div className="mb-4">
              <span className="text-[10px] uppercase text-text-muted tracking-wider">Rationale</span>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                {item.generation_params.rationale}
              </p>
            </div>
          )}

          {item.metadata?.hashtags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
              {item.metadata.hashtags.map((tag, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-hover text-text-muted">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {onNote && (
            <div className="mb-4">
              <span className="text-[10px] uppercase text-text-muted tracking-wider">Note</span>
              <textarea
                ref={noteRef}
                value={note}
                onChange={e => setNote(e.target.value)}
                onBlur={commitNote}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNote(); noteRef.current?.blur() }
                  if (e.key === 'Escape') { e.stopPropagation(); noteRef.current?.blur() }
                }}
                placeholder="Feedback for the art director..."
                rows={2}
                className="w-full mt-1 px-2.5 py-2 rounded-lg bg-surface-hover border border-border text-text-primary placeholder-text-muted text-xs resize-none focus:outline-none focus:border-accent"
              />
            </div>
          )}

          <div className="flex gap-2 mt-4 pt-4 border-t border-border">
            <button
              onClick={onLike}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                liked
                  ? 'bg-like text-white'
                  : 'bg-surface-hover text-text-secondary hover:text-like'
              }`}
            >
              {liked ? 'Liked' : 'Like'} (L)
            </button>
            <button
              onClick={onDislike}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                disliked
                  ? 'bg-dislike text-white'
                  : 'bg-surface-hover text-text-secondary hover:text-dislike'
              }`}
            >
              {disliked ? 'Disliked' : 'Dislike'} (D)
            </button>
          </div>

          <p className="text-[10px] text-text-muted mt-3 text-center">
            {currentIndex + 1} of {totalItems} &middot; Arrow keys to navigate
          </p>
        </div>
      </div>
    </div>
  )
}
