/** Data structures passed between mirror extraction and comparison. */

import { assertUnreachable } from './exhaustive'
import type { TypeShape } from './type-shape'

export type CapabilityProbe = {
  /** The predicate the mirror exports, e.g. `isReplaceable`. */
  readonly mirrorExport: string
  /** The repository that owns the capability table. */
  readonly owner: string
  /** The flag name in that table, e.g. `replaceable`. */
  readonly capability: string
}

/**
 * A PROPERTY column that a mirror restates as its own total lookup.
 *
 * The sibling of `CapabilityProbe`, and it exists because mc-kernel splits its
 * block model in two AT DESIGN TIME. `domain/block-capabilities.ts` holds the
 * boolean half, read through `capabilityOfBlockId`;
 * `domain/block-properties.ts` holds the typed half — `opacity` is a three-value
 * enum, `lightEmission` is `0..15`, `supportRule` is a struct — read through
 * `propertyOfBlockId`. A probe array with capability rows and no property rows
 * therefore compares one half of kernel's block model and reports on both.
 *
 * THAT IS NOT A HYPOTHETICAL AND IT COST A REAL DEFECT. mc-worldgen's
 * `domain/kernel-vocabulary.ts` transcribed SIX non-opaque rows while kernel's
 * registry carried twenty-four; the missing eighteen — a ladder, a cobweb,
 * eleven plants, two rails, a cactus, a pressure plate and a slab — all fell
 * through to the `'opaque'` default. That is the DARK direction, which
 * mc-worldgen's DN-7 names as the NON-conservative one: a cell read darker than
 * it is lets a hostile mob spawn where `hostile-spawn.ts` would have refused.
 * Nothing caught it, because generated terrain only ever writes ids 0-10 — the
 * defect was reachable only through a PLACED block, so no golden fixture moved.
 *
 * kernel's audit §4.9.1(d) already states the rule this violated:
 * 「ミラーが転記している能力の数より probe が少なければ、そのチェックは検査して
 * いない成功を報告する」. A probe array with zero property entries is that
 * sentence's limiting case.
 *
 * UNLIKE A CAPABILITY ROW, THIS IS NOT AN OWNERSHIP CLAIM AND DOES NOT EXEMPT
 * ANYTHING. Read the note under `MIRROR_SPECS`: a capability row has to skip the
 * "is it on the source's barrel?" comparison, because a probed predicate belongs
 * to a third repository and would otherwise be reported on every run — and that
 * skip is what hid four broken repoint promises for as long as they existed.
 * The property probes have no such need. Kernel publishes `opacityOfBlockId`,
 * `lightEmissionOfBlockId` and `supportRuleOfBlockId` on its own barrel
 * precisely so that a mirror can restate them under kernel's names, so every
 * probed symbol here also faces the plain comparison and must survive it. A
 * probe that ALSO silenced the barrel check would be trading a stronger
 * guarantee for a weaker one.
 */
export type PropertyProbe = {
  /** The total lookup the mirror exports, e.g. `opacityOfBlockId`. */
  readonly mirrorExport: string
  /** The repository that owns the property table. */
  readonly owner: string
  /** The column name in that table, e.g. `opacity`. */
  readonly property: string
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
  /**
   * Total lookups restated from a property table.
   *
   * Required rather than optional, and on every spec, for the same reason
   * `MirrorObservation.properties` is: an absent array and an empty one read
   * identically at the call site, so a spec that simply forgot the field would
   * probe nothing and be reported as agreement.
   */
  readonly properties: ReadonlyArray<PropertyProbe>
}

/**
 * WHY A PROBE ROW IS ALSO AN OWNERSHIP CLAIM, AND WHAT THAT ONCE HID
 * ---------------------------------------------------------------------------
 *
 * `compareValues` skips every name in a spec's `capabilities` before it can ask
 * `SymbolNotPublished`. It has to: a probed predicate is deliberately NOT on the
 * source's barrel — it belongs to a third repository — so the barrel check would
 * report a finding on every probe row. The skip is correct in isolation.
 *
 * Combined with a spec pointed at the wrong source it is a blindfold. Four
 * capability predicates lived in `mx-gameplay/domain/chunk-store-port.ts`, whose
 * source is mc-worldgen and whose header promises that deleting it and
 * repointing every import at `@nerima-games/mc-worldgen` will typecheck.
 * mc-worldgen exports none of the four. Three had probe rows here and were
 * therefore exempt from the check that would have said so; they reported
 * agreement for as long as they existed. The fourth, `canSupportAttachments`,
 * had no row, fell through to the plain comparison, and failed with exactly the
 * right message — and only once `repos.json` advanced far enough for this gate
 * to be reading current code at all.
 *
 * So the two rules that follow from it, both applied above:
 *
 *   - A probe row is a claim that the predicate is a THIRD repository's. If the
 *     mirror it sits in is not the mirror that repository's barrel replaces, the
 *     row is hiding a broken repoint promise rather than checking a set.
 *   - A mirror that restates a capability must carry a row for EVERY capability
 *     it restates, in the spec for the file that actually holds them. A short
 *     list reports success it has not checked; a misplaced list reports success
 *     about the wrong package.
 *
 * This is NOT `DECLARED_DIVERGENCES` material and was considered for it. A
 * divergence is intended and permanent. A mirror of mc-worldgen that mc-worldgen
 * cannot replace is neither — it is a defect with a fix, and the fix landed.
 */

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
    // Structurally unreachable: every ValueObservation tag is handled above,
    // so TypeScript only accepts this call because `observation` has
    // narrowed to `never`. See src/domain/exhaustive.ts.
    /* v8 ignore next 2 -- @preserve */
    default:
      return assertUnreachable(observation)
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

