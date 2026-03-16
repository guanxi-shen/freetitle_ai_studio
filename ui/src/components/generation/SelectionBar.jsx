import { useState } from 'react'
import DestinationPicker from './DestinationPicker'

export default function SelectionBar({ count, totalCount, scenes, onSelectAll, onClear, onSendTo }) {
  const [showPicker, setShowPicker] = useState(false)

  return (
    <div className="selection-bar">
      <span className="selection-count">{count} selected</span>
      <div className="selection-actions">
        {count < totalCount && (
          <button className="selection-btn" onClick={onSelectAll}>Select all</button>
        )}
        <button className="selection-btn" onClick={onClear}>Clear</button>
        <div style={{ position: 'relative' }}>
          <button className="selection-send-btn" onClick={() => setShowPicker(p => !p)}>
            Send to
          </button>
          {showPicker && (
            <DestinationPicker
              scenes={scenes}
              onSelect={(dest) => { setShowPicker(false); onSendTo(dest) }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
