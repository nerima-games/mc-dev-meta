# Minecraft Java Edition 26.3 conformance

Minecraft Java Edition 26.3 is the single supported target. The Mojang version
manifest reported `26.3` as the latest stable release on 2026-09-29.

## V-1 data pins

The generator reads official-data mirrors from `misode/mcmeta`. These are
tags whose pointed-to commit SHA is pinned in the generator; raw downloaded
source data is not committed.

| mirror tag | commit SHA | role |
| --- | --- | --- |
| `26.3-data` | `538b2b167248c648b2198f2c0d56eced10dfc0cf` | vanilla data pack |
| `26.3-registries` | `2240df2376509bfaf12becbb36e156e29f8ecb4d` | registry reports |
| `26.3-assets-json` | `4ea7e5424848e1bed4e8c059986950bdd0acfb22` | assets JSON, including blockstates |
| `26.3-summary` | `d96c75fec200c4580dd75e033a76341521165461` | compact summary data |

The pins were obtained with `gh api` on 2026-09-29. The generator uses the
commit SHA, not the mutable tag name, in every raw URL.

## V-3 catalog

`src/domain/conformance-catalog.ts` is the ledger for behavior-level
conformance. `pnpm check:conformance` checks catalog invariants and evidence
paths relative to `repos.json` repository roots. Intentional V-4 divergences
are the only initial rows; package streams add their own rows with tests.

## V-7 version update procedure

1. Confirm the new Java Edition stable version in Mojang's version manifest.
2. For each tag, verify that the tag points at the intended commit and record
   the resulting SHA:
   `gh api repos/misode/mcmeta/git/ref/tags/<tag> --jq '.object.sha'`.
   Update the four tag/SHAs in `scripts/conformance/generate.ts` and this
   document, recording one retrieval date. Support one version at a time.
3. Run V-1 and regenerate golden files, for example:
   `nix develop --command pnpm tsx scripts/conformance/generate.ts --out test/golden`.
4. Review every golden diff and the affected package tests before accepting it.
5. Update V-2 Wiki reference dates and literal oracle values.
6. Run `nix develop --command pnpm check:conformance` and the full verify gate.

Other package streams can use the generator with the same one-line command,
changing `--out` to their package's `test/golden` directory.
