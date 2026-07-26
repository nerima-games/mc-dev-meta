/**
 * The cross-repository dependency gate's own tests.
 *
 * This file is the sister of the one in the other 15 repositories, with one
 * difference: it uses PLAIN vitest rather than the `it.effect` form.
 *
 * mc-dev-meta has no runtime dependencies at all — not even `effect` — because
 * it is the tool that fetches the packages and therefore cannot be
 * bootstrapped from them (see domain/manifest.ts). Wrapping a synchronous
 * assertion in an Effect would add nothing here, so the cases below are plain
 * `it`. Everything else is identical to the sister copies, deliberately, so
 * the files can still be diffed against one another.
 */
import { describe, expect, it } from 'vitest'
import {
  allowedDirectDependencies,
  checkDeclaredDependencies,
  checkPolicyConfiguration,
  classifyImport,
  extractOrgPackageName,
  findBannedTimeSources,
  findCycles,
  findTransitivePath,
  isToolingOrTestPath,
  maskSource,
  parseImports,
  REPOSITORY_POLICY,
  type DeclaredDependencies,
} from '../scripts/check-dependency-whitelist'

const NOTHING_DECLARED: DeclaredDependencies = {
  dependencies: new Set<string>(),
  devDependencies: new Set<string>(),
}

const graph = (entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): Map<string, ReadonlySet<string>> =>
  new Map(entries.map(([node, targets]) => [node, new Set(targets)]))

describe('mc-dev-meta dependency policy', () => {
  it('depends on nothing: a tool that clones all 15 repositories cannot be one of them', () => {
    expect(REPOSITORY_POLICY.thisPackage).toBe('@nerima-games/mc-dev-meta')
    expect([...allowedDirectDependencies()]).toStrictEqual([])
  })

  it('has an internally consistent configuration, so the gate itself cannot be quietly broken', () => {
    expect(checkPolicyConfiguration()).toStrictEqual([])
  })

  // REGRESSION: "the roster is complete". The graph is a mirror of 16
  // repositories; a missing row makes every import of the absent package fail
  // as `unknown-package`, and — worse — makes a cycle through it invisible.
  it('carries all 16 repositories of the roster, not just this one', () => {
    expect([...REPOSITORY_POLICY.dependencyGraph.keys()].sort()).toStrictEqual([
      '@nerima-games/mc-audio',
      '@nerima-games/mc-compose',
      '@nerima-games/mc-dev-meta',
      '@nerima-games/mc-kernel',
      '@nerima-games/mc-meshing',
      '@nerima-games/mc-noise',
      '@nerima-games/mc-physics',
      '@nerima-games/mc-playground-kit',
      '@nerima-games/mc-render',
      '@nerima-games/mc-save',
      '@nerima-games/mc-sim',
      '@nerima-games/mc-worldgen',
      '@nerima-games/mx-gameplay',
      '@nerima-games/mx-multiplayer',
      '@nerima-games/mx-redstone',
      '@nerima-games/mx-ui',
    ])
  })

  // REGRESSION: plan.md §2.3-1 — the four experience modules have zero edges
  // between them. "mining puts an item in the inventory" goes through mc-sim's
  // InventoryService, not through an mx-gameplay -> mx-ui import.
  it('records no edge between any two experience modules', () => {
    const experience = [
      '@nerima-games/mx-gameplay',
      '@nerima-games/mx-redstone',
      '@nerima-games/mx-ui',
      '@nerima-games/mx-multiplayer',
    ]
    for (const module of experience) {
      for (const target of REPOSITORY_POLICY.dependencyGraph.get(module) ?? []) {
        expect(experience).not.toContain(target)
      }
    }
  })

  // REGRESSION: mc-kernel is universally importable, which is expressed by its
  // ABSENCE from every row. `checkPolicyConfiguration` rejects a graph that
  // names it; this pins the intent so the rule is not "fixed" by adding it.
  it('never names mc-kernel as an edge, because it is importable everywhere', () => {
    for (const targets of REPOSITORY_POLICY.dependencyGraph.values()) {
      expect([...targets]).not.toContain('@nerima-games/mc-kernel')
    }
  })

  // REGRESSION: plan.md §3.10 / §2.3-2 — mc-playground-kit is devDependency
  // only. A runtime edge to it would delete input handling from the shipped
  // build, so it must appear in no row's value set at all.
  it('never names mc-playground-kit as a runtime edge', () => {
    for (const targets of REPOSITORY_POLICY.dependencyGraph.values()) {
      expect([...targets]).not.toContain('@nerima-games/mc-playground-kit')
    }
  })

  it('declares a graph with no cycles anywhere in the roster', () => {
    expect(findCycles(REPOSITORY_POLICY.dependencyGraph)).toStrictEqual([])
  })
})

