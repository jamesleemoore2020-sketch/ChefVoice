# ChefVoice 0.10 — Shared Android/Web Golden Cooking Corpus

## Why this release exists

ChefVoice now has one cross-platform cooking-language contract instead of independent Android and PWA expectations.

The shared corpus lives at:

`shared/golden-cooking-corpus.tsv`

It currently contains 36 deterministic cooking fixtures covering measurements, fractions, ASR repairs, split recognition segments, shared measurements, spoken corrections, unmeasured ingredients, count units, false-positive filtering, and method separation.

## Cross-platform parser alignment

This release also aligns two behaviors that existed on the PWA but were not yet mirrored cleanly in Android:

- `half a teaspoon each of salt and pepper` → 1/2 tsp Salt + 1/2 tsp Pepper
- `two cups flour actually make that three cups` → 3 cups Flour

## Golden corpus found and fixed a real bug

While adding the shared fixtures, the corpus exposed a session-parser issue with normalized Unicode fractions such as `½ teaspoon salt`.

`½` normalizes to `1/2`, but the session quantity regex could match the leading `1` before the full fraction. The quantity matcher now prioritizes fraction tokens before plain integers.

## Tests

PWA:

- all prior unit/regression tests
- 36 shared golden corpus fixtures

Android:

- a native JVM unit test reads the same `shared/golden-cooking-corpus.tsv`
- a standalone Kotlin validation was also run against the actual Android parser source during this build

## Development rule

Every future real cooking-language failure should become a shared corpus fixture before the parser is changed.

## Android version

- versionCode: 13
- versionName: 0.6.5

## PWA version

- 0.10.0

## Unchanged

- Firebase schema/rules
- offline sync queue behavior
- iPhone v0.7.3 media-isolation strategy
- two-way Live signaling
- raw-audio privacy model
