import { MAX_POWER_LEVEL, type PowerLevel } from './redstone'

export type PlateWeighing =
  | { readonly kind: 'binary' }
  | { readonly kind: 'weighted'; readonly capacity: number }

export const LIGHT_PLATE_CAPACITY = 15
export const HEAVY_PLATE_CAPACITY = 150

export const plateSignal = (occupants: number, weighing: PlateWeighing): PowerLevel => {
  if (!Number.isFinite(occupants) || occupants <= 0) {
    return 0
  }

  if (weighing.kind === 'binary') {
    return MAX_POWER_LEVEL
  }

  const { capacity } = weighing
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return MAX_POWER_LEVEL
  }

  return Math.min(MAX_POWER_LEVEL, Math.ceil((occupants / capacity) * MAX_POWER_LEVEL))
}
