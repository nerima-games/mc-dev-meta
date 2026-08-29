import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE_XZ,
  LocalAxis,
  aabb,
  aabbContainsPoint,
  aabbIntersects,
  aabbOfBlock,
  blockPosition,
  blockPositionOfChunkLocal,
  blockPositionOfPosition,
  chunkCoord,
  chunkCoordOfBlock,
  chunkKey,
  isLocalBlockCoord,
  localCoordOfBlock,
  position,
} from '../../src/kernel/coordinates'

describe('kernel coordinates', () => {
  it('uses stable constructors and block quantization', () => {
    expect(CHUNK_SIZE_XZ).toBe(16)
    expect(position(1.5, 2.5, 3.5)).toStrictEqual({ x: 1.5, y: 2.5, z: 3.5 })
    expect(blockPosition(1, 2, 3)).toStrictEqual({ x: 1, y: 2, z: 3 })
    expect(blockPositionOfPosition(position(1.9, -2.1, 3))).toStrictEqual({
      x: 1,
      y: -3,
      z: 3,
    })
    expect(() => blockPosition(Number.NaN, 0, 0)).toThrow()
    expect(() => chunkCoord(1.5, 0)).toThrow()
    expect(() => LocalAxis(-1)).toThrow()
  })

  it('round-trips positions across negative chunk coordinates', () => {
    const value = blockPosition(-1, 70, -17)
    const chunk = chunkCoordOfBlock(value)
    expect(chunk).toStrictEqual({ cx: -1, cz: -2 })
    const local = localCoordOfBlock(value)
    expect(local).toStrictEqual({ lx: 15, ly: 70, lz: 15 })
    expect(blockPositionOfChunkLocal(chunk, local)).toStrictEqual(value)
    expect(chunkKey(chunk)).toBe('-1,-2')
  })

  it('validates local coordinates without constructing a compatibility object', () => {
    expect(isLocalBlockCoord({ lx: 0, ly: -64, lz: 0 })).toBe(true)
    expect(isLocalBlockCoord({ lx: 15, ly: 320, lz: 15 })).toBe(true)
    expect(isLocalBlockCoord({ lx: -1, ly: 0, lz: 0 })).toBe(false)
    expect(isLocalBlockCoord({ lx: 16, ly: 0, lz: 0 })).toBe(false)
    expect(isLocalBlockCoord({ lx: 1.5, ly: 0, lz: 0 })).toBe(false)
    expect(isLocalBlockCoord({ lx: 0, ly: Number.MAX_SAFE_INTEGER + 1, lz: 0 })).toBe(false)
    expect(isLocalBlockCoord({ lx: 0, ly: 0, lz: -1 })).toBe(false)
    expect(isLocalBlockCoord({ lx: 0, ly: 0, lz: 16 })).toBe(false)
    expect(isLocalBlockCoord({ lx: 0, ly: 0, lz: 1.5 })).toBe(false)
  })

  it('normalizes boxes and checks strict intersection', () => {
    const box = aabb(position(2, 3, 4), position(0, 1, 2))
    expect(box).toStrictEqual({ min: position(0, 1, 2), max: position(2, 3, 4) })
    expect(aabbOfBlock(blockPosition(1, 2, 3))).toStrictEqual({
      min: position(1, 2, 3),
      max: position(2, 3, 4),
    })
    expect(aabbIntersects(box, aabb(position(1, 2, 3), position(3, 4, 5)))).toBe(true)
    expect(aabbIntersects(box, aabb(position(2, 1, 2), position(3, 4, 5)))).toBe(false)
    expect(aabbIntersects(box, aabb(position(-1, 3, 2), position(1, 4, 5)))).toBe(false)
    expect(aabbIntersects(box, aabb(position(0, 0, 4), position(2, 1, 5)))).toBe(false)
    expect(aabbIntersects(box, aabb(position(0, 1, 4), position(2, 3, 5)))).toBe(false)
    expect(aabbIntersects(box, aabb(position(-2, 1, 2), position(0, 3, 4)))).toBe(false)
    expect(aabbIntersects(box, aabb(position(0, 1, 1), position(2, 3, 2)))).toBe(false)
  })

  it('checks inclusive box containment', () => {
    const box = aabb(position(0, 0, 0), position(2, 2, 2))
    expect(aabbContainsPoint(box, position(1, 1, 1))).toBe(true)
    expect(aabbContainsPoint(box, position(0, 0, 0))).toBe(true)
    expect(aabbContainsPoint(box, position(2, 2, 2))).toBe(true)
    expect(aabbContainsPoint(box, position(-1, 1, 1))).toBe(false)
    expect(aabbContainsPoint(box, position(3, 1, 1))).toBe(false)
    expect(aabbContainsPoint(box, position(1, -1, 1))).toBe(false)
    expect(aabbContainsPoint(box, position(1, 3, 1))).toBe(false)
    expect(aabbContainsPoint(box, position(1, 1, -1))).toBe(false)
    expect(aabbContainsPoint(box, position(1, 1, 3))).toBe(false)
  })
})
