import { useRef, useState } from 'react'
import { uploadImage } from '../../services/api'
import ProjectImagePicker from './ProjectImagePicker'
import DrawingPad from './DrawingPad'

// SVG icons (14x14, stroke-based)
const UploadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 9V2" /><path d="M4 4.5L7 1.5l3 3" /><path d="M2 9v2.5a1 1 0 001 1h8a1 1 0 001-1V9" />
  </svg>
)
const BrowseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3.5a1 1 0 011-1h2.5l1.5 1.5H11a1 1 0 011 1v5.5a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
  </svg>
)
const DrawIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 1.5l3 3-8 8H1.5v-3z" /><path d="M7.5 3.5l3 3" />
  </svg>
)

function ActionButtons({ onUpload, onBrowse, onDraw, disabled }) {
  return (
    <div className="image-action-group">
      <button className="image-action-icon" onClick={onUpload} disabled={disabled} title="Upload image">
        <UploadIcon />
      </button>
      {onBrowse && (
        <button className="image-action-icon" onClick={onBrowse} disabled={disabled} title="Browse project">
          <BrowseIcon />
        </button>
      )}
      {onDraw && (
        <button className="image-action-icon" onClick={onDraw} disabled={disabled} title="Draw">
          <DrawIcon />
        </button>
      )}
    </div>
  )
}

