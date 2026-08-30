/**
 * Tests for `domain/repoint-plan.ts`.
 *
 * NOTHING HERE COPIES A REPOSITORY OR RUNS A COMPILER. That is the same rule
 * `test/mirror-contract.test.ts` follows for `repos/` and `test/sync-plan.test.ts`
 * follows for git: the decision logic is a pure function over observations, so
 * "a repoint that introduced an error", "a repoint that only reproduced errors
 * the downstream already had" and "a downstream nobody cloned" are all
 * fixtures. A test that needed three clones and nine `tsc` runs would take
 * twelve seconds and would only pass on a machine that already had the answer.
 *
 * The observations these fixtures build are exactly the shape
 * `scripts/check-repoint.ts` produces from real compiler output — a
 * `Diagnostic` per `tsc --pretty false` line, a `ProjectResult` per tsconfig,
 * with the baseline compile beside the repointed one.
 *
 * Plain vitest, not `@effect/vitest` and `it.effect` — this repository has no
 * runtime dependencies at all, not even `effect`, for the reason recorded in
 * `src/index.ts` and `src/domain/manifest.ts`: it is the tool that fetches the
 * packages and therefore cannot be bootstrapped from them.
 */
import { describe, expect, it } from 'vitest'
import { MIRROR_SPECS } from '../src/domain/mirror-contract'
import {
  classifyRepoint,
  describeRepointRun,
  failingRepoints,
  fingerprintDiagnostic,
  mirrorModuleName,
  parseDiagnostics,
  repointPath,
  repointRunExitCode,
  rewriteMirrorImports,
  staleKnownRepointFindings,
  typecheckProjects,
  unmatchedRepointSpecs,
  withWorkspaceDependency,
  KNOWN_REPOINT_FINDINGS,
  REPOINT_SPECS,
  type Diagnostic,
  type KnownRepointFinding,
  type ProjectResult,
  type RepointOutcome,
  type RepointSpec,
} from '../src/domain/repoint-plan'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const spec: RepointSpec = {
  repository: 'mx-gameplay',
  file: 'domain/frame-contract.ts',
  packageName: '@nerima-games/mc-kernel',
  source: 'mc-kernel',
}

const diagnostic = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  file: 'test/support/frame-runner.ts',
  line: 65,
  column: 3,
  code: 'TS2375',
  message: "Type 'Effect<void, never, ClockPort>' is not assignable to type 'Effect<void, never, never>'.",
  ...over,
})

