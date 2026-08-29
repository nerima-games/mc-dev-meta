export const DAWN_FRACTION = 0.25
export const NOON_FRACTION = 0.5
export const DUSK_FRACTION = 0.75
export const TWILIGHT_BAND = 0.05

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk'

export const isNight = (timeOfDay: number): boolean =>
  timeOfDay < DAWN_FRACTION || timeOfDay > DUSK_FRACTION

export const dayPhase = (timeOfDay: number): DayPhase => {
  if (isNight(timeOfDay)) {
    return 'night'
  }
  if (timeOfDay < DAWN_FRACTION + TWILIGHT_BAND) {
    return 'dawn'
  }
  if (timeOfDay > DUSK_FRACTION - TWILIGHT_BAND) {
    return 'dusk'
  }
  return 'day'
}

export const hostileSpawnsAllowed = (timeOfDay: number): boolean => isNight(timeOfDay)
