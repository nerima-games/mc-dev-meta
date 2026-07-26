# 開発ワークフロー

## 0. このリポジトリは何をするのか

plan.md §6 Step 0 item 2:

> **dev-meta workspace** を作成: 15 リポジトリの clone を `repos/` 配下に並べて
> 1 つの pnpm workspace として束ねる薄いリポジトリ(clone スクリプト + `pnpm-workspace.yaml`、
> `repos/` は gitignore)。開発中は `workspace:*` 解決でモノレポ同等の DX。
> **npm 公開・バージョン bump 運用は界面安定(4 週間 API ロック無変更)まで開始しない**

一行で言えば: **16 リポジトリを、モノレポと同じ感触で触れるようにする。**

## 1. なぜこれが要るのか

参照実装 `takeokunn/ts-minecraft` は **1 リポジトリ 11 パッケージ**の pnpm workspace だった。

```console
$ cat pnpm-workspace.yaml
packages:
  - 'packages/*'
$ ls packages/
app  block  core  entity  game  inventory  network  presentation  rendering  worker  world
$ find . -path ./node_modules -prune -o -name '*.ts' -not -name '*.test.ts' -print | xargs wc -l | tail -1
  87712 total
```

本体 87,712 LOC(plan.md §1 の「84k LOC」に対応)、テスト 131,037 LOC。

その構成には**良い点が 1 つあった**: `packages/core` を直せば
`packages/world` が即座にそれを見る。publish もバージョン bump も要らない。
これが本計画で失いたくない唯一の性質である。

失いたい性質のほうは plan.md §1 が書いている:

> 単一リポジトリ(84k LOC)では「正しく動くことが保証される単位」が大きすぎ、正しさを検証しきれない

**mc-dev-meta は、良い点だけを取り戻すための道具である。**
`repos/*` を 1 つの pnpm workspace にすることで、参照実装の `packages/*` と同じ即時解決が効き、
それでいて 16 リポジトリはそれぞれ独立して CI が回り、独立してリリースできる。

## 2. セットアップ

```console
$ git clone https://github.com/nerima-games/mc-dev-meta.git
$ cd mc-dev-meta
$ direnv allow          # devenv 経由で nodejs_22 + pnpm が入る
$ pnpm install          # このリポジトリ自身の devDependencies
$ pnpm sync             # 15 リポジトリを repos/ へ clone
$ pnpm install          # ここで repos/* が workspace として解決される
```

`pnpm sync` の後に `pnpm install` をもう一度打つのが要点である。
1 回目は `repos/` が空なので workspace メンバーがおらず、
2 回目で `@nerima-games/*` の相互依存が `workspace:*` として解決される。

## 3. 日々の流れ

### 3.1 複数リポジトリにまたがる変更

```console
$ cd repos/mc-kernel
$ # 型を 1 つ足す
$ cd ../mc-sim
$ pnpm typecheck        # kernel の変更が即座に見える。publish 不要
```

**これがこのリポジトリの存在理由そのものである。**
`workspace:*` 解決がなければ、この 1 行の型追加のために
「kernel を publish → sim の package.json を bump → install」が必要になる。
界面が高 churn な時期にそれをやると、1 日に何十回も bump 連鎖が起きる(plan.md §8)。

### 3.2 全リポジトリのチェック

```console
$ pnpm check:workspace              # 各リポジトリで `pnpm verify`
$ pnpm check:workspace typecheck    # 別のスクリプトを指定
```

clone されているリポジトリだけを、**マニフェスト順**に、逐次実行する。
`repos/` が空でも部分的でも失敗しない — ボトムアップ構築(plan.md §6 Step 2)では
ロスターの大半がまだ存在しないのが正常な状態だからである。

### 3.3 合成状態を記録する

```console
$ # 各リポジトリでコミットした後
$ pnpm update:manifest
$ git add repos.json && git commit -m "Pin repos to <何をしたか>"
```

**この手順を飛ばすと、その日の合成状態はどこにも残らない。**
`repos/` は gitignore されているので、
「火曜には E2E が通っていた」が指す成果物が存在しないことになる。
詳細は [manifest.md](./manifest.md)。

### 3.4 誰かの pin に合わせる

```console
$ git pull                # repos.json が更新される
$ pnpm sync               # 各リポジトリを pin されたリビジョンへ
$ pnpm install
```

`pnpm sync` は**手元の作業を壊さない**。
未コミットの変更があるリポジトリは触らずにスキップし、その旨を出力する。
[manifest.md](./manifest.md) §3 参照。

