import { describe, expect, it } from 'vitest'
import { UNPINNED, type ManifestEntry } from '../src/domain/manifest'
import {
  applyAction,
  DESTRUCTIVE_GIT_ARGUMENTS,
  describeAction,
  fetchesFromRemote,
  gitCommandsFor,
  isDestructiveGitCommand,
  isNoOp,
  planAll,
  planSync,
  settle,
  summarise,
  type RemoteObservation,
  type SyncAction,
  type SyncMode,
  type WorkingCopyState,
} from '../src/domain/sync-plan'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_TIP = 'c'.repeat(40)

const pinned: ManifestEntry = {
  name: 'mc-kernel',
  url: 'https://github.com/nerima-games/mc-kernel.git',
  ref: SHA_A,
}

const unpinned: ManifestEntry = { ...pinned, ref: UNPINNED }

const absent: WorkingCopyState = { _tag: 'Absent' }

type PresentState = Extract<WorkingCopyState, { _tag: 'Present' }>

const present = (overrides: Partial<PresentState> = {}): PresentState => ({
  _tag: 'Present',
  head: SHA_A,
  dirty: false,
  hasPinnedRef: true,
  fetchedThisRun: false,
  remote: undefined,
  ...overrides,
})

const remote = (overrides: Partial<RemoteObservation> = {}): RemoteObservation => ({
  tip: SHA_TIP,
  headIsAncestorOfTip: true,
  ...overrides,
})

const BOTH_MODES: ReadonlyArray<SyncMode> = ['pinned', 'latest']

/** Every state that can be read off a working copy. */
const EVERY_OBSERVED_STATE: ReadonlyArray<PresentState> = [
  present({ head: SHA_A, dirty: false, hasPinnedRef: true }),
  present({ head: SHA_A, dirty: false, hasPinnedRef: false }),
  present({ head: SHA_A, dirty: true, hasPinnedRef: true }),
  present({ head: SHA_A, dirty: true, hasPinnedRef: false }),
  present({ head: SHA_B, dirty: false, hasPinnedRef: true }),
  present({ head: SHA_B, dirty: false, hasPinnedRef: false }),
  present({ head: SHA_B, dirty: true, hasPinnedRef: true }),
  present({ head: SHA_B, dirty: true, hasPinnedRef: false }),
  present({ head: '', dirty: true, hasPinnedRef: false }),
]

/**
 * Every remote observation a run can be holding, "has not asked" included.
 *
 * The tips are chosen to cover the three that matter: one nobody's HEAD equals,
 * and the two SHAs the fixtures use as HEAD, so that "already at the tip" is
 * reachable rather than merely describable.
 */
const EVERY_REMOTE: ReadonlyArray<RemoteObservation | undefined> = [
  undefined,
  remote({ headIsAncestorOfTip: true }),
  remote({ headIsAncestorOfTip: false }),
  remote({ tip: SHA_A, headIsAncestorOfTip: true }),
  remote({ tip: SHA_A, headIsAncestorOfTip: false }),
  remote({ tip: SHA_B, headIsAncestorOfTip: true }),
]

/**
 * Every observable state, for the exhaustive safety sweeps below.
 *
 * `fetchedThisRun` is not read off the disk, so it doubles every observed state
 * rather than replacing any: each one can be reached both before and after this
 * run has contacted the remote, and the sweeps have to cover both.
 *
 * `remote` multiplies it again for the same reason — it is carried by the run,
 * not read off the working copy — and the sweeps have to cover `latest` mode as
 * thoroughly as they cover `pinned`. Cheap: this is a few hundred pure calls
 * and still no git, no network and no temporary directory.
 */
const EVERY_STATE: ReadonlyArray<WorkingCopyState> = [
  absent,
  ...EVERY_OBSERVED_STATE.flatMap((state) =>
    [state, { ...state, fetchedThisRun: true }].flatMap((withFetch) =>
      EVERY_REMOTE.map((observation) => ({ ...withFetch, remote: observation })),
    ),
  ),
]

const EVERY_ENTRY: ReadonlyArray<ManifestEntry> = [pinned, unpinned]

