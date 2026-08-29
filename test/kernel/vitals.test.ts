import { describe, expect, it } from 'vitest'
import {
  addExhaustion,
  addExperience,
  advanceFoodTimer,
  applyDamage,
  cascadeExhaustion,
  eat,
  experienceCostOfLevel,
  experienceLevel,
  experienceProgress,
  heal,
  isDead,
  isValidVitals,
  levelForTotalExperience,
  normaliseVitals,
  respawn,
  SPAWN_VITALS,
  totalExperienceAtLevel,
  vitalsView,
  type Vitals,
} from '../../src/kernel/vitals'
import { DeltaTimeSecs } from '../../src/kernel/quantities'

const vitals = (overrides: Partial<Vitals> = {}): Vitals => ({
  ...SPAWN_VITALS,
  ...overrides,
})

describe('health and hunger transitions', () => {
  it('applies damage only to living targets and records a fatal cause', () => {
    const wounded = applyDamage(vitals(), { amount: 4, cause: 'fall' })
    expect(wounded.healthPoints).toBe(16)
    expect(wounded.lastDamageCause).toBeUndefined()
    expect(applyDamage(wounded, { amount: 20, cause: 'lava' }).healthPoints).toBe(0)
    expect(applyDamage(wounded, { amount: 20, cause: 'lava' }).lastDamageCause).toBe('lava')
    expect(applyDamage(vitals({ healthPoints: 0 }), { amount: 1, cause: 'void' })).toStrictEqual(
      vitals({ healthPoints: 0 }),
    )
    expect(applyDamage(vitals(), { amount: 0, cause: 'none' })).toStrictEqual(SPAWN_VITALS)
    expect(applyDamage(vitals(), { amount: Number.NaN, cause: 'none' })).toStrictEqual(SPAWN_VITALS)
    expect(isDead(vitals({ healthPoints: 0 }))).toBe(true)
    expect(isDead(vitals({ healthPoints: 1 }))).toBe(false)
  })

  it('heals living targets and clamps to maximum health', () => {
    expect(heal(vitals({ healthPoints: 0 }), 4)).toStrictEqual(vitals({ healthPoints: 0 }))
    expect(heal(vitals({ healthPoints: 10 }), 0)).toStrictEqual(vitals({ healthPoints: 10 }))
    expect(heal(vitals({ healthPoints: 10 }), Number.NaN)).toStrictEqual(vitals({ healthPoints: 10 }))
    expect(heal(vitals({ healthPoints: 10 }), 4).healthPoints).toBe(14)
    expect(heal(vitals({ healthPoints: 10 }), 999).healthPoints).toBe(20)
    expect(heal(vitals({ healthPoints: 10 }), Number.POSITIVE_INFINITY).healthPoints).toBe(20)
  })

  it('consumes saturation before hunger when exhaustion crosses food points', () => {
    const start = vitals({ saturation: 2, hungerPoints: 5 })
    expect(cascadeExhaustion(start, 7)).toMatchObject({
      saturation: 1,
      hungerPoints: 5,
      exhaustion: 3,
    })
    expect(cascadeExhaustion(start, 999)).toMatchObject({
      saturation: 0,
      hungerPoints: 0,
      exhaustion: 0,
    })
    expect(cascadeExhaustion(start, Number.NaN)).toStrictEqual({
      ...start,
      exhaustion: 0,
    })
    expect(addExhaustion(start, 0)).toStrictEqual(start)
    expect(addExhaustion(start, Number.NaN)).toStrictEqual(start)
    expect(addExhaustion(start, 5)).toMatchObject({ saturation: 1, exhaustion: 1 })
  })

  it('adds food and keeps saturation no higher than the resulting hunger', () => {
    const low = vitals({ hungerPoints: 2, saturation: 2 })
    expect(eat(low, 3, 0)).toMatchObject({ hungerPoints: 5, saturation: 2 })
    expect(eat(vitals({ hungerPoints: 19, saturation: 19 }), 5, 2)).toMatchObject({
      hungerPoints: 20,
      saturation: 20,
    })
    expect(eat(low, 0, 2)).toStrictEqual(low)
    expect(eat(low, Number.NaN, 2)).toStrictEqual(low)
    expect(eat(low, 3, Number.NaN)).toMatchObject({ hungerPoints: 5, saturation: 2 })
  })
})

