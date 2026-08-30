/**
 * `pnpm sync` — clone or update the 15 managed repositories under `repos/`.
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
 * Running this twice in a row does nothing the second time, for every PINNED
 * entry: the second run reports `unchanged` and issues no git command at all.
 *
 * An UNPINNED entry is the one honest exception, and it is bounded: it fetches
 * ONCE per run and never touches the working tree. It cannot do less — there is
 * no pinned ref to compare HEAD against, so "up to date" is not a question that
 * can be answered without asking the remote — and it must not do more. It used
 * to do more: `planSync` answered `Fetch` to a state it had just fetched, and
 * the loop below obliged three times over, which made an out-of-the-box
 * `pnpm sync` (15 unpinned entries) 45 network round-trips. See
 * `WorkingCopyState.fetchedThisRun` in `domain/sync-plan.ts`.
 *
 * Neither property is asserted here — both are asserted in
 * `test/sync-plan.test.ts` against `applyAction`, which models what this script
 * does. If the two ever diverge, THIS FILE is what is wrong.
 *
 * ---------------------------------------------------------------------------
 * `--latest`, and the deadlock it exists to break
 * ---------------------------------------------------------------------------
 *
 * Without it, this script and `pnpm update:manifest` form a closed loop: sync
 * writes `repos/ <- pin`, update:manifest writes `pin <- repos/ HEAD`, and the
 * pin can therefore only ever move if somebody commits INSIDE `repos/` — which
 * is gitignored and which this design tells people not to treat as a working
 * copy. Six repositories were pushed to; both commands reported success; the
 * pin did not move; `pnpm check:mirrors`, which reads `repos/`, spent a
 * diagnosis reporting drift against a snapshot that could not advance.
 *
 * `--latest` fetches and advances each working copy to `origin`'s tip. Both
 * refusals survive it intact, and one is added:
 *
 *   - DIRTY is skipped, as always.
 *   - DIVERGED is skipped: if HEAD is not reachable from the tip, moving would
 *     strand a commit that exists in this clone and nowhere else, because sync
 *     leaves working copies detached. See `SkipDiverged` in domain/sync-plan.ts.
 *
 * `--latest` never advances the PIN. That is `pnpm update:manifest`, still, and
 * deliberately: the two halves stay separable so that "move my disk" and
 * "record it in a commit" remain two reviewable decisions.
 *
 * Usage:
 *   pnpm sync              clone/fetch/checkout per repos.json
 *   pnpm sync:dry          print the plan, touch nothing
 *   pnpm sync:latest       fetch, then fast-forward each copy to origin's tip
 *   pnpm sync:latest:dry   print that plan, touch nothing
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
} from '../src/domain/manifest'
import { MANAGED_REPOSITORY_NAMES } from '../src/domain/repository-roster'
import {
  describeAction,
  fetchesFromRemote,
  gitCommandsFor,
  isDestructiveGitCommand,
  isNoOp,
  planSync,
  summarise,
  type RemoteObservation,
  type SyncAction,
  type SyncMode,
  type WorkingCopyState,
} from '../src/domain/sync-plan'
import { MANIFEST_FILENAME, REPOS_DIRECTORY } from '../src/domain/workspace'

const execFileAsync = promisify(execFile)

const rootDir = process.cwd()

/** This is a CLI script; stdout/stderr ARE its output, not debug noise. */
const print = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const printError = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

const isDryRun = process.argv.includes('--dry-run')

/**
 * `--latest` rather than `--update` or `--remote`.
 *
 * `--update` is what somebody would reasonably expect to update `repos.json`,
 * which this command must not do. `--remote` names a place rather than an
 * outcome, and this tool already talks to the remote in the default mode — the
 * new thing is not the network, it is WHICH REVISION wins. `--latest` says that
 * in one word, and it says nothing that could be read as "force" or "discard",
 * which is the register the rest of this script is written in.
 */
const mode: SyncMode = process.argv.includes('--latest') ? 'latest' : 'pinned'

