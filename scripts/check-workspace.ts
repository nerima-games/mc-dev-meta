/**
 * `pnpm check:workspace` — run one pnpm script across every cloned repository.
 *
 * ---------------------------------------------------------------------------
 * The empty workspace must work
 * ---------------------------------------------------------------------------
 *
 * A fresh clone of mc-dev-meta has an EMPTY `repos/` — it is gitignored. This
 * script has to be useful in that state, and `pnpm verify` on this repository
 * has to PASS in that state, because otherwise mc-dev-meta cannot be verified
 * until 15 other repositories exist. That would be exactly backwards: the tool
 * that fetches them would be the last thing to become trustworthy.
 *
 * So: an empty or partial workspace is not a failure. Only a genuine check
 * failure inside a repository that IS present fails the run. The decision of
 * what to run, and the message explaining it, live in `domain/workspace.ts`
 * and are unit-tested there.
 *
 * Usage:
 *   pnpm check:workspace              runs `verify` in every cloned repository
 *   pnpm check:workspace typecheck    runs `typecheck` instead
 */
import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  describeManifestError,
  parseManifest,
  validateAgainstRoster,
  type Manifest,
} from '../src/domain/manifest'
import { MANAGED_REPOSITORY_NAMES } from '../src/domain/repository-roster'
import {
  describeWorkspaceRun,
  MANIFEST_FILENAME,
  planWorkspaceRun,
  REPOS_DIRECTORY,
} from '../src/domain/workspace'

const execFileAsync = promisify(execFile)
const rootDir = process.cwd()

/** This is a CLI script; stdout/stderr ARE its output, not debug noise. */
const print = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const printError = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

/** Positional arguments only; anything starting with `-` is not a script name. */
const requestedScript = process.argv.slice(2).find((argument) => !argument.startsWith('-')) ?? 'verify'

const loadManifest = async (): Promise<Manifest | undefined> => {
  const raw = await readFile(path.join(rootDir, MANIFEST_FILENAME), 'utf8').catch(() => undefined)
  if (raw === undefined) {
    printError(`check:workspace: cannot read ${MANIFEST_FILENAME}.`)
    return undefined
  }

  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    printError(`check:workspace: ${describeManifestError(parsed.error)}`)
    return undefined
  }

  const validated = validateAgainstRoster(parsed.value, MANAGED_REPOSITORY_NAMES)
  if (!validated.ok) {
    printError(`check:workspace: ${describeManifestError(validated.error)}`)
    return undefined
  }

  return validated.value
}

/** Directory names under `repos/`. An absent `repos/` reads as empty, not as an error. */
const presentDirectories = async (): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(path.join(rootDir, REPOS_DIRECTORY), { withFileTypes: true }).catch(
    () => undefined,
  )
  return entries === undefined
    ? []
    : entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

const hasScript = async (directory: string, script: string): Promise<boolean> => {
  const manifestPath = path.join(directory, 'package.json')
  if ((await stat(manifestPath).catch(() => undefined)) === undefined) {
    return false
  }
  const raw = await readFile(manifestPath, 'utf8').catch(() => undefined)
  if (raw === undefined) {
    return false
  }
  try {
    const parsed = JSON.parse(raw) as { readonly scripts?: Readonly<Record<string, string>> }
    return parsed.scripts?.[script] !== undefined
  } catch {
    return false
  }
}

type RunOutcome = {
  readonly name: string
  readonly status: 'passed' | 'failed' | 'no-such-script'
  readonly detail: string
}

const runIn = async (name: string): Promise<RunOutcome> => {
  const directory = path.join(rootDir, REPOS_DIRECTORY, name)

  if (!(await hasScript(directory, requestedScript))) {
    return {
      name,
      status: 'no-such-script',
      detail: `no "${requestedScript}" script in package.json`,
    }
  }

  const result = await execFileAsync('pnpm', ['run', requestedScript], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).catch((cause: unknown) => cause)

  if (result instanceof Error) {
    const stderr = 'stderr' in result && typeof result.stderr === 'string' ? result.stderr : ''
    const stdout = 'stdout' in result && typeof result.stdout === 'string' ? result.stdout : ''
    return { name, status: 'failed', detail: `${stdout}${stderr}`.trim() }
  }

  return { name, status: 'passed', detail: '' }
}

export const main = async (): Promise<number> => {
  const manifest = await loadManifest()
  if (manifest === undefined) {
    return 1
  }

  const plan = planWorkspaceRun(manifest, await presentDirectories())

  for (const line of describeWorkspaceRun(plan, requestedScript)) {
    print(line)
  }

  if (plan.targets.length === 0) {
    return 0
  }

  print('')

  // Sequential: 15 concurrent `pnpm verify` runs would interleave their output
  // and make a single failure impossible to read.
  const outcomes = await plan.targets.reduce<Promise<ReadonlyArray<RunOutcome>>>(
    async (accumulated, entry) => {
      const previous = await accumulated
      const outcome = await runIn(entry.name)
      const symbol = outcome.status === 'passed' ? 'ok  ' : outcome.status === 'failed' ? 'FAIL' : 'skip'
      print(`  ${symbol} ${entry.name}${outcome.status === 'passed' ? '' : ` — ${outcome.detail.split('\n')[0] ?? ''}`}`)
      return [...previous, outcome]
    },
    Promise.resolve([]),
  )

  const failed = outcomes.filter((outcome) => outcome.status === 'failed')

  print('')
  print(
    `check:workspace: ${String(outcomes.filter((outcome) => outcome.status === 'passed').length)} passed, ` +
      `${String(failed.length)} failed, ` +
      `${String(outcomes.filter((outcome) => outcome.status === 'no-such-script').length)} skipped.`,
  )

  if (failed.length > 0) {
    for (const outcome of failed) {
      printError('')
      printError(`----- ${outcome.name} (${requestedScript}) -----`)
      printError(outcome.detail)
    }
    return 1
  }

  return 0
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.basename(entry) === 'check-workspace.ts'
}

if (isDirectRun()) {
  process.exit(await main())
}
