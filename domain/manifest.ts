/**
 * The repository manifest: parsing and validation. PURE — no filesystem, no
 * git, no network.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * Why a committed manifest exists at all
 * ---------------------------------------------------------------------------
 *
 * `repos/` is gitignored. That is correct — vendoring 15 repositories into a
 * 16th would defeat the split — but it has a consequence that is easy to miss:
 *
 *   WITHOUT A MANIFEST, THE COMPOSITE STATE OF THE PROJECT IS NOT UNDER
 *   VERSION CONTROL AT ALL.
 *
 * "It worked yesterday" would then be unanswerable. There would be no artefact
 * saying which 15 commits were checked out when the E2E suite last passed, so a
 * regression that appears only in combination could not be bisected — the thing
 * you would need to bisect does not exist anywhere.
 *
 * `repos.json` is that artefact. It is a lockfile for the composite, and it is
 * committed for exactly the reasons a lockfile is committed.
 *
 * ---------------------------------------------------------------------------
 * Pinned and unpinned refs
 * ---------------------------------------------------------------------------
 *
 * A pinned ref is a full 40-character commit SHA. Nothing else is a pin: a
 * branch name moves, a tag can be re-pointed, an abbreviated SHA can become
 * ambiguous. `PINNED_REF_PATTERN` enforces that.
 *
 * `UNPINNED` is the explicit "not pinned yet" sentinel. It exists because this
 * project starts with 15 repositories that mostly do not exist yet, and a
 * manifest full of invented SHAs would be worse than one that says so. An
 * unpinned entry is FETCHED but never CHECKED OUT (see domain/sync-plan.ts), so
 * an unpinned manifest can never move a working copy.
 *
 * `pnpm check:workspace` reports unpinned entries every run, so the sentinel is
 * loud rather than quietly permanent.
 */

/** Manifest schema version. Bumped when the shape below changes incompatibly. */
export const MANIFEST_VERSION = 1

/** The sentinel meaning "this repository has no pinned revision yet". */
export const UNPINNED = 'unpinned'

/** A pinned ref is a full commit SHA and nothing else. */
export const PINNED_REF_PATTERN = /^[0-9a-f]{40}$/u

export type RepositoryRef = string

export type ManifestEntry = {
  /** Repository name. Also the directory under `repos/` and the package name suffix. */
  readonly name: string
  /** Git clone URL. */
  readonly url: string
  /** A 40-hex commit SHA, or `UNPINNED`. */
  readonly ref: RepositoryRef
}

export type Manifest = {
  readonly manifestVersion: number
  readonly repositories: ReadonlyArray<ManifestEntry>
}

export type ManifestError =
  | { readonly _tag: 'NotJson'; readonly detail: string }
  | { readonly _tag: 'NotAnObject' }
  | { readonly _tag: 'UnsupportedManifestVersion'; readonly found: unknown; readonly supported: number }
  | { readonly _tag: 'RepositoriesNotAnArray' }
  | { readonly _tag: 'EntryNotAnObject'; readonly index: number }
  | { readonly _tag: 'MissingField'; readonly index: number; readonly field: string }
  | { readonly _tag: 'InvalidRef'; readonly name: string; readonly ref: string }
  | { readonly _tag: 'DuplicateRepository'; readonly name: string }
  | { readonly _tag: 'UnknownRepository'; readonly name: string }
  | { readonly _tag: 'MissingRepository'; readonly name: string }

/**
 * A parse result.
 *
 * Hand-rolled rather than `Either` from `effect`: mc-dev-meta has NO runtime
 * dependencies at all. It is the tool that fetches the packages, so it cannot
 * be bootstrapped from them, and keeping its dependency list empty makes that
 * a fact rather than an intention.
 */
export type Parsed<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: ManifestError }

const ok = <A>(value: A): Parsed<A> => ({ ok: true, value })
const fail = <A>(error: ManifestError): Parsed<A> => ({ ok: false, error })

export const isPinned = (ref: RepositoryRef): boolean => PINNED_REF_PATTERN.test(ref)

export const isValidRef = (ref: RepositoryRef): boolean => ref === UNPINNED || isPinned(ref)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringField = (
  entry: Record<string, unknown>,
  field: string,
  index: number,
): Parsed<string> => {
  const value = entry[field]
  return typeof value === 'string' && value.length > 0
    ? ok(value)
    : fail({ _tag: 'MissingField', index, field })
}

/**
 * Parse a manifest document.
 *
 * Structural only: this function does not know which repositories are supposed
 * to exist. `validateAgainstRoster` does that, separately, so that a manifest
 * can be parsed and inspected even while the roster is changing.
 */
