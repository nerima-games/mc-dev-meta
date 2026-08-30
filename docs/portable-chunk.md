# Portable Chunk 契約

`src/domain/voxel-chunk.ts` は、ゲーム runtime が bootstrap される前にも利用できる
最小の Chunk データ契約と wire codec を提供する。依存を逆向きに追加せず、移植可能な
データ定義をこの repository で管理するための canonical module である。Light grid の packed
data は [portable-light-grid.md](./portable-light-grid.md) に分離している。

## データ契約

- Chunk の水平サイズは `16 × 16`、高さは `256`。
- block 配列は `Uint8Array` の `65,536` bytes である。
- block ID は `0..255` の 1 byte。`0` は air である。
- 配列は `mc-worldgen` と同じ Y-major で、index は
  `y + z * 256 + x * 256 * 16` で求める。
- `createChunkFromBlocks` は生成・meshing のために入力 buffer を live view として保持する。

## 固定 codec

`encodeChunk` は常に `65,557` bytes を生成する。整数は little-endian である。

| offset | size | 内容 |
| ---: | ---: | --- |
| 0 | 4 | ASCII `MCCH` |
| 4 | 1 | format version `1` |
| 5 | 8 | signed 64-bit chunk `cx` |
| 13 | 8 | signed 64-bit chunk `cz` |
| 21 | 65,536 | Y-major block bytes |

decoder は magic、version、固定長、座標の safe-integer 範囲を検証し、truncated または
trailing data を受け付けない。codec の入力と出力はコピーされるため、保存済み bytes の
変更で Chunk が変化することはない。

## 所有境界

この module は portable data と wire format だけを持つ。地形生成、Chunk store、lighting の
伝播・遮蔽、meshing、保存形式への埋め込みは各 runtime repository が所有し、この契約を利用する。
`mc-kernel` は block ID、座標、共有 capability の canonical source であり、Chunk data や
Chunk codec の owner ではない。runtime の Chunk lifecycle は `mc-worldgen`、versioned な
保存形式と storage codec は `mc-save` が所有する。この fixed codec は runtime package の
bootstrap に依存しない portable cross-runtime contract であり、`mc-save` の保存形式への
埋め込みを置き換えるものではない。

変更時は次を実行する。clone 済みの `mc-kernel` / `mc-worldgen` があれば、
`check:portable` がその runtime export の定数・座標と実値を突合する。`blockIndex` は代表値ではなく、
すべての有効な `x / y / z` 組で root の index と比較する。owner が一つも比較できない場合は
成功扱いにしない。

```console
$ pnpm typecheck
$ pnpm lint
$ pnpm check:portable
$ pnpm test -- test/voxel-chunk.test.ts
$ pnpm test:coverage
```
