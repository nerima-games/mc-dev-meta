import type { DeltaTimeSecs } from './quantities'

export const DEFAULT_MAX_HEALTH_POINTS = 20
export const DEFAULT_MAX_HUNGER_POINTS = 20
export const SPAWN_SATURATION = 5
export const EXHAUSTION_PER_POINT = 4
export const MAX_EXHAUSTION = 40
export const FOOD_TICK_SECS = 4
export const REGEN_HUNGER_THRESHOLD = 18
export const EXHAUSTION_PER_REGEN = 6

export type DamageCause = string

export type Damage = {
  readonly amount: number
  readonly cause: DamageCause
}

export type Vitals = {
  readonly healthPoints: number
  readonly maxHealthPoints: number
  readonly hungerPoints: number
  readonly maxHungerPoints: number
  readonly saturation: number
  readonly exhaustion: number
  readonly foodTimerSecs: number
  readonly totalExperience: number
  readonly lastDamageCause?: DamageCause | undefined
}

export type VitalsView = {
  readonly healthPoints: number
  readonly maxHealthPoints: number
  readonly hungerPoints: number
  readonly maxHungerPoints: number
  readonly experienceLevel: number
  readonly experienceProgress: number
}

export const SPAWN_VITALS: Vitals = {
  healthPoints: DEFAULT_MAX_HEALTH_POINTS,
  maxHealthPoints: DEFAULT_MAX_HEALTH_POINTS,
  hungerPoints: DEFAULT_MAX_HUNGER_POINTS,
  maxHungerPoints: DEFAULT_MAX_HUNGER_POINTS,
  saturation: SPAWN_SATURATION,
  exhaustion: 0,
  foodTimerSecs: 0,
  totalExperience: 0,
}

const hasMagnitude = (value: number): boolean =>
  typeof value === 'number' && !Number.isNaN(value)

const delta = (value: number): number => (hasMagnitude(value) ? value : 0)

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

export const isDead = (vitals: Vitals): boolean => vitals.healthPoints <= 0

export const applyDamage = (vitals: Vitals, damage: Damage): Vitals => {
  const amount = delta(damage.amount)
  if (isDead(vitals) || amount <= 0) {
    return vitals
  }
  const healthPoints = Math.max(0, vitals.healthPoints - amount)
  return {
    ...vitals,
    healthPoints,
    lastDamageCause: healthPoints <= 0 ? damage.cause : vitals.lastDamageCause,
  }
}

export const heal = (vitals: Vitals, amount: number): Vitals => {
  const healed = delta(amount)
  if (isDead(vitals) || healed <= 0) {
    return vitals
  }
  return {
    ...vitals,
    healthPoints: Math.min(vitals.maxHealthPoints, vitals.healthPoints + healed),
  }
}

export const cascadeExhaustion = (vitals: Vitals, exhaustion: number): Vitals => {
  let remaining = clamp(delta(exhaustion), 0, MAX_EXHAUSTION)
  let saturation = Math.max(0, vitals.saturation)
  let hungerPoints = Math.max(0, vitals.hungerPoints)
  while (remaining >= EXHAUSTION_PER_POINT) {
    remaining -= EXHAUSTION_PER_POINT
    if (saturation > 0) {
      saturation = Math.max(0, saturation - 1)
    } else {
      hungerPoints = Math.max(0, hungerPoints - 1)
    }
  }
  return { ...vitals, saturation, hungerPoints, exhaustion: remaining }
}

export const addExhaustion = (vitals: Vitals, amount: number): Vitals => {
  const added = delta(amount)
  return added <= 0 ? vitals : cascadeExhaustion(vitals, vitals.exhaustion + added)
}

export const eat = (vitals: Vitals, foodPoints: number, saturationModifier: number): Vitals => {
  const food = delta(foodPoints)
  if (food <= 0) {
    return vitals
  }
  return {
    ...vitals,
    hungerPoints: clamp(vitals.hungerPoints + food, 0, vitals.maxHungerPoints),
    saturation: clamp(
      vitals.saturation + food * delta(saturationModifier) * 2,
      0,
      clamp(vitals.hungerPoints + food, 0, vitals.maxHungerPoints),
    ),
  }
}

export type FoodTickSignal = 'none' | 'regen' | 'starve'

export const advanceFoodTimer = (
  vitals: Vitals,
  deltaTimeSecs: DeltaTimeSecs,
): readonly [FoodTickSignal, Vitals] => {
  const elapsed = Math.max(0, delta(deltaTimeSecs))
  const timer = vitals.foodTimerSecs + elapsed
  if (timer < FOOD_TICK_SECS) {
    return ['none', { ...vitals, foodTimerSecs: timer }]
  }
  const foodTimerSecs = timer % FOOD_TICK_SECS
  const canRegenerate =
    !isDead(vitals) &&
    vitals.healthPoints < vitals.maxHealthPoints &&
    vitals.hungerPoints >= REGEN_HUNGER_THRESHOLD
  if (canRegenerate) {
    return ['regen', addExhaustion({ ...vitals, foodTimerSecs }, EXHAUSTION_PER_REGEN)]
  }
  return vitals.hungerPoints <= 0
    ? ['starve', { ...vitals, foodTimerSecs }]
    : ['none', { ...vitals, foodTimerSecs }]
}

export const experienceCostOfLevel = (level: number): number => {
  const atLevel = Math.max(0, Math.floor(delta(level)))
  if (atLevel <= 15) {
    return atLevel * 2 + 7
  }
  if (atLevel <= 30) {
    return atLevel * 5 - 38
  }
  return atLevel * 9 - 158
}

