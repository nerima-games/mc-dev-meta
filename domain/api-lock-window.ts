/**
 * The four-week API-lock window: pure decision logic.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * plan.md §6 Step 3 gates publishing on elapsed time:
 *
 *   > 界面が安定した(APIロック4週間無変更)リポジトリから GitHub Packages 等へ
 *   > npm 公開 + changesets 運用に切り替え
 *
 * The lock file itself is enforced by each repository's `pnpm api:check`. What
 * nothing enforced was the *window* — "four weeks unchanged" was a sentence in
 * a plan, and answering it meant someone remembering to run `git log` in
 * fifteen places and doing date arithmetic by hand. A criterion nobody can
 * evaluate is not a criterion.
 *
 * So the anchor is derived, not recorded: it is the commit date of the last
 * change to `api-lock.md` in a repository. That has two properties a
 * hand-maintained date does not. It cannot drift from the thing it describes,
 * and it resets itself — an API change moves the anchor forward with no
 * ceremony, which is exactly what "four weeks unchanged" means.
 *
 * ---------------------------------------------------------------------------
 * Why the clock is an argument
 * ---------------------------------------------------------------------------
 *
 * `now` is passed in. The organisation bans `Date.now()` in shipped source
 * (plan.md §4.3), and this module is the reason the ban is worth having: a
 * function that reads the clock itself can only be tested at the moment its
 * answer happens to be true. With `now` as a parameter the boundary — 27 days
 * versus 28 — is an ordinary test case.
 */

/** Four weeks, in milliseconds. plan.md §6 Step 3. */
export const API_LOCK_WINDOW_MS = 28 * 24 * 60 * 60 * 1000

/** What a repository's lock file was last changed, as far as git knows. */
export type LockAnchor = {
  readonly repository: string
  /**
   * ISO-8601 commit date of the last change to `api-lock.md`, or `undefined`
   * when git could not answer — the repository is absent, or the file has
   * never been committed.
   */
  readonly lastChangedAt: string | undefined
}

export type WindowVerdict =
  /** Four weeks have passed with no change. Publishing is unblocked by *this* criterion. */
  | { readonly _tag: 'Stable'; readonly repository: string; readonly elapsedDays: number }
  /** The window is running. */
  | { readonly _tag: 'Waiting'; readonly repository: string; readonly elapsedDays: number; readonly remainingDays: number }
  /** No anchor. Not a failure: an unfetched repository is the ordinary case here. */
  | { readonly _tag: 'Unknown'; readonly repository: string; readonly reason: string }

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Whole days elapsed, floored — a partial day has not passed. */
const daysBetween = (fromMs: number, toMs: number): number => Math.floor((toMs - fromMs) / MS_PER_DAY)

/**
 * Judge one repository.
 *
 * An anchor in the future yields `Waiting` with zero elapsed rather than a
 * negative number: clock skew between a commit and the machine reading it is
 * real, and reporting "-1 days elapsed" would look like a bug in this script
 * rather than in the clock.
 */
export const judgeWindow = (anchor: LockAnchor, nowMs: number): WindowVerdict => {
  if (anchor.lastChangedAt === undefined) {
    return {
      _tag: 'Unknown',
      repository: anchor.repository,
      reason: 'no committed api-lock.md — the repository may not be cloned yet',
    }
  }

  const anchoredMs = Date.parse(anchor.lastChangedAt)
  if (Number.isNaN(anchoredMs)) {
    return {
      _tag: 'Unknown',
      repository: anchor.repository,
      reason: `unparseable commit date: ${anchor.lastChangedAt}`,
    }
  }

  const elapsedDays = Math.max(0, daysBetween(anchoredMs, nowMs))

  return nowMs - anchoredMs >= API_LOCK_WINDOW_MS
    ? { _tag: 'Stable', repository: anchor.repository, elapsedDays }
    : {
        _tag: 'Waiting',
        repository: anchor.repository,
        elapsedDays,
        remainingDays: Math.max(0, Math.ceil((anchoredMs + API_LOCK_WINDOW_MS - nowMs) / MS_PER_DAY)),
      }
}

/** One line per repository, ordered as given — the roster's build order is meaningful. */
export const describeVerdict = (verdict: WindowVerdict): string => {
  switch (verdict._tag) {
    case 'Stable':
      return `${verdict.repository}: STABLE — ${String(verdict.elapsedDays)} days unchanged (>= 28). Publishable by plan.md §6 Step 3.`
    case 'Waiting':
      return `${verdict.repository}: waiting — ${String(verdict.elapsedDays)} days unchanged, ${String(verdict.remainingDays)} to go.`
    case 'Unknown':
      return `${verdict.repository}: unknown — ${verdict.reason}`
  }
}

/**
 * The summary line.
 *
 * `Unknown` is counted separately and never folded into "not yet stable": an
 * unfetched repository has said nothing about its stability, and reporting
 * silence as a negative answer is how a status board starts lying.
 */
export const summariseWindows = (verdicts: ReadonlyArray<WindowVerdict>): string => {
  const stable = verdicts.filter((v) => v._tag === 'Stable').length
  const waiting = verdicts.filter((v) => v._tag === 'Waiting').length
  const unknown = verdicts.filter((v) => v._tag === 'Unknown').length

  return `api-lock window: ${String(stable)} stable, ${String(waiting)} waiting, ${String(unknown)} unknown (of ${String(verdicts.length)}).`
}