describe('clone when absent, fetch when present', () => {
  it('clones a repository that is not there', () => {
    const action = planSync(pinned, absent)
    expect(action._tag).toBe('Clone')
    expect(action._tag === 'Clone' ? action.url : undefined).toBe(pinned.url)
  })

  it('does nothing when the working copy is already at the pinned ref', () => {
    expect(planSync(pinned, present({ head: SHA_A })).toString).toBeDefined()
    expect(planSync(pinned, present({ head: SHA_A }))._tag).toBe('AlreadyAtRef')
  })

  it('fetches when the pinned ref is not in the local object store yet', () => {
    const action = planSync(pinned, present({ head: SHA_B, hasPinnedRef: false }))
    expect(action._tag).toBe('Fetch')
    expect(action._tag === 'Fetch' ? action.reason : undefined).toBe('ref-not-local')
  })

  it('checks out when the ref is local and HEAD is somewhere else', () => {
    const action = planSync(pinned, present({ head: SHA_B, hasPinnedRef: true }))
    expect(action._tag).toBe('Checkout')
    expect(action._tag === 'Checkout' ? action.ref : undefined).toBe(SHA_A)
  })
})

describe('a dirty working copy is never touched', () => {
  // REGRESSION — the rule this whole module is subordinate to. A tool that
  // touches 15 working copies at once can delete an afternoon in one command.
  // Swept over BOTH MODES: `--latest` was added after this rule and inherits it
  // rather than restating it, and this is what holds that true.
  it('skips a dirty repository whatever else is true of it, in either mode', () => {
    for (const state of EVERY_STATE) {
      if (state._tag !== 'Present' || !state.dirty) {
        continue
      }
      for (const entry of EVERY_ENTRY) {
        for (const mode of BOTH_MODES) {
          expect(planSync(entry, state, mode)._tag, mode).toBe('SkipDirty')
        }
      }
    }
  })

  it('checks dirtiness before deciding anything else', () => {
    // Same repository, same manifest ref, differing only in dirtiness.
    expect(planSync(pinned, present({ head: SHA_B, dirty: false }))._tag).toBe('Checkout')
    expect(planSync(pinned, present({ head: SHA_B, dirty: true }))._tag).toBe('SkipDirty')
  })

  it('checks dirtiness before asking the remote anything, under --latest', () => {
    // A dirty copy must not even provoke a fetch: the answer cannot be used.
    const dirty = present({ head: SHA_B, dirty: true, remote: undefined })
    expect(planSync(pinned, dirty, 'latest')._tag).toBe('SkipDirty')
    expect(gitCommandsFor(planSync(pinned, dirty, 'latest'), 'repos/mc-kernel')).toStrictEqual([])
  })

  it('produces no git command at all for a skipped repository', () => {
    const action = planSync(pinned, present({ dirty: true }))
    expect(gitCommandsFor(action, 'repos/mc-kernel')).toStrictEqual([])
  })

  it('says clearly that nothing was touched', () => {
    const message = describeAction({ _tag: 'SkipDirty', name: 'mc-kernel' })
    expect(message).toContain('Nothing was touched')
    expect(message).toContain('Commit or stash')
  })
})

