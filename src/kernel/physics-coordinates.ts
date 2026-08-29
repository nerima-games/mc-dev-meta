import { Brand } from 'effect'

export type FootY = number & Brand.Brand<'FootY'>
export const FootY = Brand.nominal<FootY>()

export type CentreY = number & Brand.Brand<'CentreY'>
export const CentreY = Brand.nominal<CentreY>()

export type HalfHeight = number & Brand.Brand<'HalfHeight'>
export const HalfHeight = Brand.refined<HalfHeight>(
  (value) => Number.isFinite(value) && value > 0,
  (value) => Brand.error(`HalfHeight must be a positive finite number, received ${value}`),
)

export const centreOfFoot = (foot: FootY, halfHeight: HalfHeight): CentreY => CentreY(foot + halfHeight)
export const footOfCentre = (centre: CentreY, halfHeight: HalfHeight): FootY => FootY(centre - halfHeight)
export const standingPlaneAbove = (surfaceY: number): FootY => FootY(surfaceY + 1)

export const PLAYER_HALF_WIDTH = 0.3
export const PLAYER_HALF_HEIGHT: HalfHeight = HalfHeight(0.9)

export type Vec3 = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

export type PhysicsAABB = {
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
}

export const entityAABB = (
  x: number,
  centreY: CentreY,
  z: number,
  halfWidth: number,
  halfHeight: HalfHeight,
): PhysicsAABB => ({
  minX: x - halfWidth,
  minY: centreY - halfHeight,
  minZ: z - halfWidth,
  maxX: x + halfWidth,
  maxY: centreY + halfHeight,
  maxZ: z + halfWidth,
})

export const FULL_BLOCK_SHAPE: PhysicsAABB = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }
export const SLAB_SHAPE: PhysicsAABB = { ...FULL_BLOCK_SHAPE, maxY: 0.5 }

export const blockAABB = (bx: number, by: number, bz: number, shape: PhysicsAABB = FULL_BLOCK_SHAPE): PhysicsAABB => ({
  minX: bx + shape.minX,
  minY: by + shape.minY,
  minZ: bz + shape.minZ,
  maxX: bx + shape.maxX,
  maxY: by + shape.maxY,
  maxZ: bz + shape.maxZ,
})

export const intersects = (a: PhysicsAABB, b: PhysicsAABB): boolean =>
  a.minX < b.maxX &&
  a.maxX > b.minX &&
  a.minY < b.maxY &&
  a.maxY > b.minY &&
  a.minZ < b.maxZ &&
  a.maxZ > b.minZ

export const penetrationY = (a: PhysicsAABB, b: PhysicsAABB): number => Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY)

export const CONTACT_EPSILON = 1e-9

export const collidesWith = (a: PhysicsAABB, b: PhysicsAABB): boolean =>
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > CONTACT_EPSILON &&
  Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > CONTACT_EPSILON &&
  Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > CONTACT_EPSILON

export const isRestingOn = (body: PhysicsAABB, surface: PhysicsAABB): boolean =>
  body.minX < surface.maxX &&
  body.maxX > surface.minX &&
  body.minZ < surface.maxZ &&
  body.maxZ > surface.minZ &&
  Math.abs(body.minY - surface.maxY) <= CONTACT_EPSILON
