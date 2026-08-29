import { describe, expect, it } from 'vitest'
import {
  advanceTime,
  dayLengthSecs,
  DEFAULT_DAY_LENGTH_SECS,
  INITIAL_TIME_STATE,
  isNightAt,
  isValidTimeState,
  MAX_DAY_LENGTH_SECS,
  MAX_TIME_FRACTION,
  MIN_DAY_LENGTH_SECS,
  moonPhase,
  normaliseTimeState,
  setDayLength,
  setDayLengthThenTimeOfDay,
  setTimeOfDay,
  TICKS_PER_SECOND,
  timeOfDay,
  type TimeState,
} from '../../src/kernel/time'
import { DeltaTimeSecs } from '../../src/kernel/quantities'

const stateAt = (seconds: number, fraction: number): TimeState =>
  setDayLengthThenTimeOfDay(INITIAL_TIME_STATE, seconds, fraction)

describe('time state contracts', () => {
  it('starts with the named default and exposes valid state boundaries', () => {
    expect(dayLengthSecs(INITIAL_TIME_STATE)).toBe(DEFAULT_DAY_LENGTH_SECS)
    expect(timeOfDay(INITIAL_TIME_STATE)).toBeCloseTo(0.3, 12)
    expect(isValidTimeState(INITIAL_TIME_STATE)).toBe(true)
    expect(isValidTimeState({ ticks: -1, dayLengthTicks: 24000 })).toBe(false)
    expect(isValidTimeState({ ticks: Number.NaN, dayLengthTicks: 24000 })).toBe(false)
    expect(isValidTimeState({ ticks: 0, dayLengthTicks: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isValidTimeState({ ticks: 0, dayLengthTicks: MIN_DAY_LENGTH_SECS * TICKS_PER_SECOND - 1 })).toBe(false)
    expect(isValidTimeState({ ticks: 0, dayLengthTicks: MAX_DAY_LENGTH_SECS * TICKS_PER_SECOND + 1 })).toBe(false)
  })

  it('repairs malformed persistence values without leaving an invalid denominator', () => {
    expect(normaliseTimeState(INITIAL_TIME_STATE)).toStrictEqual(INITIAL_TIME_STATE)
    expect(normaliseTimeState({ ticks: -1, dayLengthTicks: 24000 })).toStrictEqual({
      ticks: 0,
      dayLengthTicks: 24000,
    })
    expect(normaliseTimeState({ ticks: Number.POSITIVE_INFINITY, dayLengthTicks: Number.NaN })).toStrictEqual({
      ticks: 0,
      dayLengthTicks: 24000,
    })
    expect(normaliseTimeState({ ticks: 123, dayLengthTicks: Number.POSITIVE_INFINITY })).toStrictEqual({
      ticks: 123,
      dayLengthTicks: MAX_DAY_LENGTH_SECS * TICKS_PER_SECOND,
    })
    expect(normaliseTimeState({ ticks: 123, dayLengthTicks: null as unknown as number })).toStrictEqual({
      ticks: 123,
      dayLengthTicks: DEFAULT_DAY_LENGTH_SECS * TICKS_PER_SECOND,
    })
    expect(normaliseTimeState({ ticks: 123, dayLengthTicks: undefined as unknown as number })).toStrictEqual({
      ticks: 123,
      dayLengthTicks: DEFAULT_DAY_LENGTH_SECS * TICKS_PER_SECOND,
    })
    expect(isValidTimeState(normaliseTimeState({ ticks: Number.NaN, dayLengthTicks: Number.NaN }))).toBe(true)
  })
})

describe('time setters and progression', () => {
  it('clamps day length and fraction independently', () => {
    expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, 1))).toBe(MIN_DAY_LENGTH_SECS)
    expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, 999_999))).toBe(MAX_DAY_LENGTH_SECS)
    expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, Number.POSITIVE_INFINITY))).toBe(MAX_DAY_LENGTH_SECS)
    expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, Number.NaN))).toBe(DEFAULT_DAY_LENGTH_SECS)
    expect(timeOfDay(setTimeOfDay(INITIAL_TIME_STATE, -1))).toBe(0)
    expect(timeOfDay(setTimeOfDay(INITIAL_TIME_STATE, 1))).toBeCloseTo(MAX_TIME_FRACTION, 12)
    expect(timeOfDay(setTimeOfDay(INITIAL_TIME_STATE, Number.POSITIVE_INFINITY))).toBeCloseTo(MAX_TIME_FRACTION, 12)
    expect(timeOfDay(setTimeOfDay(INITIAL_TIME_STATE, Number.NaN))).toBe(0)
  })

  it('installs a new denominator before applying a requested fraction', () => {
    const combined = setDayLengthThenTimeOfDay(INITIAL_TIME_STATE, 600, 0.3)
    const manual = setTimeOfDay(setDayLength(INITIAL_TIME_STATE, 600), 0.3)
    expect(combined).toStrictEqual(manual)
    expect(dayLengthSecs(combined)).toBe(600)
    expect(timeOfDay(combined)).toBeCloseTo(0.3, 12)
    expect(timeOfDay(setDayLength(setTimeOfDay(INITIAL_TIME_STATE, 0.3), 600))).toBeCloseTo(0.2, 12)
  })

  it('advances absolute ticks and wraps only the derived day values', () => {
    const start = stateAt(MAX_DAY_LENGTH_SECS, 0)
    const oneDay = advanceTime(start, DeltaTimeSecs(MAX_DAY_LENGTH_SECS))
    expect(oneDay.ticks).toBe(MAX_DAY_LENGTH_SECS * TICKS_PER_SECOND)
    expect(timeOfDay(oneDay)).toBe(0)
    expect(moonPhase(start)).toBe(0)
    expect(moonPhase(advanceTime(start, DeltaTimeSecs(MAX_DAY_LENGTH_SECS * 3)))).toBe(3)
    expect(moonPhase(advanceTime(start, DeltaTimeSecs(MAX_DAY_LENGTH_SECS * 8)))).toBe(0)
    expect(advanceTime(start, DeltaTimeSecs(0))).toStrictEqual(start)
  })

  it('classifies the night boundary on both sides', () => {
    expect(isNightAt(stateAt(1200, 0))).toBe(true)
    expect(isNightAt(stateAt(1200, 0.1))).toBe(true)
    expect(isNightAt(stateAt(1200, 0.25))).toBe(false)
    expect(isNightAt(stateAt(1200, 0.5))).toBe(false)
    expect(isNightAt(stateAt(1200, 0.75))).toBe(false)
    expect(isNightAt(stateAt(1200, 0.9))).toBe(true)
  })
})