describe('an unpinned entry is fetched but never checked out', () => {
  // REGRESSION: "unpinned" means nobody has decided where this repository
  // should be. Moving it would be a guess, and the guess would silently
  // discard whichever commit the developer had checked out on purpose.
  it('fetches an unpinned repository without moving HEAD', () => {
    const action = planSync(unpinned, present({ head: SHA_B }))
    expect(action._tag).toBe('Fetch')
    expect(action._tag === 'Fetch' ? action.reason : undefined).toBe('unpinned')
  })

  // Scoped to `pinned` mode, which is the mode the rule was written for and
  // still holds in exactly as before. `--latest` deliberately does move an
  // unpinned entry — see 'advancing to origin's tip' below — because there the
  // destination was typed by the caller rather than guessed by the tool.
  it('never emits a Checkout for an unpinned entry, from any state', () => {
    for (const state of EVERY_STATE) {
      expect(planSync(unpinned, state)._tag).not.toBe('Checkout')
      expect(planSync(unpinned, state, 'pinned')._tag).not.toBe('Checkout')
    }
  })

  it('clones an unpinned repository without a follow-up checkout', () => {
    const action = planSync(unpinned, absent)
    expect(action._tag).toBe('Clone')
    expect(gitCommandsFor(action, 'repos/mc-kernel')).toStrictEqual([
      ['clone', unpinned.url, 'repos/mc-kernel'],
    ])
  })

  it('says in the log that HEAD is deliberately not being moved', () => {
    expect(describeAction({ _tag: 'Fetch', name: 'mc-kernel', reason: 'unpinned' })).toContain(
      'NOT moving HEAD',
    )
  })

  it('describes the other two fetch reasons distinctly', () => {
    expect(describeAction({ _tag: 'Fetch', name: 'mc-kernel', reason: 'ref-not-local' })).toContain(
      'pinned ref not present locally',
    )
    expect(describeAction({ _tag: 'Fetch', name: 'mc-kernel', reason: 'latest' })).toContain(
      "--latest: asking origin where its default branch is now",
    )
  })

  // REGRESSION: this branch used to answer `Fetch` from EVERY clean state,
  // including one it had just fetched, so the caller's convergence loop ran the
  // fetch again on every round. With an earlier manifest where all 15 entries
  // were unpinned, a 3-round loop made 45 network round-trips per `pnpm sync`.
  it('asks for a fetch once per run and then says there is nothing to do', () => {
    expect(planSync(unpinned, present({ head: SHA_B, fetchedThisRun: false }))._tag).toBe('Fetch')
    expect(planSync(unpinned, present({ head: SHA_B, fetchedThisRun: true }))._tag).toBe('UpToDate')
  })

  it('treats the clone that created the working copy as the fetch', () => {
    const cloned = applyAction(unpinned, absent, planSync(unpinned, absent))
    expect(planSync(unpinned, cloned)._tag).toBe('UpToDate')
  })

  it('runs no git command once it is up to date, and still never moves HEAD', () => {
    const action = planSync(unpinned, present({ head: SHA_B, fetchedThisRun: true }))
    expect(gitCommandsFor(action, 'repos/mc-kernel')).toStrictEqual([])
    expect(isNoOp(action)).toBe(true)
  })

  it('counts an up-to-date unpinned entry as unchanged rather than fetched', () => {
    const summary = summarise([{ _tag: 'UpToDate', name: 'mc-kernel' }])
    expect(summary.unchanged).toStrictEqual(['mc-kernel'])
    expect(summary.fetched).toStrictEqual([])
  })
})

// REGRESSION: `describeAction` is what `pnpm sync` prints for every action it
// takes, one line per repository. A case with no message test is a line of
// real CLI output nobody has ever actually checked.
describe('describeAction names every action distinctly', () => {
  it('names the pin it will check out immediately after cloning, for a pinned entry', () => {
    expect(describeAction({ _tag: 'Clone', name: 'mc-kernel', url: pinned.url, ref: SHA_A })).toBe(
      `clone   mc-kernel <- ${pinned.url} @ ${SHA_A}`,
    )
  })

  it('says it will land on the default branch, for an unpinned entry', () => {
    expect(describeAction({ _tag: 'Clone', name: 'mc-kernel', url: unpinned.url, ref: UNPINNED })).toBe(
      `clone   mc-kernel <- ${unpinned.url} (unpinned: default branch)`,
    )
  })

  it('says which entry it advanced to and why, when the target came from the manifest', () => {
    expect(
      describeAction({ _tag: 'Checkout', name: 'mc-kernel', ref: SHA_A, source: 'manifest' }),
    ).toBe(`checkout mc-kernel @ ${SHA_A}`)
  })

  it("says it is advancing to origin's tip, and that repos.json has not caught up, when the target came from --latest", () => {
    const message = describeAction({ _tag: 'Checkout', name: 'mc-kernel', ref: SHA_TIP, source: 'remote' })
    expect(message).toContain('advance')
    expect(message).toContain("origin's tip")
    expect(message).toContain('pnpm update:manifest')
  })

  it('says an entry is already at its pin, when the target came from the manifest', () => {
    expect(describeAction({ _tag: 'AlreadyAtRef', name: 'mc-kernel', ref: SHA_A, source: 'manifest' })).toBe(
      `ok      mc-kernel (already at ${SHA_A})`,
    )
  })

  it("says an entry is already at origin's tip, when the target came from --latest", () => {
    expect(describeAction({ _tag: 'AlreadyAtRef', name: 'mc-kernel', ref: SHA_TIP, source: 'remote' })).toBe(
      `ok      mc-kernel (already at origin's tip ${SHA_TIP})`,
    )
  })

  it('says an unpinned entry was fetched without moving HEAD', () => {
    expect(describeAction({ _tag: 'UpToDate', name: 'mc-kernel' })).toContain('HEAD left where it was')
  })
})

