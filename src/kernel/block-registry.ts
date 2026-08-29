import {
  DEFAULT_BLOCK_CAPABILITIES,
  type BlockCapabilities,
} from './block-capabilities'
import { resolveBlockDefinition, type ResolvedBlockDefinition } from './block-definition'
import {
  DEFAULT_BLOCK_DROP,
  DEFAULT_HARVEST_TOOL,
  type BlockDropRule,
  type HarvestToolRequirement,
} from './block-harvest'
import {
  DEFAULT_BLOCK_PROPERTIES,
  type BlockOpacity,
  type BlockProperties,
  type CollisionShape,
  type FootstepMaterial,
  type FluidKind,
  type RailKind,
  type RenderKind,
  type TextureTiles,
} from './block-properties'
import { ANY_SUPPORTING, NO_SUPPORT, type SupportRule } from './block-support'
import { BLOCK_TYPES, type BlockType } from './block-type'
import { itemOfBlock } from './block-item'

declare const BLOCK_ID: unique symbol

export type BlockId = number & { readonly [BLOCK_ID]: 'BlockId' }

export const BLOCK_ID_MAX = 255

export const toBlockId = (value: number): BlockId | undefined =>
  Number.isInteger(value) && value >= 0 && value <= BLOCK_ID_MAX ? (value as BlockId) : undefined

export const isBlockId = (value: number): value is BlockId =>
  Number.isInteger(value) && value >= 0 && value <= BLOCK_ID_MAX

export const BLOCK_IDS: ReadonlyArray<BlockId> = BLOCK_TYPES.map((_, index) => index as BlockId)

const BLOCK_ID_BY_TYPE = Object.fromEntries(
  BLOCK_TYPES.map((type, index) => [type, index as BlockId]),
) as Record<BlockType, BlockId>

const PASSABLE_BLOCKS = new Set<BlockType>([
  'air',
  'water',
  'lava',
  'snow',
  'ladder',
  'cobweb',
  'sapling',
  'dandelion',
  'poppy',
  'brown_mushroom',
  'red_mushroom',
  'tall_grass',
  'fern',
  'sugar_cane',
  'lily_pad',
  'kelp',
  'seagrass',
  'rail',
  'powered_rail',
  'pressure_plate',
  'wheat_crop',
  'potato_crop',
  'nether_wart_crop',
  'redstone_wire',
  'redstone_torch',
  'lever',
  'stone_button',
  'repeater',
  'comparator',
  'end_portal',
  'end_gateway',
  'end_crystal',
  'end_rod',
  'door_open',
  'water_cauldron',
  'fire',
])

const FALLING_BLOCKS = new Set<BlockType>(['sand', 'gravel', 'anvil'])
const REPLACEABLE_BLOCKS = new Set<BlockType>([
  'air',
  'water',
  'lava',
  'snow',
  'sapling',
  'dandelion',
  'poppy',
  'brown_mushroom',
  'red_mushroom',
  'tall_grass',
  'fern',
  'sugar_cane',
  'lily_pad',
  'kelp',
  'seagrass',
  'wheat_crop',
  'potato_crop',
  'nether_wart_crop',
  'fire',
])
const FLAMMABLE_BLOCKS = new Set<BlockType>([
  'oak_log',
  'oak_planks',
  'oak_leaves',
  'sapling',
  'tall_grass',
  'fern',
  'sugar_cane',
  'crafting_table',
  'chest',
  'door',
  'door_open',
  'oak_stairs',
  'bed',
])
const FIRE_SOURCE_BLOCKS = new Set<BlockType>(['fire', 'lava', 'netherrack'])
const PISTON_IMMOVABLE_BLOCKS = new Set<BlockType>([
  'bedrock',
  'end_portal_frame_filled',
  'end_portal',
  'end_gateway',
  'piston_head',
  'obsidian',
])
const WATER_BREAKABLE_BLOCKS = new Set<BlockType>([
  'snow',
  'sapling',
  'dandelion',
  'poppy',
  'brown_mushroom',
  'red_mushroom',
  'tall_grass',
  'fern',
  'sugar_cane',
  'lily_pad',
  'kelp',
  'seagrass',
  'redstone_wire',
  'redstone_torch',
  'lever',
  'stone_button',
  'wheat_crop',
  'potato_crop',
  'nether_wart_crop',
])
const CLIMBABLE_BLOCKS = new Set<BlockType>(['ladder'])
const NO_SUFFOCATION_BLOCKS = new Set<BlockType>([
  ...PASSABLE_BLOCKS,
  'glass',
  'oak_leaves',
  'ice',
  'amethyst_cluster',
  'end_rod',
])
const NO_ATTACHMENT_SUPPORT_BLOCKS = new Set<BlockType>([
  ...PASSABLE_BLOCKS,
  'glass',
  'oak_leaves',
  'ice',
  'amethyst_cluster',
  'end_rod',
])
const VALID_SPAWN_SURFACES = new Set<BlockType>([
  'grass_block',
  'dirt',
  'stone',
  'cobblestone',
  'sand',
  'gravel',
  'oak_planks',
  'deepslate',
  'end_stone',
  'netherrack',
])
const TILLABLE_BLOCKS = new Set<BlockType>(['dirt', 'grass_block'])

