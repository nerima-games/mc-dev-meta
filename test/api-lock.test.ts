/**
 * Tests for the API lock generator (`scripts/api-lock.ts`).
 *
 * This is the sister of the file in the other 15 repositories, with one
 * difference: it uses PLAIN vitest rather than the `it.effect` form, for the
 * same reason `test/check-dependency-whitelist.test.ts` does — mc-dev-meta has
 * no runtime dependencies at all, not even `effect`, because it is the tool
 * that fetches the packages and cannot be bootstrapped from them. Everything
 * else is identical to the sister copies, deliberately, so the files can still
 * be diffed against one another.
 *
 * Everything it asserts is about the generic machinery, not about any one
 * repository's API. The repository-specific assertion — "the
 * committed `api-lock.md` matches the current public surface" — is deliberately
 * NOT here. It is `pnpm api:check`, it runs in `pnpm verify` and in CI, and
 * duplicating it in vitest would pay the cost of a second full program build to
 * learn the same thing.
 *
 * What is worth testing here is the part that decides whether the gate is
 * trustworthy: that the ordering is locale-independent, that the portability
 * guard actually rejects the things it claims to reject (and does NOT reject
 * the `import("effect/Cause")` form that Effect's `Data.TaggedError` makes
 * unavoidable), that a rendered snapshot parses back into the entries it was
 * rendered from, and that the diff a developer is shown on failure is correct.
 */
import { describe, expect, it } from 'vitest'
import {
  assertPortable,
  compareStrings,
  describeDifference,
  diffLines,
  FORMAT_VERSION,
  parseEntries,
  renderSnapshot,
  REPOSITORY_POLICY,
  type Entry,
} from '../scripts/api-lock'

const entry = (name: string, kind: string, text: string): Entry => ({ name, kind, text })

const SAMPLE: ReadonlyArray<Entry> = [
  entry('AABB', 'type', 'type AABB = {\n    readonly min: Position;\n};'),
  entry('ClockPort', 'class', 'class ClockPort extends ClockPort_base {\n}'),
  entry('monotonicSecs', 'const', 'const monotonicSecs: Effect.Effect<MonotonicTimeSecs, never, ClockPort>;'),
]

/** A branded type as every one of the 16 repositories declares it. */
const BRANDED: ReadonlyArray<Entry> = [
  entry('StageId', 'const', 'const StageId: Brand.Brand.Constructor<StageId>;'),
  entry('StageId', 'type', "type StageId = string & Brand.Brand<'StageId'>;"),
]

const snapshotOf = (exported: ReadonlyArray<Entry>, supporting: ReadonlyArray<Entry> = []): string =>
  renderSnapshot({ packageName: '@nerima-games/example', exported, supporting })

describe('per-repository configuration', () => {
  it('points at the shipped-source project, not the editor-wide one', () => {
    // If this ever pointed at tsconfig.json the report would include test and
    // tooling types, and the lock would move whenever a test moved.
    expect(REPOSITORY_POLICY.tsconfigFile).toBe('tsconfig.build.json')
    expect(REPOSITORY_POLICY.entryPoints).toStrictEqual(['index.ts'])
    expect(REPOSITORY_POLICY.snapshotFile).toBe('api-lock.md')
  })
})

describe('ordering', () => {
  it('compares by code unit, so the ordering cannot depend on the host locale', () => {
    // The case that motivates this: `localeCompare` sorts these the other way
    // round under most locales, so two developers would each see the other's
    // snapshot as a diff.
    expect(compareStrings('Z', 'a')).toBeLessThan(0)
    expect('Z'.localeCompare('a')).toBeGreaterThan(0)

    expect(compareStrings('_internal', 'AABB')).toBeGreaterThan(0)
    expect(compareStrings('AABB', 'AABB')).toBe(0)
  })

  it('is a total order, so sorting is deterministic', () => {
    const names = ['b', 'A', 'a', 'B', '_', 'Z']
    const once = [...names].sort(compareStrings)
    const twice = [...once].reverse().sort(compareStrings)
    expect(twice).toStrictEqual(once)
  })
})

describe('the portability guard', () => {
  it('rejects an absolute home-directory path — these are public repositories', () => {
    expect(() => assertPortable('const x: import("/Users/someone/dev/thing").T;')).toThrow(/absolute home-directory/u)
    expect(() => assertPortable('/home/runner/work/repo')).toThrow(/absolute home-directory/u)
  })

  it('rejects an absolute Windows path', () => {
    expect(() => assertPortable('type T = C:\\Users\\x;')).toThrow(/Windows/u)
  })

  it('rejects a node_modules path', () => {
    expect(() => assertPortable('from "../node_modules/effect"')).toThrow(/node_modules/u)
  })

  it('rejects a PATH-based import() type reference, which is unstable across machines', () => {
    expect(() => assertPortable('const x: import("./domain/clock").ClockService;')).toThrow(/path-based/u)
    expect(() => assertPortable('const x: import("../thing").T;')).toThrow(/path-based/u)
  })

  it('ACCEPTS a bare import() specifier — Effect\u2019s Data.TaggedError makes it unavoidable', () => {
    // mc-save and mx-multiplayer both hit this: the base class Data.TaggedError
    // synthesises names `effect` internals that no barrel re-exports, so tsc has
    // nothing to refer to them by except the package specifier. That is portable
    // and stable, which is all the guard is for.
    expect(() =>
      assertPortable('const E_base: (args: import("effect/Types").VoidIfEmpty<A>) => import("effect/Cause").YieldableError;'),
    ).not.toThrow()
  })

  it('names the offending line in its message, so the failure is actionable', () => {
    expect(() => assertPortable('fine\nfine\nconst x: import("./y").T;\n')).toThrow(/line 3/u)
  })
})

