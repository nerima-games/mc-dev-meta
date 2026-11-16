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

## Golden files

The `test/golden/vanilla-*.json` files are derived from Mojang data, so they
are not committed and must not be published; `.gitignore` excludes
`test/golden/`. `pnpm golden:fetch` generates them from `misode/mcmeta` at the
pinned commits above and checks each output against the `EXPECTED_SHA256`
table in `scripts/conformance/generate.ts`. A file whose hash does not match
is not written.

```sh
nix develop --command pnpm golden:fetch
nix develop --command pnpm test
```

A second run reuses every file whose hash already matches and fetches only
missing or mismatching files. A fetch or hash failure exits non-zero, and a
missing golden file fails the count test in
`test/conformance-generator.test.ts`. CI runs the same fetch before
`pnpm test`. If `GITHUB_TOKEN` is set, it is sent only to the api.github.com
tree listings, to raise their rate limit.

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
3. Delete `test/golden/` (a file that still matches its old hash would
   otherwise be reused) and run `nix develop --command pnpm golden:fetch`.
   With new pins it fails with one SHA-256 mismatch per changed file, showing
   the expected and actual hashes. Review the upstream `misode/mcmeta` diff
   between the old and new commits, then copy the actual hashes into
   `EXPECTED_SHA256` and rerun the fetch until it passes.
4. Update the pinned category counts in `test/conformance-generator.test.ts`
   if they changed, and run the affected package tests.
5. Update V-2 Wiki reference dates and literal oracle values.
6. Run `nix develop --command pnpm check:conformance` and the full verify gate.

Other package streams can run the same generator with a different output
directory:
`nix develop --command pnpm tsx scripts/conformance/generate.ts --out <dir>`.
The output there is vanilla-derived as well and must not be committed.
