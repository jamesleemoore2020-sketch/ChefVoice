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
- **`hosting/index.html`** (new) — the Play-required web deletion resource. Static page,
  Firebase Auth (email/password) sign-in, a typed `DELETE` confirmation, then calls the
  *same* `deleteChefVoiceAccount` callable used by Android — one deletion
  implementation, two front doors. Handles the same `FAILED_PRECONDITION` re-auth
  case inline. Deployed via `DEPLOY_ACCOUNT_DELETION_PAGE.cmd` — does not touch
  Functions, Firestore/Storage rules, or App Check.
- **`firebase.json`** Added a `hosting` block pinned to a **dedicated Hosting site**,
  `"site": "chefvoice-delete-account"`, with `public: "hosting"` and a catch-all rewrite
  to `/index.html`. The site pin is load-bearing, not cosmetic: `hosting/` holds only the
  deletion page, and the project's *default* site (`chefvoice-d7fec`) serves the live
  ChefVoice PWA, whose source no longer exists in this checkout. An unpinned
  `firebase deploy --only hosting` would have replaced that whole site with this one
  page, unrecoverably. `DEPLOY_ACCOUNT_DELETION_PAGE.cmd` refuses to run if the pin
  goes missing. No other section of `firebase.json` changed.
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
- `firebase functions:list --project chefvoice-d7fec` — **`deleteChefVoiceAccount` is
  deployed** (v2 callable, us-central1, 1024 MiB), alongside the other 16 functions and
  `transcribeChefVoice`. This closes the open question of whether the client was calling
  a function that did not exist, and rules out that hypothesis for the original bug.
- `firebase hosting:sites:create chefvoice-delete-account` then
  `firebase deploy --only hosting --project chefvoice-d7fec` — deploy log shows
  `hosting[chefvoice-delete-account]` only; 1 file uploaded.
- **Live page verified end to end short of an actual deletion.**
  `https://chefvoice-delete-account.web.app/` returns the deletion page; the catch-all
  rewrite serves it for `/delete-account` too. In-browser: `firebase.apps.length === 1`
  against project `chefvoice-d7fec`, Auth initialized, the confirm button starts
  disabled until `DELETE` is typed, and the console is clean.
- **Neither other Hosting site moved.** `https://chefvoice-d7fec.web.app/` still serves
  the PWA and `https://chefvoice-d7fec-legal.web.app/privacy.html` still returns 200
  after the deploy.

## Not verified — needs the user, on a real device / Play Console

- On-device reproduction of the original bug and confirmation the re-auth prompt
  now completes a deletion for a session signed in >10 minutes ago.
- A real end-to-end deletion through the web page. The page was loaded and inspected
  but deliberately never signed in or used to delete an account.
- Firebase Auth console shows the UID gone; `users/{uid}` gone; Storage prefixes
  empty, after a real deletion.
- Play Console Data safety form updated with the deletion URL
  `https://chefvoice-delete-account.web.app/`.

## Gotchas hit this session

- **The hosting deploy would have destroyed the live PWA.** `firebase.json` originally
  carried a bare `"public": "hosting"` with no `site` key, on the assumption that
  Hosting was unconfigured. That was true of the repo and false of the project: the
  default `chefvoice-d7fec` site was serving a deployed ChefVoice PWA with an SPA
  rewrite (which is why `/delete-account/` already returned HTTP 200 there — the PWA
  fallback, not the new page). A Hosting deploy replaces the entire site's contents, and
  `hosting/` holds one file, so the deploy would have wiped a site whose source was
  deleted from this checkout long ago. Fixed by deploying to a dedicated
  `chefvoice-delete-account` site and pinning it in `firebase.json`. Before any Hosting
  deploy on this project, check `firebase hosting:sites:list` and what the target site
  currently serves.
- The project already has a third site, `chefvoice-d7fec-legal`, serving exactly one
  file, `privacy.html` — the Play privacy-policy URL. Same hazard applies to it. Folding
  the deletion page and the privacy policy onto one site would be reasonable
  consolidation later, but it means committing `privacy.html` to this repo first.
- The Firebase CLI's stored credentials expire and the refresh cannot be done from this
  session: `firebase login --reauth` needs a TTY and a real browser. `firebase
  login:list` still reports the account as logged in when the token is dead — only an
  actual API call (`firebase projects:list`) reveals it. The user must run the reauth in
  their own terminal; everything after that ran fine from here.
- The web app's Firebase config (`apiKey`/`appId`/etc.) was not checked into the
  repo — it lived only in the now-deleted `web/` PWA directory. Pulled fresh from
  Firebase Console and is now embedded in `hosting/index.html`. These values are
  public/non-secret by design (enforced by Firestore/Storage rules + App Check, not by
  secrecy).
