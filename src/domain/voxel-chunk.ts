/**
 * Portable voxel chunk data and its fixed wire representation.
 *
 * The contract follows mc-kernel's one-byte BlockId and mc-worldgen's
 * Y-major 16×256×16 layout. It has no runtime package dependency so that the
 * workspace binder can remain bootstrappable before the game workspace exists.
 */

declare const blockIdBrand: unique symbol
declare const chunkAxisBrand: unique symbol

export type BlockId = number & { readonly [blockIdBrand]: 'BlockId' }
export type ChunkAxis = number & { readonly [chunkAxisBrand]: 'ChunkAxis' }

export type ChunkCoord = {
  readonly cx: ChunkAxis
  readonly cz: ChunkAxis
}

export type VoxelChunk = {
  readonly coord: ChunkCoord
  readonly blocks: Uint8Array
}

export const CHUNK_CODEC_MAGIC = 'MCCH'
export const CHUNK_CODEC_VERSION = 1
export const CHUNK_SIZE_XZ = 16
export const CHUNK_HEIGHT = 256
export const CHUNK_VOLUME = CHUNK_SIZE_XZ * CHUNK_HEIGHT * CHUNK_SIZE_XZ
export const CHUNK_CODEC_HEADER_BYTES = CHUNK_CODEC_MAGIC.length + 1 + 8 + 8
export const CHUNK_CODEC_BYTE_LENGTH = CHUNK_CODEC_HEADER_BYTES + CHUNK_VOLUME
export const BLOCK_ID_MAX = 0xff
export const AIR_BLOCK_ID = 0 as BlockId

export type VoxelChunkErrorCode = 'invalid-value' | 'invalid-format' | 'truncated' | 'trailing-data'

export class VoxelChunkError extends Error {
  constructor(
    public readonly code: VoxelChunkErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'VoxelChunkError'
  }
}

const MAGIC_BYTES = [0x4d, 0x43, 0x43, 0x48] as const

export const blockId = (value: number): BlockId => {
  if (!Number.isInteger(value) || value < 0 || value > BLOCK_ID_MAX) {
    throw new VoxelChunkError('invalid-value', `block id must be an integer from 0 to ${BLOCK_ID_MAX}: ${value}`)
  }
  return value as BlockId
}

export const chunkCoord = (cx: number, cz: number): ChunkCoord => {
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) {
    throw new VoxelChunkError('invalid-value', `chunk coordinates must be safe integers: (${cx}, ${cz})`)
  }
  return { cx: normalizeZero(cx) as ChunkAxis, cz: normalizeZero(cz) as ChunkAxis }
}

const normalizeZero = (value: number): number => (value === 0 ? 0 : value)

function assertBlockBuffer(blocks: unknown): asserts blocks is Uint8Array {
  if (!(blocks instanceof Uint8Array)) {
    throw new VoxelChunkError('invalid-value', 'chunk blocks must be a Uint8Array')
  }
  if (blocks.length !== CHUNK_VOLUME) {
    throw new VoxelChunkError(
      'invalid-value',
      `chunk blocks must contain exactly ${CHUNK_VOLUME} bytes: ${blocks.length}`,
    )
  }
}

function assertChunk(chunk: unknown): asserts chunk is VoxelChunk {
  if (typeof chunk !== 'object' || chunk === null) {
    throw new VoxelChunkError('invalid-value', 'chunk must be an object')
  }

  const candidate = chunk as { readonly blocks?: unknown; readonly coord?: unknown }
  assertBlockBuffer(candidate.blocks)
  if (typeof candidate.coord !== 'object' || candidate.coord === null) {
    throw new VoxelChunkError('invalid-value', 'chunk coord must be an object')
  }

  const candidateCoord = candidate.coord as { readonly cx?: unknown; readonly cz?: unknown }
  if (typeof candidateCoord.cx !== 'number' || typeof candidateCoord.cz !== 'number') {
    throw new VoxelChunkError('invalid-value', 'chunk coordinates must be numbers')
  }
  chunkCoord(candidateCoord.cx, candidateCoord.cz)
}

export const createChunk = (coord: ChunkCoord): VoxelChunk => ({
  coord,
  blocks: new Uint8Array(CHUNK_VOLUME),
})

