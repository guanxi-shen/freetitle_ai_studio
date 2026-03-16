import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import RadialItem, { getItemHeight, getItemWidth } from './RadialItem'

const ITEM_WIDTH = 165
const GAP = 8
const FIT_PADDING = 16

function stableSort(items) {
  const real = []
  const placeholders = []
  for (const item of items) {
    if (item._placeholder) placeholders.push(item)
    else real.push(item)
  }
  return [...real, ...placeholders]
}

const MAX_HEIGHT_RATIO = 1.4

// Get actual rendered height: use measured dimensions if available, else metadata estimate
function itemHeight(item, width, measured) {
  const m = measured.get(item.item_id)
  if (m) return Math.round(width * (m.h / m.w))
  return getItemHeight(item, width)
}

function computePositions(items, measured) {
  const sorted = stableSort(items)
  if (sorted.length === 0) return []

  const cols = Math.max(3, Math.min(10, Math.ceil(Math.sqrt(sorted.length * 2.5))))
  const singleRow = sorted.length <= cols

  // Single row: variable widths, consistent gaps, centered vertically
  if (singleRow) {
    const positioned = []
    let x = 0
    for (const item of sorted) {
      const w = getItemWidth(item, ITEM_WIDTH)
      positioned.push({ ...item, _x: x + w / 2, _y: 0, _w: w })
      x += w + GAP
    }
    const totalW = x - GAP
    for (const p of positioned) p._x -= totalW / 2
    return positioned
  }

  // Multi-row: fixed-width column masonry
  const colHeights = new Array(cols).fill(0)
  const positioned = []

  for (const item of sorted) {
    let minCol = 0
    for (let c = 1; c < cols; c++) {
      if (colHeights[c] < colHeights[minCol]) minCol = c
    }

    const h = itemHeight(item, ITEM_WIDTH, measured)
    const x = minCol * (ITEM_WIDTH + GAP) + ITEM_WIDTH / 2
    const y = colHeights[minCol] + h / 2

    positioned.push({ ...item, _x: x, _y: y })
    colHeights[minCol] += h + GAP
  }

  const totalW = cols * ITEM_WIDTH + (cols - 1) * GAP
  const maxH = Math.max(...colHeights)
  const offsetX = totalW / 2
  const offsetY = maxH / 2

  for (const p of positioned) {
    p._x -= offsetX
    p._y -= offsetY
  }

  return positioned
}

function computeAutoFit(positioned, containerWidth, containerHeight, measured) {
  if (positioned.length === 0) return { scale: 1, offsetX: 0, offsetY: 0 }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const item of positioned) {
    const halfW = (item._w || ITEM_WIDTH) / 2
    const halfH = itemHeight(item, item._w || ITEM_WIDTH, measured) / 2
    minX = Math.min(minX, item._x - halfW)
    maxX = Math.max(maxX, item._x + halfW)
    minY = Math.min(minY, item._y - halfH)
    maxY = Math.max(maxY, item._y + halfH)
  }

  const contentW = maxX - minX + FIT_PADDING * 2
  const contentH = maxY - minY + FIT_PADDING * 2

  const scale = Math.min(containerWidth / contentW, containerHeight / contentH, 1.5)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  return {
    scale: Math.max(scale, 0.55),
    offsetX: containerWidth / 2 - cx * scale,
    offsetY: containerHeight / 2 - cy * scale - 6,
  }
}

