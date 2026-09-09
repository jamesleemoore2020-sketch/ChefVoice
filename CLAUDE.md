# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ChefVoice is an Android app (Kotlin/Compose) that lets a chef narrate a cooking session out loud; a deterministic (non-LLM) parser turns the raw speech transcript into structured ingredients and method steps. Around that core sits a Firebase-backed social/community layer (recipes, profiles, following, comments, likes, messaging, live video) and a notifications system, each isolated in their own deploy unit.

There is no top-level package manager for the whole repo — this is a Gradle Android project (`app/`) plus several independent Node.js test/function/web projects (`notifications/functions/`, `billing/functions/`, `rules-tests/`, `web/`). It is a git repository (`master` is the main branch).

## Commands

All commands below are run from the repo root unless noted, in `cmd.exe`/PowerShell (this is a Windows-first project; the `.cmd` wrapper scripts call PowerShell under the hood).

**Build + install the Android app (debug, to a connected/authorized device):**
```
BUILD_AND_INSTALL.cmd
```
This drives `tools/BuildAndInstall.ps1`, which locates the Android SDK (via `ANDROID_HOME`/`ANDROID_SDK_ROOT` or common install paths), bootstraps `local.properties`, and runs Gradle. APK output: `app\build\outputs\apk\debug\app-debug.apk`. Errors and full output go to `build_install.log` in the repo root; the console window stays open on failure.

**Android unit tests only:**
```
gradlew.bat :app:testDebugUnitTest
```
Tests live under `app/src/test/java/com/chefvoice/app/...`. The most important one is `voice/GoldenCookingCorpusTest.kt`, which runs `shared/golden-cooking-corpus.tsv` through the parser (see Architecture below).

**Parser gates** (`RUN_PARSER_GATES.cmd`): runs PWA tests in `web/` (`npm test`, i.e. `node --test tests/*.test.mjs` — no npm dependencies required) *and* `gradlew.bat :app:testDebugUnitTest`.

**Notification gates** (`RUN_NOTIFICATION_GATES.cmd`): runs `node --test` over the JS test files in `notifications/` and `notifications/functions/`, plus `node --check notifications/functions/index.js` as a syntax gate. Requires Node on PATH. This only checks source text / path shapes — it cannot evaluate a Firestore security rule.

**Billing gates** (`RUN_BILLING_GATES.cmd`): runs `node --test billing/launch-access.test.js` plus `node --check billing/functions/index.js`. Same limitation as the notification gates — source text and deploy scoping only, no rule evaluation.

**Firestore rules gates** (`RUN_RULES_GATES.cmd`): from `rules-tests/`, runs `npm install` (first run) then `npm test`, which is `firebase emulators:exec --only firestore --project chefvoice-rules-test "node --test firestore-rules.test.js"` — requires the Firebase CLI and emulator.

**Deploying backend pieces** (each is deliberately scoped/isolated — do not broaden them without being asked):
- `DEPLOY_NOTIFICATIONS.cmd` — deploys only the `chefvoice-notifications` Cloud Functions codebase (`firebase deploy --only functions:chefvoice-notifications`). Does not touch `transcribeChefVoice`, Hosting, Storage, or App Check.
- `DEPLOY_BILLING.cmd` — deploys only the `chefvoice-billing` Cloud Functions codebase (`firebase deploy --only functions:chefvoice-billing`). Entitlement grants live here, deliberately apart from `chefvoice-notifications`.
- `DEPLOY_COMMUNITY_RULES.cmd` / `DEPLOY_COMMUNITY_PROFILE_RULES.cmd` — deploys only `firestore:rules`. Does not touch Functions, Hosting, Speech, or App Check.

Single-test invocation examples:
```
gradlew.bat :app:testDebugUnitTest --tests "com.chefvoice.app.voice.GoldenCookingCorpusTest"
node --test notifications\live-lease-safety.test.js
```

## Architecture

### Deterministic voice-to-recipe pipeline (the protected core)

This is the most sensitive part of the codebase — many of the numbered `*.md` files in the repo root (`METHOD_*`, `SECOND_PASS_*`, `MIXED_CLAUSE_*`, `INTRA_SEGMENT_*`, etc.) are point-release writeups of individual bugs found in *real device transcripts* and the narrow, deterministic fix that was made. Read the relevant one before touching parser logic — it explains why a rule is as narrow as it is.

Key invariants, stated repeatedly across those docs and worth internalizing:
- **No LLM involvement in parsing.** The transcript-to-structure step (`CookingSessionParser.kt`) is 100% deterministic regex/heuristic logic. It does not "guess" or silently correct ASR mistakes — an uncertain phrase is left verbatim in the output for the user (or Second Pass) to review, never rewritten.
- **Original recorded cooking audio is the source of truth**, kept private; the transcript/parse is derived from it and can be redone.
- **Second Pass (`SecondPassReviewer.kt`) is explicit, opt-in review**, not automatic correction — it re-runs a returned transcript (e.g. from the Chirp 3 speech backend) through the same deterministic parser and presents differences for the user to accept ("Use second pass") or reject ("Keep current").
- Files in the voice pipeline, in rough data-flow order: `CookingSessionCapture.kt` (recording/ASR segments) → `CookingSessionParser.kt` (segment/window/whole-transcript parsing → `CookingDraft`) → `IngredientParser.kt` / `IngredientNormalizer.kt` / `IngredientReviewClassifier.kt` (ingredient-specific cleanup and confidence classification) → `RecipeCanonicalizer.kt` (final shape) → `SecondPassReviewer.kt` (optional re-parse + diff against original).

