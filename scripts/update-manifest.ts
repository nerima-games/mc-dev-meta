/**
 * `pnpm update:manifest` — pin every present repository to its current HEAD.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * What this is for
 * ---------------------------------------------------------------------------
 *
 * `repos.json` is the lockfile for the composite state of the project (see
 * docs/manifest.md). This is the tool that WRITES it — the counterpart of
 * `pnpm sync`, which reads it.
 *
 * The workflow it supports:
 *
 *   1. work across several repositories, commit in each
 *   2. `pnpm update:manifest`      -> repos.json now names those commits
 *   3. commit repos.json           -> the composite state is now bisectable
 *
 * Without step 2, "the E2E suite passed on Tuesday" names no artefact and
 * cannot be reproduced, because `repos/` is gitignored.
 *
 * ---------------------------------------------------------------------------
 * What it refuses to do
 * ---------------------------------------------------------------------------
 *
 * - It never writes a ref for a repository that is NOT CLONED. Absent means
 *   "no opinion"; the existing entry is left exactly as it was.
 * - It never writes a ref for a DIRTY repository. A dirty tree's HEAD does not
 *   describe what is on disk, so pinning it would record a state nobody can
 *   reproduce — which is worse than leaving it unpinned, because it looks
 *   pinned.
 * - It never touches a working copy. This script only reads git and writes one
 *   JSON file.
 */
import { execFile } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  describeManifestError,
  parseManifest,
  serialiseManifest,
  unpinnedEntries,
  validateAgainstRoster,
  withPinnedRef,
  type Manifest,
} from '../domain/manifest'
import { MANAGED_REPOSITORY_NAMES } from '../domain/repository-roster'
import { isDestructiveGitCommand } from '../domain/sync-plan'
import { MANIFEST_FILENAME, REPOS_DIRECTORY } from '../domain/workspace'

const execFileAsync = promisify(execFile)
const rootDir = process.cwd()
const isDryRun = process.argv.includes('--dry-run')

const readGit = async (argv: ReadonlyArray<string>): Promise<string | undefined> => {
  if (isDestructiveGitCommand(argv)) {
    return undefined
  }
  const result = await execFileAsync('git', [...argv], { cwd: rootDir, encoding: 'utf8' }).catch(
    () => undefined,
  )
  return result?.stdout.trim()
}

type Observation =
  | { readonly _tag: 'Absent' }
  | { readonly _tag: 'Dirty' }
  | { readonly _tag: 'Clean'; readonly head: string }

const observe = async (name: string): Promise<Observation> => {
  const directory = path.join(REPOS_DIRECTORY, name)
  const gitDir = await stat(path.join(rootDir, directory, '.git')).catch(() => undefined)
  if (gitDir === undefined) {
    return { _tag: 'Absent' }
  }

  const status = await readGit(['-C', directory, 'status', '--porcelain'])
  if (status === undefined || status.length > 0) {
    return { _tag: 'Dirty' }
  }

  const head = await readGit(['-C', directory, 'rev-parse', 'HEAD'])
  return head === undefined ? { _tag: 'Dirty' } : { _tag: 'Clean', head }
}

export const main = async (): Promise<number> => {
  const raw = await readFile(path.join(rootDir, MANIFEST_FILENAME), 'utf8').catch(() => undefined)
  if (raw === undefined) {
    console.error(`update:manifest: cannot read ${MANIFEST_FILENAME}.`)
    return 1
  }

  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    console.error(`update:manifest: ${describeManifestError(parsed.error)}`)
    return 1
  }

  const validated = validateAgainstRoster(parsed.value, MANAGED_REPOSITORY_NAMES)
  if (!validated.ok) {
    console.error(`update:manifest: ${describeManifestError(validated.error)}`)
    return 1
  }

  const updated = await validated.value.repositories.reduce<Promise<Manifest>>(
    async (accumulated, entry) => {
      const manifest = await accumulated
      const observation = await observe(entry.name)

      switch (observation._tag) {
        case 'Absent':
          console.log(`  skip     ${entry.name} — not cloned; leaving ref "${entry.ref}" as it is.`)
          return manifest
        case 'Dirty':
          console.log(
            `  SKIP     ${entry.name} — uncommitted changes. HEAD does not describe the working tree, ` +
              'so pinning it would record a state nobody can reproduce.',
          )
          return manifest
        case 'Clean': {
          if (observation.head === entry.ref) {
            console.log(`  ok       ${entry.name} — already pinned at ${entry.ref}.`)
            return manifest
          }
          const next = withPinnedRef(manifest, entry.name, observation.head)
          if (!next.ok) {
            console.error(`  error    ${entry.name} — ${describeManifestError(next.error)}`)
            return manifest
          }
          console.log(`  pin      ${entry.name} @ ${observation.head}`)
          return next.value
        }
      }
    },
    Promise.resolve(validated.value),
  )

  const serialised = serialiseManifest(updated)
  const changed = serialised !== raw

  console.log('')
  if (!changed) {
    console.log(`update:manifest: ${MANIFEST_FILENAME} is already up to date.`)
    return 0
  }

  if (isDryRun) {
    console.log(`update:manifest (--dry-run): ${MANIFEST_FILENAME} would change. Nothing was written.`)
    return 0
  }

  await writeFile(path.join(rootDir, MANIFEST_FILENAME), serialised, 'utf8')
  console.log(`update:manifest: wrote ${MANIFEST_FILENAME}. COMMIT IT — that is what makes the composite state reproducible.`)

  const stillUnpinned = unpinnedEntries(updated)
  if (stillUnpinned.length > 0) {
    console.log(
      `note: ${String(stillUnpinned.length)} repository/ies remain unpinned: ` +
        `${stillUnpinned.map((entry) => entry.name).join(', ')}.`,
    )
  }

  return 0
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.basename(entry) === 'update-manifest.ts'
}

if (isDirectRun()) {
  process.exit(await main())
}
