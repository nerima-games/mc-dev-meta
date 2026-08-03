/**
 * Tests for `domain/mirror-contract.ts`.
 *
 * NOTHING HERE READS `repos/`. That is the same rule `test/sync-plan.test.ts`
 * follows for git: the decision logic is a pure function over observations, so
 * an "agreeing mirror", a "mirror with a wrong block id" and a "mirror whose
 * repository is not cloned" are all fixtures. A test that needed fifteen clones
 * would only run on a machine that already had the answer.
 *
 * The observations these fixtures build are exactly the shape
 * `scripts/check-mirrors.ts` produces from the real modules — a `Refinement`
 * carries the verdict of each sample, a `TagKey` carries the string Effect
 * resolves by, a `CapabilityObservation` carries the two accepted id sets.
 */
import { describe, expect, it } from 'vitest'
import {
  compareMirror,
  compareSurfaces,
  DECLARED_DIVERGENCES,
  describeMirrorFinding,
  describeMirrorRun,
  describeProvenance,
  failingOutcomes,
  fingerprintFinding,
  isOffPin,
  KNOWN_FINDINGS,
  MIRROR_SOURCE_NOTE,
  MIRROR_SPECS,
  unprobedColumns,
  mirrorRunExitCode,
  REFINEMENT_SAMPLES,
  staleKnownFindings,
  type CapabilityObservation,
  type KnownFinding,
  type MirrorFinding,
  type MirrorObservation,
  type MirrorOutcome,
  type MirrorSpec,
  type PropertyObservation,
  type RepositoryProvenance,
  type SourceObservation,
  type ValueObservation,
} from '../src/domain/mirror-contract'
import type { TypeShape } from '../src/domain/type-shape'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const spec: MirrorSpec = {
  repository: 'mx-gameplay',
  file: 'domain/chunk-store-port.ts',
  source: 'mc-worldgen',
  renamedTypes: [{ mirror: 'WorldgenChunk', source: 'Chunk' }],
  capabilities: [{ mirrorExport: 'isReplaceable', owner: 'mc-kernel', capability: 'replaceable' }],
  properties: [{ mirrorExport: 'opacityOfBlockId', owner: 'mc-kernel', property: 'opacity' }],
}

/** A refinement that accepts every finite, non-negative number. */
const nonNegative = (name: string): ValueObservation => ({
  _tag: 'Refinement',
  name,
  verdicts: REFINEMENT_SAMPLES.map((sample) => ({
    sample: sample.label,
    verdict:
      typeof sample.value !== 'number'
        ? 'threw'
        : Number.isFinite(sample.value) && sample.value >= 0
          ? 'accepted'
          : 'rejected',
  })),
})

/** The same brand refined to the frame-budget window — the defect this project shipped. */
const frameBudget = (name: string): ValueObservation => ({
  _tag: 'Refinement',
  name,
  verdicts: REFINEMENT_SAMPLES.map((sample) => ({
    sample: sample.label,
    verdict:
      typeof sample.value !== 'number'
        ? 'threw'
        : sample.value >= 0.001 && sample.value <= 0.05
          ? 'accepted'
          : 'rejected',
  })),
})

const shape = (
  name: string,
  members: ReadonlyArray<readonly [string, boolean]>,
): TypeShape => ({
  name,
  declaredAs: 'type',
  exported: true,
  variants: [{ tag: undefined, members: members.map(([member, optional]) => ({ name: member, optional })) }],
})

const union = (
  name: string,
  arms: ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
): TypeShape => ({
  name,
  declaredAs: 'type',
  exported: true,
  variants: arms.map(([tag, members]) => ({
    tag,
    members: members.map((member) => ({ name: member, optional: false })),
  })),
})

const capability = (
  mirrorAccepts: ReadonlyArray<string>,
  ownerAccepts: ReadonlyArray<string>,
): CapabilityObservation => ({
  mirrorExport: 'isReplaceable',
  owner: 'mc-kernel',
  capability: 'replaceable',
  mirrorAccepts,
  ownerAccepts,
})

const AGREED_IDS = ['0 (air)', '6 (water)', '11 (lava)']

/**
 * A property reading list, as `scripts/check-mirrors.ts` builds one.
 *
 * Note the shape: EVERY id carries a reading, including the ones both sides
 * agree on. That is what makes the comparison closed, and a fixture that only
 * listed disagreements would be testing a spot-check.
 */
const property = (
  readings: ReadonlyArray<readonly [id: string, mirror: string, owner: string]>,
): PropertyObservation => ({
  mirrorExport: 'opacityOfBlockId',
  owner: 'mc-kernel',
  property: 'opacity',
  readings: readings.map(([id, mirror, owner]) => ({ id, mirror, owner })),
})

/** Three ids on which the mirror and kernel say the same thing. */
const AGREED_OPACITIES = [
  ['0 (air)', '"transparentSolid"', '"transparentSolid"'],
  ['1 (stone)', '"opaque"', '"opaque"'],
  ['6 (water)', '"fluid"', '"fluid"'],
] as const

const agreeingMirror: MirrorObservation = {
  values: [
    { _tag: 'Scalar', name: 'AIR_BLOCK_ID', rendered: '0' },
    { _tag: 'TagKey', name: 'ChunkStore', key: '@nerima-games/mc-worldgen/ChunkStore' },
    nonNegative('ChunkAxis'),
  ],
  types: [
    shape('ChunkStoreApi', [
      ['getBlock', false],
      ['setBlock', false],
    ]),
    shape('WorldgenChunk', [
      ['biomes', false],
      ['blocks', false],
      ['coord', false],
    ]),
    union('BlockReading', [
      ['Block', ['_tag', 'block']],
      ['ChunkNotLoaded', ['_tag']],
      ['OutOfWorld', ['_tag']],
    ]),
  ],
  capabilities: [capability(AGREED_IDS, AGREED_IDS)],
  properties: [property(AGREED_OPACITIES)],
  // The one column this fixture transcribes, and `spec` probes it. The pair
  // agreeing is what makes this the AGREEING mirror for the coverage check too.
  probeableColumns: [{ mirrorExport: 'opacityOfBlockId', property: 'opacity', owner: 'mc-kernel' }],
}

