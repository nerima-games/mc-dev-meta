# @nerima-games/mc-dev-meta

## 責務

**15 リポジトリを `repos/` に clone し、1 つの pnpm workspace として束ねる。
そして合成状態を `repos.json` に記録する。**

plan.md §6 Step 0 item 2:

> **dev-meta workspace** を作成: 15 リポジトリの clone を `repos/` 配下に並べて
> 1 つの pnpm workspace として束ねる薄いリポジトリ(clone スクリプト + `pnpm-workspace.yaml`、
> `repos/` は gitignore)。開発中は `workspace:*` 解決でモノレポ同等の DX。
> **npm 公開・バージョン bump 運用は界面安定(4 週間 API ロック無変更)まで開始しない**

**このリポジトリは `private: true` であり、publish されない。**

## 絶対規則

> **`pnpm sync` は手元の作業を決して壊さない。**

- `git reset --hard` も `git clean` も `git restore` も**実行しない**。
  そういうアクションが存在せず、さらに実行直前に引数を検査して拒否する
- 未コミットの変更があるリポジトリは**触らずにスキップ**し、その旨を出力する
- checkout は必ず `--detach`。ローカルブランチを作りも動かしもしない
- `repos.json` の ref が `unpinned` のとき **HEAD は絶対に動かさない**

15 の作業コピーを一度に触るツールは、1 コマンドで午後を丸ごと消せる。
だから危険な判断はすべて純粋関数(`domain/sync-plan.ts`)にあり、
`test/sync-plan.test.ts` が **git を 1 度も使わずに**全状態を網羅して検証している。

## 依存

**無い。** `dependencies` が存在せず、`effect` すら入っていない。

15 リポジトリを取ってくるツールが、それらからブートストラップされてはならないためである。
`domain/manifest.ts` の `Parsed<A>` が `Either` の手作り版なのはこの理由による。

依存グラフの上でも mc-dev-meta は**グラフの外**にいる。誰にも依存せず、誰からも依存されない。

## クイックスタート

```console
$ direnv allow          # devenv 経由で nodejs_22 + pnpm が入る
$ pnpm install          # このリポジトリ自身の devDependencies
$ pnpm sync             # 15 リポジトリを repos/ へ clone
$ pnpm install          # ここで repos/* が workspace として解決される
```

`pnpm sync` の後に `pnpm install` をもう一度打つのが要点である。
1 回目は `repos/` が空なので workspace メンバーがおらず、
2 回目で `@nerima-games/*` の相互依存が `workspace:*` として解決される。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm sync` | `repos.json` に従って 15 リポジトリを clone / fetch / checkout |
| `pnpm sync:dry` | 計画だけ表示。何も触らない |
| `pnpm update:manifest` | clone 済み・clean なリポジトリを現在の HEAD に pin |
| `pnpm update:manifest:dry` | 差分が出るかだけ確認 |
| `pnpm check:workspace` | clone 済みの各リポジトリで `pnpm verify` |
| `pnpm check:workspace <script>` | 別のスクリプトを指定して横断実行 |
| `pnpm typecheck` | `tsconfig.build.json`(純粋層)と `tsconfig.test.json`(scripts + tests)を型検査 |
| `pnpm lint` | oxlint(このリポジトリ唯一の lint / format 設定) |
| `pnpm test` | vitest(**プレーン vitest**。`@effect/vitest` は使わない — 依存ゼロのため) |
| `pnpm test:coverage` | カバレッジ計測(閾値は未設定) |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm verify` | `typecheck && lint && check:deps && test`。CI と同じ内容 |

**`pnpm verify` は `repos/` が空でも通る。** これは配慮ではなく責務である
— 15 リポジトリを取ってくるツールが、最後に信用できるようになるものであってはならない。

## なぜ `repos.json` をコミットするのか

`repos/` は gitignore されている。それは正しい
— 15 リポジトリを 16 個目にベンダリングしたら分割の意味が消える。
だがその帰結:

> **マニフェストが無ければ、プロジェクトの合成状態はどこにもバージョン管理されていない。**

「昨日は動いていた」に答える手段が無くなる。
E2E が最後に通ったとき 15 リポジトリのどのコミットが checkout されていたかを述べる成果物が
存在しないので、**組み合わせでしか起きない回帰は bisect できない**。