const project = (over: Partial<ProjectResult> = {}): ProjectResult => ({
  project: 'tsconfig.test.json',
  baseline: [],
  repointed: [],
  ...over,
})

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe('REPOINT_SPECS', () => {
  it('names only mirrors that MIRROR_SPECS also carries', () => {
    // The invariant `scripts/check-repoint.ts` refuses to start without. A
    // repoint of a file the mirror gate does not compare is a claim with
    // nothing else watching it.
    expect(unmatchedRepointSpecs()).toEqual([])
  })

  it('reports a spec whose mirror the mirror gate has never heard of', () => {
    const stray: RepointSpec = {
      repository: 'mc-audio',
      file: 'domain/invented.ts',
      packageName: '@nerima-games/mc-kernel',
      source: 'mc-kernel',
    }
    expect(unmatchedRepointSpecs([stray], MIRROR_SPECS)).toEqual([stray])
  })

  /*
   * `mx-gameplay/domain/inventory-port.ts` is the row this test used to pin —
   * it no longer exists on any repository's `origin/main` (W1-M0,
   * 2026-08-30) and was removed from both `REPOINT_SPECS` and
   * `MIRROR_SPECS`. See the note above `REPOINT_SPECS` in
   * domain/repoint-plan.ts for the full re-derivation.
   */
  it('does not carry a row for the deleted mx-gameplay inventory-port mirror', () => {
    const inventory = REPOINT_SPECS.find(
      (candidate) => candidate.repository === 'mx-gameplay' && candidate.file.endsWith('inventory-port.ts'),
    )

    expect(inventory).toBeUndefined()
  })

  it('rewrites the inventory mirror at the depth its call sites import it from', () => {
    // `stages/registration.ts` and the tests import it as `'../domain/...'`,
    // the preview as `'../../domain/...'`, and the mirror's own neighbours as
    // `'./...'`. All three must be rewritten, or the repoint would compile a
    // file that still points at a deleted module.
    const source = [
      "import { InventoryService } from '../domain/inventory-port'",
      "import type { Slot } from '../../domain/inventory-port'",
      "import type { Inventory } from './inventory-port'",
      // ...and a near-miss that must NOT be rewritten.
      "import { x } from './inventory-port-extra'",
    ].join('\n')

    const rewritten = rewriteMirrorImports(source, 'inventory-port', '@nerima-games/mc-sim')

    expect(rewritten.rewrites).toBe(3)
    expect(rewritten.text).toContain("from '@nerima-games/mc-sim'")
    expect(rewritten.text).toContain("from './inventory-port-extra'")
  })

  it('derives the module name imports use from the file path', () => {
    expect(mirrorModuleName(spec)).toBe('frame-contract')
    expect(
      mirrorModuleName({ ...spec, file: 'domain/inventory-port.ts' }),
    ).toBe('inventory-port')
    expect(mirrorModuleName({ ...spec, file: 'domain/kernel-vocabulary.ts' })).toBe(
      'kernel-vocabulary',
    )
  })

  // Every real spec's `file` ends in `.ts`, but the function does not assume
  // it — this pins the fallback for the day it is fed something else.
  it('uses the basename as-is when it has no .ts extension to strip', () => {
    expect(mirrorModuleName({ ...spec, file: 'domain/kernel-vocabulary' })).toBe('kernel-vocabulary')
  })

  it('renders a path for messages', () => {
    expect(repointPath(spec)).toBe('mx-gameplay/domain/frame-contract.ts')
  })
})

// ---------------------------------------------------------------------------
// Which projects get compiled
// ---------------------------------------------------------------------------