const agreeingSource: SourceObservation = {
  values: [
    { _tag: 'Scalar', name: 'AIR_BLOCK_ID', rendered: '0' },
    { _tag: 'TagKey', name: 'ChunkStore', key: '@nerima-games/mc-worldgen/ChunkStore' },
    nonNegative('ChunkAxis'),
  ],
  types: [
    shape('ChunkStoreApi', [
      ['getBlock', false],
      ['setBlock', false],
    ]),
    // Named `Chunk` here; `spec.renamedTypes` says the mirror calls it
    // `WorldgenChunk`.
    shape('Chunk', [
      ['biomes', false],
      ['blocks', false],
      ['coord', false],
    ]),
    union('BlockReading', [
      ['Block', ['_tag', 'block']],
      ['ChunkNotLoaded', ['_tag']],
      ['OutOfWorld', ['_tag']],
    ]),
  ],
  published: new Set(['AIR_BLOCK_ID', 'ChunkStore', 'ChunkAxis', 'ChunkStoreApi', 'Chunk', 'BlockReading']),
}

const withValues = (
  replacements: ReadonlyArray<ValueObservation>,
): MirrorObservation => ({
  ...agreeingMirror,
  values: agreeingMirror.values.map(
    (value) => replacements.find((replacement) => replacement.name === value.name) ?? value,
  ),
})

const findingsFor = (mirror: MirrorObservation): ReadonlyArray<MirrorFinding> =>
  compareSurfaces(spec, mirror, agreeingSource)

const rendered = (mirror: MirrorObservation): string =>
  findingsFor(mirror)
    .map((finding) => describeMirrorFinding(spec, finding))
    .join('\n')

// ---------------------------------------------------------------------------

