# ChefVoice — Play Billing integration (0.11.1)

Client + backend wiring for real ChefVoice Pro purchases: `chefvoice_pro`
(subscription, base plans `monthly` $6.99 / `annual` $39.99) and
`chefvoice_pro_lifetime` (managed one-time product, $79.99). Nothing has
been deployed and no product exists in Play Console yet — see "Not done"
below for exactly what's left before this can process a real purchase.

## Android client

New file `app/src/main/java/com/chefvoice/app/billing/PlayBillingManager.kt`
wraps Billing Library 9.1.0 (`com.android.billingclient:billing-ktx:9.1.0`,
added to `app/build.gradle.kts` — it wasn't actually present yet despite
the brief describing it as already there):

- `enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())`
  and `enableAutoServiceReconnection()` (both v9-era APIs — the old
  parameterless `enablePendingPurchases()` is gone in v9).
- `queryOffers()` fetches `ProductDetails` for the subscription (both base
  plans) and the lifetime product, exposing Play-formatted prices.
- `launchPurchase()` sets `setObfuscatedAccountId(uid)` on the flow — this
  is the only link between a Play purchase and a ChefVoice account, and is
  what `purchaseTokens/{token}` on the backend is keyed from later.
- `PurchasesUpdatedListener` and `restorePurchases()` (called on every
  sign-in, not just first install — covers a purchase made on another
  device, or a verify call that never got the chance to acknowledge) both
  funnel into one `verifyAndAcknowledge()`: call `verifyChefVoicePurchase`
  first, acknowledge only after it succeeds. Acknowledging first would let
  a purchase verification later rejects keep looking acknowledged on-device
  with no entitlement behind it.
- The lifetime product is acknowledged, never consumed, per the brief —
  it's a permanent managed product, not something re-purchasable.

