import {
  DEFAULT_OCTAVE_PARAMS,
  normalizeNoise,
  octaveNoise2D,
  signedFbm2D,
  type OctaveParams,
} from './noise-octaves'
import { createPerlinNoise2D, createPerlinNoise3D, type NoiseFn2D, type NoiseFn3D } from './noise-perlin'
import { deriveSeed, mulberry32, NOISE_CHANNELS, type NoiseChannel, type NoiseSeed } from './noise-seed'

export type NoiseField = {
  readonly seed: NoiseSeed
  readonly raw2d: NoiseFn2D
  readonly raw3d: NoiseFn3D
  readonly noise2d: NoiseFn2D
  readonly noise3d: NoiseFn3D
  readonly octave2d: (x: number, z: number, params?: OctaveParams) => number
  readonly channel: (name: NoiseChannel) => NoiseFn2D
}

export const CHANNEL_PARAMS: Readonly<Record<NoiseChannel, OctaveParams>> = {
  base2d: DEFAULT_OCTAVE_PARAMS,
  base3d: DEFAULT_OCTAVE_PARAMS,
  continentalness: { octaves: 4, persistence: 0.5, lacunarity: 2 },
  erosion: { octaves: 3, persistence: 0.5, lacunarity: 2 },
  weirdness: { octaves: 3, persistence: 0.5, lacunarity: 2 },
  jaggedness: { octaves: 1, persistence: 0.5, lacunarity: 2 },
}

export const createNoiseField = (seed: NoiseSeed): NoiseField => {
  const raw2d = createPerlinNoise2D(mulberry32(deriveSeed(seed, 'base2d')))
  const raw3d = createPerlinNoise3D(mulberry32(deriveSeed(seed, 'base3d')))
  const channels = new Map<NoiseChannel, NoiseFn2D>(
    NOISE_CHANNELS.map((name) => [
      name,
      signedFbm2D(createPerlinNoise2D(mulberry32(deriveSeed(seed, name))), CHANNEL_PARAMS[name]),
    ]),
  )
  const fallback: NoiseFn2D = () => 0
  return {
    seed,
    raw2d,
    raw3d,
    noise2d: (x, z) => normalizeNoise(raw2d(x, z)),
    noise3d: (x, y, z) => normalizeNoise(raw3d(x, y, z)),
    octave2d: (x, z, params = DEFAULT_OCTAVE_PARAMS) => octaveNoise2D(raw2d, x, z, params),
    channel: (name) => channels.get(name) ?? fallback,
  }
}
