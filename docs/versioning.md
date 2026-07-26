# バージョニングと公開

## 1. このリポジトリ自身

- **`version`**: `0.1.0`
- **`private: true`**。**publish されない。永久に。**
- `publishConfig` を持たない(他の 15 リポジトリとの意図的な違い)
- `dependencies` を持たない。`effect` すら入っていない

`test/workspace.test.ts` が `private: true` と `publishConfig` 不在と
`dependencies` 不在を固定している。事故で publish されることはない。

**このリポジトリの `version` はほぼ意味を持たない。** 誰も install しないためである。
実質的な「バージョン」は `repos.json` のコミット履歴であり、それが記録するのは
このリポジトリの状態ではなく**プロジェクト全体の合成状態**である。

## 2. 他の 15 リポジトリの公開はいつ始まるのか

### 2.1 開始条件は 1 つだけ

plan.md §6 Step 0 item 2:

> **npm 公開・バージョン bump 運用は界面安定(4 週間 API ロック無変更)まで開始しない**

plan.md §6 Step 3:

> 界面が安定した(**API ロック 4 週間無変更**)リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発

つまり、あるリポジトリについて:

1. そのリポジトリの公開 API レポート(API ロックファイル)が
2. **4 週間、1 度も変更されていない**

これを満たしたとき、そのリポジトリだけが publish 運用に移る。
途中で 1 行でも変わったら、4 週間は**そこから数え直し**である。

**この「API ロックファイル」は 16 リポジトリすべてに実在する。**
各リポジトリ直下の `api-lock.md` がそれで、`pnpm api:check` が `pnpm verify` と CI の両方で
鮮度を検査する（[public-api.md](./public-api.md) §5）。
したがって上の条件は主観ではなく、`api-lock.md` が最後に変わったコミットの日付を見れば決まる。
`pnpm check:workspace` で 16 リポジトリぶんのゲートを一斉に回すこともできる。

### 経過日数は `pnpm check:api-window` が答える

条件の前半（レポートが実際の API と一致しているか）は各リポジトリの `pnpm api:check` が
強制していたが、**後半の「4 週間」は誰も測っていなかった**。plan.md の一文であり、
答えるには 15 箇所で `git log` を打って日付を手で引き算する必要があった。
**評価できない条件は条件ではない。**

```console
$ pnpm check:api-window
  mc-kernel: waiting — 0 days unchanged, 28 to go.
  ...
api-lock window: 0 stable, 15 waiting, 0 unknown (of 15).
```

起点は**記録せず導出している** —— `git log -1 -- api-lock.md` である。この選択には
手で日付を書く方式に無い性質が 2 つある。記述対象と乖離しようがないこと、そして
**API を変えれば起点が自動的に巻き戻る**こと。後者は「4 週間無変更」の意味そのものである。

判定は `domain/api-lock-window.ts` にあり、`now` を引数に取る。組織全体の `Date.now()` 禁止
（plan.md §4.3）はこのためにある —— 自分で時計を読む関数は、答えがたまたま正しい瞬間にしか
テストできない。引数にしたことで 27 日と 28 日の境界が通常のテストケースになっている。

**このコマンドは何もゲートしない。** `pnpm verify` にも入れていない。
publish は意図的な行為であって時計が引き起こすものではないし、3 日足りないという理由で
CI を落とすのは、報告ではなくスケジュールの強制である。
`verify` は「正しいか」に、これは「どれだけ古いか」に答える。

なお `unknown`（clone されていない等）は `waiting` に畳まない。
何も言っていないリポジトリを「未達」として報告するのは、ステータスボードが嘘をつき始める入口である。
ただし**その結果を 1 つのレポートに集約する仕組みはまだ無い**
（どのリポジトリが 4 週間に近いかの一覧は、今は手で数える）。

### 2.2 なぜ遅らせるのか

plan.md §8 のリスク表:

> 新規構築初期は全界面が高 churn
> → npm 公開を遅らせ dev-meta workspace で開発。**bump 連鎖を構造的に回避**

16 リポジトリが相互に依存する状態で早期に publish を始めると、
mc-kernel の 1 行変更が 15 リポジトリの bump 連鎖を引き起こす。

