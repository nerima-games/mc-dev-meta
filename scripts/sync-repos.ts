/**
 * `pnpm sync` — clone or update the 15 managed repositories under `repos/`.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 * ---------------------------------------------------------------------------
 *
 *   THIS SCRIPT MUST NEVER DESTROY LOCAL WORK.
 *
 * It is enforced three times over:
 *
 * 1. The action set in `domain/sync-plan.ts` contains no action meaning
 *    "discard". There is nothing to call.
 * 2. `gitCommandsFor` is a pure function, and `test/sync-plan.test.ts`
 *    enumerates every observable state and asserts that no reachable command
 *    contains `reset`, `clean`, `--hard`, `--force`, ... .
 * 3. `runGit` below refuses, at runtime, to execute any command that contains
 *    one of those arguments — even one this script did not generate.
 *
 * A repository with uncommitted changes is SKIPPED, loudly, and the run
 * continues. Having local work is normal; being told about it is not optional.
 *
 * ---------------------------------------------------------------------------
 * Idempotence
 * ---------------------------------------------------------------------------
 *
 * Running this twice in a row does nothing the second time. That property is
 * not asserted here — it is asserted in `test/sync-plan.test.ts` against
 * `applyAction`, which models what this script does. If the two ever diverge,
 * THIS FILE is what is wrong.
 *
 * Usage:
 *   pnpm sync              clone/fetch/checkout per repos.json
 *   pnpm sync:dry          print the plan, touch nothing
 */
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  describeManifestError,
  isPinned,
  parseManifest,
  validateAgainstRoster,
  type Manifest,
  type ManifestEntry,
} from '../domain/manifest'
import { MANAGED_REPOSITORY_NAMES } from '../domain/repository-roster'
import {
  describeAction,
  gitCommandsFor,
  isDestructiveGitCommand,
  isNoOp,
  planSync,
  summarise,
  type SyncAction,
  type WorkingCopyState,
} from '../domain/sync-plan'
import { MANIFEST_FILENAME, REPOS_DIRECTORY } from '../domain/workspace'

const execFileAsync = promisify(execFile)

const rootDir = process.cwd()

const isDryRun = process.argv.includes('--dry-run')

/** At most two rounds are ever needed (fetch, then checkout); 3 is the loop guard. */
const MAX_ROUNDS = 3

type GitResult = { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly detail: string }

/**
 * Run one git command.
 *
 * The destructive-argument check is the last line of defence and is
 * deliberately unconditional: it applies to commands this script generates and
 * to any that a future edit might add.
 */
const runGit = async (argv: ReadonlyArray<string>): Promise<GitResult> => {
  if (isDestructiveGitCommand(argv)) {
    return {
      ok: false,
      detail:
        `refusing to run "git ${argv.join(' ')}": it contains an argument that can destroy uncommitted work. ` +
        'This tool never discards local changes. See domain/sync-plan.ts DESTRUCTIVE_GIT_ARGUMENTS.',
    }
  }

  try {
    const { stdout } = await execFileAsync('git', [...argv], { cwd: rootDir, encoding: 'utf8' })
    return { ok: true, stdout }
  } catch (cause) {
    const detail =
      cause instanceof Error && 'stderr' in cause && typeof cause.stderr === 'string' && cause.stderr.length > 0
        ? cause.stderr.trim()
        : cause instanceof Error
          ? cause.message
          : String(cause)
    return { ok: false, detail }
  }
}

const directoryExists = async (at: string): Promise<boolean> => {
  const info = await stat(at).catch(() => undefined)
  return info?.isDirectory() === true
}

/** Observe one working copy. Read-only: nothing here writes. */
const observe = async (entry: ManifestEntry): Promise<WorkingCopyState> => {
  const directory = path.join(REPOS_DIRECTORY, entry.name)

  if (!(await directoryExists(path.join(rootDir, directory, '.git')))) {
    return { _tag: 'Absent' }
  }

  const status = await runGit(['-C', directory, 'status', '--porcelain'])
  const head = await runGit(['-C', directory, 'rev-parse', 'HEAD'])

  // A repository whose status cannot be read is treated as DIRTY. Failing
  // closed is the only safe default for a check whose whole job is to protect
  // uncommitted work.
  if (!status.ok || !head.ok) {
    return { _tag: 'Present', head: '', dirty: true, hasPinnedRef: false }
  }

  const hasPinnedRef = isPinned(entry.ref)
    ? (await runGit(['-C', directory, 'cat-file', '-e', `${entry.ref}^{commit}`])).ok
    : false

  return {
    _tag: 'Present',
    head: head.stdout.trim(),
    dirty: status.stdout.trim().length > 0,
    hasPinnedRef,
  }
}

