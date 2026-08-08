import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: '50%',
        minForks: 1,
        isolate: true,
        singleFork: false,
      },
    },
    include: ['test/**/*.test.ts'],
    // `repos/` holds 15 separate projects with their own test suites. Running
    // them from here would be `pnpm check:workspace`'s job, not vitest's.
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**', 'repos/**'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    slowTestThreshold: 300,
    fileParallelism: true,
    sequence: {
      seed: 0,
      hooks: 'stack',
    },
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/index.ts', 'src/domain/**/*.ts'],
      // scripts/ is deliberately NOT covered: it is the impure shell, and the
      // only way to cover it would be to run real git against real
      // repositories. Its decisions live in domain/ and are covered there.
      //
      // domain/exhaustive.ts's `assertUnreachable` throw is deliberately NOT
      // covered either: TypeScript only lets a caller reach it once every
      // other case of a union has been handled, so a real call site can never
      // execute it. The only way to "cover" it would be an `as never` cast
      // manufacturing a value that cannot occur, which would assert nothing
      // real about this codebase — it would only prove the cast works.
      exclude: [
        '**/*.d.ts',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        'repos/**',
        'scripts/**',
        'src/domain/exhaustive.ts',
      ],
      all: true,
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // TEST_STANDARD.md §3: the 4-metric 99% gate is an org-wide decision
      // applied immediately to all 16 repositories, with no staged rollout and
      // no per-repository exemption for being "not done yet" — a low number is
      // a reason for CI to go red, not a reason to withhold the gate.
      //
      // Measured at migration time (`pnpm test:coverage`): statements 93.78%,
      // branches 89.19%, functions 97.82%, lines 93.78%. This does NOT clear
      // 99% on 3 of the 4 metrics, so enabling this turns CI red here, the same
      // known-and-accepted way it does for mc-audio / mc-compose /
      // mc-playground-kit (TEST_STANDARD.md §4). That is expected, not a
      // reason to defer.
      thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})
