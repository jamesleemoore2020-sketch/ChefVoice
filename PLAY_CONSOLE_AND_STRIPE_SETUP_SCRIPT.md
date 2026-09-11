# ChefVoice — Play Console + Stripe Connect setup script

**For:** a Claude chat session with browser tools, driven by James, to execute.
**Not for:** autonomous execution. Every step that touches money, legal terms,
or identity documents is marked **HUMAN** below and must be done by James
directly in the browser — the Claude session should navigate there, read the
screen back to James, and stop.

This script assumes the reader has no memory of prior ChefVoice sessions.
Bring `PLAY_BILLING_INTEGRATION_0.11.1.md` and this file; nothing else is
required to execute Part A–D. Part E (Stripe) depends on a product decision
that's written up separately in `INDIVIDUAL_RECIPE_SALES_DESIGN.md` — read
that first if Part E is in scope for this session.

---

## Part A — Google Play Console: create the subscription product

Sign in to [Google Play Console](https://play.google.com/console) with the
ChefVoice developer account. Go to the ChefVoice app (`com.chefvoice.app`,
project `chefvoice-d7fec`) → **Monetize → Products → Subscriptions**.

1. **Create subscription**
   - Product ID: `chefvoice_pro` — must match exactly, this is a hardcoded
     string in `billing/functions/index.js` (`SUBSCRIPTION_PRODUCT_ID`) and
     `PlayBillingManager.kt`.
   - Name: "ChefVoice Pro" (or similar — this is display-only, no code
     depends on it).

2. **Add base plan: monthly**
   - Base plan ID: `monthly` — exact match, hardcoded in
     `BASE_PLAN_TO_PRODUCT_ID` in `billing/functions/index.js`.
   - Billing period: 1 month.
   - Price: **$6.99 USD**, auto-convert to other currencies at Play's
     default rates (per `MONETIZATION_REVIEW_2026-09.md` §5).
   - Renewal type: auto-renewing.
   - Activate the base plan once created.

3. **Add base plan: annual**
   - Base plan ID: `annual` — exact match, same constant.
   - Billing period: 1 year.
   - Price: **$39.99 USD** (not $49.99 — see `MONETIZATION_REVIEW_2026-09.md`
     §5 for why this was revised down from the original playbook number).
   - Renewal type: auto-renewing.
   - Activate.

4. **Activate the `chefvoice_pro` subscription itself** (a subscription with
   inactive/unactivated base plans won't return offers to `queryOffers()`).

**HUMAN:** none of Part A touches money directly (no card is charged by
creating a product), but review the final price/period/name screen before
hitting Activate — Claude should read the confirmation screen back to you
rather than click Activate on your behalf sight-unseen.

---

## Part B — Google Play Console: create the lifetime product

Same app → **Monetize → Products → In-app products** (this is a *managed
product*, not a subscription — Billing Library 9's
`enableOneTimeProducts()` / `oneTimePurchaseOfferDetailsList` in
`PlayBillingManager.kt` expects this shape).

1. **Create product**
   - Product ID: `chefvoice_pro_lifetime` — exact match,
     `LIFETIME_PRODUCT_ID` in `billing/functions/index.js`.
   - Name: "ChefVoice Pro — Lifetime".
   - Price: **$79.99 USD** (per `MONETIZATION_REVIEW_2026-09.md` §5 — this
     price is explicitly flagged there as a hypothesis to test, not a
     confirmed number).
   - Availability: active, all countries Play defaults to.

2. Activate.

---

## Part C — License Testing (so a test purchase doesn't charge a real card)

Play Console → **Setup → License testing** (or **Users and permissions** on
some console versions — the label moves between Play Console redesigns).

1. Add James's Google account (the one signed into the test device) as a
   **License Tester**.
2. License response: **RESPOND_NORMALLY** (this makes test purchases behave
   exactly like real ones through the full Play Billing + RTDN pipeline,
   just without a real charge — that fidelity is the entire point here,
   since the goal is to verify `verifyChefVoicePurchase` and
   `processChefVoiceRtdn` against real API responses).

**HUMAN:** adding an account as a tester and installing the debug/internal
build to actually purchase with are both fine for Claude to drive
mechanically, but confirm the Google account being added is the right one —
this grants that account the ability to make no-charge test purchases
against this app.

---

## Part D — Test purchase + verification

This is the actual goal per `PLAY_BILLING_INTEGRATION_0.11.1.md`'s "Not
done" section: confirm `verifyChefVoicePurchase` and `processChefVoiceRtdn`
work against a real purchase, not just that they deploy and compile.

1. Install the current debug build on a device signed in as the license
   tester (`BUILD_AND_INSTALL.cmd`, or whatever build the session already
   has installed).
2. Open the paywall. Buttons should now show real prices ("$6.99/mo" etc.)
   instead of "loading price…" — confirms `queryOffers()` found the
   products from Part A/B. If prices still show "loading…" after a few
   seconds, the product/base-plan IDs likely don't match exactly, or
   activation didn't take — go back and check Part A/B before continuing.
3. Purchase the **monthly** plan as the license tester. Play shows a
   "Test card, always approves" checkout — this is expected, not an error.
4. **Check `verifyChefVoicePurchase` fired correctly:**
   - Firebase Console → Functions → `chefvoice-billing` →
     `verifyChefVoicePurchase` → Logs. Look for `"ChefVoice purchase
     verified"` with `status: "active"`.
   - Also confirms the runtime identity: the same logs should show
     `chefvoice-billing-verifier@chefvoice-d7fec.iam.gserviceaccount.com`
     from `logRuntimeIdentity()` — if it shows the default compute service
     account instead, the `serviceAccount` runtime option on that function
     didn't take.
   - Firestore Console → `users/{uid}/entitlements/pro` — should now show
     `status: "active"`, `productId: "chefvoice_pro"`, plan `monthly`.
   - Firestore Console → `purchaseTokens/{token}` — new doc mapping the
     purchase token to this uid.
5. **Check `processChefVoiceRtdn` fired correctly** (this is the one that
   actually needed the IAM grant — see `PLAY_BILLING_INTEGRATION_0.11.1.md`
   "Auth" section):
   - Cancel the test subscription from Play Store → Subscriptions (as the
     tester), or just wait — Play sends an RTDN on purchase, cancellation,
     and renewal.
   - Firebase Console → Functions → `chefvoice-billing` →
     `processChefVoiceRtdn` → Logs. Look for the function invoked without
     throwing, and its own `logRuntimeIdentity()` line — this one should
     show `569377936753-compute@developer.gserviceaccount.com` (its own
     default identity, **not** `chefvoice-billing-verifier` — impersonation
     happens per-API-call, so the runtime-identity log line legitimately
     never shows the impersonated account even when everything is correct).
   - If it throws on the impersonation call specifically, the IAM grant
     from `PLAY_BILLING_INTEGRATION_0.11.1.md` didn't take or was applied to
     the wrong service account — re-run:
     ```
     gcloud functions describe processChefVoiceRtdn --gen2 --region=us-central1 --format="value(serviceConfig.serviceAccountEmail)"
     ```
     and confirm that exact identity holds Token Creator on
     `chefvoice-billing-verifier@chefvoice-d7fec.iam.gserviceaccount.com`.
6. Repeat step 3 for the **annual** base plan and the **lifetime** product
   (separate test purchases — Play doesn't let you "downgrade" a test
   subscription the same way a real one works, so just buy each
   independently as the tester).
7. Report back per-product pass/fail rather than a single "it worked" —
   this is the first real signal on whether the whole pipeline built in
   session 2 is correct, not just well-tested against source text.

**HUMAN:** none — test purchases as a license tester don't charge a card,
this whole part is safe for Claude to drive end-to-end and report results.

---

## Part E — Stripe Connect (only if `INDIVIDUAL_RECIPE_SALES_DESIGN.md` is approved)

This is for the *separate*, not-yet-decided "sell individual recipes"
feature (Stage 3 in `MONETIZATION_REVIEW_2026-09.md` §9) — it has nothing to
do with Parts A–D above, which are for the ChefVoice Pro subscription that's
already built. Do not start this part until James has read
`INDIVIDUAL_RECIPE_SALES_DESIGN.md` and confirmed the approach, since it
recommends a specific platform (Stripe Connect) and purchase surface (web
only, not in the Android app) that are real decisions, not settled facts.

If approved:

1. Go to [dashboard.stripe.com/register](https://dashboard.stripe.com/register)
   and create the ChefVoice Stripe account (business account, not a
   personal one — this is the *platform* account that will onboard
   individual creators as connected accounts under it).
2. **HUMAN — do this step yourself, Claude should not fill it in:**
   business legal name, EIN/tax ID, and bank account/routing number for
   payouts. These are exactly the categories this session is not permitted
   to enter on your behalf (financial credentials, government/tax IDs)
   regardless of who's asking — Claude should navigate to the right screen
   and then hand off.
3. **HUMAN — accept Stripe's Terms of Service yourself** (Claude may read
   the ToS screen back to you, but must not click Accept on your behalf).
4. Once the account exists: Dashboard → **Connect → Get started** → choose
   **Express accounts** (not Standard or Custom — Express is Stripe's
   lowest-friction option for onboarding individual creators, handles KYC
   and 1099 tax reporting for you, and is the standard choice for exactly
   this kind of "many small sellers, one platform" marketplace; Standard
   pushes more Stripe-dashboard access to each creator than ChefVoice
   creators need, Custom pushes the compliance burden onto ChefVoice
   instead of Stripe).
5. Dashboard → **Developers → API keys** — note the publishable key and
   secret key (test mode first). The secret key is a credential: Claude
   should navigate here and tell James it's ready to copy, not read the
   value aloud/into chat, and it must never be pasted into a file this
   session then commits — it belongs in Firebase Functions config /
   Secret Manager, set from James's own terminal, the same way other
   ChefVoice backend secrets are handled.
6. Stop here and report back. Webhook endpoint creation, Connect onboarding
   links for creators, and the actual Cloud Functions codebase for this are
   implementation work that follows the design doc, not console setup.

---

## Summary checklist

- [ ] `chefvoice_pro` subscription created, `monthly` ($6.99) + `annual`
      ($39.99) base plans, both activated
- [ ] `chefvoice_pro_lifetime` in-app product created ($79.99), activated
- [ ] License tester added
- [ ] Paywall shows live prices on-device
- [ ] Monthly test purchase → `verifyChefVoicePurchase` logs + Firestore
      entitlement confirmed
- [ ] `processChefVoiceRtdn` logs confirmed on a cancel/renew event
- [ ] Annual + lifetime test purchases repeated
- [ ] (Only if approved) Stripe platform account + Express Connect enabled,
      test-mode API keys ready to hand off
