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
| [step2-status.md](./step2-status.md) | **横断の現況。** plan.md §6 Step 2 の完了条件「内蔵プレビューが操作可能」の監査結果は **5 完了 / 3 部分 / 1 未達 / 6 対象外** | 全員。進捗を語る前に |
| [architecture.md](./architecture.md) | 4 階層アーキテクチャ、16 リポジトリ依存グラフ、本リポジトリの位置(グラフ外)、名詞/動詞ルール、mc-playground-kit の devDependency 専用ルール | 全員 |
| [responsibility.md](./responsibility.md) | 持つもの / 持たないもの。**手元の作業を壊さない**という絶対規則 | 実装者・レビュアー |
| [public-api.md](./public-api.md) | 純粋層の API と契約 | 実装者 |
| [testing.md](./testing.md) | テスト戦略。**実ネットワーク clone をするテストは書かない** | 実装者・レビュアー |
| [versioning.md](./versioning.md) | このリポジトリは publish されない。兄弟リポジトリの公開・昇格方針 | リリース担当 |

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
| `pnpm sync:latest` | **origin の先端へ fast-forward。** dirty と diverged はスキップ |
| `pnpm sync:latest:dry` | 同上の計画。fetch する手前まで表示 |
| `pnpm update:manifest` | clone 済み・clean なリポジトリを現在の HEAD に pin |
| `pnpm update:manifest:dry` | 差分が出るかだけ確認 |
| `pnpm update:manifest:latest` | **origin の先端を pin。** `repos/` は動かさない |
| `pnpm update:manifest:latest:dry` | 同上。何も書かない |
| `pnpm check:workspace` | clone 済みの各リポジトリで `pnpm verify` |
| `pnpm check:workspace typecheck` | 別のスクリプトを指定して横断実行 |
| `pnpm check:mirrors` | 手書きミラーと元リポジトリの**形**を突き合わせる。`verify` とは別に実行する |
| `pnpm check:repoint` | ミラーを実際に消して import を張り替え、**`tsc` を走らせる**。`verify` には入っていない([testing.md](./testing.md) §6.1) |
| `pnpm check:features` | ルートの統合ソースにある限定された機能証拠を監査。`partial` / `missing` があれば非ゼロ |
| `pnpm verify` | **このリポジトリ自身**の検査。空の `repos/` でも通る |

## 4. 絶対規則

> **`pnpm sync` は手元の作業を決して壊さない。**

- `git reset --hard` も `git clean` も `git restore` も**実行しない**。
  そういうアクションが存在せず、さらに実行直前に引数を検査して拒否する
- 未コミットの変更があるリポジトリは**触らずにスキップ**し、その旨を出力する
- checkout は必ず `--detach`。ローカルブランチを作りも動かしもしない
- `repos.json` の ref が `unpinned` のとき **HEAD は絶対に動かさない**
- `--latest` は **fast-forward のみ**。HEAD が origin の先端から辿れないリポジトリは
  **触らずにスキップ**する。作業コピーは detached なので、
  そこで作られたコミットは HEAD からしか辿れないからである

強制の仕組みは [responsibility.md](./responsibility.md) §3、
検証は [testing.md](./testing.md) §3。

## 5. 現状

- **`repos.json` の 15 件は commit SHA に固定されている。** `repos/` は git 管理外の同期先であり、
  fresh checkout では空だが、`pnpm sync` 後は監査対象の 15 リポジトリが存在する
- **兄弟リポジトリの実装・テストを含む成果物は各リポジトリ側で完成させる。**
  ここでは同期、ピン、ミラー監査、repoint 監査だけを行う
- **機能証拠監査は `pnpm check:features` で行う。** `feature-register.ts` に登録された限定的な
  仕様をルートの `src/` と `test/` に適用し、`complete` 以外を明示する。これはブラウザ／ネットワーク
  アダプタや登録簿にない全公式機能の完了宣言ではない
- **changesets 運用は未決。** [versioning.md](./versioning.md) §6
- **ロスターを publish する仕組みは未実装。** このルートが管理する同期対象は 15 件で、ミラー削除後の依存切替は各兄弟リポジトリ側で行う
  ([architecture.md](./architecture.md) §3.1)
- **plan.md §6 Step 2 の状態** — pinned snapshot に対する横断監査では、5 リポジトリが完了、
  3 が部分完了、1 が未達、6 はプレビュー対象外。
  詳細と判定根拠は [step2-status.md](./step2-status.md) に記録する
- **ワークスペース監査の注意** — 現在の worktree で `pnpm check:workspace` を実行すると 14 件通過、
  `mc-compose` の 1 件が失敗する。失敗は
  `repos/mc-compose/test/check-roster-manifest.test.ts:302` が、実行中 worktree のパスに含まれる
  `mc-dev-meta` を候補に含めない前提を持つ環境依存差分である。nested repository は変更しない。
  ルート自身の `pnpm verify` とこの監査は別のゲートである