type RepositoryOutcome = {
  readonly name: string
  readonly actions: ReadonlyArray<SyncAction>
  readonly failure: string | undefined
}

const syncOne = async (entry: ManifestEntry): Promise<RepositoryOutcome> => {
  const directory = path.join(REPOS_DIRECTORY, entry.name)
  const actions: Array<SyncAction> = []
  let state = await observe(entry)

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const action = planSync(entry, state)
    actions.push(action)
    console.log(`  ${describeAction(action)}`)

    if (isNoOp(action) || isDryRun) {
      break
    }

    const commands = gitCommandsFor(action, directory)
    const results = await commands.reduce<Promise<ReadonlyArray<GitResult>>>(
      async (accumulated, argv) => [...(await accumulated), await runGit(argv)],
      Promise.resolve([]),
    )

    const firstFailure = results.find((result) => !result.ok)
    if (firstFailure !== undefined && !firstFailure.ok) {
      return { name: entry.name, actions, failure: firstFailure.detail }
    }

    state = await observe(entry)
  }

  return { name: entry.name, actions, failure: undefined }
}

const loadManifest = async (): Promise<Manifest | undefined> => {
  const raw = await readFile(path.join(rootDir, MANIFEST_FILENAME), 'utf8').catch(() => undefined)
  if (raw === undefined) {
    console.error(`sync: cannot read ${MANIFEST_FILENAME}. It is committed; are you in the repository root?`)
    return undefined
  }

  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    console.error(`sync: ${describeManifestError(parsed.error)}`)
    return undefined
  }

  const validated = validateAgainstRoster(parsed.value, MANAGED_REPOSITORY_NAMES)
  if (!validated.ok) {
    console.error(`sync: ${describeManifestError(validated.error)}`)
    return undefined
  }

  return validated.value
}

export const main = async (): Promise<number> => {
  const manifest = await loadManifest()
  if (manifest === undefined) {
    return 1
  }

  console.log(
    isDryRun
      ? `sync (--dry-run): planning ${String(manifest.repositories.length)} repositories into ${REPOS_DIRECTORY}/ — NOTHING will be modified.`
      : `sync: ${String(manifest.repositories.length)} repositories into ${REPOS_DIRECTORY}/`,
  )
  console.log('')

  // Sequential rather than parallel: this talks to a remote 15 times, and
  // interleaved progress output from 15 clones is unreadable when one of them
  // fails. It is also gentler on whatever is rate-limiting the other end.
  const outcomes = await manifest.repositories.reduce<Promise<ReadonlyArray<RepositoryOutcome>>>(
    async (accumulated, entry) => {
      const previous = await accumulated
      console.log(entry.name)
      return [...previous, await syncOne(entry)]
    },
    Promise.resolve([]),
  )

  const summary = summarise(outcomes.flatMap((outcome) => [...outcome.actions]))
  const failures = outcomes.filter((outcome) => outcome.failure !== undefined)

  console.log('')
  console.log(
    `sync: cloned ${String(summary.cloned.length)}, ` +
      `fetched ${String(summary.fetched.length)}, ` +
      `checked out ${String(summary.checkedOut.length)}, ` +
      `unchanged ${String(summary.unchanged.length)}, ` +
      `skipped (dirty) ${String(summary.skippedDirty.length)}.`,
  )

  if (summary.skippedDirty.length > 0) {
    console.log('')
    console.log(`NOT synced because they have uncommitted changes: ${summary.skippedDirty.join(', ')}.`)
    console.log('Nothing in them was touched. Commit or stash, then re-run `pnpm sync`.')
  }

  if (failures.length > 0) {
    console.error('')
    console.error(`sync: ${String(failures.length)} repository/ies failed:`)
    for (const failure of failures) {
      console.error(`  ${failure.name}: ${failure.failure ?? 'unknown error'}`)
    }
    console.error('')
    console.error(
      'A repository that does not exist on the remote yet is an expected failure while the project ' +
        'is being built bottom-up (plan.md §6 Step 2). Everything else was synced.',
    )
    return 1
  }

  return 0
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.basename(entry) === 'sync-repos.ts'
}

if (isDirectRun()) {
  process.exit(await main())
}
