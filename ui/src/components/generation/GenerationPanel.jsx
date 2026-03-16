import { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import ProviderSelector from './ProviderSelector'
import PromptInput from './PromptInput'
import ProviderSettings from './ProviderSettings'
import ImageUpload from './ImageUpload'
import ResultGrid from './ResultGrid'
import ResultCard from './ResultCard'
import ResultLightbox from './ResultLightbox'
import { uploadImage } from '../../services/api'
import DrawingPad from './DrawingPad'
import ProjectImagePicker from './ProjectImagePicker'
import useGeneration from '../../hooks/useGeneration'
import './GenerationPanel.css'

const TURNAROUND_TEMPLATE = `Create a 2x2 turnaround reference sheet:
- Top left: Front view
- Top right: 3/4 angle view
- Bottom left: Side profile
- Bottom right: Back view
- No text overlays or captions
- Make subject clearly distinguishable from background, make background color neutral and differ from major subject colors

`

const IMAGE_RATIOS = [
  { value: 'vertical', label: '9:16' },
  { value: 'horizontal', label: '16:9' },
  { value: 'square', label: '1:1' },
  { value: 'portrait', label: '3:4' },
  { value: 'landscape', label: '4:3' },
  { value: 'cinematic', label: '21:9' },
]

const DEFAULT_FORM_STATE = {
  nanoSize: '2K',
  veoSize: '1080p',
  veoRatio: '16:9',
  imageRatio: 'horizontal',
  referenceImages: [],
  startFrameUrl: null,
  endFrameUrl: null,
}

export default function GenerationPanel({
  mode = 'standalone',
  mediaType = 'image',
  tasks: externalTasks,
  onSubmit: externalSubmit,
  initialState,
  initialPrompt = '',
  onResultComplete,
  onResultDelete,
  onStateChange,
  existingResults,
  rankedResultIds,
  onRankChange,
  showBackButton,
  onBack,
  projectScenes,
  currentShotId,
  projectState,
  onClearNew,
  onResultUpload,
  onOpenSoulboard,
  shotSupplements = [],
  onRemoveShotSupplement,
  showSelected: showSelectedProp,
  onAddShotSupplement,
  onSendToDestination,
  activeFrame,
  onFrameSwitch,
  projectName,
  characterName,
  onCharacterNameChange,
  characterSubMode,
  onCharacterSubModeChange,
  activeCharacterData,
  characterVariations,
  characterVariationRankedIds,
  onVariationRankChange,
  onVariationDelete,
}) {
  const [currentTab, setCurrentTab] = useState(initialState?.tab || (mode === 'shot' && mediaType === 'video' ? 'veo' : 'image'))
  const [formState, setFormState] = useState(initialState?.form_state || DEFAULT_FORM_STATE)
  const [selectedImageProviders, setSelectedImageProviders] = useState(initialState?.providers || ['nano_banana'])
  const [prompt, setPrompt] = useState(initialState?.prompt || initialPrompt || '')
  const [versions, setVersions] = useState(initialState?.versions || 1)
  const [genError, setGenError] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [lightboxList, setLightboxList] = useState(null)
  const [resultSortMode, setResultSortMode] = useState('preference')
  const [drawBgUrl, setDrawBgUrl] = useState(null)
  const [showResultPicker, setShowResultPicker] = useState(false)
  const [showSuppAddMenu, setShowSuppAddMenu] = useState(false)
  const [showSuppPicker, setShowSuppPicker] = useState(false)
  const [suppUploading, setSuppUploading] = useState(false)
  const [submitCooldown, setSubmitCooldown] = useState(false)
  const suppUploadRef = useRef(null)
  const suppMenuRef = useRef(null)

  // Derive scene/shot numbers from storyboard scenes + current shot ID
  const { sceneNumber, shotNumber } = useMemo(() => {
    if (!projectScenes || !currentShotId) return {}
    for (let si = 0; si < projectScenes.length; si++) {
      const scene = projectScenes[si]
      const shots = scene.shots || []
      for (let shi = 0; shi < shots.length; shi++) {
        if (shots[shi].id === currentShotId) {
          return { sceneNumber: si + 1, shotNumber: shi + 1 }
        }
      }
    }
    return {}
  }, [projectScenes, currentShotId])

  const hasProjectImages = projectScenes?.some(scene =>
    scene.shots?.some(shot =>
      shot.results?.some(r => r.is_image !== false && r.url)
    )
  ) || Object.keys(projectState?.generated_supplementary || {}).length > 0
    || Object.values(projectState?.character_gallery || {}).some(c => c.turnarounds?.length || c.variations?.length)

  // Map supplementary items for ProjectImagePicker
  const supplementaryPickerItems = useMemo(() =>
    Object.entries(projectState?.generated_supplementary || {}).map(([key, item]) => ({
      id: key, url: item.url || item.content_url, source: item.source || 'unknown',
      prompt: item.prompt || '', is_image: true,
    }))
  , [projectState?.generated_supplementary])

  // Map character gallery to structured array for ProjectImagePicker
  const characterPickerItems = useMemo(() => {
    const chars = projectState?.character_gallery || {}
    const order = projectState?.character_gallery_order || []
    const allKeys = new Set(Object.keys(chars))
    const orderedKeys = order.filter(k => allKeys.has(k))
    const unorderedKeys = [...allKeys].filter(k => !order.includes(k))
    return [...orderedKeys, ...unorderedKeys].map(key => ({ id: key, ...chars[key] }))
  }, [projectState?.character_gallery, projectState?.character_gallery_order])

  // Always call hook (React rules), but ignore when externally managed
  const localGen = useGeneration({
    onComplete: onResultComplete,
    projectName,
    projectType: mode === 'standalone' ? 'generation' : 'storyboard',
  })
  const allTasks = externalTasks || localGen.tasks
  // Filter tasks by frame when in dual-frame mode
  const tasks = activeFrame
    ? allTasks.filter(t => (t.frameNumber || 1) === (activeFrame === 'end' ? 2 : 1))
    : allTasks
  const submitFn = externalSubmit || localGen.submit

  // Tabs shown in standalone, generate, and shot-video modes
  const isVideoShot = mode === 'shot' && mediaType === 'video'
  const showTabs = mode === 'standalone' || mode === 'generate' || isVideoShot
  const effectiveTab = isVideoShot
    ? currentTab  // veo
    : (mode === 'shot' || mode === 'supplementary' || mode === 'character') ? 'image' : currentTab

  // Normalize completed results: map url -> resultUrl, add status
  const mappedResults = useMemo(() =>
    (existingResults || []).map(r => ({
      ...r,
      resultUrl: r.resultUrl || r.url,
      thumbUrl: r.thumbUrl || r.thumb_url || null,
      mediumUrl: r.mediumUrl || r.medium_url || null,
      status: r.status || 'succeed',
    })),
  [existingResults])

  // Map soulboard supplement items to ResultCard-compatible format
  const mappedSupplements = useMemo(() =>
    shotSupplements.map(item => {
      const gp = item.soulboard_origin?.generation_params || {}
      return {
        id: item._key,
        _key: item._key,
        resultUrl: item.url || item.content_url,
        thumbUrl: item.thumb_url || null,
        mediumUrl: item.medium_url || null,
        provider: item.source || 'soulboard',
        is_image: true,
        status: 'succeed',
        version: 0,
        prompt: item.prompt || gp.prompt || '',
        config: {
          referenceImages: gp.reference_images || [],
        },
      }
    }),
  [shotSupplements])

  // Split tasks by stamped characterType for character mode
  const turnaroundTasks = useMemo(() =>
    mode === 'character' ? tasks.filter(t => t.config?.characterType !== 'variation') : tasks,
  [mode, tasks])

  const variationTasks = useMemo(() =>
    mode === 'character' ? tasks.filter(t => t.config?.characterType === 'variation') : [],
  [mode, tasks])

  // Map character variations to ResultCard format
  const mappedVariations = useMemo(() =>
    (characterVariations || []).map(r => ({
      ...r,
      resultUrl: r.resultUrl || r.url,
      thumbUrl: r.thumbUrl || r.thumb_url || null,
      mediumUrl: r.mediumUrl || r.medium_url || null,
      status: r.status || 'succeed',
    })),
  [characterVariations])

  // Flat list of all results for lightbox navigation, matching grid display order
  const lightboxItems = useMemo(() => {
    let items
    if (resultSortMode === 'preference' && rankedResultIds?.length > 0) {
      items = rankedResultIds
        .map(id => mappedResults.find(r => r.id === id))
        .filter(Boolean)
    } else {
      items = [...mappedResults].reverse()
    }
    for (const s of mappedSupplements) items.push(s)
    for (const v of mappedVariations) items.push(v)
    return items
  }, [mappedResults, rankedResultIds, mappedSupplements, mappedVariations, resultSortMode])

  // Sync state changes to parent for auto-save.
  // Suppress during settle period after mount so HMR/auto-populate don't trigger spurious saves.
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange
  const settledRef = useRef(false)

  useEffect(() => {
    settledRef.current = false
    const t = setTimeout(() => { settledRef.current = true }, 500)
    return () => { clearTimeout(t); settledRef.current = false }
  }, [])

  useEffect(() => {
    if (!settledRef.current) return
    onStateChangeRef.current?.({
      tab: effectiveTab,
      prompt,
      versions,
      providers: effectiveTab === 'image' ? selectedImageProviders : [effectiveTab],
      form_state: formState,
      input_images: {
        reference_images: formState.referenceImages || [],
        start_frame: formState.startFrameUrl || null,
        end_frame: formState.endFrameUrl || null,
      },
    })
  }, [effectiveTab, prompt, versions, selectedImageProviders, formState])

  // Auto-populate form from the selected/preferred result
  const selectedId = rankedResultIds?.[0] || null
  const selectedResult = useMemo(() => {
    if (!selectedId || !existingResults?.length) return null
    return existingResults.find(r => r.id === selectedId)
  }, [selectedId, existingResults])

  const prevSelectedIdRef = useRef(selectedId)
  const hadSavedStateRef = useRef(!!initialState?.form_state)
  useEffect(() => {
    if (!selectedResult) return
    // After settle: only apply when selection changes
    if (prevSelectedIdRef.current === selectedId && settledRef.current) return
    // On mount: skip if there's already saved form state (don't override user uploads)
    if (!settledRef.current && hadSavedStateRef.current) return
    prevSelectedIdRef.current = selectedId
    if (selectedResult.prompt) setPrompt(selectedResult.prompt)
    if (selectedResult.config) {
      const { providers, ...rest } = selectedResult.config
      setFormState(prev => ({ ...prev, ...rest }))
      if (providers) setSelectedImageProviders(providers)
    }
  }, [selectedId, selectedResult])

  // Character turnaround mode: force square ratio, auto-populate prompt template
  const prevCharSubModeRef = useRef(null)
  useEffect(() => {
    if (mode !== 'character') return
    if (characterSubMode === 'turnaround') {
      setFormState(prev => ({ ...prev, imageRatio: 'square' }))
    } else if (characterSubMode === 'variation') {
      // Auto-load top turnaround as reference image
      const topTurnaround = activeCharacterData?.turnarounds?.find(
        t => t.id === activeCharacterData.turnaround_ranked_ids?.[0]
      ) || activeCharacterData?.turnarounds?.[0]
      if (topTurnaround?.url) {
        setFormState(prev => {
          const refs = prev.referenceImages || []
          if (refs.includes(topTurnaround.url)) return prev
          return { ...prev, referenceImages: [topTurnaround.url, ...refs] }
        })
      }
    }
    prevCharSubModeRef.current = characterSubMode
  }, [mode, characterSubMode, activeCharacterData])

  const onFormChange = useCallback((updates) => {
    setFormState(prev => {
      const resolved = typeof updates === 'function' ? updates(prev) : updates
      return { ...prev, ...resolved }
    })
  }, [])

  const panelRef = useRef(null)

  // Close supplementary add menu on outside click
  useEffect(() => {
    if (!showSuppAddMenu) return
    function handleClickOutside(e) {
      if (suppMenuRef.current && !suppMenuRef.current.contains(e.target)) setShowSuppAddMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSuppAddMenu])

  async function handleSuppUploadFiles(files) {
    if (!files?.length || !onAddShotSupplement) return
    setSuppUploading(true)
    for (const file of Array.from(files)) {
      try {
        const data = await uploadImage(file)
        onAddShotSupplement({ url: data.url, source: 'upload', prompt: '' })
      } catch (err) {
        console.error('Supplementary upload failed:', err)
      }
    }
    setSuppUploading(false)
    if (suppUploadRef.current) suppUploadRef.current.value = ''
  }

  function handleEdit(task) {
    if (!task.resultUrl) return
    setFormState(prev => ({
      ...prev,
      referenceImages: [...(prev.referenceImages || []), task.resultUrl],
    }))
    panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleReapply(task) {
    if (task.prompt) setPrompt(task.prompt)
    if (task.config) {
      const { providers, ...rest } = task.config
      setFormState(prev => ({ ...prev, ...rest }))
      if (providers) setSelectedImageProviders(providers)
    }
  }

  async function handleRetry(task, deleteFn) {
    deleteFn?.(task)
    setGenError(null)
    try {
      const config = { ...task.config, versions: 1 }
      const { errors } = await submitFn(task.provider, task.prompt, config)
      if (errors.length) setGenError(errors.join(', '))
    } catch (err) {
      setGenError(err.message || 'Retry failed')
    }
  }

  function handleLightboxOpen(task) {
    if (task.isNew && onClearNew) onClearNew(task.id)
    setLightbox(task)
    setLightboxList(null)
  }

  async function handleGenerate() {
    if (!prompt.trim() || submitCooldown) return
    setSubmitCooldown(true)
    setTimeout(() => setSubmitCooldown(false), 1500)
    onClearNew?.()
    setGenError(null)

    const fullState = { ...formState, versions, _source: mode === 'generate' ? 'standalone' : mode, ...(mode === 'character' && { characterType: characterSubMode }) }
    let providers

    if (currentTab === 'image') {
      providers = selectedImageProviders
    } else {
      providers = currentTab
    }

    // Turnaround mode: prepend the turnaround sheet template
    const finalPrompt = (mode === 'character' && characterSubMode === 'turnaround')
      ? TURNAROUND_TEMPLATE + prompt
      : prompt

    try {
      const { errors } = await submitFn(providers, finalPrompt, fullState)
      if (errors.length) {
        setGenError(errors.join(', '))
      }
    } catch (err) {
      setGenError(err.message || 'Generation failed')
    }
  }

  return (
    <div className="generation-panel" ref={panelRef}>
      {showBackButton && (
        <div className="gen-top-bar">
          <button className="gen-back-btn" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="7" x2="2" y2="7" />
              <polyline points="6,3 2,7 6,11" />
            </svg>
            Back
          </button>
          {onOpenSoulboard && (
            <button className="gen-explore-btn" onClick={onOpenSoulboard}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="2" />
                <circle cx="8" cy="8" r="5" />
              </svg>
              Explore
            </button>
          )}
        </div>
      )}

      {activeFrame && onFrameSwitch && (
        <div className="frame-switcher">
          <button className={`frame-tab ${activeFrame === 'start' ? 'active' : ''}`} onClick={() => onFrameSwitch('start')}>Start</button>
          <button className={`frame-tab ${activeFrame === 'end' ? 'active' : ''}`} onClick={() => onFrameSwitch('end')}>End</button>
        </div>
      )}

      {showTabs && (
        <div className="tab-switcher">
          {(isVideoShot ? ['veo'] : ['image', 'veo']).map(tab => (
            <button
              key={tab}
              className={`tab ${effectiveTab === tab ? 'active' : ''}`}
              onClick={() => setCurrentTab(tab)}
            >
              {tab === 'image' ? 'Image' : 'Veo'}
            </button>
          ))}
        </div>
      )}

      <div className="generation-content">
        {/* Left column: uploads */}
        <div>
          <ImageUpload
            provider={effectiveTab}
            formState={formState}
            onFormChange={onFormChange}
            selectedImageProviders={selectedImageProviders}
            onImageClick={url => {
              const inputUrls = [
                ...(formState.referenceImages || []),
                ...(formState.startFrameUrl ? [formState.startFrameUrl] : []),
                ...(formState.endFrameUrl ? [formState.endFrameUrl] : []),
              ].map(u => ({ resultUrl: u }))
              setLightbox({ resultUrl: url })
              setLightboxList(inputUrls)
            }}
            projectScenes={projectScenes}
            currentShotId={currentShotId}
            supplementaryItems={supplementaryPickerItems}
            characterItems={characterPickerItems}
            shotSupplements={projectState?.shot_supplements}
          />
        </div>

        {/* Right column: settings */}
        <div className="settings-section">
          {/* Character mode header */}
          {mode === 'character' && (
            <div className="char-mode-header">
              <div className="form-group">
                <label>Character Name</label>
                <input
                  className="char-mode-name-input"
                  type="text"
                  value={characterName || ''}
                  onChange={(e) => onCharacterNameChange?.(e.target.value)}
                  placeholder="Character name..."
                />
              </div>
              <div className="form-group">
                <label>Type</label>
                <div className="char-submode-toggle">
                  <button
                    className={`char-submode-btn ${characterSubMode === 'turnaround' ? 'active' : ''}`}
                    onClick={() => onCharacterSubModeChange?.('turnaround')}
                  >
                    Turnaround
                  </button>
                  <button
                    className={`char-submode-btn ${characterSubMode === 'variation' ? 'active' : ''}`}
                    onClick={() => onCharacterSubModeChange?.('variation')}
                  >
                    Variation
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'character' && characterSubMode === 'turnaround' && (
            <div className="char-turnaround-hint">Describe your character — it will be generated as a turnaround sheet for consistency.</div>
          )}

          {/* Image provider selector */}
          {effectiveTab === 'image' && (
            <div className="form-group">
              <label>Provider</label>
              <ProviderSelector
                selected={selectedImageProviders}
                onChange={setSelectedImageProviders}
              />
            </div>
          )}

          {/* Aspect ratio + versions row (for image tab, hidden for turnaround mode) */}
          {effectiveTab === 'image' && !(mode === 'character' && characterSubMode === 'turnaround') && (
            <div className="ratio-versions-row">
              <div className="form-group">
                <label>Aspect Ratio</label>
                <div className="inline-options">
                  {IMAGE_RATIOS.map(r => (
                    <div
                      key={r.value}
                      className={`inline-option ${formState.imageRatio === r.value ? 'active' : ''}`}
                      onClick={() => onFormChange({ imageRatio: r.value })}
                    >
                      {r.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Versions</label>
                <div className="version-selector">
                  {[1, 2, 3, 4].map(v => (
                    <button
                      key={v}
                      className={`version-btn ${versions === v ? 'active' : ''}`}
                      onClick={() => setVersions(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Video tab: versions row bundled with provider settings */}
          {effectiveTab !== 'image' && (
            <>
              <ProviderSettings
                provider={effectiveTab}
                formState={formState}
                onFormChange={onFormChange}
              />
              <div className="form-group">
                <label>Versions</label>
                <div className="version-selector">
                  {[1, 2, 3, 4].map(v => (
                    <button
                      key={v}
                      className={`version-btn ${versions === v ? 'active' : ''}`}
                      onClick={() => setVersions(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Prompt — collect active images for multimodal optimizer */}
          <PromptInput
            value={prompt}
            onChange={setPrompt}
            imageUrls={[
              ...(formState.referenceImages || []),
              ...(effectiveTab !== 'image' && formState.startFrameUrl ? [formState.startFrameUrl] : []),
              ...(effectiveTab !== 'image' && formState.endFrameUrl ? [formState.endFrameUrl] : []),
            ]}
            projectState={projectState}
            scenes={projectScenes}
            sceneNumber={sceneNumber}
            shotNumber={shotNumber}
            currentShotId={currentShotId}
            mediaType={effectiveTab === 'image' ? 'image' : 'video'}
            frameMode={formState.startFrameUrl && formState.endFrameUrl ? 'dual' : formState.startFrameUrl ? 'single' : 'none'}
          />

          {/* Image-specific provider settings */}
          {effectiveTab === 'image' && (
            <ProviderSettings
              provider="image"
              formState={formState}
              onFormChange={onFormChange}
              selectedImageProviders={selectedImageProviders}
            />
          )}

          {/* Generate button */}
          <button
            className="generate-btn"
            disabled={!prompt.trim() || submitCooldown}
            onClick={handleGenerate}
          >
            {submitCooldown ? <span className="optimizer-spinner" /> : 'Generate'}
          </button>
          {genError && <div className="gen-error">{genError}</div>}
        </div>
      </div>

      {/* Results */}
      <ResultGrid
        tasks={mode === 'character' ? turnaroundTasks : tasks}
        completedResults={mappedResults}
        onLightboxOpen={handleLightboxOpen}
        onReapply={handleReapply}
        onRetry={onResultDelete ? (task) => handleRetry(task, onResultDelete) : undefined}
        onEdit={handleEdit}
        onDelete={onResultDelete}
        rankedResultIds={rankedResultIds}
        onRankChange={onRankChange}
        onResultUpload={onResultUpload}
        onBrowseProject={() => setShowResultPicker(true)}
        hasProjectImages={hasProjectImages}
        onClearNew={onClearNew}
        sectionLabel={mode === 'shot' ? 'Frames' : mode === 'character' ? 'Turnarounds' : (mode === 'supplementary' || mode === 'generate') ? 'Assets' : 'Results'}
        showSelected={showSelectedProp !== undefined ? showSelectedProp : mode !== 'supplementary'}
        onSendToDestination={onSendToDestination}
        projectScenes={projectScenes}
        supplementaryItems={mode === 'shot' ? mappedSupplements : []}
        onSupplementaryClick={handleLightboxOpen}
        onSupplementaryEdit={handleEdit}
        onSupplementaryDelete={onRemoveShotSupplement}
        sortMode={resultSortMode}
        onSortModeChange={setResultSortMode}
      />

      {/* Shot supplementary images */}
      {mode === 'shot' && (mappedSupplements.length > 0 || onAddShotSupplement) && (
        <div className="results-section">
          <div className="results-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2>Supplementary</h2>
              {onAddShotSupplement && (
                <>
                  <input
                    ref={suppUploadRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => {
                      handleSuppUploadFiles(e.target.files)
                      setShowSuppAddMenu(false)
                    }}
                  />
                  <div ref={suppMenuRef} style={{ position: 'relative' }}>
                    <button
                      className="result-upload-btn"
                      onClick={() => setShowSuppAddMenu(prev => !prev)}
                      disabled={suppUploading}
                    >
                      {suppUploading ? '...' : '+'}
                    </button>
                    {showSuppAddMenu && (
                      <div className="result-add-menu">
                        <button
                          className="result-add-menu-item"
                          onClick={() => suppUploadRef.current?.click()}
                        >
                          Upload
                        </button>
                        {hasProjectImages && (
                          <button
                            className="result-add-menu-item"
                            onClick={() => {
                              setShowSuppAddMenu(false)
                              setShowSuppPicker(true)
                            }}
                          >
                            Browse project
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          {mappedSupplements.length > 0 && (
            <div className="results-grid">
              {mappedSupplements.map(task => (
                <ResultCard
                  key={task._key}
                  task={task}
                  onClick={handleLightboxOpen}
                  onEdit={handleEdit}
                  onDelete={onRemoveShotSupplement ? () => onRemoveShotSupplement(task._key) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Character variations section */}
      {mode === 'character' && (
        <ResultGrid
          tasks={variationTasks}
          completedResults={mappedVariations}
          onLightboxOpen={handleLightboxOpen}
          onReapply={handleReapply}
          onRetry={onVariationDelete ? (task) => handleRetry(task, onVariationDelete) : undefined}
          onEdit={handleEdit}
          onDelete={onVariationDelete}
          rankedResultIds={characterVariationRankedIds}
          onRankChange={onVariationRankChange}
          onResultUpload={onResultUpload}
          onBrowseProject={() => setShowResultPicker(true)}
          hasProjectImages={hasProjectImages}
          sectionLabel="Variations"
          showSelected={false}
          sortMode={resultSortMode}
          onSortModeChange={setResultSortMode}
          />
      )}

      {/* Project image picker for supplementary */}
      {showSuppPicker && (
        <ProjectImagePicker
          scenes={projectScenes}
          currentShotId={currentShotId}
          supplementaryItems={supplementaryPickerItems}
          characterItems={characterPickerItems}
          shotSupplements={projectState?.shot_supplements}
          mode="multi"
          onClose={() => setShowSuppPicker(false)}
          onSelect={(urls) => {
            if (!onAddShotSupplement) return
            const allResults = projectScenes.flatMap(s =>
              s.shots.flatMap(sh => sh.results || [])
            )
            for (const url of urls) {
              const source = allResults.find(r => r.url === url)
              onAddShotSupplement({
                url,
                source: source?.provider || 'project',
                prompt: source?.prompt || '',
              })
            }
          }}
        />
      )}

      {/* Project image picker for adding existing images as results */}
      {showResultPicker && (
        <ProjectImagePicker
          scenes={projectScenes}
          currentShotId={currentShotId}
          supplementaryItems={supplementaryPickerItems}
          characterItems={characterPickerItems}
          shotSupplements={projectState?.shot_supplements}
          mode="multi"
          onClose={() => setShowResultPicker(false)}
          onSelect={(urls) => {
            if (!onResultUpload) return
            // Build lookup of all project results for metadata preservation
            const allResults = projectScenes.flatMap(s =>
              s.shots.flatMap(sh => sh.results || [])
            )
            for (const url of urls) {
              const source = allResults.find(r => r.url === url)
              onResultUpload({
                url,
                provider: source?.provider || 'upload',
                is_image: true,
                prompt: source?.prompt || '',
                config: source?.config || {},
                timestamp: new Date().toISOString(),
                needsMigration: false,
              })
            }
          }}
        />
      )}

      {/* Lightbox */}
      {lightbox && (
        <ResultLightbox
          item={lightbox}
          allItems={lightboxList || lightboxItems}
          onClose={() => { setLightbox(null); setLightboxList(null) }}
          onItemChange={setLightbox}
          onEdit={handleEdit}
          onReapply={handleReapply}
          onDraw={item => { setLightbox(null); setDrawBgUrl(item.resultUrl) }}
        />
      )}

      {/* Drawing pad with background image */}
      {drawBgUrl && (
        <DrawingPad
          backgroundUrl={drawBgUrl}
          onSave={url => {
            setFormState(prev => ({
              ...prev,
              referenceImages: [...(prev.referenceImages || []), url],
            }))
            setDrawBgUrl(null)
          }}
          onClose={() => setDrawBgUrl(null)}
        />
      )}
    </div>
  )
}
