import { FurnitureType } from '../types.js'
import type { FurnitureCatalogEntry, SpriteData } from '../types.js'
import {
  DESK_SQUARE_SPRITE,
  BOOKSHELF_SPRITE,
  PLANT_SPRITE,
  COOLER_SPRITE,
  WHITEBOARD_SPRITE,
  CHAIR_SPRITE,
  PC_SPRITE,
  LAMP_SPRITE,
} from '../sprites/spriteData.js'
import {
  TS_TABLE_WOOD_SM_VERTICAL,
  TS_CHAIR_CUSHION, TS_CHAIR_SPINNING, TS_BENCH,
  TS_WATER_COOLER, TS_FRIDGE, TS_DECO_3,
  TS_CLOCK, TS_LIBRARY_GRAY_FULL, TS_PLANT_SMALL,
  TS_PAINTING_LARGE_1, TS_PAINTING_LARGE_2,
  TS_PAINTING_SMALL_1, TS_PAINTING_SMALL_2, TS_PAINTING_SMALL_3,
} from '../sprites/tilesetSprites.js'

export interface LoadedAssetData {
  catalog: Array<{
    id: string
    label: string
    category: string
    width: number
    height: number
    footprintW: number
    footprintH: number
    isDesk: boolean
    groupId?: string
    orientation?: string  // 'front' | 'back' | 'left' | 'right'
    canPlaceOnSurfaces?: boolean
    backgroundTiles?: number
    canPlaceOnWalls?: boolean
  }>
  sprites: Record<string, SpriteData>
}

export type FurnitureCategory = 'desks' | 'chairs' | 'storage' | 'decor' | 'electronics' | 'misc'

export interface CatalogEntryWithCategory extends FurnitureCatalogEntry {
  category: FurnitureCategory
}