/** One block id, and what each side's property lookup returned for it. */
export type PropertyReading = {
  /** The id as the capability half renders one, e.g. `31 (rail)`. */
  readonly id: string
  /** The mirror's answer, rendered. JSON, so a struct column compares too. */
  readonly mirror: string
  /** The owning table's answer for the same id, rendered the same way. */
  readonly owner: string
}

/**
 * One property column read on both sides over the same id domain.
 *
 * Carries EVERY id rather than only the disagreements, which is the same
 * division of labour `CapabilityObservation` keeps: the shell reports what it
 * saw and the pure half decides what that means. It is also what makes the
 * comparison CLOSED — a reading list that stops where the mirror's table stops
 * would agree with a mirror that is missing rows, which is precisely how
 * mc-worldgen's six-of-twenty-four opacity table survived a week of green runs.
 */
export type PropertyObservation = {
  readonly mirrorExport: string
  readonly owner: string
  readonly property: string
  /** Every id in the owning table's range, ascending. */
  readonly readings: ReadonlyArray<PropertyReading>
}

/**
 * A property column the mirror TRANSCRIBES, found by looking rather than by
 * being told.
 *
 * kernel names its property readings by a fixed convention — column `opacity`
 * is read through `opacityOfBlockId` — and publishes exactly three of them on
 * its barrel. So a mirror that exports `<column>OfBlockId` for a column in
 * kernel's `BLOCK_PROPERTY_NAMES` is, by that act, transcribing that column,
 * whether or not anyone remembered to add a row to `MIRROR_SPECS`.
 *
 * This is the observation that lets `MIRROR_SPECS` be checked against reality
 * instead of trusted. See `unprobedColumns` for what is done with it.
 */
export type TranscribedColumn = {
  /** The accessor the mirror exports, e.g. `lightEmissionOfBlockId`. */
  readonly mirrorExport: string
  /** The kernel column it reads, e.g. `lightEmission`. */
  readonly property: string
  /** The repository whose property table that column belongs to. */
  readonly owner: string
}

export type MirrorObservation = {
  readonly values: ReadonlyArray<ValueObservation>
  readonly types: ReadonlyArray<TypeShape>
  readonly capabilities: ReadonlyArray<CapabilityObservation>
  readonly properties: ReadonlyArray<PropertyObservation>
  /**
   * Every property column the mirror appears to transcribe.
   *
   * Required rather than optional, for the reason `properties` is: an absent
   * array and an empty one read identically at the call site, so a caller that
   * forgot the field would report "nothing transcribed" and pass.
   */
  readonly probeableColumns: ReadonlyArray<TranscribedColumn>
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
  | {
      readonly _tag: 'PropertyDiffers'
      readonly symbol: string
      readonly owner: string
      readonly property: string
      readonly disagreements: ReadonlyArray<PropertyReading>
    }
  | {
      readonly _tag: 'PropertyProbeEmpty'
      readonly symbol: string
      readonly owner: string
      readonly property: string
    }
  /**
   * The mirror transcribes a property column that `MIRROR_SPECS` does not probe.
   *
   * kernel's audit §4.9.1(d) is the rule: 「ミラーが転記している能力の数より probe
   * が少なければ、そのチェックは検査していない成功を報告する」. Every other finding
   * in this union answers "do the two sides agree?"; this one answers the prior
   * question, "was anything actually compared?", and it is the only finding that
   * can be raised while every declared probe passes.
   *
   * It exists because the register below recorded two real defects that this
   * gate DID find, and the reason it found them was that someone had thought to
   * add the two property rows by hand. Nothing made them do it and nothing would
   * have complained had they added only one — the check would have swept 256 ids
   * of `opacity`, reported agreement on `lightEmission` by never reading it, and
   * printed a clean 13/13.
   */
  | {
      readonly _tag: 'PropertyColumnUnprobed'
      readonly symbol: string
      readonly owner: string
      readonly property: string
    }
  | { readonly _tag: 'NothingObserved'; readonly detail: string }
