/**
 * Cross-repository mirror verification: the decision half. PURE — no
 * filesystem, no dynamic import, no dependencies.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * The defect this exists to catch
 * ---------------------------------------------------------------------------
 *
 * Nothing is published yet (plan.md §6 Step 3 publishes bottom-up), so several
 * repositories carry HAND-WRITTEN MIRRORS of declarations they will eventually
 * import:
 *
 *   domain/kernel-vocabulary.ts   mc-sim, mc-render, mc-playground-kit,
 *                                 mc-compose, mc-worldgen   <- mc-kernel
 *   domain/frame-contract.ts      mx-gameplay, mx-redstone, mx-ui  <- mc-kernel
 *   domain/chunk-store-port.ts    mx-gameplay               <- mc-worldgen
 *
 * Each mirroring repository has a `*-mirror.test.ts` that pins its mirror's
 * shape in both directions and asserts the `Context.Tag` key literally. Those
 * tests are worth having and they are NOT this. THEY PIN THE TRANSCRIPTION, NOT
 * THE SOURCE. They cannot see the original, because the original lives in
 * another repository that is not a dependency and cannot be one until it is
 * published. So a mirror and its source can drift apart while every repository
 * in the organisation stays green.
 *
 * mc-dev-meta is the only place where both packages exist in one build. That is
 * the entire reason this check belongs here and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * Why this class of defect is invisible to every compiler involved
 * ---------------------------------------------------------------------------
 *
 * Effect keys `Context.Tag` and `Brand.Brand` by a STRING. Two declarations
 * sharing a key are ONE SERVICE AT RUNTIME and TWO UNRELATED NOMINAL TYPES to
 * `tsc`. Neither half of that sentence produces a diagnostic anywhere. This
 * project has already shipped four defects from it:
 *
 *   - a `ClockService` with one field in one repository and two in another;
 *   - `DeltaTimeSecs` refined to `[0.001, 0.05]` in one repository and `>= 0`
 *     in another, under the same brand key;
 *   - `mc-compose` dropping the R channel of a module type entirely;
 *   - api-extractor rendering a tag class as an empty shell, so the API lock
 *     could not see a tag rename either (see scripts/api-lock.ts).
 *
 * ---------------------------------------------------------------------------
 * Three different problems, three different mechanisms
 * ---------------------------------------------------------------------------
 *
 * 1. TRANSCRIBED CONSTANTS AND PREDICATES. Compared by IMPORTING BOTH MODULES
 *    AND RUNNING THEM. A number is compared to a number. A `Brand.refined`
 *    constructor is a real function at runtime, so it is probed over a fixed
 *    grid of samples and the accept/reject/throw vectors are compared — which
 *    is how a `[0.001, 0.05]` refinement is caught against a `>= 0` one without
 *    reading a line of source. This is the strongest evidence available and it
 *    is used wherever it can be.
 *
 * 2. TAG KEYS. Also compared by importing: an Effect tag class exposes its key
 *    as `.key`. No parsing, no string extraction, no chance of reading the key
 *    out of a doc comment by accident.
 *
 * 3. TYPE SHAPE. Types do not exist at runtime, so this half reads text — the
 *    mirror's own source, and the SOURCE repository's committed `api-lock.md`.
 *    `domain/type-shape.ts` argues at length for `api-lock.md` over re-deriving
 *    with a `ts.Program`. Member NAMES and OPTIONALITY are compared; member
 *    TYPES deliberately are not, because the mirrors diverge there ON PURPOSE
 *    and a report full of known-good noise is a report nobody reads.
 *
 * ---------------------------------------------------------------------------
 * What is NOT compared, deliberately
 * ---------------------------------------------------------------------------
 *
 * - MEMBER TYPES. See above and domain/type-shape.ts.
 * - SYMBOLS THE MIRROR DOES NOT MIRROR. Every mirror header says it is
 *   deliberately minimal. A source export absent from the mirror is correct,
 *   not a finding. The comparison is therefore driven by what the MIRROR
 *   declares, and asks the source about each of those.
 * - BEHAVIOUR. `fixedClock` returning the wrong thing is not visible here, only
 *   that both sides have it. That is what each repository's own tests are for.
 * - DOC COMMENTS. Two mirrors of one declaration may explain themselves
 *   differently and both be right.
 *
 * ---------------------------------------------------------------------------
 * Why an absent repository is a skip and not a failure
 * ---------------------------------------------------------------------------
 *
 * `repos/` is gitignored and is EMPTY in a fresh clone. `domain/workspace.ts`
 * settled the precedent and the argument is unchanged: if `pnpm verify` here
 * required fifteen other repositories to exist, the tool that fetches them
 * would be the last thing in the organisation to become trustworthy. So a
 * missing mirror repository, a missing source repository, and a workspace with
 * no `node_modules` installed are all SKIPS. Only a mirror that can actually be
 * compared against its source, and disagrees, fails.
 *
 * The hole that opens up is "everything skipped, exit 0, nobody notices". It is
 * closed in two places: `describeMirrorRun` always prints the skip count and
 * its reasons, and `compareSurfaces` treats an EMPTY OBSERVATION AS A FAILURE
 * rather than as agreement — a mirror that was loaded but yielded nothing to
 * compare is a broken checker, and a broken checker that reports success is
 * worse than no checker.
 */

