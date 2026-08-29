/** Outcome aggregation and human-readable reporting for the mirror gate. */

import { describeMirrorFinding } from './mirror-finding-report'
import { mirrorPath } from './mirror-path'
import { MIRROR_SOURCE_NOTE } from './repository-provenance'
import { compareSurfaces } from './mirror-comparison'
import { fingerprintFinding, KNOWN_FINDINGS } from './mirror-registers'
import type { KnownFinding } from './mirror-registers'
import type {
  MirrorFinding,
  MirrorObservation,
  MirrorSpec,
  SourceObservation,
} from './mirror-model'

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
      readonly propertiesCompared: number
      /**
       * Ids read across every property probe on this mirror.
       *
       * Printed because "1 property probe" and "1 property probe that read one
       * id" look identical in a count of probes, and the difference between them
       * is a closed comparison and a spot-check.
       */
      readonly propertyIdsCompared: number
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
    propertiesCompared: mirror.properties.length,
    propertyIdsCompared: mirror.properties.reduce(
      (total, property) => total + property.readings.length,
      0,
    ),
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
    const idsSuffix =
      outcome.propertiesCompared > 0 ? ` over ${String(outcome.propertyIdsCompared)} id reading(s)` : ''
    const counts = `${String(outcome.valuesCompared)} value(s), ${String(outcome.typesCompared)} type(s), ${String(outcome.capabilitiesCompared)} capability probe(s), ${String(outcome.propertiesCompared)} property probe(s)${idsSuffix}`
    const status =
      outcome.findings.length > 0 ? 'FAIL' : outcome.known.length > 0 ? 'KNOWN' : 'ok   '
    const knownSuffix =
      outcome.known.length > 0 ? `, ${String(outcome.known.length)} known outstanding defect(s)` : ''
    lines.push(`  ${status} ${mirrorPath(outcome.spec)} vs ${outcome.spec.source} — ${counts}${knownSuffix}`)
  }

  const known = outcomes.flatMap((outcome) =>
    outcome._tag === 'Compared' ? outcome.known.map((entry) => ({ spec: outcome.spec, ...entry })) : [],
  )

  if (known.length > 0) {
    lines.push('')
    lines.push(
      `${String(known.length)} known outstanding defect(s), recorded in KNOWN_FINDINGS in`,
      'domain/mirror-registers.ts. Each is REAL and each is a BUG; none of them can be fixed from',
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
        `domain/mirror-registers.ts. Its fingerprint is:\n      ${entry.fingerprint}`,
        '',
      )
    }
  }

  if (failing.length === 0) {
    return lines
  }

  lines.push('')
  for (const outcome of failing) {
    // Structurally unreachable by construction: `failing` comes from
    // `failingOutcomes(outcomes)` above, which already filters to
    // `_tag === 'Compared'`. TypeScript does not narrow `failing`'s element
    // type from that filter living in a separate function, hence the check.
    /* v8 ignore next 3 -- @preserve */
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
    'domain/mirror-registers.ts with the reason, so that it becomes a reviewed line in a diff.',
    '',
    // Repeated here rather than only at the top, because this is the block a
    // failing run gets read from. The first time this gate failed, it named an
    // export the working copy plainly had, and nothing in the message said the
    // gate had not been looking at the working copy.
    ...MIRROR_SOURCE_NOTE,
  )

  return lines
}