describe('mc-dev-meta imports nothing from the roster', () => {
  const from = (importedPackage: string) => ({
    importedPackage,
    filePath: 'domain/sync-plan.ts',
    line: 1,
    isToolingOrTest: false,
  })

  const declaredNothing: DeclaredDependencies = {
    dependencies: new Set<string>(),
    devDependencies: new Set<string>(),
  }

  // REGRESSION: "the workspace binder is not a workspace member". If
  // mc-dev-meta depended on a game repository, bootstrapping would require the
  // very packages it exists to fetch.
  it('rejects importing any game repository, kernel included when undeclared', () => {
    expect(classifyImport(from('@nerima-games/mc-sim'), declaredNothing)?.rule).toBe('not-whitelisted')
    expect(classifyImport(from('@nerima-games/mc-compose'), declaredNothing)?.rule).toBe('not-whitelisted')
    expect(classifyImport(from('@nerima-games/mc-kernel'), declaredNothing)?.rule).toBe(
      'undeclared-dependency',
    )
  })
})

describe('cycle rejection', () => {
  it('rejects a two-node cycle outright — there is no co-evolution allowlist in this project', () => {
    const violations = findCycles(graph([['a', ['b']], ['b', ['a']]]))
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]?.rule).toBe('cycle')
    expect(violations[0]?.message).toContain('->')
  })

  it('rejects a longer cycle and names the path it found', () => {
    const violations = findCycles(graph([['a', ['b']], ['b', ['c']], ['c', ['a']]]))
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]?.message).toContain('a -> b -> c -> a')
  })

  it('accepts a diamond, because a DAG with a shared descendant is not a cycle', () => {
    const violations = findCycles(
      graph([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']], ['d', []]]),
    )
    expect(violations).toStrictEqual([])
  })

  it('accepts an empty graph and the single-node kernel graph', () => {
    expect(findCycles(graph([]))).toStrictEqual([])
    expect(findCycles(graph([['@nerima-games/mc-kernel', []]]))).toStrictEqual([])
  })
})

describe('transitive closure', () => {
  it('findTransitivePath produces the chain that explains why an import is not licensed', () => {
    const declared = graph([
      ['@nerima-games/mc-app', ['@nerima-games/mc-sim']],
      ['@nerima-games/mc-sim', ['@nerima-games/mc-physics']],
      ['@nerima-games/mc-physics', []],
    ])

    expect(findTransitivePath(declared, '@nerima-games/mc-app', '@nerima-games/mc-physics')).toStrictEqual([
      '@nerima-games/mc-app',
      '@nerima-games/mc-sim',
      '@nerima-games/mc-physics',
    ])
  })

  it('findTransitivePath returns undefined when there is no path at all', () => {
    const declared = graph([['a', ['b']], ['b', []], ['c', []]])
    expect(findTransitivePath(declared, 'a', 'c')).toBeUndefined()
  })
})

