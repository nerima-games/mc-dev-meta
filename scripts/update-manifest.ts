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
 * `--latest`, and the half of the deadlock that lived here
 * ---------------------------------------------------------------------------
 *
 * The default mode pins to `repos/<name>` HEAD. `pnpm sync` puts `repos/<name>`
 * AT the pin. Between them there was no way for the pin to advance at all: the
 * only revision either command could name was one the other had just written.
 * Work pushed to six repositories was invisible to both, and this script's
 * cheerful "repos.json is already up to date." was the second half of that
 * silence — it means "nothing on disk differs from the pin", which people read,
 * reasonably, as "the pin is current". Those are not the same claim and the
 * message now says which one it is making.
 *
 * `--latest` fetches and pins to `origin`'s tip. It gives this half of the pair
 * a source of truth that does not come from the other half. Either order works
 * and both end in the same place:
 *
 *   disk first: `pnpm sync --latest` then `pnpm update:manifest`
 *   pin first:  `pnpm update:manifest --latest` then `pnpm sync`
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
 * - `--latest` never pins a tip that HEAD cannot fast-forward to. Writing a pin
 *   destroys nothing by itself; it is the NEXT `pnpm sync` that acts on it, and
 *   sync leaves working copies detached. Pinning past a local commit is
 *   therefore a way of arranging for a later command to strand it, which is
 *   worse than doing it directly because nobody is watching by then.
 * - It never touches a working copy. This script reads git — including, under
 *   `--latest`, a `git fetch`, which writes only remote-tracking refs — and
 *   writes one JSON file.
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
import {
  describePinDecision,
  planPin,
  summarisePins,
  type PinDecision,
  type PinObservation,
} from '../domain/pin-plan'
import { MANAGED_REPOSITORY_NAMES } from '../domain/repository-roster'
import { isDestructiveGitCommand, type RemoteObservation, type SyncMode } from '../domain/sync-plan'
import { MANIFEST_FILENAME, REPOS_DIRECTORY } from '../domain/workspace'

const execFileAsync = promisify(execFile)
const rootDir = process.cwd()
const isDryRun = process.argv.includes('--dry-run')

/** Same flag, same word, same meaning as `pnpm sync --latest`. */
const mode: SyncMode = process.argv.includes('--latest') ? 'latest' : 'pinned'

const readGit = async (argv: ReadonlyArray<string>): Promise<string | undefined> => {
  if (isDestructiveGitCommand(argv)) {
    return undefined
  }
  const result = await execFileAsync('git', [...argv], { cwd: rootDir, encoding: 'utf8' }).catch(
    () => undefined,
  )
  return result?.stdout.trim()
}

/**
 * Ask `origin` where its default branch is, and whether HEAD can reach it.
 *
 * The fetch is unavoidable and it is the whole point: `refs/remotes/origin/HEAD`
 * without it is a local cache that can be arbitrarily old, and pinning to a
 * stale cache is the deadlock wearing a different hat.
 *
 * `merge-base --is-ancestor` is read as a pure exit code, and a command that
 * could not be run at all reads as `false` — fail closed, exactly as in
 * `scripts/sync-repos.ts`, because the unsafe direction here is claiming a
 * fast-forward that is not one.
 */
const observeRemote = async (
  directory: string,
  head: string,
): Promise<RemoteObservation | undefined> => {
  if ((await readGit(['-C', directory, 'fetch', '--prune', '--tags', 'origin'])) === undefined) {
    return undefined
  }

  const tip = await readGit(['-C', directory, 'rev-parse', '--verify', 'refs/remotes/origin/HEAD'])
  if (tip === undefined) {
    return undefined
  }

  return {
    tip,
    headIsAncestorOfTip:
      (await readGit(['-C', directory, 'merge-base', '--is-ancestor', head, tip])) !== undefined,
  }
}

