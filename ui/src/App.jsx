import { useState, useEffect, useCallback, useRef } from 'react'
import Storyboard from './pages/Storyboard'
import useAuth from './hooks/useAuth'
import { setAuthTokenGetter } from './services/api'
import { setAuthTokenGetter as setSoulboardTokenGetter } from './services/soulboardApi'
import { setAuthTokenGetter as setAgentTokenGetter } from './services/agentApi'
import './App.css'

function SaveIndicator({ isDirty, saving, onSave }) {
  const status = saving ? 'syncing' : isDirty ? 'unsaved' : 'saved'
  const title = saving ? 'Saving...' : isDirty ? 'Unsaved changes (click to save)' : 'All changes saved (click to force save)'
  return (
    <button className={`save-indicator ${status}`} title={title} onClick={onSave} disabled={saving}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3.5v4.5h-4.5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 20.5v-4.5h4.5" />
      </svg>
    </button>
  )
}

function LoginPage({ onGoogleLogin, onEmailLogin, onEmailSignUp, authError, darkMode, setDarkMode }) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (isSignUp) {
        await onEmailSignUp(email, password)
      } else {
        await onEmailLogin(email, password)
      }
    } catch (err) {
      const code = err.code || ''
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') setError('Invalid email or password')
      else if (code === 'auth/wrong-password') setError('Invalid email or password')
      else if (code === 'auth/email-already-in-use') setError('Email already in use')
      else if (code === 'auth/weak-password') setError('Password must be at least 6 characters')
      else if (code === 'auth/invalid-email') setError('Invalid email address')
      else setError(err.message || 'Authentication failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg">
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
      </div>
      <button className="login-mode-toggle" onClick={() => setDarkMode(!darkMode)} title={darkMode ? 'Light mode' : 'Dark mode'}>
        {darkMode ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        )}
      </button>
      <div className="login-card">
        <div className="login-brand">FreeTitle AI</div>
        <div className="login-subtitle">Studio</div>
        <form className="login-email-form" onSubmit={handleEmailSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="login-input"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="login-input"
            required
            minLength={6}
          />
          {(error || authError) && <div className="login-error">{error || authError}</div>}
          <button type="submit" className="login-email-btn" disabled={submitting}>
            {submitting ? '...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>
        <button className="login-toggle-mode" onClick={() => { setIsSignUp(!isSignUp); setError('') }}>
          {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
        <div className="login-divider"><span>or</span></div>
        <button className="login-google-btn" onClick={onGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { user, loading, authError, loginWithGoogle, loginWithEmail, signUpWithEmail, logout, getToken } = useAuth()
  const [version, setVersion] = useState('')
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') !== 'light')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [breadcrumbs, setBreadcrumbs] = useState([])
  const [saveStatus, setSaveStatus] = useState({ isDirty: false, saving: false })
  const [trashCount, setTrashCount] = useState(0)
  const [trashOpen, setTrashOpen] = useState(false)
  const saveNowRef = useRef(null)
  const titleClickRef = useRef(null)

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), [])

  // Register auth token getter with API modules
  useEffect(() => {
    setAuthTokenGetter(getToken)
    setSoulboardTokenGetter(getToken)
    setAgentTokenGetter(getToken)
  }, [getToken])

  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {})
  }, [])

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode)
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-orb login-orb-1" />
          <div className="login-orb login-orb-2" />
          <div className="login-orb login-orb-3" />
        </div>
        <div className="login-brand" style={{ position: 'relative', opacity: 0.6, animation: 'pulse 2s ease-in-out infinite' }}>FreeTitle AI</div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage onGoogleLogin={loginWithGoogle} onEmailLogin={loginWithEmail} onEmailSignUp={signUpWithEmail} authError={authError} darkMode={darkMode} setDarkMode={setDarkMode} />
  }

  return (
    <div className="container">
      <div className="nav-bar">
        <div className="nav-links">
          <button className="sidebar-toggle" onClick={toggleSidebar}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="4" x2="14" y2="4" />
              <line x1="2" y1="8" x2="14" y2="8" />
              <line x1="2" y1="12" x2="14" y2="12" />
            </svg>
          </button>
          <span className="nav-link active" onClick={() => titleClickRef.current?.()}>FreeTitle AI</span>
          {breadcrumbs.map((crumb, i) => (
            <span
              key={i}
              className={`nav-breadcrumb${crumb.onClick ? ' clickable' : ''}`}
              onClick={crumb.onClick || undefined}
            >
              {crumb.label}
            </span>
          ))}
        </div>
        <div className="nav-right">
          {breadcrumbs.length > 0 && (
            <button className="trash-toggle" title="Deleted items" onClick={() => setTrashOpen(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              {trashCount > 0 && <span className="trash-badge">{trashCount}</span>}
            </button>
          )}
          {breadcrumbs.length > 0 && <SaveIndicator isDirty={saveStatus.isDirty} saving={saveStatus.saving} onSave={() => saveNowRef.current?.()} />}
          {version && version.startsWith('dev') && <span className="version-label">{version}</span>}
          <span className="user-email" style={{ fontSize: '12px', opacity: 0.7 }}>{user.email}</span>
          <button className="theme-toggle" onClick={logout} title="Sign out">
            Sign Out
          </button>
          <button className="theme-toggle" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
      </div>
      <Storyboard sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} onTitleClick={titleClickRef} onBreadcrumbChange={setBreadcrumbs} onSaveStatusChange={setSaveStatus} saveNowRef={saveNowRef} trashOpen={trashOpen} setTrashOpen={setTrashOpen} onTrashCountChange={setTrashCount} />
    </div>
  )
}
