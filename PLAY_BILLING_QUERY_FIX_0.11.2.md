# ChefVoice — Play Billing query fix (0.11.2)

Fixes the reason the paywall never resolved real prices once `chefvoice_pro`
(base plans `monthly`/`annual`) and `chefvoice_pro_lifetime` were actually
created and activated in Play Console: `queryOffers()` in
`PlayBillingManager.kt` was never returning, not even a failing
`BillingResult`.

## Root cause

`queryOffers()` built one `QueryProductDetailsParams` whose product list
mixed a `SUBS` product (`chefvoice_pro`) and an `INAPP` product
(`chefvoice_pro_lifetime`) in the same `setProductList()` call. Play's
billing service enforces that every product in a single query share one
product type and throws `IllegalArgumentException("All products should be
of the same product type.")` when that's violated. Confirmed on-device via
`adb logcat`, filtered to `PlayBillingManager`/`BillingClient`/`Billing`,
across a fresh app relaunch to the paywall:

```
W/BillingClient: Exception while calling onBillingSetupFinished.
W/BillingClient: java.lang.IllegalArgumentException: All products should be of the same product type.
	at za1.g(SourceFile:2)
	...
	at android.os.Binder.execTransact(Binder.java:1454)
```

The exception is thrown inside Play Store's own service, before it can
hand a `BillingResult` back to the app's callback — so `onReady()` in
`PlayBillingManager.kt` never ran, `queryOffers()`'s own `Log.w` on a
non-OK response code never fired either, and the paywall's three buttons
sat on "loading price…" forever. This was a deterministic client bug, not
a Play catalog propagation delay — waiting longer after creating the
products would never have fixed it.

## Fix

`queryOffers()` now issues two separate `queryProductDetailsAsync` calls —
one for `chefvoice_pro`/`SUBS`, one for `chefvoice_pro_lifetime`/`INAPP` —
and merges both results before calling `onReady`, matching Google's own
documented pattern of never mixing product types in one query.

## Also fixed: paywall "Not now" button layout

`ProPaywallDialog`'s `AlertDialog` had the three price buttons
(annual/monthly/lifetime) as a single `confirmButton` `Column`, with "Not
now" passed separately as `dismissButton`. Material3 lays `confirmButton`
and `dismissButton` out together in one row, so the full-width button
column pushed the "Not now" text off to the side of the stack instead of
below it. Moved "Not now" into the same `Column` as the last item (still a
plain `TextButton`, now `fillMaxWidth()` to match) and dropped the
`dismissButton` slot entirely.

## Verified

- `gradlew.bat :app:testDebugUnitTest` — BUILD SUCCESSFUL, 5 suites / 37
  tests, 0 failures/errors, before and after the `AlertDialog` layout
  change.
- On a real device (Galaxy S25 Ultra, `chefvoice_pro` + `chefvoice_pro_lifetime`
  live and activated in Play Console): after uninstalling the
  Play-signed Internal Testing build and sideloading a debug build with
  the fix, the paywall now shows real Play-formatted prices —
  `$39.99/year`, `$6.99/month`, `$79.99 once, forever` — and a clean
  `adb logcat` capture (zero `BillingClient`/`PlayBillingManager` lines,
  where the broken version threw immediately). Confirmed visually on
  device that "Not now" now sits below the three price buttons instead of
  floating beside them.
- Purchase flow itself (`launchPurchase`/`verifyChefVoicePurchase`/
  `processChefVoiceRtdn`) is still unverified against a real test
  purchase — that's Part D of `PLAY_CONSOLE_AND_STRIPE_SETUP_SCRIPT.md`,
  which was blocked on exactly this bug and can now proceed.

## What did not change

`billing/functions/index.js`, `firestore.rules`, `storage.rules`,
`chefvoice-notifications`, and the PWA are all untouched — this is an
Android-client-only fix. Nothing has been (re-)deployed or (re-)uploaded
to Play Console; the Internal Testing track still serves the old, broken
0.11.1 (`versionCode 61`) build until a new signed AAB is built and
uploaded. Version 0.11.1/61 → 0.11.2/62.
