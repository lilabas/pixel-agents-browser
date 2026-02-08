import { CharacterState, Direction, TILE_SIZE } from './types.js'
import type { Character, DeskSlot, SpriteData, TileType as TileTypeVal } from './types.js'
import type { CharacterSprites } from './sprites.js'
import { findPath } from './tileMap.js'

const WALK_SPEED = 48 // pixels per second
const IDLE_FRAME_DURATION = 0.6
const WALK_FRAME_DURATION = 0.15
const TYPE_FRAME_DURATION = 0.3
const WANDER_PAUSE_MIN = 2.0
const WANDER_PAUSE_MAX = 5.0

/** Tools that show reading animation instead of typing */
const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])

export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false
  return READING_TOOLS.has(tool)
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  }
}

/** Direction from one tile to an adjacent tile */
function directionBetween(fromCol: number, fromRow: number, toCol: number, toRow: number): Direction {
  const dc = toCol - fromCol
  const dr = toRow - fromRow
  if (dc > 0) return Direction.RIGHT
  if (dc < 0) return Direction.LEFT
  if (dr > 0) return Direction.DOWN
  return Direction.UP
}

export function createCharacter(
  id: number,
  palette: number,
  deskSlot: number,
  slot: DeskSlot,
): Character {
  const center = tileCenter(slot.chairCol, slot.chairRow)
  return {
    id,
    state: CharacterState.TYPE,
    dir: slot.facingDir,
    x: center.x,
    y: center.y,
    tileCol: slot.chairCol,
    tileRow: slot.chairRow,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    isActive: true,
    deskSlot,
  }
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  deskSlots: DeskSlot[],
  tileMap: TileTypeVal[][],
  deskTiles: Set<string>,
): void {
  ch.frameTimer += dt

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION) {
        ch.frameTimer -= TYPE_FRAME_DURATION
        ch.frame = (ch.frame + 1) % 2
      }
      // If no longer active, stand up and start wandering
      if (!ch.isActive) {
        ch.state = CharacterState.IDLE
        ch.frame = 0
        ch.frameTimer = 0
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
      }
      break
    }

    case CharacterState.IDLE: {
      if (ch.frameTimer >= IDLE_FRAME_DURATION) {
        ch.frameTimer -= IDLE_FRAME_DURATION
        ch.frame = (ch.frame + 1) % 2
      }
      // If became active, pathfind to desk chair
      if (ch.isActive) {
        const slot = deskSlots[ch.deskSlot]
        if (slot) {
          const path = findPath(ch.tileCol, ch.tileRow, slot.chairCol, slot.chairRow, tileMap, deskTiles)
          if (path.length > 0) {
            ch.path = path
            ch.moveProgress = 0
            ch.state = CharacterState.WALK
            ch.frame = 0
            ch.frameTimer = 0
          } else {
            // Already at desk or no path — sit down
            ch.state = CharacterState.TYPE
            ch.dir = slot.facingDir
            ch.frame = 0
            ch.frameTimer = 0
          }
        }
        break
      }
      // Countdown wander timer
      ch.wanderTimer -= dt
      if (ch.wanderTimer <= 0) {
        if (walkableTiles.length > 0) {
          const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)]
          const path = findPath(ch.tileCol, ch.tileRow, target.col, target.row, tileMap, deskTiles)
          if (path.length > 0) {
            ch.path = path
            ch.moveProgress = 0
            ch.state = CharacterState.WALK
            ch.frame = 0
            ch.frameTimer = 0
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
      }
      break
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION) {
        ch.frameTimer -= WALK_FRAME_DURATION
        ch.frame = (ch.frame + 1) % 4
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow)
        ch.x = center.x
        ch.y = center.y

        if (ch.isActive) {
          const slot = deskSlots[ch.deskSlot]
          if (slot && ch.tileCol === slot.chairCol && ch.tileRow === slot.chairRow) {
            ch.state = CharacterState.TYPE
            ch.dir = slot.facingDir
          } else {
            ch.state = CharacterState.IDLE
          }
        } else {
          ch.state = CharacterState.IDLE
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
        }
        ch.frame = 0
        ch.frameTimer = 0
        break
      }

      // Move toward next tile in path
      const nextTile = ch.path[0]
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row)

      ch.moveProgress += (WALK_SPEED / TILE_SIZE) * dt

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow)
      const toCenter = tileCenter(nextTile.col, nextTile.row)
      const t = Math.min(ch.moveProgress, 1)
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col
        ch.tileRow = nextTile.row
        ch.x = toCenter.x
        ch.y = toCenter.y
        ch.path.shift()
        ch.moveProgress = 0
      }

      // If became active while wandering, repath to desk
      if (ch.isActive) {
        const slot = deskSlots[ch.deskSlot]
        if (slot) {
          const lastStep = ch.path[ch.path.length - 1]
          if (!lastStep || lastStep.col !== slot.chairCol || lastStep.row !== slot.chairRow) {
            const newPath = findPath(ch.tileCol, ch.tileRow, slot.chairCol, slot.chairRow, tileMap, deskTiles)
            if (newPath.length > 0) {
              ch.path = newPath
              ch.moveProgress = 0
            }
          }
        }
      }
      break
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2]
      }
      return sprites.typing[ch.dir][ch.frame % 2]
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4]
    case CharacterState.IDLE:
      return sprites.idle[ch.dir][ch.frame % 2]
    default:
      return sprites.idle[ch.dir][0]
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
