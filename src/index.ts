/**
 * @nerima-games/mc-dev-meta — workspace contracts and verification decisions.
 *
 * The barrel exposes pure manifest, roster, workspace, feature-inventory, and
 * portable voxel/light data contracts. Runtime repository dependencies remain outside
 * this package so a fresh checkout can bootstrap the repositories it verifies.
 * Filesystem, git, and process boundaries live in `scripts/`; the exported
 * modules stay deterministic and directly testable. See docs/workflow.md.
 */

export * from './domain/manifest'
export * from './domain/feature-inventory'
export * from './domain/light-grid'
export * from './domain/voxel-chunk'
// The pin decision — what `pnpm update:manifest` writes and what it refuses to.
// Exported for the same reason `domain/sync-plan.ts` is: the two are halves of
// one loop (repos/ <- pin, pin <- repos/), and publishing one half while hiding
// the other is how the two came to be reasoned about separately in the first
// place. See docs/manifest.md §5.
export * from './domain/pin-plan'
export * from './domain/repository-roster'
export * from './domain/sync-plan'
export * from './domain/workspace'

// NOT re-exported, deliberately: this barrel is the WORKSPACE BINDER's surface
// (docs/public-api.md), and `domain/mirror-contract.ts` + `domain/type-shape.ts`
// are the decision layer of a CHECK — `pnpm check:mirrors`. They are typechecked
// by tsconfig.build.json and unit-tested like everything else in domain/; they
// are simply not part of what this package would offer a consumer if it were
// ever published.
//
// `domain/toolchain.ts`, `domain/toolchain-audit.ts` and `domain/pin-audit.ts`
// are excluded for the same reason: the data and decision layers of
// `pnpm check:toolchain` / `pnpm check:pins`, not part of the binder's own
// public surface.
