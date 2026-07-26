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
  failingOutcomes,
  fingerprintFinding,
  KNOWN_FINDINGS,
  MIRROR_SPECS,
  mirrorRunExitCode,
  REFINEMENT_SAMPLES,
  staleKnownFindings,
  type CapabilityObservation,
  type KnownFinding,
  type MirrorFinding,
  type MirrorObservation,
  type MirrorOutcome,
  type MirrorSpec,
  type SourceObservation,
  type ValueObservation,
} from '../domain/mirror-contract'
import type { TypeShape } from '../domain/type-shape'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const spec: MirrorSpec = {
  repository: 'mx-gameplay',
  file: 'domain/chunk-store-port.ts',
  source: 'mc-worldgen',
  renamedTypes: [{ mirror: 'WorldgenChunk', source: 'Chunk' }],
  capabilities: [{ mirrorExport: 'isReplaceable', owner: 'mc-kernel', capability: 'replaceable' }],
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
    const findings = compareSurfaces(spec, { values: [], types: [], capabilities: [] }, agreeingSource)

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
      '3 value(s), 3 type(s), 1 capability probe(s)',
    )
  })

  it('explains that neither repository could have caught this on its own', () => {
    const report = describeMirrorRun([failing]).join('\n')

    expect(report).toContain('Neither repository can see this on its own')
    expect(report).toContain('DECLARED_DIVERGENCES')
  })
})
