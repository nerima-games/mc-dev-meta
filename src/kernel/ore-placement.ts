import { blockIdOf, blockTypeOf, type BlockId } from './block-registry'
import { getBlockAt, type Chunk } from './chunk'
import { integerInRange } from './worldgen-random'
import type { BlockType } from './block-type'

export type OrePlacementRule = Readonly<{
  block: BlockType
  host: ReadonlyArray<BlockType>
  veinSize: number
  attempts: number
  minY: number
  maxYExclusive: number
}>

export type OrePlacementInput = Readonly<{
  seed: number
  chunk: Chunk
  rule: OrePlacementRule
}>

export type OreBlockPlacement = Readonly<{
  position: Readonly<{ lx: number; ly: number; lz: number }>
  block: BlockId
}>

export const DEFAULT_ORE_RULES: ReadonlyArray<OrePlacementRule> = [
  { block: 'coal_ore', host: ['stone'], veinSize: 8, attempts: 20, minY: 0, maxYExclusive: 192 },
  { block: 'iron_ore', host: ['stone', 'deepslate'], veinSize: 6, attempts: 16, minY: -64, maxYExclusive: 96 },
  { block: 'diamond_ore', host: ['deepslate'], veinSize: 4, attempts: 4, minY: -64, maxYExclusive: 16 },
]

const validRule = (rule: OrePlacementRule): boolean =>
  rule.block !== 'air' &&
  rule.host.length > 0 &&
  Number.isSafeInteger(rule.veinSize) &&
  rule.veinSize > 0 &&
  Number.isSafeInteger(rule.attempts) &&
  rule.attempts > 0 &&
  Number.isSafeInteger(rule.minY) &&
  Number.isSafeInteger(rule.maxYExclusive) &&
  rule.maxYExclusive > rule.minY

export const placeOre = (input: OrePlacementInput): ReadonlyArray<OreBlockPlacement> => {
  if (!Number.isSafeInteger(input.seed) || !validRule(input.rule)) {
    return []
  }

  const { chunk, rule } = input
  const host = new Set(rule.host)
  const placements: Array<OreBlockPlacement> = []
  const occupied = new Set<string>()
  const ySpan = rule.maxYExclusive - rule.minY

  for (let attempt = 0; attempt < rule.attempts; attempt += 1) {
    const baseX = integerInRange(input.seed, 0, 15, chunk.position.cx, chunk.position.cz, attempt, 1)
    const baseY = rule.minY + integerInRange(input.seed, 0, ySpan - 1, chunk.position.cx, chunk.position.cz, attempt, 2)
    const baseZ = integerInRange(input.seed, 0, 15, chunk.position.cx, chunk.position.cz, attempt, 3)

    for (let veinIndex = 0; veinIndex < rule.veinSize; veinIndex += 1) {
      const position = {
        lx: baseX + integerInRange(input.seed, -1, 1, attempt, veinIndex, 4),
        ly: baseY + integerInRange(input.seed, -1, 1, attempt, veinIndex, 5),
        lz: baseZ + integerInRange(input.seed, -1, 1, attempt, veinIndex, 6),
      }
      const current = getBlockAt(chunk, position)
      const currentType = current === undefined ? undefined : blockTypeOf(current)
      if (currentType === undefined || !host.has(currentType)) {
        continue
      }
      const key = `${position.lx},${position.ly},${position.lz}`
      if (occupied.has(key)) {
        continue
      }
      occupied.add(key)
      placements.push({ position, block: blockIdOf(rule.block) })
    }
  }

  return placements
}
