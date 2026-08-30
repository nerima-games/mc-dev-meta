# 公式機能の棚卸し

## 正本

機能の所有者、実装状態、管理方針、根拠ファイルは
[`src/domain/feature-catalog.ts`](../src/domain/feature-catalog.ts) の
`FEATURE_INVENTORY` を正本とする。公開 import と不変条件の検証は
[`src/domain/feature-inventory.ts`](../src/domain/feature-inventory.ts) が担う。この二つの
ファイルは実行時機能を実装せず、16 リポジトリを横断して現在の状態を読める data 層と
validation 層である。

```console
$ pnpm check:features
```

このゲートは、まずカタログの型付き不変条件を検査し、次に checkout 済みリポジトリの
evidence path が実在することを検査する。出力には status ごとの件数と未解決 feature ID も含まれる。
`repos/` が空または部分的な場合、未 checkout のリポジトリは理由を表示して skip する。
存在するはずの根拠ファイルが無い場合は失敗する。

`summariseFeatureInventory` は同じカタログから status 件数、未解決 ID、`allImplemented` を
副作用なく導出する。CLI とテストはこの集計を共有する。

## 状態の読み方

| status | 意味 |
| --- | --- |
| `implemented` | source と test または gate の根拠が存在する。公式 Minecraft の全 parity を意味しない |
| `partial` | 一部の責務または経路だけが実装されている |
| `unimplemented` | 根拠資料が未実装を明示している、または実装が存在しない |
| `deferred` | 参照実装・依存契約・環境などの理由で後段へ送っている |
| `blocked` | 外部条件または未解決の契約により着手できない |

`management` は、`mc-dev-meta` が管理するメタ契約、`mc-kernel` が canonical にする共有契約、
この repository が bootstrap-independent に管理する portable 契約、各 downstream repository
が持つ実行時ロジック、監査だけを表す。`blocked` は未実装を隠すための互換層ではなく、
`status: blocked` と一致しなければならない。

`implemented` の判定は `pnpm check:features` が source と test または gate の両方を検査する。

## 所有境界

- 共有語彙、型、座標、block capability、frame/clock 契約は `mc-kernel` を canonical とする
- Chunk の固定 wire format と sky/block light の portable data は `mc-dev-meta` が canonical とし、runtime から利用する
- 地形、シミュレーション、描画、ゲームプレイ、UI、通信、構成の実行時ロジックは各所有リポジトリに置く
- `mc-dev-meta` は roster、manifest、workspace、mirror/repoint、機能棚卸し、portable data contracts を管理する
- 手書きミラーは移植期間の監査対象であり、実行時ロジックの新しい所有場所ではない

この境界により、依存先で共有契約として移植できるものは `mc-kernel` または portable contract
へ寄せ、runtime の責務をこの repository にコピーしない。詳細は
[`docs/portable-chunk.md`](portable-chunk.md) と
[`docs/portable-light-grid.md`](portable-light-grid.md) を参照する。

## 更新手順

実装または契約が変わったら、該当行の `status`、`management`、`summary`、`evidence` を同じ変更で更新する。
根拠は repository 相対の安全なパスで記録し、次を実行する。

```console
$ pnpm typecheck
$ pnpm lint
$ pnpm test
$ pnpm test:coverage
$ pnpm check:features
$ pnpm check:portable
```

依存リポジトリの変更を含む場合は、さらに `pnpm check:workspace`、`pnpm check:mirrors`、
`pnpm check:repoint` を実行する。棚卸しが green でも `partial`、`unimplemented`、`deferred`、
`blocked` の行は残り得るため、これを公式機能 parity 完了の証明として扱わない。
