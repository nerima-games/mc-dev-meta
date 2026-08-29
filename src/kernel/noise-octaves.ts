import type { NoiseFn2D } from './noise-perlin'

export const normalizeNoise = (value: number): number => (value + 1) / 2

export const clampSigned = (value: number): number => (value < -1 ? -1 : value > 1 ? 1 : value)

export type OctaveParams = {
  readonly octaves: number
  readonly persistence: number
  readonly lacunarity: number
}

export const DEFAULT_OCTAVE_PARAMS: OctaveParams = {
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
}

export const octaveNoise2D = (noiseFn: NoiseFn2D, x: number, z: number, params: OctaveParams): number => {
  if (params.octaves < 1) {
    return 0.5
  }

  let total = 0
  let amplitude = 1
  let frequency = 1
  let maxValue = 0
  for (let octave = 0; octave < params.octaves; octave += 1) {
    total += noiseFn(x * frequency, z * frequency) * amplitude
    maxValue += amplitude
    amplitude *= params.persistence
    frequency *= params.lacunarity
  }
  return normalizeNoise(clampSigned(total / maxValue))
}

export const signedFbm2D = (noiseFn: NoiseFn2D, params: OctaveParams): NoiseFn2D => {
  let amplitudeSum = 0
  let amplitude = 1
  for (let octave = 0; octave < Math.max(params.octaves, 0); octave += 1) {
    amplitudeSum += amplitude
    amplitude *= params.persistence
  }

  if (amplitudeSum === 0) {
    return () => 0
  }

  const scale = 1 / amplitudeSum
  return (x, z) => {
    let total = 0
    let sampleAmplitude = 1
    let frequency = 1
    for (let octave = 0; octave < params.octaves; octave += 1) {
      total += noiseFn(x * frequency, z * frequency) * sampleAmplitude
      sampleAmplitude *= params.persistence
      frequency *= params.lacunarity
    }
    return clampSigned(total * scale)
  }
}
