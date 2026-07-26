/**
 * The sync decision. PURE — no filesystem, no git, no network.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * The one rule
 * ---------------------------------------------------------------------------
 *
 *   THE SYNC SCRIPT MUST NEVER DESTROY LOCAL WORK.
 *
 * A tool that touches 15 working copies at once is a tool that can delete a
 * whole afternoon in one command. Every decision below is subordinate to that:
 * `git reset --hard`, `git clean` and switching branches over a dirty tree do
 * not appear in the action set AT ALL, so `scripts/sync-repos.ts` cannot
 * perform them — there is no action that means "discard".
 *
 * A dirty repository is SKIPPED, loudly, and the run continues. It is not an
 * error (having uncommitted work is normal), and it is not silent (the caller
 * needs to know that repository was not synced).
 *
 * ---------------------------------------------------------------------------
 * Why the decision is a pure function
 * ---------------------------------------------------------------------------
 *
 * Separating "what should happen" from "make it happen" is what makes the
 * dangerous part testable without a git repository. `test/sync-plan.test.ts`
 * enumerates every observable state and asserts the action, including the ones
 * that must never occur — and it does so with no network access and no
 * temporary directories. `applyAction` below models the effect of each action
 * on the working copy, which lets the same test prove IDEMPOTENCE directly:
 * plan, apply, plan again, and the second plan must be a no-op.
 */
import { isPinned, type ManifestEntry } from './manifest'

/**
 * What was observed about one working copy under `repos/`.
 *
 * Deliberately small. Everything the decision needs, and nothing that would
 * tempt it into inspecting more of the repository.
 */
export type WorkingCopyState =
  /** No directory at `repos/<name>`. */
  | { readonly _tag: 'Absent' }
  | {
      readonly _tag: 'Present'
      /** Full SHA of the current HEAD. */
      readonly head: string
      /** True if `git status --porcelain` produced ANY output. */
      readonly dirty: boolean
      /** True if the manifest's pinned ref already exists in the local object store. */
      readonly hasPinnedRef: boolean
      /**
       * True once THIS RUN has already contacted the remote for this repository
       * — by a `Fetch`, or by the `Clone` that created the working copy.
       *
       * Unlike the three fields above, this is not read off the disk: nothing in
       * a working copy records "somebody fetched me eleven seconds ago". It is
       * carried by the caller across the rounds of one run, which is exactly the
       * scope in which it is true.
       *
       * It exists because an UNPINNED entry has no other way to be finished.
       * A pinned entry converges by arriving at its ref; an unpinned entry has
       * no ref to arrive at, so without this flag `planSync` would answer
       * `Fetch` to the same question forever and the convergence loop would
       * fetch as many times as its round limit allowed. That is precisely the
       * bug this field was added to close: three network round-trips per
       * unpinned repository, on every single `pnpm sync`.
       */
      readonly fetchedThisRun: boolean
    }

export type SyncAction =
  /** Not there: clone it, then check out the pinned ref if there is one. */
  | { readonly _tag: 'Clone'; readonly name: string; readonly url: string; readonly ref: string }
  /** There, clean, but the pinned ref is not local yet: fetch, then re-plan. */
  | { readonly _tag: 'Fetch'; readonly name: string; readonly reason: 'ref-not-local' | 'unpinned' }
  /** There, clean, ref is local, HEAD is elsewhere: detached checkout. */
  | { readonly _tag: 'Checkout'; readonly name: string; readonly ref: string }
  /** There, clean, HEAD already equals the pinned ref. Do nothing. */
  | { readonly _tag: 'AlreadyAtRef'; readonly name: string; readonly ref: string }
  /**
   * Unpinned, clean, and already fetched in this run. Nothing left to do.
   *
   * The unpinned counterpart of `AlreadyAtRef`. An unpinned entry can never be
   * "at its ref" — there is no ref — so it needs its own way of saying "done",
   * or it never stops asking to be fetched.
   */
  | { readonly _tag: 'UpToDate'; readonly name: string }
  /** There, DIRTY. Do not touch it. Not an error. */
  | { readonly _tag: 'SkipDirty'; readonly name: string }

/**
 * Decide what to do with one repository.
 *
 * ORDER MATTERS. The dirty check comes before everything except "is it even
 * there", because every action other than `SkipDirty` writes to the working
 * copy in some way, and the whole point is that a dirty copy is never written
 * to.
 */
