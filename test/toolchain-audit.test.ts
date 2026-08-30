import { describe, expect, it } from 'vitest'
import { auditOne, auditToolchain, type ToolchainObservation, type ToolchainPackageJson } from '../src/domain/toolchain-audit'
import { TOOLCHAIN } from '../src/domain/toolchain'

/**
 * A `package.json` that satisfies every rule `toolchain-audit.ts` checks.
 * Individual tests below mutate ONE field away from this baseline so that
 * each finding kind can be produced (and every OTHER rule proven silent) in
 * isolation.
 */
const compliantPackageJson = (): ToolchainPackageJson => ({
  engines: { node: TOOLCHAIN.node.engines, pnpm: `>=${TOOLCHAIN.pnpm}` },
  packageManager: `pnpm@${TOOLCHAIN.pnpm}`,
  dependencies: { effect: TOOLCHAIN.dependencies.effect },
  devDependencies: { ...TOOLCHAIN.devDependencies },
  publishConfig: { access: 'public' },
  scripts: { verify: 'pnpm typecheck && pnpm lint && pnpm test' },
})

const compliantFlakeNixText = (): string =>
  TOOLCHAIN.nixPackages.map((name) => `            pkgs.${name}`).join('\n')

const compliantVitestConfigText = (): string =>
  'thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },'

const compliantObservation = (name = 'mc-kernel'): ToolchainObservation => ({
  name,
  packageJson: compliantPackageJson(),
  flakeNixText: compliantFlakeNixText(),
  vitestConfigText: compliantVitestConfigText(),
})

describe('a fully compliant repository', () => {
  // REGRESSION: proves the baseline fixture other tests mutate is itself
  // clean, so a finding appearing in a mutated test is attributable to the
  // mutation and not to a stray defect in the baseline.
  it('produces zero findings', () => {
    expect(auditOne(compliantObservation())).toStrictEqual([])
  })
})

describe('engines and packageManager', () => {
  it('flags engines.node when it does not match the table exactly', () => {
    const observation = compliantObservation()
    const packageJson = {
      ...observation.packageJson,
      engines: { ...observation.packageJson.engines, node: '>=20.0.0' },
    }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'engines.node', expected: TOOLCHAIN.node.engines, actual: '>=20.0.0' },
    ])
  })

  it('flags engines.pnpm when it does not match the table exactly', () => {
    const observation = compliantObservation()
    const packageJson = {
      ...observation.packageJson,
      engines: { ...observation.packageJson.engines, pnpm: '>=11.0.0' },
    }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'engines.pnpm', expected: `>=${TOOLCHAIN.pnpm}`, actual: '>=11.0.0' },
    ])
  })

  it('flags packageManager when it does not match the table exactly', () => {
    const observation = compliantObservation()
    const packageJson = { ...observation.packageJson, packageManager: 'pnpm@11.0.0' }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'packageManager', expected: `pnpm@${TOOLCHAIN.pnpm}`, actual: 'pnpm@11.0.0' },
    ])
  })
})

describe('required devDependencies', () => {
  it('flags a table devDependency missing from the repository', () => {
    const observation = compliantObservation()
    const { knip: _knip, ...rest } = observation.packageJson.devDependencies as Record<string, string>
    const packageJson = { ...observation.packageJson, devDependencies: rest }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'devDependency:knip', expected: TOOLCHAIN.devDependencies.knip, actual: '(missing)' },
    ])
  })

  it('flags a table devDependency present at the wrong version', () => {
    const observation = compliantObservation()
    const packageJson = {
      ...observation.packageJson,
      devDependencies: { ...observation.packageJson.devDependencies, vitest: '3.2.7' },
    }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'devDependency:vitest', expected: TOOLCHAIN.devDependencies.vitest, actual: '3.2.7' },
    ])
  })
})

