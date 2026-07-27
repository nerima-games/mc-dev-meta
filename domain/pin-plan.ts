/**
 * The pin decision: what `pnpm update:manifest` writes into `repos.json`, and
 * what it refuses to write. PURE — no filesystem, no git, no network.
 *
 * ---------------------------------------------------------------------------
 * Why this is a module rather than a switch inside the script
 * ---------------------------------------------------------------------------
 *
 * It used to be a switch inside `scripts/update-manifest.ts`, over a three-case
 * observation, and it was never tested — the pure/effectful split that
 * `domain/sync-plan.ts` makes for the sync side had no counterpart on the pin
 * side. That mattered less when the only possible target was "the HEAD sitting
 * in front of me". It stopped being true the moment `--latest` gave the pin a
 * target that has to be fetched, checked for divergence, and then possibly
 * refused: those are decisions, and decisions that can lose work belong where
 * they can be enumerated without a git repository.
 *
 * ---------------------------------------------------------------------------
 * The rule this shares with the sync side
 * ---------------------------------------------------------------------------
 *
 * Writing a pin touches no working copy, so pinning is not itself destructive.
 * It is destructive ONE COMMAND LATER: whatever `repos.json` names is where the
 * next `pnpm sync` will move `repos/<name>`, and sync leaves working copies
 * detached. So pinning a revision that HEAD cannot fast-forward to is a way of
 * arranging for a later command to strand a local commit — a booby trap rather
 * than an accident, which is worse.
 *
 * `--latest` therefore refuses exactly what `pnpm sync --latest` refuses: a
 * DIRTY repository, and one whose HEAD is not reachable from the remote tip.
 * The predicate is the same `RemoteObservation.headIsAncestorOfTip`, computed
 * once in the script and consumed by both planners, so the two commands cannot
 * drift into disagreeing about which repositories are safe to move.
 */
import type { ManifestEntry } from './manifest'
import type { RemoteObservation, SyncMode } from './sync-plan'

/**
 * What was observed about one repository under `repos/`, for pinning purposes.
 *
 * Narrower than `WorkingCopyState`: pinning does not care whether the manifest's
 * ref happens to be in the local object store, because it is not going to check
 * anything out.
 */
export type PinObservation =
  /** No clone at `repos/<name>`. */
  | { readonly _tag: 'Absent' }
  /**
   * Present with uncommitted changes — or with a `git status` that could not be
   * read at all, which is reported as dirty for the same fail-closed reason
   * `scripts/sync-repos.ts` gives.
   */
  | { readonly _tag: 'Dirty' }
  | {
      readonly _tag: 'Clean'
      /** Full SHA of the working copy's HEAD. */
      readonly head: string
      /** What this run learned about `origin`, or `undefined` if it did not ask. */
      readonly remote: RemoteObservation | undefined
    }

export type PinDecision =
  /** Not cloned. Absence is not an opinion; the existing entry stands. */
  | { readonly _tag: 'LeaveAbsent'; readonly name: string; readonly ref: string }
  /** Uncommitted changes. HEAD does not describe the tree, so it is not a pin. */
  | { readonly _tag: 'LeaveDirty'; readonly name: string }
  /**
   * `--latest` only: the remote could not be read, so there is no target.
   *
   * Reported rather than silently falling back to the working copy's HEAD.
   * Falling back would make `--latest` quietly behave as the plain command,
   * which is the exact class of "did nothing, said nothing" this whole change
   * exists to remove.
   */
  | { readonly _tag: 'LeaveRemoteUnknown'; readonly name: string }
  /** `--latest` only: HEAD is not reachable from the tip. See the header. */
  | {
      readonly _tag: 'LeaveDiverged'
      readonly name: string
      readonly head: string
      readonly tip: string
    }
  /** The target is already what `repos.json` says. */
  | { readonly _tag: 'AlreadyPinned'; readonly name: string; readonly ref: string }
  /** Write this ref. `source` is only for the log, and it is worth the field. */
  | {
      readonly _tag: 'Pin'
      readonly name: string
      readonly ref: string
      readonly source: 'working-copy' | 'remote'
    }

