import { describe, expect, it } from 'vitest'

import {
  CONTAINER_SIGNAL_FLOOR,
  CONTAINER_SIGNAL_SPAN,
  comparatorOutput,
  containerSignalStrength,
} from '../../src/kernel/redstone-comparator'
import {
  HEAVY_PLATE_CAPACITY,
  LIGHT_PLATE_CAPACITY,
  plateSignal,
} from '../../src/kernel/redstone-plate'

describe('redstone comparator rules', () => {
  it('compares against the strongest side input', () => {
    expect(comparatorOutput(8, [], 'compare')).toBe(8)
    expect(comparatorOutput(8, [8, 3], 'compare')).toBe(8)
    expect(comparatorOutput(8, [9], 'compare')).toBe(0)
    expect(comparatorOutput(8, [3, 5], 'subtract')).toBe(3)
    expect(comparatorOutput(8, [9], 'subtract')).toBe(0)
  })

  it('maps container fullness to the sixteen redstone readings', () => {
    expect(CONTAINER_SIGNAL_FLOOR + CONTAINER_SIGNAL_SPAN).toBe(15)
    expect(containerSignalStrength([])).toBe(0)
    expect(
      containerSignalStrength([
        { count: Number.NaN, maxStack: 64 },
        { count: 1, maxStack: Number.POSITIVE_INFINITY },
        { count: 2, maxStack: 0 },
        { count: 0, maxStack: 64 },
        { count: 1, maxStack: 64 },
      ]),
    ).toBe(1)
    expect(containerSignalStrength([{ count: 64, maxStack: 64 }])).toBe(15)
    expect(containerSignalStrength([{ count: Number.POSITIVE_INFINITY, maxStack: 64 }])).toBe(0)
  })
})

describe('redstone pressure plates', () => {
  it('supports binary, weighted, capped, and invalid inputs', () => {
    expect(LIGHT_PLATE_CAPACITY).toBe(15)
    expect(HEAVY_PLATE_CAPACITY).toBe(150)
    expect(plateSignal(0, { kind: 'binary' })).toBe(0)
    expect(plateSignal(Number.NaN, { kind: 'binary' })).toBe(0)
    expect(plateSignal(1, { kind: 'binary' })).toBe(15)
    expect(plateSignal(1, { kind: 'weighted', capacity: HEAVY_PLATE_CAPACITY })).toBe(1)
    expect(plateSignal(HEAVY_PLATE_CAPACITY, { kind: 'weighted', capacity: HEAVY_PLATE_CAPACITY })).toBe(15)
    expect(plateSignal(1, { kind: 'weighted', capacity: 0 })).toBe(15)
    expect(plateSignal(200, { kind: 'weighted', capacity: LIGHT_PLATE_CAPACITY })).toBe(15)
  })
})
