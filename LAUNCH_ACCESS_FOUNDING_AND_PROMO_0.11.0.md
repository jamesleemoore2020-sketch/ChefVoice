# ChefVoice 0.11.0 — Launch access: 10 founding seats (2 years) + 90 free days

Grants Pro without Play Billing existing. The first 10 signups get Pro free for 2 years; everyone
after gets Pro free for 90 days from signup; both stop when the kill switch is thrown.

Version is deliberately **not** bumped — still versionCode 58 / `0.10.6`, consistent with
the other 0.11.0 work. See `ANALYTICS_INSTRUMENTATION_0.11.0.md` for the reasoning.

## Why this instead of shipping the paywall

There is no Play Billing integration, so a paywall today can only take features away —
there is nothing behind it to buy. And with fewer than five users, the Free limits would
bite exactly the people whose enthusiasm the app needs: 2 Second Pass reviews a month
means the earliest testers might never see the diff more than twice, and that diff is the
thing that makes ChefVoice worth paying for.

So the gating code stays exactly as built and keeps running — it is just that nearly
everyone is entitled to Pro while the app is finding its first users. Nothing is faked
and no gate is disabled.

## Architecture

**A new isolated Functions codebase, `chefvoice-billing`**, in `billing/functions/`,
deployed only by `DEPLOY_BILLING.cmd` (`--only functions:chefvoice-billing`). It does not
share a deploy blast radius with `chefvoice-notifications`, and it is where
`verifyChefVoicePurchase` and the real-time developer notification handler belong when
Play Billing lands. `firebase.json`'s `functions` key is now an array of two codebases;
`DEPLOY_NOTIFICATIONS.cmd` is unchanged and still deploys only its own.

**Entitlement stays server-authoritative.** These are real entitlement documents written
by the Admin SDK to `users/{uid}/entitlements/pro` — the same path, and the same writer,
that a verified Play purchase will use. Nothing fakes a purchase, and the client still
grants itself nothing. A useful side effect: the entire entitlement path is exercised end
to end before any money moves, which de-risks the billing work.

| | `source` | `expiresAt` | Survives kill switch |
|---|---|---|---|
| First 10 signups | `founding` | granted + 730d | Always |
| Everyone after | `promo` | signup + 90d | Soft yes, hard no |
| A real purchase | `play` | from Play | Always — never touched |

Two years is expressed as a flat **730 days**, not calendar arithmetic. A fixed
millisecond span cannot land on a leap day, a DST boundary, or a month with no 31st, and
each of those is a way to compute an expiry that is off by a day for one chef and not
another.

A founding window runs from **the grant**; the 90-day promo runs from **signup**. That
asymmetry is deliberate: the trigger fires moments after signup so the two are identical
for a new account, but the backfill awards seats to people who signed up before this code
existed, and dating their two years from a months-old signup would quietly shorten the
reward for exactly the chefs it is meant to thank. The promo runs from signup because it
is a trial window, not a thank-you.

### Three functions

1. **`grantChefVoiceLaunchAccess`** — `onDocumentCreated("users/{uid}")`. `signUp` writes
   the profile document immediately after `createUserWithEmailAndPassword`, so this fires
   once per real signup. Triggered on the profile document rather than on Auth user
   creation deliberately: a blocking Auth trigger sits in the signup critical path, and a
   failure there breaks account creation itself. A missed grant is recoverable; a broken
   signup is not — which is also why the whole body is wrapped so a grant failure can
   never fail a signup.

2. **`backfillChefVoiceLaunchAccess`** — admin `onCall`. The trigger only fires for new
   profile documents, so accounts that predate the deploy have nothing. This awards
   founding seats in real signup order, oldest first, so "the first 10 signups" stays true
   for people who signed up before the code promising it existed. **Your existing users
   need this run once.**

3. **`endChefVoiceLaunchPromo`** — admin `onCall`. The kill switch, below.

### The kill switch has two levels, because they are different promises

- **Soft (default).** Sets `promoEnabled: false`. No new grants. Anyone already inside
  their 90 days keeps it until it runs out. This is the default because someone told
  "Pro free for 90 days" was told a thing, and ending it early because a price list
  changed is a broken promise for a rounding error of revenue.
- **Hard (`{ revokeActive: true }`).** Also expires every live `promo` grant immediately.
  For when the giveaway itself has to stop, not merely stop growing.

Founding seats are never touched by either — those two years were promised outright, so
they run out only on their own clock. Neither is a `source: "play"` entitlement: the
revoke filter is an allowlist (`source !== "promo"`), so this function structurally
cannot revoke something a person paid for.

### Decisions worth keeping

- **A missing config document means the promo is running.** The codebase deploys and works
  with no manual Firestore setup, and the kill switch is what creates the document. If
  absent meant "grant nothing", a failed console edit would silently switch the promo off.