export const planSync = (entry: ManifestEntry, state: WorkingCopyState): SyncAction => {
  if (state._tag === 'Absent') {
    return { _tag: 'Clone', name: entry.name, url: entry.url, ref: entry.ref }
  }

  // ---- Nothing below this line may run against a dirty working copy. -------
  if (state.dirty) {
    return { _tag: 'SkipDirty', name: entry.name }
  }

  // An unpinned entry is fetched but NEVER checked out. Without this, an
  // unpinned manifest could move a working copy — and "unpinned" means nobody
  // has decided where it should be, so moving it would be a guess.
  //
  // ONCE, though. `fetchedThisRun` is what makes "fetch it" a step rather than
  // a standing condition; without it this branch answers `Fetch` to a state it
  // has already fetched, and the caller's convergence loop obliges.
  if (!isPinned(entry.ref)) {
    return state.fetchedThisRun
      ? { _tag: 'UpToDate', name: entry.name }
      : { _tag: 'Fetch', name: entry.name, reason: 'unpinned' }
  }

  if (state.head === entry.ref) {
    return { _tag: 'AlreadyAtRef', name: entry.name, ref: entry.ref }
  }

  if (!state.hasPinnedRef) {
    return { _tag: 'Fetch', name: entry.name, reason: 'ref-not-local' }
  }

  return { _tag: 'Checkout', name: entry.name, ref: entry.ref }
}

/** Plan every repository. Manifest order is preserved so output is stable. */
export const planAll = (
  entries: ReadonlyArray<ManifestEntry>,
  observe: (entry: ManifestEntry) => WorkingCopyState,
): ReadonlyArray<SyncAction> => entries.map((entry) => planSync(entry, observe(entry)))

/** True when the action changes nothing on disk and runs no command. */
export const isNoOp = (action: SyncAction): boolean =>
  action._tag === 'AlreadyAtRef' || action._tag === 'UpToDate' || action._tag === 'SkipDirty'

/**
 * True when the action contacts the remote, making its objects local.
 *
 * The caller uses this to set `fetchedThisRun` on the state it observes after
 * the action. It is here, next to `applyAction`, so the script and the model
 * cannot disagree about which actions count as "we have talked to the remote".
 */
export const fetchesFromRemote = (action: SyncAction): boolean =>
  action._tag === 'Clone' || action._tag === 'Fetch'

/**
 * A model of what each action does to a working copy.
 *
 * This is the CONTRACT `scripts/sync-repos.ts` implements. It is here, in the
 * pure layer, so that idempotence can be tested without git: plan, apply,
 * plan again, and assert the second plan is a no-op. If the script ever
 * diverges from this model, the script is wrong.
 *
 * `Fetch` deliberately does NOT move HEAD. It only makes objects local, which
 * is why a fetch caused by `ref-not-local` is followed by a re-plan that then
 * produces `Checkout`.
 */
export const applyAction = (
  entry: ManifestEntry,
  state: WorkingCopyState,
  action: SyncAction,
): WorkingCopyState => {
  switch (action._tag) {
    case 'Clone':
      // A fresh clone is clean, has the remote's objects, and sits at the
      // pinned ref when there is one. An unpinned clone sits at the remote's
      // default branch, modelled here as "some head we do not know" — the
      // sentinel below is never compared against a pinned ref.
      return {
        _tag: 'Present',
        head: isPinned(entry.ref) ? entry.ref : 'default-branch-head',
        dirty: false,
        hasPinnedRef: true,
        // A clone IS a fetch. An unpinned repository that was just cloned has
        // no reason to be fetched again in the same run, and saying otherwise
        // here would cost one wasted round-trip per absent repository.
        fetchedThisRun: true,
      }

    case 'Fetch':
      return state._tag === 'Present'
        ? { ...state, hasPinnedRef: true, fetchedThisRun: true }
        : state

    case 'Checkout':
      return state._tag === 'Present' ? { ...state, head: action.ref } : state

    case 'AlreadyAtRef':
    case 'UpToDate':
    case 'SkipDirty':
      return state
  }
}

/**
 * Plan, apply, and re-plan until nothing changes — or give up.
 *
 * A single repository needs at most two rounds of WORK — fetch, then checkout —
 * plus the round that observes there is nothing left to do, so `maxRounds`
 * defaults to 3. Exceeding it means the model has a loop, which is a bug rather
 * than a condition to handle. Returns the actions taken in order plus the
 * settled state.
 *
 * Every entry reaches a no-op, unpinned ones included: an unpinned entry
 * settles as `Fetch` then `UpToDate`, and `test/sync-plan.test.ts` asserts that
 * over every entry x every state. The round limit is a guard against a bug, not
 * the thing that stops the loop — if it is ever what stops the loop, something
 * here is wrong.
 */
