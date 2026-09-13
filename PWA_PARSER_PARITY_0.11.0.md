# ChefVoice PWA — Parser Parity Restored (0.11.0)

## What this is

`web/` (the iPhone/browser PWA) was missing from this checkout entirely — not
just out of date, but absent from git history. The actual source (v0.7.0
alpha.3, `chefvoice-pwa@0.3.0`) was recovered from a user-supplied backup and
brought back into the repo at `web/`.

At that point its JS parser (`web/js/cooking-session-parser.js` /
`ingredient-parser.js`) was a much earlier port: 151 + 127 lines against the
Android parser's 792, predating roughly fifteen real-device point-release
fixes (METHOD_*, SECOND_PASS_*, MIXED_CLAUSE_*, INTRA_SEGMENT_*, the 0909/0909b
nachos and Dorito-chips fixes, and more). Measured against the current
56-row `shared/golden-cooking-corpus.tsv`, it passed 36/56.

## What changed

`cooking-session-parser.js` was rewritten to port every remaining piece of
`CookingSessionParser.kt`: the determiner-gated `need` declaration, yield-
sentence suppression, back-reference rejection, the ingredient-declaration
vs. method-step-continuation split, `extractTrailingQuantityIngredient`,
segment-aware step collection (`collectSegmentAwareSteps`, the `"them"`
repeated-clause boundary, duration continuation, method-continuation cues),
structured ingredient-action steps for scratch corrections, the three
correction passes (scratch/wait/quantity-only), and canonical
post-processing (ported from `RecipeCanonicalizer.kt`).

`ingredient-parser.js` gained the unit vocabulary and ASR repairs it was
missing entirely: the `chunk` unit alias, `cupful`/`cup full` → `cup`
normalization, `"tbsp spoon"` → `"tbsp"` repair, the `"a half a"` fix, and the
stray-measurement-word/patties cleanup in the parsed name.

Both files stayed close to the Kotlin source line-for-line where JS syntax
allows, specifically so a future parser fix is easy to port in both
directions — this was previously a one-way street (Android only).

## Result

- `web/tests/golden-corpus.test.mjs` (new): runs the exact same
  `shared/golden-cooking-corpus.tsv` used by `GoldenCookingCorpusTest.kt`.
  **56/56 rows pass**, with the same row-count guard (56) as the Android test.
- `web/tests/real-device-fixtures.test.mjs` (new): ports the five dedicated
  Kotlin fixture tests that assert things the corpus can't express — exact
  chronological step ordering and "this step must NOT contain X" negative
  assertions (nachos ingredient-declaration/method-step separation, burger
  temperature/duration handling, intra-segment predicate splitting).
- All 20 pre-existing PWA unit tests still pass unmodified.
- `npm test` in `web/`: **26/26 passing.** `RUN_PARSER_GATES.cmd` now runs
  the PWA step to completion instead of failing for lack of a `web/`
  directory.

## Explicitly out of scope

This work restores **parser parity only** — the deterministic voice-to-recipe
core that `shared/README.md` calls the cross-platform contract. The rest of
the PWA (`app.js`, community/profile/live UI, `firebase-client.js`) is still
the v0.3.0 alpha snapshot and does not reflect Android's newer social,
analytics, or monetization/entitlement features. Bringing the PWA UI to
feature parity with current Android is a separate, much larger effort and
was not attempted here.

## Protected surfaces

Android parser, golden corpus, Second Pass, Firestore/Storage rules,
Live/WebRTC, App Check (still OFF), both existing Functions codebases, and
`transcribeChefVoice` are all unchanged. Nothing was deployed. Version not
bumped: stays 0.10.6 / `versionCode 58`.
