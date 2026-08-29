import { blockPosition, type BlockPosition } from './coordinates'
import { blockCapabilitiesOf, blockPropertiesOf } from './block-registry'
import type { BlockType } from './block-type'
import type { FluidKind } from './block-properties'

export const ACTIVE_FLUID_KINDS = ['water', 'lava'] as const
export type ActiveFluidKind = (typeof ACTIVE_FLUID_KINDS)[number]

export type FluidCellKey = string

export type FluidWorkItem = {
  readonly key: FluidCellKey
  readonly kind: ActiveFluidKind
}

export const DEFAULT_FLUID_FRONTIER_BUDGET = 64

export type FluidBudgetSplit = {
  readonly work: ReadonlyArray<FluidWorkItem>
  readonly retainedLavaFrontier: ReadonlyArray<FluidCellKey>
}

export const isActiveFluidKind = (kind: FluidKind): kind is ActiveFluidKind => kind !== 'none'

export const fluidCellKeyOf = (position: BlockPosition): FluidCellKey =>
  `${position.x},${position.y},${position.z}`

export const fluidPositionOfKey = (key: FluidCellKey): BlockPosition | undefined => {
  const parts = key.split(',')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return undefined
  }

  const values = parts.map((part) => Number(part))
  if (values.some((value) => !Number.isSafeInteger(value))) {
    return undefined
  }

  return blockPosition(values[0]!, values[1]!, values[2]!)
}

export const fluidNeighboursOf = (position: BlockPosition): ReadonlyArray<BlockPosition> => [
  blockPosition(position.x, position.y - 1, position.z),
  blockPosition(position.x + 1, position.y, position.z),
  blockPosition(position.x - 1, position.y, position.z),
  blockPosition(position.x, position.y, position.z + 1),
  blockPosition(position.x, position.y, position.z - 1),
]

export const splitFluidBudget = (
  frontier: ReadonlyArray<FluidWorkItem>,
  options: {
    readonly budget?: number
    readonly lavaTickActive: boolean
  },
): FluidBudgetSplit => {
  const budget = Math.max(0, Math.trunc(options.budget ?? DEFAULT_FLUID_FRONTIER_BUDGET))
  const water: Array<FluidWorkItem> = []
  const lava: Array<FluidWorkItem> = []

  for (const item of frontier) {
    if (item.kind === 'water') {
      water.push(item)
    } else {
      lava.push(item)
    }
  }

  const waterSliceLength = Math.min(water.length, Math.floor(budget / 2))
  const lavaAvailable = options.lavaTickActive ? lava.length : 0
  const lavaSliceLength = Math.min(lavaAvailable, budget - waterSliceLength)
  const work: Array<FluidWorkItem> = [
    ...water.slice(0, waterSliceLength),
    ...lava.slice(0, lavaSliceLength),
  ]
  const retainedLavaFrontier = options.lavaTickActive ? [] : lava.map((item) => item.key)

  return { work, retainedLavaFrontier }
}

export const carryOverFluidFrontier = (
  frontier: ReadonlyArray<FluidWorkItem>,
  split: FluidBudgetSplit,
): ReadonlyArray<FluidWorkItem> => {
  const evaluated = new Set(split.work.map((item) => item.key))
  return frontier.filter((item) => !evaluated.has(item.key))
}

export const splitBudget = splitFluidBudget
export const carryOver = carryOverFluidFrontier

export const FLUID_LEVEL_MIN = 1
export const FLUID_LEVEL_MAX = 8
export const FLUID_SOURCE_LEVEL = FLUID_LEVEL_MAX

export type FluidState = {
  readonly kind: ActiveFluidKind
  readonly level: number
  readonly source: boolean
}

export const createFluidState = (
  kind: FluidKind,
  level: number,
  source = false,
): FluidState | undefined => {
  if (!isActiveFluidKind(kind) || !Number.isInteger(level)) {
    return undefined
  }
  if (level < FLUID_LEVEL_MIN || level > FLUID_LEVEL_MAX) {
    return undefined
  }
  return { kind, level, source }
}

export const fluidStateForBlock = (type: BlockType, level = FLUID_SOURCE_LEVEL): FluidState | undefined => {
  const kind = blockPropertiesOf(type).fluid
  return isActiveFluidKind(kind) ? createFluidState(kind, level, true) : undefined
}

export const canFluidEnter = (target: BlockType, kind: ActiveFluidKind): boolean => {
  const properties = blockPropertiesOf(target)
  if (properties.fluid === kind) {
    return false
  }
  return properties.fluid === 'none' && blockCapabilitiesOf(target).replaceable
}

export const flowInto = (source: FluidState, target: BlockType): FluidState | undefined => {
  if (!canFluidEnter(target, source.kind)) {
    return undefined
  }
  const nextLevel = source.source ? FLUID_SOURCE_LEVEL - 1 : source.level - 1
  return createFluidState(source.kind, nextLevel)
}