/** The buffer is retained as a live view for high-throughput generation and meshing. */
export const createChunkFromBlocks = (coord: ChunkCoord, blocks: Uint8Array): VoxelChunk => {
  assertBlockBuffer(blocks)
  return { coord, blocks }
}

const assertLocalCoordinate = (value: number, axis: string, limit: number): void => {
  if (!Number.isInteger(value) || value < 0 || value >= limit) {
    throw new VoxelChunkError('invalid-value', `${axis} must be an integer from 0 to ${limit - 1}: ${value}`)
  }
}

/** Y-major layout kept byte-for-byte compatible with mc-worldgen's chunk index. */
export const blockIndex = (x: number, y: number, z: number): number => {
  assertLocalCoordinate(x, 'x', CHUNK_SIZE_XZ)
  assertLocalCoordinate(y, 'y', CHUNK_HEIGHT)
  assertLocalCoordinate(z, 'z', CHUNK_SIZE_XZ)
  return y + z * CHUNK_HEIGHT + x * CHUNK_HEIGHT * CHUNK_SIZE_XZ
}

export const readBlockAt = (chunk: VoxelChunk, x: number, y: number, z: number): BlockId =>
  chunk.blocks[blockIndex(x, y, z)] as BlockId

export const setBlockAt = (chunk: VoxelChunk, x: number, y: number, z: number, value: BlockId): void => {
  chunk.blocks[blockIndex(x, y, z)] = blockId(value)
}

export const encodeChunk = (chunk: VoxelChunk): Uint8Array => {
  assertChunk(chunk)
  const encoded = new Uint8Array(CHUNK_CODEC_BYTE_LENGTH)
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)

  view.setUint8(0, MAGIC_BYTES[0])
  view.setUint8(1, MAGIC_BYTES[1])
  view.setUint8(2, MAGIC_BYTES[2])
  view.setUint8(3, MAGIC_BYTES[3])
  view.setUint8(4, CHUNK_CODEC_VERSION)
  view.setBigInt64(5, BigInt(chunk.coord.cx), true)
  view.setBigInt64(13, BigInt(chunk.coord.cz), true)
  encoded.set(chunk.blocks, CHUNK_CODEC_HEADER_BYTES)
  return encoded
}

function assertEncodedBuffer(encoded: unknown): asserts encoded is Uint8Array {
  if (!(encoded instanceof Uint8Array)) {
    throw new VoxelChunkError('invalid-value', 'encoded chunk must be a Uint8Array')
  }
}

export const decodeChunk = (encoded: Uint8Array): VoxelChunk => {
  assertEncodedBuffer(encoded)
  if (encoded.length < CHUNK_CODEC_BYTE_LENGTH) {
    throw new VoxelChunkError('truncated', `chunk payload is shorter than ${CHUNK_CODEC_BYTE_LENGTH} bytes`)
  }
  if (encoded.length > CHUNK_CODEC_BYTE_LENGTH) {
    throw new VoxelChunkError('trailing-data', `chunk payload must be exactly ${CHUNK_CODEC_BYTE_LENGTH} bytes`)
  }
  if (
    encoded[0] !== MAGIC_BYTES[0] ||
    encoded[1] !== MAGIC_BYTES[1] ||
    encoded[2] !== MAGIC_BYTES[2] ||
    encoded[3] !== MAGIC_BYTES[3]
  ) {
    throw new VoxelChunkError('invalid-format', `chunk payload magic must be ${CHUNK_CODEC_MAGIC}`)
  }
  if (encoded[4] !== CHUNK_CODEC_VERSION) {
    throw new VoxelChunkError('invalid-format', `unsupported chunk codec version: ${encoded[4]}`)
  }

  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  const cx = Number(view.getBigInt64(5, true))
  const cz = Number(view.getBigInt64(13, true))
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) {
    throw new VoxelChunkError('invalid-value', 'encoded chunk coordinates exceed JavaScript safe integer range')
  }

  return createChunkFromBlocks(chunkCoord(cx, cz), encoded.slice(CHUNK_CODEC_HEADER_BYTES))
}