describe('the dependencies.effect pin', () => {
  it('flags effect missing from dependencies', () => {
    const observation = compliantObservation()
    const packageJson = { ...observation.packageJson, dependencies: {} }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      {
        repo: 'mc-kernel',
        rule: 'dependencies.effect',
        expected: TOOLCHAIN.dependencies.effect,
        actual: '(missing)',
      },
    ])
  })

  it('flags effect present at the wrong version', () => {
    const observation = compliantObservation()
    const packageJson = { ...observation.packageJson, dependencies: { effect: '3.20.0' } }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      {
        repo: 'mc-kernel',
        rule: 'dependencies.effect',
        expected: TOOLCHAIN.dependencies.effect,
        actual: '3.20.0',
      },
    ])
  })
})

describe('optional devDependencies', () => {
  // REGRESSION: the baseline fixture never declares an `optional` entry, and
  // the "fully compliant" test above already proved that produces zero
  // findings — an optional dependency's ABSENCE must never be reported.
  it('says nothing when an optional dependency is simply absent', () => {
    expect(TOOLCHAIN.optional.vite).toBeDefined()
    expect(compliantPackageJson().devDependencies).not.toHaveProperty('vite')
  })

  it('says nothing when a present optional dependency matches the table exactly', () => {
    const observation = compliantObservation()
    const packageJson = {
      ...observation.packageJson,
      devDependencies: { ...observation.packageJson.devDependencies, vite: TOOLCHAIN.optional.vite },
    }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([])
  })

  it('flags a present optional dependency at the wrong version', () => {
    const observation = compliantObservation()
    const packageJson = {
      ...observation.packageJson,
      devDependencies: { ...observation.packageJson.devDependencies, vite: '7.0.0' },
    }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'devDependency:vite', expected: TOOLCHAIN.optional.vite, actual: '7.0.0' },
    ])
  })

  // REGRESSION: `tsx` moved from `devDependencies` (table-wide required) to
  // `optional` — plan.md §2.2's row note ("scripts/ か apps/ を tsx で
  // 走らせる repo のみ") is the resolved intent, not plan.md §4 item 1's
  // literal sketch. A repository that never runs anything through tsx must
  // produce zero findings for it.
  it('says nothing about tsx when the repository does not declare it', () => {
    expect(TOOLCHAIN.optional.tsx).toBeDefined()
    expect(compliantPackageJson().devDependencies).not.toHaveProperty('tsx')
    expect(auditOne(compliantObservation())).toStrictEqual([])
  })

  it('flags tsx at the wrong version only when the repository already declares it', () => {
    const observation = compliantObservation()
    const packageJson = {
      ...observation.packageJson,
      devDependencies: { ...observation.packageJson.devDependencies, tsx: '3.0.0' },
    }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'devDependency:tsx', expected: TOOLCHAIN.optional.tsx, actual: '3.0.0' },
    ])
  })
})

describe('forbidden packages', () => {
  it('flags a package name that is itself forbidden', () => {
    const observation = compliantObservation()
    const packageJson = {
      ...observation.packageJson,
      devDependencies: { ...observation.packageJson.devDependencies, oxlint: '^0.12.0' },
    }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'forbidden:oxlint', expected: '(absent)', actual: 'present (^0.12.0)' },
    ])
  })

  // REGRESSION: the alias can survive under a NAME that is not itself on the
  // forbidden list — the historical shape was `@typescript/native:
  // npm:typescript@7.0.2` and `typescript6@6.0.2`. This checks the value
  // substring path independently of the name-based path above.
  it('flags a typescript alias by its version-string substring, under an unlisted key', () => {
    const observation = compliantObservation()
    const packageJson = {
      ...observation.packageJson,
      devDependencies: {
        ...observation.packageJson.devDependencies,
        'legacy-ts-alias': 'npm:typescript6@6.0.2',
      },
    }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      {
        repo: 'mc-kernel',
        rule: 'forbidden:legacy-ts-alias',
        expected: '(absent)',
        actual: 'present (npm:typescript6@6.0.2)',
      },
    ])
  })
})

describe('flake.nix nixPackages', () => {
  it('flags a nixPackages entry missing from flake.nix text', () => {
    const observation = compliantObservation()
    const flakeNixText = TOOLCHAIN.nixPackages
      .filter((name) => name !== 'ast-grep')
      .map((name) => `pkgs.${name}`)
      .join('\n')
    expect(auditOne({ ...observation, flakeNixText })).toStrictEqual([
      {
        repo: 'mc-kernel',
        rule: 'flake.nixPackage:ast-grep',
        expected: 'pkgs.ast-grep present in flake.nix',
        actual: '(absent)',
      },
    ])
  })
})