import type { TypeShape, TypeVariant } from './type-shape'

// ---------------------------------------------------------------------------
// The registry: which file mirrors which repository
// ---------------------------------------------------------------------------

/**
 * A capability lookup that a mirror restates as its own predicate.
 *
 * `mx-gameplay/domain/chunk-store-port.ts` hand-transcribes the block ids that
 * fall when unsupported and the ids that are replaceable, straight out of
 * mc-kernel's `BLOCK_REGISTRY`, as two local `Set`s. Nothing in mx-gameplay can
 * check them: mc-kernel is not a dependency, and its own mirror test asserts
 * the sets it was written with. A wrong id there means gameplay asks the right
 * question of the wrong byte, and every test in the organisation agrees with
 * itself.
 *
 * The probe names the mirror's exported predicate and the flag in the owning
 * repository's table. `scripts/check-mirrors.ts` evaluates both over every
 * representable block id and compares the accepted sets.
 */
export type CapabilityProbe = {
  /** The predicate the mirror exports, e.g. `isReplaceable`. */
  readonly mirrorExport: string
  /** The repository that owns the capability table. */
  readonly owner: string
  /** The flag name in that table, e.g. `replaceable`. */
  readonly capability: string
}

export type MirrorSpec = {
  /** The repository holding the mirror. */
  readonly repository: string
  /** Path to the mirror file, relative to that repository's root. */
  readonly file: string
  /**
   * The repository whose PUBLISHED SURFACE the mirror stands in for.
   *
   * Values are read from its `index.ts` and types from its `api-lock.md`,
   * because the barrel is precisely what the mirror will be replaced by: every
   * mirror header says "delete this file and repoint the import at the
   * package".
   */
  readonly source: string
  /** Types the mirror renamed. Mirror name on the left. */
  readonly renamedTypes: ReadonlyArray<{ readonly mirror: string; readonly source: string }>
  /** Predicates restated from a capability table, possibly in a third repository. */
  readonly capabilities: ReadonlyArray<CapabilityProbe>
}

/**
 * Every mirror in the workspace.
 *
 * Hand-maintained, and that is a real cost — this list is itself a
 * transcription and can go stale. It is small, every entry is a file whose own
 * header announces that it is provisional, and `scripts/check-mirrors.ts`
 * reports any spec whose file has vanished (which is what DELETING a mirror
 * looks like, and is the signal to delete its row here too).
 */
