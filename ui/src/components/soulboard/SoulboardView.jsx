import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { STATUS } from '../../hooks/useSoulboard'
import { buildCreativeContext } from '../../utils/creativeContext'
import SessionPicker from './SessionPicker'
import SoulboardStart from './SoulboardStart'
import RadialBoard from './RadialBoard'
import Board from './Board'
import ArtDirectorPanel from './ArtDirectorPanel'
import SoulboardFeedbackBar from './SoulboardFeedbackBar'
import Lightbox from './Lightbox'
import FinalizeModal from './FinalizeModal'
import NoteModal from './NoteModal'

const GridIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zm0 9A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zm9-9A2.25 2.25 0 0011 4.25v2.5A2.25 2.25 0 0013.25 9h2.5A2.25 2.25 0 0018 6.75v-2.5A2.25 2.25 0 0015.75 2h-2.5zm0 9A2.25 2.25 0 0011 13.25v2.5A2.25 2.25 0 0013.25 18h2.5A2.25 2.25 0 0018 15.75v-2.5A2.25 2.25 0 0015.75 11h-2.5z" clipRule="evenodd" />
  </svg>
)

const BoardIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <rect x="1" y="1.5" width="7" height="9.5" rx="1.5" />
    <rect x="10" y="1.5" width="8.5" height="5.5" rx="1.5" />
    <rect x="1" y="13" width="7" height="5.5" rx="1.5" />
    <rect x="10" y="9" width="8.5" height="9.5" rx="1.5" />
  </svg>
)

const FilterIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
  </svg>
)

