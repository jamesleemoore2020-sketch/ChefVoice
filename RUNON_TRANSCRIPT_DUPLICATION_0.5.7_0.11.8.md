# Run-on transcript duplication + two dangling-instruction ingredients (0.5.7 / 0.11.8)

Found live: James cooked a real ramen recipe through the PWA on desktop
Chrome and got a wall of garbage in Ingredients -- "Salt of top ramen",
"Pepper Of Top Ramen", "You Of Top Ramen", and a bare "In" with no
quantity/unit. Reproduced with Claude driving the real Chrome tab (mic
access is blocked in the sandboxed preview pane, so this needed the
Claude in Chrome extension against James's actual browser) and reading the
live app state directly via `document.querySelector` rather than
screenshots, which surfaced the actual `transcript` array, not just its
rendered ingredients.

## Root cause 1: continuous SpeechRecognition re-finalizing one utterance ~20 times

The reported narration was one continuous sentence with no pause
("...salt and pepper and you're going to let the top ramen cook for two
minutes..."). Chrome's `continuous + interimResults` SpeechRecognition
kept re-finalizing that single growing utterance roughly once per word
instead of finalizing it once at the end. `VoiceCapture#commit()`
(`web/js/voice-capture.js`) had no de-dup beyond "is this text byte-identical
to the last commit," so every one of those ~20 re-finalizations landed as
its own `transcript` entry. A captured real session showed this directly:
`transcriptEditor` (which just joins `transcript.map(s => s.text)`) came back
as 23 near-duplicate, monotonically-growing strings for one sentence.
`parseCookingSession`'s whole-transcript and 2/3-segment window passes then
parsed each of those overlapping fragments independently, which is exactly
where "Salt of top ramen" and "Pepper Of Top Ramen" came from -- two
different-length snapshots of the same sentence concatenated by the window
pass.

Fix: `voice-capture.js` now tracks whether a new commit is a textual
continuation/revision of the immediately previous one (either string
contains the other) via a new pure, exported `reconcileTranscriptSegment()`.
A continuation replaces the previous transcript entry in place (keeping
whichever version has more measurement evidence, preserving the existing
"changes its mind" guarantee) instead of appending a duplicate. `app.js`'s
`onSegment` handler now replaces-by-id when the emitted segment id matches
an existing one, instead of always pushing. Re-tested live against the same
real Chrome tab: the identical narration collapsed from 23 transcript
entries down to 1.

This is PWA-capture-specific (`voice-capture.js` wraps the Web Speech API);
Android's capture pipeline is unrelated and untouched.

## Root cause 2: bare "add in" leaves a stray "In" ingredient

Once duplication stopped, one real bug remained in the deterministic parser
itself: `extractIngredients`'s leading-verb strip already special-cased
"pour in" / "stir in" / "mix in" / "put in" / "throw in" / "drop in" /
"fold in" to consume the trailing "in" together with the verb, but plain
"add" was never given the same treatment. "Add in a teaspoon of X" stripped
only "add ", leaving a bare "in" that later got treated as an unmeasured
ingredient once the "a teaspoon of X" clause was consumed elsewhere,
producing a nonsense "In" row. Fixed identically in
`web/js/cooking-session-parser.js` and
`CookingSessionParser.kt` (`add|adding` -> `add(?:\s+in)?|adding(?:\s+in)?`
in the shared leading-verb-strip regex).

## Root cause 3: "going to let the X" without a leading pronoun isn't rejected

`narrationNoiseName` (both platforms) only recognized a dangling
instruction fragment ("...going to let it cook") when it still had its
leading pronoun ("you're going to..."). ASR frequently drops that pronoun
on a run-on sentence; the real capture above produced "and going to let the
top ramen" with no "you"/"you're" at all, and the bare fragment
"going to let the top ramen" passed every other name-validity check,
becoming a fourth bogus ingredient. Fixed by adding a pronoun-independent
alternative that rejects any name starting with "going to"/"gonna",
identically on both platforms.

## Validation

- New `web/tests/voice-capture.test.mjs` unit-tests `reconcileTranscriptSegment`
  directly (append / skip / replace / evidence-preserving cases) --
  `VoiceCapture` itself needs `window.SpeechRecognition` and isn't unit-testable
  headless, so the actual collapsing decision was pulled out into a pure,
  exported function instead.
- Two new `shared/golden-cooking-corpus.tsv` rows lock in root causes 2 and 3
  against both parsers: `real-bare-add-in-not-ingredient-0916` and
  `real-pwa-pronoun-dropped-going-to-0916` (the second is the literal real
  transcript captured live this session). Row-count guards bumped 56 -> 58
  in `golden-corpus.test.mjs` and `GoldenCookingCorpusTest.kt`.
- PWA: `node --test web/tests/*.test.mjs` 115/115 (was 110; +5 from the new
  `voice-capture.test.mjs`; the two new corpus rows are exercised inline by
  the existing golden-corpus test, not as separate test cases). Cook wizard
  DOM 60/60, Recipes list DOM 33/33.
- Android: `gradlew.bat :app:testDebugUnitTest` -- full suite green, including
  `GoldenCookingCorpusTest` at the new 58-row count.
- Live end-to-end, twice, against James's real Chrome via the Claude in
  Chrome extension (not the sandboxed preview pane, which blocks
  `getUserMedia`): same real narration re-run before and after the capture
  fix landed. Before: 8 ingredients / 4 steps, 23 duplicate transcript
  segments. After the capture fix alone: 1 clean transcript segment, but
  still a 4th bogus "Going to let the top Ramen" ingredient (root cause 3,
  not yet fixed at that point). After all three fixes (confirmed via direct
  parser test against that exact captured real-device string, per
  `shared/README.md`'s "confirm which platform fails, then fix" rule): 3
  clean ingredients (Pack of top ramen, Salt, Pepper), 2 clean steps.
- Not touched: Firestore/Storage rules, Cloud Functions, Live/WebRTC, App
  Check, billing. `rules-tests`/notification/billing gates were not re-run --
  nothing here touches those surfaces.

## Deploy

```
DEPLOY_PWA.cmd
```

Reload/reopen the PWA after deployment to pick up cache version 0.5.7.
Android needs a normal rebuild/install (`BUILD_AND_INSTALL.cmd`) to pick up
versionCode 69 / versionName 0.11.8.