describe("advancing to origin's tip (--latest)", () => {
  // REGRESSION — THE DEADLOCK. `pnpm sync` wrote `repos/ <- pin` and
  // `pnpm update:manifest` wrote `pin <- repos/ HEAD`, so neither could ever
  // name a revision the other had not already written. Work pushed to six
  // repositories was invisible to both, and both reported success. This is the
  // assertion that the pinned planner really does refuse to look, so that
  // deleting the `latest` branch cannot pass as a simplification.
  it('does not contact the remote at all for an entry already at its pin', () => {
    const settled = present({ head: SHA_A })
    const action = planSync(pinned, settled)
    expect(action._tag).toBe('AlreadyAtRef')
    expect(gitCommandsFor(action, 'repos/mc-kernel')).toStrictEqual([])
  })

  it('fetches first, because the target is not known until origin is asked', () => {
    const action = planSync(pinned, present({ head: SHA_A, remote: undefined }), 'latest')
    expect(action._tag).toBe('Fetch')
    expect(action._tag === 'Fetch' ? action.reason : undefined).toBe('latest')
  })

  it("advances a clean copy that is behind origin's tip", () => {
    const action = planSync(pinned, present({ head: SHA_A, remote: remote() }), 'latest')
    expect(action._tag).toBe('Checkout')
    expect(action._tag === 'Checkout' ? action.ref : undefined).toBe(SHA_TIP)
    expect(action._tag === 'Checkout' ? action.source : undefined).toBe('remote')
  })

  it('ignores the manifest ref entirely — that is what the flag means', () => {
    // Pinned at SHA_A, sitting at SHA_A, and still moved: `pinned` mode would
    // call this settled, which is precisely the deadlock.
    const state = present({ head: SHA_A, remote: remote() })
    expect(planSync(pinned, state)._tag).toBe('AlreadyAtRef')
    expect(planSync(pinned, state, 'latest')._tag).toBe('Checkout')
  })

  // The `pinned`-mode prohibition on moving an unpinned entry is a rule about
  // GUESSING. `--latest` is not a guess: the caller named the destination.
  it('advances an unpinned entry, which pinned mode refuses to move', () => {
    const state = present({ head: SHA_A, remote: remote() })
    expect(planSync(unpinned, state)._tag).not.toBe('Checkout')
    expect(planSync(unpinned, state, 'latest')._tag).toBe('Checkout')
  })

  it("reports no work when HEAD is already origin's tip", () => {
    const action = planSync(pinned, present({ head: SHA_TIP, remote: remote() }), 'latest')
    expect(action._tag).toBe('AlreadyAtRef')
    expect(action._tag === 'AlreadyAtRef' ? action.source : undefined).toBe('remote')
    expect(isNoOp(action)).toBe(true)
  })

  it('still checks out detached, so no local branch is created or moved', () => {
    const action = planSync(pinned, present({ head: SHA_A, remote: remote() }), 'latest')
    expect(gitCommandsFor(action, 'repos/mc-kernel')).toStrictEqual([
      ['-C', 'repos/mc-kernel', 'checkout', '--detach', SHA_TIP],
    ])
  })

  it('settles in fetch-then-advance and then reports no work', () => {
    const { actions, state } = settle(pinned, present({ head: SHA_A }), 10, 'latest', remote())
    expect(actions.map((action) => action._tag)).toStrictEqual(['Fetch', 'Checkout', 'AlreadyAtRef'])
    expect(state._tag === 'Present' ? state.head : undefined).toBe(SHA_TIP)
  })
})

