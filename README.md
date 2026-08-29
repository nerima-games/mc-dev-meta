# @nerima-games/mc-dev-meta

## 責務

**15 リポジトリを `repos/` に clone し、1 つの pnpm workspace として束ねる。
そして合成状態を `repos.json` に記録する。加えて、移植可能な Minecraft のデータと
純粋なルールを `src/kernel/` に集約し、管理層とゲーム実行層の境界を検証する。**

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

`effect` は `Brand`、`Context`、`Effect`、`Layer` を使う `src/kernel/` の公開契約のための
意図的な runtime dependency である。逆に、管理スクリプトは `mc-*` パッケージから
ブートストラップされず、Node.js の filesystem / process / network I/O は `scripts/` に隔離する。
`domain/manifest.ts` の `Parsed<A>` は、manifest parser の小さなエラー契約を保つための
ローカルなデータ型であり、依存ゼロの名残ではない。

リポジトリ依存グラフの上では mc-dev-meta は**グラフの外**にいる。ここでいうグラフは
管理対象リポジトリ間の `dependsOn` であり、ルートの npm runtime dependency を否定しない。

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
| `pnpm typecheck` | `tsconfig.build.json`(純粋層)と `tsconfig.test.json`(scripts + tests)を型検査 |
| `pnpm lint` | oxlint(このリポジトリ唯一の lint / format 設定)。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm test` | vitest(**プレーン vitest**。`@effect/vitest` に依存せず、テストハーネスを runtime 実装から分離) |
| `pnpm test:coverage` | カバレッジ計測。4 指標 100% の閾値ゲート付き(下記「現状」参照) |
| `pnpm check:mirrors` | 手書きミラー(`domain/kernel-vocabulary.ts` など)を**ミラー元リポジトリと突き合わせる**。下記 |
| `pnpm check:features` | `src/` と `test/` に集約した機能証拠を監査。`partial` / `missing` があれば非ゼロ |
| `pnpm verify` | `typecheck && lint && test:coverage`。CI と同じ内容。`check:mirrors` は CI では別ステップとして走る(TEST_STANDARD.md §1) |

**`pnpm verify` は `repos/` が空でも通る。** これは配慮ではなく責務である
— 15 リポジトリを取ってくるツールが、最後に信用できるようになるものであってはならない。

`pnpm check:features` は `verify` の一部ではない。`src/domain/feature-register.ts` の
証拠仕様をローカルの統合ソースへ適用し、`complete` 以外を非ゼロで報告する。このコマンドは
ゲーム runtime を実装するものでも、登録簿にない Minecraft の全公式機能やブラウザ／ネットワーク
アダプタを網羅したことを示すものでもない。未移植の gap を隠さず、移植境界を観測するゲートである。

## `pnpm check:mirrors` — このリポジトリにしか置けない検査

まだ何も publish されていないため、いくつかのリポジトリは将来 import する宣言を
**手書きでミラーしている**:

| ミラー | 置き場所 | ミラー元 |
| --- | --- | --- |
| `domain/kernel-vocabulary.ts` | mc-sim / mc-render / mc-playground-kit / mc-compose / mc-worldgen | mc-kernel |
| `domain/frame-contract.ts` | mx-gameplay / mx-redstone / mx-ui | mc-kernel |
| `domain/chunk-store-port.ts` | mx-gameplay | mc-worldgen(能力表は mc-kernel) |

各リポジトリには `*-mirror.test.ts` があり、形と `Context.Tag` のキーを両方向に pin している。
**それは「書き写した結果」を pin しているのであって、「書き写し元」ではない。**
元は依存関係にない別リポジトリにあり、publish されるまで依存関係にできない。
だからミラーと元は乖離でき、各リポジトリ自身のテストが green でも横断的な差分を見逃しうる。

**mc-dev-meta は、両方のパッケージが 1 つのビルドに同時に存在する組織内で唯一の場所である。**
この検査がここにあり、他のどこにも置けない理由はそれに尽きる。

比較の実装は責務別に分かれる。`domain/mirror-registry.ts` は登録簿、`domain/mirror-model.ts` は契約データと観測値、`domain/mirror-comparison.ts` は純粋比較、`domain/mirror-run.ts` は実行結果の集約、`domain/mirror-finding-report.ts` は検出結果の表示、`domain/repository-provenance.ts` と `domain/mirror-path.ts` は provenance とパス生成を担当する:

1. **値** — 両方の実モジュールを import して実行する。定数は直接比較、`Brand.refined`
   は固定サンプル列に対する accept / reject / throw のベクタで比較する
   (`DeltaTimeSecs` が片方で `[0.001, 0.05]`、片方で `>= 0` だった過去の欠陥はこれで捕まる)。
2. **タグキー** — 同じく import して `.key` を比較する。Effect はこの文字列で解決するので、
   食い違った 2 つは実行時に別サービス・型検査は両方通る。
3. **型の形** — 型は実行時に存在しないので、ミラー元の**コミット済み `api-lock.md`**
   (tsc の declaration emit で生成されていた)とミラーのソースを、同じパーサで読む。
   `api-lock.md` の無変更期間を昇格条件にする運用は廃止方針になった。一方、現在の
   `repos.json` が指す snapshot には `api-lock.md` と `pnpm api:check` が残るリポジトリがある。
   **このリポジトリの `pnpm check:mirrors` はミラー元が
   `api-lock.md` をコミットしている間だけ型の形を比較する**ため、ミラー元リポジトリの
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

**この表の Tier 境界(循環禁止・推移閉包の禁止・宣言と実体の一致・kernel 例外・
mc-playground-kit の扱い)は、各リポジトリ own の `.oxlintrc.json#no-restricted-imports`
で検査する** (DEPENDENCY_POLICY.md)。各リポジトリが手書きの依存グラフを
`scripts/check-dependency-whitelist.ts` として持つ方式は、新しい mc-dev-meta 側の重複実装にはしない。
ただし、現在の `repos.json` が指す snapshot にはこのスクリプトと `pnpm check:deps` が残るため、
撤去完了とは扱わず、各リポジトリの `verify` を `pnpm check:workspace` から実行する形で観測する。

