import { describe, expect, it } from 'vitest'
import {
  BARE_HANDED,
  DEFAULT_BLOCK_DROP,
  DEFAULT_HARVEST_TOOL,
  resolveDrop,
  resolveDropItem,
  resolveHarvestDrop,
  satisfiesHarvestTier,
} from '../../src/kernel/block-harvest'

describe('kernel harvesting and drops', () => {
  it('checks tool categories and tier ordering', () => {
    expect(satisfiesHarvestTier(DEFAULT_HARVEST_TOOL, BARE_HANDED)).toBe(true)
    expect(satisfiesHarvestTier({ category: 'pickaxe', minTier: 'wooden' }, { heldCategory: 'axe' })).toBe(false)
    expect(satisfiesHarvestTier({ category: 'pickaxe', minTier: 'wooden' }, { heldCategory: 'pickaxe' })).toBe(false)
    expect(
      satisfiesHarvestTier({ category: 'pickaxe', minTier: 'wooden' }, { heldCategory: 'pickaxe', heldTier: 'wooden' }),
    ).toBe(true)
    expect(
      satisfiesHarvestTier({ category: 'pickaxe', minTier: 'wooden' }, { heldCategory: 'pickaxe', heldTier: 'diamond' }),
    ).toBe(true)
  })

  it('resolves self, explicit, and unrepresentable drops', () => {
    expect(resolveDropItem(DEFAULT_BLOCK_DROP, 'stone')).toBe('stone')
    expect(resolveDropItem(DEFAULT_BLOCK_DROP, 'water')).toBeUndefined()
    expect(
      resolveDropItem({ ...DEFAULT_BLOCK_DROP, item: 'flint' }, 'stone'),
    ).toBe('flint')
  })

  it('applies drop count, silk touch, and fortune metadata', () => {
    expect(resolveDrop({ ...DEFAULT_BLOCK_DROP, count: 0 }, 'stone')).toBeUndefined()
    expect(
      resolveDrop(
        { ...DEFAULT_BLOCK_DROP, requiresSilkTouch: true, silkTouchItem: 'stone' },
        'stone',
      ),
    ).toBeUndefined()
    expect(
      resolveDrop(
        { ...DEFAULT_BLOCK_DROP, requiresSilkTouch: true, silkTouchItem: 'stone' },
        'stone',
        { silkTouch: true },
      ),
    ).toStrictEqual({ item: 'stone', count: 1, affectedByFortune: false })
    expect(
      resolveDrop(
        { item: 'cobblestone', count: 2, requiresSilkTouch: false, affectedByFortune: true, silkTouchItem: 'stone' },
        'stone',
      ),
    ).toStrictEqual({ item: 'cobblestone', count: 2, affectedByFortune: true })
    expect(
      resolveDrop(
        { item: 'cobblestone', count: 2, requiresSilkTouch: false, affectedByFortune: false, silkTouchItem: 'stone' },
        'stone',
        { silkTouch: true },
      ),
    ).toStrictEqual({ item: 'stone', count: 2, affectedByFortune: false })
    expect(
      resolveDrop(
        { item: 'cobblestone', count: 2, requiresSilkTouch: false, affectedByFortune: false },
        'stone',
        { silkTouch: true },
      ),
    ).toStrictEqual({ item: 'cobblestone', count: 2, affectedByFortune: false })
    expect(resolveDrop(DEFAULT_BLOCK_DROP, 'water')).toBeUndefined()
  })

  it('combines harvest requirements with drop rules', () => {
    const rule = { ...DEFAULT_BLOCK_DROP, item: 'cobblestone' as const }
    const requirement = { category: 'pickaxe' as const, minTier: 'wooden' as const }
    expect(resolveHarvestDrop({ ...rule, count: 0 }, requirement, 'stone')).toBeUndefined()
    expect(resolveHarvestDrop(rule, requirement, 'stone', { heldCategory: 'axe', heldTier: 'wooden' })).toBeUndefined()
    expect(resolveHarvestDrop(rule, requirement, 'stone', { heldCategory: 'pickaxe' })).toBeUndefined()
    expect(
      resolveHarvestDrop(rule, requirement, 'stone', { heldCategory: 'pickaxe', heldTier: 'wooden' }),
    ).toStrictEqual({ item: 'cobblestone', count: 1, affectedByFortune: false })
    expect(
      resolveHarvestDrop(
        { ...rule, requiresSilkTouch: true, silkTouchItem: 'stone' },
        requirement,
        'stone',
        { heldCategory: 'pickaxe', heldTier: 'wooden' },
      ),
    ).toBeUndefined()
    expect(
      resolveHarvestDrop(
        { ...rule, requiresSilkTouch: true, silkTouchItem: 'stone' },
        requirement,
        'stone',
        { heldCategory: 'pickaxe', heldTier: 'wooden', silkTouch: true },
      ),
    ).toStrictEqual({ item: 'stone', count: 1, affectedByFortune: false })
    expect(resolveHarvestDrop(DEFAULT_BLOCK_DROP, DEFAULT_HARVEST_TOOL, 'water')).toBeUndefined()
  })
})
