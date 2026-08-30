/**
 * Auditing one repository's toolchain against `domain/toolchain.ts`. PURE —
 * no filesystem, no dynamic import, no network.
 *
 * ---------------------------------------------------------------------------
 * What is compared, and how
 * ---------------------------------------------------------------------------
 *
 * `package.json` is handed over ALREADY PARSED, as a plain object shaped by
 * `ToolchainPackageJson` — unlike `domain/manifest.ts`'s `parseManifest`,
 * this module has no JSON-syntax-error case of its own to report, because a
 * `package.json` that fails to parse is a different, more basic failure than
 * "does not match the pin table" and `scripts/check-toolchain.ts` reports it
 * as such before this function is ever called.
 *
 * `flake.nix` and `vitest.config.ts` stay TEXT rather than being parsed,
 * because both checks against them are "does this substring appear",
 * matching how `scripts/check-mirrors.ts` treats `api-lock.md`: a Nix
 * expression and a vitest config are not JSON, and re-implementing enough of
 * either language to extract a field would be a second, worse parser for a
 * question a regex answers exactly as well.
 *
 * ---------------------------------------------------------------------------
 * Required vs. optional devDependencies
 * ---------------------------------------------------------------------------
 *
 * `TOOLCHAIN.devDependencies` is required, at the exact pinned version, in
 * EVERY audited repository — a missing entry is itself a finding, not a
 * skip. `TOOLCHAIN.optional` is checked only when the repository already
 * declares the name; its absence is never reported. This is the split
 * `TOOLCHAIN` itself draws by bucket — see `domain/toolchain.ts`'s doc
 * comments on `devDependencies` and `optional` for which repositories each
 * entry actually applies to (`tsx`, in particular, is scoped by plan.md
 * §2.2's row note to repositories that run scripts/apps through it, and
 * lives under `optional` for that reason).
 *
 * ---------------------------------------------------------------------------
 * Why a flat finding shape instead of a discriminated union
 * ---------------------------------------------------------------------------
 *
 * `mirror-contract.ts`'s `MirrorFinding` is a union with one arm per failure
 * SHAPE, because its findings compare structured observations (capability
 * sets, type members) that do not reduce to a single expected/actual pair.
 * Every rule here DOES reduce to one: a version string, a substring
 * presence, a threshold. `{ repo, rule, expected, actual }` is what
 * plan.md §4 item 2 asks for, and a union would only be re-deriving what the
 * flat shape already states directly.
 */
import { TOOLCHAIN } from './toolchain'

export type ToolchainPackageJson = {
  readonly engines?: {
    readonly node?: string
    readonly pnpm?: string
  }
  readonly packageManager?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly publishConfig?: {
    readonly access?: string
  }
  readonly scripts?: Readonly<Record<string, string>>
}

export type ToolchainObservation = {
  readonly name: string
  readonly packageJson: ToolchainPackageJson
  readonly flakeNixText: string
  readonly vitestConfigText: string
}

export type ToolchainFinding = {
  readonly repo: string
  /**
   * A stable machine-readable rule id, e.g. `devDependency:vitest` or
   * `vitest.threshold.branches`. Not matched against a fixed union: several
   * rules are parameterised by a name drawn from `TOOLCHAIN` at audit time,
   * and a template-literal type would only restate the string it builds.
   */
  readonly rule: string
  readonly expected: string
  readonly actual: string
}

const MISSING = '(missing)'
const ABSENT = '(absent)'

/** `dependencies` and `devDependencies` merged, for checks that do not care which bucket a name is declared in. */
const declaredVersions = (packageJson: ToolchainPackageJson): ReadonlyMap<string, string> =>
  new Map([
    ...Object.entries(packageJson.dependencies ?? {}),
    ...Object.entries(packageJson.devDependencies ?? {}),
  ])

/** Version-string substrings that mark a `typescript` alias as forbidden even under an unlisted key name. */
const FORBIDDEN_ALIAS_SUBSTRINGS = ['@typescript/native', 'typescript6']

const COVERAGE_METRICS = ['branches', 'functions', 'lines', 'statements'] as const

const auditEngines = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> => {
  const findings: Array<ToolchainFinding> = []

  const nodeExpected = TOOLCHAIN.node.engines
  const nodeActual = observation.packageJson.engines?.node ?? ABSENT
  if (nodeActual !== nodeExpected) {
    findings.push({ repo: observation.name, rule: 'engines.node', expected: nodeExpected, actual: nodeActual })
  }

  const pnpmEnginesExpected = `>=${TOOLCHAIN.pnpm}`
  const pnpmEnginesActual = observation.packageJson.engines?.pnpm ?? ABSENT
  if (pnpmEnginesActual !== pnpmEnginesExpected) {
    findings.push({
      repo: observation.name,
      rule: 'engines.pnpm',
      expected: pnpmEnginesExpected,
      actual: pnpmEnginesActual,
    })
  }

  const packageManagerExpected = `pnpm@${TOOLCHAIN.pnpm}`
  const packageManagerActual = observation.packageJson.packageManager ?? ABSENT
  if (packageManagerActual !== packageManagerExpected) {
    findings.push({
      repo: observation.name,
      rule: 'packageManager',
      expected: packageManagerExpected,
      actual: packageManagerActual,
    })
  }

  return findings
}

