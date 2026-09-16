# Cook time auto-fill + "and you let it" ingredient tail — 0.11.9

Two defects found while reproducing a real Android Chrome capture reported after the
0.11.8 ChefVoice Review work. Both came from the same spoken transcript:

> "So today we going to make my famous top ramen meal. What you going to need to start
> with is one top ramen, 1 tsp of salt, 1 tsp of pepper, and you let it cook for 2
> minutes, then it's finished."

## 1. Detected cook time was silently wiped (PWA only)

**Symptom.** The chef said "cook for 2 minutes" and Cook min in Recipe Details stayed empty.

**Not the parser.** `parseCookingSession()` returned `cookMinutes: 2` for this transcript
in every segmentation tried (single segment, two segments, per-phrase, and unpunctuated),
and Android returned 2 as well. The parser was never the failing component.

**Root cause.** `web/js/app.js` keeps Recipe Details in the module-level `form` object, and
`captureForm()` re-reads the mounted `#title`/`#prepTime`/`#cookTime` inputs back into
`form` on every wizard navigation. A capture can be finished from *any* wizard step via the
"Finish & build recipe" control, so the Recipe Details inputs are often already mounted when
`applyDetectedRecipeMeta()` runs. It wrote the detected value into `form` but not into those
live inputs, so the next `moveCookStep()` read the still-empty input back over it and the
detection disappeared. Finishing from the Capture step happened to work, which is why this
survived earlier testing.

**Fix.** `applyDetectedRecipeMeta()` now calls `captureForm()` first — so anything the chef
typed into those inputs during the capture is correctly treated as a manual edit and left
alone — and writes the resulting values back into the mounted inputs afterwards, so the next
navigation reads back what was just detected instead of a stale blank.

Android is structurally immune: `prepTimeText`/`cookTimeText` are Compose state, which is the
single source of truth, with no DOM read-back step. No Android change was needed.

## 2. "and you let it" bled into the last ingredient (both platforms)

**Symptom.** The ingredient list showed `1 tsp Pepper, and you let it`. In the multi-segment
form it was worse: a phantom `1 tsp You let it` ingredient appeared as well, inheriting the
previous ingredient's quantity and unit.

**Root cause.** The existing dangling-tail rule in `cleanIngredientName` only covered the
future form — `and (you're|we're|I'm) going to let it` — because that was the phrasing in the
earlier real-device fixtures. This chef used the plain present tense, "and you let it cook for
2 minutes". The `for N minutes` rule stripped the duration first, leaving `Pepper, and you let
it` with no rule left to match it.

**Fix.** The `going to`/`gonna` portion of that rule is now optional in both parsers, so the
plain present tense is stripped the same way. This single change also removed the phantom
ingredient. Ported identically to `web/js/cooking-session-parser.js` and
`app/.../voice/CookingSessionParser.kt`.

Following `shared/README.md`, the exact failing phrase went into
`shared/golden-cooking-corpus.tsv` first (`real-pwa-plain-pronoun-let-it-0916`, row count
58 → 59). Android was confirmed failing that row before the Kotlin fix, and passes after.

## Tests

- `shared/golden-cooking-corpus.tsv` — new real-device row, asserted by both platforms.
- `web/tests/real-device-fixtures.test.mjs` + `GoldenCookingCorpusTest.kt` — matching fixtures
  asserting the clean ingredient list, no `let it` tail, and `cookMinutes == 2`.
- `web/tests/cook-wizard.dom.mjs` — two new checks: a detected cook time survives being
  applied while Recipe Details is mounted and then navigating away and back, and a cook time
  the chef typed during that same capture still wins over detection. Both were confirmed to
  fail against the pre-fix `app.js`.

Gates: PWA 119/119, Android `:app:testDebugUnitTest` green, cook-wizard DOM 64/64.

## Not changed

The deterministic parser stayed deterministic — no LLM, no guessing, no silent rewriting of
what the chef said. Recipe title extraction, Second Pass / ChefVoice Review, Firestore and
Storage rules, Live/WebRTC, billing and App Check (still monitoring-only) were all untouched.

Recipe title is still *not* auto-filled for "we going to make my famous top ramen meal" —
the title pattern requires a pronoun *and* an auxiliary (`we're`/`I'm`), and this chef dropped
the copula. That is a separate open decision, deliberately not bundled into this fix.
