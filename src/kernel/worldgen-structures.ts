import { blockIdOf, type BlockId } from './block-registry'
import type { Chunk } from './chunk'
import type { DimensionId } from './dimensions'
import { integerInRange, unitHash } from './worldgen-random'
import type { ChunkCoord } from './coordinates'
import type { BlockType } from './block-type'

export const STRUCTURE_TYPES = ['village', 'desert_temple', 'nether_fortress', 'end_city'] as const
export type StructureType = (typeof STRUCTURE_TYPES)[number]

export type StructureBlock = Readonly<{
  position: Readonly<{ lx: number; ly: number; lz: number }>
  block: BlockId
}>

export type Structure = Readonly<{
  type: StructureType
  origin: Readonly<{ lx: number; ly: number; lz: number }>
  blocks: ReadonlyArray<StructureBlock>
}>

export type StructureGeneration =
  | Readonly<{ kind: 'generated'; structure: Structure }>
  | Readonly<{ kind: 'none'; reason: 'not-selected' | 'invalid-input' }>

export type StructureGenerationInput = Readonly<{
  seed: number
  dimension: DimensionId
  chunk: Chunk
  surfaceY: number
}>

const OVERWORLD_STRUCTURE_THRESHOLD = 0.2

export const structureTypeFor = (
  seed: number,
  dimension: DimensionId,
  chunk: ChunkCoord,
): StructureType | undefined => {
  if (!Number.isSafeInteger(seed)) {
    return undefined
  }
  const roll = unitHash(seed, chunk.cx, chunk.cz, 7)
  if (dimension === 'nether') {
    return roll < 0.35 ? 'nether_fortress' : undefined
  }
  if (dimension === 'the_end') {
    return roll < 0.2 ? 'end_city' : undefined
  }
  if (roll >= OVERWORLD_STRUCTURE_THRESHOLD) {
    return undefined
  }
  return integerInRange(seed, 0, 1, chunk.cx, chunk.cz, 8) === 0 ? 'village' : 'desert_temple'
}

const BLUEPRINTS: Readonly<Record<StructureType, ReadonlyArray<Readonly<{ dx: number; dy: number; dz: number; block: BlockType }>>>> = {
  village: [
    { dx: 0, dy: 0, dz: 0, block: 'oak_planks' },
    { dx: 1, dy: 0, dz: 0, block: 'oak_planks' },
    { dx: 0, dy: 1, dz: 0, block: 'oak_log' },
  ],
  desert_temple: [
    { dx: 0, dy: 0, dz: 0, block: 'sandstone' },
    { dx: 1, dy: 0, dz: 0, block: 'sandstone' },
    { dx: 0, dy: 1, dz: 0, block: 'sandstone' },
  ],
  nether_fortress: [
    { dx: 0, dy: 0, dz: 0, block: 'nether_brick' },
    { dx: 1, dy: 0, dz: 0, block: 'nether_brick' },
    { dx: 0, dy: 1, dz: 0, block: 'nether_brick' },
  ],
  end_city: [
    { dx: 0, dy: 0, dz: 0, block: 'purpur_block' },
    { dx: 1, dy: 0, dz: 0, block: 'purpur_block' },
    { dx: 0, dy: 1, dz: 0, block: 'purpur_block' },
  ],
}

export const generateStructure = (input: StructureGenerationInput): StructureGeneration => {
  if (!Number.isSafeInteger(input.seed) || !Number.isSafeInteger(input.surfaceY)) {
    return { kind: 'none', reason: 'invalid-input' }
  }
  const type = structureTypeFor(input.seed, input.dimension, input.chunk.position)
  if (type === undefined) {
    return { kind: 'none', reason: 'not-selected' }
  }
  const origin = { lx: 2, ly: input.surfaceY, lz: 2 }
  const blocks = BLUEPRINTS[type].map(({ dx, dy, dz, block }) => ({
    position: { lx: origin.lx + dx, ly: origin.ly + dy, lz: origin.lz + dz },
    block: blockIdOf(block),
  }))
  return { kind: 'generated', structure: { type, origin, blocks } }
}