describe('food timers and experience', () => {
  it('emits no signal until a food tick, then regenerates or starves', () => {
    const wounded = vitals({ healthPoints: 10, hungerPoints: 20 })
    const [earlySignal, early] = advanceFoodTimer(wounded, DeltaTimeSecs(1))
    expect(earlySignal).toBe('none')
    expect(early.foodTimerSecs).toBe(1)
    const [regenSignal, regenerated] = advanceFoodTimer(early, DeltaTimeSecs(3))
    expect(regenSignal).toBe('regen')
    expect(regenerated.healthPoints).toBe(10)
    expect(regenerated.saturation).toBe(4)
    expect(regenerated.exhaustion).toBe(2)
    expect(regenerated.foodTimerSecs).toBe(0)
    expect(advanceFoodTimer(vitals({ healthPoints: 20, hungerPoints: 20 }), DeltaTimeSecs(4))[0]).toBe('none')
    expect(advanceFoodTimer(vitals({ healthPoints: 0, hungerPoints: 0 }), DeltaTimeSecs(4))[0]).toBe('starve')
    expect(advanceFoodTimer(vitals({ healthPoints: 10, hungerPoints: 0 }), DeltaTimeSecs(4))[0]).toBe('starve')
    expect(advanceFoodTimer(vitals({ healthPoints: 10, hungerPoints: 10 }), DeltaTimeSecs(4))[0]).toBe('none')
  })

  it('uses the three vanilla experience curves and preserves total experience', () => {
    expect(experienceCostOfLevel(0)).toBe(7)
    expect(experienceCostOfLevel(15)).toBe(37)
    expect(experienceCostOfLevel(16)).toBe(42)
    expect(experienceCostOfLevel(30)).toBe(112)
    expect(experienceCostOfLevel(31)).toBe(121)
    expect(experienceCostOfLevel(-1)).toBe(7)
    expect(experienceCostOfLevel(Number.NaN)).toBe(7)
    expect(totalExperienceAtLevel(0)).toBe(0)
    expect(totalExperienceAtLevel(16)).toBe(352)
    expect(totalExperienceAtLevel(31)).toBe(1507)
    expect(totalExperienceAtLevel(32)).toBe(1628)
    expect(totalExperienceAtLevel(-1)).toBe(0)
    expect(levelForTotalExperience(0)).toBe(0)
    expect(levelForTotalExperience(352)).toBe(16)
    expect(levelForTotalExperience(1507)).toBe(31)
    expect(levelForTotalExperience(Number.NaN)).toBe(0)
    expect(levelForTotalExperience(Number.POSITIVE_INFINITY)).toBe(0)
    const earned = addExperience(vitals(), 352 + 10)
    expect(experienceLevel(earned)).toBe(16)
    expect(experienceProgress(earned)).toBeCloseTo(10 / 42, 12)
    expect(experienceProgress(vitals())).toBe(0)
    expect(addExperience(earned, 0)).toStrictEqual(earned)
    expect(addExperience(earned, Number.NaN)).toStrictEqual(earned)
    expect(vitalsView(earned)).toMatchObject({
      healthPoints: 20,
      hungerPoints: 20,
      experienceLevel: 16,
    })
  })
})

describe('vitals persistence and lifecycle', () => {
  it('validates every bounded field and optional damage cause', () => {
    expect(isValidVitals(SPAWN_VITALS)).toBe(true)
    const invalidCases: Array<Vitals> = [
      vitals({ healthPoints: -1 }),
      vitals({ maxHealthPoints: 0 }),
      vitals({ hungerPoints: 21 }),
      vitals({ maxHungerPoints: -1 }),
      vitals({ saturation: 21 }),
      vitals({ exhaustion: 4 }),
      vitals({ foodTimerSecs: 4 }),
      vitals({ totalExperience: -1 }),
      vitals({ lastDamageCause: 42 as unknown as string }),
    ]
    for (const invalid of invalidCases) {
      expect(isValidVitals(invalid)).toBe(false)
    }
    expect(isValidVitals(vitals({ lastDamageCause: 'fall' }))).toBe(true)
  })

  it('normalises malformed saves and restores spawn state', () => {
    const malformed = vitals({
      healthPoints: Number.NaN,
      maxHealthPoints: Number.NaN,
      hungerPoints: 99,
      maxHungerPoints: -1,
      saturation: Number.NaN,
      exhaustion: 9,
      foodTimerSecs: 9,
      totalExperience: -3,
      lastDamageCause: 42 as unknown as string,
    })
    expect(normaliseVitals(malformed)).toMatchObject({
      healthPoints: 0,
      maxHealthPoints: 20,
      hungerPoints: 0,
      maxHungerPoints: 0,
      saturation: 0,
      exhaustion: 1,
      foodTimerSecs: 1,
      totalExperience: 0,
      lastDamageCause: undefined,
    })
    expect(normaliseVitals(vitals({
      healthPoints: 50,
      maxHealthPoints: 30,
      hungerPoints: 50,
      maxHungerPoints: 30,
      saturation: 50,
      exhaustion: 2,
      foodTimerSecs: 2,
      totalExperience: 10,
      lastDamageCause: 'fall',
    }))).toMatchObject({
      healthPoints: 30,
      hungerPoints: 30,
      saturation: 30,
      exhaustion: 2,
      foodTimerSecs: 2,
      lastDamageCause: 'fall',
    })
    const dead = applyDamage(SPAWN_VITALS, { amount: 20, cause: 'void' })
    expect(respawn(dead)).toMatchObject({
      healthPoints: 20,
      hungerPoints: 20,
      saturation: 5,
      exhaustion: 0,
      foodTimerSecs: 0,
      lastDamageCause: undefined,
    })
  })
})