/**
 * Decide what to pin one entry to.
 *
 * ORDER MATTERS, and it is the same order as `planSync`: absence first, then
 * dirtiness, then the mode split. Both refusals come before either mode can
 * name a target, so neither mode can forget one.
 */
export const planPin = (
  entry: ManifestEntry,
  observation: PinObservation,
  mode: SyncMode = 'pinned',
): PinDecision => {
  if (observation._tag === 'Absent') {
    return { _tag: 'LeaveAbsent', name: entry.name, ref: entry.ref }
  }

  if (observation._tag === 'Dirty') {
    return { _tag: 'LeaveDirty', name: entry.name }
  }

  if (mode === 'latest') {
    if (observation.remote === undefined) {
      return { _tag: 'LeaveRemoteUnknown', name: entry.name }
    }
    if (!observation.remote.headIsAncestorOfTip) {
      return {
        _tag: 'LeaveDiverged',
        name: entry.name,
        head: observation.head,
        tip: observation.remote.tip,
      }
    }
    return observation.remote.tip === entry.ref
      ? { _tag: 'AlreadyPinned', name: entry.name, ref: entry.ref }
      : { _tag: 'Pin', name: entry.name, ref: observation.remote.tip, source: 'remote' }
  }

  return observation.head === entry.ref
    ? { _tag: 'AlreadyPinned', name: entry.name, ref: entry.ref }
    : { _tag: 'Pin', name: entry.name, ref: observation.head, source: 'working-copy' }
}

/** The ref a decision writes, or `undefined` when it writes nothing. */
export const refToWrite = (decision: PinDecision): string | undefined =>
  decision._tag === 'Pin' ? decision.ref : undefined

export const describePinDecision = (decision: PinDecision): string => {
  switch (decision._tag) {
    case 'LeaveAbsent':
      return `  skip     ${decision.name} — not cloned; leaving ref "${decision.ref}" as it is.`
    case 'LeaveDirty':
      return (
        `  SKIP     ${decision.name} — uncommitted changes. HEAD does not describe the working tree, ` +
        'so pinning it would record a state nobody can reproduce.'
      )
    case 'LeaveRemoteUnknown':
      return (
        `  SKIP     ${decision.name} — --latest could not read origin's tip (no network, no ` +
        'origin/HEAD, or the fetch failed). Nothing was pinned for it; the ref is unchanged.'
      )
    case 'LeaveDiverged':
      return (
        `  SKIP     ${decision.name} — HEAD ${decision.head.slice(0, 12)} is not reachable from ` +
        `origin's tip ${decision.tip.slice(0, 12)}. Pinning the tip would tell the next \`pnpm sync\` ` +
        'to check out over a commit that exists nowhere else. Push it first.'
      )
    case 'AlreadyPinned':
      return `  ok       ${decision.name} — already pinned at ${decision.ref}.`
    case 'Pin':
      return decision.source === 'remote'
        ? `  pin      ${decision.name} @ ${decision.ref} (origin's tip; run \`pnpm sync\` to move repos/ onto it)`
        : `  pin      ${decision.name} @ ${decision.ref}`
  }
}

export type PinSummary = {
  readonly pinned: ReadonlyArray<string>
  readonly alreadyPinned: ReadonlyArray<string>
  readonly skippedAbsent: ReadonlyArray<string>
  readonly skippedDirty: ReadonlyArray<string>
  readonly skippedDiverged: ReadonlyArray<string>
  readonly skippedRemoteUnknown: ReadonlyArray<string>
}

export const summarisePins = (decisions: ReadonlyArray<PinDecision>): PinSummary => ({
  pinned: decisions.filter((one) => one._tag === 'Pin').map((one) => one.name),
  alreadyPinned: decisions.filter((one) => one._tag === 'AlreadyPinned').map((one) => one.name),
  skippedAbsent: decisions.filter((one) => one._tag === 'LeaveAbsent').map((one) => one.name),
  skippedDirty: decisions.filter((one) => one._tag === 'LeaveDirty').map((one) => one.name),
  skippedDiverged: decisions.filter((one) => one._tag === 'LeaveDiverged').map((one) => one.name),
  skippedRemoteUnknown: decisions
    .filter((one) => one._tag === 'LeaveRemoteUnknown')
    .map((one) => one.name),
})