describe('vitest coverage thresholds', () => {
  it('flags a coverage metric missing its 100 threshold', () => {
    const observation = compliantObservation()
    const vitestConfigText = 'thresholds: { branches: 100, functions: 100, lines: 100 },'
    expect(auditOne({ ...observation, vitestConfigText })).toStrictEqual([
      {
        repo: 'mc-kernel',
        rule: 'vitest.threshold.statements',
        expected: `statements: ${TOOLCHAIN.coverageThreshold}`,
        actual: 'not found in vitest.config.ts',
      },
    ])
  })
})

describe('publishConfig.access', () => {
  it('flags publishConfig.access when it is not "public"', () => {
    const observation = compliantObservation()
    const packageJson = { ...observation.packageJson, publishConfig: { access: 'restricted' } }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      { repo: 'mc-kernel', rule: 'publishConfig.access', expected: 'public', actual: 'restricted' },
    ])
  })
})

describe('scripts.verify', () => {
  it('flags scripts.verify when it does not match the standard shape exactly', () => {
    const observation = compliantObservation()
    const packageJson = { ...observation.packageJson, scripts: { verify: 'pnpm test' } }
    expect(auditOne({ ...observation, packageJson })).toStrictEqual([
      {
        repo: 'mc-kernel',
        rule: 'scripts.verify',
        expected: 'pnpm typecheck && pnpm lint && pnpm test',
        actual: 'pnpm test',
      },
    ])
  })
})

describe('a repository declaring nothing at all', () => {
  // REGRESSION: every `?? '(missing)'` / `?? '(absent)'` fallback in
  // toolchain-audit.ts is exercised together here, against a package.json
  // and flake.nix/vitest.config.ts that are all empty — the state of a
  // repository that has not started adopting the pin table yet. Every rule
  // must produce a finding; none may throw on the absent fields.
  it('produces a finding for every rule, with no crash on absent fields', () => {
    const observation: ToolchainObservation = {
      name: 'mc-unstarted',
      packageJson: {},
      flakeNixText: '',
      vitestConfigText: '',
    }
    const findings = auditOne(observation)
    const rules = findings.map((finding) => finding.rule)

    expect(rules).toContain('engines.node')
    expect(rules).toContain('engines.pnpm')
    expect(rules).toContain('packageManager')
    expect(rules).toContain('dependencies.effect')
    expect(rules).toContain('publishConfig.access')
    expect(rules).toContain('scripts.verify')
    for (const name of Object.keys(TOOLCHAIN.devDependencies)) {
      expect(rules).toContain(`devDependency:${name}`)
    }
    for (const name of TOOLCHAIN.nixPackages) {
      expect(rules).toContain(`flake.nixPackage:${name}`)
    }
    for (const metric of ['branches', 'functions', 'lines', 'statements']) {
      expect(rules).toContain(`vitest.threshold.${metric}`)
    }
    // Nothing was declared, so nothing can be forbidden and nothing optional
    // can be present at the wrong version.
    expect(rules.filter((rule) => rule.startsWith('forbidden:'))).toStrictEqual([])
  })
})

describe('auditToolchain over several repositories', () => {
  it('flattens findings across repositories, tagged with the right repo name', () => {
    const clean = compliantObservation('mc-noise')
    const dirty = {
      ...compliantObservation('mc-render'),
      packageJson: { ...compliantPackageJson(), packageManager: 'pnpm@1.0.0' },
    }

    const findings = auditToolchain([clean, dirty])

    expect(findings).toStrictEqual([
      { repo: 'mc-render', rule: 'packageManager', expected: `pnpm@${TOOLCHAIN.pnpm}`, actual: 'pnpm@1.0.0' },
    ])
  })

  it('returns an empty array for an empty observation list', () => {
    expect(auditToolchain([])).toStrictEqual([])
  })
})
