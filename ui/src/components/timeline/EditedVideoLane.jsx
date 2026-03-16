import { useState, useRef } from 'react'

/**
 * EditedVideoLane -- displays post-production edited videos at the bottom of the timeline.
 * The final output of the multimodal creative pipeline: script -> storyboard -> video -> edit.
 * Videos are produced by the edit_video FC tool (FFmpeg transitions, trimming, audio mixing).
 */
export default function EditedVideoLane({ videos = [], onDelete, scale = 1 }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!videos.length && collapsed) return null

  return (
    <div className="edited-video-lane">
      <div className="edited-video-lane-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="edited-video-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span className="edited-video-title">Edited Videos</span>
        {videos.length > 0 && <span className="edited-video-count">{videos.length}</span>}
      </div>

      {!collapsed && (
        <div className="edited-video-cards">
          {videos.length === 0 ? (
            <div className="edited-video-empty">
              No edited videos yet. Ask the agent to edit the generated clips.
            </div>
          ) : (
            videos.map((video, i) => (
              <EditedVideoCard
                key={video.name || i}
                video={video}
                index={i}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function EditedVideoCard({ video, index, onDelete }) {
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)

  const togglePlay = () => {
    if (!videoRef.current) return
    if (playing) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setPlaying(!playing)
  }

  return (
    <div className="edited-video-card">
      <div className="edited-video-player" onClick={togglePlay}>
        {video.url ? (
          <video
            ref={videoRef}
            src={video.url}
            preload="metadata"
            className="edited-video-element"
            onEnded={() => setPlaying(false)}
          />
        ) : (
          <div className="edited-video-generating">Processing...</div>
        )}
        {!playing && video.url && (
          <div className="edited-video-play-overlay">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
      </div>
      <div className="edited-video-meta">
        <span className="edited-video-name">{video.name || `Edit ${index + 1}`}</span>
        <span className="edited-video-details">
          {video.clips_used && `${video.clips_used} clips`}
          {video.transitions_applied > 0 && ` | ${video.transitions_applied} transitions`}
        </span>
      </div>
      {video.url && (
        <a
          href={video.url}
          download={`${video.name || 'edited'}.mp4`}
          className="edited-video-download"
          title="Download"
          onClick={e => e.stopPropagation()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2" fill="none">
            <path d="M5 1v6M2 5l3 3 3-3M1 9h8" />
          </svg>
        </a>
      )}
      {onDelete && (
        <button
          className="edited-video-delete"
          onClick={e => { e.stopPropagation(); onDelete(video.name || index) }}
          title="Remove"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      )}
    </div>
  )
}
