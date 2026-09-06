# ChefVoice v0.10.6 — Account deletion re-auth path + web deletion resource

Policy fix only. Not bundled with any feature work — versionCode 58, versionName `0.10.6`.

## Why this shipped on its own

Google Play requires (1) working in-app account deletion and (2) a web-accessible
deletion path for users who no longer have the app installed. Both were gaps in the
shipped 0.10.5 build. This release fixes only that; no monetization, entitlement, or
paywall work is included.

## Root cause

`deleteChefVoiceAccount` (Cloud Function) has always correctly rejected deletion
requests whose ID token's `auth_time` (last *interactive* sign-in) is older than 10
minutes — the Firebase Android SDK refreshes ID tokens silently without ever renewing
`auth_time`, so this correctly rejects nearly every real user, not just attackers. The
gate is deliberate and unchanged.

What was missing was the client half: on `FAILED_PRECONDITION`, the app showed a
one-line hint asking the user to fully sign out and back in — no in-app way to just
re-prove identity and continue. That is the defect this release fixes. The backend
delete sweep itself (recipes/media, social edges, comments, conversations, Live
sessions, private subcollections, Storage prefixes `profiles/`, `privateVoice/`,
`recipes/`, Auth user) was verified complete and untouched.

## What changed

- **`app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt`**
  `deleteChefVoiceAccount(...)` callback now reports `(needsReauth, error)` instead of
  a single error string, so the UI can distinguish "stale auth_time" from every other
  failure. Added `reauthenticateAndDeleteChefVoiceAccount(password, callback)`: calls
  `FirebaseUser.reauthenticate()` with an `EmailAuthProvider` credential, then
  **forces `getIdToken(true)`** (required — reauthenticate() alone does not refresh
  the cached token the Functions SDK sends) before retrying the callable.
- **`app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt`** New
  `needsReauthForDelete` state, `confirmAccountDeletionWithPassword(password)`, and
  `cancelAccountDeletionReauth()`. The auth-state listener resets
  `needsReauthForDelete` on any sign-in/sign-out change.
- **`app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt`** Profile screen now
  shows an inline password field when re-authentication is required, instead of only
  a hint to sign out. No other screen changed.
- **`hosting/delete-account/index.html`** (new) — the Play-required web deletion
  resource. Static page, Firebase Auth (email/password) sign-in, then calls the
  *same* `deleteChefVoiceAccount` callable used by Android — one deletion
  implementation, two front doors. Handles the same `FAILED_PRECONDITION` re-auth
  case inline. Deployed via the new `DEPLOY_ACCOUNT_DELETION_PAGE.cmd`
  (`firebase deploy --only hosting --project chefvoice-d7fec`) — does not touch
  Functions, Firestore/Storage rules, or App Check.
- **`firebase.json`** Added a `hosting` block (`public: "hosting"`). No other section
  changed.
- **`notifications/production-trust.test.js`** Version pin updated to
  `versionCode 58` / `0.10.6` (was stale at 55/0.10.4 against the shipped 0.10.5
  build — an existing gap, not introduced here); added a gate asserting the
  re-auth path exists so it can't silently regress.
- **`CLAUDE.md`** Corrected the stale "Not a git repository at present" line — this
  repo has been a git repo (`master`) for some time.
- **`app/build.gradle.kts`** Release-signing readiness is now computed once at the top of
  the file (`releaseSigningReady`), and `assembleRelease` / `bundleRelease` /
  `packageRelease` / `packageReleaseBundle` gained a `doFirst` guard that throws when any
  of the four `CHEFVOICE_RELEASE_*` variables is unset or blank. Previously such a build
  skipped signing, reported BUILD SUCCESSFUL and wrote an unsigned artifact that Play
  rejects only after upload. `tools/BuildProductionTrust.ps1` already checked the
  variables; this closes the direct-`gradlew` path. Debug builds and unit tests are not
  affected.

## What did not change

The deterministic parser (`voice/`), Second Pass reviewer, Live/WebRTC transport,
App Check monitoring-only state, `firestore.rules`, `storage.rules`, and the backend
`deleteChefVoiceAccount` deletion sweep itself are all untouched. `firestore.rules`
line ~394 (`allow delete: if false` on `users/{uid}`) is unchanged and correct — root
profile deletion stays backend-owned via the Admin SDK.

## Verified this session

- `gradlew.bat :app:compileDebugKotlin` — BUILD SUCCESSFUL.
- `gradlew.bat :app:testDebugUnitTest` — BUILD SUCCESSFUL (golden cooking corpus
  included, unaffected).
- `node --test notifications/production-trust.test.js` — 14/14 passing.
- `node --check notifications/functions/index.js` — syntax OK (file unmodified).
- `gradlew.bat :app:packageReleaseBundle` from a shell with no `CHEFVOICE_RELEASE_*`
  variables — FAILS at `:app:packageReleaseBundle` naming all four missing variables,
  instead of the previous silent BUILD SUCCESSFUL with an unsigned AAB.
- `gradlew.bat :app:bundleRelease --dry-run` — configuration resolves cleanly with the
  new top-level `releaseSigningReady` value.

## Not verified — needs the user, on a real device / Play Console

- On-device reproduction of the original bug and confirmation the re-auth prompt
  now completes a deletion for a session signed in >10 minutes ago.
- Firebase Auth console shows the UID gone; `users/{uid}` gone; Storage prefixes
  empty, after a real deletion.
- `firebase deploy --only hosting --project chefvoice-d7fec` (via
  `DEPLOY_ACCOUNT_DELETION_PAGE.cmd`) run from a terminal with valid Firebase CLI
  credentials — this session's Firebase CLI session could not be reauthenticated
  (headless bridge, no browser) and could not perform any deploy.
- Play Console Data safety form updated with the deletion URL
  (`https://chefvoice-d7fec.web.app/delete-account/` once deployed).
- Whether Cloud Storage/Hosting APIs need one-time enabling in the Firebase console
  before the first Hosting deploy succeeds (Firestore/Storage were already enabled
  per `WEB_FIREBASE_STATUS.md`; Hosting was not previously configured in this repo).

## Gotchas hit this session

- The Firebase CLI cannot be reauthenticated from this environment: `firebase login
  --reauth` needs a real browser and this execution bridge is headless. The
  device-code fallback (`firebase login --reauth` printing a URL, then
  `firebase login <code>`) also cannot complete here because the two steps run as
  separate one-shot processes and the PKCE verifier from the first process is gone
  by the second. Any Firebase CLI action (deploy, `functions:list`, `apps:list`)
  needs to be run by the user directly in their own terminal.
- The web app's Firebase config (`apiKey`/`appId`/etc.) was not checked into the
  repo — it lived only in the now-deleted `web/` PWA directory. Pulled fresh from
  Firebase Console this session and is now embedded in
  `hosting/delete-account/index.html`. These values are public/non-secret by
  design (enforced by Firestore/Storage rules + App Check, not by secrecy).