function UploadBox({ label, imageUrl, onUpload, onClear, onImageClick, onBrowseProject }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  async function handleFiles(files) {
    if (!files?.length) return
    setUploading(true)
    try {
      const data = await uploadImage(files[0])
      onUpload(data.url)
    } catch (err) {
      console.error('Upload failed:', err)
    }
    setUploading(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    handleFiles(e.dataTransfer.files)
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div onDrop={handleDrop} onDragOver={handleDragOver}>
      {label && <h3 className="upload-section-label">{label}</h3>}

      {imageUrl && (
        <div className="upload-preview">
          <img src={imageUrl} alt="uploaded" onClick={() => onImageClick?.(imageUrl)} />
          <button className="upload-preview-remove" onClick={onClear}>x</button>
        </div>
      )}

      {uploading && <div className="upload-status-text">Uploading...</div>}

      <ActionButtons
        onUpload={() => inputRef.current?.click()}
        onBrowse={onBrowseProject}
        disabled={!!imageUrl || uploading}
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}

function RefImagesUpload({ images, maxImages, onAdd, onRemove, onReorder, onImageClick, onBrowseProject, showDraw }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [drawOpen, setDrawOpen] = useState(false)
  const [dragIdx, setDragIdx] = useState(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)
  const atMax = images.length >= maxImages

  async function handleFiles(files) {
    if (!files?.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      if (images.length >= maxImages) break
      try {
        const data = await uploadImage(file)
        onAdd(data.url)
      } catch (err) {
        console.error('Upload failed:', err)
      }
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleFileDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    if (dragIdx !== null) return
    handleFiles(e.dataTransfer.files)
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  function handleThumbDrop(e, toIdx) {
    e.preventDefault()
    e.stopPropagation()
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setDragOverIdx(null); return }
    const reordered = [...images]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(toIdx, 0, moved)
    onReorder(reordered)
    setDragIdx(null)
    setDragOverIdx(null)
  }

  return (
    <div onDrop={handleFileDrop} onDragOver={handleDragOver}>
      <h3 className="upload-section-label">
        Reference Images <span style={{ color: 'var(--accent)', fontWeight: 'normal' }}>
          ({images.length}/{maxImages})
        </span>
      </h3>

      {images.length > 0 && (
        <div className="ref-images">
          {images.map((url, i) => (
            <div
              key={url}
              className={`ref-image ${dragOverIdx === i ? 'drag-over' : ''} ${dragIdx === i ? 'dragging' : ''}`}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
              onDragOver={e => { e.preventDefault(); setDragOverIdx(i) }}
              onDrop={e => handleThumbDrop(e, i)}
            >
              <img src={url} alt={`ref ${i + 1}`} onClick={() => onImageClick?.(url)} style={{ cursor: 'pointer' }} />
              <button className="remove" onClick={() => onRemove(i)}>x</button>
            </div>
          ))}
        </div>
      )}

      {uploading && <div className="upload-status-text">Uploading...</div>}

      <ActionButtons
        onUpload={() => inputRef.current?.click()}
        onBrowse={onBrowseProject}
        onDraw={showDraw ? () => setDrawOpen(true) : null}
        disabled={atMax || uploading}
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />

      {drawOpen && (
        <DrawingPad
          onSave={url => { onAdd(url); setDrawOpen(false) }}
          onClose={() => setDrawOpen(false)}
        />
      )}
    </div>
  )
}

export default function ImageUpload({ provider, formState, onFormChange, selectedImageProviders, onImageClick, projectScenes, currentShotId, supplementaryItems, characterItems, shotSupplements }) {
  const [pickerTarget, setPickerTarget] = useState(null)

  const refs = formState.referenceImages || []
  const hasNB = selectedImageProviders?.includes('nano_banana')

  const hasProjectImages = projectScenes?.some(scene =>
    scene.shots?.some(shot =>
      shot.results?.some(r => r.is_image !== false && r.url)
    )
  )

  function openPicker(target) {
    if (hasProjectImages) setPickerTarget(target)
  }

  function handlePickerSelect(urls) {
    if (!urls.length) return
    switch (pickerTarget) {
      case 'ref':
        onFormChange(prev => ({ referenceImages: [...(prev.referenceImages || []), ...urls].slice(0, 14) }))
        break
      case 'start':
        onFormChange({ startFrameUrl: urls[0] })
        break
      case 'end':
        onFormChange({ endFrameUrl: urls[0] })
        break
    }
    setPickerTarget(null)
  }

  const pickerMode = pickerTarget === 'ref' ? 'multi' : 'single'
  const pickerMax = pickerTarget === 'ref' ? 14 - refs.length : 1

  // Image tab uploads
  if (provider === 'image') {
    return (
      <div className="upload-section">
        {hasNB && (
          <div className="upload-method-group">
            <RefImagesUpload
              images={refs}
              maxImages={14}
              onAdd={url => onFormChange(prev => ({ referenceImages: [...(prev.referenceImages || []), url] }))}
              onRemove={i => onFormChange({ referenceImages: refs.filter((_, idx) => idx !== i) })}
              onReorder={arr => onFormChange({ referenceImages: arr })}
              onImageClick={onImageClick}
              onBrowseProject={hasProjectImages ? () => openPicker('ref') : null}
              showDraw
            />
          </div>
        )}

        {pickerTarget && (
          <ProjectImagePicker
            scenes={projectScenes}
            currentShotId={currentShotId}
            supplementaryItems={supplementaryItems}
            characterItems={characterItems}
            shotSupplements={shotSupplements}
            mode={pickerMode}
            maxImages={pickerMax}
            onSelect={handlePickerSelect}
            onClose={() => setPickerTarget(null)}
          />
        )}

      </div>
    )
  }

  // Video tab uploads (no Draw button)
  const isVeo = provider === 'veo'
  return (
    <div className="upload-section">
      <UploadBox
        label="Start Frame"
        imageUrl={formState.startFrameUrl}
        onUpload={url => onFormChange({ startFrameUrl: url })}
        onClear={() => onFormChange({ startFrameUrl: null })}
        onImageClick={onImageClick}
        onBrowseProject={hasProjectImages ? () => openPicker('start') : null}
      />
      {isVeo && (
        <UploadBox
          label="End Frame (Dual-frame mode)"
          imageUrl={formState.endFrameUrl}
          onUpload={url => onFormChange({ endFrameUrl: url })}
          onClear={() => onFormChange({ endFrameUrl: null })}
          onImageClick={onImageClick}
          onBrowseProject={hasProjectImages ? () => openPicker('end') : null}
        />
      )}

      {pickerTarget && (
        <ProjectImagePicker
          scenes={projectScenes}
          currentShotId={currentShotId}
          supplementaryItems={supplementaryItems}
          characterItems={characterItems}
          shotSupplements={shotSupplements}
          mode={pickerMode}
          maxImages={pickerMax}
          onSelect={handlePickerSelect}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  )
}
