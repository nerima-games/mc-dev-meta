# テスト戦略

## 1. 何をどこで検証するか

| レイヤ | 検証手段 | 現状 |
| --- | --- | --- |
| **同期判断**(最重要) | 全状態 × 全エントリの網羅 + 破壊的コマンドの不在 + 冪等性 | `test/sync-plan.test.ts` |
| マニフェスト | パース・検証・pin・シリアライズ + **コミット済み repos.json** | `test/manifest.test.ts` |
| ピン計画 | pin / unpinned・remote 観測からの決定 | `test/pin-plan.test.ts` |
| ロスター | 16 件・階層・グラフ | `test/roster.test.ts` |
| ワークスペース実行 | **空の repos/** ・部分・完全・未管理ディレクトリ | `test/workspace.test.ts` |
| 張り替え計画 | 診断のフィンガープリント・baseline との差分・known findings | `test/repoint-plan.test.ts` |
| **ミラー突合**(横断) | 一致・定数 drift・タグキー drift・brand の refinement drift・union の arm 欠落・**能力フラグ drift・プロパティ列 drift・ロスター drift**・未 clone の skip | `test/mirror-contract.test.ts`, `test/mirror-roster.test.ts` |
| 機能棚卸し | 状態・所有境界・証拠メタデータの純粋な検証と実在パスの確認 | `test/feature-inventory.test.ts`, `pnpm check:features` |
| Portable 契約 | root の Chunk/light 定数・座標正規化・block index・packed-light 操作と clone 済み runtime の実値 parity | `pnpm check:portable` |
| 型の形の読み取り | 手書き union と tsc の union の**両方の綴り**・コメント/文字列の除去・`api-lock.md` | `test/type-shape.test.ts` |
| `scripts/` の I/O | **検証しない**(§4) | — |

テスト数やファイル数は固定値として文書化せず、`pnpm test` で現在のテスト全体を実行する。

**依存境界(ホワイトリスト・循環検査・`Date.now()` 禁止)を検査していた
`test/check-dependency-whitelist.test.ts` と、それが検査していた
`scripts/check-dependency-whitelist.ts` は org 全体で廃止された**
(DEPENDENCY_POLICY.md、`pnpm check:deps` の撤去)。Tier 境界の検査は各リポジトリの
`.oxlintrc.json#no-restricted-imports` に移り、mc-dev-meta は層外でこのルールに
追加エントリを持たないため対応するテストも持たない。

## 2. プレーン vitest を使う

他の 15 リポジトリは `@effect/vitest` の `it.effect` を主 API とするが、
**mc-dev-meta はプレーン vitest を使う**。

理由は依存である。**このリポジトリは実行時依存を 1 つも持たない**
— `effect` すら入れない。15 リポジトリを取ってくるツールが
それらからブートストラップされてはならないからである
([responsibility.md](./responsibility.md) §4)。

同期的なアサーションを Effect で包んでも何も得られないので、素の `it` で書く。

## 3. **実際のネットワーク clone をするテストは書かない**

このリポジトリのテストは **git を 1 度も実行しない。**
ネットワークにも触らない。一時ディレクトリも作らない。
**`repos/` も読まない** — `test/mirror-contract.test.ts` は
「一致しているミラー」「ブロック ID が 1 つ違うミラー」「clone されていないリポジトリ」を
すべてフィクスチャとして組み立てる。15 個の clone を必要とするテストは、
**答えをすでに持っているマシンでしか走らない**テストである。

それができるのは、危険な判断がすべて純粋層にあるからである。

### 3.1 全状態の網羅

`test/sync-plan.test.ts` は観測可能な状態を明示的に列挙する:

```typescript
const EVERY_OBSERVED_STATE: ReadonlyArray<PresentState> = [
  present({ head: SHA_A, dirty: false, hasPinnedRef: true }),
  present({ head: SHA_A, dirty: false, hasPinnedRef: false }),
  present({ head: SHA_A, dirty: true,  hasPinnedRef: true }),
  ...
]

// `fetchedThisRun` はディスクから読めないので、観測できる状態を置き換えるのではなく
// 倍にする。同じ状態に「remote に訊く前」と「訊いた後」の両方で到達しうる。
const EVERY_STATE: ReadonlyArray<WorkingCopyState> = [
  absent,
  ...EVERY_OBSERVED_STATE.flatMap((state) => [state, { ...state, fetchedThisRun: true }]),
]
```

そして `EVERY_STATE × EVERY_ENTRY`(pinned / unpinned)で:

| テスト | 何を保証するか |
| --- | --- |
| `skips a dirty repository whatever else is true of it` | dirty なら他の条件に関わらずスキップ |
| `emits no command containing a destructive argument, from any state` | 到達しうる全 git コマンドが安全 |
| `emits no git reset, git clean or git restore at all` | 上の別角度からの確認 |
| `always checks out detached, so no local branch is moved or created` | `--detach` の強制 |
| `never emits a Checkout for an unpinned entry, from any state` | `unpinned` は HEAD を動かさない |
| `reaches a no-op from every state, for every entry` | どこからでも収束する |
| `contacts the remote at most once per entry, from every state` | 収束にかかる往復が 1 回以下 |

下 2 つはもともと 1 つで、しかも **`for a pinned entry` と限定されていた**。
その限定こそがバグだった — `unpinned` は収束しなかったので、
不変条件のほうを狭めることで通していた。いまは全エントリで成り立つ。
「収束する」だけでは足りないので、往復回数の上限を測るテストを対にしてある。

### 3.2 冪等性はモデルに対して検証する

`applyAction` が「スクリプトが作業コピーに何をするか」のモデルである。
テストは 計画 → 適用 → 再計画 を行い、2 回目が no-op になることを確かめる:

```typescript
const first = settle(pinned, absent)
expect(first.actions.map(a => a._tag)).toStrictEqual(['Clone', 'AlreadyAtRef'])

const second = settle(pinned, first.state)
expect(second.actions.map(a => a._tag)).toStrictEqual(['AlreadyAtRef'])
```

**スクリプトがこのモデルから外れたら、間違っているのはスクリプトのほうである。**

## 4. `scripts/` をテストしない理由

`scripts/` はカバレッジ対象からも外してある(`vitest.config.ts`)。

そこにあるのは:

- `readFile` / `stat` / `readdir`
- `execFile('git', ...)` / `execFile('pnpm', ...)`
- `console.log`

これらをテストする唯一の方法は、実際のリポジトリに対して実際の git を走らせることであり、
それは**やらない**と決めている(遅い・ネットワーク依存・
そして何より「作業を壊さない」ツールのテストで本物の作業コピーを使うのは筋が悪い)。

代わりに、**判断は 100% 純粋層にある**という設計でカバーする。
`scripts/` に残っている「判断」は、fail-closed の 1 箇所だけである:

```typescript
// git status が読めなかったら dirty とみなす
if (!status.ok || !head.ok) {
  return { _tag: 'Present', head: '', dirty: true, hasPinnedRef: false, fetchedThisRun }
}
```

作業を守るのが仕事の検査は、fail closed が唯一安全な既定値である。

`fetchedThisRun` は観測ではなく引数として渡ってくる(ディスクに記録が無いため)。
`scripts/sync-repos.ts` はこれを `actions.some(fetchesFromRemote)` から決めており、
その決め方が `applyAction` のモデルと一致することは
`agrees with fetchesFromRemote about which actions contact the remote` が押さえている。
スクリプトが自分で埋める唯一のフィールドなので、そこだけはモデルと突き合わせてある。

## 5. コミット済みファイルに対するテスト

純粋関数だけでなく、**リポジトリに実際にコミットされているファイル**も検証する。

| テスト | 何を守るか |
| --- | --- |
| `covers exactly the 15 repositories this workspace manages` | ロスターに足して repos.json に足し忘れる事故 |
| `lists repositories in roster (build) order` | 出力とマニフェストの順序一致 |
| `is written in the shape the serialiser produces` | `update:manifest` の差分が最小になる |
| `declares the same packages glob in pnpm-workspace.yaml and in domain/workspace.ts` | 2 箇所に書かれた glob の drift |
| `gitignores repos/` | 15 リポジトリを 16 個目にベンダリングする事故 |
| `does not list itself as a workspace package` | 自己ブートストラップの循環 |
| `is marked private, so it can never be published by accident` | 誤 publish |
| `declares no runtime dependencies at all` | 依存ゼロという設計の維持 |

**これらが落ちたときは、実装ではなく設計判断が変わったということである。**

かつてここには `the roster and the dependency gate agree` という行があり、
`domain/repository-roster.ts`(参照コピー)と `scripts/check-dependency-whitelist.ts`
(このリポジトリ自身のゲートコピー)が辺単位で一致することを検証していた。
その後者が org 全体で廃止されたため、比較対象自体が無くなり、このテストは削除した
(§1 参照)。

## 6. 空の `repos/` で `pnpm verify` が通ること

これはテスト戦略の一部であると同時に**責務**でもある
([responsibility.md](./responsibility.md) §5)。

CI は `repos/` が空の状態で回る。そこで:

```console
$ pnpm verify          # typecheck && lint && test(TEST_STANDARD.md §1)
$ pnpm check:workspace # exit 0、「空です」と言う
$ pnpm check:features  # root のカタログを検査。未 clone の証拠は理由つきで skip
$ pnpm check:portable  # Chunk/light 契約を runtime export と比較。未 clone は理由を表示し、比較ゼロなら失敗
$ pnpm check:mirrors   # 比較できたミラーを検査。未 clone は理由つきで skip
```

もし `pnpm verify` が 15 リポジトリの存在を要求したら、
**15 リポジトリを取ってくるツールが、最後に信用できるようになるもの**になってしまう。

`pnpm check:mirrors` はこのローカル基本ゲートの外側で、結果が**リポジトリ外のファイルに依存する**。
同じコミットが、あるマシンでは通り別のマシンでは落ちうる — それは事実であり、そこが要点である。
合成状態は `repos.json` で pin されており、pin された 2 リビジョンの食い違いは
**mc-dev-meta のこのコミットの性質**であって、他のどのリポジトリのコミットの性質でもない。
両方を同時に見られるのがここだけだからである。

### 空でない場合に何が skip され、何が落ちるか

| 状況 | 結果 |
| --- | --- |
| ミラー元 / ミラー側リポジトリが clone されていない | skip(理由を印字) |
| ミラーファイルが消えている(= publish 後に削除された) | skip + 「`MIRROR_SPECS` の行も消せ」 |
| clone 済みだが `pnpm install` されていない | skip(理由を印字) |
| import はできたが値も型も 0 件だった | **落ちる**(比較対象ゼロは「一致」ではない) |
| `MIRROR_SPECS` が実在しない export を probe している | **落ちる**(古い spec が黙って no-op になるのを防ぐ) |
| プロパティ probe が id を 1 件も読まなかった | **落ちる**(0 件の比較は「一致」ではない) |
| `KNOWN_FINDINGS` にある既知欠陥 | 落ちない。ただし毎回全文を印字する |
| 新しい差分 / 既知欠陥が直ったのにエントリが残っている | **落ちる** |

### 6.0.1 ブロックテーブルの突合 — 能力フラグとプロパティ列

mc-kernel はブロックの振る舞いモデルを設計時点で**2 つに割っている**。

| | 置き場所 | アクセサ | 値 |
| --- | --- | --- | --- |
| 能力(boolean) | `domain/block-capabilities.ts` | `capabilityOfBlockId(id, flag)` | `true` / `false` |
| プロパティ(型付き) | `domain/block-properties.ts` | `propertyOfBlockId(id, name)` | `opacity` は 3 値 enum、`lightEmission` は 0..15、`supportRule` は構造体 |

`MIRROR_SPECS` は長らく**前者しか probe していなかった**。
後者を転記しているミラーは probe を 1 件も持たず、それでも `ok` と報告されていた。

これは仮定の話ではない。以前の `mc-worldgen/domain/kernel-vocabulary.ts` は
kernel が 24 行持っている非不透明ブロックを **6 行**しか転記しておらず、
ladder・cobweb・11 種の植物・rail・cactus・slab がすべて `'opaque'` の既定値に落ちていた。
**転記漏れはエラーにならず、既定値として読まれる** — `opacity` の既定値は `'opaque'`、
すなわち実際より**暗い**方向であり、mc-worldgen の DN-7 が
「保守的でないほう」と名指している方向である。暗く読まれたセルは、
`hostile-spawn.ts` が拒否したはずの湧きを通す。
地形生成は id 0-10 しか書かないので、**設置されたブロック経由でしか到達せず**、
どのゴールデンフィクスチャも動かなかった。

kernel 自身の audit §4.9.1(d) がこの規則を既に書いている —
「ミラーが転記している能力の数より probe が少なければ、そのチェックは検査していない成功を報告する」。
**プロパティ probe が 0 件の配列は、その文の極限形である。**

現在、mirror probe と portable 契約が監視している列:

| 契約 | export | 列 |
| --- | --- | --- |
| `mc-worldgen` の mc-kernel 直接依存（`pnpm check:portable`） | `opacityOfBlockId` | `opacity` |
| `mc-worldgen` の mc-kernel 直接依存（`pnpm check:portable`） | `lightEmissionOfBlockId` | `lightEmission` |
| `mx-gameplay/domain/block-vocabulary.ts` の mirror probe | `supportRuleOfBlockId` | `supportRule` |

**probe は owner の id 全域を閉じて比較する**(現状 0..255)。
ミラー側のテーブルが尽きたところで止めると、行が欠けたミラーと「一致」してしまう。
6/24 の状態が 1 週間気付かれなかったのは、まさにその形の
スポットチェックしか存在しなかったからである。報告行は読んだ id 数も印字する —
「probe 1 件」と「1 件の id しか読まなかった probe 1 件」は数だけでは区別できない。

構造体の列は **JSON に描画してから**比較する。`String({kind:'none'})` は
どの規則でも `[object Object]` になり、全 id で規則を取り違えたミラーが
全 id で一致と報告される。

**能力 probe と違い、プロパティ probe は「元リポジトリの barrel に載っているか」の
検査を免除しない。** 能力 probe はそれを免除する必要がある(probe 先の述語は
第三のリポジトリのものだから)が、その免除こそが、過去の ChunkStore
ミラーの壊れた張り替え約束を 4 件隠していたものである。
kernel は `opacityOfBlockId` 等を自分の barrel に載せているので、
プロパティ probe は免除を必要とせず、**免除しない**。

## 6.1 `pnpm check:repoint` — `verify` に**入れていない**ゲート

`check:mirrors` はミラーと元の**形**を比べる。
各ミラーのヘッダが約束しているのはそれより強い文である —
**「このファイルを消して import をパッケージに張り替えろ」**。
形の一致はそれの必要条件であって十分条件ではない。
`pnpm check:repoint` は実際に張り替えて `tsc` を走らせる。

```console
$ pnpm check:repoint   # 未 clone のリポジトリは理由つきで skip
```

| 状況 | 結果 |
| --- | --- |
| ミラー側 / 元リポジトリが clone されていない | skip(理由を印字) |
| clone 済みだが `pnpm install` されていない(`tsc` が無い) | skip(理由を印字) |
| ミラーファイルが消えている(= publish 後に削除された) | skip + 「`REPOINT_SPECS` の行も消せ」 |
| `REPOINT_SPECS` が `MIRROR_SPECS` に無いミラーを名指している | **落ちる**(2 つの登録簿の乖離) |
| そのミラーを import しているファイルが 1 つも無い | **落ちる**(0 件の張り替えは何も証明していない) |
| `typecheck` スクリプトから project を 1 つも読めない | **落ちる**(0 件のコンパイルは「通った」ではない) |
| 張り替え**前**から出ていたエラー | 落ちない(baseline を引く。§下記) |
| `KNOWN_REPOINT_FINDINGS` にある既知欠陥 | 落ちない。ただし毎回全文を印字する |
| 新しいエラー / 既知欠陥が直ったのにエントリが残っている | **落ちる** |

**project ごとに 2 回コンパイルする。** 素の使い捨てコピーと、張り替えたコピー。
baseline に無い診断だけが張り替えのせいにされる。
そうしないと、下流に前からあった無関係なバグを最初の読み手が半日かけて追うことになる。

### なぜ `verify` に入れないのか

`check:mirrors` は CI の独立ステップとして実行する(§6)。その理由の半分はここにも当てはまるが、
半分は当てはまらない。**このゲートはタダではない。**
3 リポジトリをコピーして、それぞれの `typecheck` が名指す project ごとに
baseline と張り替え後の 2 回、合計 9 回 `tsc` を回す(実測 13 秒)。
`verify` はコミットのたびに回すものであり、
**遅くて飛ばされるゲートは `--no-verify` で飛ばされるゲート**である。
それは「正直に `verify` の外にある」より悪い。

CI・定期実行・publish 前には回す。
`verify` が本当に守っている「drift が気付かれずに入る」ほうは、
これらのファイルについては CI と明示実行時に走る `check:mirrors` が既に押さえている。
このゲートが答えるのは、**誰かがバージョンを凍結しようとする日にだけ必要になる**、より大きな問いである。

### 最初に走らせて分かったこと

`mx-gameplay` / `mx-ui` / `mx-redstone` の `domain/frame-contract.ts` は
`FrameServices = never` と宣言している。kernel は `FrameServices = ClockPort` である。
`check:mirrors` は 3 つとも「一致」と報告する — **形としては実際に一致している**。

張り替えると 3 つとも落ちた。合計 17 件、内訳は下記。

| | shipped source (`tsconfig.build.json`) | test / preview |
| --- | --- | --- |
| mx-gameplay | **0 件(通る)** | 11 件 |
| mx-ui | **0 件(通る)** | 3 件 |
| mx-redstone | **0 件(通る)** | 3 件 |

各ミラーのヘッダは「この差異は前方互換である」と主張していて、**それは正しい**。
ただし正しいのは stage の**著者**についてであり、実際 shipped source は 3 つとも 0 件で通る。
`StageRegistration` を受け取って `run(dt)` を**実行する**側については何も言っていない。
そちら側では代入可能性が逆に働き、caller が用意していない `ClockPort` を要求されるようになる。

これは mc-kernel の `docs/freeze-checklist.md` が散文で予告していたことである
(「この別名を広げるのは stage の *提供者* にとって破壊的変更である」)。
**予告されていたが、誰もコンパイラを走らせていなかったので、規模が分かっていなかった。**

## 7. カバレッジ

計測は常に動いている(`pnpm test:coverage`)。対象は `src/index.ts` と `src/domain/**`
のみで、`scripts/**` と `repos/**` は除外している(§4)。スクリプトは
`check:workspace` / `check:features` / `check:portable` / `check:mirrors` / `check:repoint` の実行ゲートで検査する。

**4 指標 100% の閾値ゲートは有効。** この repository の純粋なドメイン層は、
statements / branches / functions / lines のすべてを検査する。`src/index.ts` は再エクスポートのみの
バレルで実行文がなく、Vitest 4 の集計ではカウンタを持たない。実行可能な `src/domain/*` は
4 指標すべてを満たし、スクリプトは実行ゲートで検査する。

## 8. まだ書いていないテスト

| テスト | 前提 |
| --- | --- |
| `src/index.ts` バレル経由の re-export を実際に import して検証する | 公開エントリポイントの契約 |
| プロパティテスト(任意の状態列で `settle` が収束する) | fast-check を devDependency に足すかどうか。依存ゼロ方針との兼ね合い |
| `update:manifest` の統合テスト | 実 git が要る。**書かない**方針(§4) |
