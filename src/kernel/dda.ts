import { Option } from 'effect'
import type { Vec3 } from './physics-coordinates'

export type VoxelHit = {
  readonly bx: number
  readonly by: number
  readonly bz: number
  readonly normal: Vec3
  readonly distance: number
  readonly point: Vec3
}

export type IsTargetable = (bx: number, by: number, bz: number) => boolean

const EPSILON = 1e-12

export const voxelRaycast = (
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  isTargetable: IsTargetable,
): Option.Option<VoxelHit> => {
  const length = Math.hypot(direction.x, direction.y, direction.z)
  if (!Number.isFinite(length) || length < EPSILON || !(maxDistance > 0)) {
    return Option.none()
  }
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) {
    return Option.none()
  }

  const dx = direction.x / length
  const dy = direction.y / length
  const dz = direction.z / length
  let cellX = Math.floor(origin.x)
  let cellY = Math.floor(origin.y)
  let cellZ = Math.floor(origin.z)
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx)
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy)
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz)
  let tMaxX = stepX === 0 ? Infinity : (stepX > 0 ? cellX + 1 - origin.x : origin.x - cellX) * tDeltaX
  let tMaxY = stepY === 0 ? Infinity : (stepY > 0 ? cellY + 1 - origin.y : origin.y - cellY) * tDeltaY
  let tMaxZ = stepZ === 0 ? Infinity : (stepZ > 0 ? cellZ + 1 - origin.z : origin.z - cellZ) * tDeltaZ
  const maxSteps = Math.ceil(maxDistance * (Math.abs(dx) + Math.abs(dy) + Math.abs(dz))) + 3

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    let travelled: number
    let normalX = 0
    let normalY = 0
    let normalZ = 0
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      travelled = tMaxX
      cellX += stepX
      tMaxX += tDeltaX
      normalX = -stepX
    } else if (tMaxY <= tMaxZ) {
      travelled = tMaxY
      cellY += stepY
      tMaxY += tDeltaY
      normalY = -stepY
    } else {
      travelled = tMaxZ
      cellZ += stepZ
      tMaxZ += tDeltaZ
      normalZ = -stepZ
    }
    if (travelled > maxDistance) {
      return Option.none()
    }
    if (!isTargetable(cellX, cellY, cellZ)) {
      continue
    }
    return Option.some({
      bx: cellX,
      by: cellY,
      bz: cellZ,
      normal: { x: normalX, y: normalY, z: normalZ },
      distance: travelled,
      point: { x: origin.x + dx * travelled, y: origin.y + dy * travelled, z: origin.z + dz * travelled },
    })
  }
  return Option.none()
}
