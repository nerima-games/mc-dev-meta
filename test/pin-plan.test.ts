import { describe, expect, it } from 'vitest'
import { UNPINNED, type ManifestEntry } from '../domain/manifest'
import {
  describePinDecision,
  planPin,
  refToWrite,
  summarisePins,
  type PinDecision,
  type PinObservation,
} from '../domain/pin-plan'
import type { RemoteObservation, SyncMode } from '../domain/sync-plan'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_TIP = 'c'.repeat(40)

const pinned: ManifestEntry = {
  name: 'mc-kernel',
  url: 'https://github.com/nerima-games/mc-kernel.git',
  ref: SHA_A,
}

const unpinned: ManifestEntry = { ...pinned, ref: UNPINNED }

const remote = (overrides: Partial<RemoteObservation> = {}): RemoteObservation => ({
  tip: SHA_TIP,
  headIsAncestorOfTip: true,
  ...overrides,
})

const clean = (head: string, observation?: RemoteObservation): PinObservation => ({
  _tag: 'Clean',
  head,
  remote: observation,
})

const EVERY_ENTRY: ReadonlyArray<ManifestEntry> = [pinned, unpinned]
const BOTH_MODES: ReadonlyArray<SyncMode> = ['pinned', 'latest']

/** Every observation the script can hand the planner. */
const EVERY_OBSERVATION: ReadonlyArray<PinObservation> = [
  { _tag: 'Absent' },
  { _tag: 'Dirty' },
  clean(SHA_A),
  clean(SHA_B),
  clean(SHA_A, remote()),
  clean(SHA_B, remote()),
  clean(SHA_TIP, remote()),
  clean(SHA_A, remote({ headIsAncestorOfTip: false })),
  clean(SHA_B, remote({ headIsAncestorOfTip: false })),
  clean(SHA_A, remote({ tip: SHA_A })),
]

describe('pinning to the working copy', () => {
  it('pins a clean repository to its HEAD', () => {
    const decision = planPin(pinned, clean(SHA_B))
    expect(decision._tag).toBe('Pin')
    expect(refToWrite(decision)).toBe(SHA_B)
    expect(decision._tag === 'Pin' ? decision.source : undefined).toBe('working-copy')
  })

  it('pins an unpinned entry, which is the sentinel getting resolved', () => {
    expect(refToWrite(planPin(unpinned, clean(SHA_B)))).toBe(SHA_B)
  })

  it('does nothing when HEAD is already the pin', () => {
    expect(planPin(pinned, clean(SHA_A))._tag).toBe('AlreadyPinned')
  })
})

describe('a state nobody could reproduce is never written', () => {
  // REGRESSION: absence is not an opinion. A repository the roster names but
  // nobody has cloned must keep whatever ref it had, or `pnpm update:manifest`
  // on a partial workspace would quietly unpin most of the project.
  it('leaves an absent repository alone, in either mode', () => {
    for (const mode of BOTH_MODES) {
      const decision = planPin(pinned, { _tag: 'Absent' }, mode)
      expect(decision._tag, mode).toBe('LeaveAbsent')
      expect(refToWrite(decision)).toBeUndefined()
    }
  })

  // REGRESSION: a dirty tree's HEAD does not describe what is on disk, so
  // pinning it records a state nobody can reproduce — and it looks pinned,
  // which is worse than being honestly unpinned.
  it('leaves a dirty repository alone, in either mode', () => {
    for (const mode of BOTH_MODES) {
      const decision = planPin(pinned, { _tag: 'Dirty' }, mode)
      expect(decision._tag, mode).toBe('LeaveDirty')
      expect(refToWrite(decision)).toBeUndefined()
    }
  })

  it('says of a dirty repository that HEAD does not describe the tree', () => {
    const message = describePinDecision({ _tag: 'LeaveDirty', name: 'mc-kernel' })
    expect(message).toContain('HEAD does not describe the working tree')
  })
})

