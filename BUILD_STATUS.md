# ChefVoice PWA — Entitlements, Analytics, Blocking & Moderation (0.11.0)

- Brings the Android feature work that sits *around* the parser across to `web/`,
  following the parser-parity restore below.
- `entitlement.js` mirrors `ProEntitlement`/tier limits/`FoundingAccess`: active and
  in_grace unlock Pro, on_hold/paused/unknown do not, founding and promo read as
  complimentary so the membership card never treats those chefs as subscribers, and
  every check fails closed to Free. Read-only by rule; the client grants nothing.
- Found and fixed by its own test: Kotlin's `getString` returns null for a
  non-string field so a malformed status falls through to `expired`, but JS
  coercion turns `['active']` into `'active'` and would have unlocked Pro. The
  normalizer now reads strictly by type.
- `chef-analytics.js` mirrors `ChefAnalytics.kt`'s vocabulary and its three rules
  (never throws, no-op without Analytics, no personal or recipe content).
  `showPaywall`/`dismissPaywall` are the only entrance/exit, as on Android.
- Deliberately NOT enforced: the video and per-recipe photo caps. Both exist in the
  tier model on both platforms but Android has no call site for either. An earlier
  draft gated them on web and it was reverted before shipping — enforcing on web
  alone would give a Free chef a worse deal in Safari than on their phone.
- Blocking and moderation reporting ported with payloads byte-compatible with
  `firestore.rules` (exact key sets, 500-char reason cap, fixed `open` status).
  Blocked chefs' recipes and comments are hidden from the Community feed and can be
  unblocked from Profile.
- Known gap filed as follow-up: Android consults `isUserBlocked` only in the
  messaging UI, so its Community feed is still unfiltered.
- `npm test` 39/39 (up from 26), including source-text gates asserting the block and
  report payloads still match the rules. Android `:app:testDebugUnitTest` untouched
  and still passing.
- Verified in a browser against live Firebase: loads clean, feed renders, membership
  card/paywall render and dismiss, cloud-recipe gate blocks at 10 for Free not Pro.
  **Not verified:** the signed-in block/unblock/report round trip — needs real
  credentials.
- Still missing versus Android: messaging, push notifications, threaded replies,
  chef search, Second Pass, Live. Nothing deployed. Version unchanged 0.10.6 / 58.

See `PWA_SOCIAL_BILLING_ANALYTICS_0.11.0.md`.

---

# ChefVoice PWA — Parser Parity Restored (0.11.0)

- `web/` was missing from this checkout entirely, not just out of date. Recovered
  the real source (v0.7.0 alpha.3, `chefvoice-pwa@0.3.0`) from a user-supplied
  backup and brought it back into the repo.
- Its JS parser predated roughly fifteen real-device point-release fixes and
  passed 36/56 rows of the current `shared/golden-cooking-corpus.tsv`.
- Rewrote `web/js/cooking-session-parser.js` and `web/js/ingredient-parser.js`
  to port every remaining piece of `CookingSessionParser.kt`/`IngredientParser.kt`
  (determiner-gated `need`, yield-sentence suppression, back-reference rejection,
  trailing-quantity ingredients, segment-aware step collection, scratch/wait/
  quantity corrections, `RecipeCanonicalizer` post-processing, the `chunk` unit
  alias, `cupful`/`tbsp spoon` ASR repairs), staying line-close to the Kotlin
  source so a future fix is easy to port either direction.
