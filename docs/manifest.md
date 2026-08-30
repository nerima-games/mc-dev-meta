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

`repos/` を動かすのは `pnpm sync`、`repos.json` を書くのは `pnpm update:manifest` である。
この 2 つだけでは **pin は決して進まない**(理由は §5)。
remote の先端を取りに行くのが `--latest` であり、どちらの側に付けてもよい。

```console
$ # 手元優先 — 作業コピーを先に進め、それを記録する
$ pnpm sync --latest          # 各リポジトリを origin の先端へ fast-forward
$ pnpm update:manifest        # その HEAD を pin
$ git add repos.json && git commit

$ # pin 優先 — 先に pin を進め、あとから作業コピーを合わせる
$ pnpm update:manifest --latest   # origin の先端を pin(repos/ は動かさない)
$ pnpm sync                       # repos/ をその pin へ
```

| コマンド | 何を読み | 何を書くか |
| --- | --- | --- |
| `pnpm sync` | `repos.json` | `repos/` |
| `pnpm sync --latest` | **origin** | `repos/` |
| `pnpm update:manifest` | `repos/` の HEAD | `repos.json` |
| `pnpm update:manifest --latest` | **origin** | `repos.json` |
| `*:dry` / `--dry-run` | 同上 | **何も書かない** |

`pnpm sync:latest:dry` が出せるのは「fetch する」までである。
先端がどこかは fetch するまで分からないので、
**触らずに** 全計画を出すことは原理的にできない。これは `--dry-run` の契約が正しく、
表示が不完全なほうを選んだ結果である。

### 3.1 このツールが**書かないもの**

| 状況 | 動作 | 理由 |
| --- | --- | --- |
| clone されていない | ref をそのまま残す | 存在しないものについて意見を持たない |
| **未コミットの変更がある** | **pin しない** | dirty な木の HEAD は手元の状態を記述していない。pin すると**誰も再現できない状態を pin 済みの見た目で**記録することになる |
| 既に同じ SHA | 何もしない | |
| `--latest` で **HEAD が先端から辿れない** | **pin しない** | pin を書くこと自体は何も壊さない。壊すのは**次の** `pnpm sync` である。作業コピーは detached なので、そのコミットはどこからも参照されなくなる。**後で暴発する仕掛けを置くほうが、いま壊すより悪い** |
| `--latest` で **remote が読めなかった** | **pin しない** | 手元の HEAD にフォールバックすると、`--latest` が黙って素の挙動になる。訊かれたのと別の問いに答えて成功を報告するフラグは、無いほうがましである |

### 3.2 「already up to date」が何を言っていなかったか

素の `pnpm update:manifest` が何も書かなかったとき、
それが意味するのは **「`repos/` と pin が一致している」** だけである。
`pnpm sync` は `repos/` を pin **に** 置くのだから、一致は**正常な状態**であって、
GitHub 側がどうなっているかについては一言も述べていない。

この 2 つを取り違えたのが §5 の事故なので、メッセージがそう言うようになっている:

> update:manifest: repos.json already matches every working copy under repos/.
> That is not the same as "the pins are current" — no remote was contacted.

### 3.3 差分は 1 行になる

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

この 3 重の強制は `--latest` でもそのままである。
`--latest` は**別コマンドではなくモード**であり、同じ planner・同じアクション集合・
同じ網羅テストを通る。`test/sync-plan.test.ts` の破壊的引数スイープは
**全状態 × 全エントリ × 両モード**を回る
(モード軸を足す前は、`--latest` の checkout に `--force` を入れても**素通りした**)。

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

## 5. pin が動かなかった話 — 閉じたループ

### 5.1 何が起きたか

`pnpm sync` は `repos/ <- pin` を書き、`pnpm update:manifest` は `pin <- repos/ HEAD` を書く。
**ループが閉じている。** どちらも、相手が直前に書いたリビジョン以外を名指すことができない。
pin が進むのは `repos/` の中で誰かがコミットしたときだけであり、
`repos/` は gitignore されていて、作業コピーとして扱うなとこの設計自身が言っている。

6 リポジトリに push した直後の実測:

```
mx-gameplay remote HEAD:  50395a480f2a907b1b3e1dbef8a47a3d3721f31f
repos.json pin:           523617676c7d393143f0b3f78bce28955b7671ba
repos/mx-gameplay HEAD:   523617676c7d393143f0b3f78bce28955b7671ba

$ pnpm sync             -> "cloned 0, fetched 0, checked out 0, unchanged 15"
$ pnpm update:manifest  -> "repos.json is already up to date."
```

`fetched 0` に注目。**sync は remote に接続すらしていない。**
`planSync` は `state.head === entry.ref` を見た時点で `AlreadyAtRef` を返し、
remote に触れうる分岐に到達しないからである。

### 5.2 なぜこれが最悪の失敗様式なのか

2 つのコマンドが、**どちらも成功を報告し、どちらも何もしていない**。
pin 留めツールにとってこれ以上悪い壊れ方はない — 失敗するツールは直されるが、
黙って何もしないツールは信頼されたまま放置される。

実害も出た。`pnpm check:mirrors` は `repos/` を読む。
つまりこの組織の 3 つある横断ゲートの 1 つが、
**進みようのないスナップショット**と比較し続けていた。
実際に、過去の作業コピーが削除済みの ChunkStore ミラーから
export しているものを「mirror に無い」と報告した。これは drift に見え、診断を 1 つ消費した。
逆向きはもっと悪い — pin 以降に本当に drift した mirror を **OK と報告する**。

### 5.3 `--latest`

