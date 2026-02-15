import { MAP_COLS, MAP_ROWS, TileType } from '../types.js'
import type { TileType as TileTypeVal, OfficeLayout, PlacedFurniture, FloorColor } from '../types.js'
import { getCatalogEntry, getRotatedType } from '../layout/furnitureCatalog.js'
import { getPlacementBlockedTiles } from '../layout/layoutSerializer.js'

/** Paint a single tile with pattern and color. Returns new layout (immutable). */
export function paintTile(layout: OfficeLayout, col: number, row: number, tileType: TileTypeVal, color?: FloorColor): OfficeLayout {
  const idx = row * layout.cols + col
  if (idx < 0 || idx >= layout.tiles.length) return layout

  const existingColors = layout.tileColors || new Array(layout.tiles.length).fill(null)
  const newColor = color ?? (tileType === TileType.WALL ? null : { h: 0, s: 0, b: 0, c: 0 })

  // Check if anything actually changed
  if (layout.tiles[idx] === tileType) {
    const existingColor = existingColors[idx]
    if (newColor === null && existingColor === null) return layout
    if (newColor && existingColor &&
      newColor.h === existingColor.h && newColor.s === existingColor.s &&
      newColor.b === existingColor.b && newColor.c === existingColor.c &&
      !!newColor.colorize === !!existingColor.colorize) return layout
  }

  const tiles = [...layout.tiles]
  tiles[idx] = tileType
  const tileColors = [...existingColors]
  tileColors[idx] = newColor
  return { ...layout, tiles, tileColors }
}

/** Place furniture. Returns new layout (immutable). */
export function placeFurniture(layout: OfficeLayout, item: PlacedFurniture): OfficeLayout {
  if (!canPlaceFurniture(layout, item.type, item.col, item.row)) return layout
  return { ...layout, furniture: [...layout.furniture, item] }
}

/** Remove furniture by uid. Returns new layout (immutable). */
export function removeFurniture(layout: OfficeLayout, uid: string): OfficeLayout {
  const filtered = layout.furniture.filter((f) => f.uid !== uid)
  if (filtered.length === layout.furniture.length) return layout
  return { ...layout, furniture: filtered }
}

/** Move furniture to new position. Returns new layout (immutable). */
export function moveFurniture(layout: OfficeLayout, uid: string, newCol: number, newRow: number): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid)
  if (!item) return layout
  if (!canPlaceFurniture(layout, item.type, newCol, newRow, uid)) return layout
  return {
    ...layout,
    furniture: layout.furniture.map((f) => (f.uid === uid ? { ...f, col: newCol, row: newRow } : f)),
  }
}

/** Rotate furniture to the next orientation. Returns new layout (immutable). */
export function rotateFurniture(layout: OfficeLayout, uid: string, direction: 'cw' | 'ccw'): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid)
  if (!item) return layout
  const newType = getRotatedType(item.type, direction)
  if (!newType) return layout
  return {
    ...layout,
    furniture: layout.furniture.map((f) => (f.uid === uid ? { ...f, type: newType } : f)),
  }
}

/** For wall items, offset the row so the bottom row aligns with the hovered tile. */
export function getWallPlacementRow(type: string, row: number): number {
  const entry = getCatalogEntry(type)
  if (!entry?.canPlaceOnWalls) return row
  return row - (entry.footprintH - 1)
}

/** Check if furniture can be placed at (col, row) without overlapping. */
export function canPlaceFurniture(
  layout: OfficeLayout,
  type: string, // FurnitureType enum or asset ID
  col: number,
  row: number,
  excludeUid?: string,
): boolean {
  const entry = getCatalogEntry(type)
  if (!entry) return false

  // Check bounds — wall items may extend above the map (top rows hang above the wall)
  if (entry.canPlaceOnWalls) {
    const bottomRow = row + entry.footprintH - 1
    if (col < 0 || col + entry.footprintW > MAP_COLS || bottomRow < 0 || bottomRow >= MAP_ROWS) {
      return false
    }
  } else {
    if (col < 0 || row < 0 || col + entry.footprintW > MAP_COLS || row + entry.footprintH > MAP_ROWS) {
      return false
    }
  }

  // Wall placement check (background rows skip this check)
  const bgRows = entry.backgroundTiles || 0
  for (let dr = 0; dr < entry.footprintH; dr++) {
    if (dr < bgRows) continue
    if (row + dr < 0) continue // row above map (wall items extending upward)
    for (let dc = 0; dc < entry.footprintW; dc++) {
      const idx = (row + dr) * layout.cols + (col + dc)
      const isWall = layout.tiles[idx] === TileType.WALL
      if (entry.canPlaceOnWalls) {
        // Wall items: only the bottom row must be on wall tiles
        if (dr === entry.footprintH - 1 && !isWall) return false
      } else {
        // Normal items cannot overlap walls
        if (isWall) return false
      }
    }
  }

  // Build occupied set excluding the item being moved, skipping background tile rows
  const occupied = getPlacementBlockedTiles(layout.furniture, excludeUid)

  // If this item can be placed on surfaces, build set of desk tiles to exclude from collision
  let deskTiles: Set<string> | null = null
  if (entry.canPlaceOnSurfaces) {
    deskTiles = new Set<string>()
    for (const item of layout.furniture) {
      if (item.uid === excludeUid) continue
      const itemEntry = getCatalogEntry(item.type)
      if (!itemEntry || !itemEntry.isDesk) continue
      for (let dr = 0; dr < itemEntry.footprintH; dr++) {
        for (let dc = 0; dc < itemEntry.footprintW; dc++) {
          deskTiles.add(`${item.col + dc},${item.row + dr}`)
        }
      }
    }
  }

  // Check overlap — also skip the NEW item's own background rows
  const newBgRows = entry.backgroundTiles || 0
  for (let dr = 0; dr < entry.footprintH; dr++) {
    if (dr < newBgRows) continue // new item's background rows can overlap existing items
    if (row + dr < 0) continue // row above map (wall items extending upward)
    for (let dc = 0; dc < entry.footprintW; dc++) {
      const key = `${col + dc},${row + dr}`
      if (occupied.has(key) && !(deskTiles?.has(key))) return false
    }
  }

  return true
}
