import type { DeltaTimeSecs } from './quantities'

export const GRAVITY_Y = -9.82
export const TERMINAL_VELOCITY_Y = -32

export type BodyKind = 'dynamic' | 'static' | 'kinematic'

export type Body = {
  readonly kind: BodyKind
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
}

export const integrateBody = (body: Body, deltaTime: DeltaTimeSecs, gravityY = GRAVITY_Y): Body => {
  if (body.kind !== 'dynamic') {
    return body
  }
  const acceleratedY = body.vy + gravityY * deltaTime
  const clampedY = acceleratedY < TERMINAL_VELOCITY_Y ? TERMINAL_VELOCITY_Y : acceleratedY
  return {
    kind: body.kind,
    x: body.x + body.vx * deltaTime,
    y: body.y + clampedY * deltaTime,
    z: body.z + body.vz * deltaTime,
    vx: body.vx,
    vy: clampedY,
    vz: body.vz,
  }
}

export const integrate = (bodies: ReadonlyArray<Body>, deltaTime: DeltaTimeSecs, gravityY = GRAVITY_Y): ReadonlyArray<Body> =>
  bodies.map((body) => integrateBody(body, deltaTime, gravityY))

export const maxFallPerStep = (maxDeltaSecs: number): number => Math.abs(TERMINAL_VELOCITY_Y) * maxDeltaSecs
