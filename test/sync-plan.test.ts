import { describe, expect, it } from 'vitest'
import { UNPINNED, type ManifestEntry } from '../domain/manifest'
import {
  applyAction,
  DESTRUCTIVE_GIT_ARGUMENTS,
  describeAction,
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

const present = (
  overrides: Partial<Extract<WorkingCopyState, { _tag: 'Present' }>> = {},
): WorkingCopyState => ({
  _tag: 'Present',
  head: SHA_A,
  dirty: false,
  hasPinnedRef: true,
  ...overrides,
})

/** Every observable state, for the exhaustive safety sweeps below. */
const EVERY_STATE: ReadonlyArray<WorkingCopyState> = [
  absent,
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

  it('reaches a no-op from every state, for a pinned entry', () => {
    for (const state of EVERY_STATE) {
      const { actions } = settle(pinned, state)
      const last = actions[actions.length - 1]
      expect(last === undefined ? undefined : isNoOp(last), JSON.stringify(state)).toBe(true)
    }
  })

  it('leaves a dirty repository dirty and unmoved', () => {
    const dirty = present({ head: SHA_B, dirty: true })
    const { actions, state } = settle(pinned, dirty)
    expect(actions.map((action) => action._tag)).toStrictEqual(['SkipDirty'])
    expect(state).toStrictEqual(dirty)
  })

  // An unpinned entry fetches once and then has nothing more to do — but it
  // never becomes AlreadyAtRef, because there is no ref to be at. The loop
  // guard is what stops it spinning.
  it('does not loop forever on an unpinned entry', () => {
    const { actions } = settle(unpinned, present({ head: SHA_B }), 3)
    expect(actions).toHaveLength(3)
    for (const action of actions) {
      expect(action._tag).toBe('Fetch')
    }
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
    expect(after).toStrictEqual(present({ head: SHA_B, hasPinnedRef: true }))
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
    ]
    for (const action of noOps) {
      expect(applyAction(pinned, dirty, action)).toStrictEqual(dirty)
    }
  })
})