describe('classifyImport', () => {
  const site = (importedPackage: string, isToolingOrTest = false) => ({
    importedPackage,
    filePath: isToolingOrTest ? 'test/example.test.ts' : 'domain/example.ts',
    line: 3,
    isToolingOrTest,
  })

  it('rejects importing this package by name instead of relatively', () => {
    const violation = classifyImport(site('@nerima-games/mc-dev-meta'), NOTHING_DECLARED)
    expect(violation?.rule).toBe('self-import')
  })

  it('rejects an org package that is not in the declared graph, so the gate fails closed', () => {
    const violation = classifyImport(site('@nerima-games/mc-does-not-exist'), NOTHING_DECLARED)
    expect(violation?.rule).toBe('unknown-package')
    expect(violation?.filePath).toBe('domain/example.ts')
    expect(violation?.line).toBe(3)
  })

  it('rejects mc-playground-kit imported from shipped source, with the reason spelled out', () => {
    const violation = classifyImport(site('@nerima-games/mc-playground-kit'), {
      dependencies: new Set<string>(),
      devDependencies: new Set(['@nerima-games/mc-playground-kit']),
    })
    expect(violation?.rule).toBe('dev-only-package-in-shipped-source')
    expect(violation?.message).toContain('input handling')
  })

  it('allows mc-playground-kit from a test file when it is declared in devDependencies', () => {
    const violation = classifyImport(site('@nerima-games/mc-playground-kit', true), {
      dependencies: new Set<string>(),
      devDependencies: new Set(['@nerima-games/mc-playground-kit']),
    })
    expect(violation).toBeUndefined()
  })

  it('still requires an otherwise-allowed import to be declared in package.json', () => {
    const violation = classifyImport(site('@nerima-games/mc-playground-kit', true), NOTHING_DECLARED)
    expect(violation?.rule).toBe('undeclared-dependency')
  })
})