describe('the registry itself', () => {
  it('names a distinct file per row, so no mirror is checked twice or forgotten', () => {
    const keys = MIRROR_SPECS.map((entry) => `${entry.repository}/${entry.file}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never points a mirror at its own repository', () => {
    for (const entry of MIRROR_SPECS) {
      expect(entry.source).not.toBe(entry.repository)
    }
  })

  /*
   * The registry's first mc-sim row, and the property its comment claims.
   *
   * A probe row EXEMPTS its symbol from the "is it on the source's barrel?"
   * check — that is the blindfold the note under `MIRROR_SPECS` records — and
   * the two symbols `domain/inventory-port.ts` is most likely to grow are
   * exactly the two mc-sim's barrel cannot hand back: `ItemType` and
   * `StackCount`, which mc-sim mirrors from kernel and deliberately does not
   * re-export. A probe row here would silence the finding that says so.
   */
  it('the mc-sim inventory mirror carries no capability probe, and no rename', () => {
    const inventory = MIRROR_SPECS.find(
      (entry) => entry.repository === 'mx-gameplay' && entry.file === 'domain/inventory-port.ts',
    )

    expect(inventory?.source).toBe('mc-sim')
    expect(inventory?.capabilities).toStrictEqual([])
    expect(inventory?.renamedTypes).toStrictEqual([])
  })
})

/*
 * WHAT THIS GATE CANNOT SEE, pinned as a test rather than left in a comment.
 *
 * `domain/type-shape.ts` reads a declaration as a list of VARIANTS with
 * MEMBERS. A closed literal union — `type ItemType = (typeof ITEM_TYPES)[number]`
 * or its expansion — has no members at all, so both sides read as zero variants
 * and `compareTypes` skips the pair by the rule that "both sides unreadable is
 * nothing for a text comparison to say".
 *
 * That rule is right and it has a cost, and the cost is not hypothetical: on the
 * day this test was written, mc-sim's `domain/kernel-vocabulary.ts` mirrored
 * kernel's `ITEM_TYPES` at TWENTY-THREE literals against kernel's ninety-seven,
 * and this gate reported that mirror as `ok`. `ItemType` is a PARAMETER type on
 * `InventoryService.add`, so the narrower union does not merely go stale — it
 * REFUSES seventy-four of kernel's items, and mining anything outside the
 * starter set would not compile on repoint day.
 *
 * `pnpm check:repoint` is what catches it, because a compiler compares
 * membership. This test exists so that nobody reads a green `check:mirrors` as
 * a statement about a literal union's width.
 */
describe('a closed literal union’s WIDTH is invisible here, by construction', () => {
  const alias = (name: string): TypeShape => ({
    name,
    declaredAs: 'type',
    exported: true,
    variants: [],
  })

  it('reports nothing when two unions of different membership share a name', () => {
    const narrow: MirrorObservation = {
      values: [],
      types: [alias('ItemType')],
      capabilities: [],
      properties: [],
      probeableColumns: [],
    }
    const wide: SourceObservation = {
      values: [],
      types: [alias('ItemType')],
      published: new Set(['ItemType']),
    }

    // No finding, and that is CORRECT for this gate rather than a bug in it:
    // the membership is not in either observation, so there is nothing to
    // disagree about. The width is `check:repoint`'s question.
    expect(compareSurfaces(spec, narrow, wide)).toStrictEqual([])
  })
})

describe('agreeing mirrors pass', () => {
  it('reports nothing when every value, type and capability matches', () => {
    expect(findingsFor(agreeingMirror)).toStrictEqual([])
  })

  // A rename is not drift. mx-gameplay really does call mc-worldgen's `Chunk`
  // "WorldgenChunk", and recording that in the spec is what keeps it from being
  // reported forever.
  it('follows a declared rename rather than reporting the type as missing', () => {
    expect(rendered(agreeingMirror)).not.toContain('WorldgenChunk')
  })

  it('exits 0', () => {
    expect(mirrorRunExitCode([compareMirror(spec, agreeingMirror, agreeingSource, [])], [])).toBe(0)
  })
})

describe('a changed constant fails, and names both values', () => {
  // REGRESSION — the sharpest instance in the workspace, in miniature: a
  // hand-transcribed number that no compiler on either side can check.
  const drifted = withValues([{ _tag: 'Scalar', name: 'AIR_BLOCK_ID', rendered: '1' }])

  it('is a finding', () => {
    expect(findingsFor(drifted)).toStrictEqual([
      { _tag: 'ScalarDiffers', symbol: 'AIR_BLOCK_ID', mirror: '1', source: '0' },
    ])
  })

  it('names the symbol, what the mirror says, and what the source says', () => {
    const message = rendered(drifted)

    expect(message).toContain('mx-gameplay/domain/chunk-store-port.ts')
    expect(message).toContain('AIR_BLOCK_ID')
    expect(message).toContain('is 1')
    expect(message).toContain('mc-worldgen publishes 0')
  })
})

describe('a changed tag key fails', () => {
  // REGRESSION — Effect resolves a Context.Tag by this string. Two classes
  // built from two different keys typecheck in both repositories and are two
  // different services at runtime; nothing else in the organisation can see it.
  const drifted = withValues([
    { _tag: 'TagKey', name: 'ChunkStore', key: '@nerima-games/mx-gameplay/ChunkStore' },
  ])

  it('is a finding', () => {
    expect(findingsFor(drifted)).toStrictEqual([
      {
        _tag: 'TagKeyDiffers',
        symbol: 'ChunkStore',
        mirror: '@nerima-games/mx-gameplay/ChunkStore',
        source: '@nerima-games/mc-worldgen/ChunkStore',
      },
    ])
  })

  it('quotes both keys and says why the difference is invisible to tsc', () => {
    const message = rendered(drifted)

    expect(message).toContain('"@nerima-games/mx-gameplay/ChunkStore"')
    expect(message).toContain('"@nerima-games/mc-worldgen/ChunkStore"')
    expect(message).toContain('different services at runtime')
  })
})

describe('a changed brand refinement fails, and names the samples it disagrees on', () => {
  // REGRESSION — `DeltaTimeSecs` was once refined to [0.001, 0.05] in one
  // repository and `>= 0` in another, under the same brand key. Both
  // repositories typechecked. A value one accepts is a value the other believes
  // it has already validated.
  const drifted: MirrorObservation = {
    ...agreeingMirror,
    values: agreeingMirror.values.map((value) =>
      value.name === 'ChunkAxis' ? frameBudget('ChunkAxis') : value,
    ),
  }

  it('is a finding', () => {
    const findings = findingsFor(drifted)

    expect(findings).toHaveLength(1)
    expect(findings[0]?._tag).toBe('RefinementDiffers')
  })

  it('names a boundary sample and both verdicts', () => {
    const message = rendered(drifted)

    expect(message).toContain('ChunkAxis')
    expect(message).toContain('0.0005: mirror rejected, mc-worldgen accepted')
    expect(message).toContain('1: mirror rejected, mc-worldgen accepted')
  })

  it('does not report the samples the two agree on', () => {
    expect(rendered(drifted)).not.toContain('0.016:')
  })
})

describe('a wrong capability id fails, and names the id and the block', () => {
  // REGRESSION — the finding this check was built to produce. mx-gameplay
  // transcribes mc-kernel's replaceable set by hand; a block added to kernel's
  // table and not to the transcription means gameplay asks the right question
  // of the wrong byte, and every test in both repositories agrees with itself.
  const drifted: MirrorObservation = {
    ...agreeingMirror,
    capabilities: [capability(['0 (air)', '6 (water)'], AGREED_IDS)],
  }

  it('is a finding naming the id present only in the source', () => {
    expect(findingsFor(drifted)).toStrictEqual([
      {
        _tag: 'CapabilityDiffers',
        symbol: 'isReplaceable',
        owner: 'mc-kernel',
        capability: 'replaceable',
        onlyInMirror: [],
        onlyInSource: ['11 (lava)'],
      },
    ])
  })

  it('says which side says what, with the block named', () => {
    const message = rendered(drifted)

    expect(message).toContain('isReplaceable')
    expect(message).toContain('mc-kernel says TRUE for ids the mirror says FALSE for: 11 (lava)')
  })

  it('reports the opposite direction too', () => {
    const inverted: MirrorObservation = {
      ...agreeingMirror,
      capabilities: [capability([...AGREED_IDS, '2 (stone)'], AGREED_IDS)],
    }

    expect(rendered(inverted)).toContain(
      'the mirror says TRUE for ids mc-kernel says FALSE for: 2 (stone)',
    )
  })
})

/*
 * THE PROPERTY HALF, and the defect that paid for it.
 *
 * mc-kernel splits its block model in two at design time: booleans in
 * `domain/block-capabilities.ts` behind `capabilityOfBlockId`, typed columns in
 * `domain/block-properties.ts` behind `propertyOfBlockId`. Until these tests
 * existed, `MIRROR_SPECS` probed only the first half and reported on both.
 *
 * What that cost is not hypothetical. mc-worldgen's `domain/kernel-vocabulary.ts`
 * transcribed SIX non-opaque rows against kernel's twenty-four, and the eighteen
 * missing ones — a ladder, a cobweb, eleven plants, two rails, a cactus, a
 * pressure plate and a slab — each fell through to the `'opaque'` default.
 * That is the DARK direction, the one mc-worldgen's DN-7 names as
 * NON-conservative: a cell read darker than it is lets a hostile spawn where
 * `hostile-spawn.ts` would have refused. It survived because the only check that
 * could see it was a test inside mc-worldgen sampling the six rows it already
 * had, and because generated terrain writes only ids 0-10 — the defect was
 * reachable only through a PLACED block, so no golden fixture ever moved.
 */
describe('a stale property row fails, and names the id and the block', () => {
  /** Kernel says ladder is transparentSolid; the mirror never got the row. */
  const STALE_OPACITIES = [
    ['0 (air)', '"transparentSolid"', '"transparentSolid"'],
    ['1 (stone)', '"opaque"', '"opaque"'],
    ['18 (ladder)', '"opaque"', '"transparentSolid"'],
  ] as const

  const drifted: MirrorObservation = {
    ...agreeingMirror,
    properties: [property(STALE_OPACITIES)],
  }

  it('is a finding carrying only the ids that disagree', () => {
    expect(findingsFor(drifted)).toStrictEqual([
      {
        _tag: 'PropertyDiffers',
        symbol: 'opacityOfBlockId',
        owner: 'mc-kernel',
        property: 'opacity',
        disagreements: [
          { id: '18 (ladder)', mirror: '"opaque"', owner: '"transparentSolid"' },
        ],
      },
    ])
  })

  it('names the id, the block and both readings', () => {
    const message = rendered(drifted)

    expect(message).toContain('opacityOfBlockId')
    expect(message).toContain('18 (ladder): mirror "opaque", mc-kernel "transparentSolid"')
  })

  // The ids both sides agree on are the bulk of any real run — 256 of them per
  // probe. A report that listed them would bury the one row that matters.
  it('does not report the ids the two agree on', () => {
    const message = rendered(drifted)

    expect(message).not.toContain('0 (air):')
    expect(message).not.toContain('1 (stone):')
  })

  /*
   * The direction is what decides how bad a property finding is, and neither the
   * id nor the two values say it. A missing row does not read as an error, it
   * reads as kernel's DEFAULT — `'opaque'` for this column, which is darker than
   * the truth. Whoever reads this line needs that before they can size it.
   */
  it('explains that a missing row reads as the default, not as an error', () => {
    const message = rendered(drifted)

    expect(message).toContain("silently reads")
    expect(message).toContain("mc-kernel's default")
    expect(message).toContain('DIRECTION')
  })

  it('reports a mirror that is ahead of its source too, not only behind', () => {
    const ahead: MirrorObservation = {
      ...agreeingMirror,
      properties: [
        property([['15 (glowstone)', '"transparentSolid"', '"opaque"']]),
      ],
    }

    expect(rendered(ahead)).toContain(
      '15 (glowstone): mirror "transparentSolid", mc-kernel "opaque"',
    )
  })
})

/*
 * A struct-valued column, which is why the readings are rendered as JSON.
 *
 * `supportRule` is `{kind: 'none'}`, `{kind: 'anySupporting'}` or a rule naming
 * blocks. `String` renders every one of them as `[object Object]`, so a mirror
 * that had the WRONG RULE on every id would compare equal on all of them —
 * a checker reporting agreement it never established, which this file's header
 * calls worse than no checker at all.
 */
describe('a struct-valued property column compares by value, not by identity', () => {
  const supportRule = (mirror: string, owner: string): PropertyObservation => ({
    mirrorExport: 'supportRuleOfBlockId',
    owner: 'mc-kernel',
    property: 'supportRule',
    readings: [{ id: '28 (lily_pad)', mirror, owner }],
  })

  it('sees two different rules as a disagreement', () => {
    const drifted: MirrorObservation = {
      ...agreeingMirror,
      properties: [supportRule('{"kind":"anySupporting"}', '{"kind":"oneOf","blocks":["water"]}')],
    }

    expect(rendered(drifted)).toContain(
      '28 (lily_pad): mirror {"kind":"anySupporting"}, mc-kernel {"kind":"oneOf","blocks":["water"]}',
    )
  })

  it('sees two equal rules as agreement', () => {
    const agreed: MirrorObservation = {
      ...agreeingMirror,
      properties: [supportRule('{"kind":"none"}', '{"kind":"none"}')],
    }

    expect(findingsFor(agreed)).toStrictEqual([])
  })
})

/*
 * A PROBE THAT READ NOTHING, which is the limiting case of the rule kernel's
 * audit §4.9.1(d) states: 「ミラーが転記している能力の数より probe が少なければ、
 * そのチェックは検査していない成功を報告する」.
 *
 * `disagreements.length > 0` is false for a column nobody looked at, so without
 * this guard a probe whose id range came back empty is indistinguishable from a
 * probe that compared 256 ids and found them all equal. That is the same hole
 * `compareSurfaces` closes for the observation as a whole.
 */
describe('a property probe that read zero ids is a failure, not agreement', () => {
  const empty: MirrorObservation = {
    ...agreeingMirror,
    properties: [property([])],
  }

  it('is a finding rather than silence', () => {
    expect(findingsFor(empty)).toStrictEqual([
      {
        _tag: 'PropertyProbeEmpty',
        symbol: 'opacityOfBlockId',
        owner: 'mc-kernel',
        property: 'opacity',
      },
    ])
  })

  it('says that comparing nothing is the one result it must never report', () => {
    const message = rendered(empty)

    expect(message).toContain('read ZERO ids')
    expect(message).toContain('agrees with everything')
  })
})

/*
 * WHAT THE REGISTRY CLAIMS, pinned so that a probe cannot quietly disappear.
 *
 * A row deleted from `MIRROR_SPECS` breaks nothing and fails nothing — the run
 * simply compares less and still says `ok`. These assertions are the only thing
 * that makes removing one a visible act.
 */
describe('the property probes the registry actually carries', () => {
  const specFor = (repository: string, file: string): MirrorSpec | undefined =>
    MIRROR_SPECS.find((entry) => entry.repository === repository && entry.file === file)

  it('probes both of the columns mc-worldgen mirrors', () => {
    const worldgen = specFor('mc-worldgen', 'domain/kernel-vocabulary.ts')

    expect(worldgen?.properties).toStrictEqual([
      { mirrorExport: 'opacityOfBlockId', owner: 'mc-kernel', property: 'opacity' },
      { mirrorExport: 'lightEmissionOfBlockId', owner: 'mc-kernel', property: 'lightEmission' },
    ])
  })

  // The mirror that looks like the flag mirror and is not only that:
  // SUPPORT_RULE_OVERRIDES is twenty hand-written rows of kernel's supportRule
  // COLUMN, in the same table as opacity and read through the same accessor.
  it('probes the supportRule column mx-gameplay mirrors', () => {
    const gameplay = specFor('mx-gameplay', 'domain/block-vocabulary.ts')

    expect(gameplay?.properties).toStrictEqual([
      { mirrorExport: 'supportRuleOfBlockId', owner: 'mc-kernel', property: 'supportRule' },
    ])
  })

  /*
   * THE STRUCTURAL RULE, and the reason it is a test and not a comment.
   *
   * A CAPABILITY row exempts its symbol from the "is it on the source's barrel?"
   * comparison — it has to, because a probed predicate belongs to a third
   * repository. That skip is what hid four broken repoint promises in
   * `chunk-store-port.ts` for as long as they existed.
   *
   * A PROPERTY row must NOT inherit that exemption. Kernel publishes
   * `opacityOfBlockId`, `lightEmissionOfBlockId` and `supportRuleOfBlockId` on
   * its own barrel precisely so a mirror can restate them under kernel's names,
   * so every probed symbol here has to face the plain comparison as well. If
   * someone ever "unifies" the two probe kinds, this is the assertion that
   * should stop them.
   */
  it('does not exempt a probed property symbol from the barrel comparison', () => {
    const notOnBarrel: SourceObservation = {
      ...agreeingSource,
      published: new Set([...agreeingSource.published].filter((name) => name !== 'opacityOfBlockId')),
    }
    const mirror: MirrorObservation = {
      ...agreeingMirror,
      values: [...agreeingMirror.values, { _tag: 'Opaque', name: 'opacityOfBlockId', kind: 'function' }],
    }

    expect(compareSurfaces(spec, mirror, notOnBarrel)).toContainEqual({
      _tag: 'SymbolNotPublished',
      symbol: 'opacityOfBlockId',
    })
  })

  it('gives every spec a property array, so a missing one cannot read as empty', () => {
    for (const entry of MIRROR_SPECS) {
      expect(Array.isArray(entry.properties), `${entry.repository}/${entry.file}`).toBe(true)
    }
  })
})

describe('type shape', () => {
  // REGRESSION — the one-field-vs-two-field ClockService. A Layer built against
  // the narrow mirror satisfies the full tag, and the missing member reads
  // `undefined` in a repository that never saw the mirror.
  it('fails when the mirror is missing a member the source declares', () => {
    const drifted: MirrorObservation = {
      ...agreeingMirror,
      types: [shape('ChunkStoreApi', [['getBlock', false]]), ...agreeingMirror.types.slice(1)],
    }

    expect(findingsFor(drifted)).toStrictEqual([
      { _tag: 'MemberMissingFromMirror', type: 'ChunkStoreApi', member: 'setBlock' },
    ])
    expect(rendered(drifted)).toContain('reads undefined')
  })

  it('fails when the mirror invents a member the source does not have', () => {
    const drifted: MirrorObservation = {
      ...agreeingMirror,
      types: [
        shape('ChunkStoreApi', [
          ['getBlock', false],
          ['setBlock', false],
          ['setBlockFast', false],
        ]),
        ...agreeingMirror.types.slice(1),
      ],
    }

    expect(rendered(drifted)).toContain('declares "setBlockFast", which mc-worldgen does not')
  })

  it('fails when a member is optional on one side and required on the other', () => {
    const drifted: MirrorObservation = {
      ...agreeingMirror,
      types: [
        shape('ChunkStoreApi', [
          ['getBlock', false],
          ['setBlock', true],
        ]),
        ...agreeingMirror.types.slice(1),
      ],
    }

    expect(rendered(drifted)).toContain('setBlock is optional here and required in mc-worldgen')
  })

  // REGRESSION — a dropped union arm is not a narrower type. `OutOfWorld`
  // exists precisely because it is NOT air; a mirror that lost it would let a
  // rule treat the edge of the world as empty space.
  it('fails when the mirror has dropped an arm of a discriminated union', () => {
    const drifted: MirrorObservation = {
      ...agreeingMirror,
      types: [
        ...agreeingMirror.types.slice(0, 2),
        union('BlockReading', [
          ['Block', ['_tag', 'block']],
          ['ChunkNotLoaded', ['_tag']],
        ]),
      ],
    }

    expect(rendered(drifted)).toContain('missing the arm "OutOfWorld"')
  })

  it('matches union arms by their tag, not by their position', () => {
    const reordered: MirrorObservation = {
      ...agreeingMirror,
      types: [
        ...agreeingMirror.types.slice(0, 2),
        union('BlockReading', [
          ['OutOfWorld', ['_tag']],
          ['Block', ['_tag', 'block']],
          ['ChunkNotLoaded', ['_tag']],
        ]),
      ],
    }

    expect(findingsFor(reordered)).toStrictEqual([])
  })

  // REGRESSION — the silent-pass hole in the type half. If the mirror declares
  // an alias where the source declares an object type, there are no members to
  // compare; reporting that as agreement would be exactly the failure mode
  // api-extractor was rejected for.
  it('fails when one side has a shape and the other has nothing comparable', () => {
    const drifted: MirrorObservation = {
      ...agreeingMirror,
      types: [
        { name: 'ChunkStoreApi', declaredAs: 'type', exported: true, variants: [] },
        ...agreeingMirror.types.slice(1),
      ],
    }

    expect(rendered(drifted)).toContain('compared against nothing agrees with everything')
  })

  it('fails when the mirror stands in for something the source does not publish', () => {
    const drifted: MirrorObservation = {
      ...agreeingMirror,
      types: [...agreeingMirror.types, shape('InventedPort', [['a', false]])],
    }

    expect(rendered(drifted)).toContain('not on mc-worldgen\'s published surface')
  })
})

describe('an empty observation is a failure, not agreement', () => {
  // REGRESSION — the hole a skip-friendly checker opens. With nothing to
  // compare, every comparison below trivially succeeds; a run that reports
  // success on that basis certifies that nothing happened.
  it('fails when the mirror was loaded but yielded nothing', () => {
    const findings = compareSurfaces(
      spec,
      { values: [], types: [], capabilities: [], properties: [], probeableColumns: [] },
      agreeingSource,
    )

    expect(findings.map((finding) => finding._tag)).toStrictEqual(['NothingObserved'])
    expect(describeMirrorFinding(spec, findings[0] as MirrorFinding)).toContain(
      'every comparison below would pass',
    )
  })

  it('fails when the source api-lock.md yielded no entries', () => {
    const findings = compareSurfaces(spec, agreeingMirror, {
      values: [],
      types: [],
      published: new Set<string>(),
    })

    expect(findings.map((finding) => finding._tag)).toStrictEqual(['NothingObserved'])
    expect(describeMirrorFinding(spec, findings[0] as MirrorFinding)).toContain('pnpm api:update')
  })
})

describe('an absent repository is skipped, not failed', () => {
  const skipped: ReadonlyArray<MirrorOutcome> = MIRROR_SPECS.map((entry) => ({
    _tag: 'Skipped',
    spec: entry,
    reason: `${entry.repository} is not cloned`,
  }))

  // REGRESSION — the rule domain/workspace.ts established. repos/ is
  // gitignored, so a fresh clone has nothing in it. If `pnpm verify` here
  // required fifteen other repositories to exist, the tool that fetches them
  // would be the last thing in the organisation to become trustworthy.
  it('exits 0 when nothing could be compared', () => {
    expect(mirrorRunExitCode(skipped)).toBe(0)
    expect(failingOutcomes(skipped)).toStrictEqual([])
  })

  it('says so, and says what to do about it', () => {
    const report = describeMirrorRun(skipped).join('\n')

    expect(report).toContain('nothing to compare')
    expect(report).toContain('This is not a failure')
    expect(report).toContain('pnpm sync')
  })

  it('exits 0 for a partial workspace, and still reports the mirrors it did compare', () => {
    const partial: ReadonlyArray<MirrorOutcome> = [
      compareMirror(spec, agreeingMirror, agreeingSource, []),
      ...skipped.slice(1),
    ]

    expect(mirrorRunExitCode(partial, [])).toBe(0)
    expect(describeMirrorRun(partial)[0]).toContain(
      `compared 1 of ${String(partial.length)} mirrors`,
    )
  })

  // REGRESSION — "everything skipped, exit 0, nobody notices" is the failure
  // mode a skip policy invites. Every skip prints its reason, always.
  it('prints a reason for every skip', () => {
    const report = describeMirrorRun(skipped).join('\n')

    for (const outcome of skipped) {
      expect(report).toContain(`skip ${outcome.spec.repository}/${outcome.spec.file}`)
    }
  })
})

describe('a known outstanding defect is reported without failing the run', () => {
  const drifted: MirrorObservation = {
    ...agreeingMirror,
    capabilities: [capability(['0 (air)', '6 (water)'], AGREED_IDS)],
  }
  const theFinding = compareSurfaces(spec, drifted, agreeingSource)[0] as MirrorFinding
  const register: ReadonlyArray<KnownFinding> = [
    {
      fingerprint: fingerprintFinding(spec, theFinding),
      summary: 'lava is replaceable in mc-kernel and not in the mirror',
      owner: 'mx-gameplay',
      fix: 'add 11 to REPLACEABLE_IDS',
    },
  ]

  // A defect in a repository this one does not own must not make this one
  // unverifiable — a gate its contributors cannot clear is a gate they disable.
  it('exits 0 and does not count as a new finding', () => {
    const outcome = compareMirror(spec, drifted, agreeingSource, register)

    expect(outcome._tag === 'Compared' && outcome.findings).toStrictEqual([])
    expect(outcome._tag === 'Compared' && outcome.known).toHaveLength(1)
    expect(mirrorRunExitCode([outcome], register)).toBe(0)
  })

  it('still prints the whole finding, with its owner and its fix, every run', () => {
    const report = describeMirrorRun([compareMirror(spec, drifted, agreeingSource, register)], register).join('\n')

    expect(report).toContain('mc-kernel says TRUE for ids the mirror says FALSE for: 11 (lava)')
    expect(report).toContain('owner: mx-gameplay')
    expect(report).toContain('fix:   add 11 to REPLACEABLE_IDS')
  })

  // REGRESSION — the entry must suppress ONE disagreement, not a class of them.
  // A second wrong id changes the fingerprint and is a new failure.
  it('does not suppress a different disagreement in the same symbol', () => {
    const worse: MirrorObservation = {
      ...agreeingMirror,
      capabilities: [capability(['0 (air)'], AGREED_IDS)],
    }
    const outcome = compareMirror(spec, worse, agreeingSource, register)

    expect(outcome._tag === 'Compared' && outcome.findings).toHaveLength(1)
    expect(mirrorRunExitCode([outcome], register)).toBe(1)
  })

  // REGRESSION — a register nobody prunes is a register of checks that are off.
  it('fails once the defect is fixed, and says to delete the entry', () => {
    const outcome = compareMirror(spec, agreeingMirror, agreeingSource, register)

    expect(mirrorRunExitCode([outcome], register)).toBe(1)
    expect(describeMirrorRun([outcome], register).join('\n')).toContain(
      'records a defect that this run did NOT find',
    )
  })

  it('does not call an entry stale when its mirror was never compared', () => {
    const skippedOnly: ReadonlyArray<MirrorOutcome> = [
      { _tag: 'Skipped', spec, reason: 'mx-gameplay is not cloned' },
    ]

    expect(staleKnownFindings(skippedOnly, register)).toStrictEqual([])
    expect(mirrorRunExitCode(skippedOnly, register)).toBe(0)
  })
})

/*
 * THE COVERAGE HALF, and why the property probes above are not enough.
 *
 * Every check before this one asks "do the two sides agree on this column?" and
 * can only ask it about a column `MIRROR_SPECS` names. That list is
 * hand-maintained. So the failure it cannot see is a column nobody added a row
 * for: it produces no `PropertyObservation`, appears in no comparison, and the
 * run prints the same 13/13 it prints when everything is compared. kernel's
 * audit §4.9.1(d) is exactly this — 「ミラーが転記している能力の数より probe が
 * 少なければ、そのチェックは検査していない成功を報告する」.
 *
 * It is not hypothetical here either. mc-worldgen's stale `lightEmission` table
 * was found ONLY because someone hand-added the second property row next to the
 * `opacity` one. Had they added one and not the other, fourteen missing emitters
 * would have gone on reading as dark behind a green gate.
 *
 * `unprobedColumns` closes it by asking the MIRROR what it transcribes rather
 * than asking the spec what to compare.
 */
describe('a transcribed column with no probe fails, and names the column', () => {
  const unprobed: MirrorObservation = {
    ...agreeingMirror,
    probeableColumns: [
      { mirrorExport: 'opacityOfBlockId', property: 'opacity', owner: 'mc-kernel' },
      // Transcribed by the mirror, absent from `spec.properties`. This is the
      // mc-worldgen defect's shape exactly.
      { mirrorExport: 'lightEmissionOfBlockId', property: 'lightEmission', owner: 'mc-kernel' },
    ],
  }

  it('raises PropertyColumnUnprobed for the column the spec never declared', () => {
    const findings = compareSurfaces(spec, unprobed, agreeingSource)

    expect(findings).toStrictEqual([
      {
        _tag: 'PropertyColumnUnprobed',
        symbol: 'lightEmissionOfBlockId',
        owner: 'mc-kernel',
        property: 'lightEmission',
      },
    ])
  })

  it('fails the run, rather than printing an uninspected success', () => {
    expect(mirrorRunExitCode([compareMirror(spec, unprobed, agreeingSource, [])], [])).toBe(1)
  })

  it('names the column and the fix in the report', () => {
    const rendered = describeMirrorRun([compareMirror(spec, unprobed, agreeingSource, [])]).join('\n')

    expect(rendered).toContain('lightEmissionOfBlockId')
    expect(rendered).toContain('"lightEmission" column')
    expect(rendered).toContain('MIRROR_SPECS declares no property probe for it')
  })

  it('says nothing when every transcribed column is probed', () => {
    expect(compareSurfaces(spec, agreeingMirror, agreeingSource)).toStrictEqual([])
  })

  /*
   * The mirror-with-no-probes case, which is the one the check exists for: a
   * spec whose `properties` array is empty is indistinguishable, in every other
   * check here, from a mirror that transcribes no columns at all.
   */
  it('catches a spec that probes NOTHING while the mirror transcribes a column', () => {
    const noProbes: MirrorSpec = { ...spec, properties: [] }
    const findings = compareSurfaces(noProbes, { ...agreeingMirror, properties: [] }, agreeingSource)

    expect(findings.map((finding) => finding._tag)).toStrictEqual(['PropertyColumnUnprobed'])
  })

  /*
   * A declared divergence still exempts the column. The two lists mean different
   * things: a divergence is a mirror that deliberately answers differently and
   * SAID SO, which is the opposite of the silence this check is built against.
   */
  it('respects DECLARED_DIVERGENCES, because a stated divergence is not silence', () => {
    const divergent = DECLARED_DIVERGENCES.find((entry) => entry.subject !== undefined)
    expect(divergent).toBeDefined()

    if (divergent !== undefined) {
      const divergedSpec: MirrorSpec = {
        ...spec,
        repository: divergent.repository,
        file: divergent.file,
        properties: [],
      }
      const observed: MirrorObservation = {
        ...agreeingMirror,
        properties: [],
        probeableColumns: [
          { mirrorExport: divergent.subject, property: 'opacity', owner: 'mc-kernel' },
        ],
      }

      expect(unprobedColumns(divergedSpec, observed.probeableColumns)).toStrictEqual([])
    }
  })
})

describe('the committed KNOWN_FINDINGS register', () => {
  it('records an owner and a fix for every entry, so nobody has to rediscover it', () => {
    for (const entry of KNOWN_FINDINGS) {
      expect(entry.owner).not.toBe('')
      expect(entry.fix).not.toBe('')
      expect(entry.summary).not.toBe('')
    }
  })

  it('names a mirror this workspace actually manages', () => {
    const paths = MIRROR_SPECS.map((entry) => `${entry.repository}/${entry.file}|`)

    for (const entry of KNOWN_FINDINGS) {
      expect(paths.some((prefix) => entry.fingerprint.startsWith(prefix))).toBe(true)
    }
  })

  /*
   * The register's two current entries are mc-worldgen's stale opacity and
   * lightEmission tables, found by the first run of the property probes. They are
   * recorded rather than fixed because the file that carries them belongs to
   * another repository — the trade the header argues for at length.
   *
   * Asserted as a SHAPE rather than by exact fingerprint, because the fingerprint
   * carries every disagreeing id and is meant to be regenerated by running the
   * check, not maintained here.
   */
  it('records the property findings against the repository that owns the fix', () => {
    const property = KNOWN_FINDINGS.filter((entry) =>
      entry.fingerprint.includes('"_tag":"PropertyDiffers"'),
    )

    // ZERO, and it was two: `opacity` stale on 25 ids and `lightEmission` on 14.
    // Both are repaired, so both entries are gone.
    //
    // The gate reported each disappearance BY NAME rather than passing quietly —
    // 「the entry is now suppressing nothing but the next occurrence. Delete it.」
    // A known-defect register checked in one direction only drifts pessimistic,
    // and a list nobody believes has stopped being evidence. **Going green is an
    // event here.**
    //
    // The loop below is kept for the day a property finding returns: it asserts
    // such an entry names the repository that owns the FIX, not the one that
    // detected it. Over an empty array it asserts nothing, and that is honest
    // rather than hidden — the length assertion above is what has teeth today.
    expect(property).toHaveLength(0)
    for (const entry of property) {
      expect(entry.fingerprint.startsWith('mc-worldgen/domain/kernel-vocabulary.ts|')).toBe(true)
      expect(entry.owner).toBe('mc-worldgen')
    }
  })

  /*
   * A fingerprint is `mirrorPath|JSON`, produced by running the check. If one
   * were assembled by hand it would be free to omit a disagreeing id, and an
   * entry that suppressed MORE than the finding it names is the accidental
   * widening the field's opacity exists to prevent.
   */
  it('carries fingerprints that parse, so none of them was written by hand', () => {
    for (const entry of KNOWN_FINDINGS) {
      const separator = entry.fingerprint.indexOf('|')
      expect(separator).toBeGreaterThan(0)

      const finding = JSON.parse(entry.fingerprint.slice(separator + 1)) as MirrorFinding
      const path = entry.fingerprint.slice(0, separator)
      const [repository, ...rest] = path.split('/')
      const owning = MIRROR_SPECS.find(
        (candidate) => candidate.repository === repository && candidate.file === rest.join('/'),
      )

      expect(owning, path).toBeDefined()
      if (owning !== undefined) {
        expect(fingerprintFinding(owning, finding)).toBe(entry.fingerprint)
      }
    }
  })

  // The two lists mean opposite things and conflating them would destroy both:
  // a divergence is intended forever, a known finding is a bug with an owner.
  it('is disjoint from DECLARED_DIVERGENCES', () => {
    for (const divergence of DECLARED_DIVERGENCES) {
      const prefix = `${divergence.repository}/${divergence.file}|`
      for (const entry of KNOWN_FINDINGS) {
        expect(entry.fingerprint.startsWith(prefix) && entry.summary.includes(divergence.subject)).toBe(
          false,
        )
      }
    }
  })
})

describe('the report as a whole', () => {
  const failing = compareMirror(
    spec,
    { ...agreeingMirror, capabilities: [capability(['0 (air)'], AGREED_IDS)] },
    agreeingSource,
    [],
  )

  it('exits 1 and marks the failing mirror', () => {
    expect(mirrorRunExitCode([failing])).toBe(1)
    expect(describeMirrorRun([failing]).join('\n')).toContain(
      'FAIL mx-gameplay/domain/chunk-store-port.ts vs mc-worldgen',
    )
  })

  // A count of what was actually compared is the only thing that distinguishes
  // "fifteen mirrors agreed" from "fifteen mirrors were read as empty".
  it('reports how much was compared, not just the verdict', () => {
    expect(describeMirrorRun([failing]).join('\n')).toContain(
      '3 value(s), 3 type(s), 1 capability probe(s), 1 property probe(s)',
    )
  })

  /*
   * The id count, not just the probe count. "1 property probe" and "1 property
   * probe that read one id" print identically without it, and the difference
   * between them is a closed comparison and a spot-check — which is the whole
   * distinction that let mc-worldgen's six-of-twenty-four opacity table pass.
   */
  it('reports how many ids the property probes actually read', () => {
    expect(describeMirrorRun([failing]).join('\n')).toContain(
      '1 property probe(s) over 3 id reading(s)',
    )
  })

  it('explains that neither repository could have caught this on its own', () => {
    const report = describeMirrorRun([failing]).join('\n')

    expect(report).toContain('Neither repository can see this on its own')
    expect(report).toContain('DECLARED_DIVERGENCES')
  })
})

describe('which checkout this gate read', () => {
  const PIN = 'a'.repeat(40)
  const OTHER = 'b'.repeat(40)

  const row = (overrides: Partial<RepositoryProvenance> = {}): RepositoryProvenance => ({
    name: 'mx-gameplay',
    head: PIN,
    pinned: PIN,
    dirty: false,
    ...overrides,
  })

  it('counts a repository sitting on its pin as on-pin', () => {
    expect(isOffPin(row())).toBe(false)
  })

  it('counts every way of not being the pin', () => {
    expect(isOffPin(row({ head: OTHER })), 'different revision').toBe(true)
    expect(isOffPin(row({ dirty: true })), 'dirty').toBe(true)
    expect(isOffPin(row({ head: undefined })), 'unreadable HEAD').toBe(true)
    expect(isOffPin(row({ pinned: undefined })), 'unpinned entry').toBe(true)
  })

  // REGRESSION — THE DIAGNOSIS THIS COST. This gate reads `repos/`; mc-compose's
  // `pnpm check:roster` reads the sibling working copies. Both are right for the
  // question each asks, and the split is written down in MIRROR_SOURCE_NOTE. What
  // was not defensible was that a failure named neither, so a finding against a
  // pin that could not advance read as real drift in the mirror.
  it('names the checkout it read, on a passing run', () => {
    const report = describeProvenance([row()]).join('\n')
    expect(report).toContain('repos/')
    expect(report).toContain('check:roster')
    expect(report).toContain('1 of 1 repositories are at the revision repos.json pins')
  })

  it('names the checkout it read, in the failure block too', () => {
    const failing = compareMirror(
      spec,
      { ...agreeingMirror, capabilities: [capability(['0 (air)'], AGREED_IDS)] },
      agreeingSource,
      [],
    )
    const report = describeMirrorRun([failing]).join('\n')
    for (const line of MIRROR_SOURCE_NOTE) {
      expect(report).toContain(line)
    }
  })

  it('lists every repository that is not at its pin, with both revisions', () => {
    const report = describeProvenance([
      row(),
      row({ name: 'mc-render', head: OTHER }),
    ]).join('\n')

    expect(report).toContain('1 of 2 repositories are at the revision repos.json pins')
    expect(report).toContain('1 are NOT')
    expect(report).toContain(`mc-render  disk ${OTHER.slice(0, 12)}  pinned ${PIN.slice(0, 12)}`)
    expect(report).toContain('pnpm sync')
  })

  it('says a dirty working copy is not any revision at all', () => {
    expect(describeProvenance([row({ dirty: true })]).join('\n')).toContain(
      'uncommitted changes',
    )
  })

  it('still names the source when nothing could be read', () => {
    const report = describeProvenance([]).join('\n')
    expect(report).toContain('repos/')
    expect(report).toContain('No repository under repos/ could be read')
  })
})