const auditRequiredDevDependencies = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> =>
  Object.entries<string>(TOOLCHAIN.devDependencies)
    .map(([name, expected]) => {
      const actual = observation.packageJson.devDependencies?.[name] ?? MISSING
      return actual === expected
        ? undefined
        : { repo: observation.name, rule: `devDependency:${name}`, expected, actual }
    })
    .filter((finding): finding is ToolchainFinding => finding !== undefined)

const auditEffectDependency = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> => {
  const expected = TOOLCHAIN.dependencies.effect
  const actual = observation.packageJson.dependencies?.['effect'] ?? MISSING
  return actual === expected
    ? []
    : [{ repo: observation.name, rule: 'dependencies.effect', expected, actual }]
}

const auditOptionalDependencies = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> => {
  const declared = declaredVersions(observation.packageJson)
  return Object.entries<string>(TOOLCHAIN.optional)
    .map(([name, expected]) => {
      const actual = declared.get(name)
      return actual === undefined || actual === expected
        ? undefined
        : { repo: observation.name, rule: `devDependency:${name}`, expected, actual }
    })
    .filter((finding): finding is ToolchainFinding => finding !== undefined)
}

const auditForbidden = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> => {
  const findings: Array<ToolchainFinding> = []
  for (const [name, version] of declaredVersions(observation.packageJson)) {
    const forbiddenByName = (TOOLCHAIN.forbidden as ReadonlyArray<string>).includes(name)
    const forbiddenByAlias = FORBIDDEN_ALIAS_SUBSTRINGS.some((substring) => version.includes(substring))
    if (forbiddenByName || forbiddenByAlias) {
      findings.push({
        repo: observation.name,
        rule: `forbidden:${name}`,
        expected: ABSENT,
        actual: `present (${version})`,
      })
    }
  }
  return findings
}

const auditFlakeNixPackages = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> =>
  TOOLCHAIN.nixPackages
    .filter((name) => !observation.flakeNixText.includes(name))
    .map((name) => ({
      repo: observation.name,
      rule: `flake.nixPackage:${name}`,
      expected: `pkgs.${name} present in flake.nix`,
      actual: ABSENT,
    }))

const thresholdPattern = (metric: string): RegExp =>
  new RegExp(`\\b${metric}\\s*:\\s*${TOOLCHAIN.coverageThreshold}\\b`, 'u')

const auditVitestThresholds = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> =>
  COVERAGE_METRICS.filter((metric) => !thresholdPattern(metric).test(observation.vitestConfigText)).map(
    (metric) => ({
      repo: observation.name,
      rule: `vitest.threshold.${metric}`,
      expected: `${metric}: ${TOOLCHAIN.coverageThreshold}`,
      actual: 'not found in vitest.config.ts',
    }),
  )

const auditPublishConfig = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> => {
  const expected = 'public'
  const actual = observation.packageJson.publishConfig?.access ?? MISSING
  return actual === expected
    ? []
    : [{ repo: observation.name, rule: 'publishConfig.access', expected, actual }]
}

const auditVerifyScript = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> => {
  const expected = 'pnpm typecheck && pnpm lint && pnpm test'
  const actual = observation.packageJson.scripts?.['verify'] ?? MISSING
  return actual === expected ? [] : [{ repo: observation.name, rule: 'scripts.verify', expected, actual }]
}

/**
 * Audit one repository against the pin table. Findings are returned in rule
 * order, not severity order — there is no severity axis here, every finding
 * is "out of policy".
 */
export const auditOne = (observation: ToolchainObservation): ReadonlyArray<ToolchainFinding> => [
  ...auditEngines(observation),
  ...auditRequiredDevDependencies(observation),
  ...auditEffectDependency(observation),
  ...auditOptionalDependencies(observation),
  ...auditForbidden(observation),
  ...auditFlakeNixPackages(observation),
  ...auditVitestThresholds(observation),
  ...auditPublishConfig(observation),
  ...auditVerifyScript(observation),
]

/** Audit every observed repository, in the order given, and flatten the findings. */
export const auditToolchain = (
  observations: ReadonlyArray<ToolchainObservation>,
): ReadonlyArray<ToolchainFinding> => observations.flatMap(auditOne)
