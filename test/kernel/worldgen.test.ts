import { describe, expect, it } from 'vitest'
import { BIOME_TYPES, BIOME_TREE_DENSITY, biomeAt, surfaceOf } from '../../src/kernel/biome'
import { DIMENSIONS, dimensionRulesOf, isYInDimension } from '../../src/kernel/dimensions'
import { blockIdOf, blockTypeOf, type BlockId } from '../../src/kernel/block-registry'
import { createChunk, createChunkBounds, getBlockAt, setBlockAt } from '../../src/kernel/chunk'
import { chunkCoord } from '../../src/kernel/coordinates'
import { DEFAULT_ORE_RULES, placeOre } from '../../src/kernel/ore-placement'
import { generateStructure, structureTypeFor } from '../../src/kernel/worldgen-structures'
import { integerInRange, unitHash } from '../../src/kernel/worldgen-random'
import {
  placeTree,
  treeCellCandidate,
  TREE_CROWN_RADIUS,
  TREE_GRID_SIZE,
} from '../../src/kernel/tree-placement'

const climate = (overrides: Partial<{
  temperature: number
  humidity: number
  continentalness: number
  erosion: number
  weirdness: number
}> = {}) => ({
  temperature: 0,
  humidity: 0,
  continentalness: 0,
  erosion: 0,
  weirdness: 0,
  ...overrides,
})

const bounds = createChunkBounds(0, 32)!