describe('typecheckProjects', () => {
  it('reads every project out of a real three-project typecheck script', () => {
    const text = JSON.stringify({
      scripts: {
        typecheck:
          'tsc -p tsconfig.build.json --pretty false && tsc -p tsconfig.test.json --pretty false && tsc -p tsconfig.preview.json --pretty false',
      },
    })
    expect(typecheckProjects(text)).toEqual([
      'tsconfig.build.json',
      'tsconfig.test.json',
      'tsconfig.preview.json',
    ])
  })

  it('de-duplicates a project named twice', () => {
    const text = JSON.stringify({
      scripts: { typecheck: 'tsc -p tsconfig.build.json && tsc -p tsconfig.build.json' },
    })
    expect(typecheckProjects(text)).toEqual(['tsconfig.build.json'])
  })

  it('returns nothing when there is no typecheck script', () => {
    // The caller turns this into a failure, never a pass. Compiling nothing
    // must not read as a clean repoint.
    expect(typecheckProjects(JSON.stringify({ scripts: { test: 'vitest run' } }))).toEqual([])
    expect(typecheckProjects(JSON.stringify({}))).toEqual([])
  })

  it('returns nothing when the script compiles without -p', () => {
    const text = JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } })
    expect(typecheckProjects(text)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

describe('rewriteMirrorImports', () => {
  const rewrite = (text: string) =>
    rewriteMirrorImports(text, 'frame-contract', '@nerima-games/mc-kernel')

  it('repoints relative specifiers at every depth the workspace actually uses', () => {
    const source = [
      "import { StageId } from '../domain/frame-contract'",
      "import type { DeltaTimeSecs } from '../frame-contract'",
      "import { DeltaTimeSecs } from '../../domain/frame-contract'",
      "import { X } from './frame-contract'",
    ].join('\n')
    const result = rewrite(source)
    expect(result.rewrites).toBe(4)
    expect(result.text).not.toContain('frame-contract')
    expect(result.text.split('\n').every((line) => line.includes("'@nerima-games/mc-kernel'"))).toBe(
      true,
    )
  })

  it('repoints a dynamic import', () => {
    const result = rewrite("const m = await import('../domain/frame-contract')")
    expect(result.rewrites).toBe(1)
    expect(result.text).toBe("const m = await import('@nerima-games/mc-kernel')")
  })

  it('repoints a re-export', () => {
    const result = rewrite("export { StageId } from './frame-contract'")
    expect(result.rewrites).toBe(1)
    expect(result.text).toBe("export { StageId } from '@nerima-games/mc-kernel'")
  })

  it('leaves a different module whose name merely starts the same', () => {
    // The final-segment anchor. Without it this rewrote `frame-contract-extra`
    // as well, and the repoint deleted one file while breaking two.
    const source = "import { X } from './frame-contract-extra'"
    expect(rewrite(source)).toEqual({ text: source, rewrites: 0 })
  })

  it('leaves a bare package specifier that ends in the same word', () => {
    const source = "import { X } from '@vendor/frame-contract'"
    expect(rewrite(source)).toEqual({ text: source, rewrites: 0 })
  })

  it('leaves the prose form the mirrors are referred to by', () => {
    // Every reference in the roster is a backticked bare path inside a comment.
    // Those must survive, or the gate rewrites the documentation it depends on.
    const source = ' * It is NOT re-exported, for the reason `./frame-contract` gives.'
    expect(rewrite(source)).toEqual({ text: source, rewrites: 0 })
  })

  it('counts nothing when the mirror is unimported', () => {
    // The caller turns zero into a failure: a repoint that changed no import
    // compiled the same code twice and proved nothing.
    expect(rewrite('export const x = 1\n').rewrites).toBe(0)
  })

  it('escapes a module name containing regex metacharacters', () => {
    const result = rewriteMirrorImports(
      "import { X } from './a.b'\nimport { Y } from './axb'",
      'a.b',
      'pkg',
    )
    expect(result.rewrites).toBe(1)
    expect(result.text).toContain("from './axb'")
  })
})

describe('withWorkspaceDependency', () => {
  it('adds the dependency the repoint needs', () => {
    const text = JSON.stringify({ name: 'x', dependencies: { effect: '^3.20.0' } }, undefined, 2)
    const parsed: unknown = JSON.parse(withWorkspaceDependency(text, '@nerima-games/mc-kernel'))
    expect(parsed).toMatchObject({
      dependencies: { effect: '^3.20.0', '@nerima-games/mc-kernel': 'workspace:*' },
    })
  })

  it('adds a dependencies block to a package that has none', () => {
    const parsed: unknown = JSON.parse(
      withWorkspaceDependency(JSON.stringify({ name: 'x' }), '@nerima-games/mc-kernel'),
    )
    expect(parsed).toMatchObject({ dependencies: { '@nerima-games/mc-kernel': 'workspace:*' } })
  })

  it('leaves a package that already declares it', () => {
    // The day mc-kernel is published the downstreams depend on it for real.
    // The gate must keep working then rather than writing a duplicate key.
    const text = JSON.stringify(
      { name: 'x', dependencies: { '@nerima-games/mc-kernel': '^1.0.0' } },
      undefined,
      2,
    )
    expect(withWorkspaceDependency(text, '@nerima-games/mc-kernel')).toBe(text)
  })

  // Defensive: `package.json` is read off disk and parsed with no schema
  // check upstream of this function. A package.json that parses to something
  // other than an object (a bare string, a number, `null` — `typeof null` is
  // famously `'object'`, which is exactly why the check is `!== 'object' ||
  // === null` rather than either alone) must be left alone rather than crash
  // trying to spread it as a record. An ARRAY is deliberately not one of
  // these cases: `typeof [] === 'object'` and `[] !== null`, so this function
  // does not distinguish an array from a plain object today — it would spread
  // the array's own indices away and add a `dependencies` key, which is a
  // separate, pre-existing question this test does not adjudicate.
  it('leaves non-object JSON untouched rather than crashing on it', () => {
    for (const notAnObject of ['"just a string"', 'null', '42']) {
      expect(withWorkspaceDependency(notAnObject, '@nerima-games/mc-kernel')).toBe(notAnObject)
    }
  })
})

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

describe('parseDiagnostics', () => {
  it('parses the real shape of a tsc --pretty false run', () => {
    const output = [
      "test/support/frame-runner.ts(65,3): error TS2375: Type 'A' is not assignable to type 'B'.",
      "  Type 'ClockPort' is not assignable to type 'never'.",
      'stages/registration.ts(12,1): error TS2305: Module has no exported member.',
    ].join('\n')

    expect(parseDiagnostics(output)).toEqual([
      {
        file: 'test/support/frame-runner.ts',
        line: 65,
        column: 3,
        code: 'TS2375',
        message: "Type 'A' is not assignable to type 'B'.",
      },
      {
        file: 'stages/registration.ts',
        line: 12,
        column: 1,
        code: 'TS2305',
        message: 'Module has no exported member.',
      },
    ])
  })

  it('drops the indented continuation lines rather than folding them in', () => {
    // They restate the head and are the part most likely to be reworded by a
    // TypeScript patch release, which would churn every recorded fingerprint.
    const output = [
      "a.ts(1,1): error TS2375: Head message.",
      "  Type 'X' is not assignable to type 'Y'.",
      "    and more detail still.",
    ].join('\n')
    const parsed = parseDiagnostics(output)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.message).toBe('Head message.')
  })

  it('finds nothing in a clean run', () => {
    expect(parseDiagnostics('')).toEqual([])
    expect(parseDiagnostics('\n\n')).toEqual([])
  })

  it('ignores a fileless error rather than inventing a diagnostic for it', () => {
    // `error TS18003: No inputs were found` has no `file(line,col)` prefix. It
    // is a compiler that did not start, and the empty-projects rule is what
    // catches that — not a half-parsed diagnostic.
    expect(parseDiagnostics('error TS18003: No inputs were found in config file.')).toEqual([])
  })
})

describe('fingerprintDiagnostic', () => {
  it('ignores line and column so an unrelated edit upstream does not churn the register', () => {
    const here = fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic())
    const moved = fingerprintDiagnostic(
      spec,
      'tsconfig.test.json',
      diagnostic({ line: 900, column: 42 }),
    )
    expect(moved).toBe(here)
  })

  it('distinguishes the file, the code, the message and the project', () => {
    const base = fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic())
    expect(fingerprintDiagnostic(spec, 'tsconfig.build.json', diagnostic())).not.toBe(base)
    expect(
      fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic({ file: 'other.ts' })),
    ).not.toBe(base)
    expect(
      fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic({ code: 'TS2305' })),
    ).not.toBe(base)
    expect(
      fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic({ message: 'different' })),
    ).not.toBe(base)
  })

  it('distinguishes two repositories carrying the same error', () => {
    // The whole reason the three frame-contract findings are separate entries:
    // one contract, three transcriptions, three owners.
    const gameplay = fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic())
    const ui = fingerprintDiagnostic(
      { ...spec, repository: 'mx-ui' },
      'tsconfig.test.json',
      diagnostic(),
    )
    expect(ui).not.toBe(gameplay)
  })
})