`repos.json` がその成果物である。**合成状態のロックファイル**であり、
ロックファイルをコミットするのとまったく同じ理由でコミットされている。

`ref` に許されるのは **40 文字の完全なコミット SHA** か `"unpinned"` だけである。
ブランチ名は pin ではない — 動くものは何も記録しない。

詳細は [docs/manifest.md](./docs/manifest.md)。

## `workspace:*` はいつまでか

plan.md §6 Step 3:

> 界面が安定した(**API ロック 4 週間無変更**)リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発

つまり **`workspace:*` は開発時の解決方式**であり、
**各層が完成するにつれて、その層は pin された公開バージョンに置き換わっていく**。

移行は一斉には起きず、plan.md §6 Step 2 の構築順に下から起きる。過渡期には混在する。
詳細は [docs/versioning.md](./docs/versioning.md) §3。

## ドキュメント

**[docs/](./docs/) に実装情報がある。**

| ドキュメント | 内容 |
| --- | --- |
| [docs/README.md](./docs/README.md) | 索引と読む順番 |
| [docs/workflow.md](./docs/workflow.md) | **開発ワークフロー。最初に読む** |
| [docs/manifest.md](./docs/manifest.md) | **なぜ `repos.json` が存在するのか。必読** |
| [docs/architecture.md](./docs/architecture.md) | 4 階層、16 リポジトリ依存グラフ、参照実装との対比 |
| [docs/responsibility.md](./docs/responsibility.md) | 持つもの / 持たないもの。作業を壊さない仕組み |
| [docs/public-api.md](./docs/public-api.md) | 純粋層の API と契約 |
| [docs/testing.md](./docs/testing.md) | テスト戦略 |
| [docs/versioning.md](./docs/versioning.md) | publish されない理由、4 週間 API ロック |

## 依存ルール(16 リポジトリ共通)

| ルール | 内容 |
| --- | --- |
| ハード失敗 | 違反があれば CI は必ず非ゼロ終了する。警告で済ませない |
| 循環禁止 | 循環依存は一切許可しない。「co-evolution ペア」のような例外リストは設けない |
| 推移閉包の禁止 | A→B、B→C のとき A は C を import できない。依存は直接依存のみが import 許可を意味する |
| kernel は例外 | mc-kernel はどこからでも import 可 |
| 宣言と実体の一致 | import する `@nerima-games/*` は `package.json` に記載されていなければならない |
| mc-playground-kit は devDependency 専用 | `dependencies` に入れてはならない。実行時依存になると、出荷ビルドから入力処理が消える |
| `Date.now()` 禁止 | 時刻はすべて注入された Clock Port から取得する |

このリポジトリは **ロスターの参照コピー**(`domain/repository-roster.ts`)を持つ。
他の 15 リポジトリは `scripts/check-dependency-whitelist.ts` の中にミラーを持っており、
`test/roster.test.ts` が**このリポジトリ内での**両者の一致を保証している。

### `Date.now()` 禁止の実装方法

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は `oxlint --rules` の一覧に出るものの実装されていない(0.12.0 で実測確認済み)。

そのため禁止は **`scripts/check-dependency-whitelist.ts` 側で実装**している。
対象は `Date.now()` / `new Date()` / `performance.now()` の 3 つ。
コメント・文字列リテラル・正規表現リテラルの中身はマスクされるので誤検知しない。

## 現状

**このリポジトリはまだ叩き台(pre-audit first cut)である。**

- **`repos.json` の 15 件はすべて `"unpinned"`。** 15 リポジトリのほとんどがまだ存在しないため。
  架空の SHA で埋めるより、そう書いてあるほうがよい。
  `pnpm check:workspace` が毎回この状態を報告する
- **`repos/` は空。** `pnpm sync` が実際に動くのは、リポジトリが GitHub に作られてから
- **ロスターの publish は未実装。** 現在は 16 リポジトリが手作業でミラーしている
- **changesets 運用は未決**(plan.md §9 の「パッケージ公開先」も未決)
- **カバレッジ閾値は未設定。** 99% ゲートは完成条件到達時に有効化する

> **注意**: `devenv.lock` はコミットされていない。生成には `devenv` の実行が必要なため、
> 初回に devenv を動かした人がコミットすること。

## License

MIT
