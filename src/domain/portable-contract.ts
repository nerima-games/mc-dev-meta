/**
 * Deciding whether `check:portable`'s "zero comparisons" state is a skip or a
 * failure. PURE.
 *
 * ---------------------------------------------------------------------------
 * The empty workspace is the normal case here too
 * ---------------------------------------------------------------------------
 *
 * `domain/workspace.ts` settled the precedent this file follows: a fresh
 * clone of mc-dev-meta has an EMPTY `repos/` — it is gitignored — and CI runs
 * with exactly that empty `repos/`, never the other 15 repositories. A gate
 * that required them to exist would make the tool that fetches them the last
 * thing in the organisation to become trustworthy.
 *
 * `check:portable` compares the root voxel/light contract against
 * `repos/mc-kernel` and `repos/mc-worldgen`. When `repos/` is empty, every one
 * of those comparisons is necessarily skipped — there is nothing to import —
 * and that is a REASONED SKIP, exactly like `check:mirrors` and
 * `check:repoint` already treat an uncloned repository. It must not fail the
 * run; the caller checks `repos/` for entries before attempting any
 * comparison at all and reports `describeSkippedPortableContractRun` instead.
 *
 * The line held here is narrower than "zero comparisons is fine", though.
 * Once `repos/` has ANYTHING cloned into it, the caller is no longer in the
 * "nothing to check yet" state — a comparison run that still finds nothing to
 * compare (every owning file absent, an import that threw, a shape that
 * changed) is exactly the kind of drift this gate exists to catch, and stays
 * a failure. `planPortableContractRun` is only ever called on that path, so
 * "zero comparisons" always means the failing case here.
 */

/** The result of having attempted every comparison against a cloned `repos/`. */
export type PortableContractRun = {
  readonly failures: ReadonlyArray<string>
}

/**
 * `comparisonCount` and `failures` are the result of having already attempted
 * every comparison against a `repos/` that has something cloned into it. Zero
 * comparisons in that state is added to `failures` as its own finding, since
 * it means something broke rather than that nothing was there to check.
 */
export const planPortableContractRun = (
  comparisonCount: number,
  failures: ReadonlyArray<string>,
): PortableContractRun => ({
  failures: comparisonCount === 0 ? [...failures, 'no runtime comparisons performed'] : failures,
})

/** 0 when the comparison run found no failures, 1 otherwise. */
export const portableContractExitCode = (run: PortableContractRun): number =>
  run.failures.length > 0 ? 1 : 0

/** Why `check:portable` skips entirely when `repos/` has nothing cloned into it. */
export const PORTABLE_CONTRACT_SKIP_REASON =
  'repos/ is empty — nothing cloned, so there is nothing to compare the portable contract against.'

/** The lines a skip prints, matching `describeWorkspaceRun`'s empty-workspace message. */
export const describeSkippedPortableContractRun = (): ReadonlyArray<string> => [
  `portable contract: ${PORTABLE_CONTRACT_SKIP_REASON}`,
  'This is the normal state of a fresh clone: repos/ is gitignored.',
  'Run `pnpm sync` to clone the repositories listed in repos.json.',
]
