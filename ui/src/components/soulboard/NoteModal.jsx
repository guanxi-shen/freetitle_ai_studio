import { useState } from 'react'

export default function NoteModal({ item, onSave, onClose }) {
  const [note, setNote] = useState(item.feedback_note || '')

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(note.trim())
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative z-10 w-full max-w-sm bg-surface rounded-xl border border-border p-5">
        <h3 className="text-sm font-medium text-text-primary mb-1">
          Note for {item.metadata?.title || item.item_id}
        </h3>
        <p className="text-[11px] text-text-muted mb-3">
          Optional feedback for the art director
        </p>

        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Love the color palette but too abstract..."
          rows={3}
          autoFocus
          className="w-full px-3 py-2 rounded-lg bg-surface-hover border border-border text-text-primary placeholder-text-muted text-xs resize-none focus:outline-none focus:border-accent"
        />

        <div className="flex gap-2 mt-3 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(note.trim())}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
