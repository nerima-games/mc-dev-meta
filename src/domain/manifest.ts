/**
 * The repository manifest: parsing and validation. PURE — no filesystem, no
 * git, no network.
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
 *
 * ---------------------------------------------------------------------------
 * Why `url` is validated as strictly as `ref`
 * ---------------------------------------------------------------------------
 *
 * `repos.json` is an INPUT FILE THAT BECOMES ARGUMENTS TO `git clone`. Every
 * value in it is attacker-controlled in the only threat model that matters
 * here: a pull request. A contributor who can edit one line of this file can
 * choose what a maintainer's `pnpm sync` executes.
 *
 * There is no *shell* injection — `scripts/sync-repos.ts` uses `execFile` with
 * an argv array, so there is no shell to inject into. That is not enough,
 * because GIT ITSELF TREATS SOME ARGUMENT VALUES AS CODE:
 *
 *   1. OPTION INJECTION. A `url` beginning with `-` is consumed as an option,
 *      not a positional. `git clone '--upload-pack=touch /tmp/pwned; git-upload-pack' src dst`
 *      runs that command and then reports "done." — verified against git 2.55.
 *      This works unconditionally, on any git, with no special configuration.
 *
 *   2. REMOTE HELPERS. `git clone 'ext::sh -c <cmd>' dir` runs `<cmd>` via the
 *      `ext` remote helper. Modern git refuses this by default
 *      (`fatal: transport 'ext' not allowed`), but only by default: a
 *      maintainer with `protocol.ext.allow` set — which people do set, for
 *      `ext::` based transports — gets arbitrary command execution. Verified
 *      both ways against git 2.55.
 *
 * So `url` is checked against `ALLOWED_URL_PATTERN`: the one shape this
 * workspace should ever clone, and nothing else. That single check closes both
 * classes at once, because neither `-…` nor `ext::…` can match it.
 *
 * `isOptionLike` is then applied to `url` AND `ref` SEPARATELY, on purpose. It
 * is redundant today — nothing that begins with `-` can pass either pattern —
 * and that redundancy is the point. If someone later loosens
 * `ALLOWED_URL_PATTERN` (a second org, a fork, an SSH remote), the
 * option-injection class stays closed without them having to know it existed.
 * Do not delete it as dead code.
 */
import { assertUnreachable } from './exhaustive'

/** Manifest schema version. Bumped when the shape below changes incompatibly. */
export const MANIFEST_VERSION = 1

/** The sentinel meaning "this repository has no pinned revision yet". */
export const UNPINNED = 'unpinned'

/** A pinned ref is a full commit SHA and nothing else. */
export const PINNED_REF_PATTERN = /^[0-9a-f]{40}$/u

/**
 * The ONLY clone URL shape this workspace accepts.
 *
 * Deliberately an allowlist of one shape rather than a denylist of known-bad
 * ones. A denylist of `ext::`, `-`, `file://`, ... is a list of the tricks
 * somebody has already thought of; this is a list of the URLs that are correct.
 *
 * The capture group is the repository name, which `parseManifest` requires to
 * equal the entry's `name`. Every entry in the committed `repos.json` already
 * satisfies that, so it costs nothing and removes a whole class of "the entry
 * says mc-kernel but clones something else" confusion.
 *
 * `[a-z0-9-]` excludes `/`, `.`, `@` and `:`, so no extra path segment, no
 * `..` traversal and no userinfo can be smuggled through the name. In
 * JavaScript `$` (without the `m` flag) matches only at the very end of the
 * string — not before a trailing newline as in Perl or Python — so a value
 * ending in `\n` cannot slip past this anchor.
 */
export const ALLOWED_URL_PATTERN =
  /^https:\/\/github\.com\/nerima-games\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.git$/u

/**
 * True when a value would be read by git as an OPTION rather than a value.
 *
 * Checked independently of every other pattern. See the header note: this is
 * intentionally redundant, so that loosening a pattern cannot silently reopen
 * option injection.
 */
