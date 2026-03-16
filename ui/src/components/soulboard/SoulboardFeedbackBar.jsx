/**
 * Soulboard feedback bar — fixed bottom pill with popover for feedback + sliders.
 */
import { useState, useRef, useEffect } from 'react'
import { uploadImage } from '../../services/api'
import { STATUS } from '../../hooks/useSoulboard'
import ProjectImagePicker from '../generation/ProjectImagePicker'
import GenerationSliders, { indicesToPreferences, preferencesToIndices, WEB_DEFAULT, GEN_DEFAULT } from './GenerationSliders'

const MAX_FILES = 5
const MAX_SIZE_MB = 25

const ImageIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909-4.22-4.22a.75.75 0 00-1.06 0L2.5 11.06zm6.5-3.81a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" clipRule="evenodd" />
  </svg>
)

const SlidersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M17 2.75a.75.75 0 00-1.5 0v5.5a.75.75 0 001.5 0v-5.5zM17 15.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM3.75 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM4.5 2.75a.75.75 0 00-1.5 0v5.5a.75.75 0 001.5 0v-5.5zM10 11a.75.75 0 01.75.75v5.5a.75.75 0 01-1.5 0v-5.5A.75.75 0 0110 11zM10.75 2.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM10 6a2 2 0 100 4 2 2 0 000-4zM3.75 10a2 2 0 100 4 2 2 0 000-4zM16.25 10a2 2 0 100 4 2 2 0 000-4z" />
  </svg>
)

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
  </svg>
)

const MAX_REFS = 5

