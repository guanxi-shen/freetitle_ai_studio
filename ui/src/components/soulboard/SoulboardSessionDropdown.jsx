/**
 * Compact dropdown for picking/creating soulboard sessions.
 * Shows hierarchical session list grouped by shot, with scene/shot tree for other shots.
 * Sessions from other shots open as read-only; guardMutation in SoulboardView
 * auto-forks on first edit, saving a copy under the current shot.
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import * as api from '../../services/soulboardApi'

export default function SoulboardSessionDropdown({
  projectName,
  context = 'standalone',
  shotId = null,
  characterId = null,
  scenes = [],
  characters = [],
  anchorEl,
  onSelect,
  onNew,
  onClose,
}) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const dropdownRef = useRef(null)
  const [pos, setPos] = useState(null)

  // Fetch sessions
  useEffect(() => {
    if (!projectName) return
    setLoading(true)
    api.listSessions(projectName)
      .then(data => setSessions((data.sessions || []).filter(s => s.item_count > 0)))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [projectName])

  // Position relative to anchor (drop up by default), or center if no anchor
  useEffect(() => {
    function update() {
      const dd = dropdownRef.current
      const ddH = dd ? dd.offsetHeight : 200
      const ddW = dd ? dd.offsetWidth : 260

      if (!anchorEl) {
        setPos({ top: (window.innerHeight - ddH) / 2, left: (window.innerWidth - ddW) / 2 })
        return
      }

      const rect = anchorEl.getBoundingClientRect()

      let top = rect.top - ddH - 6
      let left = rect.left + rect.width / 2 - ddW / 2

      if (top < 8) top = rect.bottom + 6
      if (left + ddW > window.innerWidth - 8) left = window.innerWidth - ddW - 8
      if (left < 8) left = 8

      setPos({ top, left })
    }
    update()
    requestAnimationFrame(update)
  }, [anchorEl, sessions, loading])

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) && !anchorEl?.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, anchorEl])

  const handleDelete = async (sessionId) => {
    try {
      await api.deleteSession(projectName, sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
    } catch (e) {
      console.error('[Soulboard] Delete failed:', e)
    }
    setConfirmDelete(null)
  }

  // Group: this shot's sessions (numbered Board 1, Board 2, ...)
  const thisShotSessions = shotId ? sessions.filter(s => s.shot_id === shotId) : []
  const standaloneSessions = sessions.filter(s => s.context === 'standalone')

  // Group: this character's sessions
  const thisCharSessions = characterId ? sessions.filter(s => s.character_id === characterId) : []
  // Group: other character sessions — build character → sessions tree
  const otherCharTree = useMemo(() => {
    const other = sessions.filter(s => s.context === 'character' && s.character_id && s.character_id !== characterId)
    if (other.length === 0 || characters.length === 0) return []
    const byCharId = {}
    for (const s of other) {
      ;(byCharId[s.character_id] ||= []).push(s)
    }
    return characters
      .filter(c => byCharId[c.id])
      .map(c => ({ charId: c.id, name: c.name, sessions: byCharId[c.id] }))
  }, [sessions, characters, characterId])

  // Group: supplementary sessions
  const supplementarySessions = sessions.filter(s => s.context === 'supplementary')

  // Group: other shots — build scene → shot → sessions tree
  const otherShotsTree = useMemo(() => {
    const other = sessions.filter(s => s.context === 'shot' && s.shot_id && s.shot_id !== shotId)
    if (other.length === 0 || scenes.length === 0) return []

    // Map shot_id → sessions
    const byShotId = {}
    for (const s of other) {
      ;(byShotId[s.shot_id] ||= []).push(s)
    }

    // Build tree from project scenes
    const tree = []
    scenes.forEach((scene, si) => {
      const shotNodes = []
      ;(scene.shots || []).forEach((shot, shi) => {
        const shotSessions = byShotId[shot.id]
        if (shotSessions?.length) {
          shotNodes.push({ shotId: shot.id, label: `Shot ${shi + 1}`, sessions: shotSessions })
        }
      })
      if (shotNodes.length) {
        tree.push({ sceneId: scene.id, label: `Scene ${si + 1}`, shots: shotNodes })
      }
    })
    return tree
  }, [sessions, scenes, shotId])

  const dropdown = (
    <div
      ref={dropdownRef}
      className="soulboard-session-dropdown"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
    >
      <div className="sbd-header">
        <span className="sbd-title">Soulboard</span>
        <button className="sbd-close" onClick={onClose}>&times;</button>
      </div>

      <button className="sbd-new-btn" onClick={onNew}>+ New</button>

      <div className="sbd-sessions">
        {loading && <p className="sbd-empty">Loading...</p>}
        {!loading && sessions.length === 0 && <p className="sbd-empty">No sessions yet</p>}

        {/* This shot's sessions */}
        {thisShotSessions.length > 0 && (
          <div className="sbd-group">
            <p className="sbd-group-title">This shot</p>
            {thisShotSessions.map((s, i) => (
              <SessionItem
                key={s.id}
                session={s}
                label={`Board ${i + 1}`}
                onClick={() => onSelect(s.id, false, `Board ${i + 1}`, s)}
                onDelete={handleDelete}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
              />
            ))}
          </div>
        )}

        {/* Standalone sessions */}
        {standaloneSessions.length > 0 && (
          <div className="sbd-group">
            <p className="sbd-group-title">{shotId ? 'Project' : 'Sessions'}</p>
            {standaloneSessions.map((s, i) => (
              <SessionItem
                key={s.id}
                session={s}
                label={`Board ${i + 1}`}
                onClick={() => onSelect(s.id, false, `Board ${i + 1}`, s)}
                onDelete={handleDelete}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
              />
            ))}
          </div>
        )}

        {/* This character's sessions */}
        {thisCharSessions.length > 0 && (
          <div className="sbd-group">
            <p className="sbd-group-title">This character</p>
            {thisCharSessions.map((s, i) => (
              <SessionItem
                key={s.id}
                session={s}
                label={`Board ${i + 1}`}
                onClick={() => onSelect(s.id, false, `Board ${i + 1}`, s)}
                onDelete={handleDelete}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
              />
            ))}
          </div>
        )}

        {/* Other characters — collapsible tree */}
        {otherCharTree.length > 0 && (
          <div className="sbd-group">
            <button className="sbd-group-toggle" onClick={() => {}}>
              Characters
            </button>
            {otherCharTree.map(charNode => (
              <CharacterNode key={charNode.charId} charNode={charNode} onSelect={(id, label, session) => onSelect(id, true, label, session)} />
            ))}
          </div>
        )}

        {/* Supplementary sessions */}
        {supplementarySessions.length > 0 && (
          <div className="sbd-group">
            <p className="sbd-group-title">{context === 'supplementary' ? 'Supplementary' : 'Supplementary'}</p>
            {supplementarySessions.map((s, i) => (
              <SessionItem
                key={s.id}
                session={s}
                label={`Board ${i + 1}`}
                onClick={() => onSelect(s.id, context !== 'supplementary', `Board ${i + 1}`, s)}
                onDelete={context === 'supplementary' ? handleDelete : undefined}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
              />
            ))}
          </div>
        )}

        {/* Other shots — collapsible scene/shot tree */}
        {otherShotsTree.length > 0 && (
          <OtherShotsTree tree={otherShotsTree} onSelect={(id, label, session) => onSelect(id, true, label, session)} />
        )}
      </div>
    </div>
  )

  return createPortal(dropdown, document.body)
}


