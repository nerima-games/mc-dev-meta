import { describe, expect, it } from 'vitest'
import {
  chunkCount,
  chunkVolume,
  createChunk,
  createChunkBounds,
  createChunkStore,
  getBlockAt,
  getChunk,
  getWorldBlockAt,
  putChunk,
  removeChunk,
  setBlockAt,
} from '../../src/kernel/chunk'
import { AIR_BLOCK_ID, blockIdOf } from '../../src/kernel/block-registry'
import { blockPosition, chunkCoord } from '../../src/kernel/coordinates'

const local = (lx: number, ly: number, lz: number) => ({ lx, ly, lz })

describe('kernel chunks', () => {
  it('validates bounds and computes volume', () => {
    expect(createChunkBounds(-64, 320)).toStrictEqual({ minY: -64, maxYExclusive: 320 })
    expect(createChunkBounds(0, 0)).toBeUndefined()
    expect(createChunkBounds(1, 0)).toBeUndefined()
    expect(createChunkBounds(0.5, 2)).toBeUndefined()
    expect(createChunkBounds(0, Number.MAX_SAFE_INTEGER + 1)).toBeUndefined()
    const bounds = createChunkBounds(-64, 320)
    expect(bounds).toBeDefined()
    expect(chunkVolume(bounds!)).toBe(16 * 16 * 384)
  })

  it('reads and immutably updates local and world blocks', () => {
    const bounds = createChunkBounds(-64, 320)!
    const position = chunkCoord(-1, 2)
    const stone = blockIdOf('stone')
    const dirt = blockIdOf('dirt')
    const chunk = createChunk(position, bounds)
    expect(chunk.blocks).toHaveLength(16 * 16 * 384)
    expect(getBlockAt(chunk, local(0, -64, 0))).toBe(AIR_BLOCK_ID)
    expect(getBlockAt(chunk, local(15, 319, 15))).toBe(AIR_BLOCK_ID)
    expect(getBlockAt(chunk, local(-1, 0, 0))).toBeUndefined()
    expect(getBlockAt(chunk, local(0, -65, 0))).toBeUndefined()
    expect(getBlockAt(chunk, local(0, 320, 0))).toBeUndefined()
    expect(getBlockAt(chunk, local(0, 0, 16))).toBeUndefined()
    expect(getWorldBlockAt(chunk, blockPosition(-16, -64, 32))).toBe(AIR_BLOCK_ID)
    expect(getWorldBlockAt(chunk, blockPosition(0, 0, 32))).toBeUndefined()
    expect(setBlockAt(chunk, local(0, -65, 0), stone)).toBe(chunk)
    expect(setBlockAt(chunk, local(0, -64, 0), AIR_BLOCK_ID)).toBe(chunk)
    const changed = setBlockAt(chunk, local(0, -64, 0), stone)
    expect(changed).not.toBe(chunk)
    expect(getBlockAt(changed, local(0, -64, 0))).toBe(stone)
    expect(getBlockAt(chunk, local(0, -64, 0))).toBe(AIR_BLOCK_ID)
    expect(getWorldBlockAt(changed, blockPosition(-16, -64, 32))).toBe(stone)
    expect(setBlockAt(changed, local(0, -64, 0), dirt)).not.toBe(changed)
    const filled = createChunk(position, bounds, dirt)
    expect(getBlockAt(filled, local(1, 1, 1))).toBe(dirt)
  })

  it('stores chunks with persistent map operations', () => {
    const bounds = createChunkBounds(0, 16)!
    const position = chunkCoord(0, 0)
    const chunk = createChunk(position, bounds)
    const store = createChunkStore()
    expect(chunkCount(store)).toBe(0)
    expect(getChunk(store, position)).toBeUndefined()
    const withChunk = putChunk(store, chunk)
    expect(chunkCount(withChunk)).toBe(1)
    expect(getChunk(withChunk, position)).toBe(chunk)
    expect(chunkCount(store)).toBe(0)
    expect(removeChunk(store, position)).toBe(store)
    const removed = removeChunk(withChunk, position)
    expect(removed).not.toBe(withChunk)
    expect(chunkCount(removed)).toBe(0)
  })
})