Wired into `ChefAppState.kt` following the existing callback-based pattern
(`FirebaseSocialRepository`'s style, not coroutines/Flow): `loadProOffers()`
runs at startup, `startCheckout(productChoice, activity)` is the paywall's
entry point (needs an `Activity`, which `ChefAppState` itself never holds —
`ChefVoiceApp.kt`'s composable passes its own `LocalContext.current as
Activity` in at the call site). `ProPaywallDialog` now shows live Play
prices instead of the hardcoded `DemoPricing` strings and has a third
button for the lifetime option; `ProMembershipCard` gained an
`isLifetime` branch ("nothing to renew, ever"). Buttons show "loading
price…" and stay disabled until `queryOffers()` actually returns —
Play requires showing its own live, region-correct price, not a
hardcoded string.

`ProEntitlement.PRODUCT_LIFETIME` added to `Models.kt` alongside the
existing `PRODUCT_MONTHLY`/`PRODUCT_ANNUAL`. Those two remain the
app-facing identifiers they always were (not raw Play IDs) — see the
backend section below for the base-plan translation this implies.

## Backend (`billing/functions/index.js`)

Two new exports, added `google-auth-library` (11.0.2) as the only new
dependency — deliberately not the full `googleapis` SDK, per the brief:
`GoogleAuth`/`Impersonated` give an authenticated client with a generic
`.request()`, which is enough to call the Android Publisher REST endpoints
directly.

- **`verifyChefVoicePurchase`** (callable): takes `purchaseToken` +
  `productId`, calls `purchases.subscriptionsv2.get` or
  `purchases.products.get` depending on which, and writes
  `users/{uid}/entitlements/pro`. Also writes `purchaseTokens/{token} ->
  {uid, productId}` — a new collection, needed because RTDN delivers a
  purchaseToken but has no idea what a Firebase uid is. `uid` here is
  always `request.auth.uid`, never anything the client asserts about
  itself.
- **`processChefVoiceRtdn`** (Pub/Sub-triggered on topic
  `play-billing-rtdn` — already created, granted publish rights to
  `google-play-developer-notifications@system.gserviceaccount.com`, wired
  into Play Console, and confirmed with a successful test notification):
  looks up the uid from `purchaseTokens`,
  then — for everything except a voided-purchase notification — **always
  re-fetches the purchase from the Developer API** and recomputes the
  entitlement from that, rather than branching on `notificationType`. Play's
  own docs are explicit that a notification only signals "something
  changed," not what it changed to; entitlement state (`subscriptionState`,
  `lineItems[].expiryTime`, `autoRenewingPlan.autoRenewEnabled`) is only
  ever trusted from the live API response. A `voidedPurchaseNotification`
  (refund/chargeback) is the one exception — Play does not expect a Developer
  API round trip for that one, so it revokes directly.
- `entitlementFromSubscription` maps a purchased base plan
  (`monthly`/`annual`) to `ProEntitlement.PRODUCT_MONTHLY`/`PRODUCT_ANNUAL`
  — this backend is the one place that translation happens, since Play's
  API only knows about the raw subscription (`chefvoice_pro`) and base plan
  id, not the app's constants.
- Subscription state mapping: `SUBSCRIPTION_STATE_ACTIVE` → active,
  `_IN_GRACE_PERIOD` → in_grace, `_ON_HOLD` → on_hold, `_PAUSED` → paused,
  `_CANCELED` → active-until-`expiryTime`-then-expired (canceling turns off
  auto-renew, it doesn't end the period already paid for), everything else
  (`_EXPIRED`, `_PENDING`, unrecognized) fails closed to expired — matching
  `ProEntitlement.isActive`'s own fail-closed philosophy on the client.

## Auth: one deviation from the brief, with a documented reason

The brief asked for both functions to *run as*
`chefvoice-billing-verifier@chefvoice-d7fec.iam.gserviceaccount.com` via
the 2nd-gen `serviceAccount` runtime option — reasonable, since there's no
JSON key and can't be (`iam.disableServiceAccountKeyCreation`). That's
exactly what `verifyChefVoicePurchase` does (it's an `onCall`, which the
option is known to work for).

`processChefVoiceRtdn` does **not** — it stays on its default runtime
identity and impersonates `chefvoice-billing-verifier` for just the one
Android Publisher API call instead
(`GoogleAuth` → `getClient()` → `Impersonated({ targetPrincipal, targetScopes, lifetime: 300 })`).
Reason: it is a Pub/Sub (EventArc) trigger, and setting a custom runtime
service account on a 2nd-gen EventArc trigger has a **currently open**
firebase-tools bug
([#6814](https://github.com/firebase/firebase-tools/issues/6814)) where
deploy tries to grant the EventArc invoker role to the project's *default*
compute service account and fails outright if that account has been
removed or disabled — plausible for a project that already has
`iam.disableServiceAccountKeyCreation` set.
[#8841](https://github.com/firebase/firebase-tools/issues/8841) shows the
same class of failure reaching `onCall`/`onRequest` too in some
circumstances, which is the actual reason both functions log their own
runtime identity on every invocation (see next section) rather than
trusting either path blindly.

**This needs one manual, one-time IAM grant that only you can do:** find
`processChefVoiceRtdn`'s own default runtime service account (visible in
Cloud Console → Cloud Functions → that function → its service account
field, after first deploy — or `gcloud functions describe
processChefVoiceRtdn --gen2 --region=us-central1 --format="value(serviceConfig.serviceAccountEmail)"`),
then grant it **Service Account Token Creator** on
`chefvoice-billing-verifier@chefvoice-d7fec.iam.gserviceaccount.com`:

```
gcloud iam service-accounts add-iam-policy-binding \
  chefvoice-billing-verifier@chefvoice-d7fec.iam.gserviceaccount.com \
  --member="serviceAccount:<the-default-identity-from-above>" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Without it, `processChefVoiceRtdn` will deploy fine but every invocation
will fail the impersonation call and throw (which Pub/Sub then retries
forever) — exactly the kind of silent-until-tested failure the identity
logging below exists to catch quickly instead of in production.

## Verifying the identity actually took effect

Both functions call `logRuntimeIdentity()` on every invocation, which
hits `http://metadata.google.internal/.../service-accounts/default/email`
and logs the result. After the first real deploy, trigger each function
once (a real test purchase for `verifyChefVoicePurchase`; Play Console's
"Send test notification" for `processChefVoiceRtdn`) and check Cloud
Logging for that line — `verifyChefVoicePurchase` should show
`chefvoice-billing-verifier@...` directly; `processChefVoiceRtdn` should
show whatever its own default identity is (impersonation happens
per-API-call, not at the runtime-identity level, so this log line will
*not* show `chefvoice-billing-verifier` — that's expected).

## Verified so far

`gradlew.bat :app:testDebugUnitTest` — BUILD SUCCESSFUL, same 3
pre-existing unrelated warnings, no new ones (confirms the Billing Library
9.1.0 API surface used here — `PendingPurchasesParams`,
`enableAutoServiceReconnection`, `oneTimePurchaseOfferDetailsList`,
`ProductDetailsParams`, etc. — is real and compiles). `node --check
billing/functions/index.js` and the full `billing/launch-access.test.js` +
`notifications/` gates (91 tests) all pass with no regressions. Installed
on a physical device — app launches; the actual paywall screen with live
(loading) prices has not yet been walked through by hand on-device.

## Not done

- **Nothing is deployed.** `DEPLOY_BILLING.cmd` has never been run, on this
  change or any earlier one.
- **No product exists in Play Console yet.** Until `chefvoice_pro` (with
  both base plans) and `chefvoice_pro_lifetime` are created, `queryOffers()`
  will return nothing and the paywall's buttons will sit disabled on
  "loading price…" — that's the correct degraded behavior, not a bug.
- **The IAM grant above** — required before `processChefVoiceRtdn` can do
  anything useful, and only doable by whoever administers the project.
- **A real end-to-end purchase test**, which needs License Testing set up
  in Play Console first (so a real purchase doesn't actually charge
  anyone) — not something this session can do without Play Console access.
- **A stale `onChefVoicePlayNotification` function may exist in the live
  project**, deployed by an earlier, separate attempt at this same feature
  (a sibling worktree, branch `claude/android-publisher-adc-auth-fe9407`,
  never merged here) that modeled the product differently (two separate
  subscription products instead of one with two base plans, no lifetime
  product handling at all) and set a custom `serviceAccount` directly on
  its Pub/Sub trigger — exactly the firebase-tools #6814 failure mode this
  file's `VERIFIER_SERVICE_ACCOUNT` comment describes and this codebase
  avoids via impersonation instead. Worth checking the Firebase console
  after this deploys and deleting it if still present, so there isn't a
  second, differently-broken code path receiving the same notifications.

## What did not change

`firestore.rules`, `storage.rules`, `chefvoice-notifications`, the PWA, and
the existing launch-access (founding/promo) logic in
`billing/functions/index.js` are untouched — the new functions are purely
additive to that file, and the launch-access gate (91 tests including the
pre-existing 17) still passes unmodified.
