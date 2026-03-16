import { useState } from 'react'

/**
 * AudioLane -- displays generated audio tracks at the bottom of the timeline.
 * Part of the interleaved multimodal output: text + images + video + audio
 * stream into the timeline as the creative agent produces them.
 */
export default function AudioLane({ tracks = [], onDelete, scale = 1 }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!tracks.length && collapsed) return null

  return (
    <div className="audio-lane">
      <div className="audio-lane-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="audio-lane-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span className="audio-lane-title">Audio</span>
        {tracks.length > 0 && <span className="audio-lane-count">{tracks.length}</span>}
      </div>

      {!collapsed && (
        <div className="audio-lane-tracks">
          {tracks.length === 0 ? (
            <div className="audio-lane-empty">
              No audio tracks yet. Ask the agent to generate background music.
            </div>
          ) : (
            tracks.map((track, i) => (
              <div key={track.name || i} className="audio-track-card">
                <div className="audio-track-info">
                  <span className="audio-track-name">{track.name || `Track ${i + 1}`}</span>
                  {track.duration_seconds && (
                    <span className="audio-track-duration">{track.duration_seconds}s</span>
                  )}
                </div>
                {track.url ? (
                  <audio controls preload="none" className="audio-track-player">
                    <source src={track.url} type="audio/mpeg" />
                  </audio>
                ) : (
                  <div className="audio-track-generating">Generating...</div>
                )}
                {onDelete && (
                  <button
                    className="audio-track-delete"
                    onClick={e => { e.stopPropagation(); onDelete(track.name || i) }}
                    title="Remove track"
                  >
                    <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                      <line x1="2" y1="2" x2="8" y2="8" />
                      <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
