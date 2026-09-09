# ChefVoice — engineering handoff (forward)

Target: **0.10.6** (delete-account hotfix, ship alone) then **0.11.0** (monetization foundation).
Baseline: 0.10.5 / versionCode 57, uploaded to Play Console.

Strategy rationale for everything in §3–§5 lives in `MONETIZATION_REVIEW_2026-09.md`. Read it
before changing prices or tier contents; do not re-litigate them here.

---

## 1. TASK

1. Fix in-app account deletion. It is broken in the shipped 0.10.5 build and it is a Google Play
   User Data policy requirement, not a backlog item.
2. Ship the Play-required **web** account-deletion resource and update the Data safety form.
3. Build server-authoritative subscription entitlement on Play Billing Library 8.
4. Ship ChefVoice Pro at $6.99/month and $39.99/year behind a paywall placed at the Second Pass
   moment.

Ship 1 and 2 as 0.10.6 on their own. Do not bundle a policy fix behind a feature release.

---

## 2. CONTEXT — verified vs. assumed

**Verified by reading the repo at 0.10.5:**

- `notifications/functions/index.js` exports 17 functions. `deleteChefVoiceAccount` exists
  (line ~860), `onCall`, `region: "us-central1"`, `enforceAppCheck: false`,
  `timeoutSeconds: 540`, `memory: "1GiB"`.
- `production-trust.test.js` asserts that `FirebaseSocialRepository.kt` references
  `deleteChefVoiceAccount`, that `ChefVoiceApp.kt` contains the string
  `Confirm permanent cloud deletion`, and that the function body contains `auth_time`. So the
  wiring existed at the source-text level when that gate was written.
- `firestore.rules` line ~394: `match /users/{uid} { ... allow delete: if false; }` — root
  profile deletion is backend-owned. Correct; keep it.
- `app/build.gradle.kts` has **no** billing dependency. compileSdk/targetSdk 36, minSdk 26,
  Firebase BoM 34.17.0, Compose BoM 2026.06.01, Java 17.
- Repo root contains `.git`. `CLAUDE.md` still says "Not a git repository at present" — stale,
  fix it while you are in there.

**Not verified — no shell on this machine and the bridge could not stage them (8 folders deep,
7 is the cap):** `ui/ChefVoiceApp.kt`, `ui/ChefAppState.kt`, `cloud/FirebaseSocialRepository.kt`.
Everything below about client-side behavior is a ranked hypothesis. Confirm before fixing.

---

## 3. WORK ITEM A — account deletion (0.10.6)

### A1. Triage first. Ten minutes, and it decides which fix you write.

Reproduce on-device with `adb logcat` attached, then check the Cloud Functions log for
`deleteChefVoiceAccount` in the same window.

| Observation | Conclusion |
|---|---|
| No invocation logged at all | Client never reached the network → **H4** or **H3** |
| Invocation logged, throws `failed-precondition` | **H1** — the re-auth gate |
| Invocation logged, runs long, client gives up first | **H2** — timeout mismatch |
| Invocation logged, completes `ok: true`, UI unchanged | **H5** — post-delete navigation |

### A2. Ranked hypotheses

**H1 — the `auth_time` freshness gate rejects essentially every real user.** Most likely.

```js
const authTimeSeconds = Number(request.auth.token?.auth_time || 0);
if (!authTimeSeconds || Date.now() - authTimeSeconds * 1000 > 10 * 60 * 1000) {
  throw new HttpsError("failed-precondition", "For your security, sign in again ...");
}
```

`auth_time` is the time of the last *interactive sign-in*, not the last token refresh. The
Firebase Android SDK refreshes ID tokens silently forever without changing it. So this passes in
a fresh test session and fails for every user who signed in more than ten minutes ago —
which, in production, is everyone.

The gate itself is correct and should stay. What is missing is the client half. Required
behavior:

1. Call the function.
2. Catch `FirebaseFunctionsException` with code `FAILED_PRECONDITION`.
3. Drive a re-authentication flow — `FirebaseUser.reauthenticate(credential)` for
   email/password, or the provider-appropriate equivalent.
