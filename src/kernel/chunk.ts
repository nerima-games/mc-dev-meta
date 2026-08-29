import { AIR_BLOCK_ID, type BlockId } from './block-registry'
import {
  CHUNK_SIZE_XZ,
  chunkKey,
  chunkCoordOfBlock,
  type BlockPosition,
  type ChunkCoord,
  isLocalBlockCoord,
  localCoordOfBlock,
  type LocalBlockCoord,
  type LocalBlockCoordInput,
} from './coordinates'

export type ChunkBounds = Readonly<{
  minY: number
  maxYExclusive: number
}>

export type Chunk = Readonly<{
  position: ChunkCoord
  bounds: ChunkBounds
  blocks: ReadonlyArray<BlockId>
}>

export const createChunkBounds = (minY: number, maxYExclusive: number): ChunkBounds | undefined =>
  Number.isSafeInteger(minY) && Number.isSafeInteger(maxYExclusive) && maxYExclusive > minY
    ? { minY, maxYExclusive }
    : undefined

export const chunkVolume = (bounds: ChunkBounds): number =>
  CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * (bounds.maxYExclusive - bounds.minY)

const blockIndexOf = (bounds: ChunkBounds, position: LocalBlockCoord): number =>
  position.lx + CHUNK_SIZE_XZ * (position.lz + CHUNK_SIZE_XZ * (position.ly - bounds.minY))

export const createChunk = (
  position: ChunkCoord,
  bounds: ChunkBounds,
  fill: BlockId = AIR_BLOCK_ID,
): Chunk => ({
  position,
  bounds,
  blocks: new Array<BlockId>(chunkVolume(bounds)).fill(fill),
})

export const getBlockAt = (chunk: Chunk, position: LocalBlockCoordInput): BlockId | undefined => {
  if (
    !isLocalBlockCoord(position) ||
    position.ly < chunk.bounds.minY ||
    position.ly >= chunk.bounds.maxYExclusive
  ) {
    return undefined
  }
  return chunk.blocks[blockIndexOf(chunk.bounds, position)]
}

export const setBlockAt = (
  chunk: Chunk,
  position: LocalBlockCoordInput,
  block: BlockId,
): Chunk => {
  if (
    !isLocalBlockCoord(position) ||
    position.ly < chunk.bounds.minY ||
    position.ly >= chunk.bounds.maxYExclusive
  ) {
    return chunk
  }
  const index = blockIndexOf(chunk.bounds, position)
  if (chunk.blocks[index] === block) {
    return chunk
  }
  const blocks = [...chunk.blocks]
  blocks[index] = block
  return { ...chunk, blocks }
}

export const getWorldBlockAt = (chunk: Chunk, position: BlockPosition): BlockId | undefined => {
  const expectedChunk = chunkCoordOfBlock(position)
  return expectedChunk.cx === chunk.position.cx && expectedChunk.cz === chunk.position.cz
    ? getBlockAt(chunk, localCoordOfBlock(position))
    : undefined
}

export type ChunkStore = ReadonlyMap<string, Chunk>

export const createChunkStore = (): ChunkStore => new Map<string, Chunk>()

export const getChunk = (store: ChunkStore, position: ChunkCoord): Chunk | undefined =>
  store.get(chunkKey(position))

export const putChunk = (store: ChunkStore, chunk: Chunk): ChunkStore => {
  const next = new Map(store)
  next.set(chunkKey(chunk.position), chunk)
  return next
}

export const removeChunk = (store: ChunkStore, position: ChunkCoord): ChunkStore => {
  if (!store.has(chunkKey(position))) {
    return store
  }
  const next = new Map(store)
  next.delete(chunkKey(position))
  return next
}

export const chunkCount = (store: ChunkStore): number => store.size
