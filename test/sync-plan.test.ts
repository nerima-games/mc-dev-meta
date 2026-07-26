import { describe, expect, it } from 'vitest'
import { UNPINNED, type ManifestEntry } from '../domain/manifest'
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
  type SyncAction,
  type WorkingCopyState,
} from '../domain/sync-plan'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

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
  ...overrides,
})

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
 * Every observable state, for the exhaustive safety sweeps below.
 *
 * `fetchedThisRun` is not read off the disk, so it doubles every observed state
 * rather than replacing any: each one can be reached both before and after this
 * run has contacted the remote, and the sweeps have to cover both.
 */
const EVERY_STATE: ReadonlyArray<WorkingCopyState> = [
  absent,
  ...EVERY_OBSERVED_STATE.flatMap((state) => [state, { ...state, fetchedThisRun: true }]),
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
  it('skips a dirty repository whatever else is true of it', () => {
    for (const state of EVERY_STATE) {
      if (state._tag !== 'Present' || !state.dirty) {
        continue
      }
      for (const entry of EVERY_ENTRY) {
        expect(planSync(entry, state)._tag).toBe('SkipDirty')
      }
    }
  })

  it('checks dirtiness before deciding anything else', () => {
    // Same repository, same manifest ref, differing only in dirtiness.
    expect(planSync(pinned, present({ head: SHA_B, dirty: false }))._tag).toBe('Checkout')
    expect(planSync(pinned, present({ head: SHA_B, dirty: true }))._tag).toBe('SkipDirty')
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

  it('never emits a Checkout for an unpinned entry, from any state', () => {
    for (const state of EVERY_STATE) {
      expect(planSync(unpinned, state)._tag).not.toBe('Checkout')
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

  // REGRESSION: this branch used to answer `Fetch` from EVERY clean state,
  // including one it had just fetched, so the caller's convergence loop ran the
  // fetch again on every round. With `repos.json` shipping 15 unpinned entries
  // and a 3-round loop that was 45 network round-trips per `pnpm sync`.
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

describe('no reachable git command can destroy work', () => {
  const everyReachableCommand = (): ReadonlyArray<ReadonlyArray<string>> => {
    const commands: Array<ReadonlyArray<string>> = []
    for (const entry of EVERY_ENTRY) {
      for (const state of EVERY_STATE) {
        for (const argv of gitCommandsFor(planSync(entry, state), `repos/${entry.name}`)) {
          commands.push(argv)
        }
      }
    }
    return commands
  }

  // REGRESSION — the enforcement that does not depend on anyone reading a
  // comment. Every state x every manifest entry, every command that could
  // result, checked against the destructive-argument list. No git required.
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
  it('reaches a no-op from every state, for every entry', () => {
    for (const entry of EVERY_ENTRY) {
      for (const state of EVERY_STATE) {
        const { actions } = settle(entry, state, 10)
        const last = actions[actions.length - 1]
        expect(
          last === undefined ? undefined : isNoOp(last),
          JSON.stringify({ ref: entry.ref, state }),
        ).toBe(true)
      }
    }
  })

  // The counterpart of the above: reaching a no-op is worthless if it takes
  // five fetches to get there. Nothing needs more than one round-trip.
  it('contacts the remote at most once per entry, from every state', () => {
    for (const entry of EVERY_ENTRY) {
      for (const state of EVERY_STATE) {
        const { actions } = settle(entry, state, 10)
        expect(
          actions.filter(fetchesFromRemote).length,
          JSON.stringify({ ref: entry.ref, state }),
        ).toBeLessThanOrEqual(1)
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
  ]

  it('preserves manifest order so output is stable between runs', () => {
    const actions = planAll(entries, () => absent)
    expect(actions.map((action) => action.name)).toStrictEqual(['mc-kernel', 'mc-noise', 'mc-save'])
  })

  it('summarises a mixed run by category', () => {
    const states = new Map<string, WorkingCopyState>([
      ['mc-kernel', absent],
      ['mc-noise', present({ head: SHA_B, dirty: true })],
      ['mc-save', present({ head: SHA_A })],
    ])

    const summary = summarise(planAll(entries, (entry) => states.get(entry.name) ?? absent))

    expect(summary.cloned).toStrictEqual(['mc-kernel'])
    expect(summary.skippedDirty).toStrictEqual(['mc-noise'])
    expect(summary.fetched).toStrictEqual(['mc-save'])
    expect(summary.checkedOut).toStrictEqual([])
  })

  it('plans an empty manifest without complaint', () => {
    expect(planAll([], () => absent)).toStrictEqual([])
    expect(summarise([])).toStrictEqual({
      cloned: [],
      fetched: [],
      checkedOut: [],
      unchanged: [],
      skippedDirty: [],
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
    const after = applyAction(pinned, before, { _tag: 'Checkout', name: 'mc-kernel', ref: SHA_A })
    expect(after).toStrictEqual(present({ head: SHA_A, hasPinnedRef: true }))
  })

  it('models the no-op actions as changing nothing', () => {
    const dirty = present({ head: SHA_B, dirty: true })
    const noOps: ReadonlyArray<SyncAction> = [
      { _tag: 'SkipDirty', name: 'mc-kernel' },
      { _tag: 'AlreadyAtRef', name: 'mc-kernel', ref: SHA_A },
      { _tag: 'UpToDate', name: 'mc-kernel' },
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
      { _tag: 'Checkout', name: 'mc-kernel', ref: SHA_A },
      { _tag: 'AlreadyAtRef', name: 'mc-kernel', ref: SHA_A },
      { _tag: 'UpToDate', name: 'mc-kernel' },
      { _tag: 'SkipDirty', name: 'mc-kernel' },
    ]
    for (const action of actions) {
      const after = applyAction(pinned, clean, action)
      expect(after._tag === 'Present' && after.fetchedThisRun, action._tag).toBe(
        fetchesFromRemote(action),
      )
    }
  })
})
