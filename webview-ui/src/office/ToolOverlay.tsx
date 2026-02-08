interface ToolActivity {
  toolId: string
  status: string
  done: boolean
  permissionWait?: boolean
}

interface ToolOverlayProps {
  agentId: number | null
  screenX: number
  screenY: number
  agentTools: Record<number, ToolActivity[]>
  agentStatuses: Record<number, string>
  subagentTools: Record<number, Record<string, ToolActivity[]>>
}

export function ToolOverlay({
  agentId,
  screenX,
  screenY,
  agentTools,
  agentStatuses,
  subagentTools,
}: ToolOverlayProps) {
  if (agentId === null) return null

  const tools = agentTools[agentId] || []
  const subs = subagentTools[agentId] || {}
  const status = agentStatuses[agentId]
  const hasActiveTools = tools.some((t) => !t.done)

  if (tools.length === 0 && status !== 'waiting') return null

  return (
    <div
      style={{
        position: 'absolute',
        left: screenX + 12,
        top: screenY - 8,
        background: 'var(--vscode-editorWidget-background, #252526)',
        border: '1px solid var(--vscode-editorWidget-border, #454545)',
        borderRadius: 4,
        padding: '6px 10px',
        pointerEvents: 'none',
        zIndex: 100,
        maxWidth: 280,
        fontSize: '11px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      <div
        style={{
          fontWeight: 'bold',
          fontSize: '12px',
          marginBottom: tools.length > 0 || status === 'waiting' ? 4 : 0,
          color: 'var(--vscode-foreground)',
        }}
      >
        Agent #{agentId}
      </div>
      {tools.map((tool) => (
        <div key={tool.toolId}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              opacity: tool.done ? 0.5 : 0.9,
              lineHeight: '16px',
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
                  : tool.permissionWait
                    ? 'var(--vscode-charts-yellow, #cca700)'
                    : 'var(--vscode-charts-blue, #3794ff)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span>{tool.permissionWait && !tool.done ? 'Needs approval' : tool.status}</span>
          </div>
          {subs[tool.toolId] && subs[tool.toolId].length > 0 && (
            <div style={{ marginLeft: 11, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 6 }}>
              {subs[tool.toolId].map((sub) => (
                <div
                  key={sub.toolId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    opacity: sub.done ? 0.4 : 0.8,
                    lineHeight: '15px',
                    fontSize: '10px',
                  }}
                >
                  <span
                    className={sub.done ? undefined : 'arcadia-pulse'}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: sub.done
                        ? 'var(--vscode-charts-green, #89d185)'
                        : 'var(--vscode-charts-blue, #3794ff)',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span>{sub.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {status === 'waiting' && !hasActiveTools && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            opacity: 0.85,
            lineHeight: '16px',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--vscode-charts-yellow, #cca700)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <span>Waiting for input</span>
        </div>
      )}
    </div>
  )
}
