import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  CONTACT_EPSILON,
  CentreY,
  FULL_BLOCK_SHAPE,
  FootY,
  HalfHeight,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  SLAB_SHAPE,
  blockAABB,
  centreOfFoot,
  collidesWith,
  entityAABB,
  footOfCentre,
  intersects,
  isRestingOn,
  penetrationY,
  standingPlaneAbove,
  vec3,
} from '../../src/kernel/physics-coordinates'
import {
  DeltaTimeSecs,
  FIRST_FRAME_DELTA_SECS,
  MAX_DELTA_SECS,
  MIN_DELTA_SECS,
  clampDeltaTime,
  deltaTimeBetween,
  isClampedDelta,
} from '../../src/kernel/delta-time'
import { GRAVITY_Y, TERMINAL_VELOCITY_Y, integrate, integrateBody, maxFallPerStep, type Body } from '../../src/kernel/integrate'
import { voxelRaycast } from '../../src/kernel/dda'
import {
  maxSpeedWithoutTunnelling,
  resolveBody,
  resolveWorld,
  stepBody,
  stepWorld,
  type ResolveOptions,
} from '../../src/kernel/resolve'

const delta = clampDeltaTime(0.02)

const body = (overrides: Partial<Body> = {}): Body => ({
  kind: 'dynamic',
  x: 0.5,
  y: 2.9,
  z: 0.5,
  vx: 0,
  vy: 0,
  vz: 0,
  ...overrides,
})

const options = (isBlockSolid: ResolveOptions['isBlockSolid'], extra: Partial<ResolveOptions> = {}): ResolveOptions => ({
  halfWidth: PLAYER_HALF_WIDTH,
  halfHeight: PLAYER_HALF_HEIGHT,
  isBlockSolid,
  ...extra,
})

const restingBody = (surfaceY: number, overrides: Partial<Body> = {}): Body => ({
  ...body({ y: surfaceY + 1 + Number(PLAYER_HALF_HEIGHT) }),
  ...overrides,
})

