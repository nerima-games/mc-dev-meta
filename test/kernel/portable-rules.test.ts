import { describe, expect, it } from 'vitest'
import { blockIdOf, toBlockId } from '../../src/kernel/block-registry'
import {
  ACTIVE_FLUID_KINDS,
  carryOver,
  canFluidEnter,
  createFluidState,
  DEFAULT_FLUID_FRONTIER_BUDGET,
  FLUID_LEVEL_MAX,
  FLUID_LEVEL_MIN,
  fluidCellKeyOf,
  fluidNeighboursOf,
  fluidPositionOfKey,
  fluidStateForBlock,
  flowInto,
  isActiveFluidKind,
  splitBudget,
} from '../../src/kernel/fluid'
import { blockPosition, position } from '../../src/kernel/coordinates'
import { isPistonMovable, planPistonPush, PISTON_PUSH_LIMIT } from '../../src/kernel/piston'
import { normalizeDirection, raycastBlocks } from '../../src/kernel/raycast'
import {
  clampPower,
  decayPower,
  MAX_POWER_LEVEL,
  MAX_REDSTONE_POWER,
  propagateRedstonePower,
} from '../../src/kernel/redstone'

describe('kernel fluid rules', () => {
  it('splits and carries a bounded mixed-fluid frontier', () => {
    expect(ACTIVE_FLUID_KINDS).toStrictEqual(['water', 'lava'])
    expect(DEFAULT_FLUID_FRONTIER_BUDGET).toBe(64)
    expect(isActiveFluidKind('water')).toBe(true)
    expect(isActiveFluidKind('lava')).toBe(true)
    expect(isActiveFluidKind('none')).toBe(false)

    const frontier = [
      { key: 'water-1', kind: 'water' as const },
      { key: 'lava-1', kind: 'lava' as const },
      { key: 'water-2', kind: 'water' as const },
      { key: 'lava-2', kind: 'lava' as const },
    ]
    const active = splitBudget(frontier, { budget: 3.9, lavaTickActive: true })
    expect(active.work).toStrictEqual([
      { key: 'water-1', kind: 'water' },
      { key: 'lava-1', kind: 'lava' },
      { key: 'lava-2', kind: 'lava' },
    ])
    expect(active.retainedLavaFrontier).toStrictEqual([])
    expect(carryOver(frontier, active)).toStrictEqual([{ key: 'water-2', kind: 'water' }])

    const inactive = splitBudget(frontier, { budget: -2, lavaTickActive: false })
    expect(inactive.work).toStrictEqual([])
    expect(inactive.retainedLavaFrontier).toStrictEqual(['lava-1', 'lava-2'])
    expect(carryOver(frontier, inactive)).toStrictEqual(frontier)
    expect(splitBudget([], { lavaTickActive: true }).work).toStrictEqual([])
  })

  it('round-trips cell keys and enumerates propagation neighbours', () => {
    const fluidPosition = blockPosition(-2, 70, 3)
    const key = fluidCellKeyOf(fluidPosition)
    expect(key).toBe('-2,70,3')
    expect(fluidPositionOfKey(key)).toStrictEqual(fluidPosition)
    expect(fluidPositionOfKey('1,2')).toBeUndefined()
    expect(fluidPositionOfKey('1,,3')).toBeUndefined()
    expect(fluidPositionOfKey('1,not-a-number,3')).toBeUndefined()
    expect(fluidNeighboursOf(fluidPosition)).toStrictEqual([
      { x: -2, y: 69, z: 3 },
      { x: -1, y: 70, z: 3 },
      { x: -3, y: 70, z: 3 },
      { x: -2, y: 70, z: 4 },
      { x: -2, y: 70, z: 2 },
    ])
  })

  it('validates fluid levels and derives state from block properties', () => {
    expect(FLUID_LEVEL_MIN).toBe(1)
    expect(FLUID_LEVEL_MAX).toBe(8)
    expect(createFluidState('water', 8, true)).toStrictEqual({ kind: 'water', level: 8, source: true })
    expect(createFluidState('lava', 1)).toStrictEqual({ kind: 'lava', level: 1, source: false })
    expect(createFluidState('none', 1)).toBeUndefined()
    expect(createFluidState('water', 1.5)).toBeUndefined()
    expect(createFluidState('water', 0)).toBeUndefined()
    expect(createFluidState('water', 9)).toBeUndefined()
    expect(fluidStateForBlock('water')).toStrictEqual({ kind: 'water', level: 8, source: true })
    expect(fluidStateForBlock('lava', 4)).toStrictEqual({ kind: 'lava', level: 4, source: true })
    expect(fluidStateForBlock('stone')).toBeUndefined()
  })

  it('applies replaceability and source-level flow rules', () => {
    expect(canFluidEnter('air', 'water')).toBe(true)
    expect(canFluidEnter('tall_grass', 'lava')).toBe(true)
    expect(canFluidEnter('water', 'water')).toBe(false)
    expect(canFluidEnter('water', 'lava')).toBe(false)
    expect(canFluidEnter('stone', 'water')).toBe(false)
    expect(flowInto({ kind: 'water', level: 8, source: true }, 'air')).toStrictEqual({
      kind: 'water',
      level: 7,
      source: false,
    })
    expect(flowInto({ kind: 'water', level: 2, source: false }, 'air')).toStrictEqual({
      kind: 'water',
      level: 1,
      source: false,
    })
    expect(flowInto({ kind: 'water', level: 1, source: false }, 'air')).toBeUndefined()
    expect(flowInto({ kind: 'lava', level: 8, source: true }, 'water')).toBeUndefined()
  })
})

