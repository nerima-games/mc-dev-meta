import {
  DEFAULT_BLOCK_DROP,
  DEFAULT_HARVEST_TOOL,
  type BlockDropRule,
  type HarvestToolRequirement,
} from './block-harvest'
import type { SupportRule } from './block-support'

export const BLOCK_OPACITIES = ['transparentSolid', 'fluid', 'opaque'] as const
export type BlockOpacity = (typeof BLOCK_OPACITIES)[number]

export const FLUID_KINDS = ['none', 'water', 'lava'] as const
export type FluidKind = (typeof FLUID_KINDS)[number]

export const COLLISION_SHAPES = ['full', 'slab', 'cactus', 'pressurePlate', 'none'] as const
export type CollisionShape = (typeof COLLISION_SHAPES)[number]

export const RENDER_KINDS = ['cube', 'cross', 'cactus', 'rail', 'lilyPad', 'fluid', 'none'] as const
export type RenderKind = (typeof RENDER_KINDS)[number]

export const RAIL_KINDS = ['none', 'normal', 'powered'] as const
export type RailKind = (typeof RAIL_KINDS)[number]

export const FOOTSTEP_MATERIALS = [
  'none',
  'stone',
  'grass',
  'dirt',
  'sand',
  'wood',
  'glass',
  'metal',
  'cloth',
  'snow',
  'water',
] as const
export type FootstepMaterial = (typeof FOOTSTEP_MATERIALS)[number]

export type TextureTiles = {
  readonly top: string
  readonly bottom: string
  readonly side: string
}

export const DEFAULT_TEXTURE_TILES: TextureTiles = {
  top: 'missing',
  bottom: 'missing',
  side: 'missing',
}

export type BlockProperties = {
  readonly opacity: BlockOpacity
  readonly lightEmission: number
  readonly fluid: FluidKind
  readonly collisionShape: CollisionShape
  readonly renderKind: RenderKind
  readonly hardness: number
  readonly friction: number
  readonly contactDamage: number
  readonly movementDrag: number
  readonly xpOnBreak: number
  readonly railKind: RailKind
  readonly footstepMaterial: FootstepMaterial
  readonly textureTiles: TextureTiles
  readonly harvestTool: HarvestToolRequirement
  readonly drops: BlockDropRule
  readonly supportRule: SupportRule
}

export type BlockPropertyOverrides = Partial<BlockProperties>

export const DEFAULT_BLOCK_PROPERTIES: BlockProperties = {
  opacity: 'opaque',
  lightEmission: 0,
  fluid: 'none',
  collisionShape: 'full',
  renderKind: 'cube',
  hardness: 8,
  friction: 0.6,
  contactDamage: 0,
  movementDrag: 0,
  xpOnBreak: 0,
  railKind: 'none',
  footstepMaterial: 'stone',
  textureTiles: DEFAULT_TEXTURE_TILES,
  harvestTool: DEFAULT_HARVEST_TOOL,
  drops: DEFAULT_BLOCK_DROP,
  supportRule: { _tag: 'anySupporting' },
}

export const resolveBlockProperties = (overrides: BlockPropertyOverrides = {}): BlockProperties => ({
  ...DEFAULT_BLOCK_PROPERTIES,
  ...overrides,
})
