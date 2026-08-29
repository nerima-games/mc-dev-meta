# バージョニングと公開

## 1. このリポジトリ自身

- **`version`**: `0.1.0`
- **`private: true`**。**publish されない。永久に。**
- `publishConfig` を持たない(他の 15 リポジトリとの意図的な違い)
- `dependencies` は kernel の branded 値と service 契約に使う `effect` だけを持つ

`test/workspace.test.ts` が `private: true`、`publishConfig` 不在、そして許可された
`dependencies` の集合を固定している。事故で publish されることはない。

**このリポジトリの `version` はほぼ意味を持たない。** 誰も install しないためである。
実質的な「バージョン」は `repos.json` のコミット履歴であり、それが記録するのは
このリポジトリの状態ではなく**プロジェクト全体の合成状態**である。

## 2. 他の 15 リポジトリの公開はいつ始まるのか

### 2.1 かつての開始条件、そして今の開始条件

plan.md §6 Step 0 item 2 / §6 Step 3 は、当初こう定めていた:

> 界面が安定した(**API ロック 4 週間無変更**)リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発

**この「4 週間、api-lock.md が無変更」という日数計測ベースの自動ゲートは、昇格条件から外す
方針になった**(RELEASE_STANDARD.md §4.1)。一方、現在の `repos.json` が指す snapshot には
`api-lock.md` と、それを検査する `pnpm api:check` / `pnpm api:update` が残るリポジトリがある
(API_STANDARD.md §4)。このリポジトリが持っていた `scripts/check-api-lock-window.ts`
(`pnpm check:api-window`) は存在せず、残存するロックの鮮度・経過日数を横断で昇格条件には
しない。

**新しい昇格ポリシーは、日数や指標による自動ゲートではなく、maintainer(take)による裁量判断**
である(RELEASE_STANDARD.md §4.2)。判断材料は都度異なってよく、事前にすべて明文化することは
求めない。実質的なトリガーは「上位階層(依存する側)が実際にそのパッケージを消費し、動作確認を
終えたこと」だが、それをもって自動的に 1.0.0 へ上がるわけではなく、maintainer がその確認結果を
踏まえて 1.0.0 昇格の changeset(`major` bump)を書く、という運びになる。

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
2. **1.0.0 昇格は maintainer の裁量判断による**(日数や指標による自動ゲートは廃止。RELEASE_STANDARD.md §4)
3. **参照実装のテスト資産の移植が完了**
4. **ビルド / publish パイプラインが存在する**
5. **カバレッジ 99% ゲートが有効**

mc-dev-meta 自身にはこれらが適用されない。publish されないためである。
このリポジトリの完成条件はもっと単純である:

> **空の `repos/` でも 15 個そろった `repos/` でも、全コマンドが正しく動く。**

## 6. changesets — 決定済み、mc-dev-meta は対象外

**決着した。** `mc-dev-meta` を除く 15 リポジトリが、それぞれ独立に
`@changesets/cli` を導入する(RELEASE_STANDARD.md §1)。以前ここに書かれていた
「mc-dev-meta が `repos/*` workspace 全体に対して changesets を回す」という案は採用されなかった —
publish 権限を 1 か所に集める必要も、モノレポの体験を模す必要もなかったためである。

**mc-dev-meta 自身には changesets を導入しない。** `private: true`、`publishConfig` 無し、
永久に publish されない(本書 §1)ため、バージョン bump も CHANGELOG 生成も対象がない。
`.changeset/` ディレクトリも `@changesets/cli` への devDependency もこのリポジトリには存在しない。
