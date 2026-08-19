# @nerima-games/mc-dev-meta

## 責務

**15 リポジトリを `repos/` に clone し、1 つの pnpm workspace として束ねる。
そして合成状態を `repos.json` に、横断的な機能の状態と所有境界を
`src/domain/feature-inventory.ts` に記録する。**

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
- `--latest` は **fast-forward のみ**。HEAD が origin の先端から辿れないリポジトリは
  **触らずにスキップ**する。作業コピーは detached なので、そこで作られたコミットは
  HEAD からしか辿れず、先端を checkout すれば失われるからである

15 の作業コピーを一度に触るツールは、1 コマンドで午後を丸ごと消せる。
だから危険な判断はすべて純粋関数(`domain/sync-plan.ts`)にあり、
`test/sync-plan.test.ts` が **git を 1 度も使わずに**全状態を網羅して検証している。

## 依存

**無い。** `dependencies` が存在せず、`effect` すら入っていない。

15 リポジトリを取ってくるツールが、それらからブートストラップされてはならないためである。
`domain/manifest.ts` の `Parsed<A>` が `Either` の手作り版なのはこの理由による。

runtime の依存グラフでは mc-dev-meta は**グラフの外**にいる。下流 runtime から
bootstrap 時に依存されない一方、依存なしで共有できる portable data contract はこの
repository が管理する。

## クイックスタート

```console
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack + oxlint が入る
$ pnpm install          # このリポジトリ自身の devDependencies (oxlint は上記 devShell 由来)
$ pnpm sync             # 15 リポジトリを repos/ へ clone
$ pnpm install          # ここで repos/* が workspace として解決される
```

Nix を使わない場合は Node.js 24 以上と pnpm 11 を用意する。

`pnpm sync` の後に `pnpm install` をもう一度打つのが要点である。
1 回目は `repos/` が空なので workspace メンバーがおらず、
2 回目で `@nerima-games/*` の相互依存が `workspace:*` として解決される。

**`pnpm-lock.yaml` は gitignore してある。** workspace ルートの lockfile は
`repos/` がどこまで存在するかで中身が変わる(空なら 1602 行、揃っていれば 2059 行)ので、
どちらを commit しても上の手順を踏むだけで恒久的に dirty になる。
pin すべきものは `repos.json` と各リポジトリ自身の lockfile にある。
理由の全文は [docs/workflow.md](./docs/workflow.md) §2.1 と `.gitignore` のコメント。

