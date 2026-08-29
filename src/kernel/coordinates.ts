import { Brand } from 'effect'

export const CHUNK_SIZE_XZ = 16

export type BlockAxis = number & Brand.Brand<'BlockAxis'>
export const BlockAxis = Brand.refined<BlockAxis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`Expected a safe integer block axis, got ${value}`),
)

export type ChunkAxis = number & Brand.Brand<'ChunkAxis'>
export const ChunkAxis = Brand.refined<ChunkAxis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`Expected a safe integer chunk axis, got ${value}`),
)

export type LocalAxis = number & Brand.Brand<'LocalAxis'>
export const LocalAxis = Brand.refined<LocalAxis>(
  (value) => Number.isInteger(value) && value >= 0 && value < CHUNK_SIZE_XZ,
  (value) => Brand.error(`Expected a local axis in [0, ${CHUNK_SIZE_XZ}), got ${value}`),
)

export type Position = Readonly<{
  x: number
  y: number
  z: number
}>

export const position = (x: number, y: number, z: number): Position => ({ x, y, z })

const normalizeZero = (value: number): number => value + 0

export type BlockPosition = Readonly<{
  x: BlockAxis
  y: BlockAxis
  z: BlockAxis
}>

export const blockPosition = (x: number, y: number, z: number): BlockPosition => ({
  x: BlockAxis(normalizeZero(x)),
  y: BlockAxis(normalizeZero(y)),
  z: BlockAxis(normalizeZero(z)),
})

export type ChunkCoord = Readonly<{
  cx: ChunkAxis
  cz: ChunkAxis
}>

export const chunkCoord = (cx: number, cz: number): ChunkCoord => ({
  cx: ChunkAxis(normalizeZero(cx)),
  cz: ChunkAxis(normalizeZero(cz)),
})

export type LocalBlockCoord = Readonly<{
  lx: LocalAxis
  ly: BlockAxis
  lz: LocalAxis
}>

export type LocalBlockCoordInput = Readonly<{
  lx: number
  ly: number
  lz: number
}>

export const isLocalBlockCoord = (value: LocalBlockCoordInput): value is LocalBlockCoord =>
  Number.isInteger(value.lx) &&
  value.lx >= 0 &&
  value.lx < CHUNK_SIZE_XZ &&
  Number.isSafeInteger(value.ly) &&
  Number.isInteger(value.lz) &&
  value.lz >= 0 &&
  value.lz < CHUNK_SIZE_XZ

const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)
const floorMod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor

export const blockPositionOfPosition = (value: Position): BlockPosition =>
  blockPosition(Math.floor(value.x), Math.floor(value.y), Math.floor(value.z))

export const chunkCoordOfBlock = (value: BlockPosition): ChunkCoord =>
  chunkCoord(floorDiv(value.x, CHUNK_SIZE_XZ), floorDiv(value.z, CHUNK_SIZE_XZ))

export const localCoordOfBlock = (value: BlockPosition): LocalBlockCoord => ({
  lx: LocalAxis(normalizeZero(floorMod(value.x, CHUNK_SIZE_XZ))),
  ly: value.y,
  lz: LocalAxis(normalizeZero(floorMod(value.z, CHUNK_SIZE_XZ))),
})

export const blockPositionOfChunkLocal = (
  chunk: ChunkCoord,
  local: LocalBlockCoord,
): BlockPosition =>
  blockPosition(
    chunk.cx * CHUNK_SIZE_XZ + local.lx,
    local.ly,
    chunk.cz * CHUNK_SIZE_XZ + local.lz,
  )

export type AABB = Readonly<{
  min: Position
  max: Position
}>

export const aabb = (a: Position, b: Position): AABB => ({
  min: position(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)),
  max: position(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)),
})

export const aabbOfBlock = (value: BlockPosition): AABB =>
  aabb(value, position(value.x + 1, value.y + 1, value.z + 1))

export const aabbIntersects = (a: AABB, b: AABB): boolean =>
  a.min.x < b.max.x &&
  a.max.x > b.min.x &&
  a.min.y < b.max.y &&
  a.max.y > b.min.y &&
  a.min.z < b.max.z &&
  a.max.z > b.min.z

export const aabbContainsPoint = (box: AABB, point: Position): boolean =>
  point.x >= box.min.x &&
  point.x <= box.max.x &&
  point.y >= box.min.y &&
  point.y <= box.max.y &&
  point.z >= box.min.z &&
  point.z <= box.max.z

export const chunkKey = (chunk: ChunkCoord): string => `${chunk.cx},${chunk.cz}`
