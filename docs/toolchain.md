# toolchain pin 表と `check:toolchain` / `check:pins`

## 1. 一段落で

Wave 0 以前は 15 リポジトリがそれぞれ独立に toolchain を pin していて、drift した
— vitest のマイナーバージョンが一方だけ古い、`typescript6` エイリアスが片方だけ残る、
といった具合に。`src/domain/toolchain.ts` の `TOOLCHAIN` は plan.md §2.2 の表を
そのまま data 化した唯一の正本であり、`pnpm check:toolchain` が `repos/` 配下の
実体をそれと突き合わせる。`pnpm check:pins` は別の軸の規律 —
「下流は兄弟の現行 version を pin する」— を検査する。どちらも
**data / 判定（`src/domain/`）と I/O（`scripts/`）を分けた純粋関数**であり、
`test/toolchain-audit.test.ts` / `test/pin-audit.test.ts` が fixture で検査する。

## 2. `TOOLCHAIN` 表の読み方

`src/domain/toolchain.ts` の `TOOLCHAIN` は `as const` オブジェクトで、data のみを持つ
(関数は無い)。フィールド:

| フィールド | 意味 |
| --- | --- |
| `node.engines` / `node.nixPackage` | `engines.node` に書く値と、対応する Nix パッケージ名 |
| `pnpm` | 裸のバージョン。`engines.pnpm` は `>=<pnpm>`、`packageManager` は `pnpm@<pnpm>` として導出する |
| `devDependencies` | **全 15 リポジトリで必須**、この exact version(`^` `~` 無し)。無ければそれ自体が finding |
| `dependencies` | `dependencies` に必須なもの(現状 `effect` のみ、kernel を含む全リポジトリ) |
| `optional` | **そのリポジトリが既に宣言している場合のみ**この exact version を要求する。無いこと自体は finding にならない |
| `forbidden` | `dependencies` / `devDependencies` のどこにあっても finding になるパッケージ名 |
| `nixPackages` | 各リポジトリの `flake.nix` devShell が持つべきパッケージ名の一覧 |
| `coverageThreshold` | `vitest.config.ts` の 4 指標(branches/functions/lines/statements)がすべて満たすべき値 |

`tsx` は `optional` に置いてある。plan.md §4 item 1 が示す `TOOLCHAIN` リテラルは
`devDependencies` に `tsx` を置く形をしていたが、それはスケッチであり、
plan.md §2.2 の行注記(「scripts/ か apps/ を tsx で走らせる repo のみ」)が
実際の意図である。scripts/ や apps/ を tsx で走らせないリポジトリで
`tsx` が無いことは finding にならず、宣言しているリポジトリだけがこの
exact version を要求される。

## 3. 表を変えるときの手順

> **表を変える PR → 15 リポジトリの W0 相当 PR。**

1. `src/domain/toolchain.ts` の `TOOLCHAIN` を変更する PR を mc-dev-meta に出す。
   このリポジトリ自身の `pnpm check:toolchain` は `repos/` が空でも通るので、
   この PR 単体はブロックされない。
2. マージ後、変更後の表に合わせて **15 リポジトリそれぞれに** 1 本ずつ PR を出す
   — mc-sim の W0 の手順(plan.md §4 M.3)と同じ形。表の変更だけを
   まとめて 1 本の巨大 PR にはしない: 各リポジトリの CI とレビューを
   個別に通す必要があるためである。
3. 15 本がマージされてはじめて、`pnpm sync` 後の `pnpm check:toolchain` /
   `pnpm check:pins` が exit 0 になる。

## 4. `pnpm check:toolchain` の出力の読み方

```console
$ pnpm check:toolchain
check:toolchain: auditing 15 repository/ies against the toolchain pin table.

FAIL mc-kernel (2)
  devDependency:knip: expected "6.33.0", got "(missing)"
  forbidden:@typescript/native: expected "(absent)", got "present (npm:typescript@7.0.2)"
ok   mc-noise
...

check:toolchain: 1 in policy, 14 of 15 out of policy, 23 finding(s) total.
```

- `repos/` が空(fresh clone、CI の通常時)なら reason を出して **exit 0**。
  15 リポジトリの存在を前提にしたら、それを fetch する側の道具自身が
  最後まで検証できないことになる — `docs/workflow.md` / `check:workspace` と
  同じ理由付け
- `repos/<name>` は存在するが `package.json` が無い/parse できないのは
  **skip ではなく failure**。チェックアウトそのものの欠陥だからである
- 1 finding = `{ repo, rule, expected, actual }` の 1 行。`rule` は
  `devDependency:<name>`、`forbidden:<name>`、`flake.nixPackage:<name>`、
  `vitest.threshold.<metric>` のように、表のどのエントリが原因かを
  そのまま name で持つ

## 5. `pnpm check:pins` の出力の読み方

```console
$ pnpm check:pins
check:pins: auditing 15 repository/ies' @nerima-games/* pins.

FAIL mx-gameplay (1)
  @nerima-games/mc-kernel: pinned "^1.2.0", current "1.3.0"
ok   mc-kernel
...

check:pins: 14 in policy, 1 of 15 out of policy, 1 finding(s) total.
```

- 検査対象は `dependencies` / `devDependencies` / `peerDependencies` の
  `@nerima-games/*` エントリすべて。**exact 一致**が要求され、`^` `~`
  `workspace:*` はいずれも current の値と文字列として一致しないため、
  この検査だけで range 記法を弾ける(range パーサは別途書いていない)
- 参照先のリポジトリが `repos/` に無い場合は `current: "(not cloned)"` の
  finding になる。「比較できないので静かに通す」は選んでいない —
  検査していない成功は成功ではない、という `check:mirrors` と同じ規律
- Wave 1 のゲートだが W0-META のセッションで同時に作った(plan.md §4 item 4)

## 6. 何を変えないか

- `mc-compose` は dist を持たず `package:verify` / `dist` の形の検査からは
  例外扱いされるが、toolchain 検査からは例外ではない。両チェックとも
  `mc-compose` を他の 14 リポジトリと同じ規則で監査する
- `mc-dev-meta` 自身は 15 リポジトリに含まれない
  (`domain/repository-roster.ts#MANAGED_REPOSITORY_NAMES`)ので、
  どちらのチェックの対象にもならない。ただし `TOOLCHAIN` 表のうち
  自身に適用可能な項目(typescript / vitest / @types/node / tsx /
  packageManager / engines)は手動で `package.json` に反映してある。
  `effect` は依存に**持たない**— このリポジトリは 15 リポジトリを
  fetch する側であり、それらに依存できない
