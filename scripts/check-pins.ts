/**
 * `pnpm check:pins` — verify every cloned repository pins its
 * `@nerima-games/*` siblings to the sibling's exact current version
 * (plan.md §4 item 4, docs/toolchain.md).
 *
 * The comparison lives in `domain/pin-audit.ts` and is unit-tested there
 * against fixtures. This file is the shell: it decides which repositories
 * are on disk, reads their `package.json`, and turns that into the plain
 * observations the domain module audits.
 *
 * Skip policy matches `check:toolchain` and every other cross-repository
 * gate in this repository: an empty `repos/` is the normal state of a fresh
 * clone and prints a reason instead of failing (see
 * `scripts/check-toolchain.ts` for the full argument). A present repository
 * with no or unparsable `package.json` is a genuine failure, not a skip.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { auditPins, type PinFinding, type PinObservation, type PinPackageJson } from '../src/domain/pin-audit'
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

class PinCheckError extends Error {}

type PackageJsonShape = PinPackageJson & { readonly version?: string }

const observationFor = async (name: string): Promise<PinObservation> => {
  const raw = await readFile(path.join(repoDir(name), 'package.json'), 'utf8').catch(() => undefined)
  if (raw === undefined) {
    throw new PinCheckError(`${name}: no package.json — this is a checkout defect, not a skip.`)
  }

  let packageJson: PackageJsonShape
  try {
    packageJson = JSON.parse(raw) as PackageJsonShape
  } catch (cause) {
    throw new PinCheckError(
      `${name}: package.json could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  if (typeof packageJson.version !== 'string') {
    throw new PinCheckError(`${name}: package.json has no string "version" field to pin siblings against.`)
  }

  return { name, version: packageJson.version, packageJson }
}

const describeFinding = (finding: PinFinding): string =>
  `  ${finding.dependency}: pinned "${finding.pinned}", current "${finding.current}"`

export const main = async (): Promise<number> => {
  const present = await presentDirectories()

  if (present.length === 0) {
    print('check:pins: repos/ is empty — nothing to audit.')
    print('This is the normal state of a fresh clone: repos/ is gitignored.')
    print('Run `pnpm sync` to clone the repositories listed in repos.json.')
    return 0
  }

  print(`check:pins: auditing ${String(present.length)} repository/ies' @nerima-games/* pins.`)
  print('')

  const observations = await Promise.all(present.map(observationFor))
  const findings = auditPins(observations)

  const byRepo = new Map<string, Array<PinFinding>>()
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
    `check:pins: ${String(present.length - byRepo.size)} in policy, ${String(byRepo.size)} of ${String(present.length)} out of policy, ${String(findings.length)} finding(s) total.`,
  )

  return findings.length === 0 ? 0 : 1
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.basename(entry) === 'check-pins.ts'
}

if (isDirectRun()) {
  const code = await main().catch((cause: unknown) => {
    printError(`check:pins: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 1
  })
  process.exit(code)
}
