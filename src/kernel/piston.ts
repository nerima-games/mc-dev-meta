import { blockCapabilitiesOf } from './block-registry'
import type { BlockType } from './block-type'

export const PISTON_PUSH_LIMIT = 12

export type PushPlan = {
  readonly moved: ReadonlyArray<BlockType>
  readonly length: number
}

export type PushRefusal = {
  readonly reason: 'immovable' | 'too-long'
  readonly at: number
}

export type PushOutcome =
  | { readonly kind: 'push'; readonly plan: PushPlan }
  | { readonly kind: 'refused'; readonly refusal: PushRefusal }

export const planPistonPush = (column: ReadonlyArray<BlockType>): PushOutcome => {
  for (const [index, block] of column.entries()) {
    if (blockCapabilitiesOf(block).pistonImmovable) {
      return { kind: 'refused', refusal: { reason: 'immovable', at: index } }
    }
    if (index >= PISTON_PUSH_LIMIT) {
      return { kind: 'refused', refusal: { reason: 'too-long', at: index } }
    }
  }
  return { kind: 'push', plan: { moved: [...column], length: column.length } }
}

export const isPistonMovable = (block: BlockType): boolean => !blockCapabilitiesOf(block).pistonImmovable
