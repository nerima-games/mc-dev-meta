export const MAX_POWER_LEVEL = 15
export const MAX_REDSTONE_POWER = MAX_POWER_LEVEL

export type PowerLevel = number
export type RedstoneNodeKey = string

export const clampPower = (value: number): PowerLevel => {
  if (!Number.isFinite(value)) {
    return value === Number.POSITIVE_INFINITY ? MAX_POWER_LEVEL : 0
  }
  return Math.min(MAX_POWER_LEVEL, Math.max(0, Math.trunc(value)))
}

export const decayPower = (power: PowerLevel, distance = 1): PowerLevel => {
  const normalizedDistance = Number.isFinite(distance)
    ? Math.max(0, Math.trunc(distance))
    : MAX_POWER_LEVEL + 1
  return clampPower(power - normalizedDistance)
}

export type RedstoneAdjacency = ReadonlyMap<RedstoneNodeKey, ReadonlyArray<RedstoneNodeKey>>

export const propagateRedstonePower = (
  sources: ReadonlyMap<RedstoneNodeKey, PowerLevel>,
  adjacency: RedstoneAdjacency,
): ReadonlyMap<RedstoneNodeKey, PowerLevel> => {
  const power = new Map<RedstoneNodeKey, PowerLevel>()
  const queue: Array<{ readonly key: RedstoneNodeKey; readonly power: PowerLevel }> = []

  for (const [key, source] of sources) {
    const level = clampPower(source)
    power.set(key, level)
    if (level > 0) {
      queue.push({ key, power: level })
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    const next = decayPower(current.power)
    if (next === 0) {
      continue
    }
    for (const neighbour of adjacency.get(current.key) ?? []) {
      const previous = power.get(neighbour) ?? 0
      if (next > previous) {
        power.set(neighbour, next)
        queue.push({ key: neighbour, power: next })
      }
    }
  }

  return power
}