describe('kernel world generation contracts', () => {
  it('selects biomes and exposes their surfaces', () => {
    expect(biomeAt(climate({ continentalness: -0.65 }))).toBe('ocean')
    expect(biomeAt(climate({ temperature: -0.55 }))).toBe('snowy_plains')
    expect(biomeAt(climate({ temperature: 0.75, humidity: -0.1 }))).toBe('desert')
    expect(biomeAt(climate({ temperature: 0.2, humidity: 0.7 }))).toBe('swamp')
    expect(biomeAt(climate({ humidity: 0.45 }))).toBe('forest')
    expect(biomeAt(climate({ temperature: 0.2, erosion: -0.4 }))).toBe('taiga')
    expect(biomeAt(climate())).toBe('plains')

    for (const biome of BIOME_TYPES) {
      const surface = surfaceOf(biome)
      expect(surface.top).toEqual(expect.any(String))
      expect(surface.filler).toEqual(expect.any(String))
      expect(surface.underwater).toEqual(expect.any(String))
      expect(surface.seaLevel).toBeGreaterThanOrEqual(0)
      expect(BIOME_TREE_DENSITY[biome]).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps seeded random values deterministic and bounded', () => {
    const first = unitHash(42, -3, 7, 11)
    expect(unitHash(42, -3, 7, 11)).toBe(first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(1)
    expect(unitHash(Number.MAX_SAFE_INTEGER, 0)).toBeGreaterThanOrEqual(0)
    expect(integerInRange(42, -2, 2, 1, 2)).toBeGreaterThanOrEqual(-2)
    expect(integerInRange(42, -2, 2, 1, 2)).toBeLessThanOrEqual(2)
  })

  it('describes dimension boundaries and rules', () => {
    expect(DIMENSIONS).toStrictEqual(['overworld', 'nether', 'the_end'])
    expect(dimensionRulesOf('overworld')).toMatchObject({ minY: -64, maxYExclusive: 320, hasSky: true })
    expect(dimensionRulesOf('nether')).toMatchObject({ hasCeiling: true, coordinateScale: 8 })
    expect(dimensionRulesOf('the_end')).toMatchObject({ minY: 0, maxYExclusive: 256 })
    expect(dimensionRulesOf('invalid')).toBeUndefined()
    expect(isYInDimension('overworld', -64)).toBe(true)
    expect(isYInDimension('overworld', 320)).toBe(false)
    expect(isYInDimension('the_end', 0)).toBe(true)
    expect(isYInDimension('the_end', -1)).toBe(false)
    expect(isYInDimension('invalid', 0)).toBe(false)
    expect(isYInDimension('overworld', 1.5)).toBe(false)
  })

  it('places ore only in valid host blocks', () => {
    const stoneChunk = createChunk(chunkCoord(0, 0), bounds, blockIdOf('stone'))
    const rule = { ...DEFAULT_ORE_RULES[0]!, attempts: 12, veinSize: 4, minY: 0, maxYExclusive: 32 }
    const placements = placeOre({ seed: 123, chunk: stoneChunk, rule })
    expect(placements.length).toBeGreaterThan(0)
    expect(placements.every(({ block, position }) =>
      blockTypeOf(block) === 'coal_ore' && getBlockAt(stoneChunk, position) === blockIdOf('stone'))).toBe(true)
    expect(placeOre({ seed: Number.NaN, chunk: stoneChunk, rule })).toStrictEqual([])
    expect(placeOre({ seed: 1, chunk: stoneChunk, rule: { ...rule, host: [] } })).toStrictEqual([])
    expect(placeOre({ seed: 1, chunk: stoneChunk, rule: { ...rule, block: 'air' } })).toStrictEqual([])
    expect(placeOre({ seed: 1, chunk: stoneChunk, rule: { ...rule, veinSize: 0 } })).toStrictEqual([])
    expect(placeOre({ seed: 1, chunk: stoneChunk, rule: { ...rule, attempts: 0 } })).toStrictEqual([])
    expect(placeOre({ seed: 1, chunk: stoneChunk, rule: { ...rule, minY: 32, maxYExclusive: 0 } })).toStrictEqual([])

    const dirtChunk = createChunk(chunkCoord(0, 0), bounds, blockIdOf('dirt'))
    expect(placeOre({ seed: 1, chunk: dirtChunk, rule })).toStrictEqual([])
    const invalidBlockChunk = {
      ...stoneChunk,
      blocks: stoneChunk.blocks.with(0, 255 as BlockId),
    }
    expect(placeOre({ seed: 1, chunk: invalidBlockChunk, rule })).toStrictEqual(
      expect.not.arrayContaining([expect.objectContaining({ position: { lx: 0, ly: 0, lz: 0 } })]),
    )
  })

  it('places deterministic trees on replaceable terrain', () => {
    let chunk = createChunk(chunkCoord(0, 0), bounds)
    for (let lx = 0; lx < 16; lx += 1) {
      for (let lz = 0; lz < 16; lz += 1) {
        chunk = setBlockAt(chunk, { lx, ly: 0, lz }, blockIdOf('dirt'))
      }
    }
    const seed = Array.from({ length: 500 }, (_, index) => index).find((candidate) =>
      placeTree({ seed: candidate, chunk, biome: 'forest', baseY: 1 }).length > 0)
    expect(seed).toBeDefined()
    const placements = placeTree({ seed: seed!, chunk, biome: 'forest', baseY: 1 })
    expect(placements.length).toBeGreaterThan(0)
    expect(placements.some(({ block }) => block === blockIdOf('oak_log'))).toBe(true)
    expect(placements.some(({ block }) => block === blockIdOf('oak_leaves'))).toBe(true)
    expect(placeTree({ seed: seed!, chunk, biome: 'ocean', baseY: 1 })).toStrictEqual([])
    expect(placeTree({ seed: Number.NaN, chunk, biome: 'forest', baseY: 1 })).toStrictEqual([])
    expect(placeTree({ seed: seed!, chunk, biome: 'forest', baseY: 1.5 })).toStrictEqual([])

    const candidate = treeCellCandidate(seed!, 0, 0, 0, 0)
    expect(candidate.x).toBeGreaterThanOrEqual(2)
    expect(candidate.x).toBeLessThan(TREE_GRID_SIZE)
    expect(candidate.z).toBeGreaterThanOrEqual(2)
    expect(candidate.z).toBeLessThan(TREE_GRID_SIZE)
    expect(TREE_CROWN_RADIUS).toBe(2)

    let blocked = chunk
    for (let lx = 0; lx < 16; lx += 1) {
      for (let lz = 0; lz < 16; lz += 1) {
        blocked = setBlockAt(blocked, { lx, ly: 1, lz }, blockIdOf('stone'))
      }
    }
    expect(placeTree({ seed: seed!, chunk: blocked, biome: 'forest', baseY: 1 })).toStrictEqual([])
    expect(placeTree({ seed: seed!, chunk, biome: 'forest', baseY: 0 })).toStrictEqual([])
  })

  it('generates dimension-specific structures only for selected chunks', () => {
    const chunk = createChunk(chunkCoord(0, 0), bounds)
    const findSeed = (dimension: 'overworld' | 'nether' | 'the_end') =>
      Array.from({ length: 200 }, (_, index) => index).find((seed) =>
        structureTypeFor(seed, dimension, chunk.position) !== undefined)
    const findUnselected = (dimension: 'overworld' | 'nether' | 'the_end') =>
      Array.from({ length: 200 }, (_, index) => index).find((seed) =>
        structureTypeFor(seed, dimension, chunk.position) === undefined)

    expect(structureTypeFor(Number.NaN, 'overworld', chunk.position)).toBeUndefined()
    const overworldSeed = findSeed('overworld')!
    const netherSeed = findSeed('nether')!
    const endSeed = findSeed('the_end')!
    expect(structureTypeFor(overworldSeed, 'overworld', chunk.position)).toMatch(/village|desert_temple/)
    expect(structureTypeFor(netherSeed, 'nether', chunk.position)).toBe('nether_fortress')
    expect(structureTypeFor(endSeed, 'the_end', chunk.position)).toBe('end_city')
    expect(findUnselected('overworld')).toBeDefined()
    expect(findUnselected('nether')).toBeDefined()
    expect(findUnselected('the_end')).toBeDefined()

    expect(generateStructure({ seed: Number.NaN, dimension: 'overworld', chunk, surfaceY: 1 })).toStrictEqual({
      kind: 'none',
      reason: 'invalid-input',
    })
    expect(generateStructure({ seed: overworldSeed, dimension: 'overworld', chunk, surfaceY: 1 })).toMatchObject({
      kind: 'generated',
      structure: { origin: { lx: 2, ly: 1, lz: 2 }, blocks: expect.any(Array) },
    })
    const unselectedSeed = findUnselected('overworld')!
    expect(generateStructure({ seed: unselectedSeed, dimension: 'overworld', chunk, surfaceY: 1 })).toStrictEqual({
      kind: 'none',
      reason: 'not-selected',
    })
  })
})
