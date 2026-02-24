import { useState, useEffect } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { TILE_SIZE, CharacterState } from '../office/types.js'
import { CHARACTER_SITTING_OFFSET_PX, TOOL_OVERLAY_VERTICAL_OFFSET } from '../constants.js'

interface AgentLabelsProps {
  officeState: OfficeState
  agents: number[]
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
}

export function AgentLabels({
  officeState,
  agents,
  containerRef,
  zoom,
  panRef,
}: AgentLabelsProps) {
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

  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  return (
    <>
      {agents.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch || ch.isSubagent) return null
        if (!ch.projectName) return null
        // Skip agents with matrix effects (spawning/despawning)
        if (ch.matrixEffect) return null

        const isSelected = officeState.selectedAgentId === id
        const isHovered = officeState.hoveredAgentId === id
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr
        // When selected/hovered, ToolOverlay appears at screenY - 24, so push label above it
        const topOffset = (isSelected || isHovered) ? -50 : -24

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY + topOffset,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 'var(--pixel-overlay-z)',
            }}
          >
            <span
              style={{
                fontSize: '18px',
                color: 'var(--pixel-text-dim)',
                background: 'rgba(30,30,46,0.65)',
                padding: '1px 5px',
                borderRadius: 0,
                border: '1px solid rgba(255,255,255,0.08)',
                whiteSpace: 'nowrap',
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'block',
              }}
            >
              {ch.projectName}
            </span>
          </div>
        )
      })}
    </>
  )
}
