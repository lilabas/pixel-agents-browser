import { TileType, MAP_COLS, MAP_ROWS, TILE_SIZE, Direction } from './types.js'
import type { DeskSlot, FurnitureInstance } from './types.js'
import {
  DESK_SQUARE_SPRITE,
  PLANT_SPRITE,
  BOOKSHELF_SPRITE,
  COOLER_SPRITE,
  WHITEBOARD_SPRITE,
} from './sprites.js'

const W = TileType.WALL
const T = TileType.TILE_FLOOR
const F = TileType.WOOD_FLOOR
const C = TileType.CARPET
const D = TileType.DOORWAY

/**
 * 11 rows x 20 cols office layout.
 * Left room (cols 0-9): tile floor
 * Right room (cols 11-19): wood floor
 * Col 10: wall with doorway at rows 4-6
 * Carpet break area: bottom-right corner
 */
export function createTileMap(): TileType[][] {
  const map: TileType[][] = []

  for (let r = 0; r < MAP_ROWS; r++) {
    const row: TileType[] = []
    for (let c = 0; c < MAP_COLS; c++) {
      if (r === 0 || r === MAP_ROWS - 1) { row.push(W); continue }
      if (c === 0 || c === MAP_COLS - 1) { row.push(W); continue }
      if (c === 10) {
        row.push(r >= 4 && r <= 6 ? D : W)
        continue
      }
      if (c >= 15 && c <= 18 && r >= 7 && r <= 9) { row.push(C); continue }
      row.push(c < 10 ? T : F)
    }
    map.push(row)
  }

  return map
}

/**
 * Two 2x2 square desks, one per room. Each desk has 4 chair slots.
 *
 * Left room desk at tiles (4,3)-(5,4):
 *   Top:    chair (4,2) facing DOWN
 *   Bottom: chair (5,5) facing UP
 *   Left:   chair (3,4) facing RIGHT
 *   Right:  chair (6,3) facing LEFT
 *
 * Right room desk at tiles (13,3)-(14,4):
 *   Top:    chair (13,2) facing DOWN
 *   Bottom: chair (14,5) facing UP
 *   Left:   chair (12,4) facing RIGHT
 *   Right:  chair (15,3) facing LEFT
 */
export function createDeskSlots(): DeskSlot[] {
  return [
    // Left room desk (top-left at col=4, row=3)
    { deskCol: 4, deskRow: 3, chairCol: 4, chairRow: 2, facingDir: Direction.DOWN, assigned: false },
    { deskCol: 4, deskRow: 3, chairCol: 5, chairRow: 5, facingDir: Direction.UP, assigned: false },
    { deskCol: 4, deskRow: 3, chairCol: 3, chairRow: 4, facingDir: Direction.RIGHT, assigned: false },
    { deskCol: 4, deskRow: 3, chairCol: 6, chairRow: 3, facingDir: Direction.LEFT, assigned: false },
    // Right room desk (top-left at col=13, row=3)
    { deskCol: 13, deskRow: 3, chairCol: 13, chairRow: 2, facingDir: Direction.DOWN, assigned: false },
    { deskCol: 13, deskRow: 3, chairCol: 14, chairRow: 5, facingDir: Direction.UP, assigned: false },
    { deskCol: 13, deskRow: 3, chairCol: 12, chairRow: 4, facingDir: Direction.RIGHT, assigned: false },
    { deskCol: 13, deskRow: 3, chairCol: 15, chairRow: 3, facingDir: Direction.LEFT, assigned: false },
  ]
}

/** Get the set of tiles occupied by desks (non-walkable 2x2 blocks) */
export function getDeskTiles(deskSlots: DeskSlot[]): Set<string> {
  const tiles = new Set<string>()
  // Deduplicate desks by top-left corner
  const seen = new Set<string>()
  for (const slot of deskSlots) {
    const key = `${slot.deskCol},${slot.deskRow}`
    if (seen.has(key)) continue
    seen.add(key)
    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        tiles.add(`${slot.deskCol + dc},${slot.deskRow + dr}`)
      }
    }
  }
  return tiles
}

