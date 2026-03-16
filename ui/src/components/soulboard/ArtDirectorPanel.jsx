import { useState, useEffect, useRef } from 'react'

const ChevronIcon = ({ up }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 transition-transform ${up ? 'rotate-180' : ''}`}>
    <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clipRule="evenodd" />
  </svg>
)

function RefThumbnail({ url }) {
  if (!url) return <div className="w-8 h-8 rounded bg-text-primary/5 flex-shrink-0" />
  return <img src={url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0 border border-glass" />
}

export default function ArtDirectorPanel({
  initialQuery, initialRefImages = [], iterations = [],
  reasoning, expectedItems, completedItems, failedItems, done, elapsed, generating,
  contextText, thinkingText = '',
}) {
  const [collapsed, setCollapsed] = useState(true)
  const [showContext, setShowContext] = useState(false)
  const scrollRef = useRef(null)

  const total = completedItems + failedItems
  const progress = expectedItems > 0 ? (total / expectedItems) * 100 : 0

  useEffect(() => {
    if (done) setCollapsed(true)
  }, [done])

  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [collapsed, iterations, reasoning, thinkingText])

  if (!generating && !reasoning) return null

  return (
    <div className="bg-surface/70 backdrop-blur-xl border border-glass-subtle rounded-xl overflow-hidden">
      <div className="flex flex-col text-left">
        <div className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-text-primary/[0.03] transition-colors" onClick={() => setCollapsed(c => !c)}>
          <div className="flex items-center gap-2 min-w-0">
            {generating && !done && (
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0" />
            )}
            <span className="text-xs text-text-muted truncate" style={generating && !reasoning && thinkingText ? { direction: 'rtl' } : undefined}>
              {generating && !reasoning
                ? (thinkingText
                  ? <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>Art Director: <span className="text-text-secondary">{thinkingText.replace(/\n+/g, ' ')}</span></span>
                  : 'Art director is planning...')
                : done
                  ? `${completedItems} image${completedItems !== 1 ? 's' : ''} generated${failedItems > 0 ? ` (${failedItems} failed)` : ''}${elapsed ? ` in ${elapsed}s` : ''}`
                  : `${total} of ${expectedItems} images...`
              }
            </span>
          </div>
          <div className="flex items-center gap-1">
            {contextText && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowContext(s => !s) }}
                className={`p-0.5 rounded cursor-pointer transition-colors ${showContext ? 'text-text-secondary' : 'text-text-muted/50 hover:text-text-muted'}`}
                title="Creative context"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
                  <path d="M6 5h4M6 8h4M6 11h2" />
                </svg>
              </button>
            )}
            <ChevronIcon up={!collapsed} />
          </div>
        </div>
        {collapsed && expectedItems > 0 && (
          <div className="h-0.5 w-full bg-border">
            <div
              className={`h-full transition-all duration-500 ease-out ${done ? 'bg-like' : 'bg-accent'}`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        )}
      </div>

      {showContext && contextText && (
        <div className="px-4 pb-2">
          <div className="text-[10px] leading-relaxed text-text-secondary whitespace-pre-wrap max-h-32 overflow-y-auto bg-text-primary/[0.03] rounded-lg px-2.5 py-2 border border-glass sb-scrollbar" style={{ fontFamily: 'ui-monospace, monospace' }}>
            {contextText}
          </div>
        </div>
      )}

      {!collapsed && (
        <div ref={scrollRef} className="px-4 pb-3 max-h-64 overflow-y-auto space-y-2">
          {initialQuery && (
            <div>
              <p className="text-xs text-text-secondary leading-relaxed">
                <span className="text-text-muted font-medium">You:</span> {initialQuery}
              </p>
              {initialRefImages.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {initialRefImages.map((url, i) => <RefThumbnail key={i} url={url} />)}
                </div>
              )}
            </div>
          )}

          {iterations.map((iter, i) => (
            <div key={i} className="space-y-1.5">
              {iter.userMessage && (
                <p className="text-xs text-text-secondary leading-relaxed">
                  <span className="text-text-muted font-medium">You:</span> {iter.userMessage}
                </p>
              )}
              {iter.reasoning && (
                <p className="text-xs text-text-secondary leading-relaxed">
                  <span className="text-accent font-medium">Art Director:</span> {iter.reasoning}
                </p>
              )}
            </div>
          ))}

          {generating && !reasoning && (
            thinkingText
              ? <pre className="text-xs text-text-muted/70 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto sb-scrollbar" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px' }}>{thinkingText}</pre>
              : <p className="text-xs text-text-muted animate-pulse">Art director is planning...</p>
          )}

          {expectedItems > 0 && (
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${
                  done ? 'bg-like' : 'bg-accent'
                }`}
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
