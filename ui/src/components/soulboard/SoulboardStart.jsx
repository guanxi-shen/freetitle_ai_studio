/**
 * Soulboard start screen with query input, reference upload, and generation sliders.
 */
import { useState, useRef, useEffect } from 'react'
import { uploadImage } from '../../services/api'
import { STATUS } from '../../hooks/useSoulboard'
import ProjectImagePicker from '../generation/ProjectImagePicker'
import GenerationSliders, { indicesToPreferences, WEB_DEFAULT, GEN_DEFAULT } from './GenerationSliders'

const MAX_FILES = 10
const MAX_SIZE_MB = 25

export default function SoulboardStart({ status, onStart, initialQuery = '', projectScenes, currentShotId, supplementaryItems, characterItems }) {
  const [query, setQuery] = useState(initialQuery)
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [projectUrls, setProjectUrls] = useState([]) // already-uploaded GCS URLs from project browse
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [webIdx, setWebIdx] = useState(WEB_DEFAULT)
  const [genIdx, setGenIdx] = useState(GEN_DEFAULT)
  const [showOptions, setShowOptions] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const fileInputRef = useRef(null)
  const previewsRef = useRef(previews)
  previewsRef.current = previews

  const hasProjectImages = supplementaryItems?.length > 0 || projectScenes?.some(scene =>
    scene.shots?.some(shot =>
      shot.results?.some(r => r.is_image !== false && r.url)
    )
  )

  const totalImages = files.length + projectUrls.length

  useEffect(() => {
    return () => previewsRef.current.forEach(p => URL.revokeObjectURL(p))
  }, [])

  const busy = status === STATUS.STARTING || uploading

  const addFiles = (newFiles) => {
    setUploadError(null)
    const valid = []
    for (const f of newFiles) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        setUploadError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB, max ${MAX_SIZE_MB} MB)`)
        continue
      }
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
    const newUrls = urls.slice(0, remaining)
    setProjectUrls(prev => [...prev, ...newUrls])
    setShowPicker(false)
  }

  const handleStart = async () => {
    if (!query.trim() || busy) return

    let imageUrls = [...projectUrls]
    if (files.length > 0) {
      try {
        setUploading(true)
        setUploadError(null)
        const results = await Promise.all(files.map(f => uploadImage(f)))
        imageUrls = [...imageUrls, ...results.map(r => r.url)]
      } catch (e) {
        setUploadError(e.message)
        setUploading(false)
        return
      }
      setUploading(false)
    }

    const preferences = indicesToPreferences(webIdx, genIdx)
    onStart(query.trim(), preferences, imageUrls)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) handleStart()
  }

  const handleDrop = (e) => {
    e.preventDefault()
    if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files])
  }

  return (
    <div className="max-w-2xl mx-auto mt-[12vh] flex flex-col gap-6 relative px-4">
      {/* Ambient glow */}
      <div className="absolute -inset-20 bg-accent/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="text-center mb-2 relative">
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary mb-2">
          Explore your aesthetic
        </h2>
        <p className="text-text-secondary text-sm">
          Describe the visual direction you want to explore. Add reference photos to guide the art director.
        </p>
      </div>

      <textarea
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Dark ethereal forest with bioluminescent elements, moody cinematography, deep teals and purples..."
        rows={4}
        autoFocus
        className="w-full px-4 py-3 rounded-2xl bg-surface border border-glass-subtle text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent transition-colors text-sm leading-relaxed shadow-lg shadow-black/20 relative"
      />

      {/* Toolbar — icon pills for upload, browse, options */}
      <div onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-surface/60 backdrop-blur-xl rounded-lg p-0.5 gap-0.5 border border-glass">
            {/* Upload files */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={totalImages >= MAX_FILES}
              className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-text-primary/[0.06] disabled:opacity-30 transition-colors"
              title="Upload reference images"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 10V3.5" />
                <polyline points="5,5.5 8,3 11,5.5" />
                <path d="M3 10v2.5a1 1 0 001 1h8a1 1 0 001-1V10" />
              </svg>
            </button>

            {/* Browse project */}
            {hasProjectImages && (
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                disabled={totalImages >= MAX_FILES}
                className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-text-primary/[0.06] disabled:opacity-30 transition-colors"
                title="Browse project images"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 4.5a1 1 0 011-1h3.17a1 1 0 01.7.29l1.13 1.13a1 1 0 00.7.29H13a1 1 0 011 1v5.29a1 1 0 01-1 1H3a1 1 0 01-1-1V4.5z" />
                </svg>
              </button>
            )}

            {/* Divider */}
            <div className="w-px h-4 bg-glass mx-0.5" />

            {/* Options / sliders */}
            <button
              type="button"
              onClick={() => setShowOptions(s => !s)}
              className={`p-1.5 rounded-md transition-colors ${
                showOptions
                  ? 'bg-text-primary/10 text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-text-primary/[0.06]'
              }`}
              title="Generation options"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.5 2.5a.5.5 0 00-1 0v4a.5.5 0 001 0v-4zM13.5 12a.5.5 0 00-1 0v1.5a.5.5 0 001 0V12zM3 12.5a.5.5 0 01.5.5v1.5a.5.5 0 01-1 0V13a.5.5 0 01.5-.5zM3.5 2.5a.5.5 0 00-1 0v4a.5.5 0 001 0v-4zM8 9a.5.5 0 01.5.5v4a.5.5 0 01-1 0v-4A.5.5 0 018 9zM8.5 2.5a.5.5 0 00-1 0v1a.5.5 0 001 0v-1zM8 5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM3 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM13 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
              </svg>
            </button>
          </div>

          {totalImages > 0 && (
            <span className="text-[10px] text-text-muted tabular-nums">{totalImages}/{MAX_FILES}</span>
          )}
        </div>

        {/* Thumbnails */}
        {(previews.length > 0 || projectUrls.length > 0) && (
          <div className="flex flex-wrap gap-2 mt-3">
            {projectUrls.map((url, i) => (
              <div key={`p-${i}`} className="relative group">
                <img
                  src={url}
                  alt={`project ref ${i + 1}`}
                  className="w-14 h-14 rounded-lg object-cover border border-glass"
                />
                <button
                  onClick={() => removeProjectUrl(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface border border-glass text-text-muted text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-text-primary hover:border-text-muted transition-all"
                >
                  x
                </button>
              </div>
            ))}
            {previews.map((url, i) => (
              <div key={`f-${i}`} className="relative group">
                <img
                  src={url}
                  alt={files[i]?.name}
                  className="w-14 h-14 rounded-lg object-cover border border-glass"
                />
                <button
                  onClick={() => removeFile(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface border border-glass text-text-muted text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-text-primary hover:border-text-muted transition-all"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {showOptions && (
          <div className="mt-3 flex flex-col gap-3">
            <GenerationSliders
              webIndex={webIdx}
              genIndex={genIdx}
              onWebChange={setWebIdx}
              onGenChange={setGenIdx}
            />
          </div>
        )}

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
      </div>

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

      {uploadError && (
        <p className="text-xs text-dislike">{uploadError}</p>
      )}

      <button
        onClick={handleStart}
        disabled={!query.trim() || busy}
        className="w-full py-3 rounded-2xl bg-gradient-to-r from-accent to-accent-hover text-white font-medium text-sm hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all relative"
      >
        {uploading ? 'Uploading references...' : status === STATUS.STARTING ? 'Starting...' : 'Start Exploration'}
      </button>
    </div>
  )
}
