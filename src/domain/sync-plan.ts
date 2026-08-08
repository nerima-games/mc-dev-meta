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
 *
 * ---------------------------------------------------------------------------
 * The two modes, and why `latest` had to exist
 * ---------------------------------------------------------------------------
 *
 * `pinned` is the original and the default: put the working copy where
 * `repos.json` says. It is the mode that makes the composite state reproducible.
 *
 * It is also, on its own, a CLOSED LOOP. `pnpm sync` writes `repos/ <- pin` and
 * `pnpm update:manifest` writes `pin <- repos/ HEAD`, so neither command can
 * ever name a revision the other did not already know. A repository that moves
 * on GitHub is invisible to both: `planSync` answers `AlreadyAtRef` before it
 * reaches any branch that contacts the remote, so `pnpm sync` does not even
 * open a connection, and `pnpm update:manifest` then reports "already up to
 * date" — two commands, both reporting success, both having done nothing, while
 * the pin sat behind the remote. That is the worst failure mode a pinning tool
 * has, and it is what `latest` exists to break.
 *
 * `latest` asks the remote and advances to its tip. It is a MODE rather than a
 * separate command because every safety property below has to hold in it
 * unchanged, and the cheapest way to guarantee that is for both modes to flow
 * through the same planner, the same action set, and the same exhaustive test
 * sweeps.
 *
 * Two rules make advancing to a remote tip safe:
 *
 *   1. A DIRTY working copy is skipped, exactly as in `pinned` mode.
 *   2. Advancing is FAST-FORWARD ONLY. If HEAD is not reachable from the tip,
 *      the repository is skipped as `SkipDiverged`. `pnpm sync` leaves working
 *      copies detached, so a commit made in one is reachable from nothing but
 *      HEAD itself — moving HEAD off it would strand it in the reflog, which is
 *      losing work by any honest definition. The alternative, "check out the
 *      tip and let the reflog sort it out", is precisely the behaviour this
 *      module exists to make impossible.
 *
 * Rule 2 is deliberately conservative: it also refuses a pin that sits on a
 * side branch rather than on the tip's ancestry, where nothing local would in
 * fact be lost. The tool cannot tell those two apart from the outside — both
 * are "HEAD is not reachable from the tip" — and of the two available mistakes,
 * refusing to move is the one that can be undone.
 */
import { assertUnreachable } from './exhaustive'
import { isPinned, type ManifestEntry } from './manifest'

/**
 * Where the revision a working copy is moved to COMES FROM.
 *
 * `pinned` — from `repos.json`. Reproducible; the default.
 * `latest` — from `origin`'s default-branch tip, after a fetch. The only mode
 *            in which this tool can name a revision nobody has recorded yet,
 *            which is the whole reason it exists.
 */
export type SyncMode = 'pinned' | 'latest'

/**
 * What THIS RUN learned about `origin` for one repository.
 *
 * `undefined` on a `WorkingCopyState` means "this run has not asked", NOT "the
 * remote has nothing". The distinction is load-bearing: `refs/remotes/origin/HEAD`
 * resolves perfectly well in a stale clone, so a planner that read it without
 * checking whether this run had fetched would advance confidently to whatever
 * the remote looked like the last time anybody fetched — the same deadlock with
 * extra steps. `scripts/sync-repos.ts` therefore fills this in ONLY after a
 * fetch or a clone in this run.
 */
export type RemoteObservation = {
  /** Full SHA of `origin`'s default-branch tip. */
  readonly tip: string
  /**
   * True when HEAD is reachable from `tip` — i.e. moving to `tip` is a
   * fast-forward and abandons no commit.
   *
   * Read off `git merge-base --is-ancestor`, and FAILING CLOSED: a command that
   * could not be run at all is reported as `false`, because the only safe
   * answer to "might there be work here" is yes.
   */
  readonly headIsAncestorOfTip: boolean
}

