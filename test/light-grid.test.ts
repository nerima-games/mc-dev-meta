import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  clampLightLevel,
  cloneLightGrid,
  createChunkLight,
  createLightGrid,
  getLightAt,
  LIGHT_BYTE_LENGTH,
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
  LightGridError,
  setLightAt,
  type LightGrid,
  type LightGridErrorCode,
} from '../src/domain/light-grid'
import { CHUNK_VOLUME } from '../src/domain/voxel-chunk'

const expectLightGrid: (value: LightGrid | LightGridError) => asserts value is LightGrid = (value) => {
  expect(value).not.toBeInstanceOf(LightGridError)
}

const expectLightGridFailure = (value: unknown, code: LightGridErrorCode): void => {
  expect(value).toBeInstanceOf(LightGridError)
  if (value instanceof LightGridError) {
    expect(value._tag).toBe('LightGridError')
    expect(value.name).toBe('LightGridError')
    expect(value.code).toBe(code)
  }
}

describe('portable packed light storage', () => {
  it('creates separate zeroed sky and block grids', () => {
    const light = createChunkLight()

    expect(LIGHT_LEVEL_MIN).toBe(0)
    expect(LIGHT_LEVEL_MAX).toBe(15)
    expect(LIGHT_BYTE_LENGTH).toBe(CHUNK_VOLUME / 2)
    expect(light.sky).toHaveLength(LIGHT_BYTE_LENGTH)
    expect(light.block).toHaveLength(LIGHT_BYTE_LENGTH)
    expect(light.sky).not.toBe(light.block)
    expect(getLightAt(light.sky, 0)).toBe(0)
    expect(getLightAt(light.block, CHUNK_VOLUME - 1)).toBe(0)
  })

  it('packs even and odd voxels without touching the neighboring nibble', () => {
    const grid = createLightGrid()
    grid[0] = 0xa0

    setLightAt(grid, 0, 7)
    expect(grid[0]).toBe(0xa7)
    expect(getLightAt(grid, 0)).toBe(7)

    setLightAt(grid, 1, 9)
    expect(grid[0]).toBe(0x97)
    expect(getLightAt(grid, 1)).toBe(9)
  })

  it('truncates and clamps levels before packing', () => {
    const grid = createLightGrid()

    setLightAt(grid, 0, -1)
    setLightAt(grid, 1, 99)
    setLightAt(grid, 2, 8.9)

    expect(getLightAt(grid, 0)).toBe(LIGHT_LEVEL_MIN)
    expect(getLightAt(grid, 1)).toBe(LIGHT_LEVEL_MAX)
    expect(getLightAt(grid, 2)).toBe(8)
    expect(clampLightLevel(-Infinity)).toBe(LIGHT_LEVEL_MIN)
    expect(clampLightLevel(Infinity)).toBe(LIGHT_LEVEL_MAX)
  })

  it('clones a valid grid without sharing its backing buffer', () => {
    const original = createLightGrid()
    setLightAt(original, 0, 11)

    const clone = cloneLightGrid(original)
    expectLightGrid(clone)
    expect(clone).not.toBe(original)
    expect(clone).toStrictEqual(original)

    setLightAt(clone, 0, 3)
    expect(getLightAt(original, 0)).toBe(11)
    expect(getLightAt(clone, 0)).toBe(3)
  })

  it('rejects malformed grids and voxel indices', () => {
    const nonGrid = getLightAt([] as never, 0)
    expect(nonGrid).toBeInstanceOf(LightGridError)
    expect(nonGrid).toMatchObject({
      _tag: 'LightGridError',
      code: 'invalid-grid',
      message: 'light grid must be a Uint8Array',
    })

    const nonGridWrite = setLightAt([] as never, 0, 1)
    expect(nonGridWrite).toBeInstanceOf(LightGridError)
    expect(nonGridWrite).toMatchObject({
      _tag: 'LightGridError',
      name: 'LightGridError',
      code: 'invalid-grid',
      message: 'light grid must be a Uint8Array',
    })

    const wrongLength = cloneLightGrid(new Uint8Array(0))
    expect(wrongLength).toBeInstanceOf(LightGridError)
    expect(wrongLength).toMatchObject({
      code: 'invalid-grid',
      message: `light grid must contain exactly ${LIGHT_BYTE_LENGTH} bytes: 0`,
    })

    const fractionalIndex = setLightAt(createLightGrid(), 0.5, 1)
    expect(fractionalIndex).toBeInstanceOf(LightGridError)
    expect(fractionalIndex).toMatchObject({
      _tag: 'LightGridError',
      code: 'invalid-voxel',
      message: `voxel index must be an integer from 0 to ${CHUNK_VOLUME - 1}: 0.5`,
    })

    expect(getLightAt(createLightGrid(), -1)).toMatchObject({
      code: 'invalid-voxel',
      message: 'voxel index must be an integer from 0 to 65535: -1',
    })
    expect(getLightAt(createLightGrid(), CHUNK_VOLUME)).toMatchObject({
      _tag: 'LightGridError',
      code: 'invalid-voxel',
      name: 'LightGridError',
    })
  })
})

