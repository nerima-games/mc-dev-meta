import type { BlockType } from './block-type'

export const BIOME_TYPES = [
  'ocean',
  'plains',
  'forest',
  'desert',
  'taiga',
  'snowy_plains',
  'swamp',
  'nether_wastes',
  'the_end',
] as const

export type BiomeType = (typeof BIOME_TYPES)[number]

export type BiomeClimate = Readonly<{
  temperature: number
  humidity: number
  continentalness: number
  erosion: number
  weirdness: number
}>

export type BiomeSurface = Readonly<{
  top: BlockType
  filler: BlockType
  underwater: BlockType
  seaLevel: number
}>

export const BIOME_SURFACES: Readonly<Record<BiomeType, BiomeSurface>> = {
  ocean: { top: 'gravel', filler: 'stone', underwater: 'gravel', seaLevel: 62 },
  plains: { top: 'grass_block', filler: 'dirt', underwater: 'gravel', seaLevel: 62 },
  forest: { top: 'grass_block', filler: 'dirt', underwater: 'gravel', seaLevel: 62 },
  desert: { top: 'sand', filler: 'sandstone', underwater: 'sand', seaLevel: 62 },
  taiga: { top: 'grass_block', filler: 'dirt', underwater: 'gravel', seaLevel: 62 },
  snowy_plains: { top: 'snow', filler: 'dirt', underwater: 'gravel', seaLevel: 62 },
  swamp: { top: 'grass_block', filler: 'dirt', underwater: 'dirt', seaLevel: 62 },
  nether_wastes: { top: 'netherrack', filler: 'netherrack', underwater: 'soul_sand', seaLevel: 32 },
  the_end: { top: 'end_stone', filler: 'end_stone', underwater: 'end_stone', seaLevel: 0 },
}

export const BIOME_TREE_DENSITY: Readonly<Record<BiomeType, number>> = {
  ocean: 0,
  plains: 0.1,
  forest: 0.5,
  desert: 0,
  taiga: 0.3,
  snowy_plains: 0.05,
  swamp: 0.4,
  nether_wastes: 0,
  the_end: 0,
}

export const biomeAt = (climate: BiomeClimate): BiomeType => {
  if (climate.continentalness <= -0.65) {
    return 'ocean'
  }
  if (climate.temperature <= -0.55) {
    return 'snowy_plains'
  }
  if (climate.temperature >= 0.75 && climate.humidity <= -0.1) {
    return 'desert'
  }
  if (climate.humidity >= 0.7 && climate.temperature >= 0.2) {
    return 'swamp'
  }
  if (climate.humidity >= 0.45) {
    return 'forest'
  }
  if (climate.erosion <= -0.4 && climate.temperature <= 0.2) {
    return 'taiga'
  }
  return 'plains'
}

export const surfaceOf = (biome: BiomeType): BiomeSurface => BIOME_SURFACES[biome]