export default function SoulboardFeedbackBar({ status, likedCount, dislikedCount = 0, onGenerateMore, onInterrupt, onFinalize, projectScenes, currentShotId, initialRefImages = [], onRemoveRef, supplementaryItems, characterItems, preferences }) {
  const [previewRef, setPreviewRef] = useState(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [projectUrls, setProjectUrls] = useState([])
  const [uploading, setUploading] = useState(false)
  const [webIdx, setWebIdx] = useState(WEB_DEFAULT)
  const [genIdx, setGenIdx] = useState(GEN_DEFAULT)
  const [showSliders, setShowSliders] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const fileInputRef = useRef(null)
  const popoverRef = useRef(null)
  const previewsRef = useRef(previews)
  previewsRef.current = previews

  // Restore slider positions from session preferences
  useEffect(() => {
    if (!preferences) return
    const { webIndex, genIndex } = preferencesToIndices(preferences)
    setWebIdx(webIndex)
    setGenIdx(genIndex)
  }, [preferences])

  const hasProjectImages = supplementaryItems?.length > 0 || projectScenes?.some(scene =>
    scene.shots?.some(shot =>
      shot.results?.some(r => r.is_image !== false && r.url)
    )
  )

  const totalImages = files.length + projectUrls.length

  useEffect(() => {
    return () => previewsRef.current.forEach(p => URL.revokeObjectURL(p))
  }, [])

  useEffect(() => {
    if (!showFeedback) return
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setShowFeedback(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFeedback])

  const generating = status === STATUS.GENERATING
  const canGenerate = status === STATUS.AWAITING_FEEDBACK && !uploading

  const addFiles = (newFiles) => {
    const valid = []
    for (const f of newFiles) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > MAX_SIZE_MB * 1024 * 1024) continue
      valid.push(f)
    }
    if (!valid.length) return
    previews.forEach(p => URL.revokeObjectURL(p))
    const remaining = MAX_FILES - projectUrls.length
    const combined = [...files, ...valid].slice(0, remaining)
    setFiles(combined)
    setPreviews(combined.map(f => URL.createObjectURL(f)))
  }

  const removeFile = (index) => {
    previews.forEach(p => URL.revokeObjectURL(p))
    const nextFiles = files.filter((_, i) => i !== index)
    setFiles(nextFiles)
    setPreviews(nextFiles.map(f => URL.createObjectURL(f)))
  }

  const removeProjectUrl = (index) => {
    setProjectUrls(prev => prev.filter((_, i) => i !== index))
  }

  const handlePickerSelect = (urls) => {
    const remaining = MAX_FILES - files.length - projectUrls.length
    setProjectUrls(prev => [...prev, ...urls.slice(0, remaining)])
    setShowPicker(false)
  }

  const handleGenerate = async () => {
    let imageUrls = [...projectUrls]
    if (files.length > 0) {
      try {
        setUploading(true)
        const results = await Promise.all(files.map(f => uploadImage(f)))
        imageUrls = [...imageUrls, ...results.map(r => r.url)]
      } catch (e) {
        console.error('[Soulboard] Upload failed:', e)
        setUploading(false)
        return
      }
      setUploading(false)
    }
    const allRefs = [...initialRefImages.slice(0, MAX_REFS), ...imageUrls]
    onGenerateMore(message.trim() || null, allRefs, indicesToPreferences(webIdx, genIdx))
    setMessage('')
    setFiles([])
    setProjectUrls([])
    previews.forEach(p => URL.revokeObjectURL(p))
    setPreviews([])
    setShowFeedback(false)
    setShowSliders(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canGenerate) handleGenerate()
    }
    if (e.key === 'Escape') setShowFeedback(false)
  }

  return (
    <div className="fixed bottom-4 left-0 right-0 z-40 flex flex-col items-center gap-2 pointer-events-none">
      <div ref={popoverRef} className="contents">
        {/* Feedback popover */}
        {showFeedback && !generating && (
          <div className="pointer-events-auto w-full max-w-md px-4">
            <div className="bg-surface/80 backdrop-blur-xl border border-glass rounded-xl p-3 flex flex-col gap-2 shadow-lg shadow-black/30">
              {/* Refs row: add buttons + initial refs + user-added refs */}
              <div className="flex gap-1.5 flex-wrap items-center">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={totalImages >= MAX_FILES}
                  className="p-1 rounded-lg text-text-muted hover:text-text-secondary disabled:opacity-30 cursor-pointer transition-colors"
                  title="Upload reference images"
                >
                  <ImageIcon />
                </button>
                {hasProjectImages && (
                  <button
                    type="button"
                    onClick={() => setShowPicker(true)}
                    disabled={totalImages >= MAX_FILES}
                    className="p-1 rounded-lg text-text-muted hover:text-text-secondary disabled:opacity-30 cursor-pointer transition-colors"
                    title="Browse project images"
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 4.5a1 1 0 011-1h3.17a1 1 0 01.7.29l1.13 1.13a1 1 0 00.7.29H13a1 1 0 011 1v5.29a1 1 0 01-1 1H3a1 1 0 01-1-1V4.5z" />
                    </svg>
                  </button>
                )}
                {(initialRefImages.length > 0 || previews.length > 0 || projectUrls.length > 0) && (
                  <div className="w-px h-5 bg-glass mx-0.5" />
                )}
                {initialRefImages.slice(0, MAX_REFS).map((url, i) => (
                  <div key={`ref-${i}`} className="relative">
                    <img
                      src={url}
                      alt=""
                      className="w-7 h-7 rounded object-cover border border-glass opacity-70 cursor-zoom-in hover:opacity-100 transition-opacity"
                      onClick={() => setPreviewRef(url)}
                    />
                    {onRemoveRef && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveRef(i) }}
                        className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-surface border border-border text-text-muted text-[8px] flex items-center justify-center cursor-pointer hover:text-text-primary transition-colors"
                      >
                        x
                      </button>
                    )}
                  </div>
                ))}
                {projectUrls.map((url, i) => (
                  <div key={`p-${i}`} className="relative">
                    <img src={url} alt="" className="w-7 h-7 rounded object-cover border border-glass" />
                    <button
                      onClick={() => removeProjectUrl(i)}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-surface border border-border text-text-muted text-[8px] flex items-center justify-center cursor-pointer hover:text-text-primary transition-colors"
                    >
                      x
                    </button>
                  </div>
                ))}
                {previews.map((url, i) => (
                  <div key={`f-${i}`} className="relative">
                    <img src={url} alt="" className="w-7 h-7 rounded object-cover border border-glass" />
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-surface border border-border text-text-muted text-[8px] flex items-center justify-center cursor-pointer hover:text-text-primary transition-colors"
                    >
                      x
                    </button>
                  </div>
                ))}
                {initialRefImages.length > 0 && (
                  <span className="text-[9px] text-text-muted uppercase tracking-wide">
                    {Math.min(initialRefImages.length, MAX_REFS)}/{MAX_REFS}
                  </span>
                )}
                {(likedCount > 0 || dislikedCount > 0) && (
                  <span className="text-[9px] tracking-wide ml-6">
                    {likedCount > 0 && <span style={{ color: '#6b9a7a' }}>{likedCount} liked</span>}
                    {likedCount > 0 && dislikedCount > 0 && <span className="text-text-muted"> / </span>}
                    {dislikedCount > 0 && <span style={{ color: '#a07272' }}>{dislikedCount} disliked</span>}
                  </span>
                )}
              </div>

              {showSliders && (
                <GenerationSliders
                  webIndex={webIdx}
                  genIndex={genIdx}
                  onWebChange={setWebIdx}
                  onGenChange={setGenIdx}
                  compact
                />
              )}

              <div className="flex items-center gap-1.5">
                <input
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  placeholder="Optional feedback for next round..."
                  className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-text-primary/[0.05] border border-glass text-text-primary placeholder-text-muted text-xs focus:outline-none focus:border-accent/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowSliders(s => !s)}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${showSliders ? 'text-text-secondary' : 'text-text-muted hover:text-text-secondary'}`}
                  title="Batch size"
                >
                  <SlidersIcon />
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Confirm and generate"
                >
                  <CheckIcon />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main pill */}
        <div className="pointer-events-auto">
          <div className="bg-surface/60 backdrop-blur-xl border border-glass rounded-full px-1.5 py-1.5 flex items-center gap-1 shadow-lg shadow-black/20">
            {generating ? (
              <button
                onClick={onInterrupt}
                className="px-4 py-1.5 rounded-full text-xs font-medium text-dislike hover:bg-dislike/10 transition-colors"
              >
                Stop
              </button>
            ) : (
              <>
                <button
                  onClick={() => setShowFeedback(true)}
                  disabled={!canGenerate}
                  className="px-4 py-1.5 rounded-full text-xs font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {uploading ? 'Uploading...' : 'Generate More'}
                </button>

                {likedCount > 0 && (
                  <button
                    onClick={onFinalize}
                    disabled={!canGenerate}
                    className="px-3 py-1.5 rounded-full text-xs font-medium text-like hover:bg-like/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Finalize ({likedCount})
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files.length) addFiles([...e.target.files])
          e.target.value = ''
        }}
      />

      {showPicker && (
        <ProjectImagePicker
          scenes={projectScenes}
          currentShotId={currentShotId}
          supplementaryItems={supplementaryItems}
          characterItems={characterItems}
          mode="multi"
          maxImages={MAX_FILES - totalImages}
          onSelect={handlePickerSelect}
          onClose={() => setShowPicker(false)}
        />
      )}

      {previewRef && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center cursor-pointer pointer-events-auto"
          onClick={() => setPreviewRef(null)}
        >
          <img src={previewRef} alt="" className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}
