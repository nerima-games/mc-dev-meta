import { describe, expect, it } from 'vitest'
import { compareRosters, type RosterObservation, type RosterProbe } from '../src/domain/mirror-roster'

const probe: RosterProbe = {
  mirrorExport: 'ITEM_TYPES',
  owner: 'mc-kernel',
  sourceExport: 'ITEM_TYPES',
}

const roster = (name: string, members: ReadonlyArray<string>): RosterObservation => ({ name, members })

describe('compareRosters', () => {
  it('does nothing when no roster is declared', () => {
    expect(compareRosters([], [roster('ITEM_TYPES', ['block'])], [roster('ITEM_TYPES', ['block'])])).toStrictEqual([])
  })

  it('reports a roster missing from the mirror', () => {
    expect(compareRosters([probe], [roster('OTHER', ['block'])], [roster('ITEM_TYPES', ['block'])])).toStrictEqual([
      {
        _tag: 'RosterProbeEmpty',
        symbol: 'ITEM_TYPES',
        owner: 'mc-kernel',
        source: 'ITEM_TYPES',
      },
    ])
  })

  it('reports a roster missing from the source', () => {
    expect(compareRosters([probe], [roster('ITEM_TYPES', ['block'])], [roster('OTHER', ['block'])])).toStrictEqual([
      {
        _tag: 'RosterProbeEmpty',
        symbol: 'ITEM_TYPES',
        owner: 'mc-kernel',
        source: 'ITEM_TYPES',
      },
    ])
  })

  it('reports an empty mirror roster as a membership difference', () => {
    expect(
      compareRosters([probe], [roster('ITEM_TYPES', [])], [roster('ITEM_TYPES', ['block'])]),
    ).toStrictEqual([
      {
        _tag: 'RosterDiffers',
        symbol: 'ITEM_TYPES',
        owner: 'mc-kernel',
        source: 'ITEM_TYPES',
        onlyInMirror: [],
        onlyInSource: ['block'],
        orderDiffers: false,
      },
    ])
  })

  it('reports an empty source roster as a membership difference', () => {
    expect(
      compareRosters([probe], [roster('ITEM_TYPES', ['block'])], [roster('ITEM_TYPES', [])]),
    ).toStrictEqual([
      {
        _tag: 'RosterDiffers',
        symbol: 'ITEM_TYPES',
        owner: 'mc-kernel',
        source: 'ITEM_TYPES',
        onlyInMirror: ['block'],
        onlyInSource: [],
        orderDiffers: false,
      },
    ])
  })

  it('accepts identical membership in identical order', () => {
    expect(
      compareRosters(
        [probe],
        [roster('ITEM_TYPES', ['block', 'item'])],
        [roster('ITEM_TYPES', ['block', 'item'])],
      ),
    ).toStrictEqual([])
  })

  it('reports membership differences on both sides', () => {
    expect(
      compareRosters(
        [probe],
        [roster('ITEM_TYPES', ['block', 'potion'])],
        [roster('ITEM_TYPES', ['block', 'arrow'])],
      ),
    ).toStrictEqual([
      {
        _tag: 'RosterDiffers',
        symbol: 'ITEM_TYPES',
        owner: 'mc-kernel',
        source: 'ITEM_TYPES',
        onlyInMirror: ['potion'],
        onlyInSource: ['arrow'],
        orderDiffers: false,
      },
    ])
  })

  it('reports order differences after membership agrees', () => {
    expect(
      compareRosters(
        [probe],
        [roster('ITEM_TYPES', ['block', 'item'])],
        [roster('ITEM_TYPES', ['item', 'block'])],
      ),
    ).toStrictEqual([
      {
        _tag: 'RosterDiffers',
        symbol: 'ITEM_TYPES',
        owner: 'mc-kernel',
        source: 'ITEM_TYPES',
        onlyInMirror: [],
        onlyInSource: [],
        orderDiffers: true,
      },
    ])
  })

  it('reports cardinality differences when a member is repeated', () => {
    expect(
      compareRosters(
        [probe],
        [roster('ITEM_TYPES', ['block'])],
        [roster('ITEM_TYPES', ['block', 'block'])],
      ),
    ).toStrictEqual([
      {
        _tag: 'RosterDiffers',
        symbol: 'ITEM_TYPES',
        owner: 'mc-kernel',
        source: 'ITEM_TYPES',
        onlyInMirror: [],
        onlyInSource: [],
        orderDiffers: true,
      },
    ])
  })
})
