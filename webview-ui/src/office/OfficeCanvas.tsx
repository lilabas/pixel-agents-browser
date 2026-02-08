import { useRef, useEffect, useCallback } from 'react'
import type { OfficeState } from './officeState.js'
import { startGameLoop } from './gameLoop.js'
import { renderFrame } from './renderer.js'
import { SCALE } from './types.js'

interface OfficeCanvasProps {
  officeState: OfficeState
  onHover: (agentId: number | null, screenX: number, screenY: number) => void
  onClick: (agentId: number) => void
}

export function OfficeCanvas({ officeState, onHover, onClick }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef({ x: 0, y: 0 })

  // Resize canvas to fill container
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    resizeCanvas()

    const observer = new ResizeObserver(() => resizeCanvas())
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    const stop = startGameLoop(canvas, {
      update: (dt) => {
        officeState.update(dt)
      },
      render: (ctx) => {
        const dpr = window.devicePixelRatio || 1
        const w = canvas.width / dpr
        const h = canvas.height / dpr
        ctx.save()
        // dpr scaling is already applied via ctx.scale in resizeCanvas
        const { offsetX, offsetY } = renderFrame(
          ctx,
          w,
          h,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
        )
        offsetRef.current = { x: offsetX, y: offsetY }
        ctx.restore()
      },
    })

    return () => {
      stop()
      observer.disconnect()
    }
  }, [officeState, resizeCanvas])

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      const worldX = (sx - offsetRef.current.x) / SCALE
      const worldY = (sy - offsetRef.current.y) / SCALE
      return { worldX, worldY, screenX: sx, screenY: sy }
    },
    [],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToWorld(e.clientX, e.clientY)
      if (!pos) return
      const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY)
      const canvas = canvasRef.current
      if (canvas) {
        canvas.style.cursor = hitId !== null ? 'pointer' : 'default'
      }
      // Get screen-relative position for tooltip
      const containerRect = containerRef.current?.getBoundingClientRect()
      const relX = containerRect ? e.clientX - containerRect.left : pos.screenX
      const relY = containerRect ? e.clientY - containerRect.top : pos.screenY
      onHover(hitId, relX, relY)
    },
    [officeState, onHover, screenToWorld],
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToWorld(e.clientX, e.clientY)
      if (!pos) return
      const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY)
      if (hitId !== null) {
        onClick(hitId)
      }
    },
    [officeState, onClick, screenToWorld],
  )

  const handleMouseLeave = useCallback(() => {
    onHover(null, 0, 0)
  }, [onHover])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#1E1E2E',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={handleMouseLeave}
        style={{ display: 'block' }}
      />
    </div>
  )
}