describe('physics coordinates and AABBs', () => {
  it('keeps foot and centre coordinates reversible and validates half-heights', () => {
    const foot = FootY(64)
    const centre = centreOfFoot(foot, PLAYER_HALF_HEIGHT)

    expect(centre).toBe(64.9)
    expect(footOfCentre(centre, PLAYER_HALF_HEIGHT)).toBeCloseTo(64, 12)
    expect(standingPlaneAbove(63)).toBe(64)
    expect(() => HalfHeight(0)).toThrow()
    expect(() => HalfHeight(-1)).toThrow()
    expect(() => HalfHeight(Number.NaN)).toThrow()
    expect(() => HalfHeight(Number.POSITIVE_INFINITY)).toThrow()
    expect(HalfHeight(0.5)).toBe(0.5)
  })

  it('constructs vectors, entities, full blocks and custom shapes', () => {
    expect(vec3(1, 2, 3)).toStrictEqual({ x: 1, y: 2, z: 3 })
    expect(entityAABB(2, CentreY(3), 4, 0.3, HalfHeight(0.9))).toStrictEqual({
      minX: 1.7,
      minY: 2.1,
      minZ: 3.7,
      maxX: 2.3,
      maxY: 3.9,
      maxZ: 4.3,
    })
    expect(blockAABB(1, 2, 3)).toStrictEqual({
      minX: 1,
      minY: 2,
      minZ: 3,
      maxX: 2,
      maxY: 3,
      maxZ: 4,
    })
    expect(blockAABB(1, 2, 3, SLAB_SHAPE)).toStrictEqual({
      minX: 1,
      minY: 2,
      minZ: 3,
      maxX: 2,
      maxY: 2.5,
      maxZ: 4,
    })
    expect(FULL_BLOCK_SHAPE).toStrictEqual({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 })
  })

  it('distinguishes strict intersection, contact depth and resting contact', () => {
    const base = blockAABB(0, 0, 0)
    const overlap = entityAABB(0.5, CentreY(0.5), 0.5, 0.5, HalfHeight(0.5))
    const touchingX = entityAABB(1.5, CentreY(0.5), 0.5, 0.5, HalfHeight(0.5))
    const touchingY = entityAABB(0.5, CentreY(1.5), 0.5, 0.5, HalfHeight(0.5))
    const touchingZ = entityAABB(0.5, CentreY(0.5), 1.5, 0.5, HalfHeight(0.5))

    expect(intersects(overlap, base)).toBe(true)
    expect(collidesWith(overlap, base)).toBe(true)
    expect(penetrationY(overlap, base)).toBe(1)
    expect(intersects(touchingX, base)).toBe(false)
    expect(intersects(touchingY, base)).toBe(false)
    expect(intersects(touchingZ, base)).toBe(false)
    expect(collidesWith(touchingX, base)).toBe(false)
    expect(collidesWith(touchingY, base)).toBe(false)
    expect(collidesWith(touchingZ, base)).toBe(false)

    const standing = entityAABB(0.5, CentreY(1.9), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
    expect(isRestingOn(standing, base)).toBe(true)
    expect(isRestingOn(entityAABB(0.5, CentreY(1.9 + CONTACT_EPSILON / 4), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT), base)).toBe(true)
    expect(isRestingOn(entityAABB(0.5, CentreY(2), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT), base)).toBe(false)
    expect(isRestingOn(entityAABB(2, CentreY(1.9), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT), base)).toBe(false)
    expect(isRestingOn(entityAABB(0.5, CentreY(1.9), 2, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT), base)).toBe(false)
    expect(isRestingOn(entityAABB(0.5, CentreY(-0.1), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT), base)).toBe(false)
  })

  it('covers every separating axis and the contact skin', () => {
    const base = blockAABB(0, 0, 0)
    const separated = [
      entityAABB(-1.5, CentreY(0.5), 0.5, 0.5, HalfHeight(0.5)),
      entityAABB(1.5, CentreY(0.5), 0.5, 0.5, HalfHeight(0.5)),
      entityAABB(0.5, CentreY(-1.5), 0.5, 0.5, HalfHeight(0.5)),
      entityAABB(0.5, CentreY(1.5), 0.5, 0.5, HalfHeight(0.5)),
      entityAABB(0.5, CentreY(0.5), -1.5, 0.5, HalfHeight(0.5)),
      entityAABB(0.5, CentreY(0.5), 1.5, 0.5, HalfHeight(0.5)),
    ]
    for (const other of separated) {
      expect(intersects(other, base)).toBe(false)
      expect(collidesWith(other, base)).toBe(false)
    }

    const skin = entityAABB(0.5, CentreY(1.5 - CONTACT_EPSILON / 2), 0.5, 0.5, HalfHeight(0.5))
    expect(intersects(skin, base)).toBe(true)
    expect(collidesWith(skin, base)).toBe(false)
  })
})

describe('delta time', () => {
  it('clamps invalid and out-of-range frame deltas at the boundary', () => {
    expect(clampDeltaTime(Number.NaN)).toBe(FIRST_FRAME_DELTA_SECS)
    expect(clampDeltaTime(Number.POSITIVE_INFINITY)).toBe(MAX_DELTA_SECS)
    expect(clampDeltaTime(Number.NEGATIVE_INFINITY)).toBe(MIN_DELTA_SECS)
    expect(clampDeltaTime(-1)).toBe(MIN_DELTA_SECS)
    expect(clampDeltaTime(0)).toBe(MIN_DELTA_SECS)
    expect(clampDeltaTime(0.02)).toBe(0.02)
    expect(clampDeltaTime(1)).toBe(MAX_DELTA_SECS)
    expect(DeltaTimeSecs(0)).toBe(0)
  })

  it('reports clamping only for finite values outside the inclusive safe range', () => {
    expect(isClampedDelta(Number.NaN)).toBe(false)
    expect(isClampedDelta(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isClampedDelta(Number.NEGATIVE_INFINITY)).toBe(false)
    expect(isClampedDelta(MIN_DELTA_SECS)).toBe(false)
    expect(isClampedDelta(MAX_DELTA_SECS)).toBe(false)
    expect(isClampedDelta(MIN_DELTA_SECS - 0.0001)).toBe(true)
    expect(isClampedDelta(MAX_DELTA_SECS + 0.0001)).toBe(true)
  })

  it('uses the first-frame delta without a previous timestamp and clamps backwards time', () => {
    expect(deltaTimeBetween(undefined, 100)).toBe(FIRST_FRAME_DELTA_SECS)
    expect(deltaTimeBetween(10, 10.02)).toBeCloseTo(0.02, 12)
    expect(deltaTimeBetween(10, 9)).toBe(MIN_DELTA_SECS)
  })
})

describe('body integration', () => {
  it('uses the accelerated velocity for the position and supports custom gravity', () => {
    const stepped = integrateBody(body(), delta)
    expect(stepped.vy).toBeCloseTo(GRAVITY_Y * delta, 12)
    expect(stepped.y).toBeCloseTo(2.9 + stepped.vy * delta, 12)
    expect(integrateBody(body({ vx: 2, vz: -3 }), delta, 0)).toStrictEqual({
      ...body({ vx: 2, vz: -3 }),
      x: 0.5 + 2 * delta,
      z: 0.5 - 3 * delta,
    })
  })

  it('leaves static and kinematic bodies unchanged and clamps terminal velocity', () => {
    const staticBody = body({ kind: 'static', vx: 4, vy: -2 })
    const kinematicBody = body({ kind: 'kinematic', vx: 4, vy: -2 })
    expect(integrateBody(staticBody, delta)).toBe(staticBody)
    expect(integrateBody(kinematicBody, delta)).toBe(kinematicBody)
    const terminal = integrateBody(body({ vy: TERMINAL_VELOCITY_Y - 1 }), delta)
    expect(terminal.vy).toBe(TERMINAL_VELOCITY_Y)
    expect(terminal.y).toBe(2.9 + TERMINAL_VELOCITY_Y * delta)
  })

  it('integrates collections and exposes the tunnelling bound', () => {
    expect(integrate([], delta)).toStrictEqual([])
    expect(integrate([body(), body({ x: 3 })], delta)).toHaveLength(2)
    expect(maxFallPerStep(MAX_DELTA_SECS)).toBe(32 * MAX_DELTA_SECS)
  })
})

describe('voxel DDA raycast', () => {
  it('rejects invalid rays and never tests the origin cell', () => {
    const target = () => true
    expect(Option.isNone(voxelRaycast(vec3(0, 0, 0), vec3(0, 0, 0), 5, target))).toBe(true)
    expect(Option.isNone(voxelRaycast(vec3(0, 0, 0), vec3(Number.NaN, 0, 0), 5, target))).toBe(true)
    expect(Option.isNone(voxelRaycast(vec3(0, 0, 0), vec3(Number.POSITIVE_INFINITY, 0, 0), 5, target))).toBe(true)
    expect(Option.isNone(voxelRaycast(vec3(0, 0, 0), vec3(1, 0, 0), 0, target))).toBe(true)
    expect(Option.isNone(voxelRaycast(vec3(Number.NaN, 0, 0), vec3(1, 0, 0), 5, target))).toBe(true)
    expect(Option.isNone(voxelRaycast(vec3(0, Number.NaN, 0), vec3(1, 0, 0), 5, target))).toBe(true)
    expect(Option.isNone(voxelRaycast(vec3(0, 0, Number.NaN), vec3(1, 0, 0), 5, target))).toBe(true)

    const visited: Array<string> = []
    const hit = voxelRaycast(vec3(0.25, 0.5, 0.5), vec3(1, 0, 0), 5, (bx, by, bz) => {
      visited.push(`${bx},${by},${bz}`)
      return bx === 2
    })
    expect(visited).toStrictEqual(['1,0,0', '2,0,0'])
    expect(Option.isSome(hit) && hit.value).toMatchObject({
      bx: 2,
      by: 0,
      bz: 0,
      normal: { x: -1, y: 0, z: 0 },
      distance: 1.75,
      point: { x: 2, y: 0.5, z: 0.5 },
    })
  })

  it('traverses all axes and both directions with the entered-face normal', () => {
    const cases = [
      { direction: vec3(1, 0, 0), expected: { bx: 1, by: 0, bz: 0, normal: { x: -1, y: 0, z: 0 } } },
      { direction: vec3(-1, 0, 0), expected: { bx: -1, by: 0, bz: 0, normal: { x: 1, y: 0, z: 0 } } },
      { direction: vec3(0, 1, 0), expected: { bx: 0, by: 1, bz: 0, normal: { x: 0, y: -1, z: 0 } } },
      { direction: vec3(0, -1, 0), expected: { bx: 0, by: -1, bz: 0, normal: { x: 0, y: 1, z: 0 } } },
      { direction: vec3(0, 0, 1), expected: { bx: 0, by: 0, bz: 1, normal: { x: 0, y: 0, z: -1 } } },
      { direction: vec3(0, 0, -1), expected: { bx: 0, by: 0, bz: -1, normal: { x: 0, y: 0, z: 1 } } },
    ]
    for (const current of cases) {
      const result = voxelRaycast(vec3(0.25, 0.5, 0.75), current.direction, 5, (bx, by, bz) =>
        bx === current.expected.bx && by === current.expected.by && bz === current.expected.bz,
      )
      expect(Option.isSome(result) && result.value).toMatchObject(current.expected)
    }
  })

  it('walks past air, respects max distance and terminates when every cell is air', () => {
    const visited: Array<string> = []
    expect(
      Option.isNone(
        voxelRaycast(vec3(0.5, 0.5, 0.5), vec3(1, 1, 1), 0.87, (bx, by, bz) => {
          visited.push(`${bx},${by},${bz}`)
          return false
        }),
      ),
    ).toBe(true)
    expect(visited).toStrictEqual(['1,0,0', '1,1,0', '1,1,1'])
    expect(Option.isNone(voxelRaycast(vec3(0.5, 0.5, 0.5), vec3(1, 0, 0), 0.49, () => true))).toBe(true)
    expect(Option.isNone(voxelRaycast(vec3(0.5, 0.5, 0.5), vec3(1, 0, 0), 1.5, () => false))).toBe(true)
  })
})

describe('AABB resolution', () => {
  it('resolves ground, ceiling and horizontal walls in movement order', () => {
    const ground = options((_bx, by) => by === 0)
    const falling = stepBody(restingBody(0, { y: 1.95, vy: -5 }), delta, ground)
    expect(falling.body.y).toBe(1.9)
    expect(falling.body.vy).toBe(0)
    expect(falling.isGrounded).toBe(true)

    const ceiling = options((_bx, by) => by === 0 || by === 3)
    const jumping = stepBody(restingBody(0, { y: 2.09, vy: 8 }), delta, ceiling)
    expect(jumping.body.y).toBeCloseTo(2.1, 12)
    expect(jumping.body.vy).toBe(0)
    expect(jumping.isGrounded).toBe(false)

    const wall = options((bx, by) => by === 0 || (bx === 1 && by === 1))
    const intoWall = stepBody(restingBody(0, { x: 0.85, vx: 5 }), delta, wall)
    expect(intoWall.body.x).toBe(0.7)
    expect(intoWall.body.vx).toBe(0)
    const fromOtherSide = stepBody(restingBody(0, { x: 2.15, vx: -5 }), delta, wall)
    expect(fromOtherSide.body.x).toBe(2.3)
    expect(fromOtherSide.body.vx).toBe(0)
  })

  it('supports slab shapes, optional shape fallback, step height and free movement', () => {
    const slab = (bx: number, by: number) => bx === 1 && by === 1
    const stepped = options((bx, by) => by === 0 || slab(bx, by), {
      blockShapeAt: (bx, by) => (slab(bx, by) ? SLAB_SHAPE : null),
      stepHeight: 0.6,
    })
    const result = stepBody(restingBody(0, { x: 0.85, vx: 5 }), delta, stepped)
    expect(result.body.x).toBeCloseTo(0.85 + 5 * delta, 12)
    expect(result.body.y).toBe(2.4)
    expect(result.isGrounded).toBe(true)

    const noStep = options((bx, by) => by === 0 || slab(bx, by), {
      blockShapeAt: (bx, by) => (slab(bx, by) ? SLAB_SHAPE : null),
    })
    const blocked = stepBody(restingBody(0, { x: 0.85, vx: 5 }), delta, noStep)
    expect(blocked.body.x).toBe(0.7)
    expect(blocked.body.vx).toBe(0)

    const explicit = options(() => true, { blockShapeAt: () => SLAB_SHAPE })
    const explicitResult = resolveBody(body({ y: 2.395, vy: -1 }), delta, explicit)
    expect(explicitResult.body.y).toBe(2.4)

    const empty = options(() => false)
    const free = resolveBody(body({ vx: 2, vy: -1, vz: -2 }), delta, empty)
    expect(free.body).toStrictEqual(body({ vx: 2, vy: -1, vz: -2 }))
    expect(free.isGrounded).toBe(false)
  })

  it('handles non-dynamic bodies, collections and the tunnelling speed bound', () => {
    const ground = options((_bx, by) => by === 0)
    const staticBody = restingBody(0, { kind: 'static', vy: -2 })
    const kinematicBody = restingBody(0, { kind: 'kinematic', vy: 2 })
    expect(resolveBody(staticBody, delta, ground)).toStrictEqual({ body: staticBody, isGrounded: true })
    expect(resolveBody(kinematicBody, delta, ground)).toStrictEqual({ body: kinematicBody, isGrounded: true })
    expect(resolveWorld([], delta, ground)).toStrictEqual([])
    expect(resolveWorld([staticBody, body()], delta, ground)).toHaveLength(2)
    expect(stepWorld([staticBody, body()], delta, ground)).toHaveLength(2)
    expect(stepBody(staticBody, delta, ground)).toStrictEqual({ body: staticBody, isGrounded: true })
    expect(maxSpeedWithoutTunnelling(0.3, 1, MAX_DELTA_SECS)).toBe((1.6) / MAX_DELTA_SECS)
  })
})
