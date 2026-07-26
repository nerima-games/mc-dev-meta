/**
 * The 16-repository roster and its dependency graph — the REFERENCE COPY.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * Why this lives here
 * ---------------------------------------------------------------------------
 *
 * Every repository carries a copy of the graph inside
 * `scripts/check-dependency-whitelist.ts`, because the gate has to work with no
 * network and no siblings checked out. Those copies are mirrors, kept in sync
 * by hand.
 *
 * mc-dev-meta is the repository whose entire job is knowing about the other 15
 * (plan.md §6 Step 0 item 2), so the authoritative statement of the roster
 * belongs here. `test/roster.test.ts` asserts that this module and this
 * repository's copy of the check script agree edge for edge, which at least
 * makes drift impossible WITHIN this repository, and gives the other 15 a
 * single place to diff against.
 *
 * The eventual answer is for this module to be published and consumed by the
 * check script in every repository — see docs/workflow.md.
 */

/** The npm scope shared by every repository in the project. */
export const ORG_SCOPE = '@nerima-games'

/** Universally importable from every repository (plan.md §2.1 / the whitelist rule 4). */
export const KERNEL_REPOSITORY = 'mc-kernel'

/** devDependency-only. A runtime edge to it deletes input handling from the shipped build. */
export const DEV_ONLY_REPOSITORY = 'mc-playground-kit'

/** The four tiers of plan.md §2.2, plus this repository, which is outside the game graph. */
export type Tier = 'stable-library' | 'foundation' | 'experience' | 'composition' | 'workspace-tooling'

export type RepositoryEntry = {
  readonly name: string
  readonly tier: Tier
  /**
   * Direct RUNTIME dependencies, excluding mc-kernel.
   *
   * mc-kernel is omitted deliberately: it is importable everywhere, and listing
   * it would make every row identical in an uninformative way. A devDependency
   * (mc-playground-kit) is not a runtime edge and does not appear either.
   */
  readonly dependsOn: ReadonlyArray<string>
  /** devDependencies within the org. Not part of the runtime graph. */
  readonly devDependsOn: ReadonlyArray<string>
  /** One line, for `README` generation and for the sync script's output. */
  readonly responsibility: string
}

/**
 * The roster, in the build order of plan.md §6 Step 2:
 *
 *   kernel
 *   -> noise / meshing / physics / save / audio   (mutually independent)
 *   -> worldgen -> sim -> render -> playground-kit
 *   -> gameplay / redstone                        (parallel)
 *   -> ui -> multiplayer -> compose
 *
 * mc-dev-meta is last because it depends on nothing and blocks nothing.
 */
