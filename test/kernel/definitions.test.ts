import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_NAMES,
  capabilityNames,
  DEFAULT_BLOCK_CAPABILITIES,
  resolveBlockCapabilities,
} from '../../src/kernel/block-capabilities'
import { resolveBlockDefinition } from '../../src/kernel/block-definition'
import {
  AIR_BLOCK_ID,
  BLOCK_IDS,
  BLOCK_ID_MAX,
  BLOCK_REGISTRY,
  blockCapabilitiesOf,
  blockCount,
  blockDefinitionOf,
  blockEntryOf,
  blockIdOf,
  blockPropertiesOf,
  blockTypeOf,
  isBlockId,
  registryHasEveryDeclaredBlock,
  toBlockId,
} from '../../src/kernel/block-registry'
import {
  DEFAULT_BLOCK_PROPERTIES,
  resolveBlockProperties,
} from '../../src/kernel/block-properties'
import { ANY_SUPPORTING, NO_SUPPORT, supportsAttachment } from '../../src/kernel/block-support'

describe('kernel block definitions', () => {
  it('resolves capability and property overrides', () => {
    expect(resolveBlockCapabilities()).toStrictEqual(DEFAULT_BLOCK_CAPABILITIES)
    expect(resolveBlockCapabilities({ passable: true, suffocates: false })).toMatchObject({
      passable: true,
      suffocates: false,
      canSupportAttachments: true,
    })
    expect(capabilityNames()).toStrictEqual(CAPABILITY_NAMES)
    expect(resolveBlockProperties()).toStrictEqual(DEFAULT_BLOCK_PROPERTIES)
    expect(resolveBlockProperties({ hardness: 0, renderKind: 'cross' })).toMatchObject({
      hardness: 0,
      renderKind: 'cross',
      opacity: 'opaque',
    })
    expect(
      resolveBlockDefinition({ type: 'stone', capabilities: { passable: true }, properties: { hardness: 1 } }),
    ).toMatchObject({ type: 'stone', capabilities: { passable: true }, properties: { hardness: 1 } })
  })

  it('evaluates all support rule variants', () => {
    const context = { neighborType: 'stone' as const, neighborSupportsAttachments: true }
    expect(supportsAttachment(NO_SUPPORT, context)).toBe(false)
    expect(supportsAttachment(ANY_SUPPORTING, context)).toBe(true)
    expect(supportsAttachment(ANY_SUPPORTING, { ...context, neighborSupportsAttachments: false })).toBe(false)
    expect(supportsAttachment({ _tag: 'oneOf', blocks: new Set(['stone']) }, context)).toBe(true)
    expect(supportsAttachment({ _tag: 'oneOf', blocks: new Set(['dirt']) }, context)).toBe(false)
  })

  it('provides a dense, bounded block registry', () => {
    expect(BLOCK_REGISTRY).toHaveLength(120)
    expect(BLOCK_IDS).toHaveLength(120)
    expect(blockCount()).toBe(120)
    expect(AIR_BLOCK_ID).toBe(0)
    expect(registryHasEveryDeclaredBlock()).toBe(true)
    expect(blockIdOf('stone')).toBe(1)
    expect(blockTypeOf(1)).toBe('stone')
    expect(blockTypeOf(-1)).toBeUndefined()
    expect(blockTypeOf(BLOCK_ID_MAX + 1)).toBeUndefined()
    expect(blockTypeOf(1.5)).toBeUndefined()
    expect(blockEntryOf(1)?.type).toBe('stone')
    expect(blockEntryOf(-1)).toBeUndefined()
    expect(blockDefinitionOf('stone').type).toBe('stone')
    expect(isBlockId(0)).toBe(true)
    expect(isBlockId(BLOCK_ID_MAX)).toBe(true)
    expect(isBlockId(-1)).toBe(false)
    expect(isBlockId(BLOCK_ID_MAX + 1)).toBe(false)
    expect(isBlockId(1.5)).toBe(false)
    expect(toBlockId(0)).toBe(0)
    expect(toBlockId(BLOCK_ID_MAX)).toBe(BLOCK_ID_MAX)
    expect(toBlockId(-1)).toBeUndefined()
    expect(toBlockId(BLOCK_ID_MAX + 1)).toBeUndefined()
    expect(toBlockId(1.5)).toBeUndefined()
  })

  it('publishes representative gameplay, rendering, and drop properties', () => {
    expect(blockCapabilitiesOf('air')).toMatchObject({ passable: true, suffocates: false, validSpawnSurface: false })
    expect(blockCapabilitiesOf('sand').fallsWhenUnsupported).toBe(true)
    expect(blockCapabilitiesOf('tall_grass').replaceable).toBe(true)
    expect(blockCapabilitiesOf('oak_log').flammable).toBe(true)
    expect(blockCapabilitiesOf('fire').fireSource).toBe(true)
    expect(blockCapabilitiesOf('obsidian').pistonImmovable).toBe(true)
    expect(blockCapabilitiesOf('dandelion').brokenByWaterFlow).toBe(true)
    expect(blockCapabilitiesOf('ladder').climbable).toBe(true)
    expect(blockCapabilitiesOf('glass').canSupportAttachments).toBe(false)
    expect(blockCapabilitiesOf('stone').validSpawnSurface).toBe(true)
    expect(blockCapabilitiesOf('dirt').tillable).toBe(true)
    expect(blockPropertiesOf('water')).toMatchObject({
      opacity: 'fluid',
      fluid: 'water',
      collisionShape: 'none',
      renderKind: 'fluid',
      movementDrag: 0.8,
      footstepMaterial: 'water',
    })
    expect(blockPropertiesOf('lava').fluid).toBe('lava')
    expect(blockPropertiesOf('glass').opacity).toBe('transparentSolid')
    expect(blockPropertiesOf('stone_slab').collisionShape).toBe('slab')
    expect(blockPropertiesOf('cactus')).toMatchObject({ collisionShape: 'cactus', contactDamage: 1, renderKind: 'cactus' })
    expect(blockPropertiesOf('pressure_plate').collisionShape).toBe('pressurePlate')
    expect(blockPropertiesOf('cobweb')).toMatchObject({ renderKind: 'cross', collisionShape: 'none', movementDrag: 0.95 })
    expect(blockPropertiesOf('rail').railKind).toBe('normal')
    expect(blockPropertiesOf('powered_rail').railKind).toBe('powered')
    expect(blockPropertiesOf('torch').lightEmission).toBe(14)
    expect(blockPropertiesOf('ice').friction).toBe(0.98)
    expect(blockPropertiesOf('soul_sand').movementDrag).toBe(0)
    expect(blockPropertiesOf('coal_ore').xpOnBreak).toBe(1)
    expect(blockPropertiesOf('grass_block').textureTiles).toStrictEqual({
      top: 'grass_block_top',
      bottom: 'dirt',
      side: 'grass_block_side',
    })
    expect(blockPropertiesOf('stone_button').supportRule).toMatchObject({ _tag: 'oneOf' })
    expect(blockPropertiesOf('stone').drops).toMatchObject({ item: 'cobblestone', silkTouchItem: 'stone' })
    expect(blockPropertiesOf('bedrock').drops.count).toBe(0)
    expect(blockPropertiesOf('water').drops.count).toBe(0)
    expect(blockPropertiesOf('iron_ore').harvestTool).toStrictEqual({ category: 'pickaxe', minTier: 'stone' })
  })
})
