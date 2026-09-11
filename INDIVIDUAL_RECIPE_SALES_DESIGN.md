# Individual recipe sales — design draft (Stage 3)

Starting point, not a finished spec. This is `MONETIZATION_REVIEW_2026-09.md`
§9's "Creator transactions... legitimate Stage 3 revenue" and the handoff's
open item: "needs a separate payment rail, Play Billing can't pay creators."
Grounded in the actual repo (`firestore.rules`, `billing/functions/index.js`,
`PLAY_BILLING_INTEGRATION_0.11.1.md`) as of `6d13f25`. Two things below are
recommendations needing James's sign-off before any code gets written — the
payment platform and the purchase surface — everything else follows from
those two once decided.

---

## 1. Why this needs a different rail than `chefvoice_pro`

`chefvoice_pro` and `chefvoice_pro_lifetime` are Play Billing products —
money flows phone → Google → ChefVoice. That works because ChefVoice is the
only payee. Individual recipe sales have a second payee: the recipe's
author. Google Play Billing has no mechanism to split a purchase and pay
part of it to a third party (a ChefVoice creator) — Play's payout API pays
*the app's own developer account*, full stop. Hence "Play Billing can't pay
creators" in the handoff — that's not a gap to engineer around, it's a hard
platform limitation.

## 2. Recommended platform: Stripe Connect, Express accounts

**Recommendation, needs confirmation.** Stripe Connect is purpose-built for
this shape — one platform (ChefVoice), many payees (creators), Stripe
handles the split, the KYC/identity verification per payee, and 1099 tax
reporting in the US. The three Connect account types:

| Type | Who manages what | Fit here |
|---|---|---|
| **Express** | Stripe hosts onboarding + a light dashboard for the creator; Stripe handles KYC/tax forms | **Recommended** — matches "many small individual creators," least integration work, least support burden on ChefVoice |
| Standard | Creator gets a full Stripe dashboard, effectively their own Stripe account | More than a hobbyist recipe creator needs or wants |
| Custom | ChefVoice builds 100% of the onboarding/dashboard UI, owns compliance | Real engineering + compliance cost for no benefit at this scale |

Alternatives considered and set aside: PayPal Payouts (weaker KYC/tax
tooling, worse mobile SDK story), building payouts in-house (compliance
burden — money transmission, KYC, 1099s — that a two-person-equivalent
project should not take on itself). Stripe Connect is the standard choice
for this exact pattern (Etsy-style, Patreon-style marketplaces) and nothing
here is unusual enough to justify a different answer.

## 3. Recommended purchase surface: web (PWA) only, not the Android app

**Recommendation, needs confirmation — this is the one with real compliance
risk if gotten wrong.** Google Play's Payments policy generally requires
digital content that's purchased *and consumed inside* an Android app to go
through Google Play Billing; routing an in-app "Buy this recipe" button to
Stripe checkout instead is the kind of thing that gets an app's Payments
policy flagged, not merely charged a different fee. (Play's own fee
structure changed once already this year per `MONETIZATION_REVIEW_2026-09.md`
§2 — external billing links now carry lower fees in some cases — but that
loosening is about *fees* for apps meeting specific criteria, not a general
license to sell arbitrary digital content via a third-party processor from
inside the app. **Verify current Payments policy text before implementing,
not from this doc** — it's exactly the kind of thing that moves.)

ChefVoice already has a second, independent purchase-capable surface: the
PWA (`web/`, deployed via `DEPLOY_PWA.cmd`). Recommendation: individual
recipe purchases happen there, not in the Android app.

- Android app can show "buy this recipe" as a state (locked/preview content)
  and link out to the web to complete the purchase — same pattern Play
  already tolerates for "reader"-style external purchases, and avoids
  putting a Stripe checkout flow inside the APK's UI surface at all.
- Entitlement is account-scoped, not platform-scoped (same Firebase uid
  either way), so a recipe bought on web unlocks in the Android app
  automatically — no separate sync needed, same as how `users/{uid}/entitlements/pro`
  already works across install types.
- This also sidesteps a second question that would otherwise need
  answering: Apple's equivalent App Store policy, if/when ChefVoice ships
  iOS. Web-only purchase is platform-neutral by construction.

## 4. Proposed architecture (once 2 and 3 are confirmed)

Following the existing pattern of isolated deploy units per CLAUDE.md
("each isolated in their own deploy unit... do not broaden them without
being asked"):

- **New Cloud Functions codebase**, e.g. `chefvoice-marketplace` — separate
  from `chefvoice-billing` (which stays Play-only) and `chefvoice-notifications`.
  Owns: Stripe webhook handler, Connect onboarding link generation,
  checkout session creation.
- **New Firestore collections**, server-write-only like
  `users/{uid}/entitlements/pro` (`firestore.rules:469-472` — `allow write:
  if false`, Admin SDK only):
  - `users/{uid}/purchasedRecipes/{recipeId}` — buyer-side entitlement,
    client-readable-own-only, same shape as the existing entitlement pattern.
  - `users/{uid}/creatorPayouts/{...}` or similar — creator's own Connect
    account status (`onboarded`, `payoutsEnabled`), written only by the
    webhook handler after Stripe confirms.
  - A `stripeCustomers`/`connectAccounts` mapping collection, same role as
    `purchaseTokens/{token}` in `billing/functions/index.js` — Stripe
    webhooks carry Stripe IDs, not Firebase uids, so a lookup table is
    needed the same way it was for Play's purchase tokens.
- **Recipe model addition**: `recipes/{recipeId}` already has `authorId`,
  `isPublic` (`firestore.rules:554-564`). Would need a `priceCents` (or
  `isForSale`) field and a rule change so a non-purchasing, non-owning
  reader's `get`/`list` returns a preview shape rather than the full
  document — this is the part of `validRecipeData`/`ownsExistingRecipe`
  that needs the most careful rules-tests coverage, since it's a new kind
  of partial-visibility rule the current schema doesn't have anywhere else.
- **Second-Pass/media question, unresolved**: is a "recipe" purchase the
  structured ingredients/steps, the private voice/video media, or both? This
  changes the Storage rules surface (`storage.rules`'s `privateVoice/{uid}/{recipeId}/...`)
  and needs a product answer, not an engineering one.

## 5. Open questions — need James's answers before implementation starts

1. **Pricing model**: fixed platform price (like $0.99/recipe) vs
   creator-set price vs tip-jar/pay-what-you-want? Changes the checkout UX
   materially.
2. **What's actually being sold** — see the Second Pass/media question
   above.
3. **Platform fee %** — Stripe itself takes ~2.9%+$0.30 per Connect
   transaction; ChefVoice's own cut on top of that needs a number.
4. **Refund policy** — digital goods refunds are a real support surface at
   any volume; needs a stance before launch, not after the first complaint.
5. **Geographic scope** — Stripe Connect Express has its own supported-country
   list for payouts, narrower than "everywhere Play sells the app." Creators
   outside supported countries can't onboard until Stripe adds them.
6. **Timing relative to the rest of the roadmap** — `MONETIZATION_REVIEW_2026-09.md`
   §8 puts "creator cohort — free" (item 6) and "TURN/SFU, then paid Live"
   (item 7) ahead of this in sequence; individual recipe sales isn't on that
   list at all yet, meaning it's additional scope, not a reordering.

## 6. Not started

No code, no Stripe account, no schema changes. `PLAY_CONSOLE_AND_STRIPE_SETUP_SCRIPT.md`
Part E has the Stripe platform-account setup steps, gated on this doc being
reviewed first.
