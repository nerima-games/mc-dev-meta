import {
  addItemStack,
  countItem,
  removeItemStack,
  type Inventory,
  type ItemStack,
} from './inventory'
import { isItemType, type ItemType } from './item-type'

export type Ingredient =
  | { readonly kind: 'item'; readonly item: ItemType }
  | { readonly kind: 'tag'; readonly tag: string }

export type IngredientTagCatalog = ReadonlyMap<string, ReadonlySet<ItemType>>

export const CRAFTING_TAGS: IngredientTagCatalog = new Map([
  ['logs', new Set<ItemType>(['oak_log'])],
  ['planks', new Set<ItemType>(['oak_planks'])],
  ['stone_materials', new Set<ItemType>(['stone', 'cobblestone', 'granite', 'diorite', 'andesite'])],
  ['coals', new Set<ItemType>(['coal'])],
])

export const exactly = (item: ItemType): Ingredient => ({ kind: 'item', item })
export const tagged = (tag: string): Ingredient => ({ kind: 'tag', tag })

export const ingredientMatches = (
  ingredient: Ingredient,
  item: ItemType,
  catalog: IngredientTagCatalog = CRAFTING_TAGS,
): boolean => {
  if (!isItemType(item)) {
    return false
  }
  return ingredient.kind === 'item'
    ? ingredient.item === item
    : (catalog.get(ingredient.tag)?.has(item) ?? false)
}

export type CraftGrid = ReadonlyArray<ItemStack | undefined>

export const craftGrid = (cells: ReadonlyArray<ItemStack | undefined>): CraftGrid =>
  Array.from({ length: 9 }, (_, index) => cells[index])

export type ShapedRecipe = {
  readonly kind: 'shaped'
  readonly id: string
  readonly pattern: ReadonlyArray<ReadonlyArray<Ingredient | undefined>>
  readonly output: ItemStack
}

export type ShapelessRecipe = {
  readonly kind: 'shapeless'
  readonly id: string
  readonly ingredients: ReadonlyArray<Ingredient>
  readonly output: ItemStack
}

export type CraftRecipe = ShapedRecipe | ShapelessRecipe

export const shapedRecipe = (
  id: string,
  pattern: ReadonlyArray<ReadonlyArray<Ingredient | undefined>>,
  output: ItemStack,
): ShapedRecipe => ({ kind: 'shaped', id, pattern, output })

export const shapelessRecipe = (
  id: string,
  ingredients: ReadonlyArray<Ingredient>,
  output: ItemStack,
): ShapelessRecipe => ({ kind: 'shapeless', id, ingredients, output })

const cellAt = (grid: CraftGrid, x: number, y: number): ItemStack | undefined => grid[y * 3 + x]

const occupiedBounds = (grid: CraftGrid): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | undefined => {
  let minX = 3
  let minY = 3
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      if (cellAt(grid, x, y) === undefined) {
        continue
      }
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < 0 ? undefined : { minX, minY, maxX, maxY }
}

const shapedFits = (
  recipe: ShapedRecipe,
  grid: CraftGrid,
  bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
  mirror: boolean,
  catalog: IngredientTagCatalog,
): boolean => {
  const height = recipe.pattern.length
  const width = recipe.pattern[0]?.length ?? 0
  if (width < 1 || width > 3 || height < 1 || height > 3) {
    return false
  }
  if (bounds.maxX - bounds.minX + 1 !== width || bounds.maxY - bounds.minY + 1 !== height) {
    return false
  }
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const patternX = x - bounds.minX
      const patternY = y - bounds.minY
      const expected = patternY >= 0 && patternY < height && patternX >= 0 && patternX < width
        ? recipe.pattern[patternY]?.[mirror ? width - patternX - 1 : patternX]
        : undefined
      const actual = cellAt(grid, x, y)
      if (expected === undefined ? actual !== undefined : actual === undefined || !ingredientMatches(expected, actual.item, catalog)) {
        return false
      }
    }
  }
  return true
}

const matchesShaped = (
  recipe: ShapedRecipe,
  grid: CraftGrid,
  catalog: IngredientTagCatalog,
): boolean => {
  const bounds = occupiedBounds(grid)
  return bounds !== undefined && (shapedFits(recipe, grid, bounds, false, catalog) || shapedFits(recipe, grid, bounds, true, catalog))
}

const occupiedItems = (grid: CraftGrid): ReadonlyArray<ItemType> => {
  const items: Array<ItemType> = []
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const slot = cellAt(grid, x, y)
      if (slot !== undefined) {
        items.push(slot.item)
      }
    }
  }
  return items
}

const matchesShapeless = (
  recipe: ShapelessRecipe,
  grid: CraftGrid,
  catalog: IngredientTagCatalog,
): boolean => {
  const items = occupiedItems(grid)
  if (items.length === 0 || items.length !== recipe.ingredients.length) {
    return false
  }
  const used = items.map(() => false)
  const assign = (index: number): boolean => {
    const ingredient = recipe.ingredients[index]
    if (ingredient === undefined) {
      return true
    }
    for (let candidate = 0; candidate < items.length; candidate += 1) {
      const item = items[candidate]
      if (used[candidate] === true || item === undefined || !ingredientMatches(ingredient, item, catalog)) {
        continue
      }
      used[candidate] = true
      if (assign(index + 1)) {
        return true
      }
      used[candidate] = false
    }
    return false
  }
  return assign(0)
}

const matches = (recipe: CraftRecipe, grid: CraftGrid, catalog: IngredientTagCatalog): boolean =>
  recipe.kind === 'shaped' ? matchesShaped(recipe, grid, catalog) : matchesShapeless(recipe, grid, catalog)

const ingredientCost = (grid: CraftGrid): ReadonlyMap<ItemType, number> => {
  const cost = new Map<ItemType, number>()
  for (const item of occupiedItems(grid)) {
    cost.set(item, (cost.get(item) ?? 0) + 1)
  }
  return cost
}

export type CraftResult =
  | { readonly kind: 'crafted'; readonly recipeId: string; readonly output: ItemStack }
  | { readonly kind: 'no-match' }
  | { readonly kind: 'missing'; readonly item: ItemType; readonly short: number }
  | { readonly kind: 'no-room' }

export type CraftOutcome = {
  readonly inventory: Inventory
  readonly result: CraftResult
}

export const craftRecipe = (
  inventory: Inventory,
  recipes: ReadonlyArray<CraftRecipe>,
  grid: CraftGrid,
  catalog: IngredientTagCatalog = CRAFTING_TAGS,
): CraftOutcome => {
  const recipe = recipes.find((candidate) => matches(candidate, grid, catalog))
  if (recipe === undefined) {
    return { inventory, result: { kind: 'no-match' } }
  }
  for (const [item, needed] of ingredientCost(grid)) {
    const short = needed - countItem(inventory, item)
    if (short > 0) {
      return { inventory, result: { kind: 'missing', item, short } }
    }
  }
  let charged = inventory
  for (const [item, needed] of ingredientCost(grid)) {
    charged = removeItemStack(charged, item, needed).inventory
  }
  const produced = addItemStack(charged, recipe.output)
  if (produced.leftover > 0) {
    return { inventory, result: { kind: 'no-room' } }
  }
  return {
    inventory: produced.inventory,
    result: { kind: 'crafted', recipeId: recipe.id, output: recipe.output },
  }
}
