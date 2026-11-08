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

export class LightGridError {
  public readonly _tag = 'LightGridError'
  public readonly name = 'LightGridError'
  public readonly code: LightGridErrorCode
  public readonly message: string

  constructor(code: LightGridErrorCode, message: string) {
    this.code = code
    this.message = message
  }
}

const assertLightGrid = (grid: unknown): LightGrid | LightGridError => {
  if (!(grid instanceof Uint8Array)) {
    return new LightGridError('invalid-grid', 'light grid must be a Uint8Array')
  }
  if (grid.length !== LIGHT_BYTE_LENGTH) {
    return new LightGridError(
      'invalid-grid',
      `light grid must contain exactly ${LIGHT_BYTE_LENGTH} bytes: ${grid.length}`,
    )
  }
  return grid
}

const assertVoxelIndex = (voxel: number): number | LightGridError => {
  if (!Number.isInteger(voxel) || voxel < 0 || voxel >= CHUNK_VOLUME) {
    return new LightGridError(
      'invalid-voxel',
      `voxel index must be an integer from 0 to ${CHUNK_VOLUME - 1}: ${voxel}`,
    )
  }
  return voxel
}

export const clampLightLevel = (value: number): number =>
  Math.min(LIGHT_LEVEL_MAX, Math.max(LIGHT_LEVEL_MIN, Math.trunc(value)))

export const createLightGrid = (): LightGrid => new Uint8Array(LIGHT_BYTE_LENGTH)

export const createChunkLight = (): ChunkLight => ({
  sky: createLightGrid(),
  block: createLightGrid(),
})

/** Even voxel indices occupy the low nibble; odd indices occupy the high nibble. */
export const getLightAt = (grid: LightGrid, voxel: number): number | LightGridError => {
  const checkedGrid = assertLightGrid(grid)
  if (checkedGrid instanceof LightGridError) return checkedGrid

  const checkedVoxel = assertVoxelIndex(voxel)
  if (checkedVoxel instanceof LightGridError) return checkedVoxel

  const byte = checkedGrid[checkedVoxel >> 1]!
  return (checkedVoxel & 1) === 0 ? byte & 0x0f : (byte >> 4) & 0x0f
}

export const setLightAt = (grid: LightGrid, voxel: number, level: number): void | LightGridError => {
  const checkedGrid = assertLightGrid(grid)
  if (checkedGrid instanceof LightGridError) return checkedGrid

  const checkedVoxel = assertVoxelIndex(voxel)
  if (checkedVoxel instanceof LightGridError) return checkedVoxel

  const index = checkedVoxel >> 1
  const byte = checkedGrid[index]!
  const clamped = clampLightLevel(level)
  checkedGrid[index] = (checkedVoxel & 1) === 0 ? (byte & 0xf0) | clamped : (byte & 0x0f) | (clamped << 4)
}

export const cloneLightGrid = (grid: LightGrid): LightGrid | LightGridError => {
  const checkedGrid = assertLightGrid(grid)
  if (checkedGrid instanceof LightGridError) return checkedGrid
  return checkedGrid.slice()
}
