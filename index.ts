/**
 * @nerima-games/mc-dev-meta — the development-time workspace binder.
 *
 * PRE-AUDIT FIRST CUT (叩き台). See README.md 現状.
 *
 * plan.md §6 Step 0 item 2:
 *
 *   dev-meta workspace を作成: 15リポジトリの clone を `repos/` 配下に並べて
 *   1つの pnpm workspace として束ねる薄いリポジトリ(clone スクリプト +
 *   `pnpm-workspace.yaml`、`repos/` は gitignore)。開発中は `workspace:*` 解決で
 *   モノレポ同等のDX。**npm公開・バージョンbump運用は界面安定(4週間APIロック無変更)まで
 *   開始しない**
 *
 * This repository is PRIVATE and is never published. It depends on nothing —
 * not even `effect` — because it is the tool that fetches the packages and
 * therefore cannot be bootstrapped from them.
 *
 * Everything exported here is PURE. The parts that touch git and the
 * filesystem live in `scripts/`, and they are thin shells over these decisions
 * so that the dangerous logic can be tested without a network or a temporary
 * directory. See docs/workflow.md.
 */

export * from './domain/manifest'
export * from './domain/repository-roster'
export * from './domain/sync-plan'
export * from './domain/workspace'
