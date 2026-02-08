import { TileType, TILE_SIZE, SCALE, MAP_COLS, MAP_ROWS } from './types.js'
import type { TileType as TileTypeVal, FurnitureInstance, Character } from './types.js'
import { getCachedSprite } from './spriteCache.js'
import { getCharacterSprites } from './sprites.js'
import { getCharacterSprite } from './characters.js'

// ── Tile colors ─────────────────────────────────────────────────

const WALL_COLOR = '#3A3A5C'
const TILE_FLOOR_A = '#D4C9A8'
const TILE_FLOOR_B = '#CCC19E'
const WOOD_FLOOR_A = '#B08850'
const WOOD_FLOOR_B = '#A47D48'
const CARPET_COLOR = '#7B4F8A'
const DOORWAY_COLOR = '#9E8E70'

function getTileColor(tile: TileTypeVal, col: number, row: number): string {
  switch (tile) {
    case TileType.WALL:
      return WALL_COLOR
    case TileType.TILE_FLOOR:
      return (col + row) % 2 === 0 ? TILE_FLOOR_A : TILE_FLOOR_B
    case TileType.WOOD_FLOOR:
      return (col + row) % 2 === 0 ? WOOD_FLOOR_A : WOOD_FLOOR_B
    case TileType.CARPET:
      return CARPET_COLOR
    case TileType.DOORWAY:
      return DOORWAY_COLOR
    default:
      return '#000000'
  }
}

// ── Render functions ────────────────────────────────────────────

export function renderTileGrid(
  ctx: CanvasRenderingContext2D,
  tileMap: TileTypeVal[][],
  offsetX: number,
  offsetY: number,
): void {
  const s = TILE_SIZE * SCALE
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      ctx.fillStyle = getTileColor(tileMap[r][c], c, r)
      ctx.fillRect(offsetX + c * s, offsetY + r * s, s, s)
    }
  }
}

interface ZDrawable {
  zY: number
  draw: (ctx: CanvasRenderingContext2D) => void
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureInstance[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
): void {
  const drawables: ZDrawable[] = []

  // Furniture
  for (const f of furniture) {
    const cached = getCachedSprite(f.sprite)
    drawables.push({
      zY: f.zY,
      draw: (c) => {
        c.drawImage(cached, offsetX + f.x * SCALE, offsetY + f.y * SCALE)
      },
    })
  }

  // Characters
  for (const ch of characters) {
    const sprites = getCharacterSprites(ch.palette)
    const spriteData = getCharacterSprite(ch, sprites)
    const cached = getCachedSprite(spriteData)
    // Anchor at bottom-center of character
    const drawX = offsetX + ch.x * SCALE - cached.width / 2
    const drawY = offsetY + ch.y * SCALE - cached.height
    drawables.push({
      zY: ch.y, // sort by feet position
      draw: (c) => {
        c.drawImage(cached, drawX, drawY)
      },
    })
  }

  // Sort by Y (lower = in front = drawn later)
  drawables.sort((a, b) => a.zY - b.zY)

  for (const d of drawables) {
    d.draw(ctx)
  }
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  tileMap: TileTypeVal[][],
  furniture: FurnitureInstance[],
  characters: Character[],
): { offsetX: number; offsetY: number } {
  // Clear
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  // Center map in viewport
  const mapW = MAP_COLS * TILE_SIZE * SCALE
  const mapH = MAP_ROWS * TILE_SIZE * SCALE
  const offsetX = Math.floor((canvasWidth - mapW) / 2)
  const offsetY = Math.floor((canvasHeight - mapH) / 2)

  // Draw tiles
  renderTileGrid(ctx, tileMap, offsetX, offsetY)

  // Draw furniture + characters (z-sorted)
  renderScene(ctx, furniture, characters, offsetX, offsetY)

  return { offsetX, offsetY }
}
