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
} from '../src/domain/light-grid'
import { CHUNK_VOLUME } from '../src/domain/voxel-chunk'

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
    expect(clone).not.toBe(original)
    expect(clone).toStrictEqual(original)

    setLightAt(clone, 0, 3)
    expect(getLightAt(original, 0)).toBe(11)
    expect(getLightAt(clone, 0)).toBe(3)
  })

  it('rejects malformed grids and voxel indices', () => {
    expect(() => getLightAt([] as never, 0)).toThrowError(
      expect.objectContaining({ code: 'invalid-grid' }),
    )
    expect(() => cloneLightGrid(new Uint8Array(0))).toThrowError(LightGridError)
    expect(() => setLightAt(createLightGrid(), 0.5, 1)).toThrowError(
      expect.objectContaining({ code: 'invalid-voxel' }),
    )
    expect(() => getLightAt(createLightGrid(), -1)).toThrowError(/0 to 65535/)
    expect(() => getLightAt(createLightGrid(), CHUNK_VOLUME)).toThrowError(LightGridError)
  })
})
