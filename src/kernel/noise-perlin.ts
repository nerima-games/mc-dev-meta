import type { RandFn } from './noise-seed'

export const PERMUTATION_SIZE = 256

const AMPLITUDE_SCALE_2D = Math.SQRT2
const AMPLITUDE_SCALE_3D = Math.sqrt(3)

export type NoiseFn2D = (x: number, z: number) => number
export type NoiseFn3D = (x: number, y: number, z: number) => number

export const buildPermutation = (rand: RandFn): Uint8Array => {
  const permutation = new Uint8Array(PERMUTATION_SIZE)
  for (let index = 0; index < PERMUTATION_SIZE; index += 1) {
    permutation[index] = index
  }
  for (let index = PERMUTATION_SIZE - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(rand() * (index + 1))
    const held = permutation[index]!
    permutation[index] = permutation[swapWith]!
    permutation[swapWith] = held
  }
  return permutation
}

const fade = (value: number): number => value * value * value * (value * (value * 6 - 15) + 10)

const lerp = (from: number, to: number, amount: number): number => from + amount * (to - from)

const wrapPermutationIndex = (value: number): number => {
  const remainder = value % PERMUTATION_SIZE
  return remainder < 0 ? remainder + PERMUTATION_SIZE : remainder
}

const GRADIENTS_2D = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const

const gradient2d = (hash: number, x: number, z: number): number => {
  const gradient = GRADIENTS_2D[hash % 4]!
  return gradient[0] * x + gradient[1] * z
}

const GRADIENTS_3D = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
] as const

const gradient3d = (hash: number, x: number, y: number, z: number): number => {
  const gradient = GRADIENTS_3D[hash % 16]!
  return gradient[0] * x + gradient[1] * y + gradient[2] * z
}

export const createPerlinNoise2D = (rand: RandFn): NoiseFn2D => {
  const permutation = buildPermutation(rand)

  return (x, z) => {
    const cellX = wrapPermutationIndex(Math.floor(x))
    const cellZ = wrapPermutationIndex(Math.floor(z))
    const fracX = x - Math.floor(x)
    const fracZ = z - Math.floor(z)
    const easedX = fade(fracX)
    const easedZ = fade(fracZ)
    const rowA = wrapPermutationIndex(permutation[cellX]! + cellZ)
    const rowB = wrapPermutationIndex(permutation[wrapPermutationIndex(cellX + 1)]! + cellZ)
    const bottom = lerp(
      gradient2d(permutation[rowA]!, fracX, fracZ),
      gradient2d(permutation[rowB]!, fracX - 1, fracZ),
      easedX,
    )
    const top = lerp(
      gradient2d(permutation[wrapPermutationIndex(rowA + 1)]!, fracX, fracZ - 1),
      gradient2d(permutation[wrapPermutationIndex(rowB + 1)]!, fracX - 1, fracZ - 1),
      easedX,
    )
    return lerp(bottom, top, easedZ) * AMPLITUDE_SCALE_2D
  }
}

export const createPerlinNoise3D = (rand: RandFn): NoiseFn3D => {
  const permutation = buildPermutation(rand)
  const at = (index: number): number => permutation[wrapPermutationIndex(index)]!

  return (x, y, z) => {
    const cellX = wrapPermutationIndex(Math.floor(x))
    const cellY = wrapPermutationIndex(Math.floor(y))
    const cellZ = wrapPermutationIndex(Math.floor(z))
    const fracX = x - Math.floor(x)
    const fracY = y - Math.floor(y)
    const fracZ = z - Math.floor(z)
    const easedX = fade(fracX)
    const easedY = fade(fracY)
    const easedZ = fade(fracZ)
    const a = at(cellX) + cellY
    const aa = at(a) + cellZ
    const ab = at(a + 1) + cellZ
    const b = at(cellX + 1) + cellY
    const ba = at(b) + cellZ
    const bb = at(b + 1) + cellZ
    const value = lerp(
      lerp(
        lerp(gradient3d(at(aa), fracX, fracY, fracZ), gradient3d(at(ba), fracX - 1, fracY, fracZ), easedX),
        lerp(
          gradient3d(at(ab), fracX, fracY - 1, fracZ),
          gradient3d(at(bb), fracX - 1, fracY - 1, fracZ),
          easedX,
        ),
        easedY,
      ),
      lerp(
        lerp(
          gradient3d(at(aa + 1), fracX, fracY, fracZ - 1),
          gradient3d(at(ba + 1), fracX - 1, fracY, fracZ - 1),
          easedX,
        ),
        lerp(
          gradient3d(at(ab + 1), fracX, fracY - 1, fracZ - 1),
          gradient3d(at(bb + 1), fracX - 1, fracY - 1, fracZ - 1),
          easedX,
        ),
        easedY,
      ),
      easedZ,
    )
    return value * AMPLITUDE_SCALE_3D
  }
}
