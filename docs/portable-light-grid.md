# Portable Light Grid 契約

`src/domain/light-grid.ts` は、Chunk の sky light と block light を 4-bit 値として格納する
依存なしの portable data contract である。runtime package dependency や service adapter を
追加せず、bootstrap 前にも検証できる固定データ境界として `mc-dev-meta` が canonical に管理する。

## データ契約

- `LIGHT_LEVEL_MIN` は `0`、`LIGHT_LEVEL_MAX` は `15`。
- `CHUNK_VOLUME` は `65,536` voxels、各 grid は `LIGHT_BYTE_LENGTH = 32,768` bytes。
- `ChunkLight` は独立した `sky` と `block` の二つの `Uint8Array` を持つ。
- voxel index は [portable-chunk.md](./portable-chunk.md) と同じ Y-major 順序を使う。
- even voxel index は byte の low nibble、odd voxel index は high nibble を使う。

```text
byte[i] = voxel[2i] の light level | (voxel[2i + 1] の light level << 4)
```

## API

| API | 役割 |
| --- | --- |
| `createLightGrid()` | zeroed な一枚の packed grid を作る |
| `createChunkLight()` | 独立した sky/block grid を作る |
| `getLightAt(grid, voxel)` | nibble を読み、`0..15` の level を返す |
| `setLightAt(grid, voxel, level)` | level を整数化・clamp して nibble を更新する |
| `cloneLightGrid(grid)` | backing buffer を共有しない copy を作る |
| `clampLightLevel(value)` | `Math.trunc` 後に `0..15` へ clamp する |

root の境界では、grid が正確に `32,768` bytes の `Uint8Array` であることと、voxel index が
`0..65,535` の整数であることを fail-fast で検証する。依存側の有効な grid・index・level に
対する packed bytes は `pnpm check:portable` で `mc-worldgen` と突合する。範囲外入力に対する
厳格さは root API の安全境界であり、依存側の inert な out-of-range read/write を runtime
logic として複製するものではない。

`check:portable` は clamp の境界・小数・無限値を比較し、すべての有効な voxel に異なる nibble
位置と level を設定した packed bytes、および全 voxel の読み出し結果を `mc-worldgen` と突合する。

## 所有境界

この module は packed light data と nibble 操作だけを持つ。block の opacity、発光源、Chunk
間の BFS、sky light の伝播、保存形式への埋め込み、meshing 用の照明計算は `mc-worldgen` または
それを利用する各 runtime repository が所有する。

`mc-kernel` に公開 light contract が追加された場合は二重実装を残さず、canonical API へ
移管する。移管時の実値確認は `check:portable`、型と mirror の確認は
`check:mirrors` / `check:repoint` で行う。

変更時は次を実行する。

```console
$ pnpm typecheck
$ pnpm lint
$ pnpm test -- test/light-grid.test.ts
$ pnpm test:coverage
$ pnpm check:portable
$ pnpm check:features
```
