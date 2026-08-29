import { blockCapabilitiesOf, blockPropertiesOf } from './block-registry'
import { blockOfPlaceableItem, isPlaceableItem } from './block-item'
import type { BlockType } from './block-type'
import type { ItemType } from './item-type'
import { supportsAttachment } from './block-support'

export const PLACEMENT_FACES = [
  'xPositive',
  'xNegative',
  'yPositive',
  'yNegative',
  'zPositive',
  'zNegative',
] as const

export type PlacementFace = (typeof PLACEMENT_FACES)[number]

const PLACEMENT_FACE_SET: ReadonlySet<string> = new Set(PLACEMENT_FACES)

export const isPlacementFace = (value: string): value is PlacementFace => PLACEMENT_FACE_SET.has(value)

export type PlacementInput = {
  readonly item: ItemType
  readonly target: BlockType
  readonly adjacent: BlockType
  readonly face: PlacementFace
}

export type PlacementResult =
  | { readonly kind: 'placed'; readonly block: BlockType; readonly face: PlacementFace }
  | { readonly kind: 'rejected'; readonly reason: 'not-placeable' | 'invalid-face' | 'target-not-replaceable' | 'unsupported' }

export const placeBlock = (input: PlacementInput): PlacementResult => {
  if (!isPlaceableItem(input.item)) {
    return { kind: 'rejected', reason: 'not-placeable' }
  }
  if (!isPlacementFace(input.face)) {
    return { kind: 'rejected', reason: 'invalid-face' }
  }
  if (!blockCapabilitiesOf(input.target).replaceable) {
    return { kind: 'rejected', reason: 'target-not-replaceable' }
  }

  const block = blockOfPlaceableItem(input.item)
  const definition = blockPropertiesOf(block)
  const adjacentCapabilities = blockCapabilitiesOf(input.adjacent)
  const supported = definition.supportRule._tag === 'none'
    ? adjacentCapabilities.canSupportAttachments
    : supportsAttachment(definition.supportRule, {
        neighborType: input.adjacent,
        neighborSupportsAttachments: adjacentCapabilities.canSupportAttachments,
      })
  if (!supported) {
    return { kind: 'rejected', reason: 'unsupported' }
  }
  return { kind: 'placed', block, face: input.face }
}
