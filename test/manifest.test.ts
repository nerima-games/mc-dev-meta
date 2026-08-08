import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  describeManifestError,
  entryNamed,
  isPinned,
  isValidRef,
  MANIFEST_VERSION,
  parseManifest,
  serialiseManifest,
  UNPINNED,
  unpinnedEntries,
  validateAgainstRoster,
  withPinnedRef,
  type Manifest,
  type ManifestError,
  type Parsed,
} from '../src/domain/manifest'
import { MANAGED_REPOSITORY_NAMES } from '../src/domain/repository-roster'
import { MANIFEST_FILENAME } from '../src/domain/workspace'

const SHA_A = 'a'.repeat(40)
const SHA_B = '0123456789abcdef0123456789abcdef01234567'

const document = (repositories: ReadonlyArray<unknown>, manifestVersion = MANIFEST_VERSION): string =>
  JSON.stringify({ manifestVersion, repositories })

const entry = (name: string, ref: string = SHA_A) => ({
  name,
  url: `https://github.com/nerima-games/${name}.git`,
  ref,
})

const parsedValue = <A>(result: Parsed<A>): A => {
  if (!result.ok) {
    throw new Error(describeManifestError(result.error))
  }
  return result.value
}

const parsedError = <A>(result: Parsed<A>): ManifestError | undefined =>
  result.ok ? undefined : result.error

describe('refs', () => {
  // REGRESSION: a branch name is not a pin. The manifest exists so that the
  // composite state can be bisected; a ref that moves records nothing.
  it('accepts a full 40-character SHA and the unpinned sentinel, and nothing else', () => {
    expect(isValidRef(SHA_A)).toBe(true)
    expect(isValidRef(SHA_B)).toBe(true)
    expect(isValidRef(UNPINNED)).toBe(true)

    for (const bad of ['main', 'v1.0.0', 'HEAD', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), '']) {
      expect(isValidRef(bad), bad).toBe(false)
    }
  })

  it('does not consider the unpinned sentinel a pin', () => {
    expect(isPinned(UNPINNED)).toBe(false)
    expect(isPinned(SHA_A)).toBe(true)
  })

  it('explains a bad ref in terms of why pinning matters', () => {
    const message = describeManifestError({ _tag: 'InvalidRef', name: 'mc-kernel', ref: 'main' })
    expect(message).toContain('A branch name is not a pin')
    expect(message).toContain('bisect')
  })
})

describe('parsing', () => {
  it('parses a well-formed manifest', () => {
    const manifest = parsedValue(parseManifest(document([entry('mc-kernel'), entry('mc-noise', UNPINNED)])))

    expect(manifest.manifestVersion).toBe(MANIFEST_VERSION)
    expect(manifest.repositories.map((repository) => repository.name)).toStrictEqual([
      'mc-kernel',
      'mc-noise',
    ])
  })

  it('parses an empty repository list', () => {
    expect(parsedValue(parseManifest(document([]))).repositories).toStrictEqual([])
  })

  it('rejects text that is not JSON', () => {
    expect(parsedError(parseManifest('not json'))?._tag).toBe('NotJson')
  })

  // REGRESSION: `JSON.parse` always throws a real `Error` in practice, but the
  // catch clause's `cause` is typed `unknown` and does not assume that. This
  // pins the fallback for the case where whatever parses the document throws
  // something else, so the detail is still a usable string rather than
  // "[object Object]" or a crash from calling `.message` on a non-Error.
  it('still produces a usable detail if the parser throws something other than an Error', () => {
    // A class instance rather than a bare string literal, so this exercises
    // the same `cause instanceof Error` fallback without itself violating
    // `no-throw-literal` — the linter has no way to know NotAnError.toString()
    // is the thing under test here, only that it is not a literal.
    class NotAnError {
      toString(): string {
        return 'boom'
      }
    }
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new NotAnError()
    })
    try {
      const error = parsedError(parseManifest('irrelevant, JSON.parse is stubbed'))
      expect(error?._tag).toBe('NotJson')
      expect(error?._tag === 'NotJson' ? error.detail : undefined).toBe('boom')
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects JSON that is not an object', () => {
    expect(parsedError(parseManifest('[]'))?._tag).toBe('NotAnObject')
    expect(parsedError(parseManifest('null'))?._tag).toBe('NotAnObject')
    expect(parsedError(parseManifest('42'))?._tag).toBe('NotAnObject')
  })

  // REGRESSION: a manifest from a future schema must be refused, not
  // best-effort parsed. Half-understanding a lockfile is worse than not
  // reading it.
  it('rejects a manifest version this tool does not understand', () => {
    const error = parsedError(parseManifest(document([], MANIFEST_VERSION + 1)))
    expect(error?._tag).toBe('UnsupportedManifestVersion')
  })

  it('rejects a missing or non-array repositories field', () => {
    expect(parsedError(parseManifest('{"manifestVersion":1}'))?._tag).toBe('RepositoriesNotAnArray')
    expect(parsedError(parseManifest('{"manifestVersion":1,"repositories":{}}'))?._tag).toBe(
      'RepositoriesNotAnArray',
    )
  })

  it('rejects an entry that is not an object', () => {
    expect(parsedError(parseManifest(document(['mc-kernel'])))?._tag).toBe('EntryNotAnObject')
  })

  it('rejects an entry missing name, url or ref', () => {
    for (const field of ['name', 'url', 'ref']) {
      const incomplete: Record<string, unknown> = { ...entry('mc-kernel') }
      delete incomplete[field]
      const error = parsedError(parseManifest(document([incomplete])))
      expect(error?._tag).toBe('MissingField')
      expect(error?._tag === 'MissingField' ? error.field : undefined).toBe(field)
    }
  })

  it('rejects an empty string where a value is required', () => {
    expect(parsedError(parseManifest(document([{ ...entry('mc-kernel'), url: '' }])))?._tag).toBe(
      'MissingField',
    )
  })

  it('rejects a ref that is neither a SHA nor the sentinel', () => {
    const error = parsedError(parseManifest(document([entry('mc-kernel', 'main')])))
    expect(error?._tag).toBe('InvalidRef')
  })

  it('rejects the same repository listed twice', () => {
    const error = parsedError(parseManifest(document([entry('mc-kernel'), entry('mc-kernel')])))
    expect(error?._tag).toBe('DuplicateRepository')
  })
})

