import {
  CONTACT_EPSILON,
  CentreY,
  FULL_BLOCK_SHAPE,
  blockAABB,
  collidesWith,
  entityAABB,
  isRestingOn,
  type PhysicsAABB,
  type HalfHeight,
} from './physics-coordinates'
import type { DeltaTimeSecs } from './quantities'
import { GRAVITY_Y, integrateBody, type Body } from './integrate'

export type IsBlockSolid = (bx: number, by: number, bz: number) => boolean
export type BlockShapeAt = (bx: number, by: number, bz: number) => PhysicsAABB | null

export type ResolveOptions = {
  readonly halfWidth: number
  readonly halfHeight: HalfHeight
  readonly isBlockSolid: IsBlockSolid
  readonly blockShapeAt?: BlockShapeAt
  readonly stepHeight?: number
}

export type Resolution = {
  readonly body: Body
  readonly isGrounded: boolean
}

const shapeAt = (options: ResolveOptions, bx: number, by: number, bz: number): PhysicsAABB | null =>
  options.blockShapeAt?.(bx, by, bz) ?? (options.isBlockSolid(bx, by, bz) ? FULL_BLOCK_SHAPE : null)

const boxAt = (options: ResolveOptions, x: number, y: number, z: number): PhysicsAABB =>
  entityAABB(x, CentreY(y), z, options.halfWidth, options.halfHeight)

const collidingBlocks = (options: ResolveOptions, box: PhysicsAABB): ReadonlyArray<PhysicsAABB> => {
  const found: Array<PhysicsAABB> = []
  const bxMax = Math.floor(box.maxX)
  const byMax = Math.floor(box.maxY)
  const bzMax = Math.floor(box.maxZ)
  for (let bx = Math.floor(box.minX); bx <= bxMax; bx += 1) {
    for (let by = Math.floor(box.minY); by <= byMax; by += 1) {
      for (let bz = Math.floor(box.minZ); bz <= bzMax; bz += 1) {
        const shape = shapeAt(options, bx, by, bz)
        const blockBox = shape === null ? null : blockAABB(bx, by, bz, shape)
        if (blockBox !== null && collidesWith(box, blockBox)) {
          found.push(blockBox)
        }
      }
    }
  }
  return found
}

type AxisState = { readonly position: number; readonly velocity: number }

const clampAxis = (
  state: AxisState,
  bodyMin: number,
  bodyMax: number,
  halfExtent: number,
  blocks: ReadonlyArray<PhysicsAABB>,
  nearFace: (block: PhysicsAABB) => number,
  farFace: (block: PhysicsAABB) => number,
): AxisState => {
  if (state.velocity > 0) {
    const face = blocks.reduce(
      (nearest, block) => (nearFace(block) >= bodyMin ? Math.min(nearest, nearFace(block)) : nearest),
      Number.POSITIVE_INFINITY,
    )
    return face < Number.POSITIVE_INFINITY ? { position: face - halfExtent, velocity: 0 } : state
  }
  if (state.velocity < 0) {
    const face = blocks.reduce(
      (nearest, block) => (farFace(block) <= bodyMax ? Math.max(nearest, farFace(block)) : nearest),
      Number.NEGATIVE_INFINITY,
    )
    return face > Number.NEGATIVE_INFINITY ? { position: face + halfExtent, velocity: 0 } : state
  }
  return state
}

