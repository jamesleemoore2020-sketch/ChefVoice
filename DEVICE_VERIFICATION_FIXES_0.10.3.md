# ChefVoice Android — device-verification fix pass (v0.10.3)

Applied on top of v0.10.2 (versionCode 53). These three bugs were found by
installing the signed v0.10.2 release build on a real device and walking the
sign-up → create recipe → Second Pass → Live path end to end; none were
caught by the existing unit/notification/rules gates.

Bump to versionCode 54 / versionName 0.10.3 is already in
`app/build.gradle.kts`.

---

## Second Pass failed with "This recipe is not owned by the signed-in
ChefVoice account" on a never-published recipe

`authorizeChefVoiceStorageUpload` (`notifications/functions/index.js`) required
a Firestore `recipes/{recipeId}` document to already exist for *any*
`private_session` upload, and rejected the call if it didn't. But a recipe
only gets a Firestore doc when it is published to Community — a private,
local-only Cook & Capture recipe (Second Pass's normal case) never has one.
Every unpublished recipe hit this check and failed with a misleading
ownership error, regardless of who created it.

Fixed to only reject when the doc **exists** and its `authorId` belongs to
someone else. The private-audio storage path (`privateVoice/{uid}/{recipeId}/session`)
is already scoped to the caller's own uid, so a missing doc carries no
ownership ambiguity to protect against.

**Deploy note:** this is a Cloud Function change — it has no effect until
`DEPLOY_NOTIFICATIONS.cmd` is run.

## Verifying your email required signing out and back in before the app
noticed

`FirebaseAuth`'s cached `currentUser.isEmailVerified` does not update just
because the server-side flag flipped — the `AuthStateListener` only fires on
sign-in/out/token-refresh events, not on a background verification change.
So tapping the emailed verification link and returning to ChefVoice left the
UI (and the "Verify your email before using Second Pass" gate) stuck showing
unverified until a full sign-out/sign-in forced a fresh user object.

Added `FirebaseSocialRepository.refreshEmailVerification()`, which calls
`currentUser.reload()` and re-reads `isEmailVerified` afterward. Wired to run
automatically on `ON_RESUME` (`ChefVoiceApp.kt`), so returning to the app
after verifying now updates the state without a sign-out round trip.

## Starting a Live broadcast ended it immediately

`ChefVoiceApp.kt` ends a Live broadcast on `ON_STOP` as a deliberate privacy
safeguard (see `AUDIT_FIXES_0.10.2.md` H3) — if the host leaves the
foreground, the camera/mic must stop. But the first time a device grants
camera/microphone permission, Android's runtime-permission prompt is a
separate system activity, and requesting it while already marked `LIVE`
(`LiveHostCameraPreview`'s permission launcher fires as soon as the live
camera screen composes) triggered that same `ON_STOP` — ending the broadcast
the instant it started, on any account that hadn't granted those permissions
before.

Added a 4-second grace window before the "left foreground" safety-end
actually fires, cancelled if `ON_START` comes back within that window (as it
does for a permission-dialog round trip). Real backgrounding — the case this
safeguard exists for — still ends the live within a few seconds; the
heartbeat-lease mechanism (35s timeout, see `WEBRTC_LIVE_SETUP.md`) remains
the backstop for an outright killed process.

---

## What did not change

Parser/voice pipeline, Firestore/Storage rules, App Check (still
monitoring-only), and the R8/signing pipeline from `AUDIT_FIXES_0.10.2.md`
are all untouched by this pass.

## Before you upload

1. `DEPLOY_NOTIFICATIONS.cmd` — required for the Second Pass fix to take
   effect; the other two fixes are client-only.
2. `RUN_NOTIFICATION_GATES.cmd` — 72/72.
3. `gradlew.bat :app:testDebugUnitTest` — 28/28.
4. `tools\BuildProductionTrust.ps1`, then re-walk the same three flows on a
   real device: Second Pass on an unpublished recipe, email verification
   without signing out, and starting a Live broadcast on a fresh install.
