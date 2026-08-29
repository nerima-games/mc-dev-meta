import { describe, expect, it } from 'vitest'
import { blockIdOf, type BlockId } from '../../src/kernel/block-registry'
import { createChunk, createChunkBounds, setBlockAt } from '../../src/kernel/chunk'
import { chunkCoord } from '../../src/kernel/coordinates'
import { type BlockType } from '../../src/kernel/block-type'
import {
  ambientOcclusion,
  MESH_FACES,
  meshChunk,
} from '../../src/kernel/mesh'
import type { RenderKind } from '../../src/kernel/block-properties'

const bounds = createChunkBounds(0, 1)
if (bounds === undefined) {
  throw new Error('test bounds must be valid')
}

const emptyChunk = () => createChunk(chunkCoord(0, 0), bounds)

const withBlocks = (
  initial = emptyChunk(),
  placements: ReadonlyArray<Readonly<{ lx: number; ly: number; lz: number; type: BlockType }>> = [],
) => placements.reduce(
  (chunk, placement) => setBlockAt(chunk, placement, blockIdOf(placement.type)),
  initial,
)

describe('chunk meshing', () => {
  it('meshes cube faces and culls opaque neighbors', () => {
    const single = meshChunk(withBlocks(undefined, [{ lx: 0, ly: 0, lz: 0, type: 'stone' }]))
    expect(single.chunk).toEqual({ cx: 0, cz: 0 })
    expect(single.quads.map(({ face }) => face)).toEqual([...MESH_FACES])
    expect(single.quads.every(({ kind }) => kind === 'cube')).toBe(true)
    expect(single.quads.every(({ vertices }) => vertices.length === 4)).toBe(true)

    const withOpaqueNeighbor = meshChunk(withBlocks(undefined, [
      { lx: 0, ly: 0, lz: 0, type: 'stone' },
      { lx: 1, ly: 0, lz: 0, type: 'stone' },
    ]))
    expect(withOpaqueNeighbor.quads).toHaveLength(10)
    expect(withOpaqueNeighbor.quads.some(({ position, face }) =>
      position.lx === 0 && face === 'east')).toBe(false)

    const withTransparentNeighbor = meshChunk(withBlocks(undefined, [
      { lx: 0, ly: 0, lz: 0, type: 'stone' },
      { lx: 1, ly: 0, lz: 0, type: 'glass' },
    ]))
    expect(withTransparentNeighbor.quads).toHaveLength(11)
  })

  it('calculates ambient occlusion for all blocker combinations', () => {
    expect(ambientOcclusion(false, false, false)).toBe(3)
    expect(ambientOcclusion(true, false, false)).toBe(2)
    expect(ambientOcclusion(false, true, true)).toBe(1)
    expect(ambientOcclusion(true, true, false)).toBe(0)

    const shaded = meshChunk(withBlocks(undefined, [
      { lx: 1, ly: 0, lz: 1, type: 'stone' },
      { lx: 0, ly: 0, lz: 1, type: 'stone' },
      { lx: 1, ly: 0, lz: 0, type: 'stone' },
    ]))
    expect(shaded.quads.some(({ vertices }) => vertices.some(({ ao }) => ao < 3))).toBe(true)

    const invalidNeighbor = withBlocks(undefined, [
      { lx: 0, ly: 0, lz: 0, type: 'stone' },
    ])
    const invalidBlocks = {
      ...invalidNeighbor,
      blocks: invalidNeighbor.blocks.with(1, 255 as BlockId),
    }
    expect(meshChunk(invalidBlocks).quads).toHaveLength(6)
  })

  it('uses each block render geometry and fluid occlusion rule', () => {
    const cases: ReadonlyArray<Readonly<{ type: BlockType; kind: RenderKind; count: number }>> = [
      { type: 'cobweb', kind: 'cross', count: 2 },
      { type: 'rail', kind: 'rail', count: 1 },
      { type: 'lily_pad', kind: 'lilyPad', count: 1 },
      { type: 'cactus', kind: 'cactus', count: 6 },
      { type: 'water', kind: 'fluid', count: 6 },
      { type: 'end_portal', kind: 'none', count: 0 },
    ]

    for (const { type, kind, count } of cases) {
      const quads = meshChunk(withBlocks(undefined, [{ lx: 0, ly: 0, lz: 0, type }])).quads
      expect(quads).toHaveLength(count)
      expect(quads.every((quad) => quad.kind === kind)).toBe(true)
      expect(quads.every(({ vertices }) => vertices.length === 4)).toBe(true)
    }

    const cactus = meshChunk(withBlocks(undefined, [{ lx: 0, ly: 0, lz: 0, type: 'cactus' }])).quads
    expect(cactus.every(({ vertices }) => vertices.every(({ x, z }) =>
      x >= 1 / 16 && x <= 15 / 16 && z >= 1 / 16 && z <= 15 / 16))).toBe(true)

    const water = meshChunk(withBlocks(undefined, [{ lx: 0, ly: 0, lz: 0, type: 'water' }])).quads
    expect(water.every(({ vertices }) => vertices.every(({ y }) => y <= 7 / 8))).toBe(true)

    const waterAndWater = meshChunk(withBlocks(undefined, [
      { lx: 0, ly: 0, lz: 0, type: 'water' },
      { lx: 1, ly: 0, lz: 0, type: 'water' },
    ]))
    expect(waterAndWater.quads).toHaveLength(10)

    const waterAndLava = meshChunk(withBlocks(undefined, [
      { lx: 0, ly: 0, lz: 0, type: 'water' },
      { lx: 1, ly: 0, lz: 0, type: 'lava' },
    ]))
    expect(waterAndLava.quads).toHaveLength(10)
  })
})