**`shared/golden-cooking-corpus.tsv`** is the cross-platform regression contract: each row is a real or representative transcript fixture with its expected structured ingredients and required method-step substrings. The rule (from `shared/README.md`): when a real phrase fails on-device, add it as a new corpus row *first*, confirm which platform fails, then fix the parser without weakening any existing row. `GoldenCookingCorpusTest.kt` runs this corpus against the Android parser; `web/tests/golden-corpus.test.mjs` runs the identical corpus against the PWA's JS port of the same parser (`web/js/cooking-session-parser.js` / `ingredient-parser.js`). Both must pass every row before either side ships a parser change — when you fix one, port the fix to the other and re-run both gates.

### Android app structure

Single Gradle module `app/`, flat package `com.chefvoice.app`, no multi-module split. Compose UI, no DI framework (manual object graph). Sub-packages:
- `voice/` — the deterministic parsing pipeline described above.
- `model/` — plain data classes shared across the app (`Ingredient`, `TranscriptSegment`, notification/second-pass result types, etc.), `Models.kt`.
- `data/` — local persistence, `RecipeRepository.kt`.
- `cloud/` — Firebase-backed repository, `FirebaseSocialRepository.kt` (large — recipes, likes, comments, follows, messaging, live sessions, moderation calls into the Cloud Functions backend).
- `media/` — audio/video capture and file helpers (`AudioTools.kt`, `MediaTools.kt`).
- `notifications/` — FCM messaging service, foreground service, and local `NotificationHelper`.
- `ui/` — Compose screens and app-level state; `ChefVoiceApp.kt` is the large top-level composable/nav host, `ChefAppState.kt` holds cross-screen state, `WebRtcLiveTransport.kt`/`LiveCameraPreview.kt`/`CameraCaptureScreen.kt` handle the Live video path.

### Firebase backend (four independently-deployed pieces)

1. **`notifications/functions/index.js`** — the isolated `chefvoice-notifications` Cloud Functions codebase (Firestore triggers + a few `onCall`s: message/comment/reply/like/follower/live notifications, push delivery, account/recipe deletion, report moderation, Storage upload permits). Deployed on its own via `DEPLOY_NOTIFICATIONS.cmd` so it never risks the separate `transcribeChefVoice` speech function. Tests for it live both in `notifications/*.test.js` (behavior/path-shape gates run against source, not the emulator) and `notifications/functions/*.test.js`.
2. **`billing/functions/index.js`** — the isolated `chefvoice-billing` Cloud Functions codebase, deployed via `DEPLOY_BILLING.cmd`. Owns Pro entitlement writes at `users/{uid}/entitlements/pro`, which are Admin-SDK-only (`allow write: if false` for clients). Today it grants launch access — 2 free years to the first 10 signups, 90 free days to everyone after, with an admin-callable kill switch and backfill; the founding-seat counter and promo flag live in `config/monetization`, closed to clients both ways. Play Billing verification and real-time developer notification handling belong here when they land, not in `chefvoice-notifications`. Tests are source-text gates in `billing/launch-access.test.js`; the rules it depends on are covered by `rules-tests/`. See `LAUNCH_ACCESS_FOUNDING_AND_PROMO_0.11.0.md`.
3. **`firestore.rules`** / **`firestore.indexes.json`** — security rules covering the data model documented in `FIREBASE_SETUP.md` (`users/{uid}`, `recipes/{recipeId}` and subcollections, `liveSessions/{sessionId}`, plus notification/report/block collections added in later versions). Rules are validated against the Firestore emulator by `rules-tests/firestore-rules.test.js`. Deployed independently via the `DEPLOY_COMMUNITY*` scripts.
4. **`storage.rules`** — Cloud Storage rules for recipe media/voice (`recipes/{uid}/{recipeId}/media|voice/*`, plus a private `privateVoice/{uid}/{recipeId}/...` path used for Second Pass re-transcription uploads).

App Check is integrated (debug provider in debug builds, Play Integrity in release) but currently runs in **monitoring-only mode — enforcement is intentionally OFF** until metrics justify turning it on; don't flip that on as a side effect of unrelated work.

### Live video (WebRTC)

Firestore is only the signaling/control plane (session doc with host/status/timestamps, SDP/ICE exchange, chat/reactions subcollection) — actual camera/microphone media flows peer-to-peer over WebRTC (`io.github.webrtc-sdk:android`), never through Firestore. See `WEBRTC_LIVE_SETUP.md`. A live host renews a `heartbeatAt` lease every 10s; a session is only shown as LIVE while that lease is fresh (35s timeout), so a killed/backgrounded host doesn't strand a stale "LIVE" badge.

### Versioning convention

`versionName`/`versionCode` in `app/build.gradle.kts` are bumped per change and each meaningful release gets a same-named root-level Markdown writeup (e.g. `PREP_COOK_TIME_0.9.14.md`) plus a rollup entry in `README.md` and/or `BUILD_STATUS.md` describing what changed and, importantly, what did *not* change (explicitly calling out when the protected parser/rules/Live/App Check surfaces were untouched). When making a change of any real size, follow this convention rather than only editing code.
