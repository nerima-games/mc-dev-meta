import { MAX_STACK_COUNT, StackCount, type StackCount as StackCountType } from './quantities'
import { isItemType, type ItemType } from './item-type'

export const INVENTORY_SLOT_COUNT = 36
export const HOTBAR_SLOT_COUNT = 9
export const HOTBAR_SLOT_START = INVENTORY_SLOT_COUNT - HOTBAR_SLOT_COUNT

export type ItemStack = {
  readonly item: ItemType
  readonly count: StackCountType
}

export type InventorySlot = ItemStack | undefined

export type Inventory = {
  readonly slots: ReadonlyArray<InventorySlot>
}

export const itemStack = (item: ItemType, count: number): ItemStack | undefined => {
  if (!isItemType(item) || !Number.isInteger(count) || count < 1 || count > MAX_STACK_COUNT) {
    return undefined
  }
  return { item, count: StackCount(count) }
}

export const emptyInventory = (): Inventory => ({
  slots: Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined),
})

const validCount = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.min(MAX_STACK_COUNT, Math.floor(value)) : 0

export const countItem = (inventory: Inventory, item: ItemType): number =>
  inventory.slots.reduce((total, slot) => total + (slot?.item === item ? validCount(slot.count) : 0), 0)

export type AddItemStackResult = {
  readonly inventory: Inventory
  readonly leftover: number
}

export const addItemStack = (inventory: Inventory, incoming: ItemStack): AddItemStackResult => {
  const requested = validCount(incoming.count)
  if (requested === 0 || !isItemType(incoming.item)) {
    return { inventory, leftover: requested }
  }

  const slots = [...inventory.slots]
  let remaining = requested
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const slot = slots[index]
    if (slot === undefined || slot.item !== incoming.item) {
      continue
    }
    const held = validCount(slot.count)
    if (held >= MAX_STACK_COUNT) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT - held, remaining)
    slots[index] = { item: incoming.item, count: StackCount(held + accepted) }
    remaining -= accepted
  }
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    if (slots[index] !== undefined) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT, remaining)
    slots[index] = { item: incoming.item, count: StackCount(accepted) }
    remaining -= accepted
  }
  return { inventory: { slots }, leftover: remaining }
}

export type RemoveItemStackResult = {
  readonly inventory: Inventory
  readonly removed: number
}

export const removeItemStack = (
  inventory: Inventory,
  item: ItemType,
  requested: number,
): RemoveItemStackResult => {
  if (!isItemType(item) || !Number.isInteger(requested) || requested <= 0) {
    return { inventory, removed: 0 }
  }
  const slots = [...inventory.slots]
  let remaining = requested
  let removed = 0
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const slot = slots[index]
    if (slot === undefined || slot.item !== item) {
      continue
    }
    const held = validCount(slot.count)
    const taken = Math.min(held, remaining)
    remaining -= taken
    removed += taken
    slots[index] = taken === held ? undefined : { item, count: StackCount(held - taken) }
  }
  return { inventory: { slots }, removed }
}
