# ChefVoice session handoff — 2026-09-17 (session 5: R8 smoke test, two parser fixes, 0.11.12 shipped)

## 1. TASK
Smoke-test the R8 release build on a device per `HANDOFF_2026-09-16_SESSION4.md`, fix what
that surfaced, and get the result onto Google Play.

## 2. TOUCHED
Worktree `.claude/worktrees/chefvoice-2026-09-11-handoff-be3999`, branch
`claude/chefvoice-2026-09-11-handoff-be3999`. Commits `ecea61b`, `b4cac55`, `595ef9c` — all
pushed, working tree clean.

- `web/js/cooking-session-parser.js` + `app/.../voice/CookingSessionParser.kt` — identical
  changes: `isTitleAnnouncementStep()` → `stripTitleAnnouncement()` (drops the trailing `$`
  anchor, strips the announcement as a prefix, returns the remainder); new
  `strandedDurationClause` branch in `collectSegmentAwareSteps()` before the silent drop.
- `shared/golden-cooking-corpus.tsv` — row `real-device-runon-title-announcement-0916`
  (59 → 60, bumped in both runners).
- `GoldenCookingCorpusTest.kt` / `web/tests/parser.test.mjs` — exact-output tests plus the
  negative assertion the corpus format cannot express.
- `app/build.gradle.kts` 73 / 0.11.12; `web/package.json` + `web/sw.js` 0.5.11.
- Writeup `RUNON_TITLE_AND_STRANDED_SEGMENT_0.5.11_0.11.12.md`, plus `BUILD_STATUS.md`.

## 3. DECISIONS
- Announcement is stripped as a **prefix**, not suppressed as a whole step — deleting the
  instruction that ran on after it was the actual bug.
- Stranded-segment rescue gated on a **duration** (`seconds?|minutes?|hours?`), not on length
  or "unrecognized", so filler still drops but timing detail is never lost.
- Strip before `dedupeSteps()` so stripping cannot produce duplicates.

## 4. RULED OUT
- **R8 as the cause of anything observed.** On-device parser output matched the JS reference
  byte for byte. Don't re-investigate minification for parser reports.
- **These two bugs being 0.11.11 regressions.** The parser at `522c433` produces identical
  steps; session 4 only improved the title (`My famous top romantle` → `Famous top romantle`).
- **Uploading the AAB via the Chrome tool.** `file_upload` caps at 10 MB; the bundle is 33.5 MB
  and a single binary cannot be split. There is no gradle-play-publisher, fastlane or service
  account in the repo. A human must drag the file in.
- **Deleting the test recipe via the PWA.** That Chrome profile is not signed in, and PWA
  recipes are local-per-device, so the Android recipe never appears there.

## 5. STATE
PWA 121/121, cook-wizard DOM 74/74, Android green (`GoldenCookingCorpusTest` 24 tests,
0 failures). PWA 0.5.11 deployed and verified by running the *deployed* JS. Play: code 73
(0.11.12) submitted to production, 100%, all targeted countries, managed publishing off →
auto-publishes when review passes; Publishing overview shows "Changes in review".
`ChefVoice-v0.11.12-Production.aab` SHA-256
`6284cacc9dab9783d4a33d203384c36a1e2513ffdc3d49a398533aeb1364de60`.

Full R8 smoke test passed on SM-S938U / Android 16 against the split-APK install: cold start,
Firestore read **and** write, mic → SpeechRecognizer → foreground service, saved voice clip,
all 5 wizard steps, and **WebRTC Live initialized under minification**
(`libjingle_peerconnection_so.so` loaded, `PeerConnectionFactory` up, LIVE then ended clean) —
the exact `org.jni_zero` path from 0.11.5, never before run minified. No
`ClassNotFoundException`/`NoSuchMethodError`/`VerifyError`/`UnsatisfiedLinkError` anywhere.

## 6. GOTCHAS
- **Code 72 went live at 100% on 2026-09-16 while this session was working** — session 4's
  "draft only, not rolled out" was already stale. Re-read the production track before trusting
  any handoff's Play state; other Claude sessions change it.
- Two pre-existing non-blocking Play warnings, not caused by 0.11.12: the ad-ID declaration
  claims an advertising ID the manifest has no `AD_ID` permission for (release-blocking errors
  are off), and no native debug symbols are uploaded, so native WebRTC crashes won't
  symbolicate.
- No separate `mapping.txt` upload needed — the bundle embeds
  `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`.
- The dev phone sleeps and re-locks within seconds and drops off `adb` repeatedly; taps land on
  a sleeping screen and silently do nothing. Screenshot after every tap to confirm.
- Reading the AAB's size mid-build gives a bogus small number; wait for `signReleaseBundle`.
- Heredoc-through-Bash mangles backslashes in regex-heavy JS/Kotlin — use exact-match edits for
  parser changes, not `sed`/heredoc patch scripts.
- `DEPLOY_PWA.cmd` ends in `pause` and hangs non-interactively; run its steps directly
  (both `firebase.json` target tripwires, `npm --prefix web test`, then
  `firebase deploy --only hosting:pwa --project chefvoice-d7fec`).

## 7. NEXT
Done, 2026-09-18: code 73 published. Production track reads `Active - Latest release: 73
(0.11.12) - 177 countries/regions - 3 installs`; Releases shows it "Available on Google Play",
released Sep 16 9:41 PM; Publishing overview is empty. Nothing is in flight.

## 8. OPEN
- Whether `possible-missed-step` should auto-apply like ingredients do (carried from session 4,
  still one line).
- Android still has no pre-save ChefVoice Review, so 0.5.8–0.5.10's review UX remains PWA-only.
- `ndk { debugSymbolLevel = "FULL" }` and correcting the ad-ID declaration, both deferred to the
  next release.
- Lingering-cleanup items James flagged but did not scope: the ended `R8 test – ignore` live
  session doc, and ~600 MB of gitignored `ChefVoice-v0.11.1`–`v0.11.11` AAB/APK artifacts in the
  repo root. The `Famous top romantle` test recipe was deleted by James himself.