const FLUID_OVERRIDES = new Map<BlockType, FluidKind>([
  ['water', 'water'],
  ['lava', 'lava'],
  ['water_cauldron', 'water'],
])
const OPACITY_OVERRIDES = new Map<BlockType, BlockOpacity>([
  ['air', 'transparentSolid'],
  ['water', 'fluid'],
  ['lava', 'fluid'],
  ['glass', 'transparentSolid'],
  ['oak_leaves', 'transparentSolid'],
  ['ice', 'transparentSolid'],
  ['amethyst_cluster', 'transparentSolid'],
  ['end_rod', 'transparentSolid'],
  ['fire', 'transparentSolid'],
])
const COLLISION_OVERRIDES = new Map<BlockType, CollisionShape>([
  ['air', 'none'],
  ['water', 'none'],
  ['lava', 'none'],
  ['snow', 'none'],
  ['ladder', 'none'],
  ['cobweb', 'none'],
  ['sapling', 'none'],
  ['dandelion', 'none'],
  ['poppy', 'none'],
  ['brown_mushroom', 'none'],
  ['red_mushroom', 'none'],
  ['tall_grass', 'none'],
  ['fern', 'none'],
  ['sugar_cane', 'none'],
  ['lily_pad', 'none'],
  ['kelp', 'none'],
  ['seagrass', 'none'],
  ['rail', 'none'],
  ['powered_rail', 'none'],
  ['pressure_plate', 'pressurePlate'],
  ['stone_slab', 'slab'],
  ['purpur_slab', 'slab'],
  ['cactus', 'cactus'],
  ['redstone_wire', 'none'],
  ['redstone_torch', 'none'],
  ['lever', 'none'],
  ['stone_button', 'none'],
  ['repeater', 'none'],
  ['comparator', 'none'],
  ['end_portal', 'none'],
  ['end_gateway', 'none'],
  ['end_crystal', 'none'],
  ['end_rod', 'none'],
  ['door_open', 'none'],
  ['water_cauldron', 'none'],
  ['fire', 'none'],
])
const RENDER_OVERRIDES = new Map<BlockType, RenderKind>([
  ['air', 'none'],
  ['water', 'fluid'],
  ['lava', 'fluid'],
  ['snow', 'cube'],
  ['cobweb', 'cross'],
  ['sapling', 'cross'],
  ['dandelion', 'cross'],
  ['poppy', 'cross'],
  ['brown_mushroom', 'cross'],
  ['red_mushroom', 'cross'],
  ['tall_grass', 'cross'],
  ['fern', 'cross'],
  ['sugar_cane', 'cross'],
  ['lily_pad', 'lilyPad'],
  ['kelp', 'cross'],
  ['seagrass', 'cross'],
  ['rail', 'rail'],
  ['powered_rail', 'rail'],
  ['cactus', 'cactus'],
  ['redstone_wire', 'none'],
  ['redstone_torch', 'cross'],
  ['lever', 'none'],
  ['stone_button', 'none'],
  ['repeater', 'none'],
  ['comparator', 'none'],
  ['end_portal', 'none'],
  ['end_gateway', 'none'],
  ['end_crystal', 'none'],
  ['end_rod', 'cross'],
  ['door_open', 'none'],
  ['water_cauldron', 'fluid'],
  ['fire', 'cross'],
])
const LIGHT_EMISSION_OVERRIDES = new Map<BlockType, number>([
  ['torch', 14],
  ['glowstone', 15],
  ['redstone_torch', 7],
  ['redstone_lamp_lit', 15],
  ['end_crystal', 15],
  ['end_rod', 14],
  ['fire', 15],
])
const HARDNESS_OVERRIDES = new Map<BlockType, number>([
  ['air', 0],
  ['bedrock', -1],
  ['glass', 0.3],
  ['oak_leaves', 0.2],
  ['torch', 0],
  ['fire', 0],
  ['water', 100],
  ['lava', 100],
])
const FRICTION_OVERRIDES = new Map<BlockType, number>([
  ['ice', 0.98],
])
const CONTACT_DAMAGE_OVERRIDES = new Map<BlockType, number>([['cactus', 1]])
const MOVEMENT_DRAG_OVERRIDES = new Map<BlockType, number>([
  ['water', 0.8],
  ['lava', 0.5],
  ['cobweb', 0.95],
])
const XP_OVERRIDES = new Map<BlockType, number>([
  ['coal_ore', 1],
  ['diamond_ore', 3],
  ['emerald_ore', 3],
  ['redstone_ore', 2],
  ['lapis_ore', 2],
])
const RAIL_OVERRIDES = new Map<BlockType, RailKind>([
  ['rail', 'normal'],
  ['powered_rail', 'powered'],
])
const FOOTSTEP_OVERRIDES = new Map<BlockType, FootstepMaterial>([
  ['air', 'none'],
  ['water', 'water'],
  ['lava', 'water'],
  ['grass_block', 'grass'],
  ['dirt', 'dirt'],
  ['sand', 'sand'],
  ['gravel', 'sand'],
  ['oak_log', 'wood'],
  ['oak_planks', 'wood'],
  ['oak_leaves', 'grass'],
  ['glass', 'glass'],
  ['snow', 'snow'],
  ['iron_block', 'metal'],
  ['gold_block', 'metal'],
  ['diamond_block', 'metal'],
  ['bed', 'cloth'],
])
const HARVEST_OVERRIDES = new Map<BlockType, HarvestToolRequirement>([
  ['stone', { category: 'pickaxe', minTier: 'wooden' }],
  ['cobblestone', { category: 'pickaxe', minTier: 'wooden' }],
  ['deepslate', { category: 'pickaxe', minTier: 'wooden' }],
  ['coal_ore', { category: 'pickaxe', minTier: 'wooden' }],
  ['iron_ore', { category: 'pickaxe', minTier: 'stone' }],
  ['gold_ore', { category: 'pickaxe', minTier: 'iron' }],
  ['diamond_ore', { category: 'pickaxe', minTier: 'iron' }],
  ['obsidian', { category: 'pickaxe', minTier: 'diamond' }],
  ['oak_log', { category: 'axe', minTier: 'wooden' }],
  ['oak_planks', { category: 'axe', minTier: 'wooden' }],
  ['sand', { category: 'shovel', minTier: 'wooden' }],
  ['gravel', { category: 'shovel', minTier: 'wooden' }],
])
const SUPPORT_OVERRIDES = new Map<BlockType, SupportRule>([
  ['stone_button', { _tag: 'oneOf', blocks: new Set(['stone', 'cobblestone', 'deepslate']) }],
  ['pressure_plate', { _tag: 'oneOf', blocks: new Set(['stone', 'oak_planks', 'iron_block']) }],
])
const TEXTURE_OVERRIDES = new Map<BlockType, TextureTiles>([
  ['grass_block', { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side' }],
  ['water', { top: 'water_still', bottom: 'water_still', side: 'water_still' }],
  ['lava', { top: 'lava_still', bottom: 'lava_still', side: 'lava_still' }],
])
const DROP_OVERRIDES = new Map<BlockType, BlockDropRule>([
  ['stone', { item: 'cobblestone', count: 1, requiresSilkTouch: false, affectedByFortune: false, silkTouchItem: 'stone' }],
  ['grass_block', { item: 'dirt', count: 1, requiresSilkTouch: false, affectedByFortune: false, silkTouchItem: 'grass_block' }],
  ['gravel', { item: 'flint', count: 1, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'gravel' }],
  ['coal_ore', { item: 'coal', count: 1, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'coal_ore' }],
  ['iron_ore', { item: 'raw_iron', count: 1, requiresSilkTouch: false, affectedByFortune: false, silkTouchItem: 'iron_ore' }],
  ['gold_ore', { item: 'raw_gold', count: 1, requiresSilkTouch: false, affectedByFortune: false, silkTouchItem: 'gold_ore' }],
  ['diamond_ore', { item: 'diamond', count: 1, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'diamond_ore' }],
  ['redstone_ore', { item: 'redstone_dust', count: 4, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'redstone_ore' }],
  ['lapis_ore', { item: 'lapis_lazuli', count: 4, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'lapis_ore' }],
  ['emerald_ore', { item: 'emerald', count: 1, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'emerald_ore' }],
  ['deepslate_coal_ore', { item: 'coal', count: 1, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'deepslate_coal_ore' }],
  ['deepslate_iron_ore', { item: 'raw_iron', count: 1, requiresSilkTouch: false, affectedByFortune: false, silkTouchItem: 'deepslate_iron_ore' }],
  ['deepslate_gold_ore', { item: 'raw_gold', count: 1, requiresSilkTouch: false, affectedByFortune: false, silkTouchItem: 'deepslate_gold_ore' }],
  ['deepslate_diamond_ore', { item: 'diamond', count: 1, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'deepslate_diamond_ore' }],
  ['deepslate_redstone_ore', { item: 'redstone_dust', count: 4, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'deepslate_redstone_ore' }],
  ['deepslate_lapis_ore', { item: 'lapis_lazuli', count: 4, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'deepslate_lapis_ore' }],
  ['deepslate_emerald_ore', { item: 'emerald', count: 1, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'deepslate_emerald_ore' }],
  ['wheat_crop', { item: 'wheat_seeds', count: 1, requiresSilkTouch: false, affectedByFortune: false }],
  ['potato_crop', { item: 'potato', count: 1, requiresSilkTouch: false, affectedByFortune: false }],
  ['nether_wart_crop', { item: 'nether_wart', count: 1, requiresSilkTouch: false, affectedByFortune: false }],
  ['bedrock', { ...DEFAULT_BLOCK_DROP, count: 0 }],
])

const createTextureTiles = (type: BlockType): TextureTiles => ({ top: type, bottom: type, side: type })

const defaultDropFor = (type: BlockType): BlockDropRule =>
  itemOfBlock(type) === undefined ? { ...DEFAULT_BLOCK_DROP, count: 0 } : DEFAULT_BLOCK_DROP

const definitionFor = (type: BlockType) =>
  resolveBlockDefinition({
    type,
    capabilities: {
      passable: PASSABLE_BLOCKS.has(type),
      fallsWhenUnsupported: FALLING_BLOCKS.has(type),
      replaceable: REPLACEABLE_BLOCKS.has(type),
      flammable: FLAMMABLE_BLOCKS.has(type),
      fireSource: FIRE_SOURCE_BLOCKS.has(type),
      pistonImmovable: PISTON_IMMOVABLE_BLOCKS.has(type),
      brokenByWaterFlow: WATER_BREAKABLE_BLOCKS.has(type),
      climbable: CLIMBABLE_BLOCKS.has(type),
      suffocates: !NO_SUFFOCATION_BLOCKS.has(type),
      canSupportAttachments: !NO_ATTACHMENT_SUPPORT_BLOCKS.has(type),
      validSpawnSurface: VALID_SPAWN_SURFACES.has(type),
      tillable: TILLABLE_BLOCKS.has(type),
    },
    properties: {
      opacity: OPACITY_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.opacity,
      lightEmission: LIGHT_EMISSION_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.lightEmission,
      fluid: FLUID_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.fluid,
      collisionShape:
        COLLISION_OVERRIDES.get(type) ?? (PASSABLE_BLOCKS.has(type) ? 'none' : DEFAULT_BLOCK_PROPERTIES.collisionShape),
      renderKind: RENDER_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.renderKind,
      hardness: HARDNESS_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.hardness,
      friction: FRICTION_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.friction,
      contactDamage: CONTACT_DAMAGE_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.contactDamage,
      movementDrag: MOVEMENT_DRAG_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.movementDrag,
      xpOnBreak: XP_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.xpOnBreak,
      railKind: RAIL_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.railKind,
      footstepMaterial: FOOTSTEP_OVERRIDES.get(type) ?? DEFAULT_BLOCK_PROPERTIES.footstepMaterial,
      textureTiles: TEXTURE_OVERRIDES.get(type) ?? createTextureTiles(type),
      harvestTool: HARVEST_OVERRIDES.get(type) ?? DEFAULT_HARVEST_TOOL,
      drops: DROP_OVERRIDES.get(type) ?? defaultDropFor(type),
      supportRule: SUPPORT_OVERRIDES.get(type) ?? (PASSABLE_BLOCKS.has(type) ? NO_SUPPORT : ANY_SUPPORTING),
    },
  })

export const BLOCK_REGISTRY: ReadonlyArray<ResolvedBlockDefinition> = BLOCK_TYPES.map(definitionFor)

export const AIR_BLOCK_ID = BLOCK_ID_BY_TYPE.air

export const blockIdOf = (type: BlockType): BlockId => BLOCK_ID_BY_TYPE[type]

export const blockTypeOf = (id: number): BlockType | undefined => (isBlockId(id) ? BLOCK_TYPES[id] : undefined)

export const blockEntryOf = (id: number): ResolvedBlockDefinition | undefined => {
  const type = blockTypeOf(id)
  return type === undefined ? undefined : BLOCK_REGISTRY[id]
}

export const blockDefinitionOf = (type: BlockType): ResolvedBlockDefinition => BLOCK_REGISTRY[blockIdOf(type)]!

export const blockCapabilitiesOf = (type: BlockType): BlockCapabilities => blockDefinitionOf(type).capabilities

export const blockPropertiesOf = (type: BlockType): BlockProperties => blockDefinitionOf(type).properties

export const blockCount = (): number => BLOCK_REGISTRY.length

export const registryHasEveryDeclaredBlock = (): boolean =>
  BLOCK_REGISTRY.length === BLOCK_TYPES.length && BLOCK_REGISTRY.every((entry, index) => entry.type === BLOCK_TYPES[index])

export { DEFAULT_BLOCK_CAPABILITIES }