describe('packed light properties', () => {
  const validGridByte = fc.integer({ min: 0, max: 0xff })
  const invalidGrid = fc.oneof(
    fc.jsonValue(),
    fc.integer({ min: 0, max: LIGHT_BYTE_LENGTH - 1 }).map((length) => new Uint8Array(length)),
  )
  const invalidVoxel = fc.oneof(
    fc.integer({ max: -1 }),
    fc.integer({ min: CHUNK_VOLUME }),
    fc.double({ noNaN: true, noInteger: true }),
  )

  it('round-trips arbitrary valid grids, voxel indices, and light levels', async () => {
    await fc.assert(
      fc.property(
        validGridByte,
        fc.integer({ min: 0, max: CHUNK_VOLUME - 1 }),
        fc.integer({ min: LIGHT_LEVEL_MIN, max: LIGHT_LEVEL_MAX }),
        (packedByte, voxel, level) => {
          const grid = createLightGrid()
          const byteIndex = Math.floor(voxel / 2)
          grid[byteIndex] = packedByte
          const neighborVoxel = voxel % 2 === 0 ? voxel + 1 : voxel - 1
          const expectedNeighborLight = voxel % 2 === 0 ? Math.floor(packedByte / 16) : packedByte % 16
          const neighborBefore = getLightAt(grid, neighborVoxel)
          if (neighborBefore instanceof LightGridError || neighborBefore !== expectedNeighborLight) return false

          const setResult = setLightAt(grid, voxel, level)
          if (setResult instanceof LightGridError || setResult !== undefined) return false

          const value = getLightAt(grid, voxel)
          if (value instanceof LightGridError || value !== level) return false

          const neighborAfter = getLightAt(grid, neighborVoxel)
          if (neighborAfter instanceof LightGridError || neighborAfter !== expectedNeighborLight) return false

          const expectedPackedByte =
            voxel % 2 === 0
              ? packedByte - (packedByte % 16) + level
              : packedByte % 16 + level * 16

          const clone = cloneLightGrid(grid)
          return (
            !(clone instanceof LightGridError) &&
            clone instanceof Uint8Array &&
            clone.length === LIGHT_BYTE_LENGTH &&
            clone !== grid &&
            grid[byteIndex] === expectedPackedByte &&
            clone[byteIndex] === expectedPackedByte
          )
        },
      ),
      { numRuns: 100 },
    )
  })

  it('returns typed failures for arbitrary invalid grids', async () => {
    await fc.assert(
      fc.property(invalidGrid, fc.integer({ min: 0, max: CHUNK_VOLUME - 1 }), (grid, voxel) => {
        expectLightGridFailure(getLightAt(grid as never, voxel), 'invalid-grid')
        expectLightGridFailure(setLightAt(grid as never, voxel, 1), 'invalid-grid')
        expectLightGridFailure(cloneLightGrid(grid as never), 'invalid-grid')
      }),
      { numRuns: 100 },
    )
  })

  it('returns typed failures for arbitrary invalid voxel indices', async () => {
    await fc.assert(
      fc.property(invalidVoxel, (voxel) => {
        const grid = createLightGrid()
        expectLightGridFailure(getLightAt(grid, voxel), 'invalid-voxel')
        expectLightGridFailure(setLightAt(grid, voxel, 1), 'invalid-voxel')
      }),
      { numRuns: 100 },
    )
  })
})
