import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import './ActivityMonitor.css'

const TERMINAL = new Set(['succeed', 'failed', 'timeout', 'error'])

const CATEGORY_COLORS = {
  storyboard: '#4a9eff',
  character: '#a855f7',
  supplementary: '#f59e0b',
  video: '#22c55e',
  standalone: '#888',
}

const CATEGORY_LABELS = {
  storyboard: 'Storyboard',
  character: 'Character',
  supplementary: 'Supplementary',
  video: 'Video',
  standalone: 'Standalone',
}

const PROVIDER_SHORT = {
  nano_banana: 'NB',
  veo: 'VEO',
}

function taskLabel(task, scenes, characters) {
  const type = task._type
  if (type === 'storyboard' || type === 'video') {
    const scene = scenes?.find(s => s.id === task.sceneId)
    const shot = scene?.shots?.find(sh => sh.id === task.shotId)
      || scene?.video_shots?.find(vs => vs.id === task.shotId)
    const sn = scene?.scene_number ?? '?'
    const shn = shot?.shot_number ?? '?'
    let label = type === 'video' ? `Scene ${sn} Shot ${shn} vid` : `Scene ${sn} Shot ${shn}`
    if (type === 'storyboard' && task.frameNumber > 1) label += ` F${task.frameNumber}`
    return label
  }
  if (type === 'character') {
    const charId = task.config?.characterId
    const char = characters?.find(c => c.id === charId)
    const name = char?.name || 'Character'
    const sub = task.config?.characterType === 'variation' ? 'var' : 'turn'
    return `${name} ${sub}`
  }
  if (type === 'supplementary') {
    const title = task.config?.title || task.config?.category || 'Supplementary'
    return title.length > 20 ? title.slice(0, 18) + '..' : title
  }
  return 'Standalone'
}

function formatElapsed(startTime) {
  if (!startTime) return '--'
  const sec = Math.floor((Date.now() - startTime) / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

const ActivityIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 8h3l2-5 3 10 2-5h4" />
  </svg>
)

const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6l4 4 4-4" />
  </svg>
)

const ChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10l4-4 4 4" />
  </svg>
)

export default function ActivityMonitor({ tasks, scenes, characters }) {
  const [expanded, setExpanded] = useState(false)
  const [, setTick] = useState(0)
  const tickRef = useRef(null)

  const activeTasks = useMemo(() =>
    tasks.filter(t => !TERMINAL.has(t.status)),
  [tasks])

  const counts = useMemo(() => {
    const c = {}
    for (const t of activeTasks) {
      c[t._type] = (c[t._type] || 0) + 1
    }
    return c
  }, [activeTasks])

  // Sort: by category order, then scene/shot number, then start time
  const sortedTasks = useMemo(() => {
    const catOrder = { storyboard: 0, video: 1, character: 2, supplementary: 3, standalone: 4 }
    return [...activeTasks].sort((a, b) => {
      const ca = catOrder[a._type] ?? 9, cb = catOrder[b._type] ?? 9
      if (ca !== cb) return ca - cb
      // Within storyboard/video, sort by scene then shot number
      if ((a._type === 'storyboard' || a._type === 'video') && (b._type === 'storyboard' || b._type === 'video')) {
        const sa = scenes?.find(s => s.id === a.sceneId)?.scene_number ?? 99
        const sb2 = scenes?.find(s => s.id === b.sceneId)?.scene_number ?? 99
        if (sa !== sb2) return sa - sb2
        const sha = scenes?.find(s => s.id === a.sceneId)?.shots?.find(sh => sh.id === a.shotId)?.shot_number ?? 99
        const shb = scenes?.find(s => s.id === b.sceneId)?.shots?.find(sh => sh.id === b.shotId)?.shot_number ?? 99
        if (sha !== shb) return sha - shb
      }
      return (a.startTime || 0) - (b.startTime || 0)
    })
  }, [activeTasks, scenes])

  const totalActive = activeTasks.length

  // Tick for elapsed time
  useEffect(() => {
    if (totalActive > 0) {
      tickRef.current = setInterval(() => setTick(n => n + 1), 1000)
    } else {
      clearInterval(tickRef.current)
    }
    return () => clearInterval(tickRef.current)
  }, [totalActive])

  const categoryOrder = ['storyboard', 'video', 'character', 'supplementary', 'standalone']

  return createPortal(
    <div className="am-container">
      <div className="am-panel agent-glass">
        <div className="am-header" onClick={() => setExpanded(e => !e)}>
          {totalActive > 0 ? <span className="am-header-spinner" /> : <ActivityIcon />}
          {totalActive > 0 ? (
            <div className="am-counts">
              {categoryOrder.map(cat => counts[cat] ? (
                <span key={cat} className="am-count-badge">
                  <span className="am-count-dot" style={{ background: CATEGORY_COLORS[cat] }} />
                  <span className="am-count-num">{counts[cat]}</span>
                  <span className="am-count-label">{CATEGORY_LABELS[cat]}</span>
                </span>
              ) : null)}
            </div>
          ) : (
            <div className="am-idle">No active generations</div>
          )}
          <button className="am-toggle">
            {expanded ? <ChevronUp /> : <ChevronDown />}
          </button>
        </div>

        {expanded && (
          <div className="am-body">
            {totalActive > 0 ? (
              <div className="am-cards">
                {sortedTasks.map((task, i) => (
                  <div key={task.taskId || i} className="am-card" style={{ borderColor: CATEGORY_COLORS[task._type] + '40' }}>
                    <span className="am-card-spinner" style={{ borderTopColor: CATEGORY_COLORS[task._type] }} />
                    <div className="am-card-info">
                      <span className="am-card-label">{taskLabel(task, scenes, characters)}</span>
                      <span className="am-card-meta">
                        {PROVIDER_SHORT[task.provider] || task.provider}
                        <span className="am-card-sep" />
                        {formatElapsed(task.startTime)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="am-empty">No active generations</div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