export default function RadialBoard({ items, onItemClick, onLike, onDislike, onNote, onSeen }) {
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState({ w: 0, h: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [fitted, setFitted] = useState(false)
  const [measured, setMeasured] = useState(() => new Map())
  const dragStart = useRef(null)
  const autoFitRef = useRef(null)

  const handleMeasure = useCallback((id, w, h) => {
    setMeasured(prev => {
      if (prev.has(id)) return prev
      const next = new Map(prev)
      next.set(id, { w, h })
      return next
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setDimensions({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const positioned = useMemo(() => computePositions(items, measured), [items, measured])

  useEffect(() => {
    if (dimensions.w === 0 || dimensions.h === 0 || positioned.length === 0) return
    const fit = computeAutoFit(positioned, dimensions.w, dimensions.h, measured)
    autoFitRef.current = fit
    setZoom(fit.scale)
    setPan({ x: fit.offsetX, y: fit.offsetY })
    if (!fitted) setFitted(true)
  }, [positioned, dimensions])

  const resetView = useCallback(() => {
    if (autoFitRef.current) {
      setZoom(autoFitRef.current.scale)
      setPan({ x: autoFitRef.current.offsetX, y: autoFitRef.current.offsetY })
    }
  }, [])

  const handleMouseDown = (e) => {
    if (e.button !== 0) return
    setDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  const handleMouseMove = (e) => {
    if (!dragging || !dragStart.current) return
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    })
  }

  const handleMouseUp = () => {
    setDragging(false)
    dragStart.current = null
  }

  const zoomAt = useCallback((factor, cx, cy) => {
    setZoom(prev => {
      const next = Math.min(Math.max(prev * factor, 0.3), 3)
      const ratio = next / prev
      setPan(p => ({
        x: cx - (cx - p.x) * ratio,
        y: cy - (cy - p.y) * ratio,
      }))
      return next
    })
  }, [])

  const zoomToCenter = useCallback((factor) => {
    const el = containerRef.current
    if (!el) return
    zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2)
  }, [zoomAt])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect()
        const factor = e.deltaY > 0 ? 0.98 : 1.02
        zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setPan(prev => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Skip position transition when items are removed
  const prevCountRef = useRef(items.length)
  const [animate, setAnimate] = useState(true)

  useEffect(() => {
    if (items.length < prevCountRef.current) {
      setAnimate(false)
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)))
    }
    prevCountRef.current = items.length
  }, [items.length])

  const hasItems = items.length > 0

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden select-none"
      style={{ height: '100%', cursor: hasItems ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      onMouseDown={hasItems ? handleMouseDown : undefined}
      onMouseMove={hasItems ? handleMouseMove : undefined}
      onMouseUp={hasItems ? handleMouseUp : undefined}
      onMouseLeave={hasItems ? handleMouseUp : undefined}
    >
      <div
        className="absolute"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          visibility: fitted ? 'visible' : 'hidden',
        }}
      >
        {positioned.map(item => {
          const w = item._w || ITEM_WIDTH
          return (
            <div
              key={item.item_id}
              className="absolute"
              style={{
                left: item._x,
                top: item._y,
                width: w,
                transform: 'translate(-50%, -50%)',
                transition: animate ? 'left 500ms ease-out, top 500ms ease-out' : 'none',
              }}
            >
              <RadialItem
                item={item}
                width={w}
                onClick={() => onItemClick(item)}
                onLike={() => onLike(item.item_id)}
                onDislike={() => onDislike(item.item_id)}
                onNote={() => onNote(item)}
                onSeen={onSeen}
                onMeasure={handleMeasure}
              />
            </div>
          )
        })}
      </div>

      {hasItems && <div className="absolute bottom-16 right-4 flex flex-col gap-1 z-30">
        <button
          onClick={() => zoomToCenter(1.2)}
          className="w-8 h-8 rounded-lg bg-surface/80 backdrop-blur-sm border border-glass text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors text-sm font-medium"
        >
          +
        </button>
        <button
          onClick={resetView}
          className="w-8 h-8 rounded-lg bg-surface/80 backdrop-blur-sm border border-glass text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors"
          title="Reset view"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h4M3 3v4M17 3h-4M17 3v4M3 17h4M3 17v-4M17 17h-4M17 17v-4" />
          </svg>
        </button>
        <button
          onClick={() => zoomToCenter(0.8)}
          className="w-8 h-8 rounded-lg bg-surface/80 backdrop-blur-sm border border-glass text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors text-sm font-medium"
        >
          -
        </button>
      </div>}
    </div>
  )
}
