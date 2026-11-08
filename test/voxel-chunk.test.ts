import { describe, expect, it } from 'vitest'
import {
  AIR_BLOCK_ID,
  blockId,
  blockIndex,
  BLOCK_ID_MAX,
  CHUNK_CODEC_BYTE_LENGTH,
  CHUNK_CODEC_HEADER_BYTES,
  CHUNK_CODEC_MAGIC,
  CHUNK_CODEC_VERSION,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  chunkCoord,
  createChunk,
  createChunkFromBlocks,
  decodeChunk,
  encodeChunk,
  readBlockAt,
  setBlockAt,
  VoxelChunkError,
  type VoxelChunkErrorCode,
  type VoxelChunk,
} from '../src/domain/voxel-chunk'

const expectValue = <A>(result: A | VoxelChunkError): A => {
  expect(result).not.toBeInstanceOf(VoxelChunkError)
  return result as A
}

const expectFailure = (result: unknown, code: VoxelChunkErrorCode, message: RegExp | string): void => {
  expect(result).toBeInstanceOf(VoxelChunkError)
  if (result instanceof VoxelChunkError) {
    expect(result._tag).toBe('VoxelChunkError')
    expect(result.name).toBe('VoxelChunkError')
    expect(result.code).toBe(code)
    expect(result.message).toMatch(message)
  }
}

describe('portable voxel chunk data', () => {
  it('validates block IDs and chunk coordinates', () => {
    expect(blockId(0)).toBe(AIR_BLOCK_ID)
    expect(blockId(BLOCK_ID_MAX)).toBe(BLOCK_ID_MAX)
    expect(chunkCoord(-123, Number.MAX_SAFE_INTEGER)).toStrictEqual({
      cx: -123,
      cz: Number.MAX_SAFE_INTEGER,
    })
    const normalized = expectValue(chunkCoord(-0, -0))
    expect(Object.is(normalized.cx, -0)).toBe(false)
    expect(Object.is(normalized.cz, -0)).toBe(false)

    expectFailure(blockId(-1), 'invalid-value', /integer/)
    expectFailure(blockId(1.5), 'invalid-value', /integer/)
    expectFailure(blockId(BLOCK_ID_MAX + 1), 'invalid-value', /0 to 255/)
    expectFailure(chunkCoord(Number.MAX_SAFE_INTEGER + 1, 0), 'invalid-value', /safe integers/)
  })

  it('uses the Y-major 16×256×16 layout and live block buffer', () => {
    const coord = expectValue(chunkCoord(2, -3))
    const chunk = createChunk(coord)
    expect(chunk.blocks).toHaveLength(CHUNK_VOLUME)
    expect(readBlockAt(chunk, 0, 0, 0)).toBe(AIR_BLOCK_ID)
    expect(blockIndex(0, 1, 0)).toBe(1)
    expect(blockIndex(0, 0, 1)).toBe(CHUNK_HEIGHT)
    expect(blockIndex(1, 0, 0)).toBe(CHUNK_HEIGHT * CHUNK_SIZE_XZ)
    expectFailure(readBlockAt(chunk, -1, 0, 0), 'invalid-value', /x must/)

    setBlockAt(chunk, 15, 255, 15, expectValue(blockId(BLOCK_ID_MAX)))
    expect(readBlockAt(chunk, 15, 255, 15)).toBe(BLOCK_ID_MAX)
    expectFailure(blockIndex(-1, 0, 0), 'invalid-value', /x must/)
    expectFailure(blockIndex(0, CHUNK_HEIGHT, 0), 'invalid-value', /y must/)
    expectFailure(blockIndex(0, 0, CHUNK_SIZE_XZ), 'invalid-value', /z must/)
    expectFailure(setBlockAt(chunk, -1, 0, 0, expectValue(blockId(1))), 'invalid-value', /x must/)
    expectFailure(setBlockAt(chunk, 0, 0, 0, 256 as never), 'invalid-value', /block id/)

    const blocks = new Uint8Array(CHUNK_VOLUME)
    const fromBlocks = expectValue(createChunkFromBlocks(coord, blocks))
    expect(fromBlocks.blocks).toBe(blocks)
    expectFailure(createChunkFromBlocks(coord, new Uint8Array(0)), 'invalid-value', /exactly/)
    expectFailure(createChunkFromBlocks(coord, [] as never), 'invalid-value', /Uint8Array/)
  })

  it('rejects malformed chunks before encoding', () => {
    const coord = expectValue(chunkCoord(0, 0))
    expectFailure(encodeChunk({ coord, blocks: new Uint8Array(0) } as VoxelChunk), 'invalid-value', /exactly/)
    expectFailure(
      encodeChunk({ coord: { cx: Infinity, cz: 0 }, blocks: new Uint8Array(CHUNK_VOLUME) } as never),
      'invalid-value',
      /safe integers/,
    )
    expectFailure(encodeChunk(null as never), 'invalid-value', /object/)
    expectFailure(
      encodeChunk({ blocks: new Uint8Array(CHUNK_VOLUME) } as never),
      'invalid-value',
      /coord must be an object/,
    )
    expectFailure(
      encodeChunk({ coord: null, blocks: new Uint8Array(CHUNK_VOLUME) } as never),
      'invalid-value',
      /coord must be an object/,
    )
    expectFailure(
      encodeChunk({ coord: { cx: '0', cz: 0 }, blocks: new Uint8Array(CHUNK_VOLUME) } as never),
      'invalid-value',
      /coordinates must be numbers/,
    )
    expectFailure(
      encodeChunk({ coord: { cx: 0, cz: '0' }, blocks: new Uint8Array(CHUNK_VOLUME) } as never),
      'invalid-value',
      /coordinates must be numbers/,
    )
  })
})