describe('validating against the roster', () => {
  const roster = ['mc-kernel', 'mc-noise']

  it('accepts a manifest that covers the roster exactly', () => {
    const manifest = parsedValue(parseManifest(document([entry('mc-kernel'), entry('mc-noise')])))
    expect(validateAgainstRoster(manifest, roster).ok).toBe(true)
  })

  // REGRESSION: a manifest naming a repository nobody has heard of must be
  // caught, not cloned. `pnpm sync` runs `git clone` on these URLs.
  it('rejects a manifest naming a repository outside the roster', () => {
    const manifest = parsedValue(parseManifest(document([entry('mc-kernel'), entry('mc-noise'), entry('mc-rogue')])))
    const error = parsedError(validateAgainstRoster(manifest, roster))
    expect(error?._tag).toBe('UnknownRepository')
  })

  it('rejects a manifest missing a repository the roster says it manages', () => {
    const manifest = parsedValue(parseManifest(document([entry('mc-kernel')])))
    const error = parsedError(validateAgainstRoster(manifest, roster))
    expect(error?._tag).toBe('MissingRepository')
    expect(error?._tag === 'MissingRepository' ? error.name : undefined).toBe('mc-noise')
  })
})

describe('pinning', () => {
  const manifest: Manifest = parsedValue(
    parseManifest(document([entry('mc-kernel', UNPINNED), entry('mc-noise', SHA_B)])),
  )

  it('replaces one ref and leaves order and every other entry untouched', () => {
    const updated = parsedValue(withPinnedRef(manifest, 'mc-kernel', SHA_A))

    expect(updated.repositories.map((repository) => repository.name)).toStrictEqual([
      'mc-kernel',
      'mc-noise',
    ])
    expect(entryNamed(updated, 'mc-kernel')?.ref).toBe(SHA_A)
    expect(entryNamed(updated, 'mc-noise')).toStrictEqual(entryNamed(manifest, 'mc-noise'))
  })

  it('refuses to write a ref that is not a pin', () => {
    expect(parsedError(withPinnedRef(manifest, 'mc-kernel', 'main'))?._tag).toBe('InvalidRef')
  })

  it('refuses to pin a repository that is not in the manifest', () => {
    expect(parsedError(withPinnedRef(manifest, 'mc-rogue', SHA_A))?._tag).toBe('UnknownRepository')
  })

  it('reports which entries are still unpinned', () => {
    expect(unpinnedEntries(manifest).map((repository) => repository.name)).toStrictEqual(['mc-kernel'])
    expect(unpinnedEntries(parsedValue(withPinnedRef(manifest, 'mc-kernel', SHA_A)))).toStrictEqual([])
  })
})

