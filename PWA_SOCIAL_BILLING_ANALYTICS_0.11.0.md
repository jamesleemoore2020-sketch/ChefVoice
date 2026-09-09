# ChefVoice PWA — Entitlements, Analytics, Blocking & Moderation (0.11.0)

Follows `PWA_PARSER_PARITY_0.11.0.md`, which restored `web/` and brought its
deterministic parser to 56/56 on the shared golden corpus. This round brings
across the Android feature work that sits *around* the parser.

## Pro entitlements (`web/js/entitlement.js`)

Mirrors `ProEntitlement`, `FreeTierLimits`, `ProTierLimits` and `FoundingAccess`
from `Models.kt`, plus the gating getters from `ChefAppState.kt`:

- `active` and `in_grace` unlock Pro — grace keeps access while Play retries a
  failed card, since pulling features there turns a recoverable failure into a
  cancellation. `on_hold`, `paused` and any unknown status do not.
- Founding and promo grants are surfaced as *complimentary*, so the membership
  card never calls those chefs subscribers, offers to manage a subscription they
  do not have, or warns them about a payment method they never entered.
- Every check fails closed to Free: signed out, offline, and a failed
  entitlement read all read as Free.

The entitlement is read-only to clients by rule (`allow write: if false`);
`observeProEntitlement` in `firebase-client.js` only mirrors what
`chefvoice-billing` already decided. A missing document means Free, not an error.

**One real bug found by its own test.** Kotlin gets type-strictness for free —
Firestore's `getString` returns null for a non-string field, so a malformed
`status` falls through to `expired`. Plain JS coercion does not: `String(['active'])`
is `'active'`, which would have unlocked Pro from a malformed document. The
normalizer now reads fields strictly by type.

## Product analytics (`web/js/chef-analytics.js`)

Mirrors `ChefAnalytics.kt`'s event vocabulary and all three of its rules: never
throws, no-ops when Analytics is unavailable, and never puts personal or recipe
content in a parameter. `first_open` stays Firebase's own — there is no custom
install event to double-count against it.

`showPaywall`/`dismissPaywall` are the only entrance and exit, so `paywall_shown`
cannot be missed by a surface that sets the trigger directly, exactly as on
Android.

## Deliberately NOT enforced

The video and per-recipe photo caps. Both exist in the tier model on both
platforms, but Android has **no call site** for either: it raises a paywall only
for the Second Pass quota, the cloud-recipe cap, and the profile button. An
earlier draft of this work gated both on the web; that was reverted before
shipping, because enforcing them on web alone would give a Free chef a worse deal
in Safari than on their phone for the same account. If these limits should bite,
they need to land on both platforms in one change.

## Blocking and moderation

Ports `setUserBlocked` and `reportContent`. Both write shapes are pinned by
`firestore.rules` (exact key sets, a 500-character reason cap, a fixed `open`
status, a client clock within five minutes of the server's), so the payloads are
kept byte-compatible with the Android originals — a drift is a permission-denied
for the chef at best and a moderation gap at worst.

Blocking is wired into the Community feed, the only social surface the PWA has.
A blocked chef's recipes and comments are hidden, and blocked chefs can be
unblocked from Profile. Firestore rules already stop writes in both directions
between a blocked pair; this is the read half.

**Known cross-platform gap:** on Android, `isUserBlocked` is consulted only in the
messaging UI — the Community feed and comments are not filtered. So a chef blocked
on the web is hidden there but still visible on Android. Hiding *more* was the
conservative direction to take on the web, but the Android side should catch up;
that is filed as a follow-up rather than left implicit.

## Tests

`npm test` in `web/`: **39/39**, up from 26.

- `entitlement.test.mjs` — status/expiry/complimentary semantics, the ceiling
  arithmetic in `daysRemaining`, tier caps, and the malformed-document cases
  (including the one that documents where the web deliberately matches Android's
  looser `expiresAt` handling rather than being stricter).
- `safety-payloads.test.mjs` — source-text gates, in the spirit of
  `billing/launch-access.test.js`, asserting the block and report payloads still
  match `firestore.rules`: key sets, the five accepted target types, the reason
  cap, the fixed initial status, and the no-blocking-yourself check.

Android `:app:testDebugUnitTest` still BUILD SUCCESSFUL; nothing on that side was
touched.

## Verified, and not

Verified in a browser against the live Firebase project: the app loads with no
console errors, the Community feed renders real recipes, the membership card and
paywall render, the paywall dismisses, and the cloud-recipe gate blocks at 10
synced recipes for Free and not for Pro.

**Not verified:** the signed-in round trip for block, unblock and report, which
needs real account credentials. The rule-shape gates are the substitute, and they
are source-text checks — they cannot evaluate a Firestore rule.

## Still missing versus Android

Messaging (DMs), push notifications (needs FCM web push, a VAPID key and service
worker changes), threaded comment replies, follower counts/chef search, Second
Pass re-transcription, and Live/WebRTC (still gated on both platforms).

## Protected surfaces

Parser and golden corpus, Second Pass semantics, Firestore/Storage rules,
Live/WebRTC, App Check (still OFF), both Functions codebases and
`transcribeChefVoice` are unchanged. Nothing was deployed. Version unchanged:
0.10.6 / `versionCode 58`.
