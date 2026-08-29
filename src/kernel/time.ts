import type { DeltaTimeSecs } from './quantities'

export const TICKS_PER_SECOND = 60
export const MIN_DAY_LENGTH_SECS = 120
export const MAX_DAY_LENGTH_SECS = 1200
export const MAX_TIME_FRACTION = 0.9999
export const MOON_PHASE_COUNT = 8
export const DEFAULT_DAY_LENGTH_SECS = 400

export type TimeState = {
  readonly ticks: number
  readonly dayLengthTicks: number
}

export const INITIAL_TIME_STATE: TimeState = {
  ticks: 7200,
  dayLengthTicks: 24000,
}

const hasMagnitude = (value: number): boolean =>
  typeof value === 'number' && !Number.isNaN(value)

const clampDayLengthSecs = (seconds: number): number =>
  hasMagnitude(seconds)
    ? Math.max(MIN_DAY_LENGTH_SECS, Math.min(MAX_DAY_LENGTH_SECS, seconds))
    : DEFAULT_DAY_LENGTH_SECS

const clampFraction = (fraction: number): number =>
  hasMagnitude(fraction) ? Math.max(0, Math.min(MAX_TIME_FRACTION, fraction)) : 0

export const isValidTimeState = (state: TimeState): boolean =>
  Number.isFinite(state.ticks) &&
  state.ticks >= 0 &&
  Number.isFinite(state.dayLengthTicks) &&
  state.dayLengthTicks >= MIN_DAY_LENGTH_SECS * TICKS_PER_SECOND &&
  state.dayLengthTicks <= MAX_DAY_LENGTH_SECS * TICKS_PER_SECOND

export const normaliseTimeState = (state: TimeState): TimeState => ({
  ticks: Number.isFinite(state.ticks) && state.ticks >= 0 ? state.ticks : 0,
  dayLengthTicks:
    clampDayLengthSecs(
      typeof state.dayLengthTicks === 'number'
        ? state.dayLengthTicks / TICKS_PER_SECOND
        : Number.NaN,
    ) * TICKS_PER_SECOND,
})

export const timeOfDay = (state: TimeState): number =>
  (state.ticks % state.dayLengthTicks) / state.dayLengthTicks

export const dayLengthSecs = (state: TimeState): number =>
  state.dayLengthTicks / TICKS_PER_SECOND

export const moonPhase = (state: TimeState): number =>
  Math.floor(state.ticks / state.dayLengthTicks) % MOON_PHASE_COUNT

export const isNightAt = (state: TimeState): boolean => {
  const fraction = timeOfDay(state)
  return fraction < 0.25 || fraction > 0.75
}

export const advanceTime = (state: TimeState, delta: DeltaTimeSecs): TimeState => ({
  ...state,
  ticks: state.ticks + delta * TICKS_PER_SECOND,
})

export const setDayLength = (state: TimeState, seconds: number): TimeState => ({
  ...state,
  dayLengthTicks: clampDayLengthSecs(seconds) * TICKS_PER_SECOND,
})

export const setTimeOfDay = (state: TimeState, fraction: number): TimeState => ({
  ...state,
  ticks: clampFraction(fraction) * state.dayLengthTicks,
})

export const setDayLengthThenTimeOfDay = (
  state: TimeState,
  seconds: number,
  fraction: number,
): TimeState => setTimeOfDay(setDayLength(state, seconds), fraction)
