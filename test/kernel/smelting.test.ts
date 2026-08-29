import { describe, expect, it } from 'vitest'
import {
  addItemStack,
  emptyInventory,
  INVENTORY_SLOT_COUNT,
  itemStack,
  type Inventory,
  type ItemStack,
} from '../../src/kernel/inventory'
import {
  advanceFurnace,
  collectFurnaceOutput,
  emptyFurnaceState,
  matchSmeltingRecipe,
  transferToFurnace,
  validateFurnaceSnapshot,
  type FuelRule,
  type FurnaceState,
  type SmeltingRecipe,
} from '../../src/kernel/smelting'
import { FUEL_RULES, SMELTING_RECIPES } from '../../src/kernel/smelting-data'
import type { ItemType } from '../../src/kernel/item-type'

const stack = (item: ItemType, count = 1): ItemStack => itemStack(item, count) as ItemStack

const inventoryWith = (...items: ItemStack[]): Inventory =>
  items.reduce((inventory, item) => addItemStack(inventory, item).inventory, emptyInventory())

const fullInventory = (): Inventory => ({
  slots: Array.from({ length: INVENTORY_SLOT_COUNT }, () => stack('stone', 64)),
})

const furnace = (overrides: Partial<FurnaceState> = {}): FurnaceState => ({
  ...emptyFurnaceState(),
  ...overrides,
})

describe('smelting definitions', () => {
  it('covers the portable recipe and fuel definitions', () => {
    expect(SMELTING_RECIPES).toHaveLength(20)
    expect(new Set(SMELTING_RECIPES.map((recipe) => recipe.input)).size).toBe(SMELTING_RECIPES.length)
    expect(matchSmeltingRecipe(SMELTING_RECIPES, stack('raw_iron'))).toMatchObject({
      id: 'mc:iron-ingot',
      output: stack('iron_ingot'),
      cookDurationSecs: 10,
    })
    expect(matchSmeltingRecipe(SMELTING_RECIPES, stack('stick'))).toBeNull()
    expect(matchSmeltingRecipe(SMELTING_RECIPES, null)).toBeNull()
    expect(FUEL_RULES).toHaveLength(10)
    expect(FUEL_RULES.find((rule) => rule.item === 'coal_block')).toStrictEqual({
      item: 'coal_block',
      burnDurationSecs: 800,
    })
  })
})

describe('furnace inventory transfers', () => {
  it('moves matching stacks into the input and fuel slots', () => {
    const initialInventory = inventoryWith(stack('raw_iron', 3), stack('coal', 2))
    const first = transferToFurnace(emptyInventory(), furnace(), 'input', 'raw_iron', 2)
    expect(first.result).toStrictEqual({ _tag: 'InsufficientItems', available: 0 })

    const input = transferToFurnace(initialInventory, furnace(), 'input', 'raw_iron', 2)
    expect(input.result).toStrictEqual({ _tag: 'Transferred', item: 'raw_iron', count: 2 })
    expect(input.furnace.input).toStrictEqual(stack('raw_iron', 2))
    expect(input.inventory.slots[0]).toStrictEqual(stack('raw_iron', 1))

    const fuel = transferToFurnace(input.inventory, input.furnace, 'fuel', 'coal', 2)
    expect(fuel.result).toStrictEqual({ _tag: 'Transferred', item: 'coal', count: 2 })
    expect(fuel.furnace.fuel).toStrictEqual(stack('coal', 2))
    expect(fuel.inventory.slots[0]).toStrictEqual(stack('raw_iron', 1))
    expect(fuel.inventory.slots[1]).toBeUndefined()
  })

  it('rejects invalid counts, unavailable items, mismatched slots, and full slots', () => {
    const inventory = inventoryWith(stack('raw_iron', 5))
    for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(transferToFurnace(inventory, furnace(), 'input', 'raw_iron', count).result).toStrictEqual({
        _tag: 'InvalidCount',
        count,
      })
    }
    expect(transferToFurnace(inventory, furnace(), 'input', 'coal', 1).result).toStrictEqual({
      _tag: 'InsufficientItems',
      available: 0,
    })
    expect(
      transferToFurnace(
        inventory,
        furnace({ input: stack('sand', 1) }),
        'input',
        'raw_iron',
        1,
      ).result,
    ).toStrictEqual({ _tag: 'WrongItem', expected: 'sand' })
    expect(
      transferToFurnace(
        inventory,
        furnace({ input: stack('raw_iron', 60) }),
        'input',
        'raw_iron',
        5,
      ).result,
    ).toStrictEqual({ _tag: 'NoRoom', available: 4 })
  })
})