export const isOptionLike = (value: string): boolean => value.startsWith('-')

/** The repository name inside an allowed clone URL, or `undefined` if the URL is not allowed. */
export const repositoryNameInUrl = (url: string): string | undefined =>
  ALLOWED_URL_PATTERN.exec(url)?.[1]

/** True when `url` is a clone URL this workspace is willing to hand to `git clone`. */
export const isAllowedUrl = (url: string): boolean =>
  !isOptionLike(url) && ALLOWED_URL_PATTERN.test(url)

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
  | { readonly _tag: 'InvalidUrl'; readonly name: string; readonly url: string }
  | { readonly _tag: 'UrlNameMismatch'; readonly name: string; readonly url: string; readonly found: string }
  | { readonly _tag: 'DuplicateRepository'; readonly name: string }
  | { readonly _tag: 'UnknownRepository'; readonly name: string }
  | { readonly _tag: 'MissingRepository'; readonly name: string }

/**
 * A parse result.
 *
 * Hand-rolled rather than `Either` from `effect`: this parser owns a compact
 * manifest-specific error contract and does not need an Effect runtime. The
 * repository may use `effect` in the portable kernel, but the management parser
 * remains independent of that representation.
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
    // `ref` is checked for option-likeness separately from `isValidRef`. A 40-hex
    // SHA cannot begin with `-`, so this is redundant today — deliberately. It
    // means loosening PINNED_REF_PATTERN later cannot silently reopen option
    // injection, because this check does not depend on that pattern.
    //
    // Structurally unreachable AS LONG AS that stays true: `ref.value` here is
    // already proven to equal UNPINNED or match PINNED_REF_PATTERN (neither
    // can start with '-'), so no fixture can drive this arm without breaking
    // the guarantee above it. Excluded from coverage rather than forced with a
    // fixture that could only reach it by first weakening `isValidRef`.
    /* v8 ignore next 3 -- @preserve */
    if (isOptionLike(ref.value)) {
      return fail({ _tag: 'InvalidRef', name: name.value, ref: ref.value })
    }
    if (!isAllowedUrl(url.value)) {
      return fail({ _tag: 'InvalidUrl', name: name.value, url: url.value })
    }
    // The URL is allowed, so the name inside it is defined. Requiring it to match
    // the entry's own name stops a manifest from cloning one repository into
    // another's directory, which the roster check alone would not catch.
    const urlName = repositoryNameInUrl(url.value)
    if (urlName !== undefined && urlName !== name.value) {
      return fail({ _tag: 'UrlNameMismatch', name: name.value, url: url.value, found: urlName })
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
    case 'InvalidUrl':
      return (
        `repos.json entry "${error.name}" has url ${JSON.stringify(error.url)}. A clone URL must be ` +
        'exactly https://github.com/nerima-games/<name>.git. This is not style enforcement: git ' +
        'executes some URL forms — `ext::sh -c <cmd>` runs <cmd> through a remote helper — and a ' +
        'value beginning with "-" is read as an option, not a positional.'
      )
    case 'UrlNameMismatch':
      return (
        `repos.json entry "${error.name}" has url ${JSON.stringify(error.url)}, which points at ` +
        `"${error.found}". An entry must clone its own repository, or it would populate another ` +
        "repository's directory under repos/."
      )
    case 'DuplicateRepository':
      return `repos.json lists "${error.name}" more than once.`
    case 'UnknownRepository':
      return `repos.json lists "${error.name}", which is not in the roster (domain/repository-roster.ts).`
    case 'MissingRepository':
      return `repos.json has no entry for "${error.name}", which the roster says this workspace manages.`
    // Structurally unreachable: every ManifestError tag is handled above, so
    // TypeScript only accepts this call because `error` has narrowed to
    // `never`. See src/domain/exhaustive.ts.
    /* v8 ignore next 2 -- @preserve */
    default:
      return assertUnreachable(error)
  }
}
