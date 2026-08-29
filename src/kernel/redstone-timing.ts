import { clampPower, MAX_REDSTONE_POWER } from './redstone'

export const REDSTONE_TICK_DELAY = 2

export type TickSignal = {
  readonly atTick: number
  readonly power: number
  readonly delay?: number
  readonly duration?: number
}

export type TickPropagation =
  | { readonly kind: 'scheduled'; readonly tick: number; readonly power: number; readonly duration: number }
  | { readonly kind: 'cancelled'; readonly tick: number }
  | { readonly kind: 'rejected'; readonly reason: 'invalid-tick' | 'invalid-delay' | 'invalid-duration' }

export const propagateTick = (signal: TickSignal): TickPropagation => {
  if (!Number.isSafeInteger(signal.atTick) || signal.atTick < 0) {
    return { kind: 'rejected', reason: 'invalid-tick' }
  }
  const delay = signal.delay ?? REDSTONE_TICK_DELAY
  if (!Number.isSafeInteger(delay) || delay < 0) {
    return { kind: 'rejected', reason: 'invalid-delay' }
  }
  const duration = signal.duration ?? 1
  if (!Number.isSafeInteger(duration) || duration < 1) {
    return { kind: 'rejected', reason: 'invalid-duration' }
  }
  const tick = signal.atTick + delay
  if (clampPower(signal.power) === 0) {
    return { kind: 'cancelled', tick }
  }
  return { kind: 'scheduled', tick, power: Math.min(MAX_REDSTONE_POWER, clampPower(signal.power)), duration }
}
