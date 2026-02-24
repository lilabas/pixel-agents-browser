import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { vscode, addMessageHandler } from '../wsClient.js'

interface TerminalPanelProps {
  agentId: number
  isVisible: boolean
}

export function TerminalPanel({ agentId, isVisible }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'monospace',
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#00ff88',
      },
      convertEol: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    // Send keyboard input to server
    term.onData((data) => {
      vscode.postMessage({ type: 'terminalInput', id: agentId, data })
    })

    // Listen for terminal data from server
    const cleanup = addMessageHandler((msg: any) => {
      if (msg.type === 'terminalData' && msg.id === agentId) {
        term.write(msg.data)
      }
    })

    // Handle resize
    const observer = new ResizeObserver(() => {
      fit.fit()
      vscode.postMessage({
        type: 'terminalResize',
        id: agentId,
        cols: term.cols,
        rows: term.rows,
      })
    })
    observer.observe(containerRef.current)

    return () => {
      cleanup()
      observer.disconnect()
      term.dispose()
    }
  }, [agentId])

  // Re-fit when visibility changes
  useEffect(() => {
    if (isVisible && fitRef.current) {
      setTimeout(() => fitRef.current?.fit(), 0)
    }
  }, [isVisible])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: isVisible ? 'block' : 'none',
      }}
    />
  )
}