/**
 * At most two rounds of work are ever needed — fetch (or clone), then checkout
 * — plus the round that observes there is nothing left. That is three, and the
 * guard is one above it.
 *
 * It is a guard against a bug in `domain/sync-plan.ts`, NOT the thing that
 * terminates the loop. Every entry, in either mode, reaches a no-op on its own,
 * which is what `test/sync-plan.test.ts` asserts over every entry x every state
 * x both modes. If this limit is ever what stops a repository, the planner is
 * wrong.
 *
 * It is 4 rather than 3 because `--latest` on an ABSENT repository uses all
 * three: clone (which lands on the manifest's pin), advance to the tip, observe.
 * A guard set exactly at the worst legitimate case cannot tell "converged" from
 * "gave up" — the loop would simply stop, having left the working copy at the
 * pin, and report the last action as though it were the settled one. Silence is
 * the failure mode this whole change exists to remove; the spare round costs a
 * `git status` on the rare path and buys a loop that visibly does not need it.
 */
const MAX_ROUNDS = 4

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

/**
 * Read `origin`'s default-branch tip and ask whether HEAD can fast-forward to it.
 *
 * `refs/remotes/origin/HEAD` is a purely LOCAL read — it resolves in a clone
 * nobody has fetched for a month, and would happily report a month-old tip.
 * That is why the caller only reaches this after a fetch or a clone in this
 * run; see `RemoteObservation` in domain/sync-plan.ts.
 *
 * Everything here fails closed. `merge-base --is-ancestor` exits non-zero both
 * for "not an ancestor" and for "could not be determined", and `runGit` cannot
 * tell those apart — so both become `headIsAncestorOfTip: false`, which makes
 * the repository a `SkipDiverged` rather than a checkout. The alternative
 * default would move a working copy on the strength of a command that failed.
 */
const observeRemote = async (
  directory: string,
  head: string,
): Promise<RemoteObservation | undefined> => {
  const tip = await runGit(['-C', directory, 'rev-parse', '--verify', 'refs/remotes/origin/HEAD'])
  if (!tip.ok) {
    return undefined
  }

  const resolved = tip.stdout.trim()
  return {
    tip: resolved,
    headIsAncestorOfTip: (
      await runGit(['-C', directory, 'merge-base', '--is-ancestor', head, resolved])
    ).ok,
  }
}

/**
 * Observe one working copy. Read-only: nothing here writes.
 *
 * `fetchedThisRun` is passed in rather than discovered, because it is not a
 * property of the working copy — nothing on disk records that this process
 * fetched this repository a moment ago. The caller is the only thing that
 * knows, and the loop below is the only scope in which the answer is useful.
 * `remote` is gated on it for the same reason, and it is not the same reason:
 * `fetchedThisRun` exists to stop an unpinned entry being fetched twice, while
 * the gate on `remote` exists to stop `--latest` advancing to a stale tip.
 */
const observe = async (
  entry: ManifestEntry,
  fetchedThisRun: boolean,
): Promise<WorkingCopyState> => {
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
    return {
      _tag: 'Present',
      head: '',
      dirty: true,
      hasPinnedRef: false,
      fetchedThisRun,
      remote: undefined,
    }
  }

  const hasPinnedRef = isPinned(entry.ref)
    ? (await runGit(['-C', directory, 'cat-file', '-e', `${entry.ref}^{commit}`])).ok
    : false

  const resolvedHead = head.stdout.trim()

  return {
    _tag: 'Present',
    head: resolvedHead,
    dirty: status.stdout.trim().length > 0,
    hasPinnedRef,
    fetchedThisRun,
    remote:
      mode === 'latest' && fetchedThisRun
        ? await observeRemote(directory, resolvedHead)
        : undefined,
  }
}

type RepositoryOutcome = {
  readonly name: string
  readonly actions: ReadonlyArray<SyncAction>
  readonly failure: string | undefined
}

/**
 * One round of settling: plan, apply, observe, repeat.
 *
 * Recursive rather than a `for` loop on purpose — each round's git commands
 * and each round's `observe` depend on the PREVIOUS round's outcome, so the
 * awaits below cannot be batched into `Promise.all`. Recursion says that in
 * the shape of the code instead of only in a comment: there is no loop
 * construct left for a well-meaning edit to "parallelize".
 */
