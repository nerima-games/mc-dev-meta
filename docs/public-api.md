# 公開 API

**このリポジトリは `private: true` であり publish されない。**
「公開 API」とは、`index.ts` から出ていて `scripts/` とテストが使うもの、
そして将来ロスターを他リポジトリへ配る際の候補、という意味である。

すべて **純粋** — ファイルシステムにも git にもネットワークにも触らない。
`tsconfig.build.json` が `types: []` でコンパイルするので、Node のグローバルすら見えない。

## 1. ロスター(`domain/repository-roster.ts`)

```typescript
const ORG_SCOPE = '@nerima-games'
const KERNEL_REPOSITORY = 'mc-kernel'          // どこからでも import 可
const DEV_ONLY_REPOSITORY = 'mc-playground-kit' // devDependency 専用

type Tier = 'stable-library' | 'foundation' | 'experience' | 'composition' | 'workspace-tooling'
type RepositoryEntry = {
  readonly name: string
  readonly tier: Tier
  readonly dependsOn: ReadonlyArray<string>      // 実行時依存。mc-kernel は含めない
  readonly devDependsOn: ReadonlyArray<string>   // 実行時グラフの一部ではない
  readonly responsibility: string
}

const REPOSITORIES: ReadonlyArray<RepositoryEntry>          // 16 件、ビルド順
const REPOSITORY_NAMES: ReadonlyArray<string>               // 16
const MANAGED_REPOSITORY_NAMES: ReadonlyArray<string>       // 15(自分以外)
const DEPENDENCY_GRAPH: ReadonlyMap<string, ReadonlySet<string>>

const repositoryNamed: (name) => RepositoryEntry | undefined
const repositoriesInTier: (tier) => ReadonlyArray<RepositoryEntry>
const packageNameOf: (repositoryName) => string             // '@nerima-games/<name>'
const defaultCloneUrl: (repositoryName) => string
const buildOrder: () => ReadonlyArray<string> | undefined   // undefined = 循環あり
```

**これはロスターの参照コピーである。** 他の 15 リポジトリは
`scripts/check-dependency-whitelist.ts` の中にミラーを持つ
([architecture.md](./architecture.md) §3.1)。

`mc-kernel` はどの `dependsOn` にも現れない(どこからでも import 可のため)。
`mc-playground-kit` はどの `dependsOn` にも現れない(devDependency 専用のため)。

## 2. マニフェスト(`domain/manifest.ts`)

```typescript
const MANIFEST_VERSION = 1
const UNPINNED = 'unpinned'
const PINNED_REF_PATTERN = /^[0-9a-f]{40}$/u

type ManifestEntry = { readonly name: string; readonly url: string; readonly ref: string }
type Manifest = { readonly manifestVersion: number; readonly repositories: ReadonlyArray<ManifestEntry> }

type Parsed<A> = { ok: true; value: A } | { ok: false; error: ManifestError }

const isPinned:  (ref) => boolean            // 40-hex SHA だけが true
const isValidRef: (ref) => boolean           // SHA または UNPINNED

const parseManifest:        (raw: string) => Parsed<Manifest>
const validateAgainstRoster: (manifest, rosterNames) => Parsed<Manifest>
const unpinnedEntries:      (manifest) => ReadonlyArray<ManifestEntry>
const entryNamed:           (manifest, name) => ManifestEntry | undefined
const withPinnedRef:        (manifest, name, ref) => Parsed<Manifest>
const serialiseManifest:    (manifest) => string
const describeManifestError: (error) => string
```

### 契約

| 保証 | 内容 |
| --- | --- |
| ref はブランチ名を受け付けない | 40 文字 SHA か `unpinned` だけ。動く ref は何も記録しない |
| 未知の `manifestVersion` は拒否 | ロックファイルを半端に読むのは読まないより悪い |
| 構造検査とロスター検査は別 | ロスター変更時に `MissingRepository` という的確なエラーになる |
| **1 件 pin すると差分は 1 行** | 再フォーマットしない。全ファイル差分は誰もレビューしない |
| ラウンドトリップはバイト一致 | `serialiseManifest(parseManifest(raw)) === raw` |

`Parsed<A>` は `Either` の手作り版である。
**mc-dev-meta は実行時依存を 1 つも持たない** — `effect` すら入れない
— ので、`Either` を使えない。これは制約ではなく設計([responsibility.md](./responsibility.md) §4)。

## 3. 同期判断(`domain/sync-plan.ts`)― 中核