- **Founding seats are claimed inside the granting transaction**, so two simultaneous
  signups cannot both take seat 10.
- **A grant never overwrites an existing entitlement.** A real purchase always wins over a
  promotional grant, and a retried trigger cannot reset a clock or re-spend a seat.
- **The backfill sorts in memory rather than with `orderBy("createdAt")`.** A Firestore
  orderBy silently excludes documents missing the field, and early profile documents may
  not all carry `createdAt` — skipping exactly the oldest accounts would be the worst
  possible failure for a founding-seat sweep.
- **The revoke sweep uses no collection-group query and needs no new index.** An
  undeployed `COLLECTION_GROUP` field override is precisely what broke account deletion in
  0.10.5. This walks users and reads each entitlement directly; it runs once, by hand.

## Client changes

`ProEntitlement` gained `SOURCE_PLAY` / `SOURCE_FOUNDING` / `SOURCE_PROMO`, `isFounding`,
`isPromo`, `isComplimentary` and `daysRemaining()`. `FoundingAccess` mirrors the seat
count and the two window lengths for display copy only — the backend owns the decision,
and the numbers must be changed in both places together. A gate in
`billing/launch-access.test.js` asserts the two sides agree, so they cannot drift.

`ProMembershipCard` now distinguishes complimentary access from a subscription. A
founding member reads "Pro is free for 2 years — 24 months left. No card, no renewal,
nothing to cancel"; a promo user sees days remaining. Long windows are rendered in months
and short ones in days: "641 days left" is true and useless, while for a 90-day trial the
precision is the point. Neither chef is warned about a payment method they never entered,
and neither is offered a subscription to manage. That mattered enough to change: telling
someone their payment failed when they never gave you a card is the kind of thing that
loses a first user permanently.

## Operating it

```
DEPLOY_BILLING.cmd
```

Then, once, to cover the accounts that predate it — both callables require an `admin`
custom claim, the same claim `moderateChefVoiceReport` already uses:

```
firebase functions:shell --project chefvoice-d7fec
> backfillChefVoiceLaunchAccess({}, {auth: {uid: '<your-uid>', token: {admin: true}}})
```

Seats remaining are in `config/monetization` (`foundingSeatsClaimed` vs `foundingSeats`)
in the Firestore console — closed to clients, readable by you there.

To stop it later: call `endChefVoiceLaunchPromo` with `{}` for the soft stop, or
`{ revokeActive: true }` for the hard one.

## What did NOT change

- **The deterministic parser is untouched.** No file under `voice/` was modified, the
  golden cooking corpus is unchanged, and `GoldenCookingCorpusTest` passes unchanged.
- **The gating model is untouched.** `FreeTierLimits`, `ProTierLimits`, `isPro`,
  `cloudRecipesRemaining`, `secondPassRemaining` and `videoAllowed` all behave exactly as
  before. No gate was disabled or loosened; people are simply entitled.
- **`chefvoice-notifications` is untouched and was not deployed.** No file in
  `notifications/` changed. Its 74 gates pass unchanged.
- **`transcribeChefVoice`, Hosting and Storage rules are untouched.**
- **Live / WebRTC is untouched.**
- **App Check is untouched and enforcement stays OFF.**
- **`firestore.rules` gained one block** (`config/{configId}`, closed both ways) and
  nothing existing was modified. **Not yet deployed** — see below.

## Verification

- `gradlew.bat :app:testDebugUnitTest` — BUILD SUCCESSFUL, 31/31, golden corpus included.
- `node --test` over `notifications/` and `billing/` — 89/89 (74 existing + 15 new).
- `rules-tests` against the Firestore emulator — 25/25 (21 existing + 4 new), proving a
  signed-in client cannot read or write `config/monetization`, cannot forge a `founding`
  entitlement, and cannot extend a `promo` expiry.
- An existing gate caught real copy: the first draft of the promo string contained "for
  **you**r first 90 days", which tripped the guard against a "For You" feed label. The
  copy was reworded; the gate was not weakened.

## Outstanding — none of this has run against the live project

- **Nothing is deployed.** `DEPLOY_BILLING.cmd` has not been run, and the `config` rules
  block is committed but not deployed. A rules deploy replaces the whole ruleset — diff
  local against live first.
- **No admin custom claim has been verified** on your account. The backfill and kill
  switch both refuse without it.
- **The trigger has never fired.** Not observed against a real signup.
- Storage cost exposure: 10 two-year Pro accounts sit against the 20 GiB/user/month
  `authorizeChefVoiceStorageUpload` ceiling, which is unchanged and still the real cost
  cap. Bounded and cheap at this scale, but it is a permanent commitment — see
  `MONETIZATION_REVIEW_2026-09.md` §6.