describe('kernel block raycast', () => {
  it('normalizes valid directions and rejects invalid ones', () => {
    expect(normalizeDirection(position(3, 0, 4))).toStrictEqual({ x: 0.6, y: 0, z: 0.8 })
    expect(normalizeDirection(position(0, 0, 0))).toBeUndefined()
    expect(normalizeDirection(position(Number.POSITIVE_INFINITY, 0, 0))).toBeUndefined()
    expect(normalizeDirection(position(Number.NaN, 0, 0))).toBeUndefined()
  })

  it('returns the starting block, entered faces, and precise distances', () => {
    const stone = blockIdOf('stone')
    const blocks = new Map<string, ReturnType<typeof blockIdOf>>([
      ['2,1,0', stone],
      ['-1,1,0', stone],
      ['0,2,0', stone],
      ['0,0,0', stone],
      ['0,1,1', stone],
      ['0,1,-1', stone],
    ])
    const blockAt = (block: { readonly x: number; readonly y: number; readonly z: number }) =>
      blocks.get(`${block.x},${block.y},${block.z}`)

    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(1, 0, 0),
        maxDistance: 10,
        blockAt,
      }),
    ).toMatchObject({ block: { x: 2, y: 1, z: 0 }, adjacent: { x: 1, y: 1, z: 0 }, distance: 1.5, face: 'xNegative' })

    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(-1, 0, 0),
        maxDistance: 10,
        blockAt,
      }),
    ).toMatchObject({ block: { x: -1, y: 1, z: 0 }, distance: 0.5, face: 'xPositive' })

    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(0, 1, 0),
        maxDistance: 10,
        blockAt,
      }),
    ).toMatchObject({ block: { x: 0, y: 2, z: 0 }, distance: 0.5, face: 'yNegative' })

    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(0, -1, 0),
        maxDistance: 10,
        blockAt,
      }),
    ).toMatchObject({ block: { x: 0, y: 0, z: 0 }, distance: 0.5, face: 'yPositive' })

    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(0, 0, 1),
        maxDistance: 10,
        blockAt,
      }),
    ).toMatchObject({ block: { x: 0, y: 1, z: 1 }, distance: 0.5, face: 'zNegative' })

    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(0, 0, -1),
        maxDistance: 10,
        blockAt,
      }),
    ).toMatchObject({ block: { x: 0, y: 1, z: -1 }, distance: 0.5, face: 'zPositive' })

    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(1, 0, 0),
        maxDistance: 0,
        blockAt,
      }),
    ).toBeUndefined()
    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(1, 0, 0),
        maxDistance: 1,
        blockAt,
      }),
    ).toBeUndefined()
    expect(
      raycastBlocks({
        origin: position(0.5, 1.5, 0.5),
        direction: position(0, 0, 0),
        maxDistance: 10,
        blockAt,
      }),
    ).toBeUndefined()
  })

  it('ignores non-collidable and unknown block ids and validates inputs', () => {
    const water = blockIdOf('water')
    const stone = blockIdOf('stone')
    const unknown = toBlockId(255)!
    const blocks = new Map([
      ['1,0,0', water],
      ['2,0,0', stone],
    ])
    const blockAt = (block: { readonly x: number; readonly y: number; readonly z: number }) =>
      blocks.get(`${block.x},${block.y},${block.z}`) ?? (block.x === 3 ? unknown : undefined)
    expect(
      raycastBlocks({
        origin: position(0.5, 0.5, 0.5),
        direction: position(1, 0, 0),
        maxDistance: 10,
        blockAt,
      }),
    ).toMatchObject({ block: { x: 2, y: 0, z: 0 }, blockId: stone })
    expect(
      raycastBlocks({
        origin: position(0.5, 0.5, 0.5),
        direction: position(1, 0, 0),
        maxDistance: 1,
        blockAt,
      }),
    ).toBeUndefined()
    expect(
      raycastBlocks({
        origin: position(Number.NaN, 0, 0),
        direction: position(1, 0, 0),
        maxDistance: 10,
        blockAt,
      }),
    ).toBeUndefined()
    expect(
      raycastBlocks({
        origin: position(0, 0, 0),
        direction: position(1, 0, 0),
        maxDistance: Number.POSITIVE_INFINITY,
        blockAt,
      }),
    ).toBeUndefined()
  })

  it('hits a collidable block at the ray origin', () => {
    const stone = blockIdOf('stone')
    expect(
      raycastBlocks({
        origin: position(0.25, 1.25, 0.25),
        direction: position(1, 1, 1),
        maxDistance: 0,
        blockAt: () => stone,
      }),
    ).toStrictEqual({
      block: { x: 0, y: 1, z: 0 },
      adjacent: { x: 0, y: 1, z: 0 },
      blockId: stone,
      distance: 0,
      face: 'inside',
    })
  })
})

