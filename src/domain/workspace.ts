/**
 * Planning a workspace-wide check run. PURE.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * The empty workspace is the normal case, not an error
 * ---------------------------------------------------------------------------
 *
 * A fresh clone of mc-dev-meta has an EMPTY `repos/` — it is gitignored. Every
 * script here has to work in that state, and `pnpm verify` on this repository
 * must pass in that state, because otherwise the repository cannot be verified
 * until 15 other repositories exist.
 *
 * That is why the run planner is a pure function over "what the manifest says"
 * and "what is on disk", and why `WorkspaceRunPlan.status` distinguishes
 * `empty` from `partial` from `complete`. An empty workspace produces a plan
 * with no work and a clear message, and the caller exits 0.
 */
import { assertUnreachable } from './exhaustive'
import type { Manifest, ManifestEntry } from './manifest'
import { isPinned } from './manifest'

export type WorkspaceStatus =
  /** Nothing cloned. A fresh checkout. `pnpm sync` is the next step. */
  | 'empty'
  /** Some repositories present. Normal while the project is being built bottom-up. */
  | 'partial'
  /** Every repository in the manifest is present. */
  | 'complete'

export type WorkspaceRunPlan = {
  readonly status: WorkspaceStatus
  /** Repositories that exist on disk and will be run, in manifest order. */
  readonly targets: ReadonlyArray<ManifestEntry>
  /** Repositories in the manifest but not on disk. */
  readonly missing: ReadonlyArray<string>
  /** Repositories on disk but not in the manifest — usually a rename or a stale directory. */
  readonly unmanaged: ReadonlyArray<string>
  /** Entries still carrying the `unpinned` sentinel. Reported every run. */
  readonly unpinned: ReadonlyArray<string>
}

/**
 * Decide which repositories a workspace-wide command should run in.
 *
 * `presentDirectories` is whatever is actually under `repos/`. It is passed in
 * rather than read here so that this stays pure and testable; the caller does
 * the `readdir`.
 */
export const planWorkspaceRun = (
  manifest: Manifest,
  presentDirectories: ReadonlyArray<string>,
): WorkspaceRunPlan => {
  const present = new Set(presentDirectories)
  const managed = new Set(manifest.repositories.map((entry) => entry.name))

  const targets = manifest.repositories.filter((entry) => present.has(entry.name))
  const missing = manifest.repositories
    .filter((entry) => !present.has(entry.name))
    .map((entry) => entry.name)
  const unmanaged = [...presentDirectories].filter((name) => !managed.has(name)).sort()
  const unpinned = manifest.repositories
    .filter((entry) => !isPinned(entry.ref))
    .map((entry) => entry.name)

  const status: WorkspaceStatus =
    targets.length === 0 ? 'empty' : missing.length === 0 ? 'complete' : 'partial'

  return { status, targets, missing, unmanaged, unpinned }
}

/**
 * NOTE on exit codes: an empty or partial workspace is NOT a failure, and no
 * function here returns one. During bottom-up construction (plan.md §6 Step 2)
 * most of the roster does not exist yet, and a tool that fails because the
 * future has not happened is a tool people stop running. The only thing that
 * fails a workspace run is a genuine check failure inside a repository that IS
 * present.
 */

/**
 * The human-readable header a workspace command prints before doing anything.
 *
 * Returned as lines rather than printed, so the message itself is testable.
 */
export const describeWorkspaceRun = (plan: WorkspaceRunPlan, command: string): ReadonlyArray<string> => {
  const lines: Array<string> = []

  switch (plan.status) {
    case 'empty':
      lines.push(
        `workspace: repos/ is empty — nothing to run "${command}" in.`,
        'This is the normal state of a fresh clone: repos/ is gitignored.',
        'Run `pnpm sync` to clone the repositories listed in repos.json.',
      )
      break
    case 'partial':
      lines.push(
        `workspace: running "${command}" in ${String(plan.targets.length)} repository/ies.`,
        `not cloned yet (${String(plan.missing.length)}): ${plan.missing.join(', ')}`,
      )
      break
    case 'complete':
      lines.push(
        `workspace: running "${command}" in all ${String(plan.targets.length)} repositories.`,
      )
      break
    // Structurally unreachable: every WorkspaceStatus is handled above, so
    // TypeScript only accepts this call because `plan.status` has narrowed to
    // `never`. See src/domain/exhaustive.ts.
    /* v8 ignore next 2 */
    default:
      assertUnreachable(plan.status)
  }

  if (plan.unmanaged.length > 0) {
    lines.push(
      `warning: repos/ contains ${String(plan.unmanaged.length)} director${plan.unmanaged.length === 1 ? 'y' : 'ies'} not in repos.json: ${plan.unmanaged.join(', ')}.`,
      'They are left completely alone. If one is a rename, add it to repos.json; if it is stale, remove it yourself.',
    )
  }

  if (plan.unpinned.length > 0) {
    lines.push(
      `note: ${String(plan.unpinned.length)} repository/ies are still unpinned in repos.json: ${plan.unpinned.join(', ')}.`,
      'Until they are pinned, the composite state of the project is not reproducible and a regression cannot be bisected.',
      'Run `pnpm update:manifest` to pin them to their current HEADs.',
    )
  }

  return lines
}

/**
 * The pnpm workspace glob this repository publishes in `pnpm-workspace.yaml`.
 *
 * Asserted by a test against the actual file, so the two cannot drift.
 */
export const WORKSPACE_PACKAGES_GLOB = 'repos/*'

/** The directory the managed repositories are cloned into. Gitignored. */
export const REPOS_DIRECTORY = 'repos'

/** The committed manifest filename. */
export const MANIFEST_FILENAME = 'repos.json'