/**
 * Where a `Checkout`'s ref came from, for the log and for `applyAction`.
 *
 * Two checkouts of the same SHA are not the same decision — one was recorded by
 * a human in `repos.json`, the other was read off a remote thirty milliseconds
 * ago — and the log has to say which, or `pnpm sync --latest` looks exactly
 * like `pnpm sync` in a transcript.
 */
export type RefSource = 'manifest' | 'remote'

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
      /**
       * What this run learned about `origin`, or `undefined` if it has not
       * asked. Only `latest` mode ever consults it; `pinned` mode has a ref
       * already and has no business opening a connection to confirm it.
       */
      readonly remote: RemoteObservation | undefined
    }

export type SyncAction =
  /** Not there: clone it, then check out the pinned ref if there is one. */
  | { readonly _tag: 'Clone'; readonly name: string; readonly url: string; readonly ref: string }
  /**
   * There, clean, and something has to be asked of the remote: fetch, re-plan.
   *
   * `latest` is the reason the manifest's ref is not consulted here at all: in
   * that mode the target is not known until the remote has been asked, so the
   * fetch is unconditional rather than a consequence of a missing object.
   */
  | {
      readonly _tag: 'Fetch'
      readonly name: string
      readonly reason: 'ref-not-local' | 'unpinned' | 'latest'
    }
  /** There, clean, ref is local, HEAD is elsewhere: detached checkout. */
  | {
      readonly _tag: 'Checkout'
      readonly name: string
      readonly ref: string
      readonly source: RefSource
    }
  /** There, clean, HEAD already equals the target ref. Do nothing. */
  | {
      readonly _tag: 'AlreadyAtRef'
      readonly name: string
      readonly ref: string
      readonly source: RefSource
    }
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
   * `latest` only. There, clean, but HEAD is NOT reachable from the remote tip.
   *
   * The counterpart of `SkipDirty` for committed work. A dirty tree announces
   * itself in `git status`; a commit made on a detached HEAD does not, and
   * checking out the tip over it is the one way this tool could still lose
   * something. Skipped, named, and not an error — having got ahead of the
   * remote is a normal thing to have done.
   */
  | {
      readonly _tag: 'SkipDiverged'
      readonly name: string
      readonly head: string
      readonly tip: string
    }

/**
 * Decide what to do with one repository.
 *
 * ORDER MATTERS. The dirty check comes before everything except "is it even
 * there", because every action other than a skip writes to the working copy in
 * some way, and the whole point is that a dirty copy is never written to. The
 * mode split comes AFTER it, so that `latest` inherits the rule rather than
 * restating it — a second copy of that check is a second place for it to be
 * got wrong.
 */
export const planSync = (
  entry: ManifestEntry,
  state: WorkingCopyState,
  mode: SyncMode = 'pinned',
): SyncAction => {
  if (state._tag === 'Absent') {
    return { _tag: 'Clone', name: entry.name, url: entry.url, ref: entry.ref }
  }

  // ---- Nothing below this line may run against a dirty working copy. -------
  if (state.dirty) {
    return { _tag: 'SkipDirty', name: entry.name }
  }

  if (mode === 'latest') {
    // The manifest's ref is not consulted at all here, pinned or not. `latest`
    // means "wherever origin is now", and an entry's pin is by definition the
    // answer to a question that was asked earlier.
    //
    // This is also the one place an UNPINNED entry can be moved. In `pinned`
    // mode that is forbidden, because "unpinned" means nobody decided where it
    // should be and moving it would be a guess. Here it is not a guess: the
    // caller typed `--latest`, which is the decision.
    if (state.remote === undefined) {
      return { _tag: 'Fetch', name: entry.name, reason: 'latest' }
    }
    if (!state.remote.headIsAncestorOfTip) {
      return { _tag: 'SkipDiverged', name: entry.name, head: state.head, tip: state.remote.tip }
    }
    return state.head === state.remote.tip
      ? { _tag: 'AlreadyAtRef', name: entry.name, ref: state.remote.tip, source: 'remote' }
      : { _tag: 'Checkout', name: entry.name, ref: state.remote.tip, source: 'remote' }
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
    return { _tag: 'AlreadyAtRef', name: entry.name, ref: entry.ref, source: 'manifest' }
  }

  if (!state.hasPinnedRef) {
    return { _tag: 'Fetch', name: entry.name, reason: 'ref-not-local' }
  }

  return { _tag: 'Checkout', name: entry.name, ref: entry.ref, source: 'manifest' }
}

