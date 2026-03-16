/**
 * Session picker — lists soulboard sessions for a project.
 * Shown when no active session is selected.
 * Hierarchy: standalone sessions first, then storyboard (scene > shot) collapsed, then supplement placeholder.
 */
import { useState, useEffect, useMemo } from 'react'
import * as api from '../../services/soulboardApi'

const Chevron = ({ open, className = '' }) => (
  <svg
    viewBox="0 0 20 20" fill="currentColor"
    className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''} ${className}`}
  >
    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
  </svg>
)

export default function SessionPicker({
  projectName,
  context = 'standalone',
  shotId = null,
  scenes = [],
  characters = [],
  onSelectSession,
  onNewSession,
  onBack,
}) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    if (!projectName) return
    setLoading(true)
    api.listSessions(projectName)
      .then(data => setSessions((data.sessions || []).filter(s => s.item_count > 0)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectName])

  const handleDelete = async (sessionId) => {
    try {
      await api.deleteSession(projectName, sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
    } catch (e) {
      console.error('[Soulboard] Delete failed:', e)
    }
    setConfirmDelete(null)
  }

  const standaloneSessions = sessions.filter(s => s.context === 'standalone')

  // Build scene -> shot -> sessions tree for storyboard sessions
  const storyboardTree = useMemo(() => {
    const shotSessions = sessions.filter(s => s.context === 'shot' && s.shot_id)
    if (shotSessions.length === 0 || scenes.length === 0) return []

    const byShotId = {}
    for (const s of shotSessions) {
      ;(byShotId[s.shot_id] ||= []).push(s)
    }

    const tree = []
    scenes.forEach((scene, si) => {
      const shotNodes = []
      ;(scene.shots || []).forEach((shot, shi) => {
        const ss = byShotId[shot.id]
        if (ss?.length) {
          shotNodes.push({ shotId: shot.id, label: `Shot ${shi + 1}`, sessions: ss })
        }
      })
      if (shotNodes.length) {
        tree.push({ sceneId: scene.id, label: `Scene ${si + 1}`, shots: shotNodes })
      }
    })
    return tree
  }, [sessions, scenes])

  // Shot sessions without scene structure (no scenes prop passed)
  const orphanShotSessions = useMemo(() => {
    if (scenes.length > 0) return []
    return sessions.filter(s => s.context === 'shot' && s.shot_id)
  }, [sessions, scenes])

  // Build character_id -> sessions tree
  const characterTree = useMemo(() => {
    const charSessions = sessions.filter(s => s.context === 'character' && s.character_id)
    if (charSessions.length === 0 || characters.length === 0) return []
    const byCharId = {}
    for (const s of charSessions) {
      ;(byCharId[s.character_id] ||= []).push(s)
    }
    return characters
      .filter(c => byCharId[c.id])
      .map(c => ({ charId: c.id, name: c.name, sessions: byCharId[c.id] }))
  }, [sessions, characters])

  const supplementarySessions = sessions.filter(s => s.context === 'supplementary')
  const characterCount = sessions.filter(s => s.context === 'character').length
  const storyboardCount = sessions.filter(s => s.context === 'shot').length

  return (
    <div className="max-w-lg mx-auto mt-[10vh] px-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 rounded-lg text-text-muted hover:text-text-primary transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
          )}
          <h2 className="text-lg font-semibold text-text-primary">Soulboard</h2>
        </div>
      </div>

      {/* New session */}
      <button
        onClick={onNewSession}
        className="w-full py-3 rounded-xl border-2 border-dashed border-border text-text-secondary text-sm hover:border-accent hover:text-accent transition-colors"
      >
        + New Session
      </button>

      {loading && (
        <p className="text-xs text-text-muted text-center py-4">Loading sessions...</p>
      )}

      {error && (
        <p className="text-xs text-dislike text-center py-2">{error}</p>
      )}

      {!loading && sessions.length === 0 && (
        <p className="text-xs text-text-muted text-center py-4">
          No sessions yet. Create one to start exploring.
        </p>
      )}

      {/* Standalone sessions — shown first, open */}
      {standaloneSessions.length > 0 && (
        <SessionGroup
          title="Project"
          sessions={standaloneSessions}
          onSelect={onSelectSession}
          onDelete={handleDelete}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
        />
      )}

      {/* Characters — collapsible section with character > boards tree */}
      {characterTree.length > 0 && (
        <CollapsibleSection title="Characters" count={characterCount}>
          {characterTree.map(charNode => (
            <CharacterNode
              key={charNode.charId}
              charNode={charNode}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
            />
          ))}
        </CollapsibleSection>
      )}

      {/* Supplementary — flat list */}
      {supplementarySessions.length > 0 && (
        <CollapsibleSection title="Supplementary" count={supplementarySessions.length}>
          {supplementarySessions.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
            />
          ))}
        </CollapsibleSection>
      )}

      {/* Storyboard — collapsed section with scene > shot tree */}
      {(storyboardTree.length > 0 || orphanShotSessions.length > 0) && (
        <CollapsibleSection title="Storyboard" count={storyboardCount}>
          {storyboardTree.map(scene => (
            <SceneNode
              key={scene.sceneId}
              scene={scene}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
            />
          ))}
          {orphanShotSessions.length > 0 && (
            <SessionGroup
              title="Shots"
              sessions={orphanShotSessions}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
            />
          )}
        </CollapsibleSection>
      )}
    </div>
  )
}


function CollapsibleSection({ title, count = 0, disabled = false, children }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => !disabled && setExpanded(e => !e)}
        className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-1 mb-1.5 transition-colors ${
          disabled ? 'text-text-muted/50 cursor-default' : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        <Chevron open={expanded} className={disabled ? 'opacity-30' : ''} />
        {title}
        {count > 0 && <span className="text-text-muted/60 ml-0.5">({count})</span>}
      </button>
      {expanded && !disabled && (
        <div className="flex flex-col gap-1 ml-1">
          {children}
        </div>
      )}
    </div>
  )
}


function SceneNode({ scene, onSelect, onDelete, confirmDelete, setConfirmDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted px-1 py-1 hover:text-text-secondary transition-colors"
      >
        <Chevron open={expanded} />
        {scene.label}
      </button>
      {expanded && scene.shots.map(shot => (
        <ShotNode
          key={shot.shotId}
          shot={shot}
          onSelect={onSelect}
          onDelete={onDelete}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
        />
      ))}
    </div>
  )
}


function ShotNode({ shot, onSelect, onDelete, confirmDelete, setConfirmDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="ml-3">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-[10px] text-text-muted px-1 py-1 hover:text-text-secondary transition-colors"
      >
        <Chevron open={expanded} />
        {shot.label}
        <span className="text-text-muted/50 text-[9px]">{shot.sessions.length}</span>
      </button>
      {expanded && (
        <div className="ml-3 flex flex-col gap-1">
          {shot.sessions.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              onSelect={onSelect}
              onDelete={onDelete}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}


function CharacterNode({ charNode, onSelect, onDelete, confirmDelete, setConfirmDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted px-1 py-1 hover:text-text-secondary transition-colors"
      >
        <Chevron open={expanded} />
        {charNode.name}
        <span className="text-text-muted/50 text-[9px]">{charNode.sessions.length}</span>
      </button>
      {expanded && (
        <div className="ml-3 flex flex-col gap-1">
          {charNode.sessions.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              onSelect={onSelect}
              onDelete={onDelete}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}


function SessionGroup({ title, sessions, onSelect, onDelete, confirmDelete, setConfirmDelete }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5 px-1">{title}</p>
      <div className="flex flex-col gap-1">
        {sessions.map(s => (
          <SessionRow
            key={s.id}
            session={s}
            onSelect={onSelect}
            onDelete={onDelete}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
          />
        ))}
      </div>
    </div>
  )
}


function SessionRow({ session: s, onSelect, onDelete, confirmDelete, setConfirmDelete }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface hover:bg-surface-hover transition-colors cursor-pointer group"
      onClick={() => onSelect(s.id)}
    >
      {/* Thumbnails */}
      <div className="flex gap-1 flex-shrink-0">
        {(s.thumbnail_urls || []).slice(0, 3).map((url, i) => (
          <img key={i} src={url} alt="" className="w-8 h-8 rounded object-cover" />
        ))}
        {(!s.thumbnail_urls || s.thumbnail_urls.length === 0) && (
          <div className="w-8 h-8 rounded bg-surface-hover" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-primary truncate">{s.query || 'Untitled'}</p>
        <p className="text-[10px] text-text-muted mt-0.5">
          {s.item_count || 0} items
          {s.liked_count > 0 && ` · ${s.liked_count} liked`}
        </p>
      </div>

      {/* Delete */}
      {onDelete && (
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          {confirmDelete === s.id ? (
            <div className="flex gap-1">
              <button onClick={() => onDelete(s.id)} className="text-[10px] text-dislike px-1">Yes</button>
              <button onClick={() => setConfirmDelete(null)} className="text-[10px] text-text-muted px-1">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(s.id)}
              className="p-1 text-text-muted hover:text-dislike transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