このリポジトリは **ロスターの参照コピー**(`domain/repository-roster.ts`)を持つ。
mc-dev-meta は依存グラフの外(層外)にあり、`@nerima-games/*` を 1 つも import しないため、
`.oxlintrc.json#no-restricted-imports` に Tier 境界のエントリを持たない
(DEPENDENCY_POLICY.md「層外」)。

### `Date.now()` 禁止の実装方法

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は `oxlint --rules` の一覧に出るものの実装されていない(0.12.0 で実測確認済み)。

この禁止は現在の snapshot では各リポジトリの `scripts/check-dependency-whitelist.ts`
(`pnpm check:deps`) が検査している。mc-dev-meta 自身はこのスクリプトを複製せず、
`pnpm check:workspace` で兄弟リポジトリの `verify` を観測する
(oxlint がこの種の禁止を実装した時点でここに追加する)。

## 現状

**ルートの監査・同期基盤は実装済みで、兄弟リポジトリの機能完成度は別管理である。**

- **`repos.json` の 15 件は実 SHA に固定済み。** 15 リポジトリが GitHub 上に作成された後、
  `pnpm update:manifest` で固定した。それ以前は全件 `"unpinned"` だった —— 架空の SHA で
  埋めるより、存在しないと書いてあるほうがよいため
- **`pnpm sync` は実リモートに対して検証済み。** 15 件の clone、2 回目以降は no-op。
  以前は未固定エントリが毎回 3 回 fetch していた(45 往復)
- **pin が進まないデッドロックは解消済み。** sync が `repos/ <- pin` を書き
  update:manifest が `pin <- repos/ HEAD` を書くのでループが閉じており、
  6 リポジトリに push しても**両コマンドとも成功を報告して何もしなかった**。
  `--latest` がこれを破る。詳細は [docs/manifest.md](./docs/manifest.md) §5
- **ロスターを publish する仕組みは未実装。** このルートが管理する同期対象は 15 件で、ミラー削除後の依存切替は各兄弟リポジトリ側で行う
- **機能完成度の入口は `pnpm check:features`。** `feature-register.ts` に登録された限定的な
  証拠仕様を同期済み snapshot へ適用し、実装済み・部分実装・未実装を分けて報告する。
  登録簿にない機能まで実装済みとは推論しない
- **changesets は対象外。** `private: true`、永久に publish されない
  ([RELEASE_STANDARD.md §0](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md))
- **カバレッジ 4 指標 100% ゲートは有効。** `pnpm test:coverage` は
  `src/index.ts` と `src/domain/**` を対象に、statements / branches / functions /
  lines のすべてで100%を要求する。`scripts/**`・`repos/**`・型で到達不能な
  `assertUnreachable` は責務上の除外として設定に明記している。現在の実測は4指標とも100%である。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

## License

MIT
