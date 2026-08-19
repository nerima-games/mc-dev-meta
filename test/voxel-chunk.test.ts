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
  type VoxelChunk,
} from '../src/domain/voxel-chunk'

describe('portable voxel chunk data', () => {
  it('validates block IDs and chunk coordinates', () => {
    expect(blockId(0)).toBe(AIR_BLOCK_ID)
    expect(blockId(BLOCK_ID_MAX)).toBe(BLOCK_ID_MAX)
    expect(chunkCoord(-123, Number.MAX_SAFE_INTEGER)).toStrictEqual({
      cx: -123,
      cz: Number.MAX_SAFE_INTEGER,
    })
    const normalized = chunkCoord(-0, -0)
    expect(Object.is(normalized.cx, -0)).toBe(false)
    expect(Object.is(normalized.cz, -0)).toBe(false)

    expect(() => blockId(-1)).toThrowError(VoxelChunkError)
    expect(() => blockId(1.5)).toThrowError(/integer/)
    expect(() => blockId(BLOCK_ID_MAX + 1)).toThrowError(/0 to 255/)
    expect(() => chunkCoord(Number.MAX_SAFE_INTEGER + 1, 0)).toThrowError(/safe integers/)
  })

  it('uses the Y-major 16×256×16 layout and live block buffer', () => {
    const coord = chunkCoord(2, -3)
    const chunk = createChunk(coord)
    expect(chunk.blocks).toHaveLength(CHUNK_VOLUME)
    expect(readBlockAt(chunk, 0, 0, 0)).toBe(AIR_BLOCK_ID)
    expect(blockIndex(0, 1, 0)).toBe(1)
    expect(blockIndex(0, 0, 1)).toBe(CHUNK_HEIGHT)
    expect(blockIndex(1, 0, 0)).toBe(CHUNK_HEIGHT * CHUNK_SIZE_XZ)

    setBlockAt(chunk, 15, 255, 15, blockId(BLOCK_ID_MAX))
    expect(readBlockAt(chunk, 15, 255, 15)).toBe(BLOCK_ID_MAX)
    expect(() => blockIndex(-1, 0, 0)).toThrowError(/x must/)
    expect(() => blockIndex(0, CHUNK_HEIGHT, 0)).toThrowError(/y must/)
    expect(() => blockIndex(0, 0, CHUNK_SIZE_XZ)).toThrowError(/z must/)
    expect(() => setBlockAt(chunk, 0, 0, 0, 256 as never)).toThrowError(VoxelChunkError)

    const blocks = new Uint8Array(CHUNK_VOLUME)
    const fromBlocks = createChunkFromBlocks(coord, blocks)
    expect(fromBlocks.blocks).toBe(blocks)
    expect(() => createChunkFromBlocks(coord, new Uint8Array(0))).toThrowError(/exactly/)
    expect(() => createChunkFromBlocks(coord, [] as never)).toThrowError(/Uint8Array/)
  })

  it('rejects malformed chunks before encoding', () => {
    const coord = chunkCoord(0, 0)
    expect(() => encodeChunk({ coord, blocks: new Uint8Array(0) } as VoxelChunk)).toThrowError(/exactly/)
    expect(() => encodeChunk({ coord: { cx: Infinity, cz: 0 }, blocks: new Uint8Array(CHUNK_VOLUME) } as never)).toThrowError(
      /safe integers/,
    )
    expect(() => encodeChunk(null as never)).toThrowError(/object/)
    expect(() => encodeChunk({ blocks: new Uint8Array(CHUNK_VOLUME) } as never)).toThrowError(/coord must be an object/)
    expect(() => encodeChunk({ coord: null, blocks: new Uint8Array(CHUNK_VOLUME) } as never)).toThrowError(
      /coord must be an object/,
    )
    expect(() => encodeChunk({ coord: { cx: '0', cz: 0 }, blocks: new Uint8Array(CHUNK_VOLUME) } as never)).toThrowError(
      /coordinates must be numbers/,
    )
    expect(() => encodeChunk({ coord: { cx: 0, cz: '0' }, blocks: new Uint8Array(CHUNK_VOLUME) } as never)).toThrowError(
      /coordinates must be numbers/,
    )
  })
})

describe('portable voxel chunk codec', () => {
  it('round-trips coordinates and block bytes deterministically', () => {
    const chunk = createChunk(chunkCoord(-123, 456))
    setBlockAt(chunk, 1, 2, 3, blockId(42))
    const encoded = encodeChunk(chunk)

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
    const decoded = decodeChunk(padded.subarray(1, padded.length - 1))
    expect(decoded.coord).toStrictEqual(chunk.coord)
    expect(decoded.blocks).not.toBe(chunk.blocks)
    expect(readBlockAt(decoded, 1, 2, 3)).toBe(42)
    expect(decoded.blocks).toStrictEqual(chunk.blocks)
  })

  it('rejects length, magic, version, and coordinate errors', () => {
    const encoded = encodeChunk(createChunk(chunkCoord(0, 0)))

    expect(() => decodeChunk(null as never)).toThrowError(/Uint8Array/)
    expect(() => decodeChunk(new DataView(new ArrayBuffer(0)) as never)).toThrowError(/Uint8Array/)
    expect(() => decodeChunk(encoded.slice(0, -1))).toThrowError(
      expect.objectContaining({ code: 'truncated' }),
    )
    expect(() => decodeChunk(new Uint8Array(CHUNK_CODEC_BYTE_LENGTH + 1))).toThrowError(
      expect.objectContaining({ code: 'trailing-data' }),
    )

    const wrongMagic = encoded.slice()
    wrongMagic[0] = 0
    expect(() => decodeChunk(wrongMagic)).toThrowError(
      expect.objectContaining({ code: 'invalid-format' }),
    )

    const wrongVersion = encoded.slice()
    wrongVersion[4] = CHUNK_CODEC_VERSION + 1
    expect(() => decodeChunk(wrongVersion)).toThrowError(/unsupported/)

    const unsafeCoordinate = encoded.slice()
    const view = new DataView(unsafeCoordinate.buffer, unsafeCoordinate.byteOffset, unsafeCoordinate.byteLength)
    view.setBigInt64(5, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)
    expect(() => decodeChunk(unsafeCoordinate)).toThrowError(/safe integer range/)
  })
})
