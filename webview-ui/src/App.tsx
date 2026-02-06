import { useState, useEffect, useCallback } from 'react'

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

const vscode = acquireVsCodeApi()

interface Folder {
  id: string
  name: string
  path: string
}

interface AgentInfo {
  id: number
  folderId: string
}

interface ContextMenu {
  agentId: number
  x: number
  y: number
}

interface MoveDialog {
  agentId: number
  targetFolder: Folder
  sourceFolderPath: string
  keepAccess: boolean
  continueConversation: boolean
}

interface ToolActivity {
  toolId: string
  status: string
  done: boolean
}

function App() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [moveDialog, setMoveDialog] = useState<MoveDialog | null>(null)
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({})

  // Dismiss context menu on click outside
  const dismissContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  useEffect(() => {
    if (contextMenu) {
      window.addEventListener('click', dismissContextMenu)
      return () => window.removeEventListener('click', dismissContextMenu)
    }
  }, [contextMenu, dismissContextMenu])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'agentCreated') {
        const newAgent: AgentInfo = { id: msg.id as number, folderId: msg.folderId as string }
        setAgents((prev) =>
          prev.some((a) => a.id === newAgent.id) ? prev : [...prev, newAgent]
        )
        setSelectedAgent(msg.id as number)
      } else if (msg.type === 'agentClosed') {
        setAgents((prev) => prev.filter((a) => a.id !== msg.id))
        setSelectedAgent((prev) => (prev === msg.id ? null : prev))
        setAgentTools((prev) => {
          if (!(msg.id in prev)) return prev
          const next = { ...prev }
          delete next[msg.id as number]
          return next
        })
      } else if (msg.type === 'existingAgents') {
        const incomingFolders = msg.folders as Folder[]
        const incomingAgents = (msg.agents as { agentId: number; folderId: string }[]).map(
          (a) => ({ id: a.agentId, folderId: a.folderId })
        )
        setFolders(incomingFolders)
        setAgents((prev) => {
          const ids = new Set(prev.map((a) => a.id))
          const merged = [...prev]
          for (const a of incomingAgents) {
            if (!ids.has(a.id)) {
              merged.push(a)
            }
          }
          return merged.sort((a, b) => a.id - b.id)
        })
      } else if (msg.type === 'folderAdded') {
        const newFolder: Folder = {
          id: msg.id as string,
          name: msg.name as string,
          path: msg.path as string,
        }
        setFolders((prev) => (prev.some((f) => f.id === newFolder.id) ? prev : [...prev, newFolder]))
      } else if (msg.type === 'agentMoved') {
        const agentId = msg.agentId as number
        const targetFolderId = msg.targetFolderId as string
        setAgents((prev) =>
          prev.map((a) => (a.id === agentId ? { ...a, folderId: targetFolderId } : a))
        )
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number
        const toolId = msg.toolId as string
        const status = msg.status as string
        setAgentTools((prev) => {
          const list = prev[id] || []
          if (list.some((t) => t.toolId === toolId)) return prev
          return { ...prev, [id]: [...list, { toolId, status, done: false }] }
        })
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
      }
    }
    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'webviewReady' })
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleSelectAgent = (id: number) => {
    setSelectedAgent(id)
    vscode.postMessage({ type: 'focusAgent', id })
  }

  const handleOpenClaude = () => {
    const folder = folders.length > 0 ? folders[0] : null
    vscode.postMessage({
      type: 'openClaude',
      folderId: folder?.id,
      folderPath: folder?.path,
    })
  }

  const handleAddFolder = () => {
    vscode.postMessage({ type: 'addFolder' })
  }

  const handleAgentContextMenu = (e: React.MouseEvent, agentId: number) => {
    e.preventDefault()
    if (folders.length <= 1) return // no other folder to move to
    setContextMenu({ agentId, x: e.clientX, y: e.clientY })
  }

  const handleMoveAgent = (agentId: number, targetFolder: Folder) => {
    const agent = agents.find((a) => a.id === agentId)
    const sourceFolder = agent ? folders.find((f) => f.id === agent.folderId) : null
    setMoveDialog({
      agentId,
      targetFolder,
      sourceFolderPath: sourceFolder?.path || '',
      keepAccess: false,
      continueConversation: true,
    })
    setContextMenu(null)
  }

  const handleConfirmMove = () => {
    if (!moveDialog) return
    vscode.postMessage({
      type: 'moveAgent',
      agentId: moveDialog.agentId,
      targetFolderId: moveDialog.targetFolder.id,
      targetPath: moveDialog.targetFolder.path,
      keepAccess: moveDialog.keepAccess,
      sourcePath: moveDialog.sourceFolderPath,
      continueConversation: moveDialog.continueConversation,
    })
    setMoveDialog(null)
  }

  const agentsByFolder = (folderId: string) => agents.filter((a) => a.folderId === folderId)

  const renderAgentButton = (agent: AgentInfo) => {
    const isSelected = selectedAgent === agent.id
    const tools = agentTools[agent.id] || []
    return (
      <div key={agent.id} style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
          <button
            onClick={() => handleSelectAgent(agent.id)}
            onContextMenu={(e) => handleAgentContextMenu(e, agent.id)}
            style={{
              borderRadius: '3px 0 0 3px',
              padding: '8px 12px',
              fontSize: '14px',
              background: isSelected ? 'var(--vscode-button-background)' : undefined,
              color: isSelected ? 'var(--vscode-button-foreground)' : undefined,
              fontWeight: isSelected ? 'bold' : undefined,
            }}
          >
            Agent #{agent.id}
          </button>
          <button
            onClick={() => vscode.postMessage({ type: 'closeAgent', id: agent.id })}
            style={{
              borderRadius: '0 3px 3px 0',
              padding: '8px 10px',
              fontSize: '14px',
              opacity: 0.7,
              background: isSelected ? 'var(--vscode-button-background)' : undefined,
              color: isSelected ? 'var(--vscode-button-foreground)' : undefined,
            }}
            title="Close agent"
          >
            ✕
          </button>
        </span>
        {tools.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 4 }}>
            {tools.map((tool) => (
              <span
                key={tool.toolId}
                style={{
                  fontSize: '11px',
                  opacity: tool.done ? 0.5 : 0.8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  className={tool.done ? undefined : 'arcadia-pulse'}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: tool.done
                      ? 'var(--vscode-charts-green, #89d185)'
                      : 'var(--vscode-charts-blue, #3794ff)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                {tool.status}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const currentAgent = contextMenu ? agents.find((a) => a.id === contextMenu.agentId) : null
  const moveTargets = currentAgent
    ? folders.filter((f) => f.id !== currentAgent.folderId)
    : []

  return (
    <div style={{ padding: 12, fontSize: '14px' }}>
      <style>{`
        @keyframes arcadia-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .arcadia-pulse { animation: arcadia-pulse 1.5s ease-in-out infinite; }
      `}</style>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={handleAddFolder} style={{ padding: '8px 14px', fontSize: '14px' }}>+ Add Folder</button>
        <button onClick={handleOpenClaude} style={{ padding: '8px 14px', fontSize: '14px' }}>Open Claude Code</button>
      </div>

      {folders.map((folder) => {
        const folderAgents = agentsByFolder(folder.id)
        return (
          <div key={folder.id} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: '13px',
                opacity: 0.8,
                marginBottom: 6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={folder.path}
            >
              📁 {folder.name}{' '}
              <span style={{ opacity: 0.6, fontSize: '0.9em' }}>({folder.path})</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 8 }}>
              {folderAgents.length === 0 && (
                <span style={{ opacity: 0.5, fontSize: '13px' }}>No agents</span>
              )}
              {folderAgents.map(renderAgentButton)}
            </div>
          </div>
        )
      })}

      {contextMenu && moveTargets.length > 0 && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--vscode-menu-background, var(--vscode-editor-background))',
            border: '1px solid var(--vscode-menu-border, var(--vscode-widget-border))',
            borderRadius: 4,
            padding: '4px 0',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            minWidth: 180,
          }}
        >
          <div
            style={{
              padding: '6px 14px',
              fontSize: '13px',
              opacity: 0.6,
            }}
          >
            Move to…
          </div>
          {moveTargets.map((folder) => (
            <div
              key={folder.id}
              onClick={() => handleMoveAgent(contextMenu.agentId, folder)}
              style={{
                padding: '8px 14px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              📁 {folder.name}
            </div>
          ))}
        </div>
      )}

      {moveDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
            zIndex: 2000,
          }}
          onClick={() => setMoveDialog(null)}
        >
          <div
            style={{
              background: 'var(--vscode-editor-background)',
              border: '1px solid var(--vscode-widget-border)',
              borderRadius: 6,
              padding: 16,
              minWidth: 280,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 'bold', marginBottom: 14, fontSize: '15px' }}>
              Move Agent #{moveDialog.agentId} to {moveDialog.targetFolder.name}
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              <input
                type="checkbox"
                style={{ width: 16, height: 16 }}
                checked={moveDialog.continueConversation}
                onChange={(e) =>
                  setMoveDialog({ ...moveDialog, continueConversation: e.target.checked })
                }
              />
              Continue the conversation
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              <input
                type="checkbox"
                style={{ width: 16, height: 16 }}
                checked={moveDialog.keepAccess}
                onChange={(e) =>
                  setMoveDialog({ ...moveDialog, keepAccess: e.target.checked })
                }
              />
              Keep access to previous directory
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setMoveDialog(null)} style={{ padding: '8px 14px', fontSize: '14px' }}>Cancel</button>
              <button
                onClick={handleConfirmMove}
                style={{
                  padding: '8px 14px',
                  fontSize: '14px',
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                }}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
