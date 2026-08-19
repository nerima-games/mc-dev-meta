# plan.md §6 Step 2 の横断状況

この文書は、内蔵プレビューの有無を手作業の件数で固定する進捗表ではない。以前の集計は
実装・テスト・各リポジトリのドキュメントと食い違うため撤去した。現在の機能状態は
[`feature-inventory.md`](./feature-inventory.md) と
[`src/domain/feature-inventory.ts`](../src/domain/feature-inventory.ts) を読む。

## プレビューと機能 parity は別の軸

plan.md §6 Step 2 の「内蔵プレビューが操作可能」という条件は、実行時の体験を測る条件である。
一方、機能棚卸しは block 契約、world generation、simulation、rendering、gameplay、UI、
multiplayer、composition などの所有境界と実装状態を測る。プレビューが起動できても、
その周辺機能が `partial` または `unimplemented` であることはあり得る。

したがって、このリポジトリは「すべての公式 Minecraft 機能が完成した」とは宣言しない。
`partial`、`unimplemented`、`deferred`、`blocked` を明示したまま、実際の根拠ファイルと
所有リポジトリを横断して確認できる状態を作る。

## 現在の確認方法

```console
$ pnpm sync
$ pnpm check:features
$ pnpm check:workspace
$ pnpm check:mirrors
$ pnpm check:repoint
```

`check:features` は checkout 済み根拠ファイルを確認し、未 checkout のリポジトリは理由付きで
skip する。workspace、mirror、repoint はそれぞれ下流の実行、共有契約の一致、依存先へ
張り替えた場合の型検査を確認する。`repos/` が空または部分的な場合も、各ゲートの skip
理由を結果として記録する。

## 更新のしかた

実装を変更したリポジトリで、該当する棚卸し行の状態と evidence を更新する。状態の判断は
根拠ファイル、テスト、ドキュメント、ゲートの順に確認し、単なるプレビューの見た目や
手作業の件数だけで `implemented` にしない。機能の実行時コードは所有リポジトリに置き、
この repository には横断契約と監査データだけを置く。
