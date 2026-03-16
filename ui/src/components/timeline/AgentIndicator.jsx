import { useChatSession } from '../../chat'
import './AgentIndicator.css'

export default function AgentIndicator({ scopeKey, hasNewDot, onClick }) {
  const session = useChatSession(scopeKey)

  // Show indicator whenever there are messages (active or persisted).
  // The parent (Timeline) removes the indicator from the map while the
  // inline assistant panel is open, so this only renders when minimized.
  // Indicator stays until the user opens the panel and the session
  // is marked seen — but we no longer auto-hide here; the parent
  // controls visibility via agentScopeMap exclusion.
  if (!session.messages.length) return null

  return (
    <div
      className={`agent-indicator ${session.isLoading ? 'loading' : ''}`}
      style={{ top: hasNewDot ? 16 : 4 }}
      onClick={e => { e.stopPropagation(); onClick?.(e) }}
      title="Agent chat"
    >
      <img src="/favicon.png" alt="" className="agent-indicator-icon" />
    </div>
  )
}
