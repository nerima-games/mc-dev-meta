/**
 * `pnpm check:api-window` — how long has each repository's public API held still?
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * What this answers
 * ---------------------------------------------------------------------------
 *
 * plan.md §6 Step 3 gates publishing on four weeks of an unchanged API. Each
 * repository's own `pnpm api:check` enforces that `api-lock.md` matches the
 * code; nothing enforced the *window*, so "four weeks unchanged" meant running
 * `git log` in fifteen places and doing date arithmetic by hand. This reports
 * it in one command.
 *
 * The anchor is derived rather than recorded: `git log -1 -- api-lock.md`. It
 * cannot drift from the thing it describes, and an API change resets it with
 * no ceremony, which is what the criterion actually means.
 *
 * All judgement lives in `domain/api-lock-window.ts` and is unit-tested there.
 * This file reads git and prints.
 *
 * ---------------------------------------------------------------------------
 * This does not gate anything
 * ---------------------------------------------------------------------------
 *
 * It always exits 0 unless it cannot run at all. Publishing is a deliberate
 * act, not something a clock should trigger, and a script that failed CI
 * because a repository was three days short would be enforcing a schedule
 * rather than reporting one. It is also NOT in `pnpm verify` for that reason:
 * `verify` answers "is this correct", and this answers "how old is it".
 *
 * Usage:
 *   pnpm check:api-window
 */
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  describeVerdict,
  judgeWindow,
  summariseWindows,
  type LockAnchor,
  type WindowVerdict,
} from '../domain/api-lock-window'
import { MANAGED_REPOSITORY_NAMES } from '../domain/repository-roster'
import { REPOS_DIRECTORY } from '../domain/workspace'

const execFileAsync = promisify(execFile)
const rootDir = process.cwd()

/** Directory names under `repos/`. An absent `repos/` reads as empty, not as an error. */
const presentDirectories = async (): Promise<ReadonlySet<string>> => {
  const entries = await readdir(path.join(rootDir, REPOS_DIRECTORY), { withFileTypes: true }).catch(
    () => undefined,
  )
  return new Set(
    entries === undefined ? [] : entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  )
}

/**
 * The commit date of the last change to `api-lock.md`, or `undefined`.
 *
 * `--` separates the pathspec from anything that could be read as a revision,
 * and argv is an array, so no value here reaches a shell. Any git failure —
 * not a repository, no such file, no commits — is `undefined` rather than a
 * throw: this command reports on whatever is present and says so about the
 * rest.
 */
const anchorFor = async (repository: string): Promise<LockAnchor> => {
  const directory = path.join(rootDir, REPOS_DIRECTORY, repository)
  const result = await execFileAsync(
    'git',
    ['-C', directory, 'log', '-1', '--format=%cI', '--', 'api-lock.md'],
    { encoding: 'utf8' },
  ).catch(() => undefined)

  const stdout = result?.stdout.trim()
  return { repository, lastChangedAt: stdout === undefined || stdout === '' ? undefined : stdout }
}

const main = async (): Promise<number> => {
  const present = await presentDirectories()

  // This command's whole subject is elapsed wall time. The ban exists so that
  // simulation and tests cannot read a clock; reading one here, at the
  // outermost edge, and passing it into pure logic is the shape the ban is
  // asking for rather than an exception to it — `judgeWindow` takes `now` as a
  // parameter, which is what makes the 27-versus-28-day boundary testable.
  const nowMs = Date.now() // mc-kernel-allow-time-source

  const verdicts: Array<WindowVerdict> = []
  for (const repository of MANAGED_REPOSITORY_NAMES) {
    const anchor = present.has(repository)
      ? await anchorFor(repository)
      : { repository, lastChangedAt: undefined }
    verdicts.push(judgeWindow(anchor, nowMs))
  }

  for (const verdict of verdicts) {
    console.log(`  ${describeVerdict(verdict)}`)
  }
  console.log('')
  console.log(summariseWindows(verdicts))

  if (verdicts.every((verdict) => verdict._tag === 'Unknown')) {
    console.log('')
    console.log('Nothing to measure yet. Run `pnpm sync` to populate repos/.')
  }

  return 0
}

process.exit(await main())