/** Plan every repository. Manifest order is preserved so output is stable. */
export const planAll = (
  entries: ReadonlyArray<ManifestEntry>,
  observe: (entry: ManifestEntry) => WorkingCopyState,
  mode: SyncMode = 'pinned',
): ReadonlyArray<SyncAction> => entries.map((entry) => planSync(entry, observe(entry), mode))

/** True when the action changes nothing on disk and runs no command. */
export const isNoOp = (action: SyncAction): boolean =>
  action._tag === 'AlreadyAtRef' ||
  action._tag === 'UpToDate' ||
  action._tag === 'SkipDirty' ||
  action._tag === 'SkipDiverged'

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
  /**
   * What a fetch in this run would learn about `origin` — the model's stand-in
   * for the network, supplied by the caller for the same reason the real fetch
   * needs a connection: it cannot be derived from anything already on disk.
   *
   * `undefined` (the default) models a remote that could not be read, which
   * `planSync` then treats as "not asked yet". Only `latest` mode reaches it.
   */
  remote: RemoteObservation | undefined = undefined,
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
        // A clone also brings `refs/remotes/origin/HEAD` with it, so the remote
        // is known without a second round-trip. `latest` mode then converges in
        // one further checkout rather than one further fetch.
        remote,
      }

    case 'Fetch':
      return state._tag === 'Present'
        ? { ...state, hasPinnedRef: true, fetchedThisRun: true, remote }
        : state

    case 'Checkout':
      return state._tag === 'Present'
        ? {
            ...state,
            head: action.ref,
            // The only ref `latest` mode ever checks out is the tip itself, so
            // after the move the fast-forward question is settled `true`. A
            // `manifest` checkout leaves the observation alone: nothing in
            // `pinned` mode reads it, and inventing an answer for it here would
            // be modelling a question the tool never asks.
            remote:
              state.remote === undefined || action.source === 'manifest'
                ? state.remote
                : { ...state.remote, headIsAncestorOfTip: true },
          }
        : state

    case 'AlreadyAtRef':
    case 'UpToDate':
    case 'SkipDirty':
    case 'SkipDiverged':
      return state
    // Structurally unreachable: every SyncAction tag is handled above, so
    // TypeScript only accepts this call because `action` has narrowed to
    // `never`. See src/domain/exhaustive.ts.
    /* v8 ignore next 2 */
    default:
      return assertUnreachable(action)
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
  mode: SyncMode = 'pinned',
  /** What a fetch would reveal. See `applyAction`. */
  remote: RemoteObservation | undefined = undefined,
): { readonly actions: ReadonlyArray<SyncAction>; readonly state: WorkingCopyState } => {
  const actions: Array<SyncAction> = []
  let state = from

  for (let round = 0; round < maxRounds; round += 1) {
    const action = planSync(entry, state, mode)
    actions.push(action)
    if (isNoOp(action)) {
      break
    }
    state = applyAction(entry, state, action, remote)
  }

  return { actions, state }
}

export type SyncSummary = {
  readonly cloned: ReadonlyArray<string>
  readonly fetched: ReadonlyArray<string>
  readonly checkedOut: ReadonlyArray<string>
  readonly unchanged: ReadonlyArray<string>
  readonly skippedDirty: ReadonlyArray<string>
  /**
   * `latest` only: clean, but ahead of or off the remote's ancestry.
   *
   * Counted separately from `skippedDirty` because the remedy is different —
   * a dirty tree wants `git commit` or `git stash`, a diverged one wants
   * `git push` or a deliberate decision to abandon the commit — and a summary
   * that lumped them together would send people to the wrong one.
   */
  readonly skippedDiverged: ReadonlyArray<string>
}

