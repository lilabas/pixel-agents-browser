import { useState, useCallback, useEffect } from 'react'
import App from '../App.js'
import { TerminalPanel } from './TerminalPanel.js'
import { addMessageHandler } from '../wsClient.js'

export function AppLayout() {
  const [agents, setAgents] = useState<number[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<number | null>(null)

  useEffect(() => {
    const cleanup = addMessageHandler((msg: any) => {
      if (msg.type === 'agentCreated') {
        const id = msg.id as number
        setAgents((prev) => prev.includes(id) ? prev : [...prev, id])
        setActiveTerminalId(id)
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number
        setAgents((prev) => prev.filter((a) => a !== id))
        setActiveTerminalId((prev) => prev === id ? null : prev)
      } else if (msg.type === 'focusTerminal') {
        setActiveTerminalId(msg.id as number)
      }
    })
    return cleanup
  }, [])

  const handleTabClick = useCallback((id: number) => {
    setActiveTerminalId(id)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Office view */}
      <div style={{ flex: '1 1 60%', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <App />
      </div>

      {/* Terminal panel */}
      {agents.length > 0 && (
        <div style={{
          flex: '0 0 40%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderTop: '2px solid rgba(255, 255, 255, 0.15)',
          background: '#1a1a2e',
        }}>
          {/* Tab bar */}
          <div style={{
            display: 'flex',
            gap: 0,
            background: '#0d0d1a',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            overflow: 'auto',
          }}>
            {agents.map((id) => (
              <button
                key={id}
                onClick={() => handleTabClick(id)}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  background: activeTerminalId === id ? '#1a1a2e' : 'transparent',
                  color: activeTerminalId === id ? '#00ff88' : 'rgba(255, 255, 255, 0.5)',
                  border: 'none',
                  borderRight: '1px solid rgba(255, 255, 255, 0.05)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Agent #{id}
              </button>
            ))}
          </div>

          {/* Terminal content */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {agents.map((id) => (
              <TerminalPanel key={id} agentId={id} isVisible={id === activeTerminalId} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
