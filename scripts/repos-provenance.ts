/**
 * What was under `repos/` when a cross-repository gate ran, and whether it was
 * the revision `repos.json` pins.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * Extracted from `scripts/check-mirrors.ts` when `scripts/check-repoint.ts`
 * needed the same answer. It is the impure half only — the git calls and the
 * manifest read. The DECISION about what the answer means (`isOffPin`,
 * `describeProvenance`) was already shared, in `domain/mirror-contract.ts`.
 *
 * Two gates that read the pinned composite must report it identically, and the
 * alternative — a second hand-written copy of a provenance reader — is the
 * exact failure this repository exists to make expensive. `check:mirrors` cost
 * a diagnosis once already by not naming the checkout it had read
 * (docs/manifest.md §5); a second reader that named it slightly differently
 * would cost the next one.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  describeManifestError,
  entryNamed,
  isPinned,
  parseManifest,
  type Manifest,
} from '../domain/manifest'
import type { RepositoryProvenance } from '../domain/mirror-contract'
import { isDestructiveGitCommand } from '../domain/sync-plan'
import { MANIFEST_FILENAME, REPOS_DIRECTORY } from '../domain/workspace'

const execFileAsync = promisify(execFile)

/**
 * Read-only git, sharing the destructive-argument refusal with the sync side.
 *
 * A gate has no business writing to a working copy, and reusing the guard
 * rather than trusting the two commands below is what keeps that true if
 * somebody later reaches for a third.
 */
const readGit = async (
  rootDir: string,
  argv: ReadonlyArray<string>,
): Promise<string | undefined> => {
  if (isDestructiveGitCommand(argv)) {
    return undefined
  }
  const result = await execFileAsync('git', [...argv], { cwd: rootDir, encoding: 'utf8' }).catch(
    () => undefined,
  )
  return result?.stdout.trim()
}

/**
 * What `repos.json` says, or `undefined` if it cannot be read.
 *
 * A missing or unparseable manifest is NOT a failure of the calling gate — a
 * gate compares code, not manifests, and `pnpm check:workspace` already fails
 * on a broken one. It only costs the provenance report its right-hand column,
 * and the report says so rather than pretending everything matched.
 */
export const loadManifest = async (
  rootDir: string,
  label: string,
): Promise<Manifest | undefined> => {
  const raw = await readFile(path.join(rootDir, MANIFEST_FILENAME), 'utf8').catch(() => undefined)
  if (raw === undefined) {
    return undefined
  }
  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    console.error(
      `${label}: could not read pins from ${MANIFEST_FILENAME}: ${describeManifestError(parsed.error)}`,
    )
    return undefined
  }
  return parsed.value
}

/** Each named repository's HEAD, its pin, and whether the working copy is dirty. */
export const provenanceOf = async (
  rootDir: string,
  names: ReadonlyArray<string>,
  manifest: Manifest | undefined,
): Promise<ReadonlyArray<RepositoryProvenance>> =>
  await names.reduce<Promise<ReadonlyArray<RepositoryProvenance>>>(async (accumulated, name) => {
    const previous = await accumulated
    const directory = path.join(REPOS_DIRECTORY, name)
    const head = await readGit(rootDir, ['-C', directory, 'rev-parse', 'HEAD'])
    const status = await readGit(rootDir, ['-C', directory, 'status', '--porcelain'])
    const entry = manifest === undefined ? undefined : entryNamed(manifest, name)

    return [
      ...previous,
      {
        name,
        head,
        pinned: entry !== undefined && isPinned(entry.ref) ? entry.ref : undefined,
        // Unreadable status reads as dirty, the same fail-closed default the
        // sync side uses: "cannot tell" and "no local edits" must not look alike.
        dirty: status === undefined || status.length > 0,
      },
    ]
  }, Promise.resolve([]))
