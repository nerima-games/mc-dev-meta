import {
  AIR_BLOCK_ID,
  blockTypeOf,
  toBlockId,
  type BlockId,
} from './block-registry'
import {
  createChunk,
  createChunkBounds,
  type Chunk,
  chunkVolume,
} from './chunk'
import { chunkCoord } from './coordinates'

const MAGIC = [0x4d, 0x43, 0x43, 0x48] as const
const VERSION = 1
export const CHUNK_HEADER_BYTES = 25
const MAX_CHUNK_HEIGHT = 4096
const MAX_CHUNK_BLOCKS = 16 * 16 * MAX_CHUNK_HEIGHT

export type ChunkEncodeResult =
  | Readonly<{ kind: 'encoded'; bytes: Uint8Array }>
  | Readonly<{
      kind: 'invalid'
      reason: 'invalid-position' | 'invalid-bounds' | 'invalid-block-count' | 'invalid-block'
    }>

export type ChunkDecodeResult =
  | Readonly<{ kind: 'decoded'; chunk: Chunk }>
  | Readonly<{
      kind: 'invalid'
      reason:
        | 'truncated'
        | 'invalid-magic'
        | 'unsupported-version'
        | 'invalid-bounds'
        | 'invalid-block-count'
        | 'invalid-length'
        | 'invalid-block'
    }>

const isInt32 = (value: number): boolean =>
  Number.isInteger(value) && value >= -0x8000_0000 && value <= 0x7fff_ffff

const validBounds = (minY: number, maxYExclusive: number): boolean =>
  isInt32(minY) &&
  isInt32(maxYExclusive) &&
  maxYExclusive > minY &&
  maxYExclusive - minY <= MAX_CHUNK_HEIGHT

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const hasMagic = (bytes: Uint8Array): boolean =>
  bytes[0] === MAGIC[0] &&
  bytes[1] === MAGIC[1] &&
  bytes[2] === MAGIC[2] &&
  bytes[3] === MAGIC[3]

export const encodeChunk = (chunk: Chunk): ChunkEncodeResult => {
  if (!isInt32(chunk.position.cx) || !isInt32(chunk.position.cz)) {
    return { kind: 'invalid', reason: 'invalid-position' }
  }
  if (!validBounds(chunk.bounds.minY, chunk.bounds.maxYExclusive)) {
    return { kind: 'invalid', reason: 'invalid-bounds' }
  }
  const volume = chunkVolume(chunk.bounds)
  if (volume > MAX_CHUNK_BLOCKS || chunk.blocks.length !== volume) {
    return { kind: 'invalid', reason: 'invalid-block-count' }
  }
  for (const block of chunk.blocks) {
    if (blockTypeOf(block) === undefined) {
      return { kind: 'invalid', reason: 'invalid-block' }
    }
  }

  const bytes = new Uint8Array(CHUNK_HEADER_BYTES + volume * 2)
  const view = viewOf(bytes)
  MAGIC.forEach((value, index) => {
    bytes[index] = value
  })
  view.setUint8(4, VERSION)
  view.setInt32(5, chunk.position.cx)
  view.setInt32(9, chunk.position.cz)
  view.setInt32(13, chunk.bounds.minY)
  view.setInt32(17, chunk.bounds.maxYExclusive)
  view.setUint32(21, volume)
  chunk.blocks.forEach((block, index) => {
    view.setUint16(CHUNK_HEADER_BYTES + index * 2, block)
  })
  return { kind: 'encoded', bytes }
}

export const decodeChunk = (bytes: Uint8Array): ChunkDecodeResult => {
  if (bytes.byteLength < CHUNK_HEADER_BYTES) {
    return { kind: 'invalid', reason: 'truncated' }
  }
  if (!hasMagic(bytes)) {
    return { kind: 'invalid', reason: 'invalid-magic' }
  }
  const view = viewOf(bytes)
  if (view.getUint8(4) !== VERSION) {
    return { kind: 'invalid', reason: 'unsupported-version' }
  }

  const cx = view.getInt32(5)
  const cz = view.getInt32(9)
  const minY = view.getInt32(13)
  const maxYExclusive = view.getInt32(17)
  const blockCount = view.getUint32(21)
  if (!validBounds(minY, maxYExclusive)) {
    return { kind: 'invalid', reason: 'invalid-bounds' }
  }
  if (blockCount > MAX_CHUNK_BLOCKS) {
    return { kind: 'invalid', reason: 'invalid-block-count' }
  }
  const expectedLength = CHUNK_HEADER_BYTES + blockCount * 2
  if (bytes.byteLength !== expectedLength) {
    return { kind: 'invalid', reason: 'invalid-length' }
  }

  const blocks: Array<BlockId> = []
  for (let index = 0; index < blockCount; index += 1) {
    const rawBlock = view.getUint16(CHUNK_HEADER_BYTES + index * 2)
    if (blockTypeOf(rawBlock) === undefined) {
      return { kind: 'invalid', reason: 'invalid-block' }
    }
    blocks.push(toBlockId(rawBlock) ?? AIR_BLOCK_ID)
  }
  const bounds = createChunkBounds(minY, maxYExclusive)
  if (bounds === undefined) {
    return { kind: 'invalid', reason: 'invalid-bounds' }
  }
  const chunk = createChunk(chunkCoord(cx, cz), bounds)
  return { kind: 'decoded', chunk: { ...chunk, blocks } }
}
