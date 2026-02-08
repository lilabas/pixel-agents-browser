import { SCALE } from './types.js'
import type { SpriteData } from './types.js'

const cache = new WeakMap<SpriteData, HTMLCanvasElement>()

export function getCachedSprite(sprite: SpriteData): HTMLCanvasElement {
  const cached = cache.get(sprite)
  if (cached) return cached

  const rows = sprite.length
  const cols = sprite[0].length
  const canvas = document.createElement('canvas')
  canvas.width = cols * SCALE
  canvas.height = rows * SCALE
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = sprite[r][c]
      if (color === '') continue
      ctx.fillStyle = color
      ctx.fillRect(c * SCALE, r * SCALE, SCALE, SCALE)
    }
  }

  cache.set(sprite, canvas)
  return canvas
}
