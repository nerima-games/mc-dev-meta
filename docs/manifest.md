# なぜ `repos.json` が存在するのか

## 1. 一段落で

`repos/` は gitignore されている。それは正しい
— 15 リポジトリを 16 個目にベンダリングしたら分割の意味が消える。
だがその帰結が見落とされやすい:

> **マニフェストが無ければ、プロジェクトの合成状態はどこにもバージョン管理されていない。**

そうなると「昨日は動いていた」に答える手段が無い。
E2E が最後に通ったとき 15 リポジトリのどのコミットが checkout されていたかを述べる成果物が
存在しないので、**組み合わせでしか起きない回帰は bisect できない**
— bisect すべき対象そのものが、どこにも無いからである。

`repos.json` がその成果物である。**合成状態のロックファイル**であり、
ロックファイルをコミットするのとまったく同じ理由でコミットされている。

## 2. 何が書いてあるか

```json
{
  "manifestVersion": 1,
  "repositories": [
    {
      "name": "mc-kernel",
      "url": "https://github.com/nerima-games/mc-kernel.git",
      "ref": "unpinned"
    }
  ]
}
```

| フィールド | 意味 |
| --- | --- |
| `manifestVersion` | スキーマ版。理解できない版は**拒否する**(半端に読むほうが読まないより悪い) |
| `name` | リポジトリ名 = `repos/` 下のディレクトリ名 = パッケージ名の接尾辞 |
| `url` | clone URL |
| `ref` | **40 文字のコミット SHA**、または `"unpinned"` |

### 2.1 ブランチ名は pin ではない

`ref` に許されるのは 40 文字の完全な SHA か `"unpinned"` だけである。
`main` も `v1.0.0` も `HEAD` も短縮 SHA も**拒否される**。

理由は 1 つ。**ブランチは動く。** マニフェストの存在意義は合成状態を bisect できることなので、
動く ref を書いた時点でマニフェストは何も記録していないことになる。
タグも re-point されうるし、短縮 SHA は曖昧になりうる。

エラーメッセージがそう言う:

> A ref must be a full 40-character commit SHA, or the literal "unpinned".
> A branch name is not a pin: it moves, and the whole point of the manifest is
> that the composite state can be bisected.

### 2.2 `unpinned` という明示的な逃げ道

`repos.json` の 15 件は現在、実 SHA に固定されている。リポジトリが GitHub 上に
作成されたのち `pnpm update:manifest` で固定した。

それ以前は全件が `"unpinned"` だった。理由は正直に言えば、**15 リポジトリのほとんどが
まだ存在しなかったから**である。架空の SHA で埋めたマニフェストは、そう書いてある
マニフェストより悪い。`unpinned` はその状態を型で表明するための逃げ道であり、
リポジトリが増えるたびに再び使われる。

`"unpinned"` は sentinel であり、次の性質を持つ:

- **fetch はされるが checkout はされない。** `unpinned` は「どこにいるべきか誰も決めていない」の意味であり、
  動かすことは推測になる。推測は、開発者が意図して checkout していたコミットを黙って捨てる
- **毎回報告される。** `pnpm check:workspace` が実行のたびに未 pin の一覧を出す。
  sentinel が静かに恒久化するのを防ぐため
- **`pnpm update:manifest` が SHA に変える**

## 3. マニフェストを更新する

```console
$ pnpm update:manifest        # clone 済み・clean なリポジトリを現在の HEAD に pin
$ pnpm update:manifest:dry    # 差分が出るかだけ確認
$ git add repos.json && git commit
```

### 3.1 このツールが**書かないもの**

| 状況 | 動作 | 理由 |
| --- | --- | --- |
| clone されていない | ref をそのまま残す | 存在しないものについて意見を持たない |
| **未コミットの変更がある** | **pin しない** | dirty な木の HEAD は手元の状態を記述していない。pin すると**誰も再現できない状態を pin 済みの見た目で**記録することになる |
| 既に同じ SHA | 何もしない | |

### 3.2 差分は 1 行になる

`serialiseManifest` は 2 スペースインデント + 末尾改行という固定の形で書く。
1 リポジトリを pin したときの差分が**1 行**になるようにするためである
(`test/manifest.test.ts` の
`changes exactly one line when one ref is pinned` が保証している)。

再フォーマットしてしまうと `pnpm update:manifest` のたびに全ファイル差分が出て、
誰もレビューしなくなる。

## 4. `pnpm sync` が壊さないこと

マニフェストを読んで作業コピーを動かすのは `pnpm sync` である。
**唯一の絶対規則**:

> このスクリプトは手元の作業を決して壊さない。

強制は 3 重になっている:

1. **`domain/sync-plan.ts` のアクション集合に「破棄」を意味するものが存在しない。**
   呼べるものが無い
2. **`gitCommandsFor` は純粋関数であり、`test/sync-plan.test.ts` が
   観測可能な全状態 × 全マニフェストエントリを列挙して、
   到達しうるどのコマンドにも `reset` / `clean` / `restore` / `--hard` / `--force` が
   含まれないことを検証する**(git は 1 度も使わない)
3. **`runGit` が実行直前に同じ検査をする** — このスクリプトが生成していないコマンドに対しても

さらに checkout は必ず `--detach` である。
`git checkout <branch>` は clean な木に対してでも「開発者がいたブランチ」を動かすが、
`--detach` はローカルブランチを作りも動かしもしない。

### 4.1 dirty なリポジトリ

**スキップする。エラーにしない。黙らない。**

```
  SKIP    mc-sim — uncommitted changes. Nothing was touched. Commit or stash, then re-run.
```

未コミットの作業があるのは普通のことなので失敗にはしない。
だが同期されなかったことは呼び出し側が知る必要があるので、黙ってもいけない。

`git status` が読めなかった場合も **dirty 扱い**にする。
作業を守るのが仕事の検査は、fail closed が唯一安全な既定値である。

### 4.2 冪等性

`pnpm sync` を 2 回続けて打つと、2 回目は何もしない。

この性質は `domain/sync-plan.ts` の `applyAction`
(スクリプトが作業コピーに何をするかのモデル)に対して検証されている:
計画 → 適用 → 再計画、で 2 回目が no-op になること。
**スクリプトがこのモデルから外れたら、間違っているのはスクリプトのほうである。**

## 5. 想定される質問

**Q. git submodule でいいのでは?**

submodule は「親リポジトリが子のリビジョンを持つ」という点で似ている。
採らない理由:

- submodule は checkout 時に**自動で作業コピーを動かす**。
  このプロジェクトの前提は「手元の作業を絶対に壊さない」であり、その制御が要る
- 16 リポジトリすべてが対等であり、mc-dev-meta は**親ではない**。
  submodule は親子関係を前提にする
- pnpm workspace として束ねるのに submodule である必要が無い。必要なのは `repos/*` にディレクトリがあること
- dirty な submodule に対する挙動が、ツールとバージョンによって違いすぎる

**Q. なぜ `pnpm-workspace.yaml` に `packages: ['repos/*']` だけなのか?**

mc-dev-meta 自身を workspace メンバーにしないため。
自分が取ってくるパッケージから自分をブートストラップすることになる。
`test/workspace.test.ts` の `does not list itself as a workspace package` が固定している。

**Q. マニフェストに書いていないディレクトリが `repos/` にあったら?**

**報告して、放置する。** リネームの残骸かもしれないし、意図的な実験かもしれない。
消すのは、このツールが決してやらない種類の行為である。

```
warning: repos/ contains 1 directory not in repos.json: mc-renamed-away.
They are left completely alone. If one is a rename, add it to repos.json; if it is stale, remove it yourself.
```
