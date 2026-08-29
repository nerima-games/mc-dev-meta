import { isPistonMovable, planPistonPush, type PushRefusal } from './piston'
import type { BlockType } from './block-type'

export type StickyPistonInput = {
  readonly extending: boolean
  readonly sticky: boolean
  readonly column: ReadonlyArray<BlockType>
  readonly attached?: BlockType
}

export type StickyPistonOutcome =
  | { readonly kind: 'extended'; readonly moved: ReadonlyArray<BlockType> }
  | { readonly kind: 'retracted'; readonly pulled?: BlockType }
  | { readonly kind: 'refused'; readonly refusal: PushRefusal }

export const planStickyPistonMove = (input: StickyPistonInput): StickyPistonOutcome => {
  if (input.extending) {
    const push = planPistonPush(input.column)
    return push.kind === 'refused'
      ? { kind: 'refused', refusal: push.refusal }
      : { kind: 'extended', moved: push.plan.moved }
  }
  if (!input.sticky || input.attached === undefined || !isPistonMovable(input.attached)) {
    return { kind: 'retracted' }
  }
  return { kind: 'retracted', pulled: input.attached }
}
