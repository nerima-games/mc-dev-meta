import { DeltaTimeSecs as makeDeltaTime } from './quantities'

export { DeltaTimeSecs } from './quantities'

export const MIN_DELTA_SECS = 0.001
export const MAX_DELTA_SECS = 0.05
export const FIRST_FRAME_DELTA_SECS = 0.016

export const isClampedDelta = (deltaSecs: number): boolean =>
  Number.isFinite(deltaSecs) && (deltaSecs < MIN_DELTA_SECS || deltaSecs > MAX_DELTA_SECS)

export const clampDeltaTime = (raw: number): ReturnType<typeof makeDeltaTime> => {
  if (Number.isNaN(raw)) {
    return makeDeltaTime(FIRST_FRAME_DELTA_SECS)
  }
  return makeDeltaTime(Math.min(Math.max(MIN_DELTA_SECS, raw), MAX_DELTA_SECS))
}

export const deltaTimeBetween = (previous: number | undefined, current: number): ReturnType<typeof makeDeltaTime> =>
  previous === undefined ? makeDeltaTime(FIRST_FRAME_DELTA_SECS) : clampDeltaTime(current - previous)