export const summarise = (actions: ReadonlyArray<SyncAction>): SyncSummary => ({
  cloned: actions.filter((action) => action._tag === 'Clone').map((action) => action.name),
  fetched: actions.filter((action) => action._tag === 'Fetch').map((action) => action.name),
  checkedOut: actions.filter((action) => action._tag === 'Checkout').map((action) => action.name),
  unchanged: actions
    .filter((action) => action._tag === 'AlreadyAtRef' || action._tag === 'UpToDate')
    .map((action) => action.name),
  skippedDirty: actions.filter((action) => action._tag === 'SkipDirty').map((action) => action.name),
  skippedDiverged: actions
    .filter((action) => action._tag === 'SkipDiverged')
    .map((action) => action.name),
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

    // Identical for both ref sources on purpose. `--latest` must not be able to
    // reach a command shape that `pnpm sync` cannot, or the exhaustive sweep in
    // `test/sync-plan.test.ts` would be proving safety for the wrong mode.
    case 'Checkout':
      return [['-C', directory, 'checkout', '--detach', action.ref]]

    case 'AlreadyAtRef':
    case 'UpToDate':
    case 'SkipDirty':
    case 'SkipDiverged':
      return []
    // Structurally unreachable: every SyncAction tag is handled above, so
    // TypeScript only accepts this call because `action` has narrowed to
    // `never`. See src/domain/exhaustive.ts.
    /* v8 ignore next 2 */
    default:
      return assertUnreachable(action)
  }
}

type FetchReason = Extract<SyncAction, { readonly _tag: 'Fetch' }>['reason']

const describeFetchReason = (reason: FetchReason): string => {
  switch (reason) {
    case 'unpinned':
      return 'unpinned in repos.json — fetching only, NOT moving HEAD'
    case 'ref-not-local':
      return 'pinned ref not present locally'
    case 'latest':
      return '--latest: asking origin where its default branch is now'
    // Structurally unreachable: every FetchReason is handled above, so
    // TypeScript only accepts this call because `reason` has narrowed to
    // `never`. See src/domain/exhaustive.ts.
    /* v8 ignore next 2 */
    default:
      return assertUnreachable(reason)
  }
}

export const describeAction = (action: SyncAction): string => {
  switch (action._tag) {
    case 'Clone':
      return `clone   ${action.name} <- ${action.url}${isPinned(action.ref) ? ` @ ${action.ref}` : ' (unpinned: default branch)'}`
    case 'Fetch':
      return `fetch   ${action.name} (${describeFetchReason(action.reason)})`
    case 'Checkout':
      return action.source === 'remote'
        ? `advance ${action.name} @ ${action.ref} (origin's tip — repos.json still says otherwise; run \`pnpm update:manifest\`)`
        : `checkout ${action.name} @ ${action.ref}`
    case 'AlreadyAtRef':
      return action.source === 'remote'
        ? `ok      ${action.name} (already at origin's tip ${action.ref})`
        : `ok      ${action.name} (already at ${action.ref})`
    case 'UpToDate':
      return `ok      ${action.name} (unpinned in repos.json — fetched, HEAD left where it was)`
    case 'SkipDirty':
      return `SKIP    ${action.name} — uncommitted changes. Nothing was touched. Commit or stash, then re-run.`
    case 'SkipDiverged':
      return (
        `SKIP    ${action.name} — HEAD ${action.head.slice(0, 12)} is not reachable from origin's tip ` +
        `${action.tip.slice(0, 12)}. Nothing was touched. Advancing would strand whatever is only ` +
        'here; push it, or check out the tip yourself if you meant to abandon it.'
      )
    // Structurally unreachable: every SyncAction tag is handled above, so
    // TypeScript only accepts this call because `action` has narrowed to
    // `never`. See src/domain/exhaustive.ts.
    /* v8 ignore next 2 */
    default:
      return assertUnreachable(action)
  }
}
