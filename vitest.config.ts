import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    maxWorkers: '50%',
    isolate: true,
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
      include: [
        'src/index.ts',
        'src/domain/**/*.ts',
        'src/kernel/**/*.ts',
        'src/render/**/*.ts',
        'src/audio/**/*.ts',
        'src/multiplayer/**/*.ts',
      ],
      // scripts/ is deliberately NOT covered: it is the impure shell, and the
      // only way to cover it would be to run real git against real
      // repositories. Its decisions live in domain/ and kernel/ and are covered there.
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
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Keep every metric at 100% so a regression cannot pass merely because
      // the changed file was not selected by the test runner.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})
