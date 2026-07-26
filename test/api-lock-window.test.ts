/**
 * The four-week API-lock window (plan.md §6 Step 3).
 *
 * Plain vitest, not `@effect/vitest` — this repository has no runtime
 * dependencies at all, not even `effect`, for the reason recorded in
 * `domain/manifest.ts`.
 *
 * `now` is a parameter of every function under test, which is what makes the
 * boundary — 27 days versus 28 — an ordinary test case rather than something
 * that can only be observed on one particular afternoon.
 */
import { describe, expect, it } from 'vitest'
import {
  API_LOCK_WINDOW_MS,
  describeVerdict,
  judgeWindow,
  summariseWindows,
  type WindowVerdict,
} from '../domain/api-lock-window'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-08-23T12:00:00Z')

const anchoredDaysAgo = (days: number) => ({
  repository: 'mc-kernel',
  lastChangedAt: new Date(NOW - days * DAY_MS).toISOString(),
})

describe('the window is four weeks, and the boundary is exact', () => {
  it('is 28 days, matching plan.md §6 Step 3', () => {
    expect(API_LOCK_WINDOW_MS).toBe(28 * DAY_MS)
  })

  it('27 days is still waiting — one day short is short', () => {
    const verdict = judgeWindow(anchoredDaysAgo(27), NOW)
    expect(verdict._tag).toBe('Waiting')
    expect(verdict).toMatchObject({ elapsedDays: 27, remainingDays: 1 })
  })

  it('28 days is stable — the boundary is inclusive', () => {
    const verdict = judgeWindow(anchoredDaysAgo(28), NOW)
    expect(verdict._tag).toBe('Stable')
    expect(verdict).toMatchObject({ elapsedDays: 28 })
  })

  it('a partial day does not count — 27 days and 23 hours is 27 days', () => {
    const anchor = { repository: 'mc-kernel', lastChangedAt: new Date(NOW - 27 * DAY_MS - 23 * 60 * 60 * 1000).toISOString() }
    expect(judgeWindow(anchor, NOW)).toMatchObject({ _tag: 'Waiting', elapsedDays: 27 })
  })
})

describe('an unmeasurable repository says so, and is never counted as unstable', () => {
  it('no committed api-lock.md is Unknown, not Waiting', () => {
    const verdict = judgeWindow({ repository: 'mc-noise', lastChangedAt: undefined }, NOW)
    expect(verdict._tag).toBe('Unknown')
  })

  it('an unparseable date is Unknown, and the message contains the value that failed', () => {
    const verdict = judgeWindow({ repository: 'mc-noise', lastChangedAt: 'last tuesday' }, NOW)
    expect(verdict._tag).toBe('Unknown')
    expect(describeVerdict(verdict)).toContain('last tuesday')
  })

  it('REGRESSION: silence is reported as silence — Unknown is its own count, never folded into waiting', () => {
    // A status board that reports "not yet stable" for a repository that has
    // said nothing is a status board that lies. The counts must stay disjoint.
    const verdicts: ReadonlyArray<WindowVerdict> = [
      judgeWindow(anchoredDaysAgo(30), NOW),
      judgeWindow(anchoredDaysAgo(1), NOW),
      judgeWindow({ repository: 'mc-save', lastChangedAt: undefined }, NOW),
    ]
    const summary = summariseWindows(verdicts)
    expect(summary).toContain('1 stable')
    expect(summary).toContain('1 waiting')
    expect(summary).toContain('1 unknown')
    expect(summary).toContain('of 3')
  })
})

describe('clock skew does not look like a bug in this script', () => {
  it('an anchor in the future reports zero elapsed, not a negative number', () => {
    const verdict = judgeWindow(anchoredDaysAgo(-3), NOW)
    expect(verdict._tag).toBe('Waiting')
    expect(verdict).toMatchObject({ elapsedDays: 0 })
  })

  it('and its remaining days never exceed the window plus the skew', () => {
    const verdict = judgeWindow(anchoredDaysAgo(-3), NOW)
    expect(verdict).toMatchObject({ remainingDays: 31 })
  })
})

describe('the description says what to do about it', () => {
  it('a stable repository is told it is publishable, with the rule that says so', () => {
    const line = describeVerdict(judgeWindow(anchoredDaysAgo(40), NOW))
    expect(line).toContain('STABLE')
    expect(line).toContain('§6 Step 3')
  })

  it('a waiting repository is told how much longer', () => {
    expect(describeVerdict(judgeWindow(anchoredDaysAgo(10), NOW))).toContain('18 to go')
  })
})
