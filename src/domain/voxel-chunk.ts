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

export class VoxelChunkError {
  readonly _tag = 'VoxelChunkError'
  readonly name = 'VoxelChunkError'
  readonly code: VoxelChunkErrorCode
  readonly message: string

  constructor(code: VoxelChunkErrorCode, message: string) {
    this.code = code
    this.message = message
  }
}

const MAGIC_BYTES = [0x4d, 0x43, 0x43, 0x48] as const

export const blockId = (value: number): BlockId | VoxelChunkError => {
  if (!Number.isInteger(value) || value < 0 || value > BLOCK_ID_MAX) {
    return new VoxelChunkError('invalid-value', `block id must be an integer from 0 to ${BLOCK_ID_MAX}: ${value}`)
  }
  return value as BlockId
}

export const chunkCoord = (cx: number, cz: number): ChunkCoord | VoxelChunkError => {
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) {
    return new VoxelChunkError('invalid-value', `chunk coordinates must be safe integers: (${cx}, ${cz})`)
  }
  return { cx: normalizeZero(cx) as ChunkAxis, cz: normalizeZero(cz) as ChunkAxis }
}

const normalizeZero = (value: number): number => (value === 0 ? 0 : value)

function validateBlockBuffer(blocks: unknown): Uint8Array | VoxelChunkError {
  if (!(blocks instanceof Uint8Array)) {
    return new VoxelChunkError('invalid-value', 'chunk blocks must be a Uint8Array')
  }
  if (blocks.length !== CHUNK_VOLUME) {
    return new VoxelChunkError(
      'invalid-value',
      `chunk blocks must contain exactly ${CHUNK_VOLUME} bytes: ${blocks.length}`,
    )
  }
  return blocks
}

function validateChunk(chunk: unknown): VoxelChunkError | undefined {
  if (typeof chunk !== 'object' || chunk === null) {
    return new VoxelChunkError('invalid-value', 'chunk must be an object')
  }

  const candidate = chunk as { readonly blocks?: unknown; readonly coord?: unknown }
  const blocks = validateBlockBuffer(candidate.blocks)
  if (blocks instanceof VoxelChunkError) return blocks

  if (typeof candidate.coord !== 'object' || candidate.coord === null) {
    return new VoxelChunkError('invalid-value', 'chunk coord must be an object')
  }

  const candidateCoord = candidate.coord as { readonly cx?: unknown; readonly cz?: unknown }
  if (typeof candidateCoord.cx !== 'number' || typeof candidateCoord.cz !== 'number') {
    return new VoxelChunkError('invalid-value', 'chunk coordinates must be numbers')
  }

  const coord = chunkCoord(candidateCoord.cx, candidateCoord.cz)
  return coord instanceof VoxelChunkError ? coord : undefined
}

export const createChunk = (coord: ChunkCoord): VoxelChunk => ({
  coord,
  blocks: new Uint8Array(CHUNK_VOLUME),
})

/** The buffer is retained as a live view for high-throughput generation and meshing. */
export const createChunkFromBlocks = (coord: ChunkCoord, blocks: Uint8Array): VoxelChunk | VoxelChunkError => {
  const validatedBlocks = validateBlockBuffer(blocks)
  if (validatedBlocks instanceof VoxelChunkError) return validatedBlocks
  return { coord, blocks: validatedBlocks }
}

const validateLocalCoordinate = (value: number, axis: string, limit: number): VoxelChunkError | undefined => {
  if (!Number.isInteger(value) || value < 0 || value >= limit) {
    return new VoxelChunkError('invalid-value', `${axis} must be an integer from 0 to ${limit - 1}: ${value}`)
  }
  return undefined
}

/** Y-major layout kept byte-for-byte compatible with mc-worldgen's chunk index. */
export const blockIndex = (x: number, y: number, z: number): number | VoxelChunkError => {
  const invalidX = validateLocalCoordinate(x, 'x', CHUNK_SIZE_XZ)
  if (invalidX) return invalidX

  const invalidY = validateLocalCoordinate(y, 'y', CHUNK_HEIGHT)
  if (invalidY) return invalidY

  const invalidZ = validateLocalCoordinate(z, 'z', CHUNK_SIZE_XZ)
  if (invalidZ) return invalidZ

  return y + z * CHUNK_HEIGHT + x * CHUNK_HEIGHT * CHUNK_SIZE_XZ
}

export const readBlockAt = (chunk: VoxelChunk, x: number, y: number, z: number): BlockId | VoxelChunkError => {
  const index = blockIndex(x, y, z)
  if (index instanceof VoxelChunkError) return index
  return chunk.blocks[index] as BlockId
}

export const setBlockAt = (chunk: VoxelChunk, x: number, y: number, z: number, value: BlockId): void | VoxelChunkError => {
  const index = blockIndex(x, y, z)
  if (index instanceof VoxelChunkError) return index

  const id = blockId(value)
  if (id instanceof VoxelChunkError) return id

  chunk.blocks[index] = id
}

export const encodeChunk = (chunk: VoxelChunk): Uint8Array | VoxelChunkError => {
  const invalidChunk = validateChunk(chunk)
  if (invalidChunk) return invalidChunk

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

function validateEncodedBuffer(encoded: unknown): Uint8Array | VoxelChunkError {
  if (!(encoded instanceof Uint8Array)) {
    return new VoxelChunkError('invalid-value', 'encoded chunk must be a Uint8Array')
  }
  return encoded
}

export const decodeChunk = (encoded: Uint8Array): VoxelChunk | VoxelChunkError => {
  const validatedEncoded = validateEncodedBuffer(encoded)
  if (validatedEncoded instanceof VoxelChunkError) return validatedEncoded

  if (validatedEncoded.length < CHUNK_CODEC_BYTE_LENGTH) {
    return new VoxelChunkError('truncated', `chunk payload is shorter than ${CHUNK_CODEC_BYTE_LENGTH} bytes`)
  }
  if (validatedEncoded.length > CHUNK_CODEC_BYTE_LENGTH) {
    return new VoxelChunkError('trailing-data', `chunk payload must be exactly ${CHUNK_CODEC_BYTE_LENGTH} bytes`)
  }
  if (
    validatedEncoded[0] !== MAGIC_BYTES[0] ||
    validatedEncoded[1] !== MAGIC_BYTES[1] ||
    validatedEncoded[2] !== MAGIC_BYTES[2] ||
    validatedEncoded[3] !== MAGIC_BYTES[3]
  ) {
    return new VoxelChunkError('invalid-format', `chunk payload magic must be ${CHUNK_CODEC_MAGIC}`)
  }
  if (validatedEncoded[4] !== CHUNK_CODEC_VERSION) {
    return new VoxelChunkError('invalid-format', `unsupported chunk codec version: ${validatedEncoded[4]}`)
  }

  const view = new DataView(validatedEncoded.buffer, validatedEncoded.byteOffset, validatedEncoded.byteLength)
  const cx = Number(view.getBigInt64(5, true))
  const cz = Number(view.getBigInt64(13, true))
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) {
    return new VoxelChunkError('invalid-value', 'encoded chunk coordinates exceed JavaScript safe integer range')
  }

  const coord = chunkCoord(cx, cz)
  if (coord instanceof VoxelChunkError) return coord
  return createChunkFromBlocks(coord, validatedEncoded.slice(CHUNK_CODEC_HEADER_BYTES))
}
