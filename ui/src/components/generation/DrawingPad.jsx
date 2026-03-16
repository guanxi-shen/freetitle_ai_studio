import { useRef, useState, useCallback, useEffect } from 'react'
import { uploadImage } from '../../services/api'

const DEFAULT_W = 1024
const DEFAULT_H = 768
const MAX_DIM = 1024
const MAX_REFRAME_DIM = 4096
const MAX_UNDO = 50
const FONT_SIZES = [20, 36, 56]
const FONT_LABELS = ['S', 'M', 'L']
const MIN_REFRAME = 40
const REFRAME_PAD = 0.9  // output rect fills 90% of the viewport

export default function DrawingPad({ onSave, onClose, backgroundUrl }) {
  const canvasRef = useRef(null)
  const wrapperRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [tool, setTool] = useState('pen')       // 'pen' | 'eraser' | 'text' | 'reframe'
  const [color, setColor] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(5)
  const [fontSize, setFontSize] = useState(36)
  const [saving, setSaving] = useState(false)
  const [textInput, setTextInput] = useState(null) // { x, y } in CSS coords
  const [historyLen, setHistoryLen] = useState(1)
  const [bgLoading, setBgLoading] = useState(!!backgroundUrl)
  const [reframe, setReframe] = useState(null)    // { x, y, w, h } in logical canvas pixels
  const drawingRef = useRef(false)
  const historyRef = useRef([])
  const textRef = useRef(null)
  const reframeDragRef = useRef(null)             // { type, startX, startY, startRect }
  const previewRef = useRef(null)                 // data URL snapshot for reframe preview

  // Initialize canvas: white fill, then optionally draw background image
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (backgroundUrl) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const scale = Math.min(MAX_DIM / img.width, MAX_DIM / img.height, 1)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        canvas.width = w
        canvas.height = h
        setCanvasSize({ w, h })
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        historyRef.current = [ctx.getImageData(0, 0, w, h)]
        setHistoryLen(1)
        setBgLoading(false)
      }
      img.onerror = (e) => {
        console.error('[DrawingPad] bg image load failed:', backgroundUrl, e)
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, DEFAULT_W, DEFAULT_H)
        historyRef.current = [ctx.getImageData(0, 0, DEFAULT_W, DEFAULT_H)]
        setBgLoading(false)
      }
      img.src = backgroundUrl
    } else {
      canvas.width = DEFAULT_W
      canvas.height = DEFAULT_H
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, DEFAULT_W, DEFAULT_H)
      historyRef.current = [ctx.getImageData(0, 0, DEFAULT_W, DEFAULT_H)]
    }
  }, [])

  function getPos(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  function getCSSPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  function saveSnapshot() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height)
    historyRef.current.push(snap)
    if (historyRef.current.length > MAX_UNDO) historyRef.current.shift()
    setHistoryLen(historyRef.current.length)
  }

  // Commit text input content onto canvas
  function commitText() {
    if (!textRef.current || !textInput) return
    const val = textRef.current.value
    if (!val.trim()) { setTextInput(null); return }

    saveSnapshot()
    const rect = canvasRef.current.getBoundingClientRect()
    const scale = canvasSize.w / rect.width
    const canvasX = textInput.x * scale
    const canvasY = textInput.y * scale
    const scaledSize = fontSize * scale

    const ctx = canvasRef.current.getContext('2d')
    ctx.globalCompositeOperation = 'source-over'
    ctx.font = `${scaledSize}px sans-serif`
    ctx.fillStyle = color
    ctx.textBaseline = 'top'

    const lines = val.split('\n')
    lines.forEach((line, i) => {
      ctx.fillText(line, canvasX, canvasY + i * scaledSize * 1.2)
    })

    setTextInput(null)
  }

  const handlePointerDown = useCallback((e) => {
    if (tool === 'reframe') return

    if (tool === 'text') {
      // If there's an active text input, commit it first
      if (textInput) { commitText(); return }
      e.preventDefault()
      const css = getCSSPos(e)
      setTextInput({ x: css.x, y: css.y })
      return
    }

    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    drawingRef.current = true
    saveSnapshot()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    ctx.lineWidth = strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
      ctx.lineWidth = strokeWidth * 5
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = color
    }
  }, [tool, color, strokeWidth, textInput, fontSize])

  const handlePointerMove = useCallback((e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }, [])

  const handlePointerUp = useCallback((e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    drawingRef.current = false
    const ctx = canvasRef.current.getContext('2d')
    ctx.closePath()
    ctx.globalCompositeOperation = 'source-over'
  }, [])

  // Auto-focus text input when it appears
  useEffect(() => {
    if (textInput && textRef.current) textRef.current.focus()
  }, [textInput])

  // Commit text on Enter (without shift), allow shift+enter for newlines
  function handleTextKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitText()
    }
    if (e.key === 'Escape') {
      setTextInput(null)
    }
  }

  function cancelReframe() {
    setReframe(null)
    reframeDragRef.current = null
    previewRef.current = null
  }

  // Commit text when switching tools, cancel reframe when switching away
  function switchTool(t) {
    if (textInput) commitText()
    if (tool === 'reframe' && t !== 'reframe') cancelReframe()
    setTool(t)
  }

  // Enter reframe mode: selection starts at full image size, coords in logical pixels
  function enterReframe() {
    if (textInput) commitText()
    if (tool === 'reframe') { cancelReframe(); setTool('pen'); return }
    previewRef.current = canvasRef.current.toDataURL('image/png')
    setReframe({ x: 0, y: 0, w: canvasSize.w, h: canvasSize.h })
    setTool('reframe')
  }

  // Flip canvas content horizontally or vertically
  function handleFlip(axis) {
    if (tool === 'reframe') { cancelReframe(); setTool('pen') }
    if (textInput) commitText()
    saveSnapshot()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const imageData = ctx.getImageData(0, 0, canvasSize.w, canvasSize.h)
    const tmp = document.createElement('canvas')
    tmp.width = canvasSize.w
    tmp.height = canvasSize.h
    const tCtx = tmp.getContext('2d')
    tCtx.putImageData(imageData, 0, 0)
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h)
    ctx.save()
    if (axis === 'h') {
      ctx.translate(canvasSize.w, 0)
      ctx.scale(-1, 1)
    } else {
      ctx.translate(0, canvasSize.h)
      ctx.scale(1, -1)
    }
    ctx.drawImage(tmp, 0, 0)
    ctx.restore()
  }

  // Apply reframe: crop or expand the canvas to the selection rect (already in logical px)
  function applyReframe() {
    if (!reframe) return
    saveSnapshot()
    const canvas = canvasRef.current

    let nw = Math.round(reframe.w)
    let nh = Math.round(reframe.h)
    nw = Math.max(1, Math.min(nw, MAX_REFRAME_DIM))
    nh = Math.max(1, Math.min(nh, MAX_REFRAME_DIM))
    const sx = Math.round(reframe.x)
    const sy = Math.round(reframe.y)

    // Capture current content
    const tmp = document.createElement('canvas')
    tmp.width = canvasSize.w
    tmp.height = canvasSize.h
    tmp.getContext('2d').drawImage(canvas, 0, 0)

    // Resize and redraw
    canvas.width = nw
    canvas.height = nh
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, nw, nh)
    ctx.drawImage(tmp, -sx, -sy)

    const newSize = { w: nw, h: nh }
    setCanvasSize(newSize)
    // Push new state onto history (undo restores pre-reframe snapshot)
    historyRef.current.push(ctx.getImageData(0, 0, nw, nh))
    if (historyRef.current.length > MAX_UNDO) historyRef.current.shift()
    setHistoryLen(historyRef.current.length)
    cancelReframe()
    setTool('pen')
  }

  // Reframe drag handlers — convert screen deltas to logical pixels via display scale
  function onReframePointerDown(e, type) {
    e.preventDefault()
    e.stopPropagation()
    reframeDragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...reframe },
    }
    window.addEventListener('pointermove', onReframePointerMove)
    window.addEventListener('pointerup', onReframePointerUp)
  }

  function onReframePointerMove(e) {
    const drag = reframeDragRef.current
    if (!drag) return
    // Convert screen px delta to logical px using current display scale
    const vp = wrapperRef.current?.getBoundingClientRect()
    if (!vp) return
    const s = drag.startRect
    const dispScale = Math.min(vp.width / s.w, vp.height / s.h) * REFRAME_PAD
    const dx = (e.clientX - drag.startX) / dispScale
    const dy = (e.clientY - drag.startY) / dispScale
    let { x, y, w, h } = s

    if (drag.type === 'move') {
      x = s.x + dx
      y = s.y + dy
    } else {
      if (drag.type.includes('w')) { x = s.x + dx; w = s.w - dx }
      if (drag.type.includes('e')) { w = s.w + dx }
      if (drag.type.includes('n')) { y = s.y + dy; h = s.h - dy }
      if (drag.type.includes('s')) { h = s.h + dy }
      if (w < MIN_REFRAME) { w = MIN_REFRAME; if (drag.type.includes('w')) x = s.x + s.w - MIN_REFRAME }
      if (h < MIN_REFRAME) { h = MIN_REFRAME; if (drag.type.includes('n')) y = s.y + s.h - MIN_REFRAME }
      if (w > MAX_REFRAME_DIM) { w = MAX_REFRAME_DIM; if (drag.type.includes('w')) x = s.x + s.w - MAX_REFRAME_DIM }
      if (h > MAX_REFRAME_DIM) { h = MAX_REFRAME_DIM; if (drag.type.includes('n')) y = s.y + s.h - MAX_REFRAME_DIM }
    }

    setReframe({ x, y, w, h })
  }

  function onReframePointerUp() {
    reframeDragRef.current = null
    window.removeEventListener('pointermove', onReframePointerMove)
    window.removeEventListener('pointerup', onReframePointerUp)
  }

  function handleUndo() {
    if (textInput) setTextInput(null)
    if (historyRef.current.length <= 1) return
    historyRef.current.pop()
    const prev = historyRef.current[historyRef.current.length - 1]
    const canvas = canvasRef.current
    // Undo may restore a different canvas size
    if (prev.width !== canvas.width || prev.height !== canvas.height) {
      canvas.width = prev.width
      canvas.height = prev.height
      setCanvasSize({ w: prev.width, h: prev.height })
    }
    canvas.getContext('2d').putImageData(prev, 0, 0)
    setHistoryLen(historyRef.current.length)
  }

  function handleClear() {
    setTextInput(null)
    const ctx = canvasRef.current.getContext('2d')
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h)
    historyRef.current = [ctx.getImageData(0, 0, canvasSize.w, canvasSize.h)]
    setHistoryLen(1)
  }

  async function handleDone() {
    if (textInput) commitText()
    if (tool === 'reframe') cancelReframe()
    setSaving(true)
    try {
      const temp = document.createElement('canvas')
      temp.width = canvasSize.w
      temp.height = canvasSize.h
      const tCtx = temp.getContext('2d')
      tCtx.fillStyle = '#ffffff'
      tCtx.fillRect(0, 0, canvasSize.w, canvasSize.h)
      tCtx.drawImage(canvasRef.current, 0, 0)

      const blob = await new Promise(r => temp.toBlob(r, 'image/png'))
      const file = new File([blob], 'drawing.png', { type: 'image/png' })
      const data = await uploadImage(file)
      onSave(data.url)
    } catch (err) {
      console.error('Drawing save failed:', err)
    }
    setSaving(false)
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (tool === 'reframe') { cancelReframe(); setTool('pen'); return }
        if (textInput) return
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, textInput, tool])

  const widths = [2, 5, 10]
  const widthLabels = ['S', 'M', 'L']

  // Reframe overlay: zoom-out model — image shrinks as output rect grows
  function renderReframeOverlay() {
    if (!reframe || tool !== 'reframe') return null
    const vp = wrapperRef.current?.getBoundingClientRect()
    if (!vp) return null
    const vpW = vp.width
    const vpH = vp.height
    const { x, y, w, h } = reframe

    // Scale so output rect fits in viewport at 90%
    const scale = Math.min((vpW * REFRAME_PAD) / w, (vpH * REFRAME_PAD) / h)

    // Output rect display size and centered offset
    const outW = w * scale
    const outH = h * scale
    const offX = (vpW - outW) / 2
    const offY = (vpH - outH) / 2

    // Image position within the output rect (offset by selection origin)
    const imgW = canvasSize.w * scale
    const imgH = canvasSize.h * scale
    const imgX = offX + (-x * scale)
    const imgY = offY + (-y * scale)

    const handles = [
      { type: 'nw', style: { left: offX - 5, top: offY - 5, cursor: 'nwse-resize' } },
      { type: 'ne', style: { left: offX + outW - 5, top: offY - 5, cursor: 'nesw-resize' } },
      { type: 'sw', style: { left: offX - 5, top: offY + outH - 5, cursor: 'nesw-resize' } },
      { type: 'se', style: { left: offX + outW - 5, top: offY + outH - 5, cursor: 'nwse-resize' } },
      { type: 'n', style: { left: offX + outW / 2 - 5, top: offY - 5, cursor: 'ns-resize' } },
      { type: 's', style: { left: offX + outW / 2 - 5, top: offY + outH - 5, cursor: 'ns-resize' } },
      { type: 'w', style: { left: offX - 5, top: offY + outH / 2 - 5, cursor: 'ew-resize' } },
      { type: 'e', style: { left: offX + outW - 5, top: offY + outH / 2 - 5, cursor: 'ew-resize' } },
    ]

    return (
      <div className="dp-reframe-overlay dp-reframe-active">
        {/* Checkerboard background for expansion areas */}
        <div className="dp-reframe-expand-bg" style={{ left: offX, top: offY, width: outW, height: outH }} />

        {/* Image preview at computed scale + position */}
        {previewRef.current && (
          <img
            src={previewRef.current}
            className="dp-reframe-preview"
            style={{ left: imgX, top: imgY, width: imgW, height: imgH }}
            draggable={false}
          />
        )}

        {/* Dim mask: cover everything outside the output rect */}
        <div className="dp-reframe-dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, offY) }} />
        <div className="dp-reframe-dim" style={{ bottom: 0, left: 0, right: 0, height: Math.max(0, vpH - offY - outH) }} />
        <div className="dp-reframe-dim" style={{ top: offY, left: 0, width: Math.max(0, offX), height: outH }} />
        <div className="dp-reframe-dim" style={{ top: offY, right: 0, width: Math.max(0, vpW - offX - outW), height: outH }} />

        {/* Selection border */}
        <div
          className="dp-reframe-selection"
          style={{ left: offX, top: offY, width: outW, height: outH }}
          onPointerDown={e => onReframePointerDown(e, 'move')}
        />

        {/* 8 resize handles */}
        {handles.map(({ type, style }) => (
          <div
            key={type}
            className="dp-reframe-handle"
            style={style}
            onPointerDown={e => onReframePointerDown(e, type)}
          />
        ))}

        {/* Apply / Cancel bar */}
        <div className="dp-reframe-actions" style={{ left: offX, top: offY + outH + 8, width: outW }}>
          <button className="dp-reframe-cancel" onClick={() => { cancelReframe(); setTool('pen') }}>Cancel</button>
          <button className="dp-reframe-apply" onClick={applyReframe}>Apply</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay active" onClick={() => { if (tool !== 'reframe') onClose() }} style={{ zIndex: 1100 }}>
      <div className="drawing-pad-modal" onClick={e => e.stopPropagation()}>
        <div className="drawing-pad-toolbar">
          <button
            className={`dp-tool-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={() => switchTool('pen')}
            title="Pen"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 1.5l3 3-9 9H2.5v-3z" />
              <path d="M9.5 3.5l3 3" />
            </svg>
          </button>
          <button
            className={`dp-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => switchTool('eraser')}
            title="Eraser"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14h9" />
              <path d="M9.5 3.5l4 4-6.5 6.5H3.5L1 11.5l8.5-8z" />
              <path d="M5 10l4 4" />
            </svg>
          </button>
          <button
            className={`dp-tool-btn ${tool === 'text' ? 'active' : ''}`}
            onClick={() => switchTool('text')}
            title="Text"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h10" />
              <path d="M8 3v10" />
              <path d="M5.5 13h5" />
            </svg>
          </button>

          <div className="dp-separator" />

          <input
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
            className="dp-color-picker"
            title="Color"
          />

          <div className="dp-separator" />

          {tool === 'text' ? (
            FONT_SIZES.map((s, i) => (
              <button
                key={s}
                className={`dp-tool-btn dp-width-btn ${fontSize === s ? 'active' : ''}`}
                onClick={() => setFontSize(s)}
                title={`${FONT_LABELS[i]} text`}
              >
                <span style={{ fontSize: 11, fontWeight: 600 }}>{FONT_LABELS[i]}</span>
              </button>
            ))
          ) : (
            widths.map((w, i) => (
              <button
                key={w}
                className={`dp-tool-btn dp-width-btn ${strokeWidth === w ? 'active' : ''}`}
                onClick={() => setStrokeWidth(w)}
                title={`${widthLabels[i]} stroke`}
              >
                <span className="dp-width-dot" style={{ width: w + 4, height: w + 4 }} />
              </button>
            ))
          )}

          <div className="dp-separator" />

          <button className="dp-tool-btn" onClick={handleUndo} title="Undo" disabled={historyLen <= 1}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h7a4 4 0 010 8H7" />
              <path d="M6 3L3 6l3 3" />
            </svg>
          </button>
          <button className="dp-tool-btn" onClick={handleClear} title="Clear">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h10" />
              <path d="M6 4V3h4v1" />
              <path d="M4.5 4l.5 9h6l.5-9" />
            </svg>
          </button>

          <div className="dp-separator" />

          {/* Flip H */}
          <button className="dp-tool-btn" onClick={() => handleFlip('h')} title="Flip Horizontal">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v12" />
              <path d="M12 4l2 4-2 4" />
              <path d="M4 4L2 8l2 4" />
            </svg>
          </button>
          {/* Flip V */}
          <button className="dp-tool-btn" onClick={() => handleFlip('v')} title="Flip Vertical">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8h12" />
              <path d="M4 12l4 2 4-2" />
              <path d="M4 4l4-2 4 2" />
            </svg>
          </button>
          {/* Reframe (crop/expand) */}
          <button
            className={`dp-tool-btn ${tool === 'reframe' ? 'active' : ''}`}
            onClick={enterReframe}
            title="Reframe (Crop / Expand)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 1v3H1" />
              <path d="M4 4v8h8" />
              <path d="M12 15v-3h3" />
              <path d="M12 12V4H4" />
            </svg>
          </button>
        </div>

        <div ref={wrapperRef} style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            className="drawing-pad-canvas"
            style={{
              cursor: tool === 'text' ? 'text' : 'crosshair',
              ...(tool === 'reframe' && { visibility: 'hidden' })
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          {textInput && (
            <textarea
              ref={textRef}
              className="dp-text-input"
              style={{
                left: textInput.x,
                top: textInput.y,
                fontSize: fontSize,
                color: color,
              }}
              onKeyDown={handleTextKeyDown}
              onBlur={commitText}
            />
          )}
          {renderReframeOverlay()}
        </div>

        <div className="drawing-pad-footer">
          <button className="dp-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="dp-done-btn" onClick={handleDone} disabled={saving}>
            {saving ? 'Saving...' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
