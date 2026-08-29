export const DIMENSIONS = ['overworld', 'nether', 'the_end'] as const
export type DimensionId = (typeof DIMENSIONS)[number]

export type DimensionRules = Readonly<{
  minY: number
  maxYExclusive: number
  seaLevel: number
  hasSky: boolean
  hasCeiling: boolean
  respawnAllowed: boolean
  coordinateScale: number
}>

export const DIMENSION_RULES: Readonly<Record<DimensionId, DimensionRules>> = {
  overworld: {
    minY: -64,
    maxYExclusive: 320,
    seaLevel: 63,
    hasSky: true,
    hasCeiling: false,
    respawnAllowed: true,
    coordinateScale: 1,
  },
  nether: {
    minY: -64,
    maxYExclusive: 320,
    seaLevel: 32,
    hasSky: false,
    hasCeiling: true,
    respawnAllowed: false,
    coordinateScale: 8,
  },
  the_end: {
    minY: 0,
    maxYExclusive: 256,
    seaLevel: 0,
    hasSky: true,
    hasCeiling: false,
    respawnAllowed: false,
    coordinateScale: 1,
  },
}

const DIMENSION_SET: ReadonlySet<string> = new Set(DIMENSIONS)

const isDimensionId = (value: string): value is DimensionId => DIMENSION_SET.has(value)

export const dimensionRulesOf = (dimension: string): DimensionRules | undefined =>
  isDimensionId(dimension) ? DIMENSION_RULES[dimension] : undefined

export const isYInDimension = (dimension: string, y: number): boolean => {
  const rules = dimensionRulesOf(dimension)
  return (
    rules !== undefined &&
    Number.isSafeInteger(y) &&
    y >= rules.minY &&
    y < rules.maxYExclusive
  )
}
