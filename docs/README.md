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
合成状態を `repos.json` に、横断機能の状態を機能棚卸しに記録する。**(plan.md §6 Step 0 item 2)

## 1. 索引

| ドキュメント | 内容 | 主な読者 |
| --- | --- | --- |
| [workflow.md](./workflow.md) | **開発ワークフロー。** セットアップ、日々の流れ、`workspace:*` から公開バージョンへの移行 | **全員。最初に読む** |
| [manifest.md](./manifest.md) | **なぜ `repos.json` が存在するのか。** `pnpm sync` が壊さないもの | 全員。**必読** |
| [step2-status.md](./step2-status.md) | plan.md §6 Step 2 のプレビュー条件と、機能 parity を混同しないための横断確認方法 | 全員。進捗を語る前に |
| [feature-inventory.md](./feature-inventory.md) | 所有者・実装状態・管理方針・根拠ファイルの正本 | 実装者・レビュアー |
| [architecture.md](./architecture.md) | 4 階層アーキテクチャ、15 runtime リポジトリ依存グラフ、portable contract、本リポジトリの位置(グラフ外)、名詞/動詞ルール | 全員 |
| [portable-chunk.md](./portable-chunk.md) | Chunk data と固定 wire format の portable 契約 | 実装者 |
| [portable-light-grid.md](./portable-light-grid.md) | Chunk の sky/block light packed data 契約 | 実装者 |
| [responsibility.md](./responsibility.md) | 持つもの / 持たないもの。**手元の作業を壊さない**という絶対規則 | 実装者・レビュアー |
| [public-api.md](./public-api.md) | 純粋層の API と契約 | 実装者 |
| [testing.md](./testing.md) | テスト戦略。**実ネットワーク clone をするテストは書かない** | 実装者・レビュアー |
| [versioning.md](./versioning.md) | このリポジトリは publish されない。**4 週間 API ロックまで公開を開始しない**ルール | リリース担当 |
| [toolchain.md](./toolchain.md) | 全 15 リポジトリ共通の toolchain pin 表と、`check:toolchain` / `check:pins` の読み方 | 実装者・レビュアー |

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
4. **feature-inventory.md** — 公式機能の所有境界と状態
5. **architecture.md** — リポジトリの境界と依存グラフ
6. **portable-chunk.md** / **portable-light-grid.md** — portable data contract
7. **public-api.md** — 純粋層の契約
8. **testing.md** — 検証ゲートとテスト戦略

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
| `pnpm check:features` | 機能棚卸しの不変条件と、checkout 済み根拠ファイルを検査 |
| `pnpm check:portable` | root の portable Chunk/light 契約と clone 済み runtime の実値を突合。未 clone は理由を表示し、比較対象ゼロは失敗 |
| `pnpm check:mirrors` | 手書きミラーと元リポジトリの**形**を突き合わせる。CI の別ステップ |
| `pnpm check:repoint` | ミラーを実際に消して import を張り替え、**`tsc` を走らせる**。`verify` には入っていない([testing.md](./testing.md) §6.1)。CI の別ステップ |
| `pnpm check:toolchain` | 各リポジトリの toolchain を pin 表([toolchain.md](./toolchain.md))と突き合わせる。未 clone は理由を表示し exit 0 |
| `pnpm check:pins` | 各リポジトリの `@nerima-games/*` pin が兄弟の現行 version と exact 一致するか検査する。未 clone は理由を表示し exit 0 |
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

- `repos.json` は下流リポジトリの pin を記録し、`pnpm sync` はその状態を `repos/` に再現する
- `repos/` は gitignore 対象で、空または部分的な状態も正常。workspace、mirror、repoint、feature inventory の各ゲートは未 checkout を理由付きで skip する
- `pnpm check:features` が全リポジトリの所有境界・状態・根拠パスを横断監査する。詳細は [feature-inventory.md](./feature-inventory.md)
- 公式 Minecraft parity の完了は宣言しない。`partial`、`unimplemented`、`deferred`、`blocked` の項目を棚卸しに残し、実装は各所有リポジトリで進める
- changesets の扱いは [versioning.md](./versioning.md) §6 に従う
