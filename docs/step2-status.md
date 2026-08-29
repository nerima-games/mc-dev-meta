# plan.md §6 Step 2 の横断状況 —— 5 完了 / 3 部分 / 1 未達 / 6 対象外

この文書は、plan.md §6 Step 2 の「各機能を内蔵プレビューで操作できる状態にする」という要求を、`repos.json` に固定された兄弟リポジトリへ横断適用した監査記録である。`mc-dev-meta` 自身は管理リポジトリなので Step 2 の対象外とし、対象は 15 リポジトリとする。

完了判定は、`apps/` ディレクトリや `pnpm preview` script の存在だけではなく、内蔵プレビューの README、各リポジトリの testing/README、必要な依存機能が揃っていることを根拠にする。プレビューの scaffold が存在しても、操作契約や最終シナリオが未達なら完了には数えない。

## 1. 現在の判定

| リポジトリ | 判定 | 根拠 | コメント |
| --- | --- | --- | --- |
| `mc-kernel` | 対象外 | `repos/mc-kernel/docs/architecture.md` | 共通語彙・型を提供する基盤で、内蔵機能プレビューの担当ではない |
| `mc-noise` | 対象外 | `repos/mc-noise/docs/architecture.md` | Worldgen から利用されるアルゴリズム層 |
| `mc-meshing` | 対象外 | `repos/mc-meshing/docs/architecture.md` | Render/Worldgen から利用されるメッシュ層 |
| `mc-physics` | 対象外 | `repos/mc-physics/docs/architecture.md` | Sim/Gameplay から利用される物理層 |
| `mc-save` | 対象外 | `repos/mc-save/docs/architecture.md` | Save/Load のライブラリ層 |
| `mc-audio` | 対象外 | `repos/mc-audio/README.md:112`, `repos/mc-audio/apps/preview-soundboard/README.md` | soundboard の scaffold はあるが、README が browser contract 未達としている |
| `mc-worldgen` | 完了 | `repos/mc-worldgen/apps/preview-terrain/README.md` | terrain preview を提供 |
| `mc-render` | 完了 | `repos/mc-render/apps/preview-render/README.md` | render preview を提供 |
| `mx-redstone` | 完了 | `repos/mx-redstone/apps/preview-circuit-board/README.md` | circuit sandbox preview を提供 |
| `mx-multiplayer` | 完了 | `repos/mx-multiplayer/apps/preview-two-clients/README.md` | two-client preview を提供 |
| `mx-ui` | 完了 | `repos/mx-ui/apps/preview-screens/README.md` | screen preview を提供 |
| `mc-sim` | 部分 | `repos/mc-sim/apps/preview-sim/README.md` | preview はあるが、Step 2 の全シナリオを満たす状態ではない |
| `mc-playground-kit` | 部分 | `repos/mc-playground-kit/apps/preview-harness/README.md` | 最小ハーネスの一部までで、全検証契約は未達 |
| `mx-gameplay` | 部分 | `repos/mx-gameplay/apps/preview-mining-site/README.md` | mining site はあるが、機能全体のシナリオは未完 |
| `mc-compose` | 未達 | `repos/mc-compose/README.md:27` | E2E の final gate が未実装。`apps/web` の存在だけでは Step 2 完了とは扱わない |

`mc-audio` には `apps/preview-soundboard` が存在するが、アプリ側 README も browser contract 未達としている。これは「ディレクトリがある」ことを完了の根拠にしないための明示的な例である。

## 2. `apps/` と完了判定の関係

同期済み snapshot で `find repos -maxdepth 3 -type d -path '*/apps/*'` を実行すると、preview と scaffold の両方が見つかる。`mc-compose/apps/web` や `mx-ui/apps/browser-harness` のように、`apps` 配下でも Step 2 の内蔵プレビューそのものではないものがあるため、最終判定は各 preview README と機能の受け入れ条件を読む監査に分けている。

このリポジトリが実行できる自動検査は、同期、pin、mirror、repoint、workspace の整合性と、
`pnpm check:features` による限定的な機能証拠の突合である。いずれも他リポジトリのブラウザ操作を
自動的に証明するものではない。Step 2 の完了数は、その制約を明記した手動監査のスナップショットであり、
`check:features` の `complete` と同義ではない。

## 3. `check:workspace` との関係

現在の worktree で `pnpm check:workspace` を実行した結果は `14 passed, 1 failed, 0 skipped` である。失敗は `repos/mc-compose/test/check-roster-manifest.test.ts:302` が、実行中 worktree のパスに含まれる `mc-dev-meta` を roster candidate に含めない前提を持つために発生する環境依存差分である。`mc-compose` の nested repository はこの監査では変更しない。

この失敗は Step 2 の未達根拠そのものではなく、workspace 監査上の既知差分である。ルートの `pnpm verify`、
`pnpm check:mirrors`、`pnpm check:repoint`、`pnpm check:features` は別ゲートとして実行する。

## 4. 更新手順

1. `pnpm sync` で `repos.json` の pinned snapshot を同期する。
2. `find repos -maxdepth 3 -type d -path '*/apps/*'` で preview/scaffold の候補を確認する。
3. 各候補の README、`docs/testing.md`、機能の受け入れ条件を読み、上表の判定根拠を更新する。
4. `pnpm check:workspace`、`pnpm check:mirrors`、`pnpm check:repoint`、`pnpm check:features` を実行し、
   自動検査の結果と手動監査の判定を混同しない。