/** Static furniture decorations */
export function createFurniture(deskSlots: DeskSlot[]): FurnitureInstance[] {
  const furniture: FurnitureInstance[] = []

  // Square desks (deduplicate by top-left corner)
  const seenDesks = new Set<string>()
  for (const slot of deskSlots) {
    const key = `${slot.deskCol},${slot.deskRow}`
    if (seenDesks.has(key)) continue
    seenDesks.add(key)

    const deskX = slot.deskCol * TILE_SIZE
    const deskY = slot.deskRow * TILE_SIZE
    furniture.push({
      sprite: DESK_SQUARE_SPRITE,
      x: deskX,
      y: deskY,
      zY: deskY + TILE_SIZE * 2, // bottom of 2x2 desk
    })
  }

  // Decorations — left room
  furniture.push({
    sprite: BOOKSHELF_SPRITE,
    x: 1 * TILE_SIZE,
    y: 5 * TILE_SIZE,
    zY: 5 * TILE_SIZE + 32,
  })

  furniture.push({
    sprite: PLANT_SPRITE,
    x: 1 * TILE_SIZE,
    y: 1 * TILE_SIZE,
    zY: 1 * TILE_SIZE + 24,
  })

  // Decorations — right room
  furniture.push({
    sprite: COOLER_SPRITE,
    x: 17 * TILE_SIZE,
    y: 7 * TILE_SIZE,
    zY: 7 * TILE_SIZE + 24,
  })

  furniture.push({
    sprite: PLANT_SPRITE,
    x: 18 * TILE_SIZE,
    y: 1 * TILE_SIZE,
    zY: 1 * TILE_SIZE + 24,
  })

  furniture.push({
    sprite: WHITEBOARD_SPRITE,
    x: 15 * TILE_SIZE,
    y: 0 * TILE_SIZE,
    zY: 0,
  })

  return furniture
}

/** Check if a tile is walkable (floor, carpet, or doorway, and not a desk tile) */
export function isWalkable(
  col: number,
  row: number,
  tileMap: TileType[][],
  deskTiles: Set<string>,
): boolean {
  if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return false
  const t = tileMap[row][col]
  if (t === TileType.WALL) return false
  if (deskTiles.has(`${col},${row}`)) return false
  return true
}

/** Get walkable tile positions (grid coords) for wandering */
export function getWalkableTiles(
  tileMap: TileType[][],
  deskTiles: Set<string>,
): Array<{ col: number; row: number }> {
  const tiles: Array<{ col: number; row: number }> = []
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (isWalkable(c, r, tileMap, deskTiles)) {
        tiles.push({ col: c, row: r })
      }
    }
  }
  return tiles
}

/** BFS pathfinding on 4-connected grid (no diagonals). Returns path excluding start, including end. */
export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: TileType[][],
  deskTiles: Set<string>,
): Array<{ col: number; row: number }> {
  if (startCol === endCol && startRow === endRow) return []

  const key = (c: number, r: number) => `${c},${r}`
  const startKey = key(startCol, startRow)
  const endKey = key(endCol, endRow)

  // End must be walkable (or be a chair tile which may be adjacent to desk)
  // We allow the end tile even if it's not strictly walkable for chair positions
  const endWalkable = isWalkable(endCol, endRow, tileMap, deskTiles)
  if (!endWalkable) {
    // If the end is a desk tile, we still can't path there
    return []
  }

  const visited = new Set<string>()
  visited.add(startKey)

  const parent = new Map<string, string>()
  const queue: Array<{ col: number; row: number }> = [{ col: startCol, row: startRow }]

  const dirs = [
    { dc: 0, dr: -1 }, // up
    { dc: 0, dr: 1 },  // down
    { dc: -1, dr: 0 }, // left
    { dc: 1, dr: 0 },  // right
  ]

  while (queue.length > 0) {
    const curr = queue.shift()!
    const currKey = key(curr.col, curr.row)

    if (currKey === endKey) {
      // Reconstruct path
      const path: Array<{ col: number; row: number }> = []
      let k = endKey
      while (k !== startKey) {
        const [c, r] = k.split(',').map(Number)
        path.unshift({ col: c, row: r })
        k = parent.get(k)!
      }
      return path
    }

    for (const d of dirs) {
      const nc = curr.col + d.dc
      const nr = curr.row + d.dr
      const nk = key(nc, nr)

      if (visited.has(nk)) continue
      if (!isWalkable(nc, nr, tileMap, deskTiles)) continue

      visited.add(nk)
      parent.set(nk, currKey)
      queue.push({ col: nc, row: nr })
    }
  }

  // No path found
  return []
}