export const FURNITURE_CATALOG: CatalogEntryWithCategory[] = [
  // ── Original hand-drawn sprites ──
  { type: FurnitureType.DESK,       label: 'Desk',       footprintW: 2, footprintH: 2, sprite: DESK_SQUARE_SPRITE,  isDesk: true,  category: 'desks' },
  { type: FurnitureType.BOOKSHELF,  label: 'Bookshelf',  footprintW: 1, footprintH: 2, sprite: BOOKSHELF_SPRITE,    isDesk: false, category: 'storage' },
  { type: FurnitureType.PLANT,      label: 'Plant',      footprintW: 1, footprintH: 1, sprite: PLANT_SPRITE,        isDesk: false, category: 'decor' },
  { type: FurnitureType.COOLER,     label: 'Cooler',     footprintW: 1, footprintH: 1, sprite: COOLER_SPRITE,       isDesk: false, category: 'misc' },
  { type: FurnitureType.WHITEBOARD, label: 'Whiteboard', footprintW: 2, footprintH: 1, sprite: WHITEBOARD_SPRITE,   isDesk: false, category: 'decor' },
  { type: FurnitureType.CHAIR,      label: 'Chair',      footprintW: 1, footprintH: 1, sprite: CHAIR_SPRITE,        isDesk: false, category: 'chairs' },
  { type: FurnitureType.PC,         label: 'PC',         footprintW: 1, footprintH: 1, sprite: PC_SPRITE,           isDesk: false, category: 'electronics' },
  { type: FurnitureType.LAMP,       label: 'Lamp',       footprintW: 1, footprintH: 1, sprite: LAMP_SPRITE,         isDesk: false, category: 'decor' },

  // ── Tileset — Desks ──
  { type: FurnitureType.TABLE_WOOD_SM_VERTICAL, label: 'Wood Table Vertical', footprintW: 1, footprintH: 2, sprite: TS_TABLE_WOOD_SM_VERTICAL, isDesk: true, category: 'desks' },

  // ── Tileset — Chairs ──
  { type: FurnitureType.CHAIR_CUSHION,  label: 'Cushioned Chair', footprintW: 4, footprintH: 1, sprite: TS_CHAIR_CUSHION,  isDesk: false, category: 'chairs' },
  { type: FurnitureType.CHAIR_SPINNING, label: 'Spinning Chair',  footprintW: 4, footprintH: 1, sprite: TS_CHAIR_SPINNING, isDesk: false, category: 'chairs' },
  { type: FurnitureType.BENCH,          label: 'Bench',           footprintW: 1, footprintH: 1, sprite: TS_BENCH,          isDesk: false, category: 'chairs' },

  // ── Tileset — Decor ──
  { type: FurnitureType.WATER_COOLER,     label: 'Water Cooler',     footprintW: 1, footprintH: 2, sprite: TS_WATER_COOLER,     isDesk: false, category: 'decor' },
  { type: FurnitureType.FRIDGE,           label: 'Fridge',           footprintW: 1, footprintH: 2, sprite: TS_FRIDGE,           isDesk: false, category: 'decor' },
  { type: FurnitureType.DECO_3,           label: 'DECO 3',           footprintW: 2, footprintH: 2, sprite: TS_DECO_3,           isDesk: false, category: 'decor' },
  { type: FurnitureType.CLOCK,            label: 'Clock',            footprintW: 1, footprintH: 1, sprite: TS_CLOCK,            isDesk: false, category: 'decor' },
  { type: FurnitureType.LIBRARY_GRAY_FULL, label: 'Library Gray Full', footprintW: 2, footprintH: 2, sprite: TS_LIBRARY_GRAY_FULL, isDesk: false, category: 'decor' },
  { type: FurnitureType.PLANT_SMALL,      label: 'Small Plant',      footprintW: 1, footprintH: 1, sprite: TS_PLANT_SMALL,      isDesk: false, category: 'decor' },
  { type: FurnitureType.PAINTING_LARGE_1, label: 'Painting Large 1', footprintW: 2, footprintH: 1, sprite: TS_PAINTING_LARGE_1, isDesk: false, category: 'decor' },
  { type: FurnitureType.PAINTING_LARGE_2, label: 'Painting Large 2', footprintW: 2, footprintH: 1, sprite: TS_PAINTING_LARGE_2, isDesk: false, category: 'decor' },
  { type: FurnitureType.PAINTING_SMALL_1, label: 'Painting Small 1', footprintW: 1, footprintH: 1, sprite: TS_PAINTING_SMALL_1, isDesk: false, category: 'decor' },
  { type: FurnitureType.PAINTING_SMALL_2, label: 'Painting Small 2', footprintW: 1, footprintH: 1, sprite: TS_PAINTING_SMALL_2, isDesk: false, category: 'decor' },
  { type: FurnitureType.PAINTING_SMALL_3, label: 'Painting Small 3', footprintW: 1, footprintH: 1, sprite: TS_PAINTING_SMALL_3, isDesk: false, category: 'decor' },
]

// ── Rotation groups ──────────────────────────────────────────────
interface RotationGroup {
  front: string
  right: string
  back: string
  left: string
}

// Maps any member asset ID → its rotation group
const rotationGroups = new Map<string, RotationGroup>()

// Internal catalog (includes all variants for getCatalogEntry lookups)
let internalCatalog: CatalogEntryWithCategory[] | null = null

// Dynamic catalog built from loaded assets (when available)
// Only includes "front" variants for grouped items (shown in editor palette)
let dynamicCatalog: CatalogEntryWithCategory[] | null = null
let dynamicCategories: FurnitureCategory[] | null = null

/**
 * Build catalog from loaded assets. Returns true if successful.
 * Once built, all getCatalog* functions use the dynamic catalog.
 * Uses ONLY custom assets (excludes hardcoded furniture when assets are loaded).
 */
