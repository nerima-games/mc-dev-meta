/** Portable two-grid, four-bit light storage for a voxel chunk. */

/* oxlint-disable no-bitwise -- bitwise operations encode the four-bit packed-light format. */

import { CHUNK_VOLUME } from './voxel-chunk'

export const LIGHT_LEVEL_MIN = 0
export const LIGHT_LEVEL_MAX = 15
export const LIGHT_BYTE_LENGTH = CHUNK_VOLUME / 2

export type LightGrid = Uint8Array

export type ChunkLight = {
  readonly sky: LightGrid
  readonly block: LightGrid
}

export type LightGridErrorCode = 'invalid-grid' | 'invalid-voxel'

export class LightGridError extends Error {
  constructor(
    public readonly code: LightGridErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'LightGridError'
  }
}

const assertLightGrid: (grid: unknown) => asserts grid is LightGrid = (grid: unknown): asserts grid is LightGrid => {
  if (!(grid instanceof Uint8Array)) {
    throw new LightGridError('invalid-grid', 'light grid must be a Uint8Array')
  }
  if (grid.length !== LIGHT_BYTE_LENGTH) {
    throw new LightGridError(
      'invalid-grid',
      `light grid must contain exactly ${LIGHT_BYTE_LENGTH} bytes: ${grid.length}`,
    )
  }
}

const assertVoxelIndex: (voxel: number) => void = (voxel: number): void => {
  if (!Number.isInteger(voxel) || voxel < 0 || voxel >= CHUNK_VOLUME) {
    throw new LightGridError('invalid-voxel', `voxel index must be an integer from 0 to ${CHUNK_VOLUME - 1}: ${voxel}`)
  }
}

export const clampLightLevel = (value: number): number =>
  Math.min(LIGHT_LEVEL_MAX, Math.max(LIGHT_LEVEL_MIN, Math.trunc(value)))

export const createLightGrid = (): LightGrid => new Uint8Array(LIGHT_BYTE_LENGTH)

export const createChunkLight = (): ChunkLight => ({
  sky: createLightGrid(),
  block: createLightGrid(),
})

/** Even voxel indices occupy the low nibble; odd indices occupy the high nibble. */
export const getLightAt = (grid: LightGrid, voxel: number): number => {
  assertLightGrid(grid)
  assertVoxelIndex(voxel)
  const byte = grid[voxel >> 1]!
  return (voxel & 1) === 0 ? byte & 0x0f : (byte >> 4) & 0x0f
}

export const setLightAt = (grid: LightGrid, voxel: number, level: number): void => {
  assertLightGrid(grid)
  assertVoxelIndex(voxel)
  const index = voxel >> 1
  const byte = grid[index]!
  const clamped = clampLightLevel(level)
  grid[index] = (voxel & 1) === 0 ? (byte & 0xf0) | clamped : (byte & 0x0f) | (clamped << 4)
}

export const cloneLightGrid = (grid: LightGrid): LightGrid => {
  assertLightGrid(grid)
  return grid.slice()
}
