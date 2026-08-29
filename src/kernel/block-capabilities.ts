export type BlockCapabilities = {
  readonly passable: boolean
  readonly fallsWhenUnsupported: boolean
  readonly replaceable: boolean
  readonly flammable: boolean
  readonly fireSource: boolean
  readonly pistonImmovable: boolean
  readonly brokenByWaterFlow: boolean
  readonly climbable: boolean
  readonly suffocates: boolean
  readonly canSupportAttachments: boolean
  readonly validSpawnSurface: boolean
  readonly tillable: boolean
}

export type BlockCapabilityOverrides = Partial<BlockCapabilities>

export const CAPABILITY_NAMES = [
  'passable',
  'fallsWhenUnsupported',
  'replaceable',
  'flammable',
  'fireSource',
  'pistonImmovable',
  'brokenByWaterFlow',
  'climbable',
  'suffocates',
  'canSupportAttachments',
  'validSpawnSurface',
  'tillable',
] as const

export const DEFAULT_BLOCK_CAPABILITIES: BlockCapabilities = {
  passable: false,
  fallsWhenUnsupported: false,
  replaceable: false,
  flammable: false,
  fireSource: false,
  pistonImmovable: false,
  brokenByWaterFlow: false,
  climbable: false,
  suffocates: true,
  canSupportAttachments: true,
  validSpawnSurface: true,
  tillable: false,
}

export const resolveBlockCapabilities = (overrides: BlockCapabilityOverrides = {}): BlockCapabilities => ({
  ...DEFAULT_BLOCK_CAPABILITIES,
  ...overrides,
})

export const capabilityNames = (): ReadonlyArray<(typeof CAPABILITY_NAMES)[number]> => [...CAPABILITY_NAMES]
