/**
 * @nerima-games/mc-dev-meta — the development-time workspace binder and portable kernel.
 *
 * plan.md §6 Step 0 item 2:
 *
 *   dev-meta workspace を作成: 15リポジトリの clone を `repos/` 配下に並べて
 *   1つの pnpm workspace として束ねる薄いリポジトリ(clone スクリプト +
 *   `pnpm-workspace.yaml`、`repos/` は gitignore)。開発中は `workspace:*` 解決で
 *   モノレポ同等のDX。**npm公開・バージョンbump運用は界面安定(4週間APIロック無変更)まで
 *   開始しない**
 *
 * This repository is PRIVATE and is never published. Its only runtime package
 * dependency is `effect`, used by the portable kernel's branded values and
 * service contracts. It must not depend on any managed `@nerima-games/*`
 * package, because it is the tool that fetches those packages.
 *
 * The exported domain decisions and most portable Minecraft data/world primitives are
 * pure. Effect service contracts remain explicit ports; the parts that touch git and the
 * filesystem live in `scripts/`, and they are thin shells over these decisions
 * so that the dangerous logic can be tested without a network or a temporary
 * directory. See docs/workflow.md.
 */

export * from './domain/manifest'
// The pin decision — what `pnpm update:manifest` writes and what it refuses to.
// Exported for the same reason `domain/sync-plan.ts` is: the two are halves of
// one loop (repos/ <- pin, pin <- repos/), and publishing one half while hiding
// the other is how the two came to be reasoned about separately in the first
// place. See docs/manifest.md §5.
export * from './domain/pin-plan'
export * from './domain/repository-roster'
export * from './domain/sync-plan'
export * from './domain/workspace'
export * from './domain/feature-audit'
export * from './domain/feature-register'
export * from './kernel'
export * from './render/world-renderer'
export * from './audio/audio-backend'
export * from './multiplayer/websocket-transport'

// The feature audit is re-exported because it is part of the public management
// surface documented in docs/public-api.md. Mirror/type-shape modules remain
// deliberately private to their checks: `domain/mirror-*.ts` +
// `domain/type-shape.ts` are typechecked by tsconfig.build.json and unit-tested
// like everything else in domain/, but are not part of this binder's API.
