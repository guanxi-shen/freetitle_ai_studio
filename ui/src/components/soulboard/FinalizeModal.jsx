import { useState, useCallback } from 'react'

const BackArrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M9 3L5 7l4 4" />
  </svg>
)

const ChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M4.5 2.5l4 3.5-4 3.5" />
  </svg>
)

export default function FinalizeModal({ likedItems, projectScenes = [], onConfirm, onClose }) {
  // navPath: null = root, 'scenes' = scene list, { sceneId } = shot list
  const [navPath, setNavPath] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const selectedIds = likedItems.map(i => i.item_id)

  const handleFinalize = useCallback(async (destination) => {
    setSubmitting(true)
    try {
      await onConfirm(selectedIds, destination)
    } catch {
      setSubmitting(false)
    }
  }, [selectedIds, onConfirm])

  const scenes = projectScenes || []
  const currentScene = navPath?.sceneId ? scenes.find(s => s.id === navPath.sceneId) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-sm max-h-[80vh] bg-surface rounded-2xl border border-border flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">
            Finalize {likedItems.length} item{likedItems.length !== 1 ? 's' : ''}
          </h2>
          {/* Thumbnail strip */}
          <div className="flex gap-1.5 mt-2.5 overflow-x-auto">
            {likedItems.map(item => (
              <div key={item.item_id} className="w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-surface-hover">
                {item.content_url && <img src={item.thumb_url || item.content_url} alt="" className="w-full h-full object-cover" />}
              </div>
            ))}
          </div>
        </div>

        {/* Body — navigation */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
          {navPath === null && (
            <>
              <button
                onClick={() => handleFinalize({ type: 'supplementary' })}
                disabled={submitting}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-surface-hover text-left transition-colors disabled:opacity-50"
              >
                <span className="text-sm font-medium text-text-primary">Supplementary</span>
              </button>
              <button
                onClick={() => setNavPath('scenes')}
                disabled={submitting || scenes.length === 0}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-surface-hover text-left transition-colors disabled:opacity-50"
              >
                <span className="text-sm font-medium text-text-primary">Storyboard</span>
                <ChevronRight />
              </button>
            </>
          )}

          {navPath === 'scenes' && (
            <>
              <button
                onClick={() => setNavPath(null)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                <BackArrow />
                <span>Back</span>
              </button>
              {scenes.map((scene, i) => (
                <button
                  key={scene.id}
                  onClick={() => setNavPath({ sceneId: scene.id })}
                  disabled={submitting}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-surface-hover text-left transition-colors disabled:opacity-50"
                >
                  <span className="text-sm text-text-primary">
                    Scene {i + 1}{scene.title ? ` — ${scene.title}` : ''}
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </>
          )}

          {currentScene && (
            <>
              <button
                onClick={() => setNavPath('scenes')}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                <BackArrow />
                <span>Scenes</span>
              </button>
              {currentScene.shots.map((shot, i) => (
                <button
                  key={shot.id}
                  onClick={() => handleFinalize({ type: 'shot', sceneId: currentScene.id, shotId: shot.id })}
                  disabled={submitting}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-surface-hover text-left transition-colors disabled:opacity-50"
                >
                  <span className="text-sm text-text-primary">Shot {i + 1}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