describe('serialisation', () => {
  // REGRESSION: pinning one repository must be a ONE-LINE diff. If the
  // serialiser reformatted, every `pnpm update:manifest` would produce a
  // whole-file diff and nobody would review it.
  it('round-trips a manifest byte for byte', () => {
    const original = parsedValue(parseManifest(document([entry('mc-kernel'), entry('mc-noise', UNPINNED)])))
    const reparsed = parsedValue(parseManifest(serialiseManifest(original)))
    expect(reparsed).toStrictEqual(original)
  })

  it('produces two-space indentation and a trailing newline', () => {
    const serialised = serialiseManifest(parsedValue(parseManifest(document([entry('mc-kernel')]))))
    expect(serialised.endsWith('\n')).toBe(true)
    expect(serialised).toContain('\n  "repositories": [')
  })

  it('changes exactly one line when one ref is pinned', () => {
    const before = parsedValue(parseManifest(document([entry('mc-kernel', UNPINNED), entry('mc-noise', SHA_B)])))
    const after = parsedValue(withPinnedRef(before, 'mc-kernel', SHA_A))

    const beforeLines = serialiseManifest(before).split('\n')
    const afterLines = serialiseManifest(after).split('\n')

    expect(afterLines).toHaveLength(beforeLines.length)
    const differing = beforeLines.filter((line, index) => line !== afterLines[index])
    expect(differing).toHaveLength(1)
  })
})

describe('the committed repos.json', () => {
  const raw = readFileSync(path.join(process.cwd(), MANIFEST_FILENAME), 'utf8')

  it('parses', () => {
    expect(parseManifest(raw).ok).toBe(true)
  })

  // REGRESSION: adding a repository to the roster without adding it to
  // repos.json would make `pnpm sync` quietly not clone it.
  it('covers exactly the 15 repositories this workspace manages', () => {
    const manifest = parsedValue(parseManifest(raw))
    const validated = validateAgainstRoster(manifest, MANAGED_REPOSITORY_NAMES)

    expect(validated.ok, validated.ok ? '' : describeManifestError(validated.error)).toBe(true)
    expect(manifest.repositories).toHaveLength(15)
  })

  it('lists repositories in roster (build) order', () => {
    const manifest = parsedValue(parseManifest(raw))
    expect(manifest.repositories.map((repository) => repository.name)).toStrictEqual([
      ...MANAGED_REPOSITORY_NAMES,
    ])
  })

  it('is written in the shape the serialiser produces, so update:manifest makes a minimal diff', () => {
    expect(serialiseManifest(parsedValue(parseManifest(raw)))).toBe(raw)
  })

  it('uses the org clone URL for every entry', () => {
    for (const repository of parsedValue(parseManifest(raw)).repositories) {
      expect(repository.url).toBe(`https://github.com/nerima-games/${repository.name}.git`)
    }
  })
})