これは「面倒」ではない。**界面がまだ動いている時期には、作業が進まなくなる**という問題である。
1 日に何十回も型を足したり削ったりする時期に、
そのたびに 15 リポジトリの publish → bump → install をやることは不可能である。

**mc-dev-meta はその連鎖を構造的に不要にする道具である。**
`workspace:*` 解決なら、kernel を直せば sim が即座にそれを見る。

## 3. `workspace:*` から pin 済みバージョンへ

### 3.1 移行は階層ごとに、下から

移行は一斉には起きない。plan.md §6 Step 2 の構築順に、**層ごとに**起きる。

```
kernel                                          ← 最初に安定する。最初に publish
noise / meshing / physics / save / audio        ← 次(相互独立、並行可)
worldgen → sim → render → kit
gameplay / redstone → ui → multiplayer
compose                                         ← 最後
```

これは **ボトムアップの publish-then-pin** である:

1. 依存順に完成させる
2. 完成した層から publish する
3. 下流はそこで初めて**公開済みバージョンを pin** する

### 3.2 過渡期は混在する

```jsonc
// repos/mc-sim/package.json
"dependencies": {
  "@nerima-games/mc-kernel": "1.0.0",       // publish 済み。pin
  "@nerima-games/mc-save":   "workspace:*", // まだ開発中
  "@nerima-games/mc-physics": "workspace:*",
  "@nerima-games/mc-worldgen": "workspace:*"
}
```

**これが正常である。** `repos/` に clone されているリポジトリは
workspace メンバーとして解決されるので `workspace:*` の依存はそのまま動き、
pin された依存は GitHub Packages から来る。

### 3.3 pin した後も clone は続ける

publish 済みのリポジトリも `repos.json` に残り、`pnpm sync` で clone され続ける。

理由:

- **横断チェック**(`pnpm check:workspace`)の対象であり続ける
- **合成状態の記録**が publish 後も必要である。
  「バージョン 1.2.0 はどのソースリビジョンから来たか」を記録する場所が要る
- publish 済みリポジトリにも修正は入る。そのときまた `workspace:*` に戻る局面がある

## 4. `repos.json` と semver の関係

**別物である。混同しないこと。**

| | 何を記録するか | 誰が見るか |
| --- | --- | --- |
| `package.json` の `version` | その npm パッケージの API 互換性 | そのパッケージを import する開発者 |
| **`repos.json` の `ref`** | **プロジェクト全体の合成状態** | 回帰を bisect する人 |

publish が始まっても `repos.json` は SHA を記録し続ける。
バージョン番号ではなく SHA なのは、

- publish 前のリポジトリにはバージョンが無い
- publish 後でも「1.2.0 をビルドしたソース」を指すには SHA が要る
- バージョンは同じでも再 publish されうる

**マニフェストの価値は publish 後のほうが上がる。**
公開バージョンの組み合わせがどのソースから来たかを記録する唯一の場所になるからである。

## 5. 各リポジトリの 1.0.0 の条件(共通)

個々のリポジトリの完成条件は各リポジトリの `docs/versioning.md` にあるが、共通するのは:

1. **下流が実際に消費して契約を確認した**
2. **API ロック 4 週間無変更**(plan.md §6 Step 3)
3. **参照実装のテスト資産の移植が完了**
4. **ビルド / publish パイプラインが存在する**
5. **カバレッジ 99% ゲートが有効**

mc-dev-meta 自身にはこれらが適用されない。publish されないためである。
このリポジトリの完成条件はもっと単純である:

> **空の `repos/` でも 15 個そろった `repos/` でも、全コマンドが正しく動く。**

## 6. changesets はいつ入るのか

plan.md §6 Step 3 は publish 開始時に changesets 運用へ切り替えるとしている。

changesets は monorepo 前提のツールなので、16 リポジトリに散らばった状態でどう使うかは
**未決**である。候補:

1. 各リポジトリが独立して changesets を持つ(最も素直。連鎖の自動化は無い)
2. mc-dev-meta が `repos/*` workspace 全体に対して changesets を回す
   (モノレポと同じ体験。ただし publish 権限をここに集めることになる)

plan.md §9「未決事項」の「パッケージ公開先(GitHub Packages / private registry)」と
併せて、最初のリポジトリが 4 週間 API ロックを達成した時点で決める。