function SessionItem({ session, label, onClick, onDelete, confirmDelete, setConfirmDelete, readOnly }) {
  return (
    <div className="sbd-session-item" onClick={onClick}>
      <div className="sbd-thumbs">
        {(session.thumbnail_urls || []).slice(0, 3).map((url, i) => (
          <img key={i} src={url} alt="" className="sbd-thumb" />
        ))}
        {(!session.thumbnail_urls || session.thumbnail_urls.length === 0) && (
          <div className="sbd-thumb-placeholder" />
        )}
      </div>
      <div className="sbd-info">
        <span className="sbd-query">{label}</span>
        <span className="sbd-meta">
          {session.query ? `"${session.query.length > 18 ? session.query.slice(0, 18) + '...' : session.query}" - ` : ''}
          {session.item_count || 0} items
          {session.liked_count > 0 && ` / ${session.liked_count} liked`}
        </span>
      </div>
      {readOnly && <span className="sbd-readonly-badge">RO</span>}
      {onDelete && (
        <div className="sbd-delete-area" onClick={e => e.stopPropagation()}>
          {confirmDelete === session.id ? (
            <div className="sbd-delete-confirm">
              <button onClick={() => onDelete(session.id)} className="sbd-confirm-yes">Yes</button>
              <button onClick={() => setConfirmDelete(null)} className="sbd-confirm-no">No</button>
            </div>
          ) : (
            <button className="sbd-delete-btn" onClick={() => setConfirmDelete(session.id)}>
              <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
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


function CharacterNode({ charNode, onSelect }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="sbd-tree-node">
      <button className="sbd-tree-toggle" onClick={() => setExpanded(e => !e)}>
        <svg
          viewBox="0 0 20 20" fill="currentColor"
          className={`sbd-chevron ${expanded ? 'open' : ''}`}
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        {charNode.name}
        <span className="sbd-tree-count">{charNode.sessions.length}</span>
      </button>
      {expanded && charNode.sessions.map((s, i) => (
        <SessionItem
          key={s.id}
          session={s}
          label={`Board ${i + 1}`}
          onClick={() => onSelect(s.id, `Board ${i + 1}`, s)}
          readOnly
        />
      ))}
    </div>
  )
}


function OtherShotsTree({ tree, onSelect }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="sbd-group">
      <button className="sbd-group-toggle" onClick={() => setExpanded(e => !e)}>
        <svg
          viewBox="0 0 20 20" fill="currentColor"
          className={`sbd-chevron ${expanded ? 'open' : ''}`}
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        Storyboard
      </button>
      {expanded && tree.map(scene => (
        <SceneNode key={scene.sceneId} scene={scene} onSelect={onSelect} />
      ))}
    </div>
  )
}


function SceneNode({ scene, onSelect }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="sbd-tree-node">
      <button className="sbd-tree-toggle" onClick={() => setExpanded(e => !e)}>
        <svg
          viewBox="0 0 20 20" fill="currentColor"
          className={`sbd-chevron ${expanded ? 'open' : ''}`}
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        {scene.label}
      </button>
      {expanded && scene.shots.map(shot => (
        <ShotNode key={shot.shotId} shot={shot} onSelect={onSelect} />
      ))}
    </div>
  )
}


function ShotNode({ shot, onSelect }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="sbd-tree-node sbd-tree-indent">
      <button className="sbd-tree-toggle" onClick={() => setExpanded(e => !e)}>
        <svg
          viewBox="0 0 20 20" fill="currentColor"
          className={`sbd-chevron ${expanded ? 'open' : ''}`}
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        {shot.label}
        <span className="sbd-tree-count">{shot.sessions.length}</span>
      </button>
      {expanded && shot.sessions.map((s, i) => (
        <SessionItem
          key={s.id}
          session={s}
          label={`Board ${i + 1}`}
          onClick={() => onSelect(s.id, `Board ${i + 1}`, s)}
          readOnly
        />
      ))}
    </div>
  )
}
