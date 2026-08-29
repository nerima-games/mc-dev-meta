import { MAX_POWER_LEVEL, type PowerLevel } from './redstone'

export type ComparatorMode = 'compare' | 'subtract'

export const comparatorOutput = (
  rear: PowerLevel,
  sides: ReadonlyArray<PowerLevel>,
  mode: ComparatorMode,
): PowerLevel => {
  let strongestSide = 0
  for (const side of sides) {
    if (side > strongestSide) {
      strongestSide = side
    }
  }

  if (mode === 'subtract') {
    return Math.max(0, rear - strongestSide)
  }

  return rear >= strongestSide ? rear : 0
}

export type ContainerSlot = {
  readonly count: number
  readonly maxStack: number
}

export const CONTAINER_SIGNAL_FLOOR = 1
export const CONTAINER_SIGNAL_SPAN = 14

export const containerSignalStrength = (slots: ReadonlyArray<ContainerSlot>): PowerLevel => {
  if (slots.length === 0) {
    return 0
  }

  let fullness = 0
  let held = 0
  for (const slot of slots) {
    if (!Number.isFinite(slot.count) || !Number.isFinite(slot.maxStack) || slot.maxStack <= 0) {
      continue
    }
    const count = Math.min(Math.max(0, slot.count), slot.maxStack)
    if (count > 0) {
      held += count
      fullness += count / slot.maxStack
    }
  }

  if (held === 0) {
    return 0
  }

  return Math.min(
    MAX_POWER_LEVEL,
    Math.floor(CONTAINER_SIGNAL_FLOOR + (fullness / slots.length) * CONTAINER_SIGNAL_SPAN),
  )
}