export const totalExperienceAtLevel = (level: number): number => {
  const atLevel = Math.max(0, Math.floor(delta(level)))
  if (atLevel <= 16) {
    return atLevel * atLevel + atLevel * 6
  }
  if (atLevel <= 31) {
    return 352 + ((atLevel - 16) * (5 * atLevel - 1)) / 2
  }
  return 1507 + ((atLevel - 31) * (9 * atLevel - 46)) / 2
}

export const levelForTotalExperience = (totalExperience: number): number => {
  const total = Number.isFinite(totalExperience) ? Math.max(0, totalExperience) : 0
  let low = 0
  let high = 1
  while (totalExperienceAtLevel(high) <= total) {
    high *= 2
  }
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (totalExperienceAtLevel(middle) <= total) {
      low = middle
    } else {
      high = middle
    }
  }
  return low
}

export const experienceLevel = (vitals: Vitals): number =>
  levelForTotalExperience(vitals.totalExperience)

export const experienceProgress = (vitals: Vitals): number => {
  const level = experienceLevel(vitals)
  const total = Number.isFinite(vitals.totalExperience)
    ? Math.max(0, vitals.totalExperience)
    : 0
  const floor = totalExperienceAtLevel(level)
  return clamp(
    (total - floor) / experienceCostOfLevel(level),
    0,
    1,
  )
}

export const addExperience = (vitals: Vitals, amount: number): Vitals => {
  const awarded = delta(amount)
  return awarded <= 0
    ? vitals
    : { ...vitals, totalExperience: Math.max(0, vitals.totalExperience + awarded) }
}

export const respawn = (vitals: Vitals): Vitals => ({
  ...vitals,
  healthPoints: vitals.maxHealthPoints,
  hungerPoints: vitals.maxHungerPoints,
  saturation: Math.min(SPAWN_SATURATION, vitals.maxHungerPoints),
  exhaustion: 0,
  foodTimerSecs: 0,
  lastDamageCause: undefined,
})

export const isValidVitals = (vitals: Vitals): boolean =>
  Number.isFinite(vitals.healthPoints) &&
  Number.isFinite(vitals.maxHealthPoints) &&
  vitals.maxHealthPoints > 0 &&
  vitals.healthPoints >= 0 &&
  vitals.healthPoints <= vitals.maxHealthPoints &&
  Number.isFinite(vitals.hungerPoints) &&
  Number.isFinite(vitals.maxHungerPoints) &&
  vitals.maxHungerPoints >= 0 &&
  vitals.hungerPoints >= 0 &&
  vitals.hungerPoints <= vitals.maxHungerPoints &&
  Number.isFinite(vitals.saturation) &&
  vitals.saturation >= 0 &&
  vitals.saturation <= vitals.hungerPoints &&
  Number.isFinite(vitals.exhaustion) &&
  vitals.exhaustion >= 0 &&
  vitals.exhaustion < EXHAUSTION_PER_POINT &&
  Number.isFinite(vitals.foodTimerSecs) &&
  vitals.foodTimerSecs >= 0 &&
  vitals.foodTimerSecs < FOOD_TICK_SECS &&
  Number.isFinite(vitals.totalExperience) &&
  vitals.totalExperience >= 0 &&
  (vitals.lastDamageCause === undefined || typeof vitals.lastDamageCause === 'string')

export const normaliseVitals = (vitals: Vitals): Vitals => {
  const maxHealthPoints = Number.isFinite(vitals.maxHealthPoints)
    ? Math.max(1, vitals.maxHealthPoints)
    : DEFAULT_MAX_HEALTH_POINTS
  const maxHungerPoints = Number.isFinite(vitals.maxHungerPoints)
    ? Math.max(0, vitals.maxHungerPoints)
    : DEFAULT_MAX_HUNGER_POINTS
  const healthPoints = Number.isFinite(vitals.healthPoints)
    ? clamp(vitals.healthPoints, 0, maxHealthPoints)
    : 0
  const hungerPoints = Number.isFinite(vitals.hungerPoints)
    ? clamp(vitals.hungerPoints, 0, maxHungerPoints)
    : 0
  const saturation = Number.isFinite(vitals.saturation)
    ? clamp(vitals.saturation, 0, hungerPoints)
    : 0
  const exhaustion = Number.isFinite(vitals.exhaustion) && vitals.exhaustion >= 0
    ? vitals.exhaustion % EXHAUSTION_PER_POINT
    : 0
  const foodTimerSecs = Number.isFinite(vitals.foodTimerSecs) && vitals.foodTimerSecs >= 0
    ? vitals.foodTimerSecs % FOOD_TICK_SECS
    : 0
  const totalExperience = Number.isFinite(vitals.totalExperience)
    ? Math.max(0, vitals.totalExperience)
    : 0
  return {
    ...vitals,
    healthPoints,
    maxHealthPoints,
    hungerPoints,
    maxHungerPoints,
    saturation,
    exhaustion,
    foodTimerSecs,
    totalExperience,
    lastDamageCause:
      typeof vitals.lastDamageCause === 'string' ? vitals.lastDamageCause : undefined,
  }
}

export const vitalsView = (vitals: Vitals): VitalsView => ({
  healthPoints: vitals.healthPoints,
  maxHealthPoints: vitals.maxHealthPoints,
  hungerPoints: vitals.hungerPoints,
  maxHungerPoints: vitals.maxHungerPoints,
  experienceLevel: experienceLevel(vitals),
  experienceProgress: experienceProgress(vitals),
})