```typescript
type WorkingCopyState =
  | { _tag: 'Absent' }
  | {
      _tag: 'Present'
      head: string
      dirty: boolean
      hasPinnedRef: boolean
      fetchedThisRun: boolean   // ディスクからは読めない。呼び出し側が run 内で持ち回る
    }

type SyncAction =
  | { _tag: 'Clone';        name; url; ref }
  | { _tag: 'Fetch';        name; reason: 'ref-not-local' | 'unpinned' }
  | { _tag: 'Checkout';     name; ref }
  | { _tag: 'AlreadyAtRef'; name; ref }
  | { _tag: 'UpToDate';     name }   // unpinned で fetch 済み。AlreadyAtRef の unpinned 版
  | { _tag: 'SkipDirty';    name }

const planSync: (entry: ManifestEntry, state: WorkingCopyState) => SyncAction
const planAll:  (entries, observe) => ReadonlyArray<SyncAction>
const isNoOp:   (action) => boolean
const fetchesFromRemote: (action) => boolean   // Clone | Fetch。`fetchedThisRun` の決め方

const applyAction: (entry, state, action) => WorkingCopyState   // スクリプトの動作モデル
const settle:      (entry, from, maxRounds?) => { actions, state }

const gitCommandsFor:        (action, directory) => ReadonlyArray<ReadonlyArray<string>>
const isDestructiveGitCommand: (argv) => boolean
const DESTRUCTIVE_GIT_ARGUMENTS: ReadonlyArray<string>

const summarise:     (actions) => SyncSummary
const describeAction: (action) => string
```

### 決定表

| 状態 | アクション |
| --- | --- |
| `Absent` | `Clone` |
| `Present` かつ **dirty** | **`SkipDirty`**(他のどの条件よりも先に判定) |
| `Present` / clean / ref が `unpinned` / まだ fetch していない | `Fetch(unpinned)` — **HEAD は動かさない** |
| `Present` / clean / ref が `unpinned` / この run で fetch 済み | `UpToDate` |
| `Present` / clean / `head === ref` | `AlreadyAtRef` |
| `Present` / clean / ref がローカルに無い | `Fetch(ref-not-local)` → 再判定 |
| `Present` / clean / ref がローカルにある | `Checkout` |

**判定順が重要である。** dirty 検査は「そもそも存在するか」の次に来る。
`SkipDirty` 以外のすべてのアクションは作業コピーに書き込むためである。

### `gitCommandsFor` がコマンドを**データとして**返す理由

実行せずに返すことが、このツールの危険な部分をテスト可能にしている。
`test/sync-plan.test.ts` は全状態を列挙して、生成されうる全コマンドを集め、
**git を 1 度も使わずに**「どれも作業を壊せない」ことを検証する。

生成される git コマンド:

| アクション | argv(`git` を除く) |
| --- | --- |
| `Clone`(pinned) | `clone <url> <dir>` → `-C <dir> checkout --detach <ref>` |
| `Clone`(unpinned) | `clone <url> <dir>` |
| `Fetch` | `-C <dir> fetch --prune --tags origin` |
| `Checkout` | `-C <dir> checkout --detach <ref>` |
| `AlreadyAtRef` / `UpToDate` / `SkipDirty` | (なし) |

`unpinned` のエントリが `Fetch` ではなく `UpToDate` に落ち着けるのは
`fetchedThisRun` があるからである。これが無かった頃は、同じ状態に対して `Fetch` を返し続け、
収束ループが上限まで fetch を繰り返していた(1 リポジトリあたり 3 往復)。
`fetchedThisRun` はディスクから観測できる情報ではない —
作業コピーは「11 秒前に誰かが fetch した」を記録していない —
ので、`scripts/sync-repos.ts` が `fetchesFromRemote` を使って run 内で持ち回る。

### `applyAction` は契約である

`scripts/sync-repos.ts` が作業コピーに何をするかの**モデル**である。
純粋層にあるので、冪等性を git 無しで検証できる:
計画 → 適用 → 再計画、で 2 回目が no-op。

**スクリプトがこのモデルから外れたら、間違っているのはスクリプトのほうである。**

## 4. ワークスペース実行(`domain/workspace.ts`)

```typescript
const WORKSPACE_PACKAGES_GLOB = 'repos/*'
const REPOS_DIRECTORY = 'repos'
const MANIFEST_FILENAME = 'repos.json'

type WorkspaceStatus = 'empty' | 'partial' | 'complete'
type WorkspaceRunPlan = {
  readonly status: WorkspaceStatus
  readonly targets: ReadonlyArray<ManifestEntry>   // マニフェスト順
  readonly missing: ReadonlyArray<string>
  readonly unmanaged: ReadonlyArray<string>        // repos/ にあるがマニフェストに無い
  readonly unpinned: ReadonlyArray<string>
}

const planWorkspaceRun:    (manifest, presentDirectories) => WorkspaceRunPlan
const describeWorkspaceRun: (plan, command) => ReadonlyArray<string>
```

- `targets` は **マニフェスト順**。`readdir` の順ではない
  (ファイルシステムによって違い、出力差分が読めなくなる)
- `unmanaged` は**報告して放置**。消すのはこのツールが決してやらない行為
- `unpinned` は**毎回**報告。sentinel が静かに恒久化するのを防ぐ
- `describeWorkspaceRun` は print せず行の配列を返す。メッセージ自体をテストするため

**`empty` も `partial` も失敗ではない。** 例外を返す関数も非ゼロを返す関数もここには無い。

## 5. まだ無いもの

| 未実装 | 備考 |
| --- | --- |
| ロスターの publish(他 15 リポジトリのゲートが consume する) | [architecture.md](./architecture.md) §3.1 |
| `workspace:*` → pin 済みバージョンへの一括切り替え支援 | [versioning.md](./versioning.md) §3 |
| API ロックファイルの横断チェック | plan.md §9「未決」— ツール選定待ち |
| 並列 sync | 逐次で十分。出力の可読性を優先している |