describe('checkDeclaredDependencies', () => {
  it('rejects @nerima-games/mc-playground-kit in "dependencies", because it is devDependency-only', () => {
    const violations = checkDeclaredDependencies({
      dependencies: new Set(['effect', '@nerima-games/mc-playground-kit']),
      devDependencies: new Set<string>(),
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('dev-only-package-in-dependencies')
    expect(violations[0]?.message).toContain('input handling')
  })

  it('accepts @nerima-games/mc-playground-kit in "devDependencies"', () => {
    const violations = checkDeclaredDependencies({
      dependencies: new Set(['effect']),
      devDependencies: new Set(['@nerima-games/mc-playground-kit', 'vitest']),
    })
    expect(violations).toStrictEqual([])
  })

  it('rejects an org dependency the policy does not allow, even if the code never imports it', () => {
    const violations = checkDeclaredDependencies({
      dependencies: new Set(['@nerima-games/mc-sim']),
      devDependencies: new Set<string>(),
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('undeclared-in-policy')
  })

  it('ignores non-org dependencies entirely', () => {
    const violations = checkDeclaredDependencies({
      dependencies: new Set(['effect', 'three']),
      devDependencies: new Set(['vitest', 'oxlint']),
    })
    expect(violations).toStrictEqual([])
  })
})

describe('maskSource', () => {
  it('preserves length and line structure, so offsets stay valid against the original', () => {
    const source = ['const a = "text"', '// comment', '/* block */', 'const b = `tpl`'].join('\n')
    const masked = maskSource(source)
    expect(masked).toHaveLength(source.length)
    expect(masked.split('\n')).toHaveLength(4)
  })

  it('blanks comment bodies and string interiors while keeping the delimiters', () => {
    expect(maskSource('const a = "hello"')).toBe('const a = "     "')
    expect(maskSource('const a = 1 // why')).toBe('const a = 1       ')
  })

  it('keeps `${...}` interpolations as live code inside a template literal', () => {
    expect(maskSource('`x${ y }z`')).toBe('` ${ y } `')
  })
})

describe('import extraction', () => {
  it('finds single-line, multi-line, side-effect, re-export and dynamic imports', () => {
    const source = [
      "import { a } from '@nerima-games/mc-alpha'",
      'import {',
      '  b,',
      "} from '@nerima-games/mc-beta'",
      "import '@nerima-games/mc-gamma'",
      "export * from '@nerima-games/mc-delta'",
      "const later = await import('@nerima-games/mc-epsilon')",
    ].join('\n')

    const specifiers = parseImports(source).map((record) => record.specifier)

    expect(specifiers).toContain('@nerima-games/mc-alpha')
    expect(specifiers).toContain('@nerima-games/mc-beta')
    expect(specifiers).toContain('@nerima-games/mc-gamma')
    expect(specifiers).toContain('@nerima-games/mc-delta')
    expect(specifiers).toContain('@nerima-games/mc-epsilon')
  })

  it('ignores imports that only appear inside comments', () => {
    const source = [
      "// import { a } from '@nerima-games/mc-commented-out'",
      '/*',
      " import { b } from '@nerima-games/mc-block-commented'",
      '*/',
      "import { c } from '@nerima-games/mc-real'",
    ].join('\n')

    const specifiers = parseImports(source).map((record) => record.specifier)
    expect(specifiers).toStrictEqual(['@nerima-games/mc-real'])
  })

  it('reports the line an import was found on', () => {
    const source = ['const x = 1', '', "import { a } from '@nerima-games/mc-alpha'"].join('\n')
    expect(parseImports(source)[0]?.line).toBe(3)
  })

  it('maps a deep specifier back to the package that owns it', () => {
    expect(extractOrgPackageName('@nerima-games/mc-sim/domain/tick')).toBe('@nerima-games/mc-sim')
    expect(extractOrgPackageName('@nerima-games/mc-sim')).toBe('@nerima-games/mc-sim')
    expect(extractOrgPackageName('effect')).toBeUndefined()
    expect(extractOrgPackageName('./relative')).toBeUndefined()
    expect(extractOrgPackageName('@other-scope/thing')).toBeUndefined()
  })
})

describe('the Date.now() ban', () => {
  const banned = (source: string) => findBannedTimeSources(source, 'domain/example.ts')

  // NOTE: every fixture below is a string literal, so the checker's own scan of
  // this file masks it out. If one of these ever starts failing `pnpm check:deps`
  // that is a genuine bug in maskSource, not a problem with the test.

  it('flags a bare wall-clock read, which oxlint 0.12 cannot express as a rule', () => {
    const violations = banned('const t = Date.now()')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('banned-time-source')
    expect(violations[0]?.message).toContain('ClockPort')
  })

  it('flags new Date() and performance.now() as the same class of violation', () => {
    expect(banned('const t = new Date()')).toHaveLength(1)
    expect(banned('const t = performance.now()')).toHaveLength(1)
  })

  it('does not flag a mention inside a line comment', () => {
    expect(banned('// never call Date.now() here')).toStrictEqual([])
  })

  it('does not flag a mention inside a string literal', () => {
    expect(banned('const message = "Date.now() is banned"')).toStrictEqual([])
  })

  it('does not flag a mention inside a regex literal', () => {
    expect(banned('const pattern = /Date\\.now\\(/u')).toStrictEqual([])
  })

  it('does flag a call hidden inside a template literal interpolation', () => {
    expect(banned('const message = `at ${Date.now()}`')).toHaveLength(1)
  })

  it('honours the escape hatch, which exists for the one adapter that implements the clock Port', () => {
    expect(banned('const t = Date.now() // mc-kernel-allow-time-source: this IS the adapter')).toStrictEqual([])
  })

  it('reports the line the call was on', () => {
    expect(banned(['const a = 1', 'const b = 2', 'const t = Date.now()'].join('\n'))[0]?.line).toBe(3)
  })

  it('does not mistake division for a regex literal and blank the rest of the file', () => {
    const source = ['const half = total / 2', 'const third = total / 3', 'const t = Date.now()'].join('\n')
    expect(banned(source)).toHaveLength(1)
  })
})

describe('shipped vs tooling source classification', () => {
  it('treats index.ts and domain/ as shipped, and everything else as tooling or tests', () => {
    expect(isToolingOrTestPath('index.ts')).toBe(false)
    expect(isToolingOrTestPath('domain/sync-plan.ts')).toBe(false)
    expect(isToolingOrTestPath('test/sync-plan.test.ts')).toBe(true)
    expect(isToolingOrTestPath('scripts/check-dependency-whitelist.ts')).toBe(true)
  })
})
