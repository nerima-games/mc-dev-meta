# テスト戦略

## 1. 何をどこで検証するか

| レイヤ | 検証手段 | 現状 |
| --- | --- | --- |
| **同期判断**(最重要) | 全状態 × 全エントリの網羅 + 破壊的コマンドの不在 + 冪等性 | `test/sync-plan.test.ts`(27 tests) |
| マニフェスト | パース・検証・pin・シリアライズ + **コミット済み repos.json** | `test/manifest.test.ts`(29 tests) |
| ロスター | 16 件・階層・グラフ・**ゲートのコピーとの一致** | `test/roster.test.ts`(17 tests) |
| ワークスペース実行 | **空の repos/** ・部分・完全・未管理ディレクトリ | `test/workspace.test.ts`(20 tests) |
| 依存境界 | ホワイトリスト・循環検査・`Date.now()` 禁止 | `test/check-dependency-whitelist.test.ts`(40 tests) |
| `scripts/` の I/O | **検証しない**(§4) | — |

現在 **133 tests / 5 files**、`pnpm test` で 330ms 前後。

## 2. プレーン vitest を使う

他の 15 リポジトリは `@effect/vitest` の `it.effect` を主 API とするが、
**mc-dev-meta はプレーン vitest を使う**。

理由は依存である。**このリポジトリは実行時依存を 1 つも持たない**
— `effect` すら入れない。15 リポジトリを取ってくるツールが
それらからブートストラップされてはならないからである
([responsibility.md](./responsibility.md) §4)。

同期的なアサーションを Effect で包んでも何も得られないので、素の `it` で書く。

`test/check-dependency-whitelist.test.ts` は 16 リポジトリ共通テンプレートの写しであり、
`it.effect` → `it` の機械的な変換だけを施してある。
それ以外は姉妹コピーと同一で、diff が取れる状態を保っている。

## 3. **実際のネットワーク clone をするテストは書かない**

このリポジトリのテストは **git を 1 度も実行しない。**
ネットワークにも触らない。一時ディレクトリも作らない。

それができるのは、危険な判断がすべて純粋層にあるからである。

### 3.1 全状態の網羅

`test/sync-plan.test.ts` は観測可能な状態を明示的に列挙する:

```typescript
const EVERY_STATE: ReadonlyArray<WorkingCopyState> = [
  absent,
  present({ head: SHA_A, dirty: false, hasPinnedRef: true }),
  present({ head: SHA_A, dirty: false, hasPinnedRef: false }),
  present({ head: SHA_A, dirty: true,  hasPinnedRef: true }),
  ...
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
| `reaches a no-op from every state, for a pinned entry` | どこからでも収束する |

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
  return { _tag: 'Present', head: '', dirty: true, hasPinnedRef: false }
}
```

作業を守るのが仕事の検査は、fail closed が唯一安全な既定値である。

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
| `the roster and the dependency gate agree` | ロスター参照コピーとゲートのコピーの drift |

**これらが落ちたときは、実装ではなく設計判断が変わったということである。**

## 6. 空の `repos/` で `pnpm verify` が通ること

これはテスト戦略の一部であると同時に**責務**でもある
([responsibility.md](./responsibility.md) §5)。

CI は `repos/` が空の状態で回る。そこで:

```console
$ pnpm verify          # typecheck && lint && check:deps && test
$ pnpm check:workspace # exit 0、「空です」と言う
```

もし `pnpm verify` が 15 リポジトリの存在を要求したら、
**15 リポジトリを取ってくるツールが、最後に信用できるようになるもの**になってしまう。

## 7. カバレッジ

計測は常に動いている(`pnpm test:coverage`)が、**閾値は未設定**。
対象は `index.ts` と `domain/**` のみで、`scripts/**` と `repos/**` は除外している(§4)。

99% ゲートは完成条件到達時に有効化する。

## 8. まだ書いていないテスト

| テスト | 前提 |
| --- | --- |
| ロスターと**他 15 リポジトリ**のゲートコピーの一致 | 15 リポジトリが clone されている状態が要る。`pnpm check:workspace` の一部にする候補 |
| プロパティテスト(任意の状態列で `settle` が収束する) | fast-check を devDependency に足すかどうか。依存ゼロ方針との兼ね合い |
| `update:manifest` の統合テスト | 実 git が要る。**書かない**方針(§4) |
