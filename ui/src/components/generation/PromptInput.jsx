import { useState, useRef, useEffect, useMemo } from 'react'
import { optimizePromptStream, uploadImage } from '../../services/api'
import { buildCreativeContext } from '../../utils/creativeContext'
import ProjectImagePicker from './ProjectImagePicker'

export default function PromptInput({ value, onChange, imageUrls, projectState, scenes, sceneNumber, shotNumber, mediaType, frameMode, currentShotId }) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [mode, setMode] = useState('concise') // 'detailed' or 'concise'
  const [instructions, setInstructions] = useState('')
  const [running, setRunning] = useState(false)
  const [thinkingText, setThinkingText] = useState('')
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [applied, setApplied] = useState(null)
  const [showContext, setShowContext] = useState(false)
  const [contextImages, setContextImages] = useState([])
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [showContextPicker, setShowContextPicker] = useState(false)
  const contextMenuRef = useRef(null)
  const contextUploadRef = useRef(null)
  const contextText = buildCreativeContext(projectState, scenes, sceneNumber, shotNumber)

  // Close context menu on outside click
  useEffect(() => {
    if (!showContextMenu) return
    function handleClickOutside(e) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) setShowContextMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showContextMenu])

  // Derive picker items from projectState
  const supplementaryPickerItems = useMemo(() =>
    Object.entries(projectState?.generated_supplementary || {}).map(([key, item]) => ({
      id: key, url: item.url || item.content_url, source: item.source || 'unknown',
      prompt: item.prompt || '', is_image: true,
    }))
  , [projectState?.generated_supplementary])

  const characterPickerItems = useMemo(() => {
    const chars = projectState?.character_gallery || {}
    const order = projectState?.character_gallery_order || []
    const allKeys = new Set(Object.keys(chars))
    const orderedKeys = order.filter(k => allKeys.has(k))
    const unorderedKeys = [...allKeys].filter(k => !order.includes(k))
    return [...orderedKeys, ...unorderedKeys].map(key => ({ id: key, ...chars[key] }))
  }, [projectState?.character_gallery, projectState?.character_gallery_order])

  const hasProjectImages = scenes?.some(scene =>
    scene.shots?.some(shot =>
      shot.results?.some(r => r.is_image !== false && r.url)
    )
  ) || supplementaryPickerItems.length > 0
    || characterPickerItems.some(c => c.turnarounds?.length || c.variations?.length)

  async function handleContextUpload(files) {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      try {
        const data = await uploadImage(file)
        setContextImages(prev => [...prev, { url: data.url, source: 'upload', prompt: '' }])
      } catch (err) {
        console.error('Context image upload failed:', err)
      }
    }
    if (contextUploadRef.current) contextUploadRef.current.value = ''
  }

  function handleContextPickerSelect(urls) {
    const allResults = (scenes || []).flatMap(s =>
      (s.shots || []).flatMap(sh => sh.results || [])
    )
    const suppMap = projectState?.generated_supplementary || {}
    const charGallery = projectState?.character_gallery || {}

    for (const url of urls) {
      // Check shot results
      const shotResult = allResults.find(r => r.url === url)
      if (shotResult) {
        setContextImages(prev => [...prev, {
          url, source: 'shot_result', prompt: shotResult.prompt || '', provider: shotResult.provider || '',
        }])
        continue
      }
      // Check supplementary items
      const suppEntry = Object.values(suppMap).find(item => (item.url || item.content_url) === url)
      if (suppEntry) {
        setContextImages(prev => [...prev, {
          url, source: 'supplementary', prompt: suppEntry.prompt || '',
        }])
        continue
      }
      // Check character gallery
      let foundChar = false
      for (const char of Object.values(charGallery)) {
        const allCharImages = [...(char.turnarounds || []), ...(char.variations || [])]
        if (allCharImages.some(img => img.url === url)) {
          setContextImages(prev => [...prev, { url, source: 'character', prompt: '' }])
          foundChar = true
          break
        }
      }
      if (!foundChar) {
        setContextImages(prev => [...prev, { url, source: 'project', prompt: '' }])
      }
    }
  }

  async function runOptimize() {
    if (!value.trim()) return
    setRunning(true)
    setError(null)
    setResults(null)
    setApplied(null)
    setThinkingText('')
    try {
      await optimizePromptStream(
        value, instructions || null, imageUrls,
        {
          projectState, scenes, sceneNumber, shotNumber, mode, mediaType, frameMode,
          contextImages: contextImages.length ? contextImages : undefined,
        },
        (event) => {
          if (event.type === 'thinking') {
            setThinkingText(event.text)
          } else if (event.type === 'optimize_complete') {
            setResults({ 'Optimized Prompt': event.result })
          } else if (event.type === 'error') {
            setError(event.error)
          }
        }
      )
    } catch (err) {
      setError(err.message)
    }
    setRunning(false)
    setThinkingText('')
  }

  function applyResult(key, text) {
    onChange(text)
    setApplied(key)
    setPanelOpen(false)
  }

  return (
    <div className="form-group">
      <div className="prompt-label-row">
        <label>Prompt</label>
        <button className="stylize-btn" onClick={() => setPanelOpen(!panelOpen)}>
          Prompt Stylizer
        </button>
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Enter your prompt here..."
      />
      {panelOpen && (
        <div className="optimizer-panel open">
          <button className="close-panel" onClick={() => setPanelOpen(false)}>&times;</button>
          {/* Provider selector hidden — always uses Gemini
          <label style={{ fontSize: '12px', marginBottom: 4, display: 'block' }}>Provider</label>
          <div className="inline-options" style={{ marginBottom: 8 }}>
            {OPT_PROVIDERS.map(p => (
              <div
                key={p.value}
                className={`inline-option ${optProvider === p.value ? 'active' : ''}`}
                onClick={() => setOptProvider(p.value)}
              >
                {p.label}
              </div>
            ))}
          </div>
          */}
          <div className="inline-options" style={{ gap: 6, marginBottom: 8 }}>
            <div
              className={`inline-option ${mode === 'concise' ? 'active' : ''}`}
              onClick={() => setMode('concise')}
              style={{ padding: '4px 12px', fontSize: 12 }}
            >Concise</div>
            <div
              className={`inline-option ${mode === 'detailed' ? 'active' : ''}`}
              onClick={() => setMode('detailed')}
              style={{ padding: '4px 12px', fontSize: 12 }}
            >Structured</div>
          </div>
          <div className="optimizer-input-row">
            <input
              type="text"
              className="optimizer-instructions"
              placeholder="Optional instructions (e.g. 'make it more cinematic', 'focus on lighting')"
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !running) runOptimize() }}
            />
            <div ref={contextMenuRef} style={{ position: 'relative' }}>
              <button
                className="optimizer-context-btn"
                onClick={() => setShowContextMenu(prev => !prev)}
                title="Add context images"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="8" y1="3" x2="8" y2="13" />
                  <line x1="3" y1="8" x2="13" y2="8" />
                </svg>
              </button>
              {showContextMenu && (
                <div className="result-add-menu">
                  <input
                    ref={contextUploadRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => {
                      handleContextUpload(e.target.files)
                      setShowContextMenu(false)
                    }}
                  />
                  <button
                    className="result-add-menu-item"
                    onClick={() => contextUploadRef.current?.click()}
                  >Upload</button>
                  {hasProjectImages && (
                    <button
                      className="result-add-menu-item"
                      onClick={() => {
                        setShowContextMenu(false)
                        setShowContextPicker(true)
                      }}
                    >Browse project</button>
                  )}
                </div>
              )}
            </div>
            <button
              className="optimizer-run-btn"
              onClick={runOptimize}
              disabled={running}
              title="Run optimizer"
            >
              {running ? <span className="optimizer-spinner" /> : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2L7 9" />
                  <path d="M14 2L9.5 14L7 9L2 6.5L14 2Z" />
                </svg>
              )}
            </button>
          </div>
          {contextImages.length > 0 && (
            <div className="optimizer-context-images">
              {contextImages.map((img, i) => (
                <div key={i} className="optimizer-context-thumb">
                  <img src={img.url} alt="" />
                  <button onClick={() => setContextImages(prev => prev.filter((_, j) => j !== i))}>&times;</button>
                </div>
              ))}
            </div>
          )}
          <div className="optimizer-actions">
            {contextText && (
              <button
                type="button"
                className={`context-toggle ${showContext ? 'active' : ''}`}
                onClick={() => setShowContext(s => !s)}
              >
                Creative context
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={showContext ? "M2.5 6.5L5 4L7.5 6.5" : "M2.5 3.5L5 6L7.5 3.5"} />
                </svg>
              </button>
            )}
          </div>
          {showContext && contextText && (
            <div className="context-preview">{contextText}</div>
          )}
          {running && (
            <div className="optimizer-thinking">
              {thinkingText
                ? <pre>{thinkingText}</pre>
                : <p className="optimizer-thinking-placeholder">Thinking...</p>
              }
            </div>
          )}
          {error && <div className="optimizer-error" style={{ marginTop: 10 }}>{error}</div>}
          {results && (
            <div className="optimizer-results">
              {Object.entries(results).map(([name, text]) => (
                <div key={name} className="optimizer-result">
                  <div className="optimizer-result-header">
                    <span className="optimizer-result-label">{name}</span>
                    <button
                      className={`apply-btn ${applied === name ? 'applied' : ''}`}
                      onClick={() => applyResult(name, text)}
                    >
                      {applied === name ? 'Applied' : 'Apply'}
                    </button>
                  </div>
                  <div className="optimizer-result-text">{text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showContextPicker && (
        <ProjectImagePicker
          scenes={scenes}
          currentShotId={currentShotId}
          supplementaryItems={supplementaryPickerItems}
          characterItems={characterPickerItems}
          shotSupplements={projectState?.shot_supplements}
          mode="multi"
          onClose={() => setShowContextPicker(false)}
          onSelect={(urls) => {
            handleContextPickerSelect(urls)
          }}
        />
      )}
    </div>
  )
}