const observe = async (name: string): Promise<PinObservation> => {
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
  if (head === undefined) {
    return { _tag: 'Dirty' }
  }

  return {
    _tag: 'Clean',
    head,
    remote: mode === 'latest' ? await observeRemote(directory, head) : undefined,
  }
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

  console.log(
    mode === 'latest'
      ? `update:manifest (--latest): fetching, then pinning to each origin's tip. repos/ is NOT moved — run \`pnpm sync\` for that.`
      : `update:manifest: pinning to the HEAD of each working copy under ${REPOS_DIRECTORY}/.`,
  )
  console.log('')

  const outcome = await validated.value.repositories.reduce<
    Promise<{ readonly manifest: Manifest; readonly decisions: ReadonlyArray<PinDecision> }>
  >(
    async (accumulated, entry) => {
      const { manifest, decisions } = await accumulated
      const decision = planPin(entry, await observe(entry.name), mode)
      console.log(describePinDecision(decision))

      if (decision._tag !== 'Pin') {
        return { manifest, decisions: [...decisions, decision] }
      }

      const next = withPinnedRef(manifest, entry.name, decision.ref)
      if (!next.ok) {
        console.error(`  error    ${entry.name} — ${describeManifestError(next.error)}`)
        return { manifest, decisions }
      }
      return { manifest: next.value, decisions: [...decisions, decision] }
    },
    Promise.resolve({ manifest: validated.value, decisions: [] }),
  )

  const updated = outcome.manifest
  const summary = summarisePins(outcome.decisions)
  const serialised = serialiseManifest(updated)
  const changed = serialised !== raw

  console.log('')

  // Every skip that could hide a newer revision is named here, whatever else
  // happened. The old code reported skips inline and then printed a one-line
  // conclusion that did not mention them, so a run that pinned nothing BECAUSE
  // fifteen repositories were dirty looked exactly like a run that pinned
  // nothing because there was nothing to pin.
  for (const [names, why] of [
    [summary.skippedDirty, 'have uncommitted changes'],
    [summary.skippedDiverged, "have a HEAD that origin's tip cannot reach"],
    [summary.skippedRemoteUnknown, "could not be asked where origin's tip is"],
  ] as ReadonlyArray<readonly [ReadonlyArray<string>, string]>) {
    if (names.length > 0) {
      console.log(`NOT pinned because they ${why}: ${names.join(', ')}.`)
    }
  }

  if (!changed) {
    console.log(
      mode === 'latest'
        ? `update:manifest (--latest): ${MANIFEST_FILENAME} already names every origin's tip. This one DID ask the remotes.`
        : `update:manifest: ${MANIFEST_FILENAME} already matches every working copy under ${REPOS_DIRECTORY}/.`,
    )
    // The distinction the old message elided, and the reason it cost a
    // diagnosis: "matches what is on disk" is not "is current". `pnpm sync`
    // puts repos/ AT the pin, so the two agreeing is the NORMAL state and says
    // nothing at all about GitHub. Only --latest can answer that question.
    if (mode !== 'latest') {
      console.log(
        'That is not the same as "the pins are current" — no remote was contacted. `pnpm sync` puts ' +
          `${REPOS_DIRECTORY}/ at the pin, so agreement here is the expected state even when every ` +
          'repository has moved on GitHub. Run `pnpm update:manifest --latest` to ask.',
      )
    }
    return 0
  }

  if (isDryRun) {
    console.log(`update:manifest (--dry-run): ${MANIFEST_FILENAME} would change. Nothing was written.`)
    return 0
  }

  await writeFile(path.join(rootDir, MANIFEST_FILENAME), serialised, 'utf8')
  console.log(`update:manifest: wrote ${MANIFEST_FILENAME}. COMMIT IT — that is what makes the composite state reproducible.`)

  if (mode === 'latest' && summary.pinned.length > 0) {
    console.log(
      `${String(summary.pinned.length)} pin(s) now name a revision that ${REPOS_DIRECTORY}/ does not hold. ` +
        'Run `pnpm sync` to bring the working copies onto them, or `pnpm check:mirrors` will keep ' +
        'comparing the revisions you had before.',
    )
  }

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
