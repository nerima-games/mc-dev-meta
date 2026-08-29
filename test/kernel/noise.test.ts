import { describe, expect, it } from 'vitest'
import {
  buildPermutation,
  CHANNEL_PARAMS,
  clampSigned,
  createNoiseField,
  createPerlinNoise2D,
  createPerlinNoise3D,
  DEFAULT_OCTAVE_PARAMS,
  deriveSeed,
  mulberry32,
  NoiseSeed,
  NOISE_CHANNELS,
  normalizeNoise,
  octaveNoise2D,
  PERMUTATION_SIZE,
  signedFbm2D,
  toUint32,
} from '../../src/kernel'

describe('kernel seeded noise', () => {
  it('validates and derives stable uint32 seeds', () => {
    const seed = NoiseSeed(42)
    expect(toUint32(seed)).toBe(42)
    expect(toUint32(NoiseSeed(-1))).toBe(0xffffffff)
    expect(() => NoiseSeed(1.5)).toThrow()
    expect(() => NoiseSeed(Number.POSITIVE_INFINITY)).toThrow()
    expect(NOISE_CHANNELS).toStrictEqual([
      'base2d',
      'base3d',
      'continentalness',
      'erosion',
      'weirdness',
      'jaggedness',
    ])
    expect(deriveSeed(seed, 'base2d')).not.toBe(deriveSeed(seed, 'base3d'))
  })

  it('produces repeatable pseudo-random streams', () => {
    const first = mulberry32(NoiseSeed(123))
    const second = mulberry32(NoiseSeed(123))
    const values = Array.from({ length: 8 }, () => first())
    expect(values).toStrictEqual(Array.from({ length: 8 }, () => second()))
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
    expect(mulberry32(NoiseSeed(124))()).not.toBe(values[0])
  })

  it('builds a complete permutation and samples two-dimensional gradients', () => {
    const permutation = buildPermutation(mulberry32(NoiseSeed(7)))
    expect(permutation).toHaveLength(PERMUTATION_SIZE)
    expect([...permutation].sort((left, right) => left - right)).toStrictEqual(
      Array.from({ length: PERMUTATION_SIZE }, (_, index) => index),
    )

    const noise = createPerlinNoise2D(mulberry32(NoiseSeed(7)))
    const samples = [
      noise(0, 0),
      noise(0.25, 0.75),
      noise(-1.25, 2.5),
      noise(256.5, -256.5),
    ]
    expect(samples.every(Number.isFinite)).toBe(true)
    expect(samples.some((value) => value !== 0)).toBe(true)
  })

  it('samples three-dimensional gradients over negative and wrapped cells', () => {
    const noise = createPerlinNoise3D(mulberry32(NoiseSeed(11)))
    const samples = [
      noise(0, 0, 0),
      noise(0.2, 0.4, 0.6),
      noise(-1.2, 2.4, -3.6),
      noise(256.5, -256.5, 512.5),
    ]
    expect(samples.every(Number.isFinite)).toBe(true)
    expect(samples.some((value) => value !== 0)).toBe(true)
  })

  it('composes normalized and signed octave fields with bounded degenerate cases', () => {
    expect(normalizeNoise(-1)).toBe(0)
    expect(normalizeNoise(1)).toBe(1)
    expect(clampSigned(-2)).toBe(-1)
    expect(clampSigned(0.25)).toBe(0.25)
    expect(clampSigned(2)).toBe(1)

    const constant = (value: number) => () => value
    expect(octaveNoise2D(constant(0), 1, 2, { octaves: 0, persistence: 0.5, lacunarity: 2 })).toBe(0.5)
    expect(octaveNoise2D(constant(2), 1, 2, DEFAULT_OCTAVE_PARAMS)).toBe(1)
    expect(octaveNoise2D(constant(-2), 1, 2, DEFAULT_OCTAVE_PARAMS)).toBe(0)
    expect(octaveNoise2D(constant(0.5), 1, 2, { octaves: 2, persistence: 0.5, lacunarity: 2 })).toBe(0.75)

    expect(signedFbm2D(constant(2), { octaves: 2, persistence: 0.5, lacunarity: 2 })(0, 0)).toBe(1)
    expect(signedFbm2D(constant(-2), { octaves: 2, persistence: 0.5, lacunarity: 2 })(0, 0)).toBe(-1)
    expect(signedFbm2D(constant(1), { octaves: 2, persistence: 0.5, lacunarity: 2 })(0, 0)).toBe(1)
    expect(signedFbm2D(constant(1), { octaves: 0, persistence: 0.5, lacunarity: 2 })(0, 0)).toBe(0)
    expect(signedFbm2D(constant(1), { octaves: -1, persistence: 0.5, lacunarity: 2 })(0, 0)).toBe(0)
  })

  it('creates deterministic terrain channels and a safe fallback', () => {
    const first = createNoiseField(NoiseSeed(99))
    const second = createNoiseField(NoiseSeed(99))
    const other = createNoiseField(NoiseSeed(100))
    expect(first.seed).toBe(99)
    expect(first.raw2d(1.25, -2.5)).toBe(second.raw2d(1.25, -2.5))
    expect(first.raw3d(1.25, -2.5, 3.75)).toBe(second.raw3d(1.25, -2.5, 3.75))
    expect(first.noise2d(1.25, -2.5)).toBe(second.noise2d(1.25, -2.5))
    expect(first.noise3d(1.25, -2.5, 3.75)).toBe(second.noise3d(1.25, -2.5, 3.75))
    expect(first.octave2d(1.25, -2.5)).toBe(second.octave2d(1.25, -2.5))
    expect(first.octave2d(1.25, -2.5, { octaves: 0, persistence: 0.5, lacunarity: 2 })).toBe(0.5)
    expect(first.channel('continentalness')(1.25, -2.5)).toBe(second.channel('continentalness')(1.25, -2.5))
    expect(first.channel('unknown' as never)(1, 2)).toBe(0)
    expect(first.raw2d(1.25, -2.5)).not.toBe(other.raw2d(1.25, -2.5))
    expect(Object.keys(CHANNEL_PARAMS)).toStrictEqual(NOISE_CHANNELS)
  })
})
