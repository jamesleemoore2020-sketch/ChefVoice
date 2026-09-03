# ChefVoice Android v0.8.6 — Food-First Community Profiles

- Continues from v0.8.5 Followed Live Alerts.
- Community is finished-dish-photo first with chef identity inside the image.
- Public Chef Profile navigation is available from Community, recipe detail, and Live.
- Followers are count-only; follower identities are not exposed.
- Live hub prioritizes followed chefs; Follow and reactions are integrated over the Live area.
- Protected parser, Second Pass, private audio, WebRTC/media, App Check, Storage rules, and shared corpus are unchanged.
- Version: 0.8.6 (`versionCode 29`).
- Status: source implementation + source regression validation complete; Windows APK build/install and real-device acceptance pending.

See `FOOD_FIRST_COMMUNITY_PROFILES_0.8.6.md`.

---

# ChefVoice Android v0.8.5 — Followed Live Alerts

- Extends the proven v0.8.4 notification pipeline with followed-chef Live alerts.
- Adds deterministic, block-aware, bounded follower fanout from `liveSessions/{sessionId}`.
- Adds dedicated `liveSessionId` notification data on backend and Android.
- Adds in-app and system-notification routing to Live.
- Keeps the existing isolated `chefvoice-notifications` codebase and working IAM model.
- Protected cooking parser, Second Pass, private audio, Live media, App Check bootstrap, Storage rules, and shared corpus are unchanged; Firestore notification-device rules are aligned to the already-live Android/PWA rule.
- Version: 0.8.5 (`versionCode 28`).
- Status: source implementation generated; automated validation and real-device acceptance are tracked separately and must not be overstated.

See `FOLLOWED_LIVE_ALERTS_0.8.5.md`.

---

# ChefVoice Android v0.8.4 — Activity Notifications

- Adds private persistent activity notifications for Messages, recipe comments, and recipe likes.
- Adds Android system notifications through FCM using registered Firebase Installation IDs.
- Adds Android 13+ POST_NOTIFICATIONS permission handling.
- Message pushes intentionally omit private message content.
- Android verifies recipient UID before displaying a data-only push.
- Blocked account pairs do not generate social notifications.
- Notification records are backend-created; clients can only advance their own read state.
- Notification Functions are isolated in the `chefvoice-notifications` codebase and do not redeploy `transcribeChefVoice`.
- Protected cooking parser, Second Pass, private audio, Live media, App Check bootstrap, Storage rules, and shared corpus are unchanged.
- Version: 0.8.4 (`versionCode 27`).
- Status: generated/source-validated candidate; Firebase deploy, Windows build/install, and real-device acceptance pending.

See `ACTIVITY_NOTIFICATIONS_0.8.4.md`.

---

# ChefVoice Android v0.8.3 — Message Blocking

- Adds owner-private `users/{uid}/blocks/{blockedUid}` records.
- Block/Unblock is available inside an existing private conversation.
- Firestore rules stop new conversation/message writes when either participant has blocked the other.
- Existing private message history remains readable to its two participants.
- v0.8.2 unread read-markers are hardened so `lastReadAt` cannot move backward.
- Protected cooking parser, Second Pass, private raw audio, Live media, and App Check files are unchanged.
- Version: 0.8.3 (`versionCode 26`).
- Status: generated/source-validated candidate; Windows build/install and real-device acceptance pending.

See `MESSAGE_BLOCKING_0.8.3.md`.

---

# ChefVoice Android v0.7.0 — Second-Pass Parity

- Native Android recipe detail now includes authenticated second-pass transcription.
- Full cooking-session WAV uploads to the private `privateVoice/{uid}/{recipeId}/...` path.
- Reuses deployed `transcribeChefVoice` callable + Chirp 3 backend.
- Runs the returned transcript through the native deterministic parser.
- Review is explicit: Use second pass / Keep current; no silent rewriting.
- Second-pass results persist locally and are excluded from public Firestore recipe maps.
- Firebase Functions Android dependency added.
- Version: 0.7.0 (`versionCode 15`).

See `ANDROID_SECOND_PASS_PARITY_0.7.0.md`.

---

# ChefVoice v0.6.4 build compatibility fix

This revision fixes `checkDebugAarMetadata` failures on stable Android 16 / API 36.

- `compileSdk` / `targetSdk`: 36
- `androidx.activity:activity-compose`: 1.12.4
- `androidx.core:core` and `core-ktx`: strictly pinned to 1.17.0
- Reason: AndroidX Core 1.19.0 requires compileSdk 37+, while Core 1.17.0 remains compatible with API 36.
- Version: 0.6.4 (`versionCode 12`)

The normal entry point remains `BUILD_AND_INSTALL.cmd`.

---

# ChefVoice v0.6.3 build/install repair

## What failed in v0.6.2

The v0.6.2 script required `platforms;android-37`. Android 17 / API 37 is currently a preview SDK, so a normal stable SDK channel can legitimately report that package as unavailable. The failure happens before Gradle even starts building the app.

## What is changed

- Project now builds against stable Android 16 / API 36.
- `targetSdk` is 36.
- `lifecycle-runtime-compose` is pinned to 2.10.0 so the app does not inherit the API 37 compile requirement introduced by Lifecycle 2.11 Compose artifacts.
- The SDK setup checks for `platforms;android-36` instead of preview API 37.
- The installer prefers the current `android sdk install` CLI when available and falls back to `sdkmanager` for older setups.
- Android Studio's bundled JBR is preferred for the Gradle bootstrap.
- The build console remains open after errors and writes `build_install.log`.
- If the APK builds but no phone is authorized, Explorer opens directly to the APK.

## Run

1. Extract the ZIP fully.
2. Connect the Android phone and enable USB debugging.
3. Double-click `BUILD_AND_INSTALL.cmd`.

APK output:

    app\build\outputs\apk\debug\app-debug.apk

Full log:

    build_install.log

## PWA Alpha 7 — Reliability + Trust (2026-08-12)
The web client now includes crash/reload cooking-session checkpoints, ingredient provenance/confidence review, private raw cooking audio, hardened Storage paths, kitchen-instrument capture UI, local Ingredient Acceptance metrics, and more reliable iPhone front/back camera switching. Android source was not changed in this release. See `PWA_BUILD_STATUS.md` and `RELIABILITY_TRUST_0.7.md`.
