import { describe, expect, it } from 'vitest'
import {
  createChunk,
  createChunkBounds,
  type Chunk,
} from '../../src/kernel/chunk'
import { AIR_BLOCK_ID, blockIdOf, type BlockId } from '../../src/kernel/block-registry'
import { chunkCoord } from '../../src/kernel/coordinates'
import {
  CHUNK_HEADER_BYTES,
  decodeChunk,
  encodeChunk,
} from '../../src/kernel/chunk-persistence'

const bounds = createChunkBounds(0, 2)
if (bounds === undefined) {
  throw new Error('test bounds must be valid')
}

const makeChunk = (position = chunkCoord(0, 0), fill: BlockId = AIR_BLOCK_ID): Chunk => {
  const chunk = createChunk(position, bounds)
  return {
    ...chunk,
    blocks: chunk.blocks.map(() => fill),
  }
}

const encodedBytes = (chunk: Chunk): Uint8Array => {
  const result = encodeChunk(chunk)
  if (result.kind !== 'encoded') {
    throw new Error(`expected encoded chunk, got ${result.reason}`)
  }
  return result.bytes
}

const mutate = (bytes: Uint8Array, operation: (view: DataView) => void): Uint8Array => {
  const copy = bytes.slice()
  operation(new DataView(copy.buffer, copy.byteOffset, copy.byteLength))
  return copy
}

describe('chunk persistence', () => {
  it('round-trips positions, bounds, and block ids', () => {
    const chunk = makeChunk(chunkCoord(-3, 7), blockIdOf('stone'))
    const result = decodeChunk(encodedBytes(chunk))

    expect(result).toEqual({ kind: 'decoded', chunk })
  })

  it('rejects invalid chunks before encoding', () => {
    const base = makeChunk()
    const invalidBlock = {
      ...base,
      blocks: base.blocks.map(() => 255 as BlockId),
    }

    expect(encodeChunk({ ...base, position: chunkCoord(Number.MAX_SAFE_INTEGER, 0) })).toEqual({
      kind: 'invalid',
      reason: 'invalid-position',
    })
    expect(encodeChunk({ ...base, bounds: { minY: 0, maxYExclusive: 0 } })).toEqual({
      kind: 'invalid',
      reason: 'invalid-bounds',
    })
    expect(encodeChunk({ ...base, blocks: [] })).toEqual({
      kind: 'invalid',
      reason: 'invalid-block-count',
    })
    expect(encodeChunk(invalidBlock)).toEqual({
      kind: 'invalid',
      reason: 'invalid-block',
    })
  })

  it('rejects truncated and malformed encoded chunks', () => {
    const bytes = encodedBytes(makeChunk())
    const versionOffset = 4
    const maxYOffset = 17
    const blockCountOffset = 21
    const firstBlockOffset = CHUNK_HEADER_BYTES

    expect(decodeChunk(bytes.slice(0, CHUNK_HEADER_BYTES - 1))).toEqual({
      kind: 'invalid',
      reason: 'truncated',
    })
    expect(decodeChunk(mutate(bytes, (view) => view.setUint8(0, 0)))).toEqual({
      kind: 'invalid',
      reason: 'invalid-magic',
    })
    expect(decodeChunk(mutate(bytes, (view) => view.setUint8(versionOffset, 2)))).toEqual({
      kind: 'invalid',
      reason: 'unsupported-version',
    })
    expect(
      decodeChunk(
        mutate(bytes, (view) => {
          view.setInt32(maxYOffset, 0, false)
        }),
      ),
    ).toEqual({
      kind: 'invalid',
      reason: 'invalid-bounds',
    })
    expect(
      decodeChunk(
        mutate(bytes, (view) => {
          view.setUint32(blockCountOffset, 1_048_577, false)
        }),
      ),
    ).toEqual({
      kind: 'invalid',
      reason: 'invalid-block-count',
    })
    expect(decodeChunk(new Uint8Array([...bytes, 0]))).toEqual({
      kind: 'invalid',
      reason: 'invalid-length',
    })
    expect(
      decodeChunk(
        mutate(bytes, (view) => {
          view.setUint16(firstBlockOffset, 255, false)
        }),
      ),
    ).toEqual({
      kind: 'invalid',
      reason: 'invalid-block',
    })
  })
})
