/** Reviewed exceptions and known findings for the mirror gate. */

import { mirrorPath } from './mirror-path'
import type { MirrorFinding, MirrorSpec } from './mirror-model'

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

export const DECLARED_DIVERGENCES: ReadonlyArray<DeclaredDivergence> = [
  // Both rows arrived with `mx-gameplay/domain/block-vocabulary.ts`, which
  // became a spec above when the capability probes moved to it. Neither is new
  // drift — the file has looked like this all along; it had simply never been
  // compared against anything, which is the more interesting half of the story.
  {
    repository: 'mx-gameplay',
    file: 'domain/block-vocabulary.ts',
    subject: 'BLOCK_DROP_REGISTRY',
    reason:
      'A PROJECTION of kernel\'s BLOCK_REGISTRY, not a mirror of it, and the different name ' +
      'is load-bearing. Kernel\'s rows are { id, definition: BlockDefinition } — the whole block. ' +
      'This table is { id, type, harvestTool, drops }: the two struct-valued DROP columns and ' +
      'nothing else, which is the subset the mirror\'s header says it transcribes. Naming it ' +
      'BLOCK_REGISTRY would claim a mirror of a shape it does not have and trade this row for ' +
      'member-level findings that mean less. It is also never imported: it exists to build the ' +
      'two lookup maps behind dropOfBlockId, and dropOfBlockId, blockTypeOfId, blockIdOf, ' +
      'resolveDrop and resolveDropItem ARE all on kernel\'s barrel. On the day mc-kernel is ' +
      'published this table is deleted with its file and no call site follows it.',
  },
  {
    repository: 'mx-gameplay',
    file: 'domain/block-vocabulary.ts',
    subject: 'BlockDropRegistryEntry',
    reason:
      'The row type of BLOCK_DROP_REGISTRY above, and it diverges for the same reason and to ' +
      'the same extent. Kernel\'s BlockRegistryEntry nests a BlockDefinition; this one flattens ' +
      'the two drop columns beside the id and the type name. Recorded separately because a ' +
      'divergence covering a value must not silently cover a type as well.',
  },
]

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
 * Two entries, both mc-worldgen's, both found by the FIRST run of the property
 * probes — which is the same way this register got its first entry ever.
 *
 * That first one was mx-gameplay's `isReplaceable` omitting lava (block id 11),
 * which mc-kernel's registry marks `replaceable: true`. Falling sand and gravel
 * did not displace lava and placement treated a lava cell as occupied, while
 * mx-gameplay's own `chunk-store-mirror.test.ts` stayed green — because it pins
 * the transcription, not the source. It was removed when the fix landed, which
 * is what the register requires: a known finding fails the run once it is fixed,
 * so this list cannot quietly become a set of switched-off checks.
 *
 * The two below are the property half's version of the same morning's work. Both
 * are stale transcriptions of a kernel column that grew, both are in the DARK
 * direction, and neither is fixable from here — the file that carries them is
 * mc-worldgen's, with its own pull request, its own review and its own
 * `pnpm verify`. Recording them is what lets the probe that FINDS them land
 * today instead of landing after the fix, which is the trade the header above
 * argues for at length.
 *
 * A NOTE ON HOW THESE TWO WILL EXPIRE, because it is sharper than it was for the
 * lava entry. A property fingerprint carries every disagreeing id, so ANY change
 * to either side re-fails the run: mc-worldgen adding one of the missing rows,
 * and equally mc-kernel adding one more non-opaque block. The second case will
 * look like an unrelated failure and is not one — it is this register doing
 * exactly what it promises, refusing to keep suppressing a finding that has
 * changed shape. Re-run with `MIRROR_FINGERPRINTS=1` and replace the entry, or
 * better, delete it because mc-worldgen fixed the table.
 */
export const KNOWN_FINDINGS: ReadonlyArray<KnownFinding> = [
  // EMPTY, and both entries that were here are gone because they were FIXED.
  //
  // They recorded mc-worldgen's kernel mirror drifting on two property tables:
  // `opacity` stale on 25 ids and `lightEmission` on 14, every one reading as the
  // kernel default. For opacity that default is opaque and for emission it is dark,
  // and DN-7 names dark as the non-conservative direction -- a cell read darker
  // than it is lets a hostile spawn where `hostile-spawn.ts` would have refused.
  //
  // What is worth keeping is how they left. The gate did not simply pass: it
  // reported each disappearance BY NAME and told the reader to delete the entry,
  // because 「the entry is now suppressing nothing but the next occurrence」.
  //
  // A known-defect register checked in one direction only drifts pessimistic, and a
  // list nobody believes has stopped being evidence. So going green is an event
  // here, not a silence.
]

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

export const divergenceFor = (
  spec: MirrorSpec,
  subject: string,
): DeclaredDivergence | undefined =>
  DECLARED_DIVERGENCES.find(
    (entry) =>
      entry.repository === spec.repository && entry.file === spec.file && entry.subject === subject,
  )
