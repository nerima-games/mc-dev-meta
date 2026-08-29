import { describe, expect, it } from 'vitest'

import {
  DAWN_FRACTION,
  DUSK_FRACTION,
  NOON_FRACTION,
  TWILIGHT_BAND,
  dayPhase,
  hostileSpawnsAllowed,
  isNight,
} from '../../src/kernel/day-night'

describe('day and night rules', () => {
  it('publishes the vanilla cycle boundaries', () => {
    expect([DAWN_FRACTION, NOON_FRACTION, DUSK_FRACTION, TWILIGHT_BAND]).toEqual([0.25, 0.5, 0.75, 0.05])
  })

  it('classifies the night boundary and aliases hostile spawning to it', () => {
    expect(isNight(DAWN_FRACTION)).toBe(false)
    expect(isNight(DUSK_FRACTION)).toBe(false)
    expect(isNight(DAWN_FRACTION - 0.001)).toBe(true)
    expect(isNight(DUSK_FRACTION + 0.001)).toBe(true)
    expect(hostileSpawnsAllowed(0.9)).toBe(true)
    expect(hostileSpawnsAllowed(NOON_FRACTION)).toBe(false)
  })

  it('distinguishes twilight from ordinary daylight', () => {
    expect(dayPhase(0.1)).toBe('night')
    expect(dayPhase(DAWN_FRACTION + TWILIGHT_BAND / 2)).toBe('dawn')
    expect(dayPhase(NOON_FRACTION)).toBe('day')
    expect(dayPhase(DUSK_FRACTION - TWILIGHT_BAND / 2)).toBe('dusk')
    expect(dayPhase(0.99)).toBe('night')
  })
})