describe('portable voxel chunk codec', () => {
  it('round-trips coordinates and block bytes deterministically', () => {
    const chunk = createChunk(expectValue(chunkCoord(-123, 456)))
    setBlockAt(chunk, 1, 2, 3, expectValue(blockId(42)))
    const encoded = expectValue(encodeChunk(chunk))

    expect(encoded).toHaveLength(CHUNK_CODEC_BYTE_LENGTH)
    expect([...encoded.slice(0, CHUNK_CODEC_HEADER_BYTES)]).toStrictEqual([
      0x4d,
      0x43,
      0x43,
      0x48,
      CHUNK_CODEC_VERSION,
      0x85,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xc8,
      0x01,
      0,
      0,
      0,
      0,
      0,
      0,
    ])
    expect(String.fromCharCode(...encoded.slice(0, 4))).toBe(CHUNK_CODEC_MAGIC)

    const padded = new Uint8Array(encoded.length + 2)
    padded.set(encoded, 1)
    const decoded = expectValue(decodeChunk(padded.subarray(1, padded.length - 1)))
    expect(decoded.coord).toStrictEqual(chunk.coord)
    expect(decoded.blocks).not.toBe(chunk.blocks)
    expect(readBlockAt(decoded, 1, 2, 3)).toBe(42)
    expect(decoded.blocks).toStrictEqual(chunk.blocks)
  })

  it('rejects length, magic, version, and coordinate errors', () => {
    const encoded = expectValue(encodeChunk(createChunk(expectValue(chunkCoord(0, 0)))))

    expectFailure(decodeChunk(null as never), 'invalid-value', /Uint8Array/)
    expectFailure(decodeChunk(new DataView(new ArrayBuffer(0)) as never), 'invalid-value', /Uint8Array/)
    expectFailure(decodeChunk(encoded.slice(0, -1)), 'truncated', /shorter/)
    expectFailure(decodeChunk(new Uint8Array(CHUNK_CODEC_BYTE_LENGTH + 1)), 'trailing-data', /exactly/)

    const wrongMagic = encoded.slice()
    wrongMagic[0] = 0
    expectFailure(decodeChunk(wrongMagic), 'invalid-format', /magic/)

    const wrongVersion = encoded.slice()
    wrongVersion[4] = CHUNK_CODEC_VERSION + 1
    expectFailure(decodeChunk(wrongVersion), 'invalid-format', /unsupported/)

    const unsafeCoordinate = encoded.slice()
    const view = new DataView(unsafeCoordinate.buffer, unsafeCoordinate.byteOffset, unsafeCoordinate.byteLength)
    view.setBigInt64(5, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)
    expectFailure(decodeChunk(unsafeCoordinate), 'invalid-value', /safe integer range/)
  })
})