const syncRound = async (
  entry: ManifestEntry,
  directory: string,
  state: WorkingCopyState,
  actions: Array<SyncAction>,
  round: number,
): Promise<RepositoryOutcome> => {
  if (round >= MAX_ROUNDS) {
    return { name: entry.name, actions, failure: undefined }
  }

  const action = planSync(entry, state, mode)
  actions.push(action)
  print(`  ${describeAction(action)}`)

  if (isNoOp(action) || isDryRun) {
    return { name: entry.name, actions, failure: undefined }
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

  // Every action in `actions` has now run without failing — a failure returns
  // above — so "has this run talked to the remote yet" is exactly a question
  // about the actions taken so far.
  const nextState = await observe(entry, actions.some(fetchesFromRemote))
  return syncRound(entry, directory, nextState, actions, round + 1)
}

const syncOne = async (entry: ManifestEntry): Promise<RepositoryOutcome> => {
  const directory = path.join(REPOS_DIRECTORY, entry.name)
  const state = await observe(entry, false)
  return syncRound(entry, directory, state, [], 0)
}

const loadManifest = async (): Promise<Manifest | undefined> => {
  const raw = await readFile(path.join(rootDir, MANIFEST_FILENAME), 'utf8').catch(() => undefined)
  if (raw === undefined) {
    printError(`sync: cannot read ${MANIFEST_FILENAME}. It is committed; are you in the repository root?`)
    return undefined
  }

  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    printError(`sync: ${describeManifestError(parsed.error)}`)
    return undefined
  }

  const validated = validateAgainstRoster(parsed.value, MANAGED_REPOSITORY_NAMES)
  if (!validated.ok) {
    printError(`sync: ${describeManifestError(validated.error)}`)
    return undefined
  }

  return validated.value
}

export const main = async (): Promise<number> => {
  const manifest = await loadManifest()
  if (manifest === undefined) {
    return 1
  }

  const target =
    mode === 'latest'
      ? "origin's tip (--latest: repos.json is READ for the clone URLs only, and is NOT updated)"
      : 'the revisions pinned in repos.json'

  print(
    isDryRun
      ? `sync (--dry-run): planning ${String(manifest.repositories.length)} repositories into ${REPOS_DIRECTORY}/ against ${target} — NOTHING will be modified.`
      : `sync: ${String(manifest.repositories.length)} repositories into ${REPOS_DIRECTORY}/, at ${target}.`,
  )
  print('')

  // Sequential rather than parallel: this talks to a remote 15 times, and
  // interleaved progress output from 15 clones is unreadable when one of them
  // fails. It is also gentler on whatever is rate-limiting the other end.
  const outcomes = await manifest.repositories.reduce<Promise<ReadonlyArray<RepositoryOutcome>>>(
    async (accumulated, entry) => {
      const previous = await accumulated
      print(entry.name)
      return [...previous, await syncOne(entry)]
    },
    Promise.resolve([]),
  )

  const summary = summarise(outcomes.flatMap((outcome) => [...outcome.actions]))
  const failures = outcomes.filter((outcome) => outcome.failure !== undefined)

  print('')
  print(
    `sync: cloned ${String(summary.cloned.length)}, ` +
      `fetched ${String(summary.fetched.length)}, ` +
      `checked out ${String(summary.checkedOut.length)}, ` +
      `unchanged ${String(summary.unchanged.length)}, ` +
      `skipped (dirty) ${String(summary.skippedDirty.length)}, ` +
      `skipped (diverged) ${String(summary.skippedDiverged.length)}.`,
  )

  if (summary.skippedDirty.length > 0) {
    print('')
    print(`NOT synced because they have uncommitted changes: ${summary.skippedDirty.join(', ')}.`)
    print('Nothing in them was touched. Commit or stash, then re-run `pnpm sync`.')
  }

  if (summary.skippedDiverged.length > 0) {
    print('')
    print(
      `NOT advanced because their HEAD is not reachable from origin's tip: ${summary.skippedDiverged.join(', ')}.`,
    )
    print(
      'Nothing in them was touched. These working copies are detached, so a commit made in one is ' +
        'reachable from HEAD and nothing else; moving HEAD would leave it in the reflog and nowhere ' +
        'a person would look. Push it, or check out the tip yourself if you meant to abandon it.',
    )
  }

  // The default mode cannot make the pin move — that is the deadlock this
  // flag exists to break — so the reminder belongs on the run that CAN.
  if (mode === 'latest' && !isDryRun && summary.checkedOut.length > 0) {
    print('')
    print(
      `${String(summary.checkedOut.length)} working copy/ies now sit AHEAD of repos.json. Until you run ` +
        '`pnpm update:manifest` and commit the result, the composite state on this machine is not ' +
        'recorded anywhere and `pnpm check:mirrors` is comparing revisions the manifest does not name.',
    )
  }

  if (failures.length > 0) {
    printError('')
    printError(`sync: ${String(failures.length)} repository/ies failed:`)
    for (const failure of failures) {
      printError(`  ${failure.name}: ${failure.failure ?? 'unknown error'}`)
    }
    printError('')
    printError(
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
