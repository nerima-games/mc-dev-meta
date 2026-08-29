import { Brand } from 'effect'

export type NoiseSeed = number & Brand.Brand<'NoiseSeed'>

export const NoiseSeed = Brand.refined<NoiseSeed>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`NoiseSeed must be a safe integer, received ${value}`),
)

const UINT32_MODULUS = 0x1_0000_0000
const BYTE_MODULUS = 0x100

const normalizeUint32 = (value: number): number => {
  const remainder = value % UINT32_MODULUS
  return remainder < 0 ? remainder + UINT32_MODULUS : remainder
}

const combineByte = (left: number, right: number, operation: 'or' | 'xor'): number => {
  let result = 0
  let place = 1
  for (let index = 0; index < 8; index += 1) {
    const leftBit = Math.floor(left / place) % 2
    const rightBit = Math.floor(right / place) % 2
    const shouldSet = operation === 'xor' ? leftBit !== rightBit : leftBit === 1 || rightBit === 1
    if (shouldSet) {
      result += place
    }
    place *= 2
  }
  return result
}

const BYTE_XOR = new Uint8Array(BYTE_MODULUS * BYTE_MODULUS)
const BYTE_OR = new Uint8Array(BYTE_MODULUS * BYTE_MODULUS)
for (let left = 0; left < BYTE_MODULUS; left += 1) {
  for (let right = 0; right < BYTE_MODULUS; right += 1) {
    const index = left * BYTE_MODULUS + right
    BYTE_XOR[index] = combineByte(left, right, 'xor')
    BYTE_OR[index] = combineByte(left, right, 'or')
  }
}

const byteAt = (value: number, index: number): number =>
  Math.floor(value / BYTE_MODULUS ** index) % BYTE_MODULUS

const xorUint32 = (left: number, right: number): number => {
  let result = 0
  let place = 1
  for (let index = 0; index < 4; index += 1) {
    const leftByte = byteAt(left, index)
    const rightByte = byteAt(right, index)
    result += BYTE_XOR[leftByte * BYTE_MODULUS + rightByte]! * place
    place *= BYTE_MODULUS
  }
  return result
}

const orLowByte = (value: number, mask: number): number => {
  const lowByte = value % BYTE_MODULUS
  return value - lowByte + BYTE_OR[lowByte * BYTE_MODULUS + mask]!
}

export const toUint32 = (seed: NoiseSeed): number => normalizeUint32(seed)

export type RandFn = () => number

export const CHANNEL_SALT = {
  base2d: 0x9e3779b1,
  base3d: 0x9e3779b9,
  continentalness: 0xbb67ae85,
  erosion: 0x3c6ef372,
  weirdness: 0xa54ff53a,
  jaggedness: 0x510e527f,
} as const satisfies Readonly<Record<string, number>>

export type NoiseChannel = keyof typeof CHANNEL_SALT

export const NOISE_CHANNELS: ReadonlyArray<NoiseChannel> = Object.keys(
  CHANNEL_SALT,
) as ReadonlyArray<NoiseChannel>

export const deriveSeed = (seed: NoiseSeed, channel: NoiseChannel): NoiseSeed =>
  NoiseSeed(xorUint32(toUint32(seed), CHANNEL_SALT[channel]))

export const mulberry32 = (seed: NoiseSeed): RandFn => {
  let state = toUint32(seed)
  return () => {
    state = normalizeUint32(state + 0x6d2b79f5)
    let value = state
    value = normalizeUint32(
      Math.imul(xorUint32(value, Math.floor(value / 0x8000)), value % 2 === 0 ? value + 1 : value),
    )
    value = xorUint32(
      value,
      normalizeUint32(
        value + Math.imul(xorUint32(value, Math.floor(value / 0x80)), orLowByte(value, 61)),
      ),
    )
    return xorUint32(value, Math.floor(value / 0x4000)) / UINT32_MODULUS
  }
}