// ---------------------------------------------------------------------------
// REGRESSION: clone-URL validation.
//
// `git clone` is not a pure data operation. Some URL forms execute code, and a
// leading "-" turns a positional into an option. The manifest is a committed
// file that a pull request can edit, and `pnpm sync` hands its values to git on
// a maintainer's machine, so an unvalidated `url` is remote code execution one
// review-miss away.
//
// These tests exist so the validation cannot be quietly removed. The helpers
// they exercise (ALLOWED_URL_PATTERN, isOptionLike, isAllowedUrl) were once
// present in this module while `parseManifest` never called them — defined
// guards that guarded nothing. Asserting through `parseManifest` rather than
// through the helpers is the point: it pins the wiring, not just the predicate.
// ---------------------------------------------------------------------------
describe('clone URL validation', () => {
  const withUrl = (url: string) =>
    parsedError(parseManifest(document([{ name: 'mc-kernel', url, ref: SHA_A }])))

  it('rejects an ext:: remote helper URL, which git would execute', () => {
    expect(withUrl('ext::sh -c whoami')?._tag).toBe('InvalidUrl')
  })

  it.each([
    ['--upload-pack=touch /tmp/pwned', 'an option-injecting value'],
    ['-u', 'a short option'],
  ])('rejects %s (%s)', (url) => {
    expect(withUrl(url)?._tag).toBe('InvalidUrl')
  })

  it.each([
    ['https://github.com/attacker/mc-kernel.git', 'a different org'],
    ['https://gitlab.com/nerima-games/mc-kernel.git', 'a different host'],
    ['http://github.com/nerima-games/mc-kernel.git', 'plain http'],
    ['git@github.com:nerima-games/mc-kernel.git', 'an SSH remote'],
    ['file:///tmp/evil', 'a local path'],
    ['https://github.com/nerima-games/../../etc/passwd.git', 'path traversal'],
    ['https://user:pw@github.com/nerima-games/mc-kernel.git', 'embedded credentials'],
  ])('rejects %s (%s)', (url) => {
    expect(withUrl(url)?._tag).toBe('InvalidUrl')
  })

  it('rejects a ref beginning with "-" even though it is not a valid SHA either', () => {
    // Redundant with isValidRef today, and deliberately so: this assertion does
    // not depend on PINNED_REF_PATTERN, so loosening that pattern later cannot
    // reopen option injection without failing here.
    const error = parsedError(
      parseManifest(document([{ ...entry('mc-kernel'), ref: '--upload-pack=id' }])),
    )
    expect(error?._tag).toBe('InvalidRef')
  })

  it('rejects an entry whose URL points at a different repository than its name', () => {
    const error = parsedError(
      parseManifest(
        document([{ name: 'mc-kernel', url: 'https://github.com/nerima-games/mc-noise.git', ref: SHA_A }]),
      ),
    )
    expect(error?._tag).toBe('UrlNameMismatch')
  })

  it('accepts the one URL shape this workspace clones', () => {
    expect(withUrl('https://github.com/nerima-games/mc-kernel.git')).toBeUndefined()
  })

  it('explains why a rejected URL was rejected, not merely that it was', () => {
    const message = describeManifestError({
      _tag: 'InvalidUrl',
      name: 'mc-kernel',
      url: 'ext::sh -c whoami',
    })
    expect(message).toContain('ext::sh')
    expect(message).toContain('https://github.com/nerima-games/')
  })
})

// REGRESSION: every ManifestError tag must have a real, checked message.
// `describeManifestError` is what a maintainer reads when `pnpm sync` or
// `pnpm update:manifest` refuses to run — an unchecked case is a message
// nobody has ever actually read appear.
describe('describeManifestError covers every error tag', () => {
  it('explains malformed JSON with the parser detail', () => {
    const message = describeManifestError({ _tag: 'NotJson', detail: 'Unexpected token x' })
    expect(message).toContain('not valid JSON')
    expect(message).toContain('Unexpected token x')
  })

  it('explains a JSON value that is not an object', () => {
    expect(describeManifestError({ _tag: 'NotAnObject' })).toContain('JSON object at the top level')
  })

  it('explains an unsupported manifest version, naming both versions', () => {
    const message = describeManifestError({
      _tag: 'UnsupportedManifestVersion',
      found: 2,
      supported: MANIFEST_VERSION,
    })
    expect(message).toContain('manifestVersion 2')
    expect(message).toContain(`supports ${String(MANIFEST_VERSION)}`)
  })

  it('explains a missing repositories array', () => {
    expect(describeManifestError({ _tag: 'RepositoriesNotAnArray' })).toContain('"repositories" array')
  })

  it('explains an entry that is not an object, by index', () => {
    expect(describeManifestError({ _tag: 'EntryNotAnObject', index: 3 })).toContain('entry #3 is not an object')
  })

  it('explains a missing field, by index and field name', () => {
    const message = describeManifestError({ _tag: 'MissingField', index: 2, field: 'url' })
    expect(message).toContain('entry #2')
    expect(message).toContain('"url"')
  })

  it('explains a URL that clones a different repository than its entry name', () => {
    const message = describeManifestError({
      _tag: 'UrlNameMismatch',
      name: 'mc-kernel',
      url: 'https://github.com/nerima-games/mc-noise.git',
      found: 'mc-noise',
    })
    expect(message).toContain('entry "mc-kernel"')
    expect(message).toContain('points at')
    expect(message).toContain('"mc-noise"')
  })

  it('explains a repository listed more than once', () => {
    expect(describeManifestError({ _tag: 'DuplicateRepository', name: 'mc-kernel' })).toContain(
      '"mc-kernel" more than once',
    )
  })

  it('explains a repository outside the roster', () => {
    const message = describeManifestError({ _tag: 'UnknownRepository', name: 'mc-rogue' })
    expect(message).toContain('"mc-rogue"')
    expect(message).toContain('not in the roster')
  })

  it('explains a repository the roster expects but the manifest omits', () => {
    const message = describeManifestError({ _tag: 'MissingRepository', name: 'mc-noise' })
    expect(message).toContain('no entry for "mc-noise"')
    expect(message).toContain('this workspace manages')
  })
})
