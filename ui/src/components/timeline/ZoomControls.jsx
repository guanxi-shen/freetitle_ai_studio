export default function ZoomControls({ scale, onScaleChange, onReset, leftOffset = 0 }) {
  return (
    <div className="zoom-controls" style={leftOffset ? { left: leftOffset + 16 } : undefined}>
      <button onClick={() => onScaleChange(scale - 0.1)} title="Zoom out">-</button>
      <span className="zoom-value">{Math.round(scale * 100)}%</span>
      <button onClick={() => onScaleChange(scale + 0.1)} title="Zoom in">+</button>
      <span className="zoom-divider" />
      <button onClick={onReset} title="Reset zoom">1:1</button>
    </div>
  )
}
