import { useState } from 'react'

const SOURCE_TAG = {
  nano_banana:  { label: 'Nano Banana', bg: 'bg-amber-500/30',  text: 'text-amber-200/80' },
}

const ASPECT_RATIO_MAP = {
  vertical: '3 / 4',
  horizontal: '4 / 3',
  square: '1 / 1',
}

const HeartIcon = ({ filled }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.5} className="w-3.5 h-3.5">
    <path d="M9.653 16.915l-.005-.003-.019-.01a20.759 20.759 0 01-1.162-.682 22.045 22.045 0 01-2.582-1.9C4.045 12.733 2 10.352 2 7.5a4.5 4.5 0 018-2.828A4.5 4.5 0 0118 7.5c0 2.852-2.044 5.233-3.885 6.82a22.049 22.049 0 01-3.744 2.582l-.019.01-.005.003h-.002a.723.723 0 01-.692 0h-.002z" />
  </svg>
)

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M6 14l8-8" />
  </svg>
)

const PencilIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.586 3.586a2 2 0 112.828 2.828l-8.793 8.793-3.536.707.707-3.536 8.793-8.793z" />
  </svg>
)

export default function BoardItem({ item, index, onClick, onLike, onDislike, onNote, onSeen }) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const tag = SOURCE_TAG[item.source] || SOURCE_TAG.nano_banana

  if (item._placeholder) {
    const ratio = ASPECT_RATIO_MAP[item.aspect_ratio] || ASPECT_RATIO_MAP.vertical
    return (
      <div
        className="board-item animate-fade-in break-inside-avoid mb-2"
        style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
      >
        <div className="relative overflow-hidden rounded-lg cursor-pointer">
          <div className="relative bg-surface-hover" style={{ aspectRatio: ratio }}>
            <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-white/[0.03] to-transparent" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-text-muted/30 border-t-text-secondary rounded-full animate-spin" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const liked = item.feedback === 'liked'
  const disliked = item.feedback === 'disliked'
  const showSkeleton = !item.content_url || !imgLoaded

  return (
    <div
      className="board-item animate-fade-in break-inside-avoid mb-2"
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
    >
      <div className="relative overflow-hidden rounded-lg cursor-pointer" onClick={onClick} onMouseEnter={() => item._isNew && onSeen?.(item.item_id)}>
        {showSkeleton && <div className="aspect-[3/4] skeleton" />}
        {item.content_url && (
          <img
            src={item.medium_url || item.content_url}
            alt={item.metadata?.title || ''}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
            className={`w-full block transition-all duration-300 ${
              showSkeleton ? 'absolute inset-0 opacity-0' : 'opacity-100'
            } ${disliked ? 'brightness-[0.6] blur-[2px] scale-[1.02]' : ''}`}
            style={{ maxHeight: 400, objectFit: 'cover' }}
          />
        )}

        {liked && (
          <>
            <div className="absolute inset-0 rounded-lg border-[1.5px] border-emerald-400/50 pointer-events-none z-10" style={{ boxShadow: 'inset 0 0 12px rgba(52, 211, 153, 0.15), 0 0 8px rgba(52, 211, 153, 0.1)' }} />
            <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center z-20 pointer-events-none" style={{ background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.5), rgba(96, 165, 250, 0.3))', backdropFilter: 'blur(8px)', boxShadow: '0 0 6px rgba(52, 211, 153, 0.3)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
            </div>
          </>
        )}
        {disliked && (
          <>
            <div className="absolute inset-0 rounded-lg bg-white/[0.04] backdrop-blur-[1px] pointer-events-none z-10" />
            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center z-20 pointer-events-none">
              <XIcon />
            </div>
          </>
        )}

        {item._isNew && !liked && (
          <div className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-accent shadow-[0_0_4px_var(--accent)] z-20 pointer-events-none" />
        )}

        <span className={`hover-hide absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded backdrop-blur-sm text-[9px] z-20 ${tag.bg} ${tag.text}`}>
          {tag.label}
        </span>

        <div className="hover-show absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent z-10" />

        {item.metadata?.title && (
          <div className="hover-show absolute bottom-2 left-2 right-10 z-20">
            <p className="text-white/90 text-[11px] line-clamp-2 leading-tight">
              {item.metadata.title}
            </p>
          </div>
        )}

        <div className="hover-show absolute top-2 right-2 flex flex-col gap-1 z-20">
          <button
            onClick={(e) => { e.stopPropagation(); onLike() }}
            className={`w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
              liked ? 'bg-like text-white' : 'bg-black/40 text-white/80 hover:text-like'
            }`}
          >
            <HeartIcon filled={liked} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDislike() }}
            className={`w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
              disliked ? 'bg-dislike text-white' : 'bg-black/40 text-white/80 hover:text-dislike'
            }`}
          >
            <XIcon />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onNote() }}
            className="w-7 h-7 rounded-full backdrop-blur-sm bg-black/40 text-white/80 hover:text-white flex items-center justify-center transition-colors"
          >
            <PencilIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
