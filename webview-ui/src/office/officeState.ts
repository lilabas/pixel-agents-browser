import type { Character, DeskSlot, FurnitureInstance, TileType as TileTypeVal } from './types.js'
import { createCharacter, updateCharacter } from './characters.js'
import { createTileMap, createDeskSlots, createFurniture, getWalkableTiles, getDeskTiles } from './tileMap.js'

export class OfficeState {
  tileMap: TileTypeVal[][]
  deskSlots: DeskSlot[]
  deskTiles: Set<string>
  furniture: FurnitureInstance[]
  walkableTiles: Array<{ col: number; row: number }>
  characters: Map<number, Character> = new Map()
  private nextPalette = 0

  constructor() {
    this.tileMap = createTileMap()
    this.deskSlots = createDeskSlots()
    this.deskTiles = getDeskTiles(this.deskSlots)
    this.furniture = createFurniture(this.deskSlots)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.deskTiles)
  }

  addAgent(id: number): void {
    if (this.characters.has(id)) return

    // Find first unassigned desk
    let slotIndex = -1
    for (let i = 0; i < this.deskSlots.length; i++) {
      if (!this.deskSlots[i].assigned) {
        slotIndex = i
        break
      }
    }

    if (slotIndex === -1) {
      slotIndex = 0 // fallback
    }

    this.deskSlots[slotIndex].assigned = true
    const palette = this.nextPalette % 6
    this.nextPalette++

    const ch = createCharacter(id, palette, slotIndex, this.deskSlots[slotIndex])
    this.characters.set(id, ch)
  }

  removeAgent(id: number): void {
    const ch = this.characters.get(id)
    if (!ch) return
    if (ch.deskSlot >= 0 && ch.deskSlot < this.deskSlots.length) {
      this.deskSlots[ch.deskSlot].assigned = false
    }
    this.characters.delete(id)
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.isActive = active
    }
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.currentTool = tool
    }
  }

  update(dt: number): void {
    for (const ch of this.characters.values()) {
      updateCharacter(ch, dt, this.walkableTiles, this.deskSlots, this.tileMap, this.deskTiles)
    }
  }

  getCharacters(): Character[] {
    return Array.from(this.characters.values())
  }

  /** Get character at pixel position (for hit testing). Returns id or null. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = this.getCharacters().sort((a, b) => b.y - a.y)
    for (const ch of chars) {
      // Character sprite is 16x24, anchored bottom-center
      const left = ch.x - 8
      const right = ch.x + 8
      const top = ch.y - 24
      const bottom = ch.y
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id
      }
    }
    return null
  }
}
