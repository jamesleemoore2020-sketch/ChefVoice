# ChefVoice v0.10.6 — Account deletion re-auth path + web deletion resource

Policy fix only. Not bundled with any feature work — versionCode 58, versionName `0.10.6`.

## Why this shipped on its own

Google Play requires (1) working in-app account deletion and (2) a web-accessible
deletion path for users who no longer have the app installed. Both were gaps in the
shipped 0.10.5 build. This release fixes only that; no monetization, entitlement, or
paywall work is included.

## Root cause — three independent faults, all required

Account deletion was broken by three separate problems stacked on top of each
other. Fixing any one alone would not have made deletion work, which is why
earlier source-only analysis kept landing on an incomplete answer. All three were
confirmed on a real device against the live project, not inferred from source.

**1. The client had no re-authentication path.** `deleteChefVoiceAccount` rejects
requests whose ID token's `auth_time` (last *interactive* sign-in) is older than
10 minutes. The Firebase Android SDK refreshes ID tokens silently without ever
renewing `auth_time`, so this correctly rejects nearly every real user. The gate
is deliberate and unchanged; what was missing was the client half. The app showed
a one-line hint to sign out and back in, with no in-app way to re-prove identity.
This is the part 0.10.6 fixes in the app.

**2. `firestore.indexes.json` had never been deployed.** The deletion sweep runs
collection-group queries over `comments.authorId`, `comments.replyToUid`,
`notifications.actorUid` and `bookmarks.recipeId`. Each needs a single-field
`COLLECTION_GROUP` index override. The repo declared all four correctly — but
`firebase.json` had no `"indexes"` key, and every deploy script is scoped to
`firestore:rules`, so the CLI was never handed the file. Deployed state was one
composite index and `"fieldOverrides": []`. The callable therefore threw
`9 FAILED_PRECONDITION` mid-sweep and surfaced to the client as `INTERNAL`.
Because those three queries run inside one `Promise.all`, the reported error
alternated between `comments` and `notifications` across attempts, which made it
look intermittent. It was not.

**3. The functions runtime service account could not delete Auth users.** With
the indexes fixed, the sweep ran to completion and failed on its final line,
`getAuth().deleteUser(uid)`, with `FirebaseAuthError: ... insufficient
permission`. `569377936753-compute@developer.gserviceaccount.com` held
`datastore.user`, `firebasecloudmessaging.admin`, `speech.client` and the
build/run roles, but no Firebase Auth role at all. `getAuth()` is used exactly
once in the whole `chefvoice-notifications` codebase, so this had never worked.
Fixed by granting `roles/firebaseauth.admin` to that service account.

Note the failure ordering: because deletion is idempotent and phase-ordered, each
fix moved the failure later in the sweep rather than resolving it. Fault 2 hid
fault 3 completely.

The backend delete sweep logic itself (recipes/media, social edges, comments,
conversations, Live sessions, private subcollections, Storage prefixes
`profiles/`, `privateVoice/`, `recipes/`, Auth user) was correct throughout and
is unchanged.
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

Build and gates:

- `gradlew.bat :app:compileDebugKotlin` / `:app:testDebugUnitTest` — BUILD SUCCESSFUL
  (golden cooking corpus included, unaffected).
- `node --test` over `production-trust`, `chef-discovery-following-feed`,
  `live-lease-safety`, `recipe-time-metadata` — 23/23 passing.
- `gradlew.bat :app:packageReleaseBundle` with no `CHEFVOICE_RELEASE_*` set — FAILS
  naming all four missing variables, instead of the previous silent BUILD SUCCESSFUL
  with an unsigned AAB.

Deployment:

- `firebase functions:list` — `deleteChefVoiceAccount` is deployed (v2 callable,
  us-central1, 1024 MiB).
- `firebase deploy --only firestore:indexes` — `fieldOverrides` went from 0 to 4
  (`comments.authorId`, `comments.replyToUid`, `notifications.actorUid`,
  `bookmarks.recipeId`), plus the previously-missing `conversations` composite index.
  That composite index also fixes a client-side Messages query that was failing with
  "The query requires an index" in logcat.
- `gcloud projects add-iam-policy-binding` — `roles/firebaseauth.admin` granted to
  `569377936753-compute@developer.gserviceaccount.com`, verified present afterwards.
- Web deletion page deployed to its own Hosting site and verified live; the PWA on the
  default site and `chefvoice-d7fec-legal/privacy.html` are both untouched.

**End-to-end account deletion, on a real Samsung S25 (SM-S938U, Android 16 / API 36),
from a sign-in older than 10 minutes:**

```
confirmWithPassword entered accountBusy=false
repo: reauth start
repo: reauth OK, forcing token refresh
repo: token refreshed, retrying delete
repo: invoking callable
repo: callable SUCCESS
state: AUTH LISTENER fired uid=null
```

The password prompt appeared, re-authentication succeeded, the forced
`getIdToken(true)` refresh carried through, the retry reached the callable, the
callable returned success, and the client signed out — the Auth user was gone.
This was captured with temporary `CVDelete` logging that has since been removed.

## Not verified — needs the user, on a real device / Play Console

- A real end-to-end deletion through the **web** page. The page was loaded and its
  Firebase init inspected, but never used to delete an account. Note that the web
  flow signs in immediately before deleting, so `auth_time` is always fresh there and
  its re-auth branch is defensive rather than routine.
- Play Console Data safety form updated with the deletion URL
  `https://chefvoice-delete-account.web.app/`.

## Gotchas hit this session

- **Source-only analysis produced a confident and wrong root cause.** The prior
  handoff ranked the `auth_time` gate as the most likely single cause. It was a real
  defect, but on its own it explained nothing — the server logs showed `auth: VALID`
  on every attempt. Faults 2 and 3 were invisible from the source tree and only
  appeared in `firebase functions:log`. For a backend bug on this project, read the
  function logs before ranking hypotheses.
- **The hosting deploy would have destroyed the live PWA.** `firebase.json` carried a
  bare `"public": "hosting"` with no `site` key, on the assumption that Hosting was
  unconfigured. That was true of the repo and false of the project: the default
  `chefvoice-d7fec` site serves a deployed PWA with an SPA rewrite, which is why
  `/delete-account/` already returned HTTP 200 there. A Hosting deploy replaces the
  entire site, and `hosting/` holds one file, so it would have wiped a site whose
  source was removed with the `web/` directory. Fixed by deploying to a dedicated
  `chefvoice-delete-account` site pinned in `firebase.json`, with a tripwire in the
  deploy script. Before any Hosting deploy here, check `firebase hosting:sites:list`
  and what the target site currently serves. The project also has a third site,
  `chefvoice-d7fec-legal`, serving only `privacy.html`.
- **Deploy-script scoping cuts both ways.** The narrow `DEPLOY_*` scripts are good
  discipline, but nothing deployed `firestore.indexes.json`, so a correct index
  config sat unshipped indefinitely. `DEPLOY_FIRESTORE_INDEXES.cmd` now covers it.
- **The Firebase and gcloud CLIs both expire their stored credentials**, and
  `firebase login:list` still reports the account as logged in when the token is
  dead — only a real API call reveals it. `firebase login --reauth` needs the user's
  own terminal; `gcloud auth login` was able to launch a browser from this session.
- The device build was a **debug** build, so a signed release APK could not be
  installed over it without an uninstall that would wipe local recipes. App data was
  backed up via `run-as ... tar` before installing, and the debug upgrade preserved
  it.
- The web app's Firebase config was not checked into the repo — it lived only in the
  now-deleted `web/` PWA directory. It is now embedded in `hosting/index.html`. Those
  values are public/non-secret by design.