export const settle = (
  entry: ManifestEntry,
  from: WorkingCopyState,
  maxRounds = 3,
): { readonly actions: ReadonlyArray<SyncAction>; readonly state: WorkingCopyState } => {
  const actions: Array<SyncAction> = []
  let state = from

  for (let round = 0; round < maxRounds; round += 1) {
    const action = planSync(entry, state)
    actions.push(action)
    if (isNoOp(action)) {
      break
    }
    state = applyAction(entry, state, action)
  }

  return { actions, state }
}

export type SyncSummary = {
  readonly cloned: ReadonlyArray<string>
  readonly fetched: ReadonlyArray<string>
  readonly checkedOut: ReadonlyArray<string>
  readonly unchanged: ReadonlyArray<string>
  readonly skippedDirty: ReadonlyArray<string>
}

export const summarise = (actions: ReadonlyArray<SyncAction>): SyncSummary => ({
  cloned: actions.filter((action) => action._tag === 'Clone').map((action) => action.name),
  fetched: actions.filter((action) => action._tag === 'Fetch').map((action) => action.name),
  checkedOut: actions.filter((action) => action._tag === 'Checkout').map((action) => action.name),
  unchanged: actions
    .filter((action) => action._tag === 'AlreadyAtRef' || action._tag === 'UpToDate')
    .map((action) => action.name),
  skippedDirty: actions.filter((action) => action._tag === 'SkipDirty').map((action) => action.name),
})

// ---------------------------------------------------------------------------
// The git commands, as data
// ---------------------------------------------------------------------------

/**
 * Git arguments that can destroy uncommitted work.
 *
 * `scripts/sync-repos.ts` refuses to execute any command containing one of
 * these, and `test/sync-plan.test.ts` asserts that no action reachable from any
 * observable state ever produces one. The rule is enforced twice on purpose:
 * once by never generating such a command, and once by refusing to run it.
 *
 * `--force` and `-f` are here because `git checkout --force` discards local
 * modifications just as thoroughly as `reset --hard`, and it is the flag
 * someone reaches for when a checkout fails.
 */
export const DESTRUCTIVE_GIT_ARGUMENTS: ReadonlyArray<string> = [
  'reset',
  'clean',
  'restore',
  '--hard',
  '--force',
  '-f',
  '-D',
  '--delete',
  'prune-and-delete',
]

export const isDestructiveGitCommand = (argv: ReadonlyArray<string>): boolean =>
  argv.some((argument) => DESTRUCTIVE_GIT_ARGUMENTS.includes(argument))

/**
 * The exact git invocations an action performs, as argv arrays without the
 * leading `git`.
 *
 * Returning them as DATA rather than running them is what makes the dangerous
 * part of this tool testable: `test/sync-plan.test.ts` enumerates every state,
 * collects every command that could ever be produced, and asserts none of them
 * can destroy work — with no git repository anywhere in sight.
 *
 * `checkout --detach` rather than `checkout <ref>`: a detached checkout of a
 * pinned SHA never moves or creates a local branch, so it cannot silently
 * change which branch someone was on.
 *
 * `fetch --prune --tags` never touches the working tree; it only makes objects
 * local. That is why a fetch is always followed by a re-plan.
 */
export const gitCommandsFor = (
  action: SyncAction,
  directory: string,
): ReadonlyArray<ReadonlyArray<string>> => {
  switch (action._tag) {
    case 'Clone':
      return isPinned(action.ref)
        ? [
            ['clone', action.url, directory],
            ['-C', directory, 'checkout', '--detach', action.ref],
          ]
        : [['clone', action.url, directory]]

    case 'Fetch':
      return [['-C', directory, 'fetch', '--prune', '--tags', 'origin']]

    case 'Checkout':
      return [['-C', directory, 'checkout', '--detach', action.ref]]

    case 'AlreadyAtRef':
    case 'UpToDate':
    case 'SkipDirty':
      return []
  }
}

export const describeAction = (action: SyncAction): string => {
  switch (action._tag) {
    case 'Clone':
      return `clone   ${action.name} <- ${action.url}${isPinned(action.ref) ? ` @ ${action.ref}` : ' (unpinned: default branch)'}`
    case 'Fetch':
      return action.reason === 'unpinned'
        ? `fetch   ${action.name} (unpinned in repos.json — fetching only, NOT moving HEAD)`
        : `fetch   ${action.name} (pinned ref not present locally)`
    case 'Checkout':
      return `checkout ${action.name} @ ${action.ref}`
    case 'AlreadyAtRef':
      return `ok      ${action.name} (already at ${action.ref})`
    case 'UpToDate':
      return `ok      ${action.name} (unpinned in repos.json — fetched, HEAD left where it was)`
    case 'SkipDirty':
      return `SKIP    ${action.name} — uncommitted changes. Nothing was touched. Commit or stash, then re-run.`
  }
}