- Added `web/tests/golden-corpus.test.mjs` (runs the identical 56-row corpus,
  same row-count guard as Android) and `web/tests/real-device-fixtures.test.mjs`
  (ports the 5 Kotlin fixture tests that assert exact step order and step
  "must NOT contain X" negatives, which the corpus can't express).
- Result: 56/56 corpus rows, 26/26 `npm test`, all 20 pre-existing PWA tests
  unmodified and passing. `RUN_PARSER_GATES.cmd` now runs to completion.
- Explicitly out of scope: the rest of the PWA UI (community/profile/live,
  `app.js`, `firebase-client.js`) is still the v0.3.0 alpha and does not reflect
  Android's newer social/analytics/monetization features. Parser parity only.
- Protected: Android parser, rules, Live/WebRTC, App Check (still OFF), both
  Functions codebases, `transcribeChefVoice` all unchanged. Nothing deployed.
  Version unchanged: 0.10.6 / `versionCode 58`.

See `PWA_PARSER_PARITY_0.11.0.md`.

---

# ChefVoice Android 0.11.0 work — Parser: Ingredient Declarations, Yield Sentences, Back-references

- Deterministic parser fix driven by a real Android nachos capture (0909). Corpus-first
  per `shared/README.md`: three rows added and confirmed failing before any fix.
- **Second Pass was not the defect.** It ran end to end, got a clean Chirp 3 transcript,
  and flagged 6 ingredient + 3 method issues correctly. Re-parsing the *clean* transcript
  still produced garbage - both passes share the parser, so a systematic parser defect
  appears in both and is marked "confirmed" instead of flagged. `SecondPassReviewer.kt`
  is untouched.
- Fix 1: "you're going to need some X" is now an ingredient declaration. `need` had been
  deliberately excluded to protect narration like "what you need to do"; it is now
  admitted only when a determiner follows (`need some|a|an`), so that narration still
  fails. Recovered sour cream, hot sauce and jalapenos, all previously lost.
- Fix 2: yield sentences ("one pack should feed at least two people, maybe three") no
  longer yield ingredients. Bare "serve" deliberately excluded - it is a method verb.
- Fix 3: unmeasured names opening with a back-reference (it/them/this/that/these/those)
  are rejected. Killed the ingredient "It on top of your nachos".
- Regression found and fixed in the same change: making "need some X" yield ingredients
  caused `collectSegmentAwareSteps` to swallow those declarations into the preceding
  method step (the ingredient-continuation branch armed by "sprinkle"). A declaration is
  not a continuation; the branch now skips them. Caught by diffing the full transcript
  against the pre-change parser, not by the corpus - the corpus asserts required step
  substrings and cannot express "this step must NOT contain X", so the guard is a
  dedicated fixture test.
- Real transcript: 8 ingredients / 2 correct -> 6 ingredients / 6 correct, with method
  steps byte-identical to before.
- No existing corpus row weakened or edited; additions only. Corpus guard 52 -> 55.
- Rules, Live/WebRTC, App Check (still OFF), both Functions codebases and
  `transcribeChefVoice` untouched. Nothing deployed.
- Version unchanged: 0.10.6 / `versionCode 58`.
- Status: `:app:testDebugUnitTest` BUILD SUCCESSFUL 31/31 with all 55 corpus rows; 91/91
  node gates. Installed to SM-S938U (debug). Still open: "need your favorite Dorito
  chips, one bag" is a different parse shape and remains lost; PWA half of the corpus
  contract cannot run (no `web/` in this checkout).

See `PARSER_INGREDIENT_DECLARATIONS_0.11.0.md`.

---

# ChefVoice Android 0.11.0 work — Launch Access: 10 Founding Seats (2 Years) + 90 Free Days

- Grants Pro without Play Billing existing. First 10 signups get Pro free for 2 years
  (`source: "founding"`, dated from the grant); everyone after gets Pro free for 90 days from
  signup (`source: "promo"`); both stop at the kill switch.
- Rationale: with no billing integration a paywall can only take features away, and at
  fewer than five users the Free limits would ration the app's own demo to exactly the
  people whose enthusiasm it needs. No gate was disabled or loosened - people are
  simply entitled, through the real entitlement path.
- Adds `chefvoice-billing`, a fourth independently-deployed unit (`billing/functions/`,
  `DEPLOY_BILLING.cmd`, scoped to `--only functions:chefvoice-billing`). `firebase.json`
  `functions` is now an array of two codebases; `DEPLOY_NOTIFICATIONS.cmd` is unchanged.
- Three functions: `grantChefVoiceLaunchAccess` (onDocumentCreated `users/{uid}`),
  `backfillChefVoiceLaunchAccess` (admin onCall, for accounts predating the deploy),
  `endChefVoiceLaunchPromo` (admin onCall, the kill switch).
- Kill switch has two levels: soft (default) stops new grants and lets live 90-day
  promos run out; hard (`revokeActive: true`) also expires them. Founding seats and any
  `source: "play"` entitlement survive both - the revoke filter is an allowlist.
- Entitlement stays server-authoritative and Admin-SDK-written. Nothing fakes a
  purchase; the client still grants itself nothing.
- `firestore.rules` gains one block: `config/{configId}` closed to clients both ways.
  Nothing existing was modified.
- Client: `ProEntitlement` gains source constants, `isFounding`/`isPromo`/
  `isComplimentary`/`daysRemaining()`; `FoundingAccess` mirrors the two numbers for
  copy only. `ProMembershipCard` no longer describes a complimentary chef as a
  subscriber or warns them about a payment method they never entered.
- Protected parser and golden cooking corpus, Second Pass semantics, gating model,
  `chefvoice-notifications`, `transcribeChefVoice`, Hosting, Storage rules,
  Live/WebRTC and App Check state (still OFF) are all unchanged.
- Version intentionally NOT bumped: stays 0.10.6 / `versionCode 58`.
- Status: `:app:testDebugUnitTest` BUILD SUCCESSFUL 31/31 with the golden corpus
  unaffected; 89/89 node gates (74 notification + 15 new billing); 25/25 emulator rules
  tests (21 existing + 4 new). **Nothing is deployed and the trigger has never fired** -
  `DEPLOY_BILLING.cmd` is unrun, the `config` rules block is undeployed, and no admin
  custom claim has been verified.

See `LAUNCH_ACCESS_FOUNDING_AND_PROMO_0.11.0.md`.

---

# ChefVoice Android 0.11.0 work — Product Analytics Instrumentation

- Work Item D of the monetization handoff. Instrumentation only: no user-visible
  change, no behaviour change, no new gating.
- Adds `com.google.firebase:firebase-analytics` (BoM-managed) and
  `analytics/ChefAnalytics.kt`, a single object owning the event vocabulary and every
  emission.
- Events wired: `first_recipe_started`, `first_recipe_completed` (the activation
  metric), `second_recipe_completed`, `second_pass_opened`, `second_pass_accepted`
  (with `kind`), `paywall_shown` (with `trigger`), `paywall_dismissed`.
- Billing events (`checkout_started`, `purchase_completed`, `subscription_cancelled`,
  `billing_failure`) are declared but have no emitter — there is no Play Billing
  integration yet. The names are fixed now so the vocabulary does not drift.
- `install` is deliberately not emitted: Firebase Analytics logs `first_open`
  automatically with campaign attribution, and a custom duplicate would double-count
  installs in every funnel built on it.
- The module never throws, is a no-op when Firebase is not configured, and sends no
  personal or recipe content — no titles, transcripts, ingredients, names, emails,
  uids or purchase tokens.
- Only behavioural edit: `runSecondPass` and `publish` assigned `paywallTrigger`
  directly, bypassing `showPaywall`. Both now route through it so `paywall_shown`
  cannot be missed. Behaviour-preserving — same trigger strings, now from the
  `PaywallTrigger` constants rather than repeated literals.
- Protected parser and golden cooking corpus, Second Pass semantics, Firestore and
  Storage rules, Live/WebRTC, App Check state (still OFF), `transcribeChefVoice` and
  the `chefvoice-notifications` codebase are all unchanged. Nothing was deployed.
- Version intentionally NOT bumped: stays 0.10.6 / `versionCode 58`, matching the two
  monetization commits before it. 0.11.0 is not shippable without billing, and the
  four `versionCode 58` pins in `notifications/*.test.js` still hold.
- Status: compiles, `:app:testDebugUnitTest` and the golden cooking corpus pass.
  **Not yet verified on a real device** — the events still need a Firebase DebugView
  run to confirm they arrive with the right parameters.

See `ANALYTICS_INSTRUMENTATION_0.11.0.md`.

---

# ChefVoice Android v0.10.6 — Account Deletion Re-auth + Web Deletion Resource

- Policy fix only, shipped standalone (not bundled with feature work).
- Fixes in-app account deletion: the backend's `auth_time` freshness gate was
  already correct, but the client had no way to re-prove identity when it fired —
  only a hint to fully sign out and back in. Now shows an inline password
  re-authentication prompt that forces a fresh ID token and retries.
- Adds the Play-required web account-deletion page, live at
  `https://chefvoice-delete-account.web.app/`, calling the same
  `deleteChefVoiceAccount` callable Android uses — one deletion implementation, two
  front doors. It deploys to a dedicated Hosting site pinned in `firebase.json`; the
  default site still serves the PWA and must not be overwritten by a hosting deploy.
- Adds a release-signing guard in `app/build.gradle.kts`: release packaging tasks now
  throw when the `CHEFVOICE_RELEASE_*` environment variables are missing, instead of
  silently producing an unsigned artifact.
- Backend deletion sweep (recipes/media, social edges, Storage prefixes, Auth user)
  was audited and found already complete; untouched.
- Protected parser, Second Pass, Live/WebRTC, App Check, and all Firestore/Storage
  rules are unchanged.
- Version: 0.10.6 (`versionCode 58`).
- Account deletion required three independent fixes, not one: the client re-auth
  path (app), deploying `firestore.indexes.json` for the sweep's collection-group
  queries (it had never been deployed - `firebase.json` had no `indexes` key), and
  granting `roles/firebaseauth.admin` to the Functions runtime service account so
  `getAuth().deleteUser()` could succeed. Adds `DEPLOY_FIRESTORE_INDEXES.cmd`.
- Status: compiles, unit tests and golden cooking corpus pass, notification gates
  pass. **End-to-end account deletion verified on a real S25 from a >10-minute-old
  sign-in: password prompt, re-auth, retry, callable success, Auth user gone.**
  A real web-page deletion and the Play Console Data safety form update are the
  only items still outstanding - see `ACCOUNT_DELETION_REAUTH_AND_WEB_0.10.6.md`.

See `ACCOUNT_DELETION_REAUTH_AND_WEB_0.10.6.md`.

---

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