describe('nothing is advanced over work that exists only here', () => {
  const diverged = present({ head: SHA_B, remote: remote({ headIsAncestorOfTip: false }) })

  // REGRESSION — the rule `--latest` had to bring with it. `pnpm sync` leaves
  // working copies DETACHED, so a commit made in one is reachable from HEAD and
  // from nothing else. Checking out the tip over it leaves it in the reflog,
  // which is where work goes to not be found again. A dirty tree announces
  // itself in `git status`; this does not, which is why it needs its own skip.
  it("skips a clean copy whose HEAD origin's tip cannot reach", () => {
    const action = planSync(pinned, diverged, 'latest')
    expect(action._tag).toBe('SkipDiverged')
    expect(action._tag === 'SkipDiverged' ? action.head : undefined).toBe(SHA_B)
    expect(action._tag === 'SkipDiverged' ? action.tip : undefined).toBe(SHA_TIP)
  })

  it('skips it for every entry, pinned or not', () => {
    for (const entry of EVERY_ENTRY) {
      expect(planSync(entry, diverged, 'latest')._tag).toBe('SkipDiverged')
    }
  })

  it('produces no git command at all for it', () => {
    expect(gitCommandsFor(planSync(pinned, diverged, 'latest'), 'repos/mc-kernel')).toStrictEqual([])
    expect(isNoOp(planSync(pinned, diverged, 'latest'))).toBe(true)
  })

  it('leaves it exactly where it was, and stops', () => {
    const { actions, state } = settle(pinned, diverged, 10, 'latest', remote())
    expect(actions.map((action) => action._tag)).toStrictEqual(['SkipDiverged'])
    expect(state).toStrictEqual(diverged)
  })

  // The whole sweep, not just the fixture: no state in which the remote says
  // "not an ancestor" may produce a command, in either mode.
  it('emits no command from any non-ancestor state, in either mode', () => {
    for (const entry of EVERY_ENTRY) {
      for (const state of EVERY_STATE) {
        if (state._tag !== 'Present' || state.dirty || state.remote?.headIsAncestorOfTip !== false) {
          continue
        }
        expect(
          gitCommandsFor(planSync(entry, state, 'latest'), `repos/${entry.name}`),
          JSON.stringify(state),
        ).toStrictEqual([])
      }
    }
  })

  it('says what it did not do and why, naming both revisions', () => {
    const message = describeAction({
      _tag: 'SkipDiverged',
      name: 'mc-kernel',
      head: SHA_B,
      tip: SHA_TIP,
    })
    expect(message).toContain('Nothing was touched')
    expect(message).toContain(SHA_B.slice(0, 12))
    expect(message).toContain(SHA_TIP.slice(0, 12))
  })

  it('counts it separately from a dirty skip, because the remedy differs', () => {
    const summary = summarise([
      { _tag: 'SkipDirty', name: 'mc-noise' },
      { _tag: 'SkipDiverged', name: 'mc-kernel', head: SHA_B, tip: SHA_TIP },
    ])
    expect(summary.skippedDirty).toStrictEqual(['mc-noise'])
    expect(summary.skippedDiverged).toStrictEqual(['mc-kernel'])
    expect(summary.checkedOut).toStrictEqual([])
  })
})

