import { blockEntryOf, type BlockId } from './block-registry'
import { blockPosition, position, type BlockPosition, type Position } from './coordinates'

export const BLOCK_HIT_FACES = ['inside', 'xNegative', 'xPositive', 'yNegative', 'yPositive', 'zNegative', 'zPositive'] as const
export type BlockHitFace = (typeof BLOCK_HIT_FACES)[number]

export type BlockRayHit = {
  readonly block: BlockPosition
  readonly adjacent: BlockPosition
  readonly blockId: BlockId
  readonly distance: number
  readonly face: BlockHitFace
}

export type BlockRaycastOptions = {
  readonly origin: Position
  readonly direction: Position
  readonly maxDistance: number
  readonly blockAt: (position: BlockPosition) => BlockId | undefined
}

type Axis = 'x' | 'y' | 'z'

const isFinitePosition = (value: Position): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)

export const normalizeDirection = (direction: Position): Position | undefined => {
  const length = Math.hypot(direction.x, direction.y, direction.z)
  if (!Number.isFinite(length) || length === 0) {
    return undefined
  }
  return position(direction.x / length, direction.y / length, direction.z / length)
}

const stepOf = (direction: number): number => (direction > 0 ? 1 : direction < 0 ? -1 : 0)

const nextBoundaryDistance = (coordinate: number, direction: number, step: number): number => {
  if (step > 0) {
    return (Math.floor(coordinate) + 1 - coordinate) / direction
  }
  if (step < 0) {
    return (coordinate - Math.floor(coordinate)) / -direction
  }
  return Number.POSITIVE_INFINITY
}

const deltaDistance = (step: number, direction: number): number =>
  step === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(direction)

const isCollidable = (blockId: BlockId | undefined): blockId is BlockId => {
  const entry = blockId === undefined ? undefined : blockEntryOf(blockId)
  return entry !== undefined && entry.properties.collisionShape !== 'none'
}

const axisWithNearestBoundary = (distances: Readonly<Record<Axis, number>>): Axis => {
  if (distances.x <= distances.y && distances.x <= distances.z) {
    return 'x'
  }
  if (distances.y <= distances.z) {
    return 'y'
  }
  return 'z'
}

const moveAlong = (block: BlockPosition, axis: Axis, step: number): BlockPosition => {
  if (axis === 'x') {
    return blockPosition(block.x + step, block.y, block.z)
  }
  if (axis === 'y') {
    return blockPosition(block.x, block.y + step, block.z)
  }
  return blockPosition(block.x, block.y, block.z + step)
}

const faceFor = (axis: Axis, step: number): BlockHitFace => {
  if (axis === 'x') {
    return step > 0 ? 'xNegative' : 'xPositive'
  }
  if (axis === 'y') {
    return step > 0 ? 'yNegative' : 'yPositive'
  }
  return step > 0 ? 'zNegative' : 'zPositive'
}

export const raycastBlocks = (options: BlockRaycastOptions): BlockRayHit | undefined => {
  if (!isFinitePosition(options.origin) || !isFinitePosition(options.direction)) {
    return undefined
  }
  if (!Number.isFinite(options.maxDistance) || options.maxDistance < 0) {
    return undefined
  }

  const direction = normalizeDirection(options.direction)
  if (direction === undefined) {
    return undefined
  }

  let block = blockPosition(
    Math.floor(options.origin.x),
    Math.floor(options.origin.y),
    Math.floor(options.origin.z),
  )
  const steps: Record<Axis, number> = {
    x: stepOf(direction.x),
    y: stepOf(direction.y),
    z: stepOf(direction.z),
  }
  const distances: Record<Axis, number> = {
    x: nextBoundaryDistance(options.origin.x, direction.x, steps.x),
    y: nextBoundaryDistance(options.origin.y, direction.y, steps.y),
    z: nextBoundaryDistance(options.origin.z, direction.z, steps.z),
  }
  const deltas: Record<Axis, number> = {
    x: deltaDistance(steps.x, direction.x),
    y: deltaDistance(steps.y, direction.y),
    z: deltaDistance(steps.z, direction.z),
  }
  let entry: { readonly adjacent: BlockPosition; readonly face: BlockHitFace } | undefined
  let entryDistance = 0

  while (true) {
    const blockId = options.blockAt(block)
    if (isCollidable(blockId)) {
      return {
        block,
        adjacent: entry?.adjacent ?? block,
        blockId,
        distance: entry === undefined ? 0 : entryDistance,
        face: entry?.face ?? 'inside',
      }
    }

    const axis = axisWithNearestBoundary(distances)
    const distance = distances[axis]
    if (!Number.isFinite(distance) || distance > options.maxDistance) {
      return undefined
    }

    const adjacent = block
    const step = steps[axis]
    entryDistance = distance
    block = moveAlong(block, axis, step)
    entry = { adjacent, face: faceFor(axis, step) }
    distances[axis] += deltas[axis]
  }
}

export const raycast = raycastBlocks
