/**
 * Auditing that a downstream repository pins its `@nerima-games/*` siblings
 * to their exact current version. PURE — no filesystem, no network.
 *
 * ---------------------------------------------------------------------------
 * The rule, and why it is exact rather than a range
 * ---------------------------------------------------------------------------
 *
 * "下流は兄弟の現行 version を pin する" (plan.md §4 item 4): every
 * `@nerima-games/<y>` entry in a repository's `dependencies`,
 * `devDependencies`, or `peerDependencies` must equal
 * `repos/<y>/package.json#version` CHARACTER FOR CHARACTER. Not `^y.z.w`, not
 * `~y.z.w`, not `workspace:*` — those are all different strings from the
 * pinned version and fail the equality check on that basis alone, so this
 * module needs no separate "is this a range" parser. A range would let a
 * consumer silently pick up a sibling's next release before anyone reviewed
 * it; an exact pin makes every cross-repository version bump a visible,
 * reviewable diff in the consumer's `package.json`.
 *
 * This is a Wave 1 gate in plan.md's schedule but built in the same session
 * as `domain/toolchain-audit.ts` (plan.md §4 item 4: "Wave 1 のゲートだが同時
 * に作る").
 *
 * ---------------------------------------------------------------------------
 * What "not cloned" means here
 * ---------------------------------------------------------------------------
 *
 * `PinObservation`s are built only from repositories `scripts/check-pins.ts`
 * actually found under `repos/`. A `@nerima-games/<y>` reference where `y`
 * is not among the observations — because it was never cloned, or the name
 * is a typo — cannot be compared against a real current version. That is
 * reported as a finding with `current: "(not cloned)"` rather than silently
 * skipped: an unpinnable reference is not the same as an in-policy one, and
 * `mirror-contract.ts`'s rule applies here too — a check that stays quiet
 * about what it could not verify reports success it has not checked.
 */
import { ORG_SCOPE } from './repository-roster'

export type PinPackageJson = {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

export type PinObservation = {
  readonly name: string
  /** This repository's own `package.json#version` — what a sibling pinning it should match. */
  readonly version: string
  readonly packageJson: PinPackageJson
}

export type PinFinding = {
  readonly repo: string
  /** The `@nerima-games/…` package name as declared, e.g. `@nerima-games/mc-kernel`. */
  readonly dependency: string
  /** The version string `repo` declared. */
  readonly pinned: string
  /** `repos/<y>/package.json#version`, or `(not cloned)` when `y` was not observed. */
  readonly current: string
}

/** The dependency buckets a pin can live in, checked in this order. */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const

/** `@nerima-games/mc-kernel` -> `mc-kernel`; `undefined` for anything outside the org scope. */
const repositoryNameFromPackageName = (packageName: string): string | undefined =>
  packageName.startsWith(`${ORG_SCOPE}/`) ? packageName.slice(ORG_SCOPE.length + 1) : undefined

/**
 * Audit every observed repository's `@nerima-games/*` pins against the
 * current versions declared by the same set of observations.
 */
export const auditPins = (observations: ReadonlyArray<PinObservation>): ReadonlyArray<PinFinding> => {
  const versionByRepo = new Map(observations.map((observation) => [observation.name, observation.version]))
  const findings: Array<PinFinding> = []

  for (const observation of observations) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [packageName, pinned] of Object.entries(observation.packageJson[field] ?? {})) {
        const dependencyRepo = repositoryNameFromPackageName(packageName)
        if (dependencyRepo === undefined) {
          continue
        }

        const current = versionByRepo.get(dependencyRepo)
        if (current === undefined) {
          findings.push({ repo: observation.name, dependency: packageName, pinned, current: '(not cloned)' })
          continue
        }

        if (pinned !== current) {
          findings.push({ repo: observation.name, dependency: packageName, pinned, current })
        }
      }
    }
  }

  return findings
}
