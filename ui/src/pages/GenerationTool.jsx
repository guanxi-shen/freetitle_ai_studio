import { useState, useCallback } from 'react'
import GenerationPanel from '../components/generation/GenerationPanel'
import useGenerationProject from '../hooks/useGenerationProject'
import './GenerationTool.css'

const BADGE_MAP = {
  nano_banana: { label: 'NB', cls: 'nb' },
  veo: { label: 'Veo', cls: 'veo' },
}

export default function GenerationTool() {
  const {
    project, isDirty, saving,
    newProject, loadProject, listAllProjects, removeProject, saveNow,
    updateProject, addResult, deleteResult, setRankedResultIds, updateResultUrl,
  } = useGenerationProject()

  const [projectModal, setProjectModal] = useState(null) // 'new' | 'load' | null
  const [projectName, setProjectName] = useState('')
  const [projectList, setProjectList] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(null)

  // Result completed -> add to project (backend saved directly to project folder)
  const handleResultComplete = useCallback((result) => {
    if (!project) return
    const resultWithId = {
      ...result,
      id: result.result_id || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
    addResult(resultWithId)
  }, [project, addResult])

  // Form state changed -> update project for auto-save
  const handleStateChange = useCallback((state) => {
    updateProject(prev => ({ ...prev, ...state }))
  }, [updateProject])

  // Project modals
  async function openLoadModal() {
    setProjectModal('load')
    try {
      const list = await listAllProjects()
      setProjectList(list)
    } catch {
      setProjectList([])
    }
  }

  function handleNewProject() {
    if (!projectName.trim()) return
    newProject(projectName.trim())
    setProjectModal(null)
    setProjectName('')
  }

  async function handleLoadProject(name) {
    try {
      await loadProject(name)
      setProjectModal(null)
    } catch (e) {
      alert('Load failed: ' + e.message)
    }
  }

  async function handleDeleteProject(name) {
    try {
      await removeProject(name)
      setProjectList(prev => prev.filter(p => p.name !== name))
      setConfirmDelete(null)
    } catch (e) {
      alert('Delete failed: ' + e.message)
    }
  }

  // New/Load project modals (shared between both screens)
  const projectModals = (
    <>
      {/* New project modal */}
      <div className={`modal-overlay ${projectModal === 'new' ? 'active' : ''}`} onClick={() => setProjectModal(null)}>
        <div className="modal-box" onClick={e => e.stopPropagation()}>
          <h3>New Project</h3>
          <input
            type="text"
            placeholder="Project name..."
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleNewProject()}
          />
          <div className="modal-actions">
            <button onClick={() => setProjectModal(null)}>Cancel</button>
            <button className="primary" onClick={handleNewProject}>Create</button>
          </div>
        </div>
      </div>

      {/* Load project modal */}
      <div className={`modal-overlay ${projectModal === 'load' ? 'active' : ''}`} onClick={() => setProjectModal(null)}>
        <div className="modal-box" onClick={e => e.stopPropagation()}>
          <h3>Load Project</h3>
          <ul className="session-list">
            {projectList.length === 0 ? (
              <li style={{ color: 'var(--text-muted)', padding: 10 }}>No projects found</li>
            ) : projectList.map(p => (
              <li key={p.name} className="session-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div onClick={() => handleLoadProject(p.name)} style={{ cursor: 'pointer', flex: 1 }}>
                    <div className="session-name">{p.name}</div>
                    <div className="session-meta">
                      {p.updated_at && new Date(p.updated_at).toLocaleString()}
                      {' '}
                      {(p.providers || []).map(prov => (
                        <span key={prov} className={`provider-badge ${BADGE_MAP[prov]?.cls || ''}`}>
                          {(BADGE_MAP[prov]?.label || prov).toUpperCase()}
                        </span>
                      ))}
                      {' '}{p.result_count} result{p.result_count !== 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.prompt || ''}</div>
                  </div>
                  {confirmDelete === p.name ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="header-btn" style={{ color: 'var(--error)', borderColor: 'var(--error)' }} onClick={() => handleDeleteProject(p.name)}>Delete</button>
                      <button className="header-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="scene-delete" onClick={() => setConfirmDelete(p.name)}>x</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button onClick={() => setProjectModal(null)}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  )

  // No project loaded: show create/load screen
  if (!project) {
    return (
      <div className="storyboard-empty">
        <h2>Generation Tool</h2>
        <p>Create a new project or load an existing one.</p>
        <div className="storyboard-actions">
          <button className="generate-btn" onClick={() => setProjectModal('new')}>New Project</button>
          <button className="header-btn" onClick={openLoadModal}>Load Project</button>
        </div>
        {projectModals}
      </div>
    )
  }

  // Project loaded: workspace
  return (
    <div>
      {/* Header */}
      <div className="storyboard-header">
        <h2>{project.name}</h2>
        <div className="storyboard-header-actions">
          {isDirty && <span className="dirty-indicator">Unsaved</span>}
          {saving && <span className="saving-indicator">Saving...</span>}
          <button className="header-btn" onClick={saveNow}>Save</button>
          <button className="header-btn" onClick={openLoadModal}>Load</button>
          <button className="header-btn" onClick={() => setProjectModal('new')}>New</button>
        </div>
      </div>

      <GenerationPanel
        key={project.name}
        mode="standalone"
        initialState={project}
        onResultComplete={handleResultComplete}
        onStateChange={handleStateChange}
        existingResults={project.results}
        projectName={project?.name}
        rankedResultIds={project.ranked_result_ids}
        onRankChange={setRankedResultIds}
        onResultDelete={(task) => deleteResult(task.id)}
        showSelected={false}
      />

      {projectModals}
    </div>
  )
}
