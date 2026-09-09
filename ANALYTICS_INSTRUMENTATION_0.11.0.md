# ChefVoice 0.11.0 — Product analytics instrumentation

Work Item D of the monetization handoff. Instrumentation only: no user-visible change,
no behaviour change, no new gating.

Version is deliberately **not** bumped. This stays at versionCode 58 / `0.10.6`, matching
the two monetization commits before it. 0.11.0 is not shippable — there is no Play
Billing integration — and bumping the version now would assert a release that does not
exist, as well as breaking the four `versionCode 58` pins in `notifications/*.test.js`.
The bump belongs to the commit that makes 0.11.0 actually releasable.

## Why this went first

A paywall conversion rate is only interpretable against a baseline, and a baseline
cannot be reconstructed after the fact. Shipping the paywall before the events would
have made the first month of paywall data unusable — the one month where the funnel is
most worth reading. The handoff called this out (§6, "do it first"); the paywall UI
already existed at the point this landed, so this closes a gap that was already open.

## What was added

`app/src/main/java/com/chefvoice/app/analytics/ChefAnalytics.kt` — a single object that
owns the event vocabulary and every emission. One file, no DI, matching how the rest of
the app is wired.

Dependency: `com.google.firebase:firebase-analytics`, BoM-managed (34.17.0), added
beside the other Firebase artifacts in `app/build.gradle.kts`.

### Three properties the module holds to

1. **It never throws and never blocks.** Every call is wrapped in `runCatching` and every
   failure is swallowed. The rule that a billing outage must not stop someone cooking
   applies to telemetry with more force, not less: analytics is the least important thing
   in the app and must never be able to take the app down.
2. **It is a no-op when Firebase is absent.** `app/build.gradle.kts` applies the
   google-services plugin only when `google-services.json` exists, so a checkout without
   it has to build and run. Guarded through `FirebaseApp.getApps`, the same way
   `FirebaseSocialRepository` guards itself.
3. **No personal or recipe content leaves the device.** Parameters are enums and counters
   only — never a recipe title, transcript, ingredient, display name, email or uid. The
   recorded cooking audio and the transcript derived from it are the chef's; nothing
   drawn from them belongs in an analytics event. The billing helpers take a Play
   product id and never a purchase token, which is payment data.

## Events and where they fire

| Event | Fires at | Notes |
|---|---|---|
| `first_recipe_started` | `startCookingCapture()`, `ChefVoiceApp.kt` | Only after `sessionCapture.start()` returns true. A denied microphone permission is not a chef who began narrating. Once per install. |
| `first_recipe_completed` | `onSaved` from `CreateRecipeScreen`, `ChefVoiceApp.kt` | **The activation metric.** Once per install. |
| `second_recipe_completed` | same call site | Once per install. |
| `second_pass_opened` | `runSecondPass()`, `ChefAppState.kt` | After every gate, at the point the upload actually starts. |
| `second_pass_accepted` | `acceptSecondPassIssue` / `acceptSecondPassMethodIssue` | Per accepted suggestion, with `kind` = `ingredient` \| `method`. |
| `paywall_shown` | `showPaywall()`, `ChefAppState.kt` | Carries `trigger` (`second_pass`, `cloud_limit`, `video`, `profile`). |
| `paywall_dismissed` | `dismissPaywall()`, `ChefAppState.kt` | Carries the trigger the chef actually saw. |

Two design choices worth keeping:

- **Completions are counted, not flagged.** `recipeCompleted()` increments a stored
  counter and emits on transition to 1 and 2. Two independent booleans could fire out of
  order or twice; a counter cannot.
- **The paywall has one entrance and one exit.** `runSecondPass` and `publish` previously
  assigned `paywallTrigger` directly, bypassing `showPaywall`. Both now route through it,
  so `paywall_shown` cannot be missed by a surface that sets the field itself. This is the
  only behavioural edit in the change, and it is behaviour-preserving — the same trigger
  strings, now taken from the `PaywallTrigger` constants instead of repeated literals.

## What is declared but not emitted

`checkout_started`, `purchase_completed`, `subscription_cancelled` and `billing_failure`
exist as constants and typed helpers with no callers. There is no Play Billing
integration and no billing Functions codebase, so there is nothing honest to wire them
to yet. Naming them now fixes the vocabulary so it does not drift when Work Item B
lands; the billing work calls these rather than inventing its own.

## `install` is deliberately not emitted

The handoff's minimum event set names `install`. Firebase Analytics already logs
`first_open` automatically on the first launch after an install, and it carries campaign
attribution that a hand-rolled event cannot reproduce. Emitting a custom `install`
alongside it would double-count installs in every funnel built on top of it. Use
`first_open`. This is the one place the implementation departs from the handoff's list,
and it is a correction rather than a gap.

## What did NOT change

- **The deterministic parser is untouched.** No file under `voice/` was modified.
  `CookingSessionParser`, `IngredientParser`, `IngredientNormalizer`,
  `IngredientReviewClassifier`, `RecipeCanonicalizer` and `SecondPassReviewer` are
  byte-identical, and `shared/golden-cooking-corpus.tsv` is unchanged. No analytics call
  sits anywhere in the parse path — the events are attached to UI and app-state
  transitions only.
- **Second Pass behaviour is unchanged.** The quota, the gating, the diff and the
  accept/reject semantics are exactly as before; the accept paths gained one emission
  each after the recipe was already saved.
- **Firestore and Storage rules are untouched.** No rules file was edited and nothing was
  deployed. Analytics writes to Google Analytics, not to Firestore.
- **Live / WebRTC is untouched.** No signaling, lease or transport code was modified.
- **App Check is untouched and enforcement stays OFF.** Adding an analytics SDK does not
  change App Check state and nothing here enables it.
- **`transcribeChefVoice` and the `chefvoice-notifications` codebase are untouched.** No
  Cloud Function was edited and nothing was deployed.
- **No entitlement or gating logic changed.** `isPro`, `FreeTierLimits`, `ProTierLimits`,
  `cloudRecipesRemaining`, `secondPassRemaining` and `videoAllowed` all behave identically.

## Verification

- `gradlew.bat :app:testDebugUnitTest` — compiles and passes, golden cooking corpus
  included and unaffected.
- No unit test was added. The module is a thin, side-effecting wrapper over the Firebase
  SDK whose whole contract is "call through or silently do nothing"; a JVM unit test of it
  would assert the mock, not the behaviour. The value is in on-device DebugView, below.

## Still outstanding

- **Not verified on a real device.** The events need a DebugView run
  (`adb shell setprop debug.firebase.analytics.app com.chefvoice.app`) to confirm each one
  arrives with the right parameters. Nothing here has been seen landing in the console.
- Analytics collection and Google Analytics data sharing are not reflected in the Play
  Console Data safety form, which is already pending an edit for the account-deletion URL.
  Do both in the same pass.
- The billing events have no emitter until Work Item B.
