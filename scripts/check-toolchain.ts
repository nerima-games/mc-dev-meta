/**
 * `pnpm check:toolchain` — audit every cloned repository's toolchain against
 * the org-wide pin table (`domain/toolchain.ts`, plan.md §2.2).
 *
 * The pin table and the decision of what counts as a violation live in
 * `domain/toolchain-audit.ts` and are unit-tested there against fixtures.
 * This file is the shell: it decides which repositories are on disk, reads
 * their `package.json`, `flake.nix` and `vitest.config.ts`, and turns that
 * text into the plain observations the domain module audits.
 *
 * ---------------------------------------------------------------------------
 * Skip policy
 * ---------------------------------------------------------------------------
 *
 * `repos/` is gitignored and EMPTY in a fresh clone. `domain/workspace.ts`
 * settled the precedent this check follows: an absent or partial workspace
 * is not a failure, because otherwise `mc-dev-meta` could not be verified
 * until the 15 repositories it audits already existed and were already
 * clean — exactly backwards for the tool meant to police them. So an empty
 * `repos/` prints the reason and exits 0, same as `check:workspace` and
 * `check:mirrors`.
 *
 * A repository that IS present but has no `package.json` — or one that fails
 * to parse — is a genuine failure, not a skip: a directory under `repos/`
 * that is not a real checkout is a defect in the workspace, not an absence
 * this tool should stay quiet about.
 *
 * `flake.nix` and `vitest.config.ts` are read as best-effort text; an absent
 * file reads as an empty string, which then fails every rule that checks it
 * (every `nixPackages` entry missing, every coverage threshold missing) —
 * itself the correct finding for a repository that has not yet adopted
 * either file.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  auditToolchain,
  type ToolchainFinding,
  type ToolchainObservation,
  type ToolchainPackageJson,
} from '../src/domain/toolchain-audit'
import { REPOS_DIRECTORY } from '../src/domain/workspace'

const rootDir = process.cwd()

/** This is a CLI script; stdout/stderr ARE its output, not debug noise. */
const print = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const printError = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

const repoDir = (name: string): string => path.join(rootDir, REPOS_DIRECTORY, name)

const readTextOrUndefined = async (file: string): Promise<string | undefined> =>
  readFile(file, 'utf8').catch(() => undefined)

const presentDirectories = async (): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(path.join(rootDir, REPOS_DIRECTORY), { withFileTypes: true }).catch(
    () => undefined,
  )
  return entries === undefined
    ? []
    : entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
}

class ToolchainCheckError extends Error {}

const observationFor = async (name: string): Promise<ToolchainObservation> => {
  const packageJsonText = await readTextOrUndefined(path.join(repoDir(name), 'package.json'))
  if (packageJsonText === undefined) {
    throw new ToolchainCheckError(`${name}: no package.json — this is a checkout defect, not a skip.`)
  }

  let packageJson: ToolchainPackageJson
  try {
    packageJson = JSON.parse(packageJsonText) as ToolchainPackageJson
  } catch (cause) {
    throw new ToolchainCheckError(
      `${name}: package.json could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  const flakeNixText = (await readTextOrUndefined(path.join(repoDir(name), 'flake.nix'))) ?? ''
  const vitestConfigText =
    (await readTextOrUndefined(path.join(repoDir(name), 'vitest.config.ts'))) ?? ''

  return { name, packageJson, flakeNixText, vitestConfigText }
}

const describeFinding = (finding: ToolchainFinding): string =>
  `  ${finding.rule}: expected "${finding.expected}", got "${finding.actual}"`

export const main = async (): Promise<number> => {
  const present = await presentDirectories()

  if (present.length === 0) {
    print('check:toolchain: repos/ is empty — nothing to audit.')
    print('This is the normal state of a fresh clone: repos/ is gitignored.')
    print('Run `pnpm sync` to clone the repositories listed in repos.json.')
    return 0
  }

  print(`check:toolchain: auditing ${String(present.length)} repository/ies against the toolchain pin table.`)
  print('')

  const observations = await Promise.all(present.map(observationFor))
  const findings = auditToolchain(observations)

  const byRepo = new Map<string, Array<ToolchainFinding>>()
  for (const finding of findings) {
    const bucket = byRepo.get(finding.repo) ?? []
    bucket.push(finding)
    byRepo.set(finding.repo, bucket)
  }

  for (const name of present) {
    const repoFindings = byRepo.get(name) ?? []
    print(`${repoFindings.length === 0 ? 'ok  ' : 'FAIL'} ${name}${repoFindings.length === 0 ? '' : ` (${String(repoFindings.length)})`}`)
    for (const finding of repoFindings) {
      print(describeFinding(finding))
    }
  }

  print('')
  print(
    `check:toolchain: ${String(present.length - byRepo.size)} in policy, ${String(byRepo.size)} of ${String(present.length)} out of policy, ${String(findings.length)} finding(s) total.`,
  )

  return findings.length === 0 ? 0 : 1
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.basename(entry) === 'check-toolchain.ts'
}

if (isDirectRun()) {
  const code = await main().catch((cause: unknown) => {
    printError(`check:toolchain: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 1
  })
  process.exit(code)
}
