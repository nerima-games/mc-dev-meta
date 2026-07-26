# mc-dev-meta ドキュメント索引

`@nerima-games/mc-dev-meta` の実装情報はここに集約する。

## 表記

| 表記 | 意味 |
| --- | --- |
| `<reference-impl>` | **参照実装のチェックアウトのルート**。凍結された `takeokunn/ts-minecraft` の作業コピーを指す。本ドキュメント群では `<reference-impl>/packages/…` の形か、単に `packages/…`（同じくルート相対）で引用する。手元のどこに clone してあっても読み替えられるようにするためのプレースホルダである |
| plan.md | リポジトリ構成仕様書（16 リポジトリ、確定済み）。**非公開**であり、公開読者は開けない。だから本ドキュメント群は「plan.md を読まなくても追える」ことを要件にしている —— plan.md の主張を引くときは必ず原文を引用し、参照実装での裏づけを file:line で添える |
| `nerima-games/<repo>` | 同 org の兄弟リポジトリ。リンクは GitHub の URL で張る |

## 0. 一行で

**15 リポジトリを `repos/` に clone し、1 つの pnpm workspace として束ねる。
そして合成状態を `repos.json` に記録する。**(plan.md §6 Step 0 item 2)

## 1. 索引

| ドキュメント | 内容 | 主な読者 |
| --- | --- | --- |
| [workflow.md](./workflow.md) | **開発ワークフロー。** セットアップ、日々の流れ、`workspace:*` から公開バージョンへの移行 | **全員。最初に読む** |
| [manifest.md](./manifest.md) | **なぜ `repos.json` が存在するのか。** `pnpm sync` が壊さないもの | 全員。**必読** |
| [step2-status.md](./step2-status.md) | **横断の現況。** plan.md §6 Step 2 の完了条件「内蔵プレビューが操作可能」を満たすリポジトリは **0 / 15**。その単一のボトルネック | 全員。進捗を語る前に |
| [architecture.md](./architecture.md) | 4 階層アーキテクチャ、16 リポジトリ依存グラフ、本リポジトリの位置(グラフ外)、名詞/動詞ルール、mc-playground-kit の devDependency 専用ルール | 全員 |
| [responsibility.md](./responsibility.md) | 持つもの / 持たないもの。**手元の作業を壊さない**という絶対規則 | 実装者・レビュアー |
| [public-api.md](./public-api.md) | 純粋層の API と契約 | 実装者 |
| [testing.md](./testing.md) | テスト戦略。**実ネットワーク clone をするテストは書かない** | 実装者・レビュアー |
| [versioning.md](./versioning.md) | このリポジトリは publish されない。**4 週間 API ロックまで公開を開始しない**ルール | リリース担当 |

### このリポジトリに無いドキュメント

他の 15 リポジトリは `docs/porting.md`(参照実装からの移植計画)と
`docs/design-notes.md`(参照実装の実測知見)を持つが、mc-dev-meta には無い。

**参照実装 `takeokunn/ts-minecraft` に対応物が存在しないため**である
— あちらは 1 リポジトリ 11 パッケージのモノレポであり、
束ねる道具そのものが必要なかった。

移植ではなく新規なので、そのぶんの設計理由は
[workflow.md](./workflow.md) §1 と [manifest.md](./manifest.md) §1 に書いてある。
参照実装との構造対比は [architecture.md](./architecture.md) §5 にある。

## 2. 読む順番

1. **workflow.md** — 何をどう使うのか
2. **manifest.md** — なぜ `repos.json` をコミットするのか、`pnpm sync` が何を壊さないのか
3. **responsibility.md** — 実装するとき / レビューするとき
4. **public-api.md** — 純粋層の契約

## 3. コマンド早見

| コマンド | 内容 |
| --- | --- |
| `pnpm sync` | `repos.json` に従って 15 リポジトリを clone / fetch / checkout |
| `pnpm sync:dry` | 計画だけ表示。何も触らない |
| `pnpm update:manifest` | clone 済み・clean なリポジトリを現在の HEAD に pin |
| `pnpm update:manifest:dry` | 差分が出るかだけ確認 |
| `pnpm check:workspace` | clone 済みの各リポジトリで `pnpm verify` |
| `pnpm check:workspace typecheck` | 別のスクリプトを指定して横断実行 |
| `pnpm verify` | **このリポジトリ自身**の検査。空の `repos/` でも通る |

## 4. 絶対規則

> **`pnpm sync` は手元の作業を決して壊さない。**

- `git reset --hard` も `git clean` も `git restore` も**実行しない**。
  そういうアクションが存在せず、さらに実行直前に引数を検査して拒否する
- 未コミットの変更があるリポジトリは**触らずにスキップ**し、その旨を出力する
- checkout は必ず `--detach`。ローカルブランチを作りも動かしもしない
- `repos.json` の ref が `unpinned` のとき **HEAD は絶対に動かさない**

強制の仕組みは [responsibility.md](./responsibility.md) §3、
検証は [testing.md](./testing.md) §3。

## 5. 現状

- **`repos.json` の 15 件はすべて `"unpinned"`。** 15 リポジトリのほとんどがまだ存在しないため。
  架空の SHA で埋めるより、そう書いてあるほうがよい。
  `pnpm check:workspace` が毎回この状態を報告する
- **`repos/` は空。** `pnpm sync` が実際に動くのは、リポジトリが GitHub に作られてから
- **changesets 運用は未決。** [versioning.md](./versioning.md) §6
- **ロスターの publish は未実装。** 現在は 16 リポジトリが手作業でミラーしている
  ([architecture.md](./architecture.md) §3.1)
- **plan.md §6 Step 2 の完了条件「内蔵プレビューが操作可能」を満たすリポジトリは 0 / 15。**
  `apps/` ディレクトリがどのリポジトリにも無く、`mc-playground-kit` を依存に持つリポジトリも 0 件である。
  0 が 15 個並んでいるのではなく、publish 未着手という**1 本の連鎖**の帰結である
  ([step2-status.md](./step2-status.md))
