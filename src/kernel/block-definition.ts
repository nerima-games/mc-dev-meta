import {
  resolveBlockCapabilities,
  type BlockCapabilities,
  type BlockCapabilityOverrides,
} from './block-capabilities'
import { resolveBlockProperties, type BlockProperties, type BlockPropertyOverrides } from './block-properties'
import type { BlockType } from './block-type'

export type BlockDefinition = {
  readonly type: BlockType
  readonly capabilities?: BlockCapabilityOverrides
  readonly properties?: BlockPropertyOverrides
}

export type ResolvedBlockDefinition = {
  readonly type: BlockType
  readonly capabilities: BlockCapabilities
  readonly properties: BlockProperties
}

export const resolveBlockDefinition = (definition: BlockDefinition): ResolvedBlockDefinition => ({
  type: definition.type,
  capabilities: resolveBlockCapabilities(definition.capabilities),
  properties: resolveBlockProperties(definition.properties),
})