describe('furnace progression', () => {
  it('consumes fuel and completes a recipe across multiple updates', () => {
    const start = furnace({ input: stack('raw_iron', 2), fuel: stack('coal', 2) })
    const partial = advanceFurnace(start, 9)
    expect(partial).toStrictEqual({
      state: furnace({
        input: stack('raw_iron', 2),
        fuel: stack('coal', 1),
        burnRemainingSecs: 71,
        cookElapsedSecs: 9,
      }),
      smelted: 0,
      fuelConsumed: 1,
    })
    const complete = advanceFurnace(partial.state, 1)
    expect(complete).toStrictEqual({
      state: furnace({
        input: stack('raw_iron'),
        fuel: stack('coal', 1),
        output: stack('iron_ingot'),
        burnRemainingSecs: 70,
      }),
      smelted: 1,
      fuelConsumed: 0,
    })
  })

  it('uses remaining delta time to smelt several items and handles fractional boundaries', () => {
    const batch = advanceFurnace(furnace({ input: stack('raw_iron', 2), fuel: stack('coal') }), 100)
    expect(batch).toStrictEqual({
      state: furnace({
        fuel: null,
        output: stack('iron_ingot', 2),
        burnRemainingSecs: 60,
      }),
      smelted: 2,
      fuelConsumed: 1,
    })

    const almost = advanceFurnace(furnace({ input: stack('raw_iron'), fuel: stack('coal') }), 9.999)
    expect(almost.state.cookElapsedSecs).toBeCloseTo(9.999, 12)
    expect(almost.state.burnRemainingSecs).toBeCloseTo(70.001, 12)
    const boundary = advanceFurnace(almost.state, 0.001)
    expect(boundary.state).toStrictEqual(
      furnace({ output: stack('iron_ingot'), burnRemainingSecs: 70 }),
    )
  })

  it('stops safely when input, fuel, recipe, or output capacity cannot progress', () => {
    expect(
      advanceFurnace(furnace({ cookElapsedSecs: 5, burnRemainingSecs: 20 }), 1),
    ).toStrictEqual({
      state: furnace({ burnRemainingSecs: 20 }),
      smelted: 0,
      fuelConsumed: 0,
    })
    expect(
      advanceFurnace(furnace({ input: stack('stick'), cookElapsedSecs: 5, burnRemainingSecs: 20 }), 1),
    ).toStrictEqual({
      state: furnace({ input: stack('stick'), burnRemainingSecs: 20 }),
      smelted: 0,
      fuelConsumed: 0,
    })
    expect(
      advanceFurnace(furnace({ input: stack('raw_iron'), cookElapsedSecs: 5 }), 1),
    ).toStrictEqual({
      state: furnace({ input: stack('raw_iron'), cookElapsedSecs: 5 }),
      smelted: 0,
      fuelConsumed: 0,
    })
    expect(
      advanceFurnace(
        furnace({
          input: stack('raw_iron'),
          fuel: stack('coal'),
          output: stack('iron_ingot', 64),
          cookElapsedSecs: 5,
        }),
        1,
      ),
    ).toStrictEqual({
      state: furnace({
        input: stack('raw_iron'),
        fuel: stack('coal'),
        output: stack('iron_ingot', 64),
      }),
      smelted: 0,
      fuelConsumed: 0,
    })
    expect(
      advanceFurnace(
        furnace({
          input: stack('raw_iron'),
          fuel: stack('sand'),
          cookElapsedSecs: 5,
        }),
        1,
      ).state,
    ).toStrictEqual(furnace({ input: stack('raw_iron'), fuel: stack('sand'), cookElapsedSecs: 5 }))
    for (const deltaTimeSecs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(advanceFurnace(furnace(), deltaTimeSecs)).toStrictEqual({
        state: furnace(),
        smelted: 0,
        fuelConsumed: 0,
      })
    }
  })

  it('accepts compatible output and validates custom recipes and fuel rules', () => {
    const recipes: ReadonlyArray<SmeltingRecipe> = [
      { id: 'custom', input: 'sand', output: stack('glass', 2), cookDurationSecs: 1 },
    ]
    const rules: ReadonlyArray<FuelRule> = [{ item: 'stick', burnDurationSecs: 2 }]
    const result = advanceFurnace(
      furnace({ input: stack('sand'), fuel: stack('stick'), output: stack('glass', 62) }),
      1,
      recipes,
      rules,
    )
    expect(result).toStrictEqual({
      state: furnace({ output: stack('glass', 64), burnRemainingSecs: 1 }),
      smelted: 1,
      fuelConsumed: 1,
    })

    const validRecipe = recipes[0]!
    expect(() => matchSmeltingRecipe([{ ...validRecipe, id: '' }], stack('sand'))).toThrow(
      'Invalid smelting recipe',
    )
    expect(() => matchSmeltingRecipe([{ ...validRecipe, input: 'unknown' as ItemType }], stack('sand'))).toThrow(
      'Invalid smelting recipe',
    )
    expect(() => matchSmeltingRecipe([{ ...validRecipe, output: { item: 'unknown', count: 1 } as unknown as ItemStack }], stack('sand'))).toThrow(
      'Invalid output',
    )
    expect(() => matchSmeltingRecipe([{ ...validRecipe, output: stack('glass', 0) } as unknown as SmeltingRecipe], stack('sand'))).toThrow(
      'Invalid output',
    )
    expect(() => matchSmeltingRecipe([{ ...validRecipe, cookDurationSecs: 0 }], stack('sand'))).toThrow(
      'Cook duration',
    )
    expect(() => advanceFurnace(furnace({ input: stack('sand'), fuel: stack('stick') }), 1, recipes, [{ item: 'unknown' as ItemType, burnDurationSecs: 1 }])).toThrow(
      'Invalid fuel item',
    )
    expect(() => advanceFurnace(furnace({ input: stack('sand'), fuel: stack('stick') }), 1, recipes, [{ item: 'stick', burnDurationSecs: Number.POSITIVE_INFINITY }])).toThrow(
      'Burn duration',
    )
  })

  it('rejects malformed state values and elapsed times', () => {
    const malformed = (changes: Partial<FurnaceState>): FurnaceState =>
      ({ ...furnace(), ...changes }) as FurnaceState
    expect(() => advanceFurnace(malformed({ input: undefined as unknown as ItemStack }), 1)).toThrow(
      'Invalid furnace input item',
    )
    expect(() => advanceFurnace(malformed({ fuel: { item: 'unknown', count: 1 } as unknown as ItemStack }), 1)).toThrow(
      'Invalid furnace fuel item',
    )
    expect(() => advanceFurnace(malformed({ output: { item: 'iron_ingot', count: 65 } as ItemStack }), 1)).toThrow(
      'Invalid furnace output stack count',
    )
    expect(() => advanceFurnace(malformed({ cookElapsedSecs: -1 }), 1)).toThrow('Cook elapsed time')
    expect(() => advanceFurnace(malformed({ burnRemainingSecs: Number.NaN }), 1)).toThrow(
      'Burn remaining time',
    )
    expect(() =>
      advanceFurnace(
        malformed({ input: stack('raw_iron'), fuel: stack('coal'), cookElapsedSecs: 10 }),
        1,
      ),
    ).toThrow('Cook elapsed time exceeds')
  })
})

