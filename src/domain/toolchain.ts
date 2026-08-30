/**
 * The org-wide toolchain pin table (plan.md §2.2, Wave 0). DATA ONLY — no
 * functions, no I/O. `domain/toolchain-audit.ts` is the pure decision layer
 * that reads this table; `scripts/check-toolchain.ts` is the impure shell that
 * feeds it real repositories.
 *
 * ---------------------------------------------------------------------------
 * Why this is a single frozen object instead of fifteen hand-edited files
 * ---------------------------------------------------------------------------
 *
 * Before Wave 0 each of the 15 runtime repositories pinned its own toolchain
 * independently, and they drifted — a different vitest minor here, a
 * `typescript6` alias surviving there. This table is the ONE place the org
 * states what "in policy" means; a change here is a PR here, followed by one
 * W0-equivalent PR per repository (see docs/toolchain.md). The table is never
 * read or written by any of the 15 repositories themselves — only by this
 * repository's audit, because they are not a dependency of `mc-dev-meta` and
 * `mc-dev-meta` is not a dependency of them (plan.md keeps this repository
 * outside the game graph; see `domain/repository-roster.ts`).
 *
 * `knip`'s version was resolved by running `npm view knip version` on the day
 * this table was written (2026-08-30) rather than guessed, because an
 * unpinned "latest" entry in an EXACT-VERSION table would be a contradiction
 * baked into the data itself.
 */

/** The toolchain pin table. Every version is EXACT — no `^` or `~` anywhere. */
export const TOOLCHAIN = {
  /** `engines.node` and the Nix package that provides it. */
  node: { engines: '>=24.0.0', nixPackage: 'nodejs_24' },
  /** Bare pnpm version. Callers derive `packageManager` (`pnpm@<version>`) and `engines.pnpm` (`>=<version>`). */
  pnpm: '11.24.0',
  /**
   * devDependencies required, at this exact version, in every one of the 15
   * runtime repositories' `repos/<name>/package.json` — never `^` or `~`.
   *
   * `tsx` is NOT here. plan.md §2.2's row for it reads "scripts/ か apps/ を
   * tsx で走らせる repo のみ" (only repositories that run scripts/apps
   * through tsx), and that row note is the intent: plan.md §4 item 1's
   * `TOOLCHAIN` literal, which nests `tsx` under `devDependencies`, was a
   * sketch rather than the resolved shape. `tsx` lives under `optional`
   * below, checked at the exact pinned version only when a repository
   * already declares it.
   */
  devDependencies: {
    typescript: '7.0.2',
    vitest: '4.1.11',
    '@vitest/coverage-v8': '4.1.11',
    '@effect/vitest': '0.30.0',
    '@types/node': '26.4.0',
    '@changesets/cli': '3.0.1',
    '@changesets/changelog-github': '1.0.0',
    knip: '6.33.0',
  },
  /**
   * `dependencies.effect`, required at this exact version in all 15 runtime
   * repositories — kernel included, because it uses `Brand.refined` at
   * runtime (plan.md §2.2). `mc-dev-meta` itself is NOT one of the 15 and
   * carries no `effect` dependency; see `test/toolchain.test.ts` and
   * `package.json`.
   */
  dependencies: { effect: '3.22.1' },
  /**
   * devDependencies checked at this exact version ONLY WHEN the repository
   * already declares them — never required to be present. Each is scoped to
   * a named subset of repositories in plan.md §2.2 (e.g. `three` to
   * mc-render and mc-compose, `tsx` to repositories that run scripts/apps
   * through it), and this table does not encode which repositories those
   * are: the audit has no per-repository allowlist for these, so a
   * repository outside the documented subset that happens to declare one is
   * still held to the exact version.
   */
  optional: {
    tsx: '4.23.12',
    three: '0.185.1',
    '@types/three': '0.185.4',
    vite: '8.2.2',
    '@playwright/test': '1.62.1',
    playwright: '1.62.1',
    '@vitest/browser-playwright': '4.1.11',
    jsdom: '30.0.1',
    '@types/jsdom': '30.0.0',
    ws: '8.21.3',
    '@types/ws': '8.18.1',
  },
  /**
   * Package names, or version-string substrings, that must appear nowhere in
   * `dependencies` or `devDependencies`. `@typescript/native` and
   * `typescript6` are alias forms of the old `typescript6@6.0.2` /
   * `@typescript/native: npm:typescript@…` devDependency entries plan.md
   * §2.2 retires in favour of a plain `typescript` entry; `oxlint` moved to
   * `nixPackages` below.
   */
  forbidden: ['esbuild', 'tsdown', 'oxlint', '@typescript/native', 'typescript6'],
  /** Packages every repository's `flake.nix` devShell must list. */
  nixPackages: ['nodejs_24', 'corepack_24', 'typescript-language-server', 'oxlint', 'ast-grep'],
  /** The four vitest coverage metrics, all held to this percentage. */
  coverageThreshold: 100,
} as const