`sync` と `update:manifest` の両方に付く。remote に訊いて、その先端を採る。
これが、どちらの半分にも「相手が書いたのではないリビジョン」を与える唯一の経路である。

`--update` ではないのは、それが `repos.json` を更新すると読めるからで、
`pnpm sync` はそれをしてはならない。`--remote` ではないのは、
それが**場所**であって**結果**ではないからで、素のモードも既に remote には接続する
(新しいのは接続ではなく、**どのリビジョンが勝つか**である)。

### 5.4 先端へ進めるときに失われないための 2 つの規則

1. **dirty はスキップ。** 素のモードと完全に同じ。
2. **fast-forward のみ。** HEAD が先端から辿れないなら `SkipDiverged` として
   スキップし、名前を出す。`pnpm sync` は作業コピーを **detached** のままにするので、
   そこで作られたコミットは **HEAD からしか辿れない**。
   先端を checkout すれば reflog にしか残らず、それは失われたのと同じである。

規則 2 は意図的に**保守的**である。先端の系譜から外れた pin
(側枝に打たれた pin など、実際には何も失われない場合)も拒否する。
外から見ればどちらも「HEAD が先端から辿れない」でしかなく、
取りうる 2 つの誤りのうち、**動かさない誤りのほうが取り消せる**。

`pnpm update:manifest --latest` も同じ述語を使う。
pin を書くこと自体は何も壊さないが、**次の** `pnpm sync` がそれに従って checkout する。
ローカルコミットを飛び越えた pin は、後で暴発する仕掛けである。

### 5.5 横断ゲートが 2 つ、読む checkout が別々なのはなぜか

| ゲート | 読むもの | 問い |
| --- | --- | --- |
| `pnpm check:mirrors` (mc-dev-meta) | `repos/` | **pin された 2 つのリビジョンは一致しているか** |
| `pnpm check:repoint` (mc-dev-meta) | `repos/` + 使い捨てコピー | **ミラーを消して import を張り替えたら、本当にコンパイルが通るか** |
| `pnpm check:roster` (mc-compose) | 隣接する作業コピー | **手書きの転記は、いま見ているコードと一致しているか** |

**この分割は事故ではない。**

`check:repoint` は `check:mirrors` と同じ `repos/` を読み、同じ provenance ブロックを印字する
(`scripts/repos-provenance.ts` を共有している。転記された provenance レポートが 2 つある状態は、
このリポジトリが高くつくようにするために存在する当のものである)。
違うのは問いのほうで、`check:mirrors` が**形**を比べるのに対し `check:repoint` は**コンパイラを走らせる**。
形の一致は張り替えが通るための必要条件であって十分条件ではない —
モジュール解決・`exports` マップ・`types` フィールド・バレルの再 export 形状、
そして「宣言箇所では無害な差異が消費箇所では致命的になる」ことのどれもが、差分がきれいなまま張り替えを壊しうる。
実際、最初に走らせた時点で 3 リポジトリすべてが落ちた([testing.md](./testing.md) §6.1)。

**張り替えは `repos/` の外の使い捨てコピーに対して行う。**
`repos/` は gitignore されているので、そこへの書き込みは `git status` に出ない。
そして `repos/` は `check:mirrors` が読む当のファイルである —
あるゲートが別のゲートの入力を黙って書き換えるのは、最も高くつく種類の誤答になる。

`check:mirrors` が答えるのは合成状態についての問いであり、
それは **mc-dev-meta のこのコミットの性質**である
(他のどのリポジトリのコミットの性質でもない。両方を見られるのがここだけだから)。
作業コピーを読んだら、答えは「たまたま checkout されていたもの」の性質になり、
それこそ `repos.json` が答えでなくすために存在するものである。

`check:roster` が答えるのは、mc-compose 内にコミットされた**手書きの転記**が
`file:line` まで含めて元と一致しているかである。
その転記は作業コピーを見ながら編集されるので、
照合先も作業コピーでなければならない。実際、この 2 つは乖離する —
初めて両方に対して走らせたとき `mc-dev-meta/repos` は
`mc-render/stages/registration.ts` について 17 行遅れていた。

**弁護できなかったのは、それがどこにも書かれていなかったことである。**
失敗メッセージがどちらの checkout を読んだのか言わなかったので、
進めない pin に対する所見が、mirror の本物の drift として読めてしまった。
いまは通っても落ちても毎回、読んだ checkout とそのリビジョンを出す:

```
Source: repos/ — the checkout this repository pins in repos.json, NOT the sibling working
copies next to it. mc-compose's `pnpm check:roster` reads those instead, deliberately; ...
9 of 9 repositories are at the revision repos.json pins.
```

pin から外れているものがあれば、**disk 側と pin 側の両方の SHA を並べて**名指す。
pin から外れていること自体は失敗ではない
(`pnpm sync --latest` の目的の半分はその状態を意図的に作ることである)。
報告されるのは、**マニフェストが名指していないリビジョンに対する所見**を読む人が、
mirror の中に drift を探しに行く前にそれを知る必要があるからである。

## 6. 想定される質問

**Q. git submodule でいいのでは?**

submodule は「親リポジトリが子のリビジョンを持つ」という点で似ている。
採らない理由:

- submodule は checkout 時に**自動で作業コピーを動かす**。
  このプロジェクトの前提は「手元の作業を絶対に壊さない」であり、その制御が要る
- 15 runtime リポジトリは対等であり、mc-dev-meta は**親ではない**。root は workspace
  tooling と portable data contract を管理するが、runtime package の親にはならない。
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
