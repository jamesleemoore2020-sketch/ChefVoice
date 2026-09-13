# ChefVoice — engineering handoff

## 1. TASK

Fix in-app account deletion (0.10.6, done), then build the ChefVoice Pro paid tier
far enough to demo before any Play Console product exists (0.11.0, in progress).

## 2. TOUCHED

Branch `v0.10.6-account-deletion` (3 commits, off `master`, **not merged**):
- `app/build.gradle.kts` — `releaseSigningReady` hoisted; `doFirst` guard throws on release packaging tasks when any `CHEFVOICE_RELEASE_*` is unset.
- `app/src/.../cloud/FirebaseSocialRepository.kt`, `ui/ChefAppState.kt`, `ui/ChefVoiceApp.kt` — delete-account re-auth path.
- `hosting/index.html`, `firebase.json`, `DEPLOY_ACCOUNT_DELETION_PAGE.cmd` — web deletion page on its own Hosting site.
- `firebase.json` `"indexes"` key + `DEPLOY_FIRESTORE_INDEXES.cmd` — new.
- `notifications/production-trust.test.js` + 3 version-pin tests — versionCode 58 / 0.10.6.

Branch `v0.11.0-monetization` (3 commits, off the above):
- `ui/ChefVoiceApp.kt` — sign-in/create-account split into modes; `ProMembershipCard`, `ProPaywallDialog`, `PaywallTrigger`, `DemoPricing`; app-level paywall.
- `ui/ChefAppState.kt` — `proEntitlement`, `isPro`, debug `proPreviewOverride`, month-keyed Second Pass counter, `publish()` cloud cap.
- `model/Models.kt` — `ProEntitlement`, `FreeTierLimits`, `ProTierLimits`.
- `cloud/FirebaseSocialRepository.kt` — `listenProEntitlement`.
- `firestore.rules` + `rules-tests/firestore-rules.test.js` — entitlement/purchases rules, 5 new tests.

Uncommitted, pre-existing, unrelated: `AndroidManifest.xml`, `ChefVoiceForegroundService.kt` (0.10.5 mic-FGS change).

## 3. DECISIONS

- Entitlement server-authoritative at `users/{uid}/entitlements/pro`, `allow write: if false`.
- Pro preview switch gated on `ApplicationInfo.FLAG_DEBUGGABLE`, not a build flag — no release code path.
- Paywall price tap is a deliberate no-op; never fake a purchase.
- Web deletion page on a dedicated Hosting site `chefvoice-delete-account`, pinned via `"site"` in `firebase.json`.
- Gate cloud sync, not recipe count. Local recipes stay free.

## 4. RULED OUT

- **`auth_time` gate as the deletion root cause** — server logs showed `auth: VALID` on every attempt. It was one of three faults, not the cause.
- **App Check** — `enforceAppCheck: false`, logs say "Allowing request with invalid AppCheck token because enforcement is disabled". Do not enable enforcement.
- **Deploying Hosting without a `site` pin** — would replace the default site, which serves the live PWA whose source no longer exists in this checkout.
- **Hard-coded prices in shipping UI** — Play localises currency; must come from `ProductDetails`. `DemoPricing` is demo-only, delete it.
- **Client-side entitlement as source of truth** — rules tests prove clients cannot write it.

## 5. STATE

Builds and runs. Installed on SM-S938U (Android 16), debug, versionCode 58.
- `:app:testDebugUnitTest` BUILD SUCCESSFUL (golden corpus unaffected).
- 23/23 notification gates; 21/21 emulator rules tests.
- Account deletion verified end-to-end on device.
- Nothing failing.

## 6. GOTCHAS

- Deletion needed three fixes: client re-auth, deploying `firestore.indexes.json` (never deployed — `firebase.json` had no `indexes` key), and granting `roles/firebaseauth.admin` to `569377936753-compute@developer.gserviceaccount.com`. Read `firebase functions:log` before hypothesising.
- Project has 3 Hosting sites; a hosting deploy replaces a whole site.
- Device build is **debug**-signed; a release APK cannot install over it without an uninstall that wipes local recipes.
- Firebase/gcloud CLI credentials expire; `firebase login:list` lies. `firebase login --reauth` needs the user's own terminal.
- `transcribeChefVoice` source is not in this checkout.
- Second Pass counter is in `SharedPreferences` — UX gating only, resettable.

## 7. NEXT

Design and build **paid chef subscriptions**: paying a specific chef to unlock their non-free recipes. Not yet designed. Decide the entitlement shape (per-creator, e.g. `users/{uid}/entitlements/creator_{chefUid}`), Play Billing product model, payout/tax handling, and Firestore rules for gated recipe reads, before writing code. Note §7 of `MONETIZATION_REVIEW_2026-09.md` deferred a Creator tier because Live is P2P/STUN with no TURN/SFU — that reasoning applied to Live hosting, not to paid recipe access, so re-derive rather than inherit it.

## 8. OPEN

- Play Console Data safety form not yet updated with `https://chefvoice-delete-account.web.app/`.
- No real deletion performed through the web page.
- `firestore.rules` entitlement block is **committed but not deployed**; diff local against live before deploying (a rules deploy replaces the whole ruleset).
- Video-slot gating defined (`videoAllowed`) but not wired to the media picker — video still attachable on Free.
- No analytics events instrumented; no Play Billing.
- Payout mechanics for paid chef subscriptions (Google Play takes the cut; how does the chef get paid?) — unanswered.