describe('no reachable git command can destroy work', () => {
  // Every entry x every state x EVERY MODE. The mode axis is the one `--latest`
  // added, and leaving it out would have meant this sweep proving safety for
  // half the tool while reading as though it covered all of it.
  const everyReachableCommand = (): ReadonlyArray<ReadonlyArray<string>> => {
    const commands: Array<ReadonlyArray<string>> = []
    for (const entry of EVERY_ENTRY) {
      for (const state of EVERY_STATE) {
        for (const mode of BOTH_MODES) {
          for (const argv of gitCommandsFor(planSync(entry, state, mode), `repos/${entry.name}`)) {
            commands.push(argv)
          }
        }
      }
    }
    return commands
  }

  // REGRESSION — the enforcement that does not depend on anyone reading a
  // comment. Every state x every manifest entry x every mode, every command
  // that could result, checked against the destructive-argument list. No git
  // required.
  it('emits no command containing a destructive argument, from any state', () => {
    for (const argv of everyReachableCommand()) {
      expect(isDestructiveGitCommand(argv), `git ${argv.join(' ')}`).toBe(false)
    }
  })

  it('emits no `git reset`, `git clean` or `git restore` at all', () => {
    const flattened = everyReachableCommand().map((argv) => argv.join(' '))
    for (const forbidden of ['reset', 'clean', 'restore', '--hard', '--force']) {
      expect(flattened.filter((command) => command.includes(forbidden))).toStrictEqual([])
    }
  })

  // REGRESSION: `checkout <branch>` over a clean tree still moves the
  // developer off whatever branch they were on. `--detach` cannot.
  it('always checks out detached, so no local branch is moved or created', () => {
    const checkouts = everyReachableCommand().filter((argv) => argv.includes('checkout'))
    expect(checkouts.length).toBeGreaterThan(0)
    for (const argv of checkouts) {
      expect(argv).toContain('--detach')
    }
  })

  it('recognises the destructive arguments it is guarding against', () => {
    for (const argument of DESTRUCTIVE_GIT_ARGUMENTS) {
      expect(isDestructiveGitCommand(['-C', 'repos/x', argument])).toBe(true)
    }
    expect(isDestructiveGitCommand(['-C', 'repos/x', 'status', '--porcelain'])).toBe(false)
  })
})