export const REPOSITORIES: ReadonlyArray<RepositoryEntry> = [
  // --- Tier 1: stable libraries ---------------------------------------------
  {
    name: 'mc-kernel',
    tier: 'stable-library',
    dependsOn: [],
    devDependsOn: [],
    responsibility: '全リポジトリが共有する語彙。型・座標・ブロック能力フラグ・フレーム契約・Clock Port',
  },
  {
    name: 'mc-noise',
    tier: 'stable-library',
    dependsOn: [],
    devDependsOn: [],
    responsibility: 'シード付き決定論ノイズ・オクターブ合成・密度関数',
  },
  {
    name: 'mc-meshing',
    tier: 'stable-library',
    dependsOn: [],
    devDependsOn: [],
    responsibility: 'チャンクデータ→ジオメトリバッファの純粋変換(グリーディメッシング)',
  },
  {
    name: 'mc-physics',
    tier: 'stable-library',
    dependsOn: [],
    devDependsOn: [],
    responsibility: 'Euler 積分 + AABB 衝突解決。外部物理ライブラリなし',
  },
  {
    name: 'mc-save',
    tier: 'stable-library',
    dependsOn: [],
    devDependsOn: [],
    responsibility: 'バージョン付きコーデックツールキット + IndexedDB アダプタ + フォーマットレジストリ',
  },
  {
    name: 'mc-audio',
    tier: 'stable-library',
    dependsOn: [],
    devDependsOn: [],
    responsibility: 'WebAudio エンジン・効果音キュー・音楽コンテキスト・字幕イベント',
  },

  // --- Tier 2: foundations (nouns) ------------------------------------------
  {
    name: 'mc-worldgen',
    tier: 'foundation',
    dependsOn: ['mc-noise', 'mc-save'],
    devDependsOn: [],
    responsibility: 'バイオーム・地形生成・カーバー・植生・構造物・チャンクのライフサイクル + 地形プレビュー',
  },
  {
    name: 'mc-sim',
    tier: 'foundation',
    dependsOn: ['mc-physics', 'mc-save', 'mc-worldgen'],
    devDependsOn: [],
    responsibility: 'ゲーム状態の中枢。Entity / Inventory / 体力 / 時間 / ゲームループ。カメラ姿勢の正',
  },
  {
    name: 'mc-render',
    tier: 'foundation',
    dependsOn: ['mc-meshing', 'mc-sim', 'mc-worldgen'],
    devDependsOn: [],
    responsibility: 'THREE.js 描画一式 + ワーカープール実装 + 実行時入力サービス',
  },
  {
    name: 'mc-playground-kit',
    tier: 'foundation',
    dependsOn: ['mc-worldgen', 'mc-sim', 'mc-render'],
    devDependsOn: [],
    responsibility: 'プレビュー用共通ハーネス。他リポジトリからは devDependency としてのみ参照される',
  },

  // --- Tier 3: experience modules (verbs) -----------------------------------
  // ZERO edges between these four. "mining puts an item in the inventory" goes
  // through mc-sim's InventoryService (plan.md §2.3-1).
  {
    name: 'mx-gameplay',
    tier: 'experience',
    dependsOn: ['mc-sim', 'mc-worldgen', 'mc-audio'],
    devDependsOn: ['mc-playground-kit'],
    responsibility: '体験ルールの束: 採掘/設置/アイテム使用・Mob AI・ドロップ・流体・乗り物・昼夜・天候',
  },
  {
    name: 'mx-redstone',
    tier: 'experience',
    dependsOn: ['mc-sim', 'mc-worldgen'],
    devDependsOn: ['mc-playground-kit'],
    responsibility: 'レッドストーン機構(電力伝播・トーチ/レバー/ボタン・リピーター・ピストン)',
  },
  {
    name: 'mx-ui',
    tier: 'experience',
    dependsOn: ['mc-sim', 'mc-audio'],
    devDependsOn: [],
    responsibility: 'DOM UI 全部: HUD・メニュー・インベントリ/クラフト・設定・実績・字幕',
  },
  {
    name: 'mx-multiplayer',
    tier: 'experience',
    dependsOn: ['mc-sim'],
    devDependsOn: [],
    responsibility: 'ネットワーク同期。トランスポートとプロトコルに限定',
  },

  // --- Tier 4: composition --------------------------------------------------
  {
    name: 'mc-compose',
    tier: 'composition',
    dependsOn: ['mx-gameplay', 'mx-redstone', 'mx-ui', 'mx-multiplayer'],
    devDependsOn: [],
    responsibility: 'Layer マージ + stage 順序表(唯一の全順序)+ セッション + QA API + Modding 入口 + E2E',
  },

  // --- Outside the game graph -----------------------------------------------
  {
    name: 'mc-dev-meta',
    tier: 'workspace-tooling',
    dependsOn: [],
    devDependsOn: [],
    responsibility: '開発時ワークスペース束ね役。15 リポジトリを repos/ に clone して 1 つの pnpm workspace にする',
  },
]

/** Every repository name, roster order. */
export const REPOSITORY_NAMES: ReadonlyArray<string> = REPOSITORIES.map((entry) => entry.name)

/**
 * The 15 repositories this workspace clones — everything except itself.
 *
 * plan.md §6 Step 0 item 2: "15リポジトリの clone を `repos/` 配下に並べて
 * 1つの pnpm workspace として束ねる薄いリポジトリ".
 */
export const MANAGED_REPOSITORY_NAMES: ReadonlyArray<string> = REPOSITORY_NAMES.filter(
  (name) => name !== 'mc-dev-meta',
)

/** The runtime dependency graph, keyed by repository name. mc-kernel appears in no value set. */
export const DEPENDENCY_GRAPH: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  REPOSITORIES.map((entry) => [entry.name, new Set(entry.dependsOn)] as const),
)

export const repositoryNamed = (name: string): RepositoryEntry | undefined =>
  REPOSITORIES.find((entry) => entry.name === name)

export const repositoriesInTier = (tier: Tier): ReadonlyArray<RepositoryEntry> =>
  REPOSITORIES.filter((entry) => entry.tier === tier)

/** The npm package name for a repository. Repository name and package name coincide by design. */
export const packageNameOf = (repositoryName: string): string => `${ORG_SCOPE}/${repositoryName}`

/** The default clone URL. Overridable per entry in `repos.json`. */
export const defaultCloneUrl = (repositoryName: string): string =>
  `https://github.com/nerima-games/${repositoryName}.git`

/**
 * Repositories in a valid build order: every repository appears after all of
 * its dependencies.
 *
 * Deterministic — ties break on roster order, which is already the build order
 * plan.md §6 Step 2 prescribes. Returns `undefined` if the graph has a cycle,
 * which would be a bug in the roster above.
 */
export const buildOrder = (): ReadonlyArray<string> | undefined => {
  const placed: Array<string> = []
  const remaining = new Set(REPOSITORY_NAMES)

  while (remaining.size > 0) {
    const ready = REPOSITORY_NAMES.filter(
      (name) =>
        remaining.has(name) &&
        [...(DEPENDENCY_GRAPH.get(name) ?? [])].every((dependency) => !remaining.has(dependency)),
    )

    if (ready.length === 0) {
      return undefined
    }

    for (const name of ready) {
      placed.push(name)
      remaining.delete(name)
    }
  }

  return placed
}
