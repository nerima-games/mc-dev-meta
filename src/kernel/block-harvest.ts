import type { BlockType } from './block-type'
import { itemOfBlock } from './block-item'
import type { ItemStackType, ItemType } from './item-type'

export const HARVEST_TOOL_CATEGORIES = ['none', 'pickaxe', 'axe', 'shovel', 'hoe', 'shears', 'sword'] as const
export type HarvestToolCategory = (typeof HARVEST_TOOL_CATEGORIES)[number]

export const HARVEST_TIERS = ['none', 'wooden', 'stone', 'iron', 'diamond'] as const
export type HarvestTier = (typeof HARVEST_TIERS)[number]

export type HarvestToolRequirement = {
  readonly category: HarvestToolCategory
  readonly minTier: HarvestTier
}

export const DEFAULT_HARVEST_TOOL: HarvestToolRequirement = {
  category: 'none',
  minTier: 'none',
}

export const BARE_HANDED: HarvestContext = {}

export type BlockDropRule = {
  readonly item: ItemType | 'self'
  readonly count: number
  readonly requiresSilkTouch: boolean
  readonly affectedByFortune: boolean
  readonly silkTouchItem?: ItemStackType
}

export const DEFAULT_BLOCK_DROP: BlockDropRule = {
  item: 'self',
  count: 1,
  requiresSilkTouch: false,
  affectedByFortune: false,
}

export type HarvestContext = {
  readonly heldCategory?: HarvestToolCategory
  readonly heldTier?: HarvestTier
  readonly silkTouch?: boolean
}

export type ResolvedDrop = {
  readonly item: ItemStackType
  readonly count: number
  readonly affectedByFortune: boolean
}

const HARVEST_TIER_RANK: Readonly<Record<HarvestTier, number>> = {
  none: 0,
  wooden: 1,
  stone: 2,
  iron: 3,
  diamond: 4,
}

export const satisfiesHarvestTier = (requirement: HarvestToolRequirement, context: HarvestContext): boolean => {
  if (requirement.category === 'none') {
    return true
  }
  if (context.heldCategory !== requirement.category) {
    return false
  }
  const heldTier = context.heldTier ?? 'none'
  return HARVEST_TIER_RANK[heldTier] >= HARVEST_TIER_RANK[requirement.minTier]
}

export const resolveDropItem = (rule: BlockDropRule, brokenBlock: BlockType): ItemType | undefined =>
  rule.item === 'self' ? itemOfBlock(brokenBlock) : rule.item

export const resolveDrop = (
  rule: BlockDropRule,
  brokenBlock: BlockType,
  context: HarvestContext = BARE_HANDED,
): ResolvedDrop | undefined => {
  if (rule.count <= 0) {
    return undefined
  }
  if (rule.requiresSilkTouch && context.silkTouch !== true) {
    return undefined
  }
  const item = context.silkTouch === true && rule.silkTouchItem !== undefined ? rule.silkTouchItem : resolveDropItem(rule, brokenBlock)
  return item === undefined ? undefined : { item, count: rule.count, affectedByFortune: rule.affectedByFortune }
}

export const resolveHarvestDrop = (
  rule: BlockDropRule,
  requirement: HarvestToolRequirement,
  brokenBlock: BlockType,
  context: HarvestContext = BARE_HANDED,
): ResolvedDrop | undefined => {
  if (rule.count <= 0 || !satisfiesHarvestTier(requirement, context)) {
    return undefined
  }
  if (rule.requiresSilkTouch && context.silkTouch !== true) {
    return undefined
  }
  const item = context.silkTouch === true && rule.silkTouchItem !== undefined ? rule.silkTouchItem : resolveDropItem(rule, brokenBlock)
  return item === undefined ? undefined : { item, count: rule.count, affectedByFortune: rule.affectedByFortune }
}
