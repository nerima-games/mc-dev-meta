# 責務

## 1. 一行で

**15 リポジトリを `repos/` に clone し、1 つの pnpm workspace として束ねる。
そして合成状態を `repos.json` に記録する。**(plan.md §6 Step 0 item 2)

## 2. 持つもの

| 責務 | 実装 | 純粋か |
| --- | --- | --- |
| 16 リポジトリのロスターと依存グラフ(参照コピー) | `domain/repository-roster.ts` | 純粋 |
| マニフェストのパース・検証・書き出し | `domain/manifest.ts` | 純粋 |
| **同期判断**(clone / fetch / checkout / skip) | `domain/sync-plan.ts` | **純粋** |
| ワークスペース実行の計画 | `domain/workspace.ts` | 純粋 |
| git を実際に叩く | `scripts/sync-repos.ts` | 不純 |
| マニフェストの pin 更新 | `scripts/update-manifest.ts` | 不純 |
| 全リポジトリ横断チェック | `scripts/check-workspace.ts` | 不純 |
| pnpm workspace 定義 | `pnpm-workspace.yaml` | — |
| 合成状態の記録 | `repos.json`(コミット済み) | — |

### 2.1 危険な判断はすべて純粋層にある

`domain/` は**ファイルシステムにも git にもネットワークにも触らない**。
`tsconfig.build.json` が `types: []` でコンパイルするので、Node のグローバルすら見えない。

これは意図的である。**15 の作業コピーを一度に触るツールは、
1 コマンドで午後を丸ごと消せる**。その判断部分がテストできないのは受け入れられない。

結果として `test/sync-plan.test.ts` は、観測可能な**全状態 × 全マニフェストエントリ**を列挙して、

- dirty なら必ずスキップされること
- 到達しうるどの git コマンドも破壊的引数を含まないこと
- checkout は必ず `--detach` であること
- 冪等であること(計画 → 適用 → 再計画で no-op)

を、**git リポジトリも一時ディレクトリもネットワークも使わずに**検証している。

`scripts/` はその判断の薄い殻である。

## 3. 絶対規則: 手元の作業を壊さない

> **THE SYNC SCRIPT MUST NEVER DESTROY LOCAL WORK.**

強制は 3 重:

| 層 | 内容 |
| --- | --- |
| **アクション集合** | `SyncAction` に「破棄」を意味するものが存在しない。呼べるものが無い |
| **純粋テスト** | `gitCommandsFor` が生成しうる全コマンドを列挙し、破壊的引数が無いことを検証 |
| **実行時** | `runGit` が実行直前に引数を検査し、含まれていたら拒否する |

禁止語(`DESTRUCTIVE_GIT_ARGUMENTS`):
`reset` / `clean` / `restore` / `--hard` / `--force` / `-f` / `-D` / `--delete`。

### 3.1 dirty なリポジトリの扱い

**スキップする。エラーにしない。黙らない。**

- 未コミットの作業があるのは普通のことなので、失敗にはしない
- 同期されなかったことは呼び出し側が知る必要があるので、黙ってもいけない
- `git status` が読めなかった場合も **dirty 扱い**にする。fail closed が唯一安全な既定値

### 3.2 checkout は必ず detached

`git checkout <ref>` ではなく `git checkout --detach <ref>` を使う。
clean な木に対してでも、前者は「開発者がいたローカルブランチ」を動かしうる。
後者はローカルブランチを作りも動かしもしない。

### 3.3 `unpinned` は fetch のみ、しかも 1 run に 1 回

`repos.json` の ref が `"unpinned"` のとき、**HEAD は絶対に動かさない**。
`unpinned` は「どこにいるべきか誰も決めていない」の意味であり、
動かすことは推測になる。推測は、開発者が意図して checkout していたコミットを黙って捨てる。

そのうえで、fetch は **1 run につき 1 リポジトリ 1 回**である。
pin されたエントリは「ref に着いた」ことで終われるが、`unpinned` には着くべき ref が無い。
終わり方を別に用意しないと、判断関数は同じ状態に対して `Fetch` を返し続け、
収束ループが上限まで回る。それが `SyncAction` に `UpToDate` があり
`WorkingCopyState` に `fetchedThisRun` がある理由である
([public-api.md](./public-api.md) §3)。

## 4. 持たないもの

| 持たない | 理由 |
| --- | --- |
| **管理対象リポジトリへの実行時依存** | 15 リポジトリを取ってくるツールが、それらからブートストラップされてはならない。`effect` は kernel の契約のために許可された唯一の runtime dependency |
| ゲームコード | ゲームグラフの外にいる |
| `repos/` の中身 | gitignore。ベンダリングは分割の意味を消す |
| 自分自身を workspace メンバーにする設定 | 同上の循環 |
| リポジトリを消す/巻き戻す機能 | §3 |
| CI の定義(各リポジトリの) | 各リポジトリが自分の CI を持つ。ここは横断実行だけ |
| バージョン bump / publish | [versioning.md](./versioning.md)。そもそもこのリポジトリは publish されない |

## 5. 空の `repos/` で動くこと ― これも責務

**新規 clone 直後の `repos/` は空である**(gitignore されているため)。
この状態で:

- `pnpm install` が通る
- `pnpm verify` が通る
- `pnpm check:workspace` が **exit 0** で「空です、`pnpm sync` してください」と言う
- `pnpm check:features` がルートの統合ソースを読み、未実装仕様を非ゼロで報告する
- `pnpm sync:dry` が計画を出す

これは細かい配慮ではなく**責務**である。
もし `pnpm verify` が 15 リポジトリの存在を要求したら、
**15 リポジトリを取ってくるツールが、最後に信用できるようになるもの**になってしまう。
順序が完全に逆である。

回帰テスト: `test/workspace.test.ts` の
`reports status "empty" when nothing is cloned` 以下。

## 6. ボトムアップ構築中は「部分的」が正常

plan.md §6 Step 2 の構築順に作るので、プロジェクトの人生の大半において
ロスターの一部しか存在しない。

**部分的なワークスペースは失敗ではない。**
`pnpm check:workspace` は clone 済みのものだけを走らせ、
未 clone のものを一覧で報告して exit 0 する。

「未来がまだ来ていないので失敗しました」と言うツールは、人が使うのをやめる。
