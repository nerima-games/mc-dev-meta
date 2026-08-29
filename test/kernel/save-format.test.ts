import { describe, expect, it } from 'vitest'
import {
  createChunk,
  createChunkBounds,
  type Chunk,
} from '../../src/kernel/chunk'
import { AIR_BLOCK_ID, blockIdOf } from '../../src/kernel/block-registry'
import { chunkCoord } from '../../src/kernel/coordinates'
import {
  MAX_SAVE_BYTES,
  SAVE_CHUNK_LENGTH_BYTES,
  SAVE_HEADER_BYTES,
  decodeSave,
  encodeSave,
  type SaveSnapshot,
} from '../../src/kernel/save-format'

const smallBounds = createChunkBounds(0, 1)
if (smallBounds === undefined) {
  throw new Error('test bounds must be valid')
}

const makeChunk = (x = 0, z = 0, fill = AIR_BLOCK_ID): Chunk => {
  const chunk = createChunk(chunkCoord(x, z), smallBounds)
  return { ...chunk, blocks: chunk.blocks.map(() => fill) }
}

const encodedBytes = (snapshot: SaveSnapshot): Uint8Array => {
  const result = encodeSave(snapshot)
  if (result.kind !== 'encoded') {
    throw new Error(`expected encoded save, got ${result.reason}`)
  }
  return result.bytes
}

const mutate = (bytes: Uint8Array, operation: (view: DataView) => void): Uint8Array => {
  const copy = bytes.slice()
  operation(new DataView(copy.buffer, copy.byteOffset, copy.byteLength))
  return copy
}

describe('save format', () => {
  it('round-trips metadata and multiple chunks', () => {
    const snapshot: SaveSnapshot = {
      seed: -12,
      time: 1234,
      chunks: [makeChunk(0, 0, blockIdOf('stone')), makeChunk(1, 0)],
    }

    expect(decodeSave(encodedBytes(snapshot))).toEqual({ kind: 'decoded', snapshot })
  })

  it('rejects invalid metadata and chunk input', () => {
    const base: SaveSnapshot = { seed: 1, time: 2, chunks: [] }
    const invalidChunk = { ...makeChunk(), blocks: [] }

    expect(encodeSave({ ...base, seed: Number.NaN })).toEqual({
      kind: 'invalid',
      reason: 'invalid-seed',
    })
    expect(encodeSave({ ...base, time: Number.POSITIVE_INFINITY })).toEqual({
      kind: 'invalid',
      reason: 'invalid-time',
    })
    expect(encodeSave({ ...base, chunks: Array.from({ length: 4097 }, () => makeChunk()) })).toEqual({
      kind: 'invalid',
      reason: 'invalid-chunk-count',
    })
    expect(encodeSave({ ...base, chunks: [makeChunk(), makeChunk()] })).toEqual({
      kind: 'invalid',
      reason: 'duplicate-chunk',
    })
    expect(encodeSave({ ...base, chunks: [invalidChunk] })).toEqual({
      kind: 'invalid',
      reason: 'invalid-chunk',
      chunkReason: 'invalid-block-count',
    })
  })

  it('rejects saves that exceed the byte limit', () => {
    const bounds = createChunkBounds(0, 4096)
    if (bounds === undefined) {
      throw new Error('test bounds must be valid')
    }
    const blockCount = 16 * 16 * 4096
    const blocks = Array.from({ length: blockCount }, () => AIR_BLOCK_ID)
    const chunks = Array.from({ length: 32 }, (_, index) => ({
      ...createChunk(chunkCoord(index, 0), bounds),
      blocks,
    }))

    expect(encodeSave({ seed: 0, time: 0, chunks })).toEqual({
      kind: 'invalid',
      reason: 'too-large',
    })
  })

  it('rejects truncated, malformed, duplicate, and trailing data', () => {
    const oneChunk = encodedBytes({ seed: 1, time: 2, chunks: [makeChunk()] })
    const empty = encodedBytes({ seed: 1, time: 2, chunks: [] })
    const chunkLengthOffset = SAVE_HEADER_BYTES
    const chunkBytesOffset = SAVE_HEADER_BYTES + SAVE_CHUNK_LENGTH_BYTES

    expect(decodeSave(new Uint8Array(MAX_SAVE_BYTES + 1))).toEqual({
      kind: 'invalid',
      reason: 'too-large',
    })
    expect(decodeSave(empty.slice(0, SAVE_HEADER_BYTES - 1))).toEqual({
      kind: 'invalid',
      reason: 'truncated',
    })
    expect(decodeSave(mutate(empty, (view) => view.setUint8(0, 0)))).toEqual({
      kind: 'invalid',
      reason: 'invalid-magic',
    })
    expect(decodeSave(mutate(empty, (view) => view.setUint8(4, 2)))).toEqual({
      kind: 'invalid',
      reason: 'unsupported-version',
    })
    expect(decodeSave(mutate(empty, (view) => view.setFloat64(5, Number.NaN, false)))).toEqual({
      kind: 'invalid',
      reason: 'invalid-seed',
    })
    expect(decodeSave(mutate(empty, (view) => view.setFloat64(13, Number.POSITIVE_INFINITY, false)))).toEqual({
      kind: 'invalid',
      reason: 'invalid-time',
    })
    expect(decodeSave(mutate(empty, (view) => view.setUint32(21, 4097, false)))).toEqual({
      kind: 'invalid',
      reason: 'invalid-chunk-count',
    })
    expect(
      decodeSave(
        mutate(oneChunk, (view) => {
          view.setUint32(chunkLengthOffset, 0xffff_ffff, false)
        }),
      ),
    ).toEqual({
      kind: 'invalid',
      reason: 'invalid-chunk-length',
    })
    expect(
      decodeSave(
        mutate(oneChunk, (view) => {
          view.setUint32(chunkLengthOffset, 1, false)
        }),
      ),
    ).toEqual({
      kind: 'invalid',
      reason: 'invalid-chunk',
    })
    expect(
      decodeSave(
        mutate(oneChunk, (view) => {
          view.setUint8(chunkBytesOffset, 0)
        }),
      ),
    ).toEqual({
      kind: 'invalid',
      reason: 'invalid-chunk',
    })
    const duplicate = encodedBytes({ seed: 1, time: 2, chunks: [makeChunk(0, 0), makeChunk(1, 0)] })
    const firstLength = new DataView(duplicate.buffer, duplicate.byteOffset, duplicate.byteLength).getUint32(
      chunkLengthOffset,
      false,
    )
    const secondChunkOffset = chunkLengthOffset + SAVE_CHUNK_LENGTH_BYTES + firstLength + SAVE_CHUNK_LENGTH_BYTES
    expect(
      decodeSave(
        mutate(duplicate, (view) => {
          view.setInt32(secondChunkOffset + 5, 0, false)
          view.setInt32(secondChunkOffset + 9, 0, false)
        }),
      ),
    ).toEqual({
      kind: 'invalid',
      reason: 'duplicate-chunk',
    })
    expect(decodeSave(new Uint8Array([...empty, 0]))).toEqual({
      kind: 'invalid',
      reason: 'invalid-chunk-length',
    })
  })
})
