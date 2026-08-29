import { isBlockType, type BlockType } from './block-type'
import {
  isItemType,
  type ItemType,
  type PlaceableItemType,
} from './item-type'

const BLOCK_TO_ITEM_OVERRIDES: Partial<Record<BlockType, ItemType>> = {
  redstone_wire: 'redstone_dust',
  wheat_crop: 'wheat_seeds',
  potato_crop: 'potato',
  nether_wart_crop: 'nether_wart',
}

export const isPlaceableItem = (value: string): value is PlaceableItemType =>
  isItemType(value) && isBlockType(value)

export const itemOfBlock = (block: BlockType): ItemType | undefined => {
  const override = BLOCK_TO_ITEM_OVERRIDES[block]
  return override ?? (isItemType(block) ? block : undefined)
}

export const blockOfPlaceableItem = (item: PlaceableItemType): BlockType => item