const resolveVertical = (options: ResolveOptions, box: PhysicsAABB, state: AxisState, deltaTime: DeltaTimeSecs): AxisState => {
  const blocks = collidingBlocks(options, box)
  if (blocks.length === 0) {
    return state
  }
  if (state.velocity <= 0) {
    const reach = -state.velocity * deltaTime + (options.stepHeight ?? 0) + CONTACT_EPSILON
    const floorTop = blocks.reduce(
      (highest, block) => (block.maxY - box.minY <= reach ? Math.max(highest, block.maxY) : highest),
      Number.NEGATIVE_INFINITY,
    )
    return floorTop > Number.NEGATIVE_INFINITY ? { position: floorTop + options.halfHeight, velocity: 0 } : state
  }
  const reach = state.velocity * deltaTime + CONTACT_EPSILON
  const ceiling = blocks.reduce(
    (lowest, block) => (box.maxY - block.minY <= reach ? Math.min(lowest, block.minY) : lowest),
    Number.POSITIVE_INFINITY,
  )
  return ceiling < Number.POSITIVE_INFINITY ? { position: ceiling - options.halfHeight, velocity: 0 } : state
}

const isSupported = (options: ResolveOptions, box: PhysicsAABB): boolean => {
  const feetCell = Math.floor(box.minY)
  const bxMax = Math.floor(box.maxX)
  const bzMax = Math.floor(box.maxZ)
  for (let bx = Math.floor(box.minX); bx <= bxMax; bx += 1) {
    for (let bz = Math.floor(box.minZ); bz <= bzMax; bz += 1) {
      for (let by = feetCell - 1; by <= feetCell; by += 1) {
        const shape = shapeAt(options, bx, by, bz)
        const blockBox = shape === null ? null : blockAABB(bx, by, bz, shape)
        if (blockBox !== null && isRestingOn(box, blockBox)) {
          return true
        }
      }
    }
  }
  return false
}

export const resolveBody = (body: Body, deltaTime: DeltaTimeSecs, options: ResolveOptions): Resolution => {
  if (body.kind !== 'dynamic') {
    return { body, isGrounded: isSupported(options, boxAt(options, body.x, body.y, body.z)) }
  }
  const vertical = resolveVertical(options, boxAt(options, body.x, body.y, body.z), { position: body.y, velocity: body.vy }, deltaTime)
  const boxAfterY = boxAt(options, body.x, vertical.position, body.z)
  const alongX = clampAxis(
    { position: body.x, velocity: body.vx },
    boxAfterY.minX,
    boxAfterY.maxX,
    options.halfWidth,
    collidingBlocks(options, boxAfterY),
    (block) => block.minX,
    (block) => block.maxX,
  )
  const boxAfterX = boxAt(options, alongX.position, vertical.position, body.z)
  const alongZ = clampAxis(
    { position: body.z, velocity: body.vz },
    boxAfterX.minZ,
    boxAfterX.maxZ,
    options.halfWidth,
    collidingBlocks(options, boxAfterX),
    (block) => block.minZ,
    (block) => block.maxZ,
  )
  const resolved: Body = {
    kind: 'dynamic',
    x: alongX.position,
    y: vertical.position,
    z: alongZ.position,
    vx: alongX.velocity,
    vy: vertical.velocity,
    vz: alongZ.velocity,
  }
  return { body: resolved, isGrounded: isSupported(options, boxAt(options, resolved.x, resolved.y, resolved.z)) }
}

export const resolveWorld = (bodies: ReadonlyArray<Body>, deltaTime: DeltaTimeSecs, options: ResolveOptions): ReadonlyArray<Resolution> =>
  bodies.map((body) => resolveBody(body, deltaTime, options))

export const stepBody = (body: Body, deltaTime: DeltaTimeSecs, options: ResolveOptions, gravityY = GRAVITY_Y): Resolution =>
  resolveBody(integrateBody(body, deltaTime, gravityY), deltaTime, options)

export const stepWorld = (bodies: ReadonlyArray<Body>, deltaTime: DeltaTimeSecs, options: ResolveOptions, gravityY = GRAVITY_Y): ReadonlyArray<Resolution> =>
  bodies.map((body) => stepBody(body, deltaTime, options, gravityY))

export const maxSpeedWithoutTunnelling = (halfExtent: number, blockThickness: number, maxDeltaSecs: number): number =>
  (blockThickness + 2 * halfExtent) / maxDeltaSecs
