import type { BlockType } from './block-type'

export type SupportRule =
  | { readonly _tag: 'none' }
  | { readonly _tag: 'anySupporting' }
  | { readonly _tag: 'oneOf'; readonly blocks: ReadonlySet<BlockType> }

export type SupportContext = {
  readonly neighborType: BlockType
  readonly neighborSupportsAttachments: boolean
}

export const NO_SUPPORT: SupportRule = { _tag: 'none' }
export const ANY_SUPPORTING: SupportRule = { _tag: 'anySupporting' }

export const supportsAttachment = (rule: SupportRule, context: SupportContext): boolean => {
  if (rule._tag === 'none') {
    return false
  }
  if (rule._tag === 'anySupporting') {
    return context.neighborSupportsAttachments
  }
  return rule.blocks.has(context.neighborType)
}
