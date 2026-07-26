# plan.md §6 Step 2 の横断状況 —— 「プレビューが操作可能」なリポジトリは **1 / 15**

- 集計日: 2026-07-26
- 対象: `nerima-games` の 16 リポジトリ（うち Step 2 の対象は mc-dev-meta を除く 15）
- なぜここにあるか: この事実は**どの 1 リポジトリのものでもない**。
  各リポジトリの `docs/testing.md` は自分の完了条件を ❌ と正しく書いているが、
  **15 個ぜんぶが ❌ である**ことはどこにも書かれていなかった。
  mc-dev-meta は 15 リポジトリを 1 つの workspace に束ねる唯一の場所なので、
  横断の事実はここに置く（[manifest.md](./manifest.md) が合成**状態**を記録するのと同じ理由）。

## 1. 事実

plan.md §6 Step 2 は 15 リポジトリすべてに同じ完了条件を課している。
そのうちの 1 つが「**内蔵プレビューが操作可能**」である。

> **この条件を満たしているリポジトリは、現時点で 1 つも無い。**

機械的に確認できる:

```console
$ ls -d */apps 2>/dev/null | wc -l
0
$ grep -l '@nerima-games/' */package.json --include='package.json' | wc -l   # name 行を除く依存宣言
0
```

- **`apps/` ディレクトリがどのリポジトリにも存在しない。**
  plan.md §4.1 は「プレビューは契約に含めない。各リポジトリ内の dev アプリ。`apps/preview-*/` に配置」と
  定めており、置き場所そのものがまだ作られていない。
- **プレビューを起動するハーネス `mc-playground-kit` は、どのリポジトリからも参照されていない。**
  16 個の `package.json` のうち `@nerima-games/*` を `dependencies` / `devDependencies` に
  書いているものは 0 件である（`"name"` フィールドとしての出現のみ）。
- **kit 自身も未達である。** kit の完了条件は「自身の最小 E2E（起動 → 操作 → スクリーンショット）」だが、
  `@playwright/test` はどのリポジトリにも入っておらず、`e2e/` ディレクトリも存在しない。

## 2. なぜ 0 なのか —— 単一のボトルネック

15 本のプレビューはすべて `mc-playground-kit` の `launchPlayground()` の上に載る設計である
（plan.md §3.10、kit の
[architecture.md](https://github.com/nerima-games/mc-playground-kit/blob/main/docs/architecture.md) §3.2）。
そして kit は 4 つの親（kernel / worldgen / sim / render）の実 Layer を必要とするが、
**まだ何も publish されていない**ので Port は全部注入待ちである
（plan.md §6 Step 3 の bottom-up publish-then-pin）。

したがって残る 14 件は 14 個の独立した遅れではなく、**1 本の連鎖の未着手**である。

```
publish なし → kit が実 Layer を持てない → kit の最小 E2E が書けない
            → kit を要するプレビューが作れない
```

### この連鎖は、思っていたほど強くなかった

本書の初版はこの連鎖を「どのリポジトリも `apps/preview-*/` を作れない」と書いていた。
**mc-worldgen がそれを反証した。** 端末 ANSI で描くプレビューは kit も publish も
THREE.js も必要とせず、`mc-worldgen` の公開 API だけで動く。しかも 3D より強い
—— 「海面が本当に 63 か」「湖底が空洞になっていないか」は断面図なら一目で、
一人称で潜って確かめるより速い。

連鎖が本当に縛るのは**一人称で操作するプレビュー**だけである。地形・回路盤・
インベントリのように「状態を見る」プレビューは、いま作れる。残り 14 件のうち
どれがどちらかは §3 の内訳を見ること。

これは kit の
[README.md](https://github.com/nerima-games/mc-playground-kit/blob/main/docs/README.md) が
「ここが遅ければ全リポジトリの開発が遅くなる」と書いていることの、現時点での実測である。

## 3. リポジトリ別

| リポジトリ | Step 2 のプレビュー（plan.md） | `apps/` | kit を devDep 宣言 | 状態 |
| --- | --- | --- | --- | --- |
| `mc-kernel` | （プレビューを持たない層） | — | — | 対象外 |
| `mc-noise` | （プレビューを持たない層） | — | — | 対象外 |
| `mc-meshing` | （プレビューを持たない層） | — | — | 対象外 |
| `mc-physics` | （プレビューを持たない層） | — | — | 対象外 |
| `mc-save` | （プレビューを持たない層） | — | — | 対象外 |
| `mc-audio` | （プレビューを持たない層） | — | — | 対象外 |
| `mc-worldgen` | 地形プレビュー（**最初の遊べる成果物**） | ✅ 有 | ✅ 有 | ✅ |
| `mc-sim` | 障害物コース | ❌ 無 | ❌ 無 | ❌ |
| `mc-render` | 内蔵ビューア | ❌ 無 | ❌ 無 | ❌ |
| `mc-playground-kit` | 自身の最小 E2E（起動→操作→スクショ） | ❌ 無 | — | ❌ |
| `mx-gameplay` | 採掘場 / Mob アリーナ / 時間スライダー（3 本） | ❌ 無 | ❌ 無 | ❌ |
| `mx-redstone` | 回路盤 | ❌ 無 | ❌ 無 | ❌ |
| `mx-multiplayer` | ローカル 2 クライアント | ❌ 無 | ❌ 無 | ❌ |
| `mx-ui` | 各画面の単体起動 | ❌ 無 | ❌ 無 | ❌ |
| `mc-compose` | E2E（最終ゲート） | ❌ 無 | — | ❌ |

「対象外」の 6 つは、各リポジトリの `docs/architecture.md` が
「プレビューを持たない層なので kit を devDependency としても使わない」と明記しているものである。
**プレビューを持つべき 9 リポジトリのうち、達成は 0 件。**

## 4. 誤読しないこと

- **「何も進んでいない」ではない。** 16 リポジトリすべてで
  `pnpm verify`（typecheck / lint / check:deps / api:check / test）は green であり、
  依存ホワイトリスト・API ロック・stage 契約・回帰テスト名といった**ゲートのほうが先に実在している**。
  plan.md §6 Step 2 のもう半分の条件（「テスト green」）は満たされている。
- **各リポジトリの `docs/` は嘘を書いていない。** どの `docs/testing.md` も自分の完了条件を ❌ と書いている。
  欠けていたのは横断の集計だけで、本書がそれである。
- **この数字は kit の publish で一気に動く。ただし全部ではない。** 一人称で操作する
  プレビューは kit を待つが、状態を見るプレビューは待たない —— mc-worldgen がそれを示した。
  進捗を測るなら「kit が実 Layer を持てたか」と「kit を要さないプレビューを作ったか」を
  分けて見ること。

## 5. 更新のしかた

本書は手作業の集計である。`pnpm check:workspace` は各リポジトリの `pnpm verify` を回すだけで、
プレビューの有無は見ていない。数字を更新するときは §1 の 2 本のコマンドを再実行し、
§3 の表と `manifest.md` §2.2 の `unpinned` 件数を突き合わせること。