// ---------------------------------------------------------------------------
// Classifying
// ---------------------------------------------------------------------------

describe('classifyRepoint', () => {
  it('attributes nothing when the repointed compile is clean', () => {
    const outcome = classifyRepoint(spec, 3, [project()], [])
    expect(outcome._tag).toBe('Repointed')
    if (outcome._tag !== 'Repointed') {
      return
    }
    expect(outcome.introduced).toEqual([])
    expect(outcome.known).toEqual([])
    expect(repointRunExitCode([outcome], [])).toBe(0)
  })

  it('does NOT attribute an error the downstream already had', () => {
    // The reason every project is compiled twice. Without the baseline, the
    // first person to read this report debugs somebody else's unrelated bug.
    const preexisting = diagnostic({ file: 'domain/unrelated.ts', code: 'TS2322' })
    const outcome = classifyRepoint(
      spec,
      3,
      [project({ baseline: [preexisting], repointed: [preexisting] })],
      [],
    )
    if (outcome._tag !== 'Repointed') {
      throw new Error('expected Repointed')
    }
    expect(outcome.introduced).toEqual([])
    expect(repointRunExitCode([outcome], [])).toBe(0)
  })

  it('attributes an error that appeared only after the repoint', () => {
    const preexisting = diagnostic({ file: 'domain/unrelated.ts', code: 'TS2322' })
    const introduced = diagnostic()
    const outcome = classifyRepoint(
      spec,
      3,
      [project({ baseline: [preexisting], repointed: [preexisting, introduced] })],
      [],
    )
    if (outcome._tag !== 'Repointed') {
      throw new Error('expected Repointed')
    }
    expect(outcome.introduced).toEqual([
      { project: 'tsconfig.test.json', diagnostic: introduced, entry: undefined },
    ])
    expect(repointRunExitCode([outcome], [])).toBe(1)
  })

  it('recognises the same error moved to a different line as still pre-existing', () => {
    const outcome = classifyRepoint(
      spec,
      3,
      [project({ baseline: [diagnostic()], repointed: [diagnostic({ line: 400 })] })],
      [],
    )
    if (outcome._tag !== 'Repointed') {
      throw new Error('expected Repointed')
    }
    expect(outcome.introduced).toEqual([])
  })

  it('routes an introduced error to the register when it is recorded', () => {
    const introduced = diagnostic()
    const entry: KnownRepointFinding = {
      fingerprint: fingerprintDiagnostic(spec, 'tsconfig.test.json', introduced),
      summary: 'the frame runner provides no ClockPort',
      owner: 'mx-gameplay',
      fix: 'provide one',
    }
    const outcome = classifyRepoint(spec, 3, [project({ repointed: [introduced] })], [entry])
    if (outcome._tag !== 'Repointed') {
      throw new Error('expected Repointed')
    }
    expect(outcome.introduced).toEqual([])
    expect(outcome.known).toEqual([{ project: 'tsconfig.test.json', diagnostic: introduced, entry }])
    // Recorded, reported, and NOT a failure — the same bargain KNOWN_FINDINGS
    // strikes in domain/mirror-contract.ts.
    expect(repointRunExitCode([outcome], [entry])).toBe(0)
  })

  it('still fails on a NEW error beside a recorded one', () => {
    const recorded = diagnostic()
    const fresh = diagnostic({ file: 'stages/registration.ts', code: 'TS2305' })
    const entry: KnownRepointFinding = {
      fingerprint: fingerprintDiagnostic(spec, 'tsconfig.test.json', recorded),
      summary: 'recorded',
      owner: 'mx-gameplay',
      fix: 'fix it',
    }
    const outcome = classifyRepoint(
      spec,
      3,
      [project({ repointed: [recorded, fresh] })],
      [entry],
    )
    if (outcome._tag !== 'Repointed') {
      throw new Error('expected Repointed')
    }
    expect(outcome.introduced).toHaveLength(1)
    expect(repointRunExitCode([outcome], [entry])).toBe(1)
  })

  it('treats a repoint that compiled no project as a failure, not agreement', () => {
    // The same rule `compareSurfaces` applies to an empty observation: a
    // checker that compiled nothing and reported no errors is worse than none.
    const outcome = classifyRepoint(spec, 3, [], [])
    expect(failingRepoints([outcome])).toEqual([outcome])
    expect(repointRunExitCode([outcome], [])).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The register going stale
// ---------------------------------------------------------------------------

describe('staleKnownRepointFindings', () => {
  const entry: KnownRepointFinding = {
    fingerprint: fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic()),
    summary: 'the frame runner provides no ClockPort',
    owner: 'mx-gameplay',
    fix: 'provide one',
  }

  it('reports an entry whose repoint ran and which did not reproduce', () => {
    // The downstream fixed it. The entry must go, or it sits there suppressing
    // the next occurrence — which is how a register becomes a list of checks
    // that are switched off.
    const outcome = classifyRepoint(spec, 3, [project()], [entry])
    expect(staleKnownRepointFindings([outcome], [entry])).toEqual([entry])
    expect(repointRunExitCode([outcome], [entry])).toBe(1)
  })

  it('says nothing about an entry whose repository was skipped', () => {
    // Not cloned is not evidence of fixed.
    const skipped: RepointOutcome = { _tag: 'Skipped', spec, reason: 'not cloned' }
    expect(staleKnownRepointFindings([skipped], [entry])).toEqual([])
    expect(repointRunExitCode([skipped], [entry])).toBe(0)
  })

  it('says nothing while the entry still reproduces', () => {
    const outcome = classifyRepoint(spec, 3, [project({ repointed: [diagnostic()] })], [entry])
    expect(staleKnownRepointFindings([outcome], [entry])).toEqual([])
  })

  // Defensive: `classifyRepoint` never puts an item in `known` without a
  // matching registry entry (that is what makes it `known`), but this
  // function's own type signature accepts any `RepointOutcome`, including one
  // assembled by hand rather than by `classifyRepoint`. An item whose `entry`
  // is `undefined` must not be treated as a match for anything.
  it('does not treat an undefined entry as a match for a registry fingerprint', () => {
    const handAssembled: RepointOutcome = {
      _tag: 'Repointed',
      spec,
      rewrites: 3,
      projects: [project()],
      introduced: [],
      known: [{ project: 'tsconfig.test.json', diagnostic: diagnostic(), entry: undefined }],
    }
    expect(staleKnownRepointFindings([handAssembled], [entry])).toEqual([entry])
  })
})

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

describe('describeRepointRun', () => {
  it('always states how many were skipped, even when none were', () => {
    // A gate that silently skipped three of three looks exactly like a gate
    // that passed three of three.
    const lines = describeRepointRun([classifyRepoint(spec, 3, [project()], [])], []).join('\n')
    expect(lines).toContain('repointed and compiled 1 of 1 mirror(s) (0 skipped)')
  })

  it('explains an empty run rather than reporting success', () => {
    const lines = describeRepointRun([{ _tag: 'Skipped', spec, reason: 'not cloned' }], []).join('\n')
    expect(lines).toContain('nothing to repoint — 0 of 1 could be attempted')
    expect(lines).toContain('This is not a failure')
    expect(lines).toContain('mx-gameplay/domain/frame-contract.ts — not cloned')
  })

  it('names the package, the rewrite count and every project compiled', () => {
    const lines = describeRepointRun(
      [
        classifyRepoint(
          spec,
          13,
          [project({ project: 'tsconfig.build.json' }), project({ project: 'tsconfig.test.json' })],
          [],
        ),
      ],
      [],
    ).join('\n')
    expect(lines).toContain('-> @nerima-games/mc-kernel')
    expect(lines).toContain('13 import(s) rewritten')
    expect(lines).toContain('tsconfig.build.json, tsconfig.test.json')
  })

  it('says so when nothing was compiled', () => {
    const lines = describeRepointRun([classifyRepoint(spec, 3, [], [])], []).join('\n')
    expect(lines).toContain('FAIL')
    expect(lines).toContain('No project was compiled')
    expect(lines).toContain('proved nothing')
  })

  it('prints an introduced error with its file, position and code', () => {
    const lines = describeRepointRun(
      [classifyRepoint(spec, 3, [project({ repointed: [diagnostic()] })], [])],
      [],
    ).join('\n')
    expect(lines).toContain('FAIL')
    expect(lines).toContain('test/support/frame-runner.ts(65,3)')
    expect(lines).toContain('TS2375')
  })

  it('groups several occurrences under one register entry and counts them', () => {
    // Line and column are out of the fingerprint, so one entry can match many
    // occurrences. Printing the entry once per occurrence would misreport how
    // many distinct defects there are.
    const entry: KnownRepointFinding = {
      fingerprint: fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic()),
      summary: 'the frame runner provides no ClockPort',
      owner: 'mx-gameplay',
      fix: 'provide one',
    }
    const lines = describeRepointRun(
      [
        classifyRepoint(
          spec,
          3,
          [project({ repointed: [diagnostic(), diagnostic({ line: 120 })] })],
          [entry],
        ),
      ],
      [entry],
    ).join('\n')
    expect(lines).toContain('(2 occurrence(s))')
    expect(lines).toContain('owner: mx-gameplay')
    expect(lines).toContain('KNOWN')
  })

  it('prints nothing, in the known-error section, for a registry entry with zero occurrences this run', () => {
    // REGRESSION: the loop below is grouped BY REGISTRY ENTRY, not by
    // occurrence, so it has to actively skip an entry with zero matches
    // rather than print an empty "(0 occurrence(s))" section for it. Scoped to
    // a repository this run never touches at all, so the SEPARATE staleness
    // report (`staleKnownRepointFindings`, tested above) does not also print
    // its summary and make this assertion pass for the wrong reason.
    const reproducing: KnownRepointFinding = {
      fingerprint: fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic()),
      summary: 'the frame runner provides no ClockPort',
      owner: 'mx-gameplay',
      fix: 'provide one',
    }
    const otherSpec: RepointSpec = { ...spec, repository: 'mx-redstone', file: 'domain/other-port.ts' }
    const notInThisRun: KnownRepointFinding = {
      fingerprint: fingerprintDiagnostic(otherSpec, 'tsconfig.test.json', diagnostic()),
      summary: 'a defect belonging to a repository this run never attempts',
      owner: 'mx-redstone',
      fix: 'irrelevant to this test',
    }
    const lines = describeRepointRun(
      [classifyRepoint(spec, 3, [project({ repointed: [diagnostic()] })], [reproducing, notInThisRun])],
      [reproducing, notInThisRun],
    ).join('\n')

    expect(lines).toContain('the frame runner provides no ClockPort')
    expect(lines).not.toContain('a defect belonging to a repository this run never attempts')
  })

  it('tells the reader to delete a register entry that stopped reproducing', () => {
    const entry: KnownRepointFinding = {
      fingerprint: fingerprintDiagnostic(spec, 'tsconfig.test.json', diagnostic()),
      summary: 'the frame runner provides no ClockPort',
      owner: 'mx-gameplay',
      fix: 'provide one',
    }
    const lines = describeRepointRun([classifyRepoint(spec, 3, [project()], [entry])], [entry]).join(
      '\n',
    )
    expect(lines).toContain('did NOT reproduce')
    expect(lines).toContain('must be deleted')
  })
})

// ---------------------------------------------------------------------------
// The committed register
// ---------------------------------------------------------------------------

describe('KNOWN_REPOINT_FINDINGS', () => {
  it('records every entry against a repoint this gate actually performs', () => {
    // An entry whose repository is not in REPOINT_SPECS can never be shown to
    // be stale, so it would suppress forever.
    const prefixes = REPOINT_SPECS.map((candidate) => `${repointPath(candidate)}|`)
    for (const entry of KNOWN_REPOINT_FINDINGS) {
      expect(
        prefixes.some((prefix) => entry.fingerprint.startsWith(prefix)),
        `${entry.summary} is fingerprinted against no repoint spec`,
      ).toBe(true)
    }
  })

  it('gives every entry an owner and a fix', () => {
    for (const entry of KNOWN_REPOINT_FINDINGS) {
      expect(entry.owner.length, entry.summary).toBeGreaterThan(0)
      expect(entry.fix.length, entry.summary).toBeGreaterThan(0)
      expect(entry.summary.length).toBeGreaterThan(0)
    }
  })

  it('holds no duplicate fingerprints', () => {
    const seen = new Set(KNOWN_REPOINT_FINDINGS.map((entry) => entry.fingerprint))
    expect(seen.size).toBe(KNOWN_REPOINT_FINDINGS.length)
  })
})
