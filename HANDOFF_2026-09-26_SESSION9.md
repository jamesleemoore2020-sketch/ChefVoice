# ChefVoice session handoff — 2026-09-26 (session 9: audit implementation, part 1)

## 1. TASK
Implement the 2026-09-26 full audit (F1–F31). The report is at
`C:\Users\james\Downloads\AUDIT_2026-09-26_FULL.md`, deliberately not in this public repo. Part 1
has shipped; the next session starts the next release.

## 2. TOUCHED
Branch `claude/audit-implementation-7bb2be`, head `ccc4a6a`, pushed, clean. Per-item detail:
`BUILD_STATUS.md` (top entry), `PWA_AUDIT_FIX_BUNDLE_0.5.18.md`, `ANDROID_AUDIT_FIXES_0.11.18.md`.
- `.github/workflows/gates.yml`: CI jobs pwa, e2e, functions, android, rules.
- `e2e/`: Playwright package. `serve.mjs` mimics Hosting and backs `.claude/launch.json`.
- `web/`: PWA 0.5.18 (`sw.js`, `app.js`, `firebase-client.js`, `inbox.js`, new `community-feed.js`).
- Android 0.11.18 / 79: `FirebaseSocialRepository.kt`, `AndroidManifest.xml`, `ChefVoiceApp.kt`.
- `notifications/functions/index.js`: account-deletion completeness.
- `hosting/index.html`, `legal/`, `DEPLOY_LEGAL_PAGE.cmd`, legal target in `firebase.json`/`.firebaserc`.

Done: F1, F2 (web half), F3–F9, F13 (manifest), F15, F16; parts of F24, F27, F31.

## 3. DECISIONS
- Live controllers are lazy-imported in `app.js`, not refactored: rules-tests link
  `webrtc-live-*.js` against a synthetic `firebase-client.js`.
- F15 deletes `purchaseTokens` rows rather than pseudonymizing them. They only route Play RTDNs,
  `verifyChefVoicePurchase` re-maps on restore, and a pseudonym would make RTDN write
  `users/deleted:…/entitlements`.
- Feed: live first page (60) plus one-shot `loadMorePublicRecipes`. F28 is deferred because the
  listener is what keeps like counts current.

## 4. RULED OUT
- Service workers in the Claude Browser pane: every `register()` fails ("An unknown error
  occurred when fetching the script"), even `firebase-messaging-sw.js`. Test them with `e2e/`.
- A per-file network timeout in `sw.js`: it can mix modules from two deploys, and ES modules
  then fail to link. Hence the "cache-booted client" mode.
- Injecting Firestore into the Live controllers: breaks the rules-tests' SyntheticModule linking.
- Bash heredocs for code containing backslashes: the Bash tool turns `\\` into `\`, even in
  quoted heredocs. Use Write/Edit.

## 5. STATE
- CI green on `ccc4a6a`. PWA 265/0, jsdom 74/35/46, e2e 10/0, Android 209/0, notification
  gates 78/0, rules 53/0, import 98/0, billing 17/0.
- Live (verified by fetching): PWA `chefvoice-pwa-v0.5.18`, the deletion page with
  forgot-password, the corrected privacy policy (effective September 26, 2026).
- `chefvoice-notifications` (F15): deploy **not verified**.
- Android 0.11.18 (79): tested on device by James, uploading to Play. The AAB carries the R8
  mapping, so no separate upload is needed.
- Flaky: `rules-tests/pwa-live-host.test.js` "a delayed offer cannot overwrite a viewer
  replacement join" failed once in CI (`Timed out waiting for signaling`, run 36283268786).
  Cause unknown.

## 6. GOTCHAS
- Deploy and build only from this branch. The main checkout is on a stale
  `v0.11.0-monetization` with uncommitted files; its scripts would roll production back.
- `web/tests/*.dom.mjs` slice `app.js` by marker strings; a new global inside a sliced region
  needs a stub there.
- `sw.js` `CORE` must list every `web/js` and `web/css` file (tested).
- Running e2e during a Gradle build caused 45 s timeouts.
- The next Android release must be versionCode 80.

## 7. NEXT
Start 0.11.19 / PWA 0.5.19 with the UI batch:
- F12: TalkBack labels and state on emoji-only buttons (`ChefVoiceApp.kt` ~1987–1990, 2262,
  2583, 3621).
- F19: tab-bar badges.
- F20: `#C94A12` behind white text, both platforms.
- F26: dark mode, both platforms.
- F2, Android half: Robolectric nav tests in CI.

Then F22, F23 (emulator tests first, console diff before any rules deploy), F21, F30, F11,
F29, F17, F10, F18, F31.

## 8. OPEN
- Play: 0.11.18 rollout; Advertising ID → No and Data safety (Videos, Purchase history)
  answered?
- Keystore password rotation (flagged 09-07 and 09-11) unconfirmed.
- F25: repo public or private, and API-key restrictions.
- Uncommitted files in the main checkout need a home.
- `master` (`8dcda41`) is far behind this lineage; merge plan undecided.
- The "testing2" test recipe is still public.
