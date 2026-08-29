import { itemStack, type ItemStack } from './inventory'
import type { FuelRule, SmeltingRecipe } from './smelting'

const stack = (item: Parameters<typeof itemStack>[0], count: number): ItemStack =>
  itemStack(item, count) as ItemStack

export const SMELTING_RECIPES: ReadonlyArray<SmeltingRecipe> = [
  { id: 'mc:iron-ingot', input: 'raw_iron', output: stack('iron_ingot', 1), cookDurationSecs: 10 },
  { id: 'mc:gold-ingot', input: 'raw_gold', output: stack('gold_ingot', 1), cookDurationSecs: 10 },
  { id: 'mc:stone', input: 'cobblestone', output: stack('stone', 1), cookDurationSecs: 10 },
  { id: 'mc:glass', input: 'sand', output: stack('glass', 1), cookDurationSecs: 10 },
  { id: 'mc:brick', input: 'clay', output: stack('brick', 1), cookDurationSecs: 10 },
  { id: 'mc:coal', input: 'coal_ore', output: stack('coal', 1), cookDurationSecs: 10 },
  { id: 'mc:coal-deepslate', input: 'deepslate_coal_ore', output: stack('coal', 1), cookDurationSecs: 10 },
  { id: 'mc:iron-ore', input: 'iron_ore', output: stack('iron_ingot', 1), cookDurationSecs: 10 },
  { id: 'mc:iron-ore-deepslate', input: 'deepslate_iron_ore', output: stack('iron_ingot', 1), cookDurationSecs: 10 },
  { id: 'mc:gold-ore', input: 'gold_ore', output: stack('gold_ingot', 1), cookDurationSecs: 10 },
  { id: 'mc:gold-ore-deepslate', input: 'deepslate_gold_ore', output: stack('gold_ingot', 1), cookDurationSecs: 10 },
  { id: 'mc:diamond-ore', input: 'diamond_ore', output: stack('diamond', 1), cookDurationSecs: 10 },
  { id: 'mc:diamond-ore-deepslate', input: 'deepslate_diamond_ore', output: stack('diamond', 1), cookDurationSecs: 10 },
  { id: 'mc:redstone-ore', input: 'redstone_ore', output: stack('redstone_dust', 1), cookDurationSecs: 10 },
  { id: 'mc:redstone-ore-deepslate', input: 'deepslate_redstone_ore', output: stack('redstone_dust', 1), cookDurationSecs: 10 },
  { id: 'mc:lapis-ore', input: 'lapis_ore', output: stack('lapis_lazuli', 1), cookDurationSecs: 10 },
  { id: 'mc:lapis-ore-deepslate', input: 'deepslate_lapis_ore', output: stack('lapis_lazuli', 1), cookDurationSecs: 10 },
  { id: 'mc:emerald-ore', input: 'emerald_ore', output: stack('emerald', 1), cookDurationSecs: 10 },
  { id: 'mc:emerald-ore-deepslate', input: 'deepslate_emerald_ore', output: stack('emerald', 1), cookDurationSecs: 10 },
  { id: 'mc:nether-brick', input: 'netherrack', output: stack('nether_brick', 1), cookDurationSecs: 10 },
]

export const FUEL_RULES: ReadonlyArray<FuelRule> = [
  { item: 'coal', burnDurationSecs: 80 },
  { item: 'coal_block', burnDurationSecs: 800 },
  { item: 'oak_log', burnDurationSecs: 15 },
  { item: 'oak_planks', burnDurationSecs: 15 },
  { item: 'stick', burnDurationSecs: 5 },
  { item: 'oak_stairs', burnDurationSecs: 15 },
  { item: 'crafting_table', burnDurationSecs: 15 },
  { item: 'chest', burnDurationSecs: 15 },
  { item: 'ladder', burnDurationSecs: 15 },
  { item: 'wooden_pickaxe', burnDurationSecs: 10 },
]
