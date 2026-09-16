# ChefVoice session handoff — 2026-09-16 (session 2: run-on transcript duplication + ship)

## 1. TASK
Root-cause and fix a real-device transcript-duplication bug in the PWA cooking capture, port the deterministic-parser part to Android, and ship both (PWA hosting deploy + Android Play Store production upload).

## 2. TOUCHED
Worktree `C:\Users\james\ChefVoice\.claude\worktrees\chefvoice-2026-09-11-handoff-be3999`, branch `claude/chefvoice-2026-09-11-handoff-be3999`. Committed as `522c433`, pushed, working tree clean.

- `web/js/voice-capture.js` — new exported `reconcileTranscriptSegment()`; `#commit()` now replaces the in-progress transcript segment in place when a new commit is a textual continuation/revision of the last one, instead of always appending.
- `web/js/app.js` — `onSegment` handler now replaces-by-id instead of always pushing to `transcript`.
- `web/js/cooking-session-parser.js` + `app/.../CookingSessionParser.kt` — two identical regex fixes: bare `add`/`adding` now optionally consumes a trailing "in" (mirrors the existing pour/stir/mix/put/throw/drop/fold pattern); `narrationNoiseName` gained a pronoun-independent branch rejecting bare "going to"/"gonna" fragments.
- `shared/golden-cooking-corpus.tsv` — 2 new real-device rows; row-count guards bumped 56→58 in `web/tests/golden-corpus.test.mjs` and `GoldenCookingCorpusTest.kt`.
- `web/tests/voice-capture.test.mjs` — new, unit-tests `reconcileTranscriptSegment` directly.
- Version bumps: `web/package.json`/`web/sw.js` 0.5.6→0.5.7; `app/build.gradle.kts` versionCode 68→69, versionName 0.11.7→0.11.8.
- `BUILD_STATUS.md` rollup entry, new `RUNON_TRANSCRIPT_DUPLICATION_0.5.7_0.11.8.md` writeup.

## 3. DECISIONS
- Fixed the duplication at the capture layer (replace-in-place by id) rather than de-duping in the parser, because the root cause is Chrome's continuous SpeechRecognition re-finalizing one utterance ~20 times — fixing it there means the parser never sees the garbage.
- Pulled the replace/append/skip decision into a pure exported function since `VoiceCapture` needs `window.SpeechRecognition` and can't be unit-tested headless; the pure function is the only testable surface.
- Replacement keeps whichever version has more measurement evidence (existing `measurementEvidenceCount`), not just the newest, preserving the pre-existing "changes its mind" guarantee.
- Only added the pronoun-independent branch for "gonna"/"going to" in `narrationNoiseName`, not for "need"/"make"/"do" too — no real transcript proved those broken.

## 4. RULED OUT
- Parser-only de-dup of segments before parsing: unverifiable against real ASR timing the way the capture-layer fix was (confirmed live, twice, via Claude in Chrome against the user's real browser).
- Broadening `narrationNoiseName`'s pronoun requirement to all trigger words: unproven scope creep.
- Merging duplicate "Pack" / "Pack of top ramen" ingredient rows (whole-transcript vs per-segment pass naming the same ingredient differently): left as a known gap, same reasoning as the existing documented "Salt or pepper"/"Salt" gap — a substring-based ingredient merge risks conflating genuinely different ingredients.

## 5. STATE
PWA: `node --test web/tests/*.test.mjs` 115/115, DOM suites 60/60 + 33/33. Android: `gradlew.bat :app:testDebugUnitTest` full suite green (58-row golden corpus). PWA deploy live and confirmed (served `sw.js` reports `chefvoice-pwa-v0.5.7`). Android versionCode 69/0.11.8 built, signed, uploaded, submitted for Play Store review — status "Changes in review" as of session end.

## 6. GOTCHAS
- The sandboxed built-in Browser pane hard-blocks `getUserMedia`; live-mic verification needs Claude in Chrome against the user's real Chrome instead.
- Claude in Chrome's `file_upload` tool caps at 10MB combined; the release AAB is ~33.5MB, so the user had to do the actual "click Upload → pick file" step in Play Console manually — everything else (review, submit) was driven by browser automation.
- Firebase CLI's stored login expired mid-session; needed the user to run `firebase login --reauth` interactively before `DEPLOY_PWA.cmd` could succeed.
- Play Console Production was still on versionCode 67 (0.11.6) at session start — versionCode 68 (0.11.7, from the prior session) was never uploaded anywhere, not even internal testing (stuck on 65). Don't assume a locally-bumped versionCode ever shipped; check Play Console directly.

## 7. NEXT
Wait for Google Play review to clear on versionCode 69 (Play Console → ChefVoice → Production, or Publishing overview → Submission activity). Nothing else queued.

## 8. OPEN
Whether Google's review flags the two pre-existing, non-blocking warnings (advertising ID declaration mismatch, missing native debug symbols) as more than cosmetic — unrelated to this session's change, not investigated further. Whether the "Pack"/"Pack of top ramen" duplicate gap is worth a future fix.