describe('kernel redstone rules', () => {
  it('clamps signal levels and applies distance decay', () => {
    expect(MAX_POWER_LEVEL).toBe(15)
    expect(MAX_REDSTONE_POWER).toBe(MAX_POWER_LEVEL)
    expect(clampPower(-1)).toBe(0)
    expect(clampPower(2.9)).toBe(2)
    expect(clampPower(100)).toBe(15)
    expect(clampPower(Number.POSITIVE_INFINITY)).toBe(15)
    expect(clampPower(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(clampPower(Number.NaN)).toBe(0)
    expect(decayPower(15)).toBe(14)
    expect(decayPower(2, 0)).toBe(2)
    expect(decayPower(2, -1.9)).toBe(2)
    expect(decayPower(2, 1.9)).toBe(1)
    expect(decayPower(2, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('propagates strongest signals through cyclic adjacency', () => {
    const result = propagateRedstonePower(
      new Map([
        ['lever', 15],
        ['weak', 1],
        ['isolated', 4],
        ['zero', 0],
      ]),
      new Map([
        ['lever', ['a']],
        ['a', ['b', 'shared']],
        ['b', ['shared']],
        ['shared', ['a']],
        ['weak', ['weak-child']],
      ]),
    )
    expect(Object.fromEntries(result)).toStrictEqual({
      lever: 15,
      weak: 1,
      isolated: 4,
      zero: 0,
      a: 14,
      b: 13,
      shared: 13,
    })
    expect(result.has('weak-child')).toBe(false)
    expect(result.has('missing')).toBe(false)
  })
})

describe('kernel piston rules', () => {
  it('plans movable pushes and reports both refusal reasons', () => {
    expect(PISTON_PUSH_LIMIT).toBe(12)
    expect(planPistonPush([])).toStrictEqual({ kind: 'push', plan: { moved: [], length: 0 } })
    expect(planPistonPush(['stone', 'dirt'])).toStrictEqual({
      kind: 'push',
      plan: { moved: ['stone', 'dirt'], length: 2 },
    })
    expect(planPistonPush(['obsidian'])).toStrictEqual({
      kind: 'refused',
      refusal: { reason: 'immovable', at: 0 },
    })
    expect(planPistonPush(['stone', 'obsidian'])).toStrictEqual({
      kind: 'refused',
      refusal: { reason: 'immovable', at: 1 },
    })
    const tooLong = Array.from({ length: PISTON_PUSH_LIMIT + 1 }, () => 'stone' as const)
    expect(planPistonPush(tooLong)).toStrictEqual({
      kind: 'refused',
      refusal: { reason: 'too-long', at: PISTON_PUSH_LIMIT },
    })
    expect(isPistonMovable('stone')).toBe(true)
    expect(isPistonMovable('obsidian')).toBe(false)
  })
})