export function buildDynamicCatalog(assets: LoadedAssetData): boolean {
  if (!assets?.catalog || !assets?.sprites) return false

  // Build all entries (including non-front variants)
  const allEntries = assets.catalog.map((asset) => {
    const sprite = assets.sprites[asset.id]
    if (!sprite) {
      console.warn(`No sprite data for asset ${asset.id}`)
      return null
    }
    return {
      type: asset.id,
      label: asset.label,
      footprintW: asset.footprintW,
      footprintH: asset.footprintH,
      sprite,
      isDesk: asset.isDesk,
      category: asset.category as FurnitureCategory,
      ...(asset.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(asset.backgroundTiles ? { backgroundTiles: asset.backgroundTiles } : {}),
      ...(asset.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
    }
  }).filter((e): e is CatalogEntryWithCategory => e !== null)

  if (allEntries.length === 0) return false

  // Build rotation groups from groupId + orientation metadata
  rotationGroups.clear()
  const groupMap = new Map<string, Partial<Record<string, string>>>()
  for (const asset of assets.catalog) {
    if (asset.groupId && asset.orientation) {
      let group = groupMap.get(asset.groupId)
      if (!group) {
        group = {}
        groupMap.set(asset.groupId, group)
      }
      group[asset.orientation] = asset.id
    }
  }

  // Only register complete groups (all 4 orientations present)
  const nonFrontIds = new Set<string>()
  for (const members of groupMap.values()) {
    if (members.front && members.right && members.back && members.left) {
      const rg: RotationGroup = {
        front: members.front,
        right: members.right,
        back: members.back,
        left: members.left,
      }
      rotationGroups.set(rg.front, rg)
      rotationGroups.set(rg.right, rg)
      rotationGroups.set(rg.back, rg)
      rotationGroups.set(rg.left, rg)
      // Track non-front IDs to exclude from visible catalog
      nonFrontIds.add(rg.right)
      nonFrontIds.add(rg.back)
      nonFrontIds.add(rg.left)
    }
  }

  // Store full internal catalog (all variants — for getCatalogEntry lookups)
  internalCatalog = allEntries

  // Visible catalog: exclude non-front variants of rotation groups
  const visibleEntries = allEntries.filter((e) => !nonFrontIds.has(e.type))

  // Strip orientation suffix from labels for front variants in groups
  for (const entry of visibleEntries) {
    if (rotationGroups.has(entry.type)) {
      entry.label = entry.label.replace(/ - Front$/, '')
    }
  }

  dynamicCatalog = visibleEntries
  dynamicCategories = Array.from(new Set(visibleEntries.map((e) => e.category)))
    .filter((c): c is FurnitureCategory => !!c)
    .sort()

  console.log(`✓ Built dynamic catalog with ${allEntries.length} assets (${visibleEntries.length} visible, ${rotationGroups.size / 4} rotation groups)`)
  return true
}

export function getCatalogEntry(type: string): CatalogEntryWithCategory | undefined {
  // Check internal catalog first (includes all variants, e.g., non-front rotations)
  if (internalCatalog) {
    return internalCatalog.find((e) => e.type === type)
  }
  const catalog = dynamicCatalog || FURNITURE_CATALOG
  return catalog.find((e) => e.type === type)
}

export function getCatalogByCategory(category: FurnitureCategory): CatalogEntryWithCategory[] {
  const catalog = dynamicCatalog || FURNITURE_CATALOG
  return catalog.filter((e) => e.category === category)
}

export function getActiveCatalog(): CatalogEntryWithCategory[] {
  return dynamicCatalog || FURNITURE_CATALOG
}

export function getActiveCategories(): Array<{ id: FurnitureCategory; label: string }> {
  const categories = dynamicCategories || (FURNITURE_CATEGORIES.map((c) => c.id) as FurnitureCategory[])
  return FURNITURE_CATEGORIES.filter((c) => categories.includes(c.id))
}

export const FURNITURE_CATEGORIES: Array<{ id: FurnitureCategory; label: string }> = [
  { id: 'desks', label: 'Desks' },
  { id: 'chairs', label: 'Chairs' },
  { id: 'storage', label: 'Storage' },
  { id: 'electronics', label: 'Tech' },
  { id: 'decor', label: 'Decor' },
  { id: 'misc', label: 'Misc' },
]

// ── Rotation helpers ─────────────────────────────────────────────

/** Returns the next asset ID in the rotation group (cw or ccw), or null if not rotatable. */
export function getRotatedType(currentType: string, direction: 'cw' | 'ccw'): string | null {
  const group = rotationGroups.get(currentType)
  if (!group) return null
  const order = [group.front, group.right, group.back, group.left]
  const idx = order.indexOf(currentType)
  if (idx === -1) return null
  const step = direction === 'cw' ? 1 : -1
  const nextIdx = (idx + step + 4) % 4
  return order[nextIdx]
}

/** Returns true if the given furniture type is part of a rotation group. */
export function isRotatable(type: string): boolean {
  return rotationGroups.has(type)
}