## 4. `pnpm sync` の挙動(要約)

| 状況 | 動作 |
| --- | --- |
| `repos/<name>` が無い | **clone**。pin があれば detached checkout |
| ある / **未コミットの変更あり** | **スキップ。何も触らない。** エラーではない |
| ある / clean / pin と HEAD が一致 | 何もしない |
| ある / clean / pin がローカルに無い | **fetch** して再判定 |
| ある / clean / pin がローカルにある | **detached checkout** |
| ある / clean / `repos.json` が `unpinned` | **fetch のみ。HEAD は動かさない** |

**`git reset --hard` も `git clean` も `git restore` も実行しない。**
そもそもそういうアクションが存在せず、さらに実行直前に引数を検査して拒否する。
[責務](./responsibility.md) §2 と `test/sync-plan.test.ts` を参照。

`--dry-run`(`pnpm sync:dry`)で計画だけを表示できる。

## 5. `workspace:*` から公開バージョンへの移行

### 5.1 いまは `workspace:*`

plan.md §6 Step 0 item 2 と §8:

> **npm 公開・バージョン bump 運用は界面安定(4 週間 API ロック無変更)まで開始しない**
>
> 新規構築初期は全界面が高 churn → npm 公開を遅らせ dev-meta workspace で開発。
> **bump 連鎖を構造的に回避**

16 リポジトリが相互に依存する状態で早期に publish を始めると、
mc-kernel の 1 行変更が 15 リポジトリの bump 連鎖を引き起こす。
それは「面倒」ではなく、**界面がまだ動いている時期には作業が進まなくなる**という問題である。

### 5.2 移行の条件(plan.md §6 Step 3)

> 界面が安定した(**API ロック 4 週間無変更**)リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発

**「4 週間 API ロック無変更」が唯一の開始条件である。** 具体的には:

1. そのリポジトリの公開 API レポート(API ロックファイル)が
2. **4 週間、1 度も変更されていない**

途中で 1 行でも変わったら、4 週間は**そこから数え直し**である。

### 5.3 移行は階層ごとに、下から

移行は一斉には起きない。plan.md §6 Step 2 の構築順に、**層ごとに**起きる。

```
kernel                                          ← 最初に安定する。最初に publish
noise / meshing / physics / save / audio        ← 次
worldgen → sim → render → kit
gameplay / redstone → ui → multiplayer
compose                                         ← 最後
```

ある層が publish されると、その下流は `workspace:*` ではなく
**pin された公開バージョン**を使うようになる。

```
mc-sim/package.json:
  "@nerima-games/mc-kernel": "1.0.0"     ← publish 済み。pin
  "@nerima-games/mc-save":   "workspace:*"  ← まだ開発中
```

**過渡期には両方が混在する。それが正常である。**
`repos/` に clone されているリポジトリは workspace メンバーとして解決されるので、
`workspace:*` の依存はそのまま動き、pin された依存はレジストリから来る。

### 5.4 全部 publish された後もこのリポジトリは残るのか

**残る。** 16 リポジトリにまたがる変更を 1 か所から回す道具は、
publish が始まっても要る。ただし役割は変わる:

| 時期 | mc-dev-meta の役割 |
| --- | --- |
| いま(全部未公開) | `workspace:*` 解決。これが無いと開発が成立しない |
| 過渡期 | 混在の解決 + 合成状態の記録 |
| 全部公開後 | 合成状態の記録 + 横断チェック。`workspace:*` は開発中の層にだけ残る |

**マニフェストの価値は publish 後のほうが上がる** — publish されたバージョンの組み合わせが
どのソースリビジョンから来たかを記録する唯一の場所になるからである。

## 6. やってはいけないこと

| やってはいけない | 理由 |
| --- | --- |
| `repos/` をコミットする | 15 リポジトリを 16 個目にベンダリングすることになり、分割の意味が消える |
| mc-dev-meta を workspace メンバーにする(`packages: ['.']`) | 自分が取ってくるパッケージから自分をブートストラップすることになる |
| mc-dev-meta に依存を足す | 同上。**依存はゼロ**であり、`effect` すら入れない |
| `repos/` の中で `git reset --hard` を打つ | このツールがやらないことを手でやることになる。やるなら意識してやること |
| `pnpm update:manifest` せずに「動いた」と言う | 合成状態が記録されていないので、その主張は再現できない |
| pin を打たずに長期間放置する | `pnpm check:workspace` が毎回警告する。警告が出続けている状態を常態にしない |