describe('idempotence', () => {
  // REGRESSION: "clones when absent, fetches when present" is only useful if
  // running it twice is safe. The second run must do nothing at all.
  it('settles a fresh clone in one action and then reports no work', () => {
    const first = settle(pinned, absent)
    expect(first.actions.map((action) => action._tag)).toStrictEqual(['Clone', 'AlreadyAtRef'])

    const second = settle(pinned, first.state)
    expect(second.actions.map((action) => action._tag)).toStrictEqual(['AlreadyAtRef'])
  })

  it('settles fetch-then-checkout in two actions and then reports no work', () => {
    const first = settle(pinned, present({ head: SHA_B, hasPinnedRef: false }))
    expect(first.actions.map((action) => action._tag)).toStrictEqual([
      'Fetch',
      'Checkout',
      'AlreadyAtRef',
    ])

    expect(settle(pinned, first.state).actions.map((action) => action._tag)).toStrictEqual([
      'AlreadyAtRef',
    ])
  })

  // REGRESSION — this used to say "for a pinned entry", and the scope was the
  // bug: unpinned entries were excluded because they DID NOT reach a no-op,
  // and narrowing the invariant is how that survived. It holds for every entry
  // now, and settling has to be what ends the loop rather than the round limit,
  // so `maxRounds` is set well above what any entry should need.
  it('reaches a no-op from every state, for every entry, in either mode', () => {
    for (const entry of EVERY_ENTRY) {
      for (const state of EVERY_STATE) {
        for (const mode of BOTH_MODES) {
          const { actions } = settle(entry, state, 10, mode, remote())
          const last = actions[actions.length - 1]
          expect(
            last === undefined ? undefined : isNoOp(last),
            JSON.stringify({ ref: entry.ref, mode, state }),
          ).toBe(true)
        }
      }
    }
  })

  // The counterpart of the above: reaching a no-op is worthless if it takes
  // five fetches to get there. Nothing needs more than one round-trip.
  it('contacts the remote at most once per entry, from every state, in either mode', () => {
    for (const entry of EVERY_ENTRY) {
      for (const state of EVERY_STATE) {
        for (const mode of BOTH_MODES) {
          const { actions } = settle(entry, state, 10, mode, remote())
          expect(
            actions.filter(fetchesFromRemote).length,
            JSON.stringify({ ref: entry.ref, mode, state }),
          ).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  // `scripts/sync-repos.ts` stops after MAX_ROUNDS whether or not the planner
  // has settled, so a guard set at exactly the worst case cannot tell
  // "converged" from "gave up". This pins the worst case at three so that the
  // guard of four has a round of visible slack. If this ever needs raising, the
  // guard needs raising in the same commit — and if it needs raising a lot,
  // the planner has a loop and the guard is the wrong fix.
  it('never needs more than three actions to settle, from any state or mode', () => {
    for (const entry of EVERY_ENTRY) {
      for (const state of EVERY_STATE) {
        for (const mode of BOTH_MODES) {
          const { actions } = settle(entry, state, 10, mode, remote())
          expect(actions.length, JSON.stringify({ ref: entry.ref, mode, state })).toBeLessThanOrEqual(3)
        }
      }
    }
  })

  it('leaves a dirty repository dirty and unmoved', () => {
    const dirty = present({ head: SHA_B, dirty: true })
    const { actions, state } = settle(pinned, dirty)
    expect(actions.map((action) => action._tag)).toStrictEqual(['SkipDirty'])
    expect(state).toStrictEqual(dirty)
  })

  // REGRESSION: an unpinned entry never becomes AlreadyAtRef, because there is
  // no ref to be at. It used to have no other way of being finished either, so
  // it re-fetched on every round and only the loop guard stopped it — three
  // round-trips per repository, fifteen repositories, every `pnpm sync`. It
  // settles as UpToDate now, and the round limit is no longer load-bearing:
  // this asserts it with maxRounds far above what the entry may use.
  it('settles an unpinned entry after exactly one fetch', () => {
    const { actions } = settle(unpinned, present({ head: SHA_B }), 10)
    expect(actions.map((action) => action._tag)).toStrictEqual(['Fetch', 'UpToDate'])
    expect(summarise(actions).fetched).toStrictEqual(['mc-kernel'])
  })

  it('settles a fresh unpinned clone with no fetch at all', () => {
    const { actions } = settle(unpinned, absent, 10)
    expect(actions.map((action) => action._tag)).toStrictEqual(['Clone', 'UpToDate'])
    expect(summarise(actions).fetched).toStrictEqual([])
  })

  // The second `pnpm sync` of the day. A pinned entry does nothing; an unpinned
  // one asks the remote once more, because there is no pinned ref against which
  // "already up to date" could be decided without asking. What it must never do
  // is ask more than once, which is what the run before it did three times.
  it('re-fetches an unpinned entry once on a later run, never more', () => {
    const first = settle(unpinned, present({ head: SHA_B }), 10)
    const laterRun: WorkingCopyState = { ...present({ head: SHA_B }), fetchedThisRun: false }
    expect(first.state).toStrictEqual({ ...present({ head: SHA_B }), fetchedThisRun: true })

    const second = settle(unpinned, laterRun, 10)
    expect(second.actions.map((action) => action._tag)).toStrictEqual(['Fetch', 'UpToDate'])
  })
})

describe('planning the whole manifest', () => {
  const entries: ReadonlyArray<ManifestEntry> = [
    { name: 'mc-kernel', url: 'u1', ref: SHA_A },
    { name: 'mc-noise', url: 'u2', ref: SHA_B },
    { name: 'mc-save', url: 'u3', ref: UNPINNED },
    { name: 'mc-ui', url: 'u4', ref: SHA_A },
  ]

  it('preserves manifest order so output is stable between runs', () => {
    const actions = planAll(entries, () => absent)
    expect(actions.map((action) => action.name)).toStrictEqual(['mc-kernel', 'mc-noise', 'mc-save', 'mc-ui'])
  })

  it('summarises a mixed run by category', () => {
    const states = new Map<string, WorkingCopyState>([
      ['mc-kernel', absent],
      ['mc-noise', present({ head: SHA_B, dirty: true })],
      ['mc-save', present({ head: SHA_A })],
      ['mc-ui', present({ head: SHA_B })],
    ])

    const summary = summarise(planAll(entries, (entry) => states.get(entry.name) ?? absent))

    expect(summary.cloned).toStrictEqual(['mc-kernel'])
    expect(summary.skippedDirty).toStrictEqual(['mc-noise'])
    expect(summary.fetched).toStrictEqual(['mc-save'])
    expect(summary.checkedOut).toStrictEqual(['mc-ui'])
  })

  it('plans an empty manifest without complaint', () => {
    expect(planAll([], () => absent)).toStrictEqual([])
    expect(summarise([])).toStrictEqual({
      cloned: [],
      fetched: [],
      checkedOut: [],
      unchanged: [],
      skippedDirty: [],
      skippedDiverged: [],
    })
  })
})

describe('the model of what the script does', () => {
  it('models a fetch as making objects local without moving HEAD', () => {
    const before = present({ head: SHA_B, hasPinnedRef: false })
    const after = applyAction(pinned, before, { _tag: 'Fetch', name: 'mc-kernel', reason: 'ref-not-local' })
    expect(after).toStrictEqual(present({ head: SHA_B, hasPinnedRef: true, fetchedThisRun: true }))
  })

  it('models a checkout as moving HEAD and nothing else', () => {
    const before = present({ head: SHA_B, hasPinnedRef: true })
    const after = applyAction(pinned, before, {
      _tag: 'Checkout',
      name: 'mc-kernel',
      ref: SHA_A,
      source: 'manifest',
    })
    expect(after).toStrictEqual(present({ head: SHA_A, hasPinnedRef: true }))
  })

  // REGRESSION: `applyAction` is total over every (state, action) pair, not
  // just the ones `planSync` would actually produce together. A `Fetch` or
  // `Checkout` can never be planned against an `Absent` working copy in
  // practice, but `applyAction` must still answer safely rather than assume
  // its caller always agrees with `planSync` — the two are asserted separately
  // (test/sync-plan.test.ts's exhaustive sweep) precisely so neither can drift
  // without the other noticing, which only works if both sides are total.
  it('leaves an absent working copy absent, even if asked to fetch or check out', () => {
    expect(applyAction(pinned, absent, { _tag: 'Fetch', name: 'mc-kernel', reason: 'ref-not-local' })).toBe(
      absent,
    )
    expect(
      applyAction(pinned, absent, { _tag: 'Checkout', name: 'mc-kernel', ref: SHA_A, source: 'manifest' }),
    ).toBe(absent)
  })

  it('models the no-op actions as changing nothing', () => {
    const dirty = present({ head: SHA_B, dirty: true })
    const noOps: ReadonlyArray<SyncAction> = [
      { _tag: 'SkipDirty', name: 'mc-kernel' },
      { _tag: 'AlreadyAtRef', name: 'mc-kernel', ref: SHA_A, source: 'manifest' },
      { _tag: 'UpToDate', name: 'mc-kernel' },
      { _tag: 'SkipDiverged', name: 'mc-kernel', head: SHA_B, tip: SHA_TIP },
    ]
    for (const action of noOps) {
      expect(applyAction(pinned, dirty, action)).toStrictEqual(dirty)
    }
  })

  // `scripts/sync-repos.ts` re-observes the working copy after every action and
  // has to decide `fetchedThisRun` itself, because nothing on disk records it.
  // It uses `fetchesFromRemote`; this pins that the model agrees, so the script
  // and the model cannot drift on the one field the script has to supply.
  it('agrees with fetchesFromRemote about which actions contact the remote', () => {
    const clean = present({ head: SHA_B, fetchedThisRun: false })
    const actions: ReadonlyArray<SyncAction> = [
      { _tag: 'Clone', name: 'mc-kernel', url: pinned.url, ref: SHA_A },
      { _tag: 'Fetch', name: 'mc-kernel', reason: 'ref-not-local' },
      { _tag: 'Fetch', name: 'mc-kernel', reason: 'unpinned' },
      { _tag: 'Fetch', name: 'mc-kernel', reason: 'latest' },
      { _tag: 'Checkout', name: 'mc-kernel', ref: SHA_A, source: 'manifest' },
      { _tag: 'AlreadyAtRef', name: 'mc-kernel', ref: SHA_A, source: 'manifest' },
      { _tag: 'UpToDate', name: 'mc-kernel' },
      { _tag: 'SkipDirty', name: 'mc-kernel' },
      { _tag: 'SkipDiverged', name: 'mc-kernel', head: SHA_A, tip: SHA_TIP },
    ]
    for (const action of actions) {
      const after = applyAction(pinned, clean, action)
      expect(after._tag === 'Present' && after.fetchedThisRun, action._tag).toBe(
        fetchesFromRemote(action),
      )
    }
  })
})