describe('snapshot rendering', () => {
  it('contains no timestamp, version or path — a diff must mean an API change and nothing else', () => {
    const text = snapshotOf(SAMPLE)
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/u)
    expect(text).not.toMatch(/\bgenerated at\b/iu)
    expect(text).not.toMatch(/\/Users\//u)
    // The TypeScript version is deliberately absent: recording it would put a
    // devDependency bump into the API diff on every bump.
    expect(text).not.toMatch(/typescript@/u)
  })

  it('is a pure function of its input', () => {
    expect(snapshotOf(SAMPLE)).toBe(snapshotOf(SAMPLE))
  })

  it('records the format version, so a rendering change is self-explaining', () => {
    expect(snapshotOf(SAMPLE)).toContain(`format: ${String(FORMAT_VERSION)}`)
    expect(snapshotOf(SAMPLE)).toContain('exported declarations: 3')
  })

  it('says so explicitly when a package exports nothing, rather than rendering an empty file', () => {
    expect(snapshotOf([])).toContain('exports nothing')
  })

  it('omits the supporting section entirely when there is nothing in it', () => {
    expect(snapshotOf(SAMPLE)).not.toContain('## Supporting declarations')
    expect(snapshotOf(SAMPLE, [entry('X_base', 'const', 'const X_base: T;')])).toContain(
      '## Supporting declarations',
    )
  })
})

describe('parsing a snapshot back', () => {
  it('round-trips every rendered entry, keyed by name AND kind', () => {
    const parsed = parseEntries(snapshotOf(SAMPLE))
    expect([...parsed.keys()]).toStrictEqual(['AABB (type)', 'ClockPort (class)', 'monotonicSecs (const)'])
    expect(parsed.get('ClockPort (class)')).toBe('class ClockPort extends ClockPort_base {\n}')
  })

  it('keeps both halves of a declaration-merged branded type', () => {
    // Every branded type in this organisation is a `type X` plus a `const X`.
    // Keying by name alone would silently drop one of them.
    expect(parseEntries(snapshotOf(BRANDED)).size).toBe(2)
  })

  it('reads the supporting section as well as the exported one', () => {
    const parsed = parseEntries(snapshotOf(SAMPLE, [entry('ClockPort_base', 'const', 'const ClockPort_base: T;')]))
    expect(parsed.has('ClockPort_base (const)')).toBe(true)
  })
})

describe('the line diff shown on failure', () => {
  it('marks removals, additions and context', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])).toStrictEqual(['      a', '    - b', '    + x', '      c'])
  })

  it('is all context when nothing changed', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toStrictEqual(['      a', '      b'])
  })

  it('handles one side being empty', () => {
    expect(diffLines([], ['a'])).toStrictEqual(['    + a'])
    expect(diffLines(['a'], [])).toStrictEqual(['    - a'])
  })
})

describe('the failure message', () => {
  it('reports an added export', () => {
    const lines = describeDifference(snapshotOf(SAMPLE), snapshotOf([...SAMPLE, entry('zed', 'const', 'const zed: 1;')]))
    expect(lines.join('\n')).toContain('+ ADDED    zed')
  })

  it('reports a removed export — the change that breaks a consumer outright', () => {
    const lines = describeDifference(snapshotOf(SAMPLE), snapshotOf(SAMPLE.slice(1)))
    expect(lines.join('\n')).toContain('- REMOVED  AABB')
  })

  it('reports a changed signature with the differing lines', () => {
    const changed = SAMPLE.map((candidate) =>
      candidate.name === 'ClockPort'
        ? entry('ClockPort', 'class', 'class ClockPort extends ClockPort_renamed {\n}')
        : candidate,
    )
    const message = describeDifference(snapshotOf(SAMPLE), snapshotOf(changed)).join('\n')
    expect(message).toContain('~ CHANGED  ClockPort')
    expect(message).toContain('- class ClockPort extends ClockPort_base {')
    expect(message).toContain('+ class ClockPort extends ClockPort_renamed {')
  })

  it('reports dropping a branded constructor as a REMOVAL, not as a change of kind', () => {
    // Deleting `const StageId` while keeping `type StageId` breaks every
    // caller that constructs one. Keyed by name alone this rendered as
    // "StageId changed from a const into a type", which buries the fact that
    // a constructor disappeared.
    const message = describeDifference(snapshotOf(BRANDED), snapshotOf(BRANDED.slice(1))).join('\n')
    expect(message).toContain('- REMOVED  StageId (const)')
    expect(message).not.toContain('~ CHANGED')
  })

  it('names the kind, so `type X` and `const X` are told apart in the message', () => {
    const message = describeDifference(snapshotOf(SAMPLE), snapshotOf(SAMPLE.slice(1))).join('\n')
    expect(message).toContain('- REMOVED  AABB (type)')
  })

  it('says nothing changed only when nothing did', () => {
    expect(describeDifference(snapshotOf(SAMPLE), snapshotOf(SAMPLE)).join('\n')).toContain('no entry changed')
  })
})