describe("pinning to origin's tip (--latest)", () => {
  // REGRESSION — the other half of the deadlock. The default mode can only ever
  // name what `pnpm sync` put on disk, and `pnpm sync` can only ever put the
  // pin there. `--latest` is the only path by which a revision nobody has
  // recorded can enter repos.json.
  it("pins to the tip even when HEAD equals the manifest's ref", () => {
    const state = clean(SHA_A, remote())
    expect(planPin(pinned, state)._tag).toBe('AlreadyPinned')
    expect(refToWrite(planPin(pinned, state, 'latest'))).toBe(SHA_TIP)
  })

  it('records that the ref came from the remote, not from disk', () => {
    const decision = planPin(pinned, clean(SHA_A, remote()), 'latest')
    expect(decision._tag === 'Pin' ? decision.source : undefined).toBe('remote')
    expect(describePinDecision(decision)).toContain('pnpm sync')
  })

  it('does nothing when the tip is already the pin', () => {
    expect(planPin(pinned, clean(SHA_A, remote({ tip: SHA_A })), 'latest')._tag).toBe('AlreadyPinned')
  })

  // REGRESSION: writing a pin destroys nothing by itself — the NEXT `pnpm sync`
  // acts on it, against a detached working copy. Pinning past a local commit is
  // therefore a booby trap rather than an accident, and worse for it: by the
  // time it goes off, nobody is watching.
  it('refuses to pin a tip that HEAD cannot fast-forward to', () => {
    const decision = planPin(pinned, clean(SHA_B, remote({ headIsAncestorOfTip: false })), 'latest')
    expect(decision._tag).toBe('LeaveDiverged')
    expect(refToWrite(decision)).toBeUndefined()
  })

  it('names both revisions and says to push first', () => {
    const message = describePinDecision({
      _tag: 'LeaveDiverged',
      name: 'mc-kernel',
      head: SHA_B,
      tip: SHA_TIP,
    })
    expect(message).toContain(SHA_B.slice(0, 12))
    expect(message).toContain(SHA_TIP.slice(0, 12))
    expect(message).toContain('Push it first')
  })

  // REGRESSION: falling back to the working copy's HEAD here would make
  // `--latest` silently behave as the plain command — a flag that reports
  // success having answered a different question than the one it was asked.
  it('refuses to guess when the remote could not be read', () => {
    const decision = planPin(pinned, clean(SHA_B, undefined), 'latest')
    expect(decision._tag).toBe('LeaveRemoteUnknown')
    expect(refToWrite(decision)).toBeUndefined()
  })

  it('advances an unpinned entry to the tip as readily as a pinned one', () => {
    expect(refToWrite(planPin(unpinned, clean(SHA_A, remote()), 'latest'))).toBe(SHA_TIP)
  })
})

describe('the exhaustive sweep', () => {
  // The counterpart of `test/sync-plan.test.ts`'s command sweep: this planner
  // emits refs rather than commands, so what has to be exhaustively true is
  // that a ref is only ever emitted from a state that could produce one safely.
  it('writes a ref only from a clean, non-diverged observation', () => {
    for (const entry of EVERY_ENTRY) {
      for (const observation of EVERY_OBSERVATION) {
        for (const mode of BOTH_MODES) {
          const written = refToWrite(planPin(entry, observation, mode))
          if (written === undefined) {
            continue
          }
          expect(observation._tag, JSON.stringify({ mode, observation })).toBe('Clean')
          if (observation._tag === 'Clean' && mode === 'latest') {
            expect(observation.remote?.headIsAncestorOfTip, JSON.stringify(observation)).toBe(true)
          }
        }
      }
    }
  })

  it('writes only the working copy HEAD or the remote tip, never anything else', () => {
    for (const entry of EVERY_ENTRY) {
      for (const observation of EVERY_OBSERVATION) {
        for (const mode of BOTH_MODES) {
          const written = refToWrite(planPin(entry, observation, mode))
          if (written === undefined || observation._tag !== 'Clean') {
            continue
          }
          expect([observation.head, observation.remote?.tip]).toContain(written)
        }
      }
    }
  })

  it('never writes a ref equal to the one already there', () => {
    for (const entry of EVERY_ENTRY) {
      for (const observation of EVERY_OBSERVATION) {
        for (const mode of BOTH_MODES) {
          expect(refToWrite(planPin(entry, observation, mode))).not.toBe(entry.ref)
        }
      }
    }
  })

  it('decides something for every observation, in either mode', () => {
    for (const entry of EVERY_ENTRY) {
      for (const observation of EVERY_OBSERVATION) {
        for (const mode of BOTH_MODES) {
          expect(describePinDecision(planPin(entry, observation, mode)).length).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('summarising a run', () => {
  const decisions: ReadonlyArray<PinDecision> = [
    { _tag: 'Pin', name: 'mc-kernel', ref: SHA_TIP, source: 'remote' },
    { _tag: 'AlreadyPinned', name: 'mc-noise', ref: SHA_A },
    { _tag: 'LeaveAbsent', name: 'mc-save', ref: UNPINNED },
    { _tag: 'LeaveDirty', name: 'mc-sim' },
    { _tag: 'LeaveDiverged', name: 'mc-render', head: SHA_B, tip: SHA_TIP },
    { _tag: 'LeaveRemoteUnknown', name: 'mc-audio' },
  ]

  // Every skip is its own bucket because every skip has its own remedy, and a
  // run that pinned nothing because fifteen repositories were dirty must not
  // look like a run that pinned nothing because there was nothing to pin.
  it('separates every kind of skip', () => {
    expect(summarisePins(decisions)).toStrictEqual({
      pinned: ['mc-kernel'],
      alreadyPinned: ['mc-noise'],
      skippedAbsent: ['mc-save'],
      skippedDirty: ['mc-sim'],
      skippedDiverged: ['mc-render'],
      skippedRemoteUnknown: ['mc-audio'],
    })
  })

  it('summarises an empty run without complaint', () => {
    expect(summarisePins([])).toStrictEqual({
      pinned: [],
      alreadyPinned: [],
      skippedAbsent: [],
      skippedDirty: [],
      skippedDiverged: [],
      skippedRemoteUnknown: [],
    })
  })
})
