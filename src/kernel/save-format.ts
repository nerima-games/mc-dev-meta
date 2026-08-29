import { type Chunk } from './chunk'
import { decodeChunk, encodeChunk } from './chunk-persistence'
import { chunkKey } from './coordinates'

export const SAVE_MAGIC = [0x4d, 0x43, 0x53, 0x56] as const
export const SAVE_VERSION = 1
export const SAVE_HEADER_BYTES = 25
export const SAVE_CHUNK_LENGTH_BYTES = 4
export const MAX_SAVE_CHUNKS = 4096
export const MAX_SAVE_BYTES = 64 * 1024 * 1024

export type SaveSnapshot = Readonly<{
  seed: number
  time: number
  chunks: ReadonlyArray<Chunk>
}>

export type SaveEncodeResult =
  | Readonly<{ kind: 'encoded'; bytes: Uint8Array }>
  | Readonly<{
      kind: 'invalid'
      reason: 'invalid-seed' | 'invalid-time' | 'invalid-chunk-count' | 'duplicate-chunk' | 'invalid-chunk' | 'too-large'
      chunkReason?: 'invalid-position' | 'invalid-bounds' | 'invalid-block-count' | 'invalid-block'
    }>

export type SaveDecodeResult =
  | Readonly<{ kind: 'decoded'; snapshot: SaveSnapshot }>
  | Readonly<{
      kind: 'invalid'
      reason:
        | 'truncated'
        | 'invalid-magic'
        | 'unsupported-version'
        | 'invalid-seed'
        | 'invalid-time'
        | 'invalid-chunk-count'
        | 'invalid-chunk-length'
        | 'invalid-chunk'
        | 'duplicate-chunk'
        | 'too-large'
    }>

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const hasMagic = (bytes: Uint8Array): boolean =>
  bytes[0] === SAVE_MAGIC[0] &&
  bytes[1] === SAVE_MAGIC[1] &&
  bytes[2] === SAVE_MAGIC[2] &&
  bytes[3] === SAVE_MAGIC[3]

const validSeed = (seed: number): boolean => Number.isSafeInteger(seed)
const validTime = (time: number): boolean => Number.isSafeInteger(time) && time >= 0

const invalidChunk = (reason: 'invalid-position' | 'invalid-bounds' | 'invalid-block-count' | 'invalid-block') => ({
  kind: 'invalid' as const,
  reason: 'invalid-chunk' as const,
  chunkReason: reason,
})

export const encodeSave = (snapshot: SaveSnapshot): SaveEncodeResult => {
  if (!validSeed(snapshot.seed)) {
    return { kind: 'invalid', reason: 'invalid-seed' }
  }
  if (!validTime(snapshot.time)) {
    return { kind: 'invalid', reason: 'invalid-time' }
  }
  if (snapshot.chunks.length > MAX_SAVE_CHUNKS) {
    return { kind: 'invalid', reason: 'invalid-chunk-count' }
  }

  const keys = new Set<string>()
  const encodedChunks: Array<Uint8Array> = []
  let byteLength = SAVE_HEADER_BYTES
  for (const chunk of snapshot.chunks) {
    const key = chunkKey(chunk.position)
    if (keys.has(key)) {
      return { kind: 'invalid', reason: 'duplicate-chunk' }
    }
    keys.add(key)

    const encoded = encodeChunk(chunk)
    if (encoded.kind === 'invalid') {
      return invalidChunk(encoded.reason)
    }
    encodedChunks.push(encoded.bytes)
    byteLength += SAVE_CHUNK_LENGTH_BYTES + encoded.bytes.byteLength
    if (byteLength > MAX_SAVE_BYTES) {
      return { kind: 'invalid', reason: 'too-large' }
    }
  }

  const bytes = new Uint8Array(byteLength)
  const view = viewOf(bytes)
  bytes.set(SAVE_MAGIC, 0)
  view.setUint8(4, SAVE_VERSION)
  view.setFloat64(5, snapshot.seed, false)
  view.setFloat64(13, snapshot.time, false)
  view.setUint32(21, encodedChunks.length, false)

  let offset = SAVE_HEADER_BYTES
  for (const chunkBytes of encodedChunks) {
    view.setUint32(offset, chunkBytes.byteLength, false)
    offset += SAVE_CHUNK_LENGTH_BYTES
    bytes.set(chunkBytes, offset)
    offset += chunkBytes.byteLength
  }
  return { kind: 'encoded', bytes }
}

export const decodeSave = (bytes: Uint8Array): SaveDecodeResult => {
  if (bytes.byteLength > MAX_SAVE_BYTES) {
    return { kind: 'invalid', reason: 'too-large' }
  }
  if (bytes.byteLength < SAVE_HEADER_BYTES) {
    return { kind: 'invalid', reason: 'truncated' }
  }
  if (!hasMagic(bytes)) {
    return { kind: 'invalid', reason: 'invalid-magic' }
  }

  const view = viewOf(bytes)
  if (view.getUint8(4) !== SAVE_VERSION) {
    return { kind: 'invalid', reason: 'unsupported-version' }
  }
  const seed = view.getFloat64(5, false)
  const time = view.getFloat64(13, false)
  if (!validSeed(seed)) {
    return { kind: 'invalid', reason: 'invalid-seed' }
  }
  if (!validTime(time)) {
    return { kind: 'invalid', reason: 'invalid-time' }
  }

  const chunkCount = view.getUint32(21, false)
  if (chunkCount > MAX_SAVE_CHUNKS) {
    return { kind: 'invalid', reason: 'invalid-chunk-count' }
  }

  const chunks: Array<Chunk> = []
  const keys = new Set<string>()
  let offset = SAVE_HEADER_BYTES
  for (let index = 0; index < chunkCount; index += 1) {
    if (offset + SAVE_CHUNK_LENGTH_BYTES > bytes.byteLength) {
      return { kind: 'invalid', reason: 'truncated' }
    }
    const chunkLength = view.getUint32(offset, false)
    offset += SAVE_CHUNK_LENGTH_BYTES
    if (chunkLength === 0 || offset + chunkLength > bytes.byteLength) {
      return { kind: 'invalid', reason: 'invalid-chunk-length' }
    }
    const decoded = decodeChunk(bytes.subarray(offset, offset + chunkLength))
    offset += chunkLength
    if (decoded.kind === 'invalid') {
      return { kind: 'invalid', reason: 'invalid-chunk' }
    }
    const key = chunkKey(decoded.chunk.position)
    if (keys.has(key)) {
      return { kind: 'invalid', reason: 'duplicate-chunk' }
    }
    keys.add(key)
    chunks.push(decoded.chunk)
  }

  if (offset !== bytes.byteLength) {
    return { kind: 'invalid', reason: 'invalid-chunk-length' }
  }
  return { kind: 'decoded', snapshot: { seed, time, chunks } }
}