export default function SoulboardView({
  // Hook state
  status, error, iterations, initialQuery, initialRefImages, preferences,
  allItems, likedItems, currentIteration, thinkingText,
  activeSessionId, isReadOnly,
  // Session management
  loadSession, loadSessionReadOnly, createSession, forkSession,
  closeSession, reset,
  // Actions
  start, retry, generateMore, interrupt, toggleLike, toggleDislike, setNote, markSeen, removeInitialRef,
  finalize,
  // External context
  projectName, projectState, projectScenes,
  context = 'standalone',
  shotId = null,
  sceneId = null,
  characterId = null,
  characters = [],
  onFinalize,
  onClose,
}) {
  const [viewMode, setViewMode] = useState('board')
  const [filters, setFilters] = useState({ liked: true, neutral: true, disliked: false })
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [lightboxItem, setLightboxItem] = useState(null)
  const [noteItem, setNoteItem] = useState(null)
  const [showFinalize, setShowFinalize] = useState(false)
  const filterRef = useRef(null)

  // Pre-populate query for shot (shot description) or character (character name) contexts
  const defaultQuery = useMemo(() => {
    if (context === 'shot' && shotId && projectScenes) {
      for (const scene of projectScenes) {
        const shot = scene.shots?.find(sh => sh.id === shotId)
        if (shot) return shot.description || ''
      }
    }
    if (context === 'character' && characterId) {
      const char = characters.find(c => c.id === characterId)
      if (char?.name) return char.name
    }
    return ''
  }, [context, shotId, characterId, projectScenes, characters])

  const contextText = buildCreativeContext(projectState, projectScenes)
  const supplementaryPickerItems = useMemo(() =>
    Object.entries(projectState?.generated_supplementary || {}).map(([key, item]) => ({
      id: key, url: item.url || item.content_url, source: item.source || 'unknown',
      prompt: item.prompt || '', is_image: true,
    }))
  , [projectState?.generated_supplementary])
  const characterPickerItems = useMemo(() => {
    const gallery = projectState?.character_gallery || {}
    const order = projectState?.character_gallery_order || []
    const allKeys = new Set(Object.keys(gallery))
    const orderedKeys = order.filter(k => allKeys.has(k))
    const unorderedKeys = [...allKeys].filter(k => !order.includes(k))
    return [...orderedKeys, ...unorderedKeys].map(key => ({ _key: key, id: key, ...gallery[key] }))
  }, [projectState?.character_gallery, projectState?.character_gallery_order])
  const toggleFilter = (key) => setFilters(prev => ({ ...prev, [key]: !prev[key] }))

  // Close filter menu on outside click
  useEffect(() => {
    if (!showFilterMenu) return
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setShowFilterMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFilterMenu])


  // Filter items by feedback status (checkbox model)
  const filteredItems = useMemo(() => {
    if (filters.liked && filters.neutral && filters.disliked) return allItems
    return allItems.filter(item => {
      if (item._placeholder) return true
      if (item.feedback === 'liked') return filters.liked
      if (item.feedback === 'disliked') return filters.disliked
      return filters.neutral
    })
  }, [allItems, filters])

  // Counts per feedback status
  const filterCounts = useMemo(() => {
    let liked = 0, neutral = 0, disliked = 0
    for (const item of allItems) {
      if (item._placeholder) continue
      if (item.feedback === 'liked') liked++
      else if (item.feedback === 'disliked') disliked++
      else neutral++
    }
    return { liked, neutral, disliked }
  }, [allItems])

  const isFiltering = !filters.liked || !filters.neutral || filters.disliked

  // Sync lightbox item from iterations for fresh feedback state
  const syncedLightboxItem = useMemo(() => {
    if (!lightboxItem) return null
    for (const iter of iterations) {
      const found = iter.items.find(i => i.item_id === lightboxItem.item_id)
      if (found) return found
    }
    return lightboxItem
  }, [lightboxItem, iterations])

  // Lightbox navigation
  const lightboxIndex = syncedLightboxItem
    ? filteredItems.findIndex(i => i.item_id === syncedLightboxItem.item_id)
    : -1

  const navigateLightbox = useCallback((direction) => {
    const nextIndex = lightboxIndex + direction
    if (nextIndex >= 0 && nextIndex < filteredItems.length) {
      setLightboxItem(filteredItems[nextIndex])
    }
  }, [lightboxIndex, filteredItems])

  // Mutation guard for read-only sessions: auto-fork on first edit
  const guardMutation = useCallback(async (fn) => {
    if (!isReadOnly) return fn()
    try {
      const result = await forkSession(activeSessionId, { context, shot_id: shotId, character_id: characterId })
      if (result) fn()
    } catch (e) {
      console.error('[Soulboard] Fork failed:', e)
    }
  }, [isReadOnly, forkSession, activeSessionId, context, shotId, characterId])

  const handleLike = useCallback((itemId) => {
    guardMutation(() => toggleLike(itemId))
  }, [guardMutation, toggleLike])

  const handleDislike = useCallback((itemId) => {
    guardMutation(() => toggleDislike(itemId))
  }, [guardMutation, toggleDislike])

  const handleStart = useCallback((query, preferences, referenceImages) => {
    start(query, preferences, referenceImages, projectState, projectScenes)
  }, [start, projectState, projectScenes])

  const handleGenerateMore = useCallback((message, referenceImages, preferences) => {
    guardMutation(() => generateMore(message, referenceImages, preferences, projectState, projectScenes))
  }, [guardMutation, generateMore, projectState, projectScenes])

  // Shot context: finalize directly without modal
  const handleDirectFinalize = useCallback(async () => {
    try {
      const selectedIds = likedItems.map(i => i.item_id)
      const result = await finalize(selectedIds, {})
      onFinalize?.(result?.items, context)
    } catch (e) {
      console.error('[Soulboard] Finalize failed:', e)
      onFinalize?.([], context)
    }
  }, [finalize, onFinalize, context, likedItems])

  // Non-shot: finalize with destination from modal
  const handleFinalize = useCallback(async (selectedIds, destination) => {
    try {
      const result = await finalize(selectedIds, {})
      onFinalize?.(result?.items, context, destination)
    } catch (e) {
      console.error('[Soulboard] Finalize failed:', e)
      onFinalize?.([], context, destination)
    }
  }, [finalize, onFinalize, context])

  const handleSelectSession = useCallback(async (sessionId, readOnly = false) => {
    if (readOnly) {
      await loadSessionReadOnly(sessionId)
    } else {
      await loadSession(sessionId)
    }
  }, [loadSession, loadSessionReadOnly])

  const handleNewSession = useCallback(async () => {
    await createSession({ query: '', context, shot_id: shotId, character_id: characterId })
  }, [createSession, context, shotId, characterId])

  // Back navigates out without destroying session state
  const handleBack = useCallback(() => {
    onClose?.()
  }, [onClose])

  // Explicitly end session and return to picker (or parent view)
  const handleEndSession = useCallback(() => {
    reset()
    onClose?.()
  }, [reset, onClose])

  // --- Session picker ---
  if (!activeSessionId) {
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
        <SessionPicker
          projectName={projectName}
          context={context}
          shotId={shotId}
          scenes={projectScenes}
          characters={characters}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onBack={onClose}
        />
      </div>
    )
  }

  const showBoard = iterations.length > 0
  const generating = status === STATUS.GENERATING

  return (
    <div className="h-full relative" style={{ background: 'var(--bg-primary)' }}>
      {/* Main content — full height */}
      <div className="h-full overflow-hidden relative">
        {!showBoard ? (
          <SoulboardStart
            status={status}
            onStart={handleStart}
            initialQuery={defaultQuery}
            projectScenes={projectScenes}
            currentShotId={shotId}
            supplementaryItems={supplementaryPickerItems}
            characterItems={characterPickerItems}
          />
        ) : (
          <>
            {viewMode === 'board' ? (
              <RadialBoard
                items={filteredItems}
                onItemClick={(item) => !item._placeholder && setLightboxItem(item)}
                onLike={handleLike}
                onDislike={handleDislike}
                onNote={setNoteItem}
                onSeen={markSeen}
              />
            ) : (
              <div className="h-full overflow-y-auto px-4 pt-12 pb-20">
                <Board
                  items={filteredItems}
                  onItemClick={(item) => !item._placeholder && setLightboxItem(item)}
                  onLike={handleLike}
                  onDislike={handleDislike}
                  onNote={setNoteItem}
                  onSeen={markSeen}
                />
              </div>
            )}

            {/* Floating title + back — top left */}
            <div className="absolute top-3 left-4 z-30 flex items-center gap-2">
              <button
                onClick={handleBack}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary transition-colors"
                title="Back"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M10 3L5 8l5 5" />
                </svg>
              </button>
              <h1
                className="text-lg font-semibold tracking-tight text-text-primary cursor-pointer hover:text-accent transition-colors"
                onClick={closeSession}
              >
                Soulboard
              </h1>
              {isReadOnly && (
                <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-text-primary/5">
                  read-only
                </span>
              )}
            </div>

            {/* Floating controls — top right */}
            <div className="absolute top-3 right-4 flex items-center gap-2 z-30">
              <div className="flex items-center bg-surface/60 backdrop-blur-xl rounded-lg p-0.5 gap-0.5 border border-glass">
                <button
                  onClick={() => setViewMode('board')}
                  className={`p-1.5 rounded-md transition-colors ${
                    viewMode === 'board' ? 'bg-text-primary/10 text-text-primary' : 'text-text-muted hover:text-text-secondary'
                  }`}
                  title="Board view"
                >
                  <BoardIcon />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md transition-colors ${
                    viewMode === 'grid' ? 'bg-text-primary/10 text-text-primary' : 'text-text-muted hover:text-text-secondary'
                  }`}
                  title="Grid view"
                >
                  <GridIcon />
                </button>
              </div>

              {/* Filter dropdown */}
              <div ref={filterRef} className="relative">
                <button
                  onClick={() => setShowFilterMenu(v => !v)}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    isFiltering
                      ? 'bg-accent/15 border-accent/30 text-accent'
                      : 'bg-surface/60 backdrop-blur-xl border-glass text-text-muted hover:text-text-secondary'
                  }`}
                  title="Filter images"
                >
                  <FilterIcon />
                </button>
                {showFilterMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-44 bg-surface/90 backdrop-blur-xl border border-glass rounded-lg shadow-lg shadow-black/30 py-1 z-50">
                    {[
                      { key: 'liked', label: 'Liked', count: filterCounts.liked, color: 'text-like' },
                      { key: 'neutral', label: 'Neutral', count: filterCounts.neutral, color: 'text-text-secondary' },
                      { key: 'disliked', label: 'Disliked', count: filterCounts.disliked, color: 'text-dislike' },
                    ].map(({ key, label, count, color }) => (
                      <button
                        key={key}
                        onClick={() => toggleFilter(key)}
                        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-text-primary/[0.04] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${
                            filters[key] ? 'bg-accent border-accent text-white' : 'border-text-muted'
                          }`}>
                            {filters[key] && '\u2713'}
                          </span>
                          <span className={`text-xs ${filters[key] ? color : 'text-text-muted'}`}>{label}</span>
                        </div>
                        <span className="text-[10px] text-text-muted tabular-nums">{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {generating && (
                <span className="text-xs text-text-muted flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                </span>
              )}

              <button
                onClick={handleEndSession}
                className="text-[10px] text-text-muted px-2 py-1 rounded-lg hover:text-dislike hover:bg-text-primary/5 transition-colors"
                title="End session"
              >
                End
              </button>
            </div>

            {/* Art director panel — floating top center */}
            {currentIteration && (
              <div className="absolute top-3 left-0 right-0 z-20 flex justify-center pointer-events-none px-4">
                <div className="max-w-xl w-full pointer-events-auto">
                  <ArtDirectorPanel
                    initialQuery={initialQuery}
                    initialRefImages={initialRefImages}
                    iterations={iterations}
                    reasoning={currentIteration.reasoning}
                    expectedItems={currentIteration.expectedItems}
                    completedItems={currentIteration.completedItems}
                    failedItems={currentIteration.failedItems}
                    done={currentIteration.done}
                    elapsed={currentIteration.elapsed}
                    generating={generating}
                    contextText={contextText}
                    thinkingText={thinkingText}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Error display with retry */}
        {error && (
          <div className={`mx-4 p-4 rounded-lg bg-dislike/10 border border-dislike/30 text-sm ${
            allItems.length === 0 ? 'absolute inset-x-0 top-1/3 max-w-md mx-auto text-center' : 'mt-4'
          }`}>
            <p className="text-dislike mb-3">{error}</p>
            {retry && (
              <button
                onClick={retry}
                disabled={status === STATUS.STARTING || status === STATUS.GENERATING}
                className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:brightness-110 disabled:opacity-40 transition-all"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* Feedback bar */}
      {showBoard && !showFinalize && (
        <SoulboardFeedbackBar
          status={status}
          likedCount={likedItems.length}
          dislikedCount={filterCounts.disliked}
          onGenerateMore={handleGenerateMore}
          onInterrupt={interrupt}
          onFinalize={['shot', 'character', 'supplementary'].includes(context) ? handleDirectFinalize : () => setShowFinalize(true)}
          projectScenes={projectScenes}
          currentShotId={shotId}
          initialRefImages={initialRefImages}
          onRemoveRef={removeInitialRef}
          supplementaryItems={supplementaryPickerItems}
          characterItems={characterPickerItems}
          preferences={preferences}
        />
      )}

      {/* Lightbox */}
      {syncedLightboxItem && (
        <Lightbox
          item={syncedLightboxItem}
          onClose={() => setLightboxItem(null)}
          onLike={() => handleLike(syncedLightboxItem.item_id)}
          onDislike={() => handleDislike(syncedLightboxItem.item_id)}
          onNote={(text) => guardMutation(() => setNote(syncedLightboxItem.item_id, text))}
          onPrev={lightboxIndex > 0 ? () => navigateLightbox(-1) : null}
          onNext={lightboxIndex < filteredItems.length - 1 ? () => navigateLightbox(1) : null}
          currentIndex={lightboxIndex}
          totalItems={filteredItems.length}
        />
      )}

      {showFinalize && (
        <FinalizeModal
          likedItems={likedItems}
          projectScenes={projectScenes}
          onConfirm={handleFinalize}
          onClose={() => setShowFinalize(false)}
        />
      )}

      {noteItem && (
        <NoteModal
          item={noteItem}
          onSave={(note) => {
            guardMutation(() => setNote(noteItem.item_id, note))
            setNoteItem(null)
          }}
          onClose={() => setNoteItem(null)}
        />
      )}
    </div>
  )
}