## コマンド

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
| `pnpm check:workspace <script>` | 別のスクリプトを指定して横断実行 |
| `pnpm check:features` | 公式機能の状態・所有境界・証拠を棚卸し |
| `pnpm check:portable` | root の portable Chunk/light 契約と clone 済み runtime の実値を突合 |
| `pnpm typecheck` | `tsconfig.build.json`(純粋層)と `tsconfig.test.json`(scripts + tests)を型検査 |
| `pnpm lint` | oxlint(このリポジトリ唯一の lint / format 設定)。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm test` | vitest(**プレーン vitest**。`@effect/vitest` は使わない — 依存ゼロのため) |
| `pnpm test:coverage` | カバレッジ計測。4 指標 100% の閾値ゲート付き |
| `pnpm check:mirrors` | 手書きミラー(`domain/kernel-vocabulary.ts` など)を**ミラー元リポジトリと突き合わせる**。下記 |
| `pnpm verify` | `typecheck && lint && test` のローカル基本ゲート。CI ではこれに Nix 評価、workspace / feature / portable / mirror / repoint 検査、カバレッジ検査を加える(TEST_STANDARD.md §1) |

**`pnpm verify` は `repos/` が空でも通る。** これは配慮ではなく責務である
— 15 リポジトリを取ってくるツールが、最後に信用できるようになるものであってはならない。

## `pnpm check:features` — 公式機能の所有境界を棚卸し

`src/domain/feature-inventory.ts` が、公式 Minecraft に必要な機能を
`implemented` / `partial` / `unimplemented` / `deferred` / `blocked` の状態と、
`mc-kernel` の canonical contract か各下流リポジトリの runtime かという所有境界つきで記録する。
`pnpm check:features` はそのカタログ、root の証拠ファイル、clone 済み下流リポジトリの証拠パスを検証する。
未 clone のリポジトリは理由つきで skip される。

このゲートが green であることは、公式 Minecraft の機能 parity が完了したことを意味しない。
未実装・部分実装・保留中の項目も同じカタログに残し、実装したリポジトリが証拠を更新する。

## `pnpm check:mirrors` — このリポジトリにしか置けない検査

いくつかのリポジトリは、依存先が publish されるまでの宣言を
**手書きでミラーしている**。publish 済みの `mc-worldgen` については
`mx-gameplay` が直接依存するため、ローカルの ChunkStore ミラーは残さない:

| ミラー | 置き場所 | ミラー元 |
| --- | --- | --- |
| `domain/kernel-vocabulary.ts` | mc-sim / mc-render / mc-playground-kit / mc-compose | mc-kernel |
| `domain/frame-contract.ts` | mx-gameplay / mx-redstone / mx-ui | mc-kernel |

各リポジトリには `*-mirror.test.ts` があり、形と `Context.Tag` のキーを両方向に pin している。
**それは「書き写した結果」を pin しているのであって、「書き写し元」ではない。**
元がまだ依存関係にできない別リポジトリにある場合、
ミラーと元は乖離できる。`check:mirrors` はその乖離をこの repository で検出する。

**mc-dev-meta は、両方のパッケージが 1 つのビルドに同時に存在する組織内で唯一の場所である。**
この検査がここにあり、他のどこにも置けない理由はそれに尽きる。

比較は 3 系統に分かれる(`domain/mirror-contract.ts` に全論拠がある):

1. **値** — 両方の実モジュールを import して実行する。定数は直接比較、`Brand.refined`
   は固定サンプル列に対する accept / reject / throw のベクタで比較する
   (`DeltaTimeSecs` が片方で `[0.001, 0.05]`、片方で `>= 0` だった過去の欠陥はこれで捕まる)。
2. **タグキー** — 同じく import して `.key` を比較する。Effect はこの文字列で解決するので、
   食い違った 2 つは実行時に別サービス・型検査は両方通る。
3. **型の形** — 型は実行時に存在しないので、ミラー元の**コミット済み `api-lock.md`**
   (tsc の declaration emit で生成されていた)とミラーのソースを、同じパーサで読む。
   `api-lock.md` とそれを生成・検査していた `pnpm api:check` は org 全体で廃止された
   (API_STANDARD.md §4)。**このリポジトリの `pnpm check:mirrors` はミラー元が
   `api-lock.md` をコミットしていることを前提に組まれているため**、ミラー元リポジトリの
   移行で同ファイルが削除されると、その 1 スペックは(値・タグキーの比較も含めて)
   まるごと `skip`(理由付き)として報告されるようになる。`repos/` が空・部分的なときと
   同じ扱いであり、CI を落とさない。比較するのは**メンバ名・省略可否・union の arm** で、
   **メンバの型は比較しない** — ミラーは意図的にそこで乖離しており
   (`biomes: ReadonlyArray<string>`、unbranded な `BlockId`)、既知の差分で埋まった
   レポートは誰も読まなくなるからである。

`repos/` が空・部分的・未 install のときは **skip**(理由を毎回印字する)。
別リポジトリにあって修正できない実在の欠陥は `KNOWN_FINDINGS` に指紋つきで記録し、
毎回印字はするが run は落とさない。ただし**新しい差分**と、
**直ったのに残っているエントリ**は落とす。

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
| [docs/architecture.md](./docs/architecture.md) | 4 階層、15 runtime リポジトリ依存グラフ、portable contract、参照実装との対比 |
| [docs/responsibility.md](./docs/responsibility.md) | 持つもの / 持たないもの。作業を壊さない仕組み |
| [docs/feature-inventory.md](./docs/feature-inventory.md) | 公式機能の状態、所有境界、証拠の更新手順 |
| [docs/public-api.md](./docs/public-api.md) | 純粋層の API と契約 |
| [docs/testing.md](./docs/testing.md) | テスト戦略 |
| [docs/versioning.md](./docs/versioning.md) | publish されない理由、4 週間 API ロック |

## 依存ルール(15 runtime リポジトリ共通)

| ルール | 内容 |
| --- | --- |
| ハード失敗 | 違反があれば CI は必ず非ゼロ終了する。警告で済ませない |
| 循環禁止 | 循環依存は一切許可しない。「co-evolution ペア」のような例外リストは設けない |
| 推移閉包の禁止 | A→B、B→C のとき A は C を import できない。依存は直接依存のみが import 許可を意味する |
| kernel は例外 | mc-kernel はどこからでも import 可 |
| 宣言と実体の一致 | import する `@nerima-games/*` は `package.json` に記載されていなければならない |
| mc-playground-kit は devDependency 専用 | `dependencies` に入れてはならない。実行時依存になると、出荷ビルドから入力処理が消える |
| `Date.now()` 禁止 | 時刻はすべて注入された Clock Port から取得する |

**この表の Tier 境界(循環禁止・推移閉包の禁止・宣言と実体の一致・kernel 例外・
mc-playground-kit の扱い)は、各リポジトリ own の `.oxlintrc.json#no-restricted-imports`
で検査する** (DEPENDENCY_POLICY.md)。各リポジトリが手書きの依存グラフを
`scripts/check-dependency-whitelist.ts` として持つ方式は org 全体で廃止された。

このリポジトリは **ロスターの参照コピー**(`domain/repository-roster.ts`)を持つ。
mc-dev-meta は依存グラフの外(層外)にあり、runtime package を `@nerima-games/*` から
bootstrap しない。portable data contract は依存なしで root が管理するため、
`.oxlintrc.json#no-restricted-imports` に runtime Tier 境界のエントリを持たない
(DEPENDENCY_POLICY.md「層外」)。

### `Date.now()` 禁止の実装方法

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は `oxlint --rules` の一覧に出るものの実装されていない(0.12.0 で実測確認済み)。

この禁止をかつて実装していた `scripts/check-dependency-whitelist.ts` は org 全体で廃止された
(DEPENDENCY_POLICY.md)。ツールによる代替の強制は無く、レビューのみで守る
(oxlint がこの種の禁止を実装した時点でここに追加する)。

## 現状

**このリポジトリは workspace binder と横断監査を提供する。**

- **`repos.json` の 15 件は実 SHA に固定済み。** 15 リポジトリが GitHub 上に作成された後、
  `pnpm update:manifest` で固定した。それ以前は全件 `"unpinned"` だった —— 架空の SHA で
  埋めるより、存在しないと書いてあるほうがよいため
- **`pnpm sync` は実リモートに対して検証済み。** 15 件の clone、2 回目以降は no-op。
  以前は未固定エントリが毎回 3 回 fetch していた(45 往復)
- **pin が進まないデッドロックは解消済み。** sync が `repos/ <- pin` を書き
  update:manifest が `pin <- repos/ HEAD` を書くのでループが閉じており、
  6 リポジトリに push しても**両コマンドとも成功を報告して何もしなかった**。
  `--latest` がこれを破る。詳細は [docs/manifest.md](./docs/manifest.md) §5
- **ロスターは publish しない。** `domain/repository-roster.ts` は root の同期・監査用の参照コピーであり、runtime API ではない
- **機能の責任境界は棚卸し済み。** `pnpm check:features` が root のカタログと、clone 済みリポジトリにある証拠を検査する。状態が `partial` / `unimplemented` / `deferred` / `blocked` の項目は未完了として残る
- **公式 Minecraft の parity は未完了。** このリポジトリは全 runtime を所有せず、`mc-kernel` に共有契約を集約し、各下流リポジトリが runtime 機能を実装する
- **changesets は対象外。** `private: true`、永久に publish されない
  ([RELEASE_STANDARD.md §0](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md))
- **カバレッジ 4 指標 100% ゲートは有効。** この repository の純粋なドメイン層は、
  `src/` のドメインコードを対象に statements / branches / functions / lines の
  すべてを検査する。スクリプトはカバレッジ対象から除外し、空の `repos/` に対する
  workspace / feature / mirror / repoint の実行ゲートで検査する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

## License

MIT
