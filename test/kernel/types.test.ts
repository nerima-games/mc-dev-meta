import { describe, expect, it } from 'vitest'
import { BLOCK_TYPES, isBlockType } from '../../src/kernel/block-type'
import {
  blockOfPlaceableItem,
  isPlaceableItem,
  itemOfBlock,
} from '../../src/kernel/block-item'
import { isItemType, ITEM_TYPES } from '../../src/kernel/item-type'

describe('kernel type vocabularies', () => {
  it('exposes the declared block vocabulary and guard', () => {
    expect(BLOCK_TYPES).toHaveLength(120)
    expect(BLOCK_TYPES[0]).toBe('air')
    expect(BLOCK_TYPES.at(-1)).toBe('fire')
    expect(isBlockType('stone')).toBe(true)
    expect(isBlockType('not_a_block')).toBe(false)
  })

  it('exposes the declared item vocabulary and placement guards', () => {
    expect(ITEM_TYPES).toHaveLength(97)
    expect(ITEM_TYPES.at(-1)).toBe('snowball')
    expect(isItemType('stone')).toBe(true)
    expect(isItemType('not_an_item')).toBe(false)
    expect(isPlaceableItem('stone')).toBe(true)
    expect(isPlaceableItem('stick')).toBe(false)
    expect(blockOfPlaceableItem('stone')).toBe('stone')
  })

  it('maps block drops to item identifiers, including non-placeable crops', () => {
    expect(itemOfBlock('stone')).toBe('stone')
    expect(itemOfBlock('redstone_wire')).toBe('redstone_dust')
    expect(itemOfBlock('wheat_crop')).toBe('wheat_seeds')
    expect(itemOfBlock('potato_crop')).toBe('potato')
    expect(itemOfBlock('nether_wart_crop')).toBe('nether_wart')
    expect(itemOfBlock('water')).toBeUndefined()
  })
})