4. **Force a token refresh after re-auth** (`user.getIdToken(true)`). `auth_time` only reaches
   the callable on a freshly minted token; skipping this reproduces the same failure.
5. Retry the callable once.

Surface every other error code as visible text. A silent `catch` on a destructive action is the
actual defect here regardless of which hypothesis wins.

**H2 — client callable timeout is shorter than the function's.** Likely to co-occur with H1.

The function is provisioned for 540s. The Firebase Android callable default is 70s (verify
against your Firebase BoM). Any account with real content will exceed 70s, because
`deleteUserLikes` does this:

```js
let query = db.collection("recipes").orderBy(FieldPath.documentId()).limit(DELETE_BATCH_SIZE);
```

That is a **full scan of the entire global `recipes` collection**, 200 documents per page, on
every account deletion — a defense-in-depth sweep for legacy clients whose per-user like mirror
never existed. It is O(all recipes on the platform), not O(this user's likes). It is survivable
today and will not be at 50,000 users.

Fix in two parts:
- Client: `httpsCallable("deleteChefVoiceAccount").setTimeout(9, TimeUnit.MINUTES)`, and show
  determinate progress. Deletion is not an instant operation and the UI should not pretend it is.
- Backend: make deletion resumable. Write a `users/{uid}/privateOperations/accountDeletion`
  progress document, have the callable advance through phases idempotently, and let a retry pick
  up where it stopped. The existing per-phase helpers are already idempotent, so this is
  bookkeeping, not a rewrite.
- Separately: gate the legacy full-scan sweep behind a flag or a `likeMirrorVersion` field on the
  user doc, so accounts created after the mirror existed skip it entirely.

**H3 — the function is not deployed.** Cheap to rule out: `firebase functions:list`. If
`deleteChefVoiceAccount` is absent, the last `DEPLOY_NOTIFICATIONS.cmd` predates it and the
client is getting `NOT_FOUND`. Redeploy the `chefvoice-notifications` codebase only.

**H4 — the coroutine is cancelled when the confirm dialog dismisses.** Very plausible, and it
matches "pressed the button and nothing happened after that" exactly.

If the confirm handler is `rememberCoroutineScope()` inside the dialog composable and the dialog
is dismissed on click, the scope leaves composition and the job is cancelled before the callable
returns — no error, no result, nothing. Launch account deletion from an app-level scope
(`ChefAppState`), keep a `deletionInProgress` state flag, and render a blocking, non-dismissible
progress surface until it resolves.

**H5 — deletion succeeds, the UI does not react.** Check the Firebase Auth console for the UID
after a failed attempt. If it is gone, the server side is fine and the bug is that nothing
observes `FirebaseAuth.AuthStateListener` / the callable result to sign out and navigate home.

### A3. Play compliance work that ships with the fix

- **Web deletion resource.** Play requires a web-accessible deletion path for users who have
  uninstalled. You already have Firebase Hosting configured (`firebase.json`,
  `WEB_FIREBASE_STATUS.md`). Add a `/delete-account` page: sign in, confirm, call the *same*
  `deleteChefVoiceAccount` callable. One deletion implementation, two front doors. Do not write
  a second deletion path.
- **Data safety form.** Add the deletion URL in Play Console. Confirm the app account deletion
  questions are answered.
- **Tell the user what deletion does not do.** Deleting a ChefVoice account does **not** cancel a
  Google Play subscription — that lives on the Google account. Once 0.11.0 ships, the confirm
  dialog must say so and deep-link to Play's subscription management. Getting this wrong produces
  people paying for an account that no longer exists.
- **Deletion scope must include billing data.** When 0.11.0 lands, add the new subcollections to
  the sweep list in `deleteChefVoiceAccount`:

```js
for (const name of ["bookmarks", "blocks", "messageReads", "notifications",
  "notificationDevices", "settings", "privateOperations", "storageUploadPermits",
  "following", "followers", "likes", "entitlements", "purchases"]) {
```

  Purchase tokens are payment data and are in scope for the deletion requirement. Extend
  `production-trust.test.js` with an assertion on that list so it cannot silently regress.

---

## 4. WORK ITEM B — entitlement infrastructure (0.11.0)

### B1. Non-negotiable architecture

Entitlement is **server-authoritative**. This is not a preference; it is consistency with how
this codebase already works — backend-owned social counters, callable-owned deletion,
`allow delete: if false` on root profiles. A client-writable `isPro` boolean would be the only
security-relevant thing in the app the client controls, and it would be trivially patched.

```
users/{uid}/entitlements/pro
  status        "active" | "in_grace" | "on_hold" | "paused" | "expired"
  productId     "chefvoice_pro_monthly" | "chefvoice_pro_annual"
  expiresAt     epoch millis
  autoRenewing  bool
  source        "play"
  updatedAt     epoch millis
```

Rules — read-your-own, write nobody:

```
match /entitlements/{entitlementId} {
  allow read: if signedIn() && request.auth.uid == uid;
  allow write: if false;
}
```

Written only by the Admin SDK. Add a `rules-tests/firestore-rules.test.js` case proving a signed-in
client cannot write its own entitlement.

### B2. Client

- `com.android.billingclient:billing-ktx:8.x` — **version 8 is the Play minimum for new apps and
  updates as of 2026-08-31**, and that date has passed. Do not start on 7.
- Products: `chefvoice_pro_monthly` ($6.99), `chefvoice_pro_annual` ($39.99). Base plans +
  offers, not legacy SKUs.
- On purchase: acknowledge within 3 days or Play auto-refunds. Acknowledge from the backend
  after verification, not from the client.
- Implement `queryPurchasesAsync` on every app start and on resume — this is "restore purchases"
  and its absence generates support mail.
- The entitlement the UI reads is always the Firestore document, never the local purchase cache.
  Local purchases are an input to verification, not a source of truth.

### B3. Backend — a new isolated codebase

Follow the existing deploy-isolation discipline. Do **not** add billing to
`chefvoice-notifications`. Create `billing/functions/` as a `chefvoice-billing` codebase with its
own `DEPLOY_BILLING.cmd`, scoped exactly like `DEPLOY_NOTIFICATIONS.cmd`. Nothing in this work
touches `transcribeChefVoice`, Hosting, Storage rules, App Check, or the parser.

Two entry points:

1. `verifyChefVoicePurchase` — `onCall`. Takes a purchase token, verifies it against the Google
   Play Developer API (`purchases.subscriptionsv2.get`), writes the entitlement document,
   acknowledges the purchase.
2. `onChefVoicePlayNotification` — Pub/Sub trigger for **Real-time developer notifications**.
   This is what keeps entitlement correct when renewals, cancellations, refunds, grace periods
   and holds happen while the app is closed. Without RTDN, entitlement drifts and you will be
   refunding people manually.

Handle every RTDN type explicitly, especially `SUBSCRIPTION_IN_GRACE_PERIOD`,
`SUBSCRIPTION_ON_HOLD`, `SUBSCRIPTION_RECOVERED`, `SUBSCRIPTION_REVOKED` and
`SUBSCRIPTION_EXPIRED`. **31% of Play cancellations are billing-failure related** — grace and
hold handling is worth more revenue than any paywall copy test, and both require RTDN.

### B4. RevenueCat — the alternative, honestly

RevenueCat is free to roughly $2,500 monthly tracked revenue, then about 1% (verify current
terms). It gives you receipt validation, RTDN handling, grace/hold state and subscription
analytics without writing §B3.

The trade-off is real in both directions. You are one person; §B3 is genuinely a week of work
including the Play Developer API service account and Pub/Sub plumbing, and getting grace-period
handling subtly wrong costs real money. Against that: you already run three isolated Functions
codebases and clearly know how to operate them, and a third-party SDK sitting between you and
your payment data is a dependency on a business you do not control.

**Recommendation: build it yourself (§B3).** The infrastructure already exists here, the volume
that would justify 1% is far away, and entitlement is exactly the kind of thing this codebase has
consistently kept server-owned. Take RevenueCat only if §B3 is still unfinished after two weeks —
shipping a paywall matters more than owning the plumbing.

---

## 5. WORK ITEM C — Pro tier and paywall (0.11.0)

### C1. Gating

Never attach the word "unlimited" to a feature with a per-unit cloud cost. `authorizeChefVoiceStorageUpload`
already permits 20 GiB/user/month and 200 MB per video slot across 24 slots — 4.8 GB from a single
recipe. Cumulative storage on one heavy user passes the net revenue of a $6.99 subscription inside
a year. See `MONETIZATION_REVIEW_2026-09.md` §6 for the arithmetic.

| | Free | Pro |
|---|---|---|
| Local recipes | Unlimited | Unlimited |
| Cloud-synced recipes | 10 | Unlimited (fair-use cap, documented) |
| Media per recipe | 1 photo, no video | Video slots unlocked |
| Second Pass review | 2 / month | 30 / month |
| Private recipes, collections, export/print | — | Yes |
| Community browse, post, follow, join Live | Yes | Yes |

Gate cloud sync rather than recipe count. Local recipes cost nothing and feed the sharing loop
the whole growth model depends on; cloud recipes cost storage. Gate what costs money, keep what
drives growth free.

Wire the Second Pass allowance into the **existing** v0.10.0 Second Pass quota mechanism. Do not
build a second quota system beside it.

### C2. Paywall placement

Primary trigger: **the first time a user opens Second Pass and sees the diff.** That is the
moment they understand the app caught something they missed, and it is unique to ChefVoice. Word
it as capability, not restriction:

> Second Pass checks every recipe against your original audio. Two free each month — unlimited
> review with ChefVoice Pro.

Secondary: creating a private collection; hitting the cloud-sync limit; attaching video. Do not
show a paywall during onboarding or before the first recipe is saved.

### C3. Subscription hygiene — none of this is optional

- In-app "Manage subscription" that deep-links to Play. Required.
- Restore purchases on every launch.
- Grace period and account hold messaging in-app, driven by the entitlement `status` field.
- Price shown from `ProductDetails`, never hard-coded — Play localizes and you will otherwise
  display the wrong currency.
- Entitlement checks fail **closed to Free**, never to Pro, and never block the deterministic
  parser or local recipe access. A billing outage must not stop someone cooking.

---

## 6. WORK ITEM D — analytics (0.11.0, do it first)

None of the experiments in the playbook can run without this, and retrofitting event
instrumentation after a paywall ships means the first month of paywall data is unusable.

Minimum event set: `install`, `first_recipe_started`, `first_recipe_completed`,
`second_recipe_completed`, `second_pass_opened`, `second_pass_accepted`, `paywall_shown`
(with trigger), `paywall_dismissed`, `checkout_started`, `purchase_completed`,
`subscription_cancelled`, `billing_failure`.

`first_recipe_completed` is the activation metric and the one that makes every acquisition dollar
worth more. Instrument it before anything else.

---

## 7. DECISIONS ALREADY MADE — do not reopen without new evidence

- **Price: $6.99/month, $39.99/year.** Annual moved down from the playbook's $49.99; reasoning in
  the review, §5.
- **Creator tier is deferred.** Its headline feature is Live hosting, and Live is peer-to-peer/STUN
  with no TURN or SFU. Do not sell a tier whose marquee capability rests on transport you have
  described as not production-ready. Give creator profiles and analytics away free to the first
  cohort instead.
- **Play Billing 8**, not 7. The 7 deadline has passed.
- **Entitlement is server-authoritative**, written only by Admin SDK.
- **Billing lives in its own Functions codebase**, deployed by its own scoped script.
- **The deterministic parser, Second Pass reviewer, Live transport, App Check state and
  `transcribeChefVoice` are untouched by all of this.** If a change to monetization appears to
  require touching the parser, the design is wrong — stop and re-plan.

---

## 8. RULED OUT

- **App Check as the delete-account cause.** `deleteChefVoiceAccount` is `enforceAppCheck: false`
  and enforcement is off platform-wide. Not it. Do not turn App Check enforcement on as a side
  effect of this work.
- **Removing the `auth_time` gate to make deletion work.** It is a correct protection on an
  irreversible destructive action. Build the re-auth flow instead.
- **A separate deletion implementation for the web page.** One callable, two front doors.
- **Client-side entitlement caching as the source of truth.** Cache for offline UX if you must;
  never for authorization.
- **Display ads.** They cannibalize the subscription funnel at exactly the scale where you have
  too little traffic for ads to pay.
- **External web checkout in 0.11.0.** Now permitted in the US/UK/EEA and worth 5 points, but it
  is a second checkout, a second refund path and a second support surface. Revisit at volume.

---

## 9. GOTCHAS

- Release signing is conditional on the four `CHEFVOICE_RELEASE_*` env vars. Unset → Gradle
  silently skips signing and still reports BUILD SUCCESSFUL, producing an **unsigned** AAB.
  Build only from the PowerShell session holding those vars. The `doFirst` guard that throws when
  signing is unconfigured is still unwritten — write it as part of 0.10.6.
- Keystore password was exposed in chat and rotation is still pending. Requires both
  `-storepasswd` and `-keypasswd`, then updating the env vars. Migrate to a gitignored
  `keystore.properties` while you are there.
- `app/build/` is generated; the `.aab` vanishes on `clean`.
- Mapping auto-embeds in the AAB (AGP 4.1+); no manual upload.
- `RUN_PARSER_GATES.cmd` fails at the PWA step because there is no `web/` directory in this
  checkout. Expected. Do not recreate `web/`.
- `RUN_RULES_GATES.cmd` needs the Firebase CLI and the Firestore emulator.
- Each backend deploy script is deliberately narrow. Do not broaden one to save a step.
- `CLAUDE.md` says the repo is not under git; `.git` exists. Fix the doc.
- Version convention: bump `versionName`/`versionCode` in `app/build.gradle.kts` and add a
  same-named root-level `*.md` writeup that states what changed **and what did not** — explicitly
  naming the parser, rules, Live and App Check surfaces as untouched.

---

## 10. ACCEPTANCE

**0.10.6 ships only when, on a real device:**

- Account deletion from a session signed in more than 10 minutes ago completes, or shows a
  visible re-auth prompt that then completes.
- Every failure mode shows the user something. No silent catch on a destructive action.
- Firebase Auth console confirms the UID is gone; `users/{uid}` is gone; Storage prefixes
  `profiles/`, `privateVoice/`, `recipes/` for that UID are empty.
- The Hosting `/delete-account` page completes a deletion end to end for a signed-out user.
- Data safety form updated with the deletion URL.

**0.11.0 ships only when:**

- A rules test proves a signed-in client cannot write `users/{uid}/entitlements/pro`.
- A licence-tester purchase grants Pro, and a cancellation removes it via RTDN without the app
  being opened.
- Grace period and account hold each drive the correct in-app state.
- Restore purchases works on a reinstall.
- Account deletion removes `entitlements` and `purchases`, with a `production-trust.test.js`
  assertion covering the sweep list.
- `gradlew.bat :app:testDebugUnitTest` and the golden cooking corpus pass unchanged. The parser
  is not part of this work and its output must be byte-identical.

---

## 11. OPEN

- Play review outcome for the 0.10.5 microphone FGS declaration — unverified, no Play Console
  access from here.
- Whether `deleteChefVoiceAccount` is actually deployed in the live `chefvoice-notifications`
  codebase. `firebase functions:list` answers it in one command.
- 0.10.3 / 0.10.4 changelog contents — still unknown.
- Whether background Live broadcast ships in 0.11 — product decision, and now coupled to whether
  a paid Creator tier is ever sold on Live.
- Exact Chirp 3 per-minute rate for the Second Pass SKU. The 30/month Pro allowance in §C1 is a
  placeholder until that number is pulled from the actual GCP bill.
