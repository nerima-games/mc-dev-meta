import { blockCapabilitiesOf, blockIdOf, blockTypeOf } from './block-registry'
import { getBlockAt, type Chunk } from './chunk'
import type { BiomeType } from './biome'
import { BIOME_TREE_DENSITY } from './biome'
import { integerInRange, unitHash } from './worldgen-random'

export const TREE_GRID_SIZE = 8
export const TREE_CELL_JITTER_SPAN = 3
export const TREE_CELL_JITTER_ORIGIN = 2
export const TREE_CROWN_RADIUS = 2
export const TREE_MIN_SPACING = 6

export type TreeCellCandidate = Readonly<{
  cellX: number
  cellZ: number
  x: number
  z: number
  accepted: boolean
}>

export type TreePlacementInput = Readonly<{
  seed: number
  chunk: Chunk
  biome: BiomeType
  baseY: number
}>

export type TreeBlockPlacement = Readonly<{
  position: Readonly<{ lx: number; ly: number; lz: number }>
  block: ReturnType<typeof blockIdOf>
}>

export const treeCellCandidate = (
  seed: number,
  chunkX: number,
  chunkZ: number,
  cellX: number,
  cellZ: number,
): TreeCellCandidate => {
  const x = cellX * TREE_GRID_SIZE + TREE_CELL_JITTER_ORIGIN + integerInRange(seed, 0, TREE_CELL_JITTER_SPAN - 1, chunkX, chunkZ, cellX, cellZ, 1)
  const z = cellZ * TREE_GRID_SIZE + TREE_CELL_JITTER_ORIGIN + integerInRange(seed, 0, TREE_CELL_JITTER_SPAN - 1, chunkX, chunkZ, cellX, cellZ, 2)
  return { cellX, cellZ, x, z, accepted: x < 16 && z < 16 }
}

const isReplaceable = (block: number): boolean => {
  const type = blockTypeOf(block)
  return type !== undefined && blockCapabilitiesOf(type).replaceable
}

const isGround = (block: number): boolean => {
  const type = blockTypeOf(block)
  return type !== undefined && blockCapabilitiesOf(type).validSpawnSurface
}

const planTree = (
  seed: number,
  candidate: TreeCellCandidate,
  baseY: number,
): ReadonlyArray<TreeBlockPlacement> => {
  const height = 4 + integerInRange(seed, 0, 2, candidate.x, candidate.z, 3)
  const placements: Array<TreeBlockPlacement> = []
  for (let y = baseY; y < baseY + height; y += 1) {
    placements.push({ position: { lx: candidate.x, ly: y, lz: candidate.z }, block: blockIdOf('oak_log') })
  }
  for (let layer = 0; layer < 3; layer += 1) {
    const radius = layer === 2 ? 1 : TREE_CROWN_RADIUS
    const y = baseY + height - 1 + layer
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        placements.push({ position: { lx: candidate.x + dx, ly: y, lz: candidate.z + dz }, block: blockIdOf('oak_leaves') })
      }
    }
  }
  return placements
}

export const placeTree = (input: TreePlacementInput): ReadonlyArray<TreeBlockPlacement> => {
  if (!Number.isSafeInteger(input.seed) || !Number.isSafeInteger(input.baseY)) {
    return []
  }
  const density = BIOME_TREE_DENSITY[input.biome]
  if (density <= 0) {
    return []
  }

  const placements: Array<TreeBlockPlacement> = []
  for (let cellX = 0; cellX < 2; cellX += 1) {
    for (let cellZ = 0; cellZ < 2; cellZ += 1) {
      const candidate = treeCellCandidate(input.seed, input.chunk.position.cx, input.chunk.position.cz, cellX, cellZ)
      if (!candidate.accepted || unitHash(input.seed, candidate.x, candidate.z, 4) >= density) {
        continue
      }
      const ground = getBlockAt(input.chunk, { lx: candidate.x, ly: input.baseY - 1, lz: candidate.z })
      if (ground === undefined || !isGround(ground)) {
        continue
      }
      const planned = planTree(input.seed, candidate, input.baseY)
      const canPlace = planned.every(({ position }) => {
        const current = getBlockAt(input.chunk, position)
        return current !== undefined && isReplaceable(current)
      })
      if (!canPlace) {
        continue
      }
      placements.push(...planned)
    }
  }
  return placements
}