describe('furnace output collection', () => {
  it('collects output, reports empty output, and preserves a full inventory', () => {
    const empty = furnace()
    expect(collectFurnaceOutput(emptyInventory(), empty)).toStrictEqual({
      inventory: emptyInventory(),
      furnace: empty,
      result: { _tag: 'Empty' },
    })

    const ready = furnace({ output: stack('iron_ingot', 2) })
    const collected = collectFurnaceOutput(emptyInventory(), ready)
    expect(collected.result).toStrictEqual({ _tag: 'Collected', output: stack('iron_ingot', 2) })
    expect(collected.furnace.output).toBeNull()
    expect(collected.inventory.slots[0]).toStrictEqual(stack('iron_ingot', 2))

    const blocked = collectFurnaceOutput(fullInventory(), ready)
    expect(blocked).toStrictEqual({
      inventory: fullInventory(),
      furnace: ready,
      result: { _tag: 'NoRoom' },
    })
  })
})

describe('furnace snapshot validation', () => {
  it('round-trips a valid snapshot and reports precise malformed paths', () => {
    const state = furnace({
      input: stack('raw_iron', 2),
      fuel: stack('coal'),
      output: stack('iron_ingot'),
      cookElapsedSecs: 2.5,
      burnRemainingSecs: 77.5,
    })
    expect(validateFurnaceSnapshot(JSON.parse(JSON.stringify(state)))).toStrictEqual({
      _tag: 'Valid',
      state,
    })
    expect(validateFurnaceSnapshot(null)).toMatchObject({ _tag: 'Invalid', error: { path: 'snapshot' } })
    expect(validateFurnaceSnapshot([])).toMatchObject({ _tag: 'Invalid', error: { path: 'snapshot' } })
    expect(validateFurnaceSnapshot({ ...state, extra: true })).toMatchObject({
      _tag: 'Invalid',
      error: { path: 'snapshot' },
    })
    expect(validateFurnaceSnapshot({ ...state, input: undefined })).toMatchObject({
      _tag: 'Invalid',
      error: { path: 'input' },
    })
    expect(validateFurnaceSnapshot({ ...state, input: { item: 'unknown', count: 1 } })).toMatchObject({
      _tag: 'Invalid',
      error: { path: 'input.item' },
    })
    expect(validateFurnaceSnapshot({ ...state, input: { item: 'raw_iron', count: 0 } })).toMatchObject({
      _tag: 'Invalid',
      error: { path: 'input.count' },
    })
    expect(validateFurnaceSnapshot({ ...state, output: { item: 'iron_ingot', count: 1, extra: true } })).toMatchObject({
      _tag: 'Invalid',
      error: { path: 'output' },
    })
    expect(validateFurnaceSnapshot({ ...state, cookElapsedSecs: Number.NaN })).toMatchObject({
      _tag: 'Invalid',
      error: { path: 'cookElapsedSecs' },
    })
    expect(validateFurnaceSnapshot({ ...state, burnRemainingSecs: -1 })).toMatchObject({
      _tag: 'Invalid',
      error: { path: 'burnRemainingSecs' },
    })
  })
})