export const MIRROR_SPECS: ReadonlyArray<MirrorSpec> = [
  { repository: 'mc-sim', file: 'domain/kernel-vocabulary.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [] },
  { repository: 'mc-render', file: 'domain/kernel-vocabulary.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [] },
  { repository: 'mc-playground-kit', file: 'domain/kernel-vocabulary.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [] },
  { repository: 'mc-compose', file: 'domain/kernel-vocabulary.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [] },
  { repository: 'mc-worldgen', file: 'domain/kernel-vocabulary.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [] },
  { repository: 'mx-gameplay', file: 'domain/frame-contract.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [] },
  { repository: 'mx-redstone', file: 'domain/frame-contract.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [] },
  { repository: 'mx-ui', file: 'domain/frame-contract.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [] },
  {
    repository: 'mx-gameplay',
    file: 'domain/chunk-store-port.ts',
    source: 'mc-worldgen',
    // The mirror calls mc-worldgen's `Chunk` "WorldgenChunk", because
    // mx-gameplay has its own notion of a chunk-shaped thing and did not want
    // to shadow it. A rename is not drift; an unrecorded rename would be.
    renamedTypes: [{ mirror: 'WorldgenChunk', source: 'Chunk' }],
    // The capability half of this file mirrors mc-kernel, not mc-worldgen —
    // two hops, one shape. This is the highest-risk transcription in the
    // workspace and the reason the probe mechanism exists.
    capabilities: [
      { mirrorExport: 'fallsWhenUnsupported', owner: 'mc-kernel', capability: 'fallsWhenUnsupported' },
      { mirrorExport: 'isReplaceable', owner: 'mc-kernel', capability: 'replaceable' },
    ],
  },
]

/** Where in the workspace a mirror lives, for messages. */
export const mirrorPath = (spec: MirrorSpec): string => `${spec.repository}/${spec.file}`

// ---------------------------------------------------------------------------
// Declared divergences
// ---------------------------------------------------------------------------

/**
 * Differences that are INTENDED, each with the reason it is intended.
 *
 * This list is the point of the exercise as much as the findings are. A mirror
 * that diverges for a good reason and says so in a doc comment is invisible to
 * a tool; the same divergence written down here is a committed, reviewed fact
 * that a human approved in a diff. Adding a row is deliberately as annoying as
 * it should be.
 *
 * `subject` is an exported symbol name, or `Type.member` for a single member.
 */
export type DeclaredDivergence = {
  readonly repository: string
  readonly file: string
  readonly subject: string
  readonly reason: string
}

export const DECLARED_DIVERGENCES: ReadonlyArray<DeclaredDivergence> = []

// ---------------------------------------------------------------------------
// Known outstanding findings
// ---------------------------------------------------------------------------

/**
 * A finding that is REAL, is a BUG, and lives in a repository this one does not
 * own.
 *
 * This is NOT `DECLARED_DIVERGENCES`, and conflating the two would destroy both.
 * A divergence is intended and will never be fixed. A known finding is a defect
 * with an owner and a fix, recorded here only because mc-dev-meta cannot land
 * the fix itself — the mirror lives in another repository with its own pull
 * request, its own review and its own `pnpm verify`.
 *
 * Recording it has to be strictly better than the two alternatives, and it is:
 *
 *   - Not running the check until the fix lands means the check lands last, by
 *     which time nobody remembers what it was for.
 *   - Failing `pnpm verify` here for a defect in another repository makes this
 *     repository unverifiable for reasons its own contributors cannot act on,
 *     and a gate people cannot clear is a gate people disable.
 *
 * The entry is matched by an EXACT FINGERPRINT of the finding, so it suppresses
 * that one disagreement and nothing else: if the wrong block id changes, or a
 * second id joins it, the fingerprint stops matching and the run fails.
 *
 * And a known finding that has been FIXED fails the run too, with a message
 * saying to delete the entry. That is deliberately the same discipline
 * `api-lock.md` enforces — a snapshot that no longer describes reality is a
 * snapshot that has stopped meaning anything — and it is what stops this list
 * from quietly becoming a list of checks that are switched off.
 */
export type KnownFinding = {
  /**
   * `fingerprintFinding`'s output. Opaque on purpose: it is produced by running
   * the check, not written by hand, so an entry cannot be widened by accident.
   */
  readonly fingerprint: string
  /** What it is, in a sentence, for whoever reads this list. Not matched on. */
  readonly summary: string
  /** The repository that must land the fix. */
  readonly owner: string
  /** What the fix is. */
  readonly fix: string
}

/**
 * Empty, and that is the intended steady state.
 *
 * It held one entry on the day this check was written: mx-gameplay's
 * `isReplaceable` omitted lava (block id 11), which mc-kernel's registry marks
 * `replaceable: true`. Falling sand and gravel did not displace lava and
 * placement treated a lava cell as occupied, while mx-gameplay's own
 * `chunk-store-mirror.test.ts` stayed green — because it pins the
 * transcription, not the source. That is the defect class this file exists for,
 * and the first run of `pnpm check:mirrors` found it.
 *
 * The entry was removed when the fix landed, which is what the register
 * requires: a known finding fails the run once it is fixed, so this list cannot
 * quietly become a set of switched-off checks.
 */
export const KNOWN_FINDINGS: ReadonlyArray<KnownFinding> = []

/**
 * A finding's identity, for matching against `KNOWN_FINDINGS`.
 *
 * Every discriminating field is in it, so an entry cannot silently widen: a
 * second wrong block id, or a different one, produces a different fingerprint
 * and therefore a new failure. Deterministic because every finding in this
 * module is built with a fixed key order.
 */
export const fingerprintFinding = (spec: MirrorSpec, finding: MirrorFinding): string =>
  `${mirrorPath(spec)}|${JSON.stringify(finding)}`

const divergenceFor = (
  spec: MirrorSpec,
  subject: string,
): DeclaredDivergence | undefined =>
  DECLARED_DIVERGENCES.find(
    (entry) =>
      entry.repository === spec.repository && entry.file === spec.file && entry.subject === subject,
  )

// ---------------------------------------------------------------------------
// Observations — what the impure shell hands back
// ---------------------------------------------------------------------------

/** One sample fed to a `Brand.refined` constructor, and what came back. */
export type SampleVerdict = {
  /** A stable label, e.g. `0.0005` or `""`. Labels, not values, so this stays plain data. */
  readonly sample: string
  readonly verdict: 'accepted' | 'rejected' | 'threw'
}

/**
 * The samples every refinement is probed with.
 *
 * One grid for every brand rather than a per-brand grid, because a per-brand
 * grid is a transcription of the refinement and would have to be kept honest by
 * something. A sample of the wrong primitive type makes the refinement throw,
 * and `threw` is a perfectly good third verdict: two agreeing refinements throw
 * on exactly the same samples.
 *
 * The values are chosen around the boundaries this project has actually got
 * wrong: `0.001` and `0.05` are the ends of the frame-budget window that was
 * once baked into `DeltaTimeSecs`; `64` and `65` bracket `MAX_STACK_COUNT`;
 * `MAX_SAFE_INTEGER + 1` separates `Number.isSafeInteger` from
 * `Number.isInteger`; the blank strings separate a trimmed non-blank check from
 * a bare length check.
 */
export const REFINEMENT_SAMPLES: ReadonlyArray<{ readonly label: string; readonly value: unknown }> = [
  { label: '-1', value: -1 },
  { label: '-0.0001', value: -0.0001 },
  { label: '0', value: 0 },
  { label: '0.0005', value: 0.0005 },
  { label: '0.001', value: 0.001 },
  { label: '0.008', value: 0.008 },
  { label: '0.016', value: 0.016 },
  { label: '0.05', value: 0.05 },
  { label: '0.0501', value: 0.0501 },
  { label: '0.5', value: 0.5 },
  { label: '1', value: 1 },
  { label: '63', value: 63 },
  { label: '64', value: 64 },
  { label: '65', value: 65 },
  { label: '255', value: 255 },
  { label: '256', value: 256 },
  { label: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
  { label: 'MAX_SAFE_INTEGER+1', value: Number.MAX_SAFE_INTEGER + 1 },
  { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
  { label: 'NaN', value: Number.NaN },
  { label: '""', value: '' },
  { label: '"   "', value: '   ' },
  { label: '"a"', value: 'a' },
  { label: '"sim:physics"', value: 'sim:physics' },
]

/**
 * One exported value, reduced to plain comparable data by the impure shell.
 *
 * `Opaque` is the honest answer for everything that is neither a scalar, a tag,
 * nor a refinement — a `Layer` factory, an `Effect`, a plain helper. Its
 * `kind` is still compared, because a mirror exporting a function where the
 * source exports an object is drift even when neither can be inspected further.
 */
export type ValueObservation =
  | { readonly _tag: 'Scalar'; readonly name: string; readonly rendered: string }
  | { readonly _tag: 'TagKey'; readonly name: string; readonly key: string }
  | { readonly _tag: 'Refinement'; readonly name: string; readonly verdicts: ReadonlyArray<SampleVerdict> }
  | { readonly _tag: 'Opaque'; readonly name: string; readonly kind: string }

export const observationKind = (observation: ValueObservation): string => {
  switch (observation._tag) {
    case 'Scalar':
      return 'a scalar'
    case 'TagKey':
      return 'a Context.Tag'
    case 'Refinement':
      return 'a Brand refinement'
    case 'Opaque':
      return `a ${observation.kind}`
  }
}

/** One capability predicate evaluated on both sides over the same id domain. */
export type CapabilityObservation = {
  readonly mirrorExport: string
  readonly owner: string
  readonly capability: string
  /** Block ids the mirror's predicate accepts, rendered ascending, e.g. `5 (sand)`. */
  readonly mirrorAccepts: ReadonlyArray<string>
  /** Block ids the owning table accepts for the same flag. */
  readonly ownerAccepts: ReadonlyArray<string>
}

/** What the shell observed about the mirror file. */
export type MirrorObservation = {
  readonly values: ReadonlyArray<ValueObservation>
  readonly types: ReadonlyArray<TypeShape>
  readonly capabilities: ReadonlyArray<CapabilityObservation>
}

/** What the shell observed about the source repository's PUBLISHED surface. */
export type SourceObservation = {
  readonly values: ReadonlyArray<ValueObservation>
  readonly types: ReadonlyArray<TypeShape>
  /** Every name in the source's `api-lock.md`, whatever its kind. */
  readonly published: ReadonlySet<string>
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type MirrorFinding =
  | { readonly _tag: 'ScalarDiffers'; readonly symbol: string; readonly mirror: string; readonly source: string }
  | { readonly _tag: 'TagKeyDiffers'; readonly symbol: string; readonly mirror: string; readonly source: string }
  | {
      readonly _tag: 'RefinementDiffers'
      readonly symbol: string
      readonly disagreements: ReadonlyArray<{
        readonly sample: string
        readonly mirror: string
        readonly source: string
      }>
    }
  | { readonly _tag: 'KindDiffers'; readonly symbol: string; readonly mirror: string; readonly source: string }
  | { readonly _tag: 'SymbolNotPublished'; readonly symbol: string }
  | { readonly _tag: 'TypeNotPublished'; readonly type: string; readonly lookedFor: string }
  | { readonly _tag: 'ShapeNotComparable'; readonly type: string; readonly objectInMirror: boolean }
  | { readonly _tag: 'VariantMissingFromMirror'; readonly type: string; readonly variant: string }
  | { readonly _tag: 'VariantNotInSource'; readonly type: string; readonly variant: string }
  | { readonly _tag: 'MemberMissingFromMirror'; readonly type: string; readonly member: string }
  | { readonly _tag: 'MemberNotInSource'; readonly type: string; readonly member: string }
  | {
      readonly _tag: 'OptionalityDiffers'
      readonly type: string
      readonly member: string
      readonly mirrorOptional: boolean
    }
  | {
      readonly _tag: 'CapabilityDiffers'
      readonly symbol: string
      readonly owner: string
      readonly capability: string
      readonly onlyInMirror: ReadonlyArray<string>
      readonly onlyInSource: ReadonlyArray<string>
    }
  | { readonly _tag: 'NothingObserved'; readonly detail: string }

const verdictOf = (
  verdicts: ReadonlyArray<SampleVerdict>,
  sample: string,
): string => verdicts.find((entry) => entry.sample === sample)?.verdict ?? 'not probed'

const compareValues = (
  spec: MirrorSpec,
  mirror: ReadonlyArray<ValueObservation>,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  const bySourceName = new Map(source.values.map((value) => [value.name, value]))
  const probed = new Set(spec.capabilities.map((probe) => probe.mirrorExport))
  const findings: Array<MirrorFinding> = []

  for (const observed of mirror) {
    if (divergenceFor(spec, observed.name) !== undefined || probed.has(observed.name)) {
      continue
    }

    const counterpart = bySourceName.get(observed.name)
    if (counterpart === undefined) {
      // Not on the source's published surface at all. That is a finding rather
      // than a skip: the mirror header promises the file can be deleted and the
      // import repointed at the package, and a symbol the package does not
      // export makes that promise false.
      if (!source.published.has(observed.name)) {
        findings.push({ _tag: 'SymbolNotPublished', symbol: observed.name })
      }
      continue
    }

    if (observed._tag !== counterpart._tag) {
      findings.push({
        _tag: 'KindDiffers',
        symbol: observed.name,
        mirror: observationKind(observed),
        source: observationKind(counterpart),
      })
      continue
    }

    if (observed._tag === 'Scalar' && counterpart._tag === 'Scalar') {
      if (observed.rendered !== counterpart.rendered) {
        findings.push({
          _tag: 'ScalarDiffers',
          symbol: observed.name,
          mirror: observed.rendered,
          source: counterpart.rendered,
        })
      }
      continue
    }

    if (observed._tag === 'TagKey' && counterpart._tag === 'TagKey') {
      if (observed.key !== counterpart.key) {
        findings.push({
          _tag: 'TagKeyDiffers',
          symbol: observed.name,
          mirror: observed.key,
          source: counterpart.key,
        })
      }
      continue
    }

    if (observed._tag === 'Refinement' && counterpart._tag === 'Refinement') {
      const disagreements = REFINEMENT_SAMPLES.map((sample) => ({
        sample: sample.label,
        mirror: verdictOf(observed.verdicts, sample.label),
        source: verdictOf(counterpart.verdicts, sample.label),
      })).filter((entry) => entry.mirror !== entry.source)

      if (disagreements.length > 0) {
        findings.push({ _tag: 'RefinementDiffers', symbol: observed.name, disagreements })
      }
      continue
    }

    if (observed._tag === 'Opaque' && counterpart._tag === 'Opaque' && observed.kind !== counterpart.kind) {
      findings.push({
        _tag: 'KindDiffers',
        symbol: observed.name,
        mirror: observationKind(observed),
        source: observationKind(counterpart),
      })
    }
  }

  return findings
}

/**
 * Index a declaration's arms so the two sides can be matched up.
 *
 * A discriminated union is matched BY ITS `_tag`, never by position, because
 * the two sides write their arms in whatever order suited the author and a
 * reordering is not a change. An untagged arm falls back to its position, which
 * is all that is available; every union in this workspace is tagged, and a plain
 * object type is one untagged arm at position 0, so the fallback is exercised by
 * the common case rather than being untested contingency code.
 */
const armsByLabel = (shape: TypeShape): ReadonlyMap<string, TypeVariant> =>
  new Map(
    shape.variants.map((variant, index) => [variant.tag ?? `arm #${String(index)}`, variant]),
  )

/** `ChunkStoreApi`, or `BlockReading (_tag: "OutOfWorld")` for one arm of a union. */
const displayOf = (shape: TypeShape, name: string, label: string): string =>
  shape.variants.length === 1 && shape.variants[0]?.tag === undefined
    ? name
    : `${name} (_tag: ${JSON.stringify(label)})`

const compareTypes = (
  spec: MirrorSpec,
  mirror: ReadonlyArray<TypeShape>,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  const bySourceName = new Map(source.types.map((shape) => [shape.name, shape]))
  const renamed = new Map(spec.renamedTypes.map((entry) => [entry.mirror, entry.source]))
  const findings: Array<MirrorFinding> = []

  for (const shape of mirror) {
    if (divergenceFor(spec, shape.name) !== undefined) {
      continue
    }

    const lookedFor = renamed.get(shape.name) ?? shape.name
    const counterpart = bySourceName.get(lookedFor)
    if (counterpart === undefined) {
      if (!source.published.has(lookedFor)) {
        findings.push({ _tag: 'TypeNotPublished', type: shape.name, lookedFor })
      }
      continue
    }

    // Both sides unreadable as object types — a brand, an alias, `never`. There
    // is nothing here for a text comparison to say, and the value half says it
    // better. Both sides readable, or neither: anything else is a finding.
    if (shape.variants.length === 0 && counterpart.variants.length === 0) {
      continue
    }
    if (shape.variants.length === 0 || counterpart.variants.length === 0) {
      findings.push({
        _tag: 'ShapeNotComparable',
        type: shape.name,
        objectInMirror: shape.variants.length > 0,
      })
      continue
    }

    const mirrorArms = armsByLabel(shape)
    const sourceArms = armsByLabel(counterpart)

    for (const label of sourceArms.keys()) {
      if (!mirrorArms.has(label)) {
        findings.push({ _tag: 'VariantMissingFromMirror', type: shape.name, variant: label })
      }
    }
    for (const label of mirrorArms.keys()) {
      if (!sourceArms.has(label)) {
        findings.push({ _tag: 'VariantNotInSource', type: shape.name, variant: label })
      }
    }

    for (const [label, arm] of mirrorArms) {
      const counterpartArm = sourceArms.get(label)
      if (counterpartArm === undefined) {
        continue
      }
      const where = displayOf(shape, shape.name, label)
      const mirrorMembers = new Map(arm.members.map((member) => [member.name, member]))
      const sourceMembers = new Map(counterpartArm.members.map((member) => [member.name, member]))

      for (const member of counterpartArm.members) {
        if (divergenceFor(spec, `${shape.name}.${member.name}`) !== undefined) {
          continue
        }
        if (!mirrorMembers.has(member.name)) {
          findings.push({ _tag: 'MemberMissingFromMirror', type: where, member: member.name })
        }
      }

      for (const member of arm.members) {
        if (divergenceFor(spec, `${shape.name}.${member.name}`) !== undefined) {
          continue
        }
        const counterpartMember = sourceMembers.get(member.name)
        if (counterpartMember === undefined) {
          findings.push({ _tag: 'MemberNotInSource', type: where, member: member.name })
          continue
        }
        if (counterpartMember.optional !== member.optional) {
          findings.push({
            _tag: 'OptionalityDiffers',
            type: where,
            member: member.name,
            mirrorOptional: member.optional,
          })
        }
      }
    }
  }

  return findings
}

const compareCapabilities = (
  spec: MirrorSpec,
  observed: ReadonlyArray<CapabilityObservation>,
): ReadonlyArray<MirrorFinding> => {
  const findings: Array<MirrorFinding> = []

  for (const capability of observed) {
    if (divergenceFor(spec, capability.mirrorExport) !== undefined) {
      continue
    }
    const mirrorSet = new Set(capability.mirrorAccepts)
    const sourceSet = new Set(capability.ownerAccepts)
    const onlyInMirror = capability.mirrorAccepts.filter((id) => !sourceSet.has(id))
    const onlyInSource = capability.ownerAccepts.filter((id) => !mirrorSet.has(id))

    if (onlyInMirror.length > 0 || onlyInSource.length > 0) {
      findings.push({
        _tag: 'CapabilityDiffers',
        symbol: capability.mirrorExport,
        owner: capability.owner,
        capability: capability.capability,
        onlyInMirror,
        onlyInSource,
      })
    }
  }

  return findings
}

/**
 * Compare one mirror against its source.
 *
 * The empty-observation guard comes FIRST and is not negotiable. Every other
 * branch here compares two things; if there is nothing to compare, every
 * comparison trivially succeeds and the run reports agreement it never
 * established. A checker that certifies that nothing happened is the exact
 * failure api-extractor was rejected for (scripts/api-lock.ts), and it must not
 * be rebuilt here.
 */
export const compareSurfaces = (
  spec: MirrorSpec,
  mirror: MirrorObservation,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  if (mirror.values.length === 0 && mirror.types.length === 0) {
    return [
      {
        _tag: 'NothingObserved',
        detail:
          `${mirrorPath(spec)} was loaded but yielded no exported values and no object types. ` +
          'Either the file is empty, or the extractor is broken. Both are failures: with nothing ' +
          'to compare, every comparison below would pass.',
      },
    ]
  }

  if (source.published.size === 0) {
    return [
      {
        _tag: 'NothingObserved',
        detail:
          `${spec.source}/api-lock.md yielded no entries, so there is no published surface to ` +
          `compare ${mirrorPath(spec)} against. Run \`pnpm api:update\` in ${spec.source}, or fix ` +
          'domain/type-shape.ts.',
      },
    ]
  }

  return [
    ...compareValues(spec, mirror.values, source),
    ...compareTypes(spec, mirror.types, source),
    ...compareCapabilities(spec, mirror.capabilities),
  ]
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const list = (values: ReadonlyArray<string>): string => values.join(', ')

/**
 * A finding, as a sentence that names the repository, the symbol, what the
 * mirror says and what the source says.
 *
 * "Mirrors differ" would be useless. The reader of this line is looking at
 * fifteen repositories they may not have open, and has to be able to go
 * straight to one file and one identifier.
 */
export const describeMirrorFinding = (spec: MirrorSpec, finding: MirrorFinding): string => {
  const at = mirrorPath(spec)

  switch (finding._tag) {
    case 'ScalarDiffers':
      return (
        `${at}: ${finding.symbol} is ${finding.mirror}, but ${spec.source} publishes ` +
        `${finding.source}. The mirror is a transcription and this one is wrong.`
      )
    case 'TagKeyDiffers':
      return (
        `${at}: ${finding.symbol} is built from the tag key "${finding.mirror}", but ` +
        `${spec.source} uses "${finding.source}". Effect resolves tags by this string, so the ` +
        'two are different services at runtime while both repositories typecheck.'
      )
    case 'RefinementDiffers': {
      const rows = finding.disagreements.map(
        (entry) => `      ${entry.sample}: mirror ${entry.mirror}, ${spec.source} ${entry.source}`,
      )
      return [
        `${at}: the Brand refinement ${finding.symbol} disagrees with ${spec.source}'s on ` +
          `${String(finding.disagreements.length)} sample(s). Both brands carry the same key, so ` +
          'a value one repository accepts is a value the other believes it has already validated.',
        ...rows,
      ].join('\n')
    }
    case 'KindDiffers':
      return (
        `${at}: ${finding.symbol} is ${finding.mirror} here and ${finding.source} in ` +
        `${spec.source}.`
      )
    case 'SymbolNotPublished':
      return (
        `${at}: ${finding.symbol} is mirrored, but ${spec.source} does not export it from its ` +
        'barrel. When the source is published, deleting this mirror and repointing the import ' +
        'will not compile.'
      )
    case 'TypeNotPublished':
      return (
        `${at}: the type ${finding.type}${finding.lookedFor === finding.type ? '' : ` (looked up as ${finding.lookedFor})`}` +
        ` is not on ${spec.source}'s published surface. Either it was renamed, or this mirror ` +
        'stands in for something that will never be importable.'
      )
    case 'ShapeNotComparable':
      return (
        `${at}: ${finding.type} is an object type ` +
        `${finding.objectInMirror ? 'here but not in' : 'in'} ${spec.source}` +
        `${finding.objectInMirror ? '' : ' but not here'}. One of the two is an alias, a brand or ` +
        'a type this checker cannot read as a shape, so its members were never compared. That is ' +
        'reported rather than skipped: a type compared against nothing agrees with everything.'
      )
    case 'VariantMissingFromMirror':
      return (
        `${at}: the union ${finding.type} is missing the arm ${JSON.stringify(finding.variant)}, ` +
        `which ${spec.source} declares. A dropped arm is not a narrower type — an exhaustive ` +
        'switch here will never see the case, and the value it never handles arrives anyway.'
      )
    case 'VariantNotInSource':
      return (
        `${at}: the union ${finding.type} declares the arm ${JSON.stringify(finding.variant)}, ` +
        `which ${spec.source} does not. Nothing will ever produce it.`
      )
    case 'MemberMissingFromMirror':
      return (
        `${at}: ${finding.type} is missing the member "${finding.member}", which ${spec.source} ` +
        'declares. A narrower mirror of a service type is not "less of the vocabulary": a Layer ' +
        'built against it satisfies the full tag and the missing member reads undefined.'
      )
    case 'MemberNotInSource':
      return (
        `${at}: ${finding.type} declares "${finding.member}", which ${spec.source} does not. ` +
        'The mirror has invented a member that will disappear on the day the import is repointed.'
      )
    case 'OptionalityDiffers':
      return (
        `${at}: ${finding.type}.${finding.member} is ` +
        `${finding.mirrorOptional ? 'optional here and required' : 'required here and optional'} ` +
        `in ${spec.source}.`
      )
    case 'CapabilityDiffers': {
      const lines = [
        `${at}: ${finding.symbol} does not agree with ${finding.owner}'s ` +
          `"${finding.capability}" capability.`,
      ]
      if (finding.onlyInSource.length > 0) {
        lines.push(
          `      ${finding.owner} says TRUE for ids the mirror says FALSE for: ${list(finding.onlyInSource)}`,
        )
      }
      if (finding.onlyInMirror.length > 0) {
        lines.push(
          `      the mirror says TRUE for ids ${finding.owner} says FALSE for: ${list(finding.onlyInMirror)}`,
        )
      }
      lines.push(
        '      This is a hand-transcribed table. Adding a row to the source table should have ' +
          'been the whole change; here it is a second place that has to be edited and was not.',
      )
      return lines.join('\n')
    }
    case 'NothingObserved':
      return `${at}: ${finding.detail}`
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type MirrorOutcome =
  | {
      readonly _tag: 'Compared'
      readonly spec: MirrorSpec
      /** Disagreements nobody has seen before. These fail the run. */
      readonly findings: ReadonlyArray<MirrorFinding>
      /** Disagreements already recorded in `KNOWN_FINDINGS`. Reported, not failed. */
      readonly known: ReadonlyArray<{
        readonly finding: MirrorFinding
        readonly entry: KnownFinding
      }>
      readonly valuesCompared: number
      readonly typesCompared: number
      readonly capabilitiesCompared: number
    }
  | { readonly _tag: 'Skipped'; readonly spec: MirrorSpec; readonly reason: string }

export const compareMirror = (
  spec: MirrorSpec,
  mirror: MirrorObservation,
  source: SourceObservation,
  registry: ReadonlyArray<KnownFinding> = KNOWN_FINDINGS,
): MirrorOutcome => {
  const all = compareSurfaces(spec, mirror, source)
  const known: Array<{ readonly finding: MirrorFinding; readonly entry: KnownFinding }> = []
  const fresh: Array<MirrorFinding> = []

  for (const finding of all) {
    const fingerprint = fingerprintFinding(spec, finding)
    const entry = registry.find((candidate) => candidate.fingerprint === fingerprint)
    if (entry === undefined) {
      fresh.push(finding)
    } else {
      known.push({ finding, entry })
    }
  }

  return {
    _tag: 'Compared',
    spec,
    findings: fresh,
    known,
    valuesCompared: mirror.values.length,
    typesCompared: mirror.types.length,
    capabilitiesCompared: mirror.capabilities.length,
  }
}

export const failingOutcomes = (
  outcomes: ReadonlyArray<MirrorOutcome>,
): ReadonlyArray<MirrorOutcome> =>
  outcomes.filter((outcome) => outcome._tag === 'Compared' && outcome.findings.length > 0)

/**
 * Entries in `KNOWN_FINDINGS` whose mirror WAS compared this run and whose
 * finding did not appear.
 *
 * Either the defect was fixed — in which case the entry must go, or it will sit
 * there suppressing the next occurrence — or it changed shape, in which case it
 * has already been reported as a new finding and the old entry is dead weight.
 * Only entries whose mirror was actually compared are reported: an entry for a
 * repository nobody cloned has not been shown to be stale.
 */
export const staleKnownFindings = (
  outcomes: ReadonlyArray<MirrorOutcome>,
  registry: ReadonlyArray<KnownFinding> = KNOWN_FINDINGS,
): ReadonlyArray<KnownFinding> => {
  const comparedPaths = outcomes
    .filter((outcome) => outcome._tag === 'Compared')
    .map((outcome) => `${mirrorPath(outcome.spec)}|`)
  const matched = new Set(
    outcomes.flatMap((outcome) =>
      outcome._tag === 'Compared' ? outcome.known.map(({ entry }) => entry.fingerprint) : [],
    ),
  )

  return registry.filter(
    (entry) =>
      !matched.has(entry.fingerprint) &&
      comparedPaths.some((prefix) => entry.fingerprint.startsWith(prefix)),
  )
}

/**
 * 0 when nothing NEW disagreed and no recorded defect has quietly gone away.
 *
 * Skips never fail; see the header. Known findings never fail; see
 * `KNOWN_FINDINGS`. A stale known finding does fail, because a register of
 * suppressed checks that nobody prunes is a register of checks that are off.
 */
export const mirrorRunExitCode = (
  outcomes: ReadonlyArray<MirrorOutcome>,
  registry: ReadonlyArray<KnownFinding> = KNOWN_FINDINGS,
): number =>
  failingOutcomes(outcomes).length > 0 || staleKnownFindings(outcomes, registry).length > 0 ? 1 : 0

/**
 * The whole report, as lines.
 *
 * Returned rather than printed so the message itself is testable — the same
 * convention `domain/workspace.ts` uses.
 *
 * The skip count is ALWAYS printed, even when it is zero and even when
 * everything passed. A check that silently skipped fifteen of fifteen looks
 * exactly like a check that passed fifteen of fifteen, and the difference is
 * the whole value of the tool.
 */
export const describeMirrorRun = (
  outcomes: ReadonlyArray<MirrorOutcome>,
  registry: ReadonlyArray<KnownFinding> = KNOWN_FINDINGS,
): ReadonlyArray<string> => {
  const compared = outcomes.filter((outcome) => outcome._tag === 'Compared')
  const skipped = outcomes.filter((outcome) => outcome._tag === 'Skipped')
  const failing = failingOutcomes(outcomes)
  const lines: Array<string> = []

  if (compared.length === 0) {
    lines.push(
      `check:mirrors: nothing to compare — 0 of ${String(outcomes.length)} mirrors could be checked.`,
      'This is not a failure. repos/ is gitignored, so a fresh clone has nothing in it; run',
      '`pnpm sync` and then `pnpm install` to make this check do anything.',
    )
  } else {
    lines.push(
      `check:mirrors: compared ${String(compared.length)} of ${String(outcomes.length)} mirrors ` +
        `(${String(skipped.length)} skipped).`,
    )
  }

  for (const outcome of outcomes) {
    if (outcome._tag === 'Skipped') {
      lines.push(`  skip ${mirrorPath(outcome.spec)} — ${outcome.reason}`)
      continue
    }
    const counts =
      `${String(outcome.valuesCompared)} value(s), ${String(outcome.typesCompared)} type(s), ` +
      `${String(outcome.capabilitiesCompared)} capability probe(s)`
    const status =
      outcome.findings.length > 0 ? 'FAIL' : outcome.known.length > 0 ? 'KNOWN' : 'ok   '
    lines.push(
      `  ${status} ${mirrorPath(outcome.spec)} vs ${outcome.spec.source} — ${counts}` +
        (outcome.known.length > 0
          ? `, ${String(outcome.known.length)} known outstanding defect(s)`
          : ''),
    )
  }

  const known = outcomes.flatMap((outcome) =>
    outcome._tag === 'Compared' ? outcome.known.map((entry) => ({ spec: outcome.spec, ...entry })) : [],
  )

  if (known.length > 0) {
    lines.push('')
    lines.push(
      `${String(known.length)} known outstanding defect(s), recorded in KNOWN_FINDINGS in`,
      'domain/mirror-contract.ts. Each is REAL and each is a BUG; none of them can be fixed from',
      'this repository, because the file that carries it belongs to another one. They do not fail',
      'this run, so that mc-dev-meta stays verifiable by its own contributors — but they are',
      'printed every single time, and a new one, or a change to one of these, does fail.',
      '',
    )
    for (const item of known) {
      lines.push(describeMirrorFinding(item.spec, item.finding))
      lines.push(`      owner: ${item.entry.owner}`)
      lines.push(`      fix:   ${item.entry.fix}`)
      lines.push('')
    }
  }

  const stale = staleKnownFindings(outcomes, registry)
  if (stale.length > 0) {
    lines.push('')
    for (const entry of stale) {
      lines.push(
        `KNOWN_FINDINGS records a defect that this run did NOT find: ${entry.summary}`,
        'It has been fixed, or it has changed and been reported above as a new finding. Either',
        'way the entry is now suppressing nothing but the next occurrence. Delete it from',
        `domain/mirror-contract.ts. Its fingerprint is:\n      ${entry.fingerprint}`,
        '',
      )
    }
  }

  if (failing.length === 0) {
    return lines
  }

  lines.push('')
  for (const outcome of failing) {
    if (outcome._tag !== 'Compared') {
      continue
    }
    lines.push(`----- ${mirrorPath(outcome.spec)} vs ${outcome.spec.source} -----`)
    for (const finding of outcome.findings) {
      lines.push(describeMirrorFinding(outcome.spec, finding))
    }
    lines.push('')
  }

  lines.push(
    'A mirror and its source have drifted apart. Neither repository can see this on its own:',
    'the source is not a dependency of the mirror and cannot be until it is published, so both',
    "sides' tests pin their own copy and agree with themselves. Fix the mirror in its own",
    'repository — or, if the divergence is intended, record it in DECLARED_DIVERGENCES in',
    'domain/mirror-contract.ts with the reason, so that it becomes a reviewed line in a diff.',
  )

  return lines
}