export const parseManifest = (raw: string): Parsed<Manifest> => {
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch (cause) {
    return fail({ _tag: 'NotJson', detail: cause instanceof Error ? cause.message : String(cause) })
  }

  if (!isRecord(document)) {
    return fail({ _tag: 'NotAnObject' })
  }

  if (document['manifestVersion'] !== MANIFEST_VERSION) {
    return fail({
      _tag: 'UnsupportedManifestVersion',
      found: document['manifestVersion'],
      supported: MANIFEST_VERSION,
    })
  }

  const repositories = document['repositories']
  if (!Array.isArray(repositories)) {
    return fail({ _tag: 'RepositoriesNotAnArray' })
  }

  const entries: Array<ManifestEntry> = []
  const seen = new Set<string>()

  for (let index = 0; index < repositories.length; index += 1) {
    const candidate: unknown = repositories[index]
    if (!isRecord(candidate)) {
      return fail({ _tag: 'EntryNotAnObject', index })
    }

    const name = stringField(candidate, 'name', index)
    if (!name.ok) {
      return fail(name.error)
    }
    const url = stringField(candidate, 'url', index)
    if (!url.ok) {
      return fail(url.error)
    }
    const ref = stringField(candidate, 'ref', index)
    if (!ref.ok) {
      return fail(ref.error)
    }

    if (!isValidRef(ref.value)) {
      return fail({ _tag: 'InvalidRef', name: name.value, ref: ref.value })
    }
    if (seen.has(name.value)) {
      return fail({ _tag: 'DuplicateRepository', name: name.value })
    }
    seen.add(name.value)

    entries.push({ name: name.value, url: url.value, ref: ref.value })
  }

  return ok({ manifestVersion: MANIFEST_VERSION, repositories: entries })
}

/**
 * Check a parsed manifest against the roster it is supposed to describe.
 *
 * Separate from `parseManifest` so that adding a repository to the roster
 * produces a precise `MissingRepository` rather than a parse failure, and so
 * that a manifest naming a repository nobody has heard of is caught rather than
 * silently cloned.
 */
export const validateAgainstRoster = (
  manifest: Manifest,
  rosterNames: ReadonlyArray<string>,
): Parsed<Manifest> => {
  const expected = new Set(rosterNames)

  for (const entry of manifest.repositories) {
    if (!expected.has(entry.name)) {
      return fail({ _tag: 'UnknownRepository', name: entry.name })
    }
  }

  const present = new Set(manifest.repositories.map((entry) => entry.name))
  for (const name of rosterNames) {
    if (!present.has(name)) {
      return fail({ _tag: 'MissingRepository', name })
    }
  }

  return ok(manifest)
}

/** Entries that still carry the `UNPINNED` sentinel. Reported on every check run. */
export const unpinnedEntries = (manifest: Manifest): ReadonlyArray<ManifestEntry> =>
  manifest.repositories.filter((entry) => !isPinned(entry.ref))

export const entryNamed = (manifest: Manifest, name: string): ManifestEntry | undefined =>
  manifest.repositories.find((entry) => entry.name === name)

/**
 * Serialise a manifest.
 *
 * Entries are written in the order given, two-space indented, with a trailing
 * newline — the shape `pnpm update:manifest` must produce so that pinning one
 * repository is a one-line diff rather than a reformat of the whole file.
 */
export const serialiseManifest = (manifest: Manifest): string =>
  `${JSON.stringify(
    {
      manifestVersion: manifest.manifestVersion,
      repositories: manifest.repositories.map((entry) => ({
        name: entry.name,
        url: entry.url,
        ref: entry.ref,
      })),
    },
    undefined,
    2,
  )}\n`

/** Replace one entry's ref, leaving order and every other entry untouched. */
export const withPinnedRef = (
  manifest: Manifest,
  name: string,
  ref: RepositoryRef,
): Parsed<Manifest> => {
  if (!isValidRef(ref)) {
    return fail({ _tag: 'InvalidRef', name, ref })
  }
  if (entryNamed(manifest, name) === undefined) {
    return fail({ _tag: 'UnknownRepository', name })
  }

  return ok({
    manifestVersion: manifest.manifestVersion,
    repositories: manifest.repositories.map((entry) =>
      entry.name === name ? { name: entry.name, url: entry.url, ref } : entry,
    ),
  })
}

export const describeManifestError = (error: ManifestError): string => {
  switch (error._tag) {
    case 'NotJson':
      return `repos.json is not valid JSON: ${error.detail}`
    case 'NotAnObject':
      return 'repos.json must contain a JSON object at the top level.'
    case 'UnsupportedManifestVersion':
      return `repos.json declares manifestVersion ${JSON.stringify(error.found)}; this tool supports ${String(error.supported)}.`
    case 'RepositoriesNotAnArray':
      return 'repos.json must have a "repositories" array.'
    case 'EntryNotAnObject':
      return `repos.json entry #${String(error.index)} is not an object.`
    case 'MissingField':
      return `repos.json entry #${String(error.index)} is missing a non-empty "${error.field}".`
    case 'InvalidRef':
      return (
        `repos.json entry "${error.name}" has ref "${error.ref}". A ref must be a full 40-character ` +
        `commit SHA, or the literal "${UNPINNED}". A branch name is not a pin: it moves, and the ` +
        'whole point of the manifest is that the composite state can be bisected.'
      )
    case 'DuplicateRepository':
      return `repos.json lists "${error.name}" more than once.`
    case 'UnknownRepository':
      return `repos.json lists "${error.name}", which is not in the roster (domain/repository-roster.ts).`
    case 'MissingRepository':
      return `repos.json has no entry for "${error.name}", which the roster says this workspace manages.`
  }
}
