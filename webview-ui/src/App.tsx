import { useState, useEffect, useCallback, useRef } from 'react'
import { OfficeState } from './office/officeState.js'
import { OfficeCanvas } from './office/OfficeCanvas.js'
import { ToolOverlay } from './office/ToolOverlay.js'

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

const vscode = acquireVsCodeApi()

// Game state lives outside React — updated imperatively by message handlers
const officeState = new OfficeState()

/** Map status prefixes back to tool names for animation selection */
const STATUS_TO_TOOL: Record<string, string> = {
  'Reading': 'Read',
  'Searching': 'Grep',
  'Globbing': 'Glob',
  'Fetching': 'WebFetch',
  'Searching web': 'WebSearch',
  'Writing': 'Write',
  'Editing': 'Edit',
  'Running': 'Bash',
  'Task': 'Task',
}

function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool
  }
  // Fallback: first word might be the tool name
  const first = status.split(/[\s:]/)[0]
  return first || null
}

interface ToolActivity {
  toolId: string
  status: string
  done: boolean
  permissionWait?: boolean
}

function App() {
  const [agents, setAgents] = useState<number[]>([])
  const [, setSelectedAgent] = useState<number | null>(null)
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({})
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({})
  const [subagentTools, setSubagentTools] = useState<Record<number, Record<string, ToolActivity[]>>>({})

  // Hover state for overlay
  const [hoveredAgent, setHoveredAgent] = useState<number | null>(null)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'agentCreated') {
        const id = msg.id as number
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]))
        setSelectedAgent(id)
        officeState.addAgent(id)
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number
        setAgents((prev) => prev.filter((a) => a !== id))
        setSelectedAgent((prev) => (prev === id ? null : prev))
        setAgentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        officeState.removeAgent(id)
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[]
        setAgents((prev) => {
          const ids = new Set(prev)
          const merged = [...prev]
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id)
              officeState.addAgent(id)
            }
          }
          return merged.sort((a, b) => a - b)
        })
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number
        const toolId = msg.toolId as string
        const status = msg.status as string
        setAgentTools((prev) => {
          const list = prev[id] || []
          if (list.some((t) => t.toolId === toolId)) return prev
          return { ...prev, [id]: [...list, { toolId, status, done: false }] }
        })
        // Extract tool name from status (e.g. "Reading src/App.tsx" → "Read")
        const toolName = extractToolName(status)
        officeState.setAgentTool(id, toolName)
        // Agent is active (working)
        officeState.setAgentActive(id, true)
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number
        const toolId = msg.toolId as string
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          }
        })
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number
        setAgentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        officeState.setAgentTool(id, null)
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number
        setSelectedAgent(id)
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number
        const status = msg.status as string
        setAgentStatuses((prev) => {
          if (status === 'active') {
            if (!(id in prev)) return prev
            const next = { ...prev }
            delete next[id]
            return next
          }
          return { ...prev, [id]: status }
        })
        // Update office state: waiting = not active, active = active
        officeState.setAgentActive(id, status === 'active')
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          }
        })
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          const hasPermission = list.some((t) => t.permissionWait)
          if (!hasPermission) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          }
        })
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        const toolId = msg.toolId as string
        const status = msg.status as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {}
          const list = agentSubs[parentToolId] || []
          if (list.some((t) => t.toolId === toolId)) return prev
          return { ...prev, [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] } }
        })
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        const toolId = msg.toolId as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id]
          if (!agentSubs) return prev
          const list = agentSubs[parentToolId]
          if (!list) return prev
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)) },
          }
        })
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id]
          if (!agentSubs || !(parentToolId in agentSubs)) return prev
          const next = { ...agentSubs }
          delete next[parentToolId]
          if (Object.keys(next).length === 0) {
            const outer = { ...prev }
            delete outer[id]
            return outer
          }
          return { ...prev, [id]: next }
        })
      }
    }
    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'webviewReady' })
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleOpenClaude = () => {
    vscode.postMessage({ type: 'openClaude' })
  }

  const handleHover = useCallback((agentId: number | null, screenX: number, screenY: number) => {
    setHoveredAgent(agentId)
    setHoverPos({ x: screenX, y: screenY })
  }, [])

  const handleClick = useCallback((agentId: number) => {
    setSelectedAgent(agentId)
    vscode.postMessage({ type: 'focusAgent', id: agentId })
  }, [])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes arcadia-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .arcadia-pulse { animation: arcadia-pulse 1.5s ease-in-out infinite; }
      `}</style>

      {/* Office canvas fills entire panel */}
      <OfficeCanvas
        officeState={officeState}
        onHover={handleHover}
        onClick={handleClick}
      />

      {/* Floating buttons in top-left corner */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          display: 'flex',
          gap: 6,
          zIndex: 50,
        }}
      >
        <button
          onClick={handleOpenClaude}
          style={{
            padding: '5px 10px',
            fontSize: '12px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            opacity: 0.9,
          }}
        >
          + Agent
        </button>
        <button
          onClick={() => vscode.postMessage({ type: 'openSessionsFolder' })}
          style={{
            padding: '5px 10px',
            fontSize: '12px',
            background: 'var(--vscode-button-secondaryBackground, #3A3D41)',
            color: 'var(--vscode-button-secondaryForeground, #ccc)',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            opacity: 0.9,
          }}
          title="Open JSONL sessions folder"
        >
          Sessions
        </button>
      </div>

      {/* Agent name labels above characters */}
      <AgentLabels officeState={officeState} agents={agents} agentStatuses={agentStatuses} containerRef={containerRef} />

      {/* Hover tooltip */}
      <ToolOverlay
        agentId={hoveredAgent}
        screenX={hoverPos.x}
        screenY={hoverPos.y}
        agentTools={agentTools}
        agentStatuses={agentStatuses}
        subagentTools={subagentTools}
      />
    </div>
  )
}

/** Small name labels + status dots floating above each character */
function AgentLabels({
  officeState,
  agents,
  agentStatuses,
  containerRef,
}: {
  officeState: OfficeState
  agents: number[]
  agentStatuses: Record<number, string>
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  // Re-render on animation frame for smooth label positioning
  const [, setTick] = useState(0)
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      setTick((n) => n + 1)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // Compute map offset from container size
  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const mapW = 20 * 16 * 2
  const mapH = 11 * 16 * 2
  const offsetX = Math.floor((rect.width - mapW) / 2)
  const offsetY = Math.floor((rect.height - mapH) / 2)

  return (
    <>
      {agents.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        const screenX = offsetX + ch.x * 2
        const screenY = offsetY + (ch.y - 24) * 2

        const status = agentStatuses[id]
        const isWaiting = status === 'waiting'
        const isActive = ch.isActive

        // Status dot color
        let dotColor = 'transparent'
        if (isWaiting) {
          dotColor = 'var(--vscode-charts-yellow, #cca700)'
        } else if (isActive) {
          dotColor = 'var(--vscode-charts-blue, #3794ff)'
        }

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 16,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 40,
            }}
          >
            {dotColor !== 'transparent' && (
              <span
                className={isActive && !isWaiting ? 'arcadia-pulse' : undefined}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dotColor,
                  marginBottom: 2,
                }}
              />
            )}
            <span
              style={{
                fontSize: '9px',
                color: 'var(--vscode-foreground)',
                background: 'rgba(30,30,46,0.7)',
                padding: '1px 4px',
                borderRadius: 2,
                whiteSpace: 'nowrap',
              }}
            >
              Agent #{id}
            </span>
          </div>
        )
      })}
    </>
  )
}

export default App
