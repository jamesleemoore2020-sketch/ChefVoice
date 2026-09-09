# ChefVoice Monetization Playbook — Review and Revision (2026-09-06)

Review of `ChefVoice Monetization Playbook.pdf` against current competitor pricing, current
Google Play economics, published subscription benchmarks, and the actual ChefVoice codebase
at v0.10.5 / versionCode 57.

**What I verified before writing this:** the playbook PDF; `app/build.gradle.kts`; `CLAUDE.md`;
`README.md`; `notifications/functions/index.js` (all 17 exported functions, including
`deleteChefVoiceAccount`, `authorizeChefVoiceStorageUpload` and its quota constants);
`notifications/production-trust.test.js`; `firestore.rules`; and the current Google Play fee,
billing-library and account-deletion policy pages.

**What I could not verify:** `ChefVoiceApp.kt`, `ChefAppState.kt` and `FirebaseSocialRepository.kt`
are eight folders below the connected repo root and the file bridge caps staging at seven, so I
could not read the client-side delete flow, and there is no local shell on this machine for this
session. Every client-side statement below is labeled as a hypothesis, not a finding.

---

## 1. The headline problem: the playbook prices a me-too feature list

The playbook's Pro tier is: unlimited recipes, collections, export, print, shopping lists, meal
planning, cloud backup, advanced search. That is the standard recipe-manager feature list, and
the market has already priced it:

| Product | Price | Notes |
|---|---|---|
| Paprika | $4.99 one-time (mobile) | No subscription at all |
| AnyList | $9.99/yr individual, $14.99/yr household | Free tier covers core organizing |
| ReciMe | $39.99/yr | Free tier: 5 recipe imports/week |
| Plan to Eat | $5.95/mo, $49/yr | |
| Samsung Food+ | $6.99/mo, $59.99/yr | 180,000+ recipe catalog, AI recipe personalization, nutrition tracking, appliance control |

The playbook proposes $6.99/mo — exact parity with Samsung Food+, a product backed by an
appliance manufacturer with a six-figure recipe catalog. ChefVoice cannot win a feature-list
comparison against that, and a shopper doing five minutes of research will make exactly that
comparison.

**The thing the playbook almost never mentions is the only thing ChefVoice has that none of
these have:** the deterministic voice-to-recipe pipeline and Second Pass review against the
original private audio. `CLAUDE.md` calls it "the protected core." The playbook mentions
"unlimited voice recipe capture" once, in a bullet list, between "unlimited recipe creation"
and "larger media storage."

**Revision:** the paid tier is not "the unlimited version of a recipe app." It is *capture
quality*. Second Pass — re-running a returned Chirp 3 transcript through the deterministic
parser and letting the cook accept or reject each difference — is the premium product. It is
the feature nobody else can copy quickly, it is the feature that costs real money to serve
(which makes metering it honest rather than artificial), and it is the feature a serious cook
will actually pay for.

Reposition Pro around: *your recipes come out right.*

---

## 2. Google Play economics changed on June 30, 2026 — the playbook's §20 is out of date

The playbook says "Google currently states that 99% of developers subject to a service fee are
eligible for 15% or less." That framing predates the June 2026 restructure. Current position:

- Auto-renewing subscriptions: **10% service fee**, flat — not tiered, no $1M threshold step.
- Plus a **5% billing fee** when you use Google Play's billing system, in the US, UK and EEA.
- **No billing fee** for alternative billing or external web links.
- Rollout: US/UK/EEA June 30, 2026; Australia/Japan Sept 30, 2026; South Korea Dec 31, 2026;
  rest of world Sept 30, 2027.

Two consequences:

1. Model subscriptions at **85% net**, not 70%. Better than the playbook assumed.
2. There is now a real, sanctioned 5-point lever in taking payment on the web. Do not build for
   it yet — it is a second checkout, a second refund path and a second support surface — but
   note it exists for when ChefVoice has volume worth 5 points.

Separately, and more urgently: **Play Billing Library 8 has been the minimum for new apps and
updates since August 31, 2026** (extensions ran to Nov 1, 2026). That date has passed. Whatever
gets built must be `com.android.billingclient:billing:8.x`. `app/build.gradle.kts` currently has
no billing dependency at all, so this is greenfield — there is nothing to migrate, which is the
one piece of good timing here.

---

## 3. The revenue model in §12 is roughly 2.3x optimistic

The playbook's math: 10,000 MAU × 3% × $6.99 = $2,097/month.

Three problems. It uses a conversion rate against MAU that is closer to a trial-conversion rate,
it ignores the monthly/annual mix, and it is a gross number presented as if it were revenue.

Rebuilt with the same 10,000 MAU:

- Freemium conversion, published 2026 benchmarks: median trial-to-paid at day 35 is **2.1% for
  freemium** vs **10.7% for a hard paywall**. Against monthly actives rather than trial starts,
  1.5–3% is the realistic band. Use 2%: **200 subscribers.**
- Mix matters. At a 60/40 monthly/annual split with annual at $39.99 (see §5), blended monthly
  gross per subscriber is about **$5.52**, not $6.99.
- 200 × $5.52 = **$1,104 gross** → **$938 after Play's 15%** → roughly **$900/month** after
  refunds, before any infrastructure cost.

So: about $900/month at 10,000 MAU, not $2,097.

To reach the playbook's Stage 1 target of $5,000/month **net**, you need roughly **1,070
subscribers**, which at 2% conversion means roughly **53,000 monthly actives**. That is a real
number and it is worth writing down, because it is the difference between "ship a paywall and
wait" and "ship a paywall and go get 50,000 users."

The 100-paying-customers milestone in §11 survives intact and is still the right first goal —
but be clear with yourself that 100 customers is about **$470/month net**. It is a validation
event, not income.

---

## 4. Three things the playbook is missing that will cost more than any paywall copy test

**a) Android billing failures are 31% of cancellations.** On Google Play, 31% of subscription
cancellations are billing-failure related, versus 14% on the App Store. That is roughly a fifth
of your churn arriving as a payment problem rather than a product problem. Play's grace period
and account hold, plus an in-app "your payment didn't go through" recovery prompt that deep-links
to Play's subscription management, is the highest-ROI subscription work you will do, and it
appears nowhere in the playbook.

**b) Annual is not lock-in.** 35% of annual subscribers cancel within month one and roughly 72%
cancel within year one. Sell annual for the cash and the 12-month payment window, not because
you think it retains.

**c) Trial length.** Trials of 17–32 days convert at about 42.5% vs 25.5% for trials under 4
days. If you run a trial, run a long one. A 3-day trial is a cancellation reminder — 84% of
3-day-trial cancellations happen on day 0 or day 1.

---

## 5. Revised pricing

Keep $6.99/month. In this range, price is not what moves conversion; perceived value is, and
dropping to $4.99 signals "cheaper Paprika" rather than "better capture."

**Change the annual to $39.99** (from $49.99). $49.99 against a $6.99 monthly is a 40% discount,
which is thin next to a category that anchors annual at $9.99 (AnyList) to $49 (Plan to Eat).
$39.99 is a 52% discount, reads clearly as the value option, and — given 72% year-one annual
churn — the extra $10 of headline price is worth less than the additional annual conversions.

**Test a $79.99 lifetime.** Paprika's one-time model exists because people resist renting a
filing cabinet, and "your personal cookbook" is filing-cabinet positioning. Lifetime often
outperforms in this specific category. Test it; don't assume it.

**Do not launch Creator at $14.99 yet.** The playbook argues for Creator in Stage 2 and then, in
§18, correctly says Live is peer-to-peer/STUN and needs TURN and/or an SFU before it can carry
paying viewers. Those two positions contradict each other: Creator's headline feature is Live
hosting. Selling a $14.99/month tier whose marquee capability runs on transport you have
described as not production-ready is how you generate refunds and one-star reviews at the exact
moment you are trying to prove the business.

Instead: give creator profiles, analytics and Live hosting **free** to the first cohort. You
need creator supply before you need creator revenue, and free access is a cheaper way to get 50
creators than a discount is.

---

## 6. What to gate — and the unit-economics trap in "unlimited"

The playbook says "unlimited recipe creation" and "unlimited voice recipe capture." Look at
`normalizeStoragePermitRequest` and the quota constants in `notifications/functions/index.js`:

```
STORAGE_DAILY_BYTES   = 2 GiB / user / day
STORAGE_MONTHLY_BYTES = 20 GiB / user / month
public_media video    = up to 200 MB per slot, slots slot-00..slot-23
public_media image    = up to 25 MB per slot
voice_clip            = up to 120 MB per clip, clip-00..clip-15
private_session       = up to 120 MB per recipe
```

One recipe can hold 24 video slots at 200 MB — **4.8 GB of storage liability from a single
recipe.** A subscriber who uses the monthly quota fully accumulates 20 GB/month, and storage
cost is *cumulative*: at roughly $0.026/GB-month stored and $0.12/GB downloaded (verify current
Firebase rates), twelve months of that is 240 GB, about **$6.24/month in storage alone** against
**$5.94 net** from a $6.99 subscription. That subscriber is unprofitable inside a year without
downloading a single byte.

This does not require abuse. It requires one enthusiastic user with a good phone camera.

**"Unlimited" must never appear next to a feature with a per-unit cloud cost.** Concretely:

| Tier | Recipes | Media | Second Pass | Sync |
|---|---|---|---|---|
| Free | Unlimited **local** | 1 photo/recipe, no video | 2 / month | Up to 10 cloud recipes |
| Pro | Unlimited local + cloud | Video slots unlocked, fair-use cap | 30 / month | Full backup + sync |

Two reasons to gate cloud sync rather than recipe count. First, the playbook's own flywheel
(§9) depends on people creating and sharing recipes — capping creation caps the growth loop.
Second, local recipes cost you nothing; cloud recipes cost you storage. Gate the thing that
costs money, keep the thing that drives growth free. That happens to be both the more honest
paywall and the cheaper one.

On Second Pass specifically: the primary capture path appears to use on-device Android ASR,
which is free to you. Second Pass re-transcription goes to the Chirp 3 backend, which is metered
at roughly $0.01–$0.02 per audio minute at list price (verify against your actual SKU). Second
Pass quotas already exist as of v0.10.0. Wire the entitlement to the *existing* quota mechanism
rather than inventing a second one.

---

## 7. Paywall placement — one correction

The playbook's upgrade moments (§10) are well chosen, with one exception. "After recipe #3 or
#5" is a count-based trigger, and it fires on people who are still deciding whether the app
works. The moment with the highest intent in ChefVoice is different and specific to this
product:

**The first time a user opens Second Pass and sees the diff.** That is the instant they
understand that the app caught something their ear missed. Put the upgrade there, worded as
capability rather than limit — *"Second Pass checks every recipe against your original audio.
Two free each month; unlimited review with Pro."*

Keep the private-collections and analytics moments as written. Drop the storage-limit prompt to
last; nobody has ever felt good about being upsold on storage.

---

## 8. Sequencing correction

The playbook's §19 says to fix Create Recipe conversion, Live infrastructure, image caching and
permission onboarding before spending on acquisition. Agreed, and one item outranks all of them
right now:

**Account deletion is broken, and that is a Google Play policy exposure, not a bug backlog item.**

Play requires an app that allows account creation to provide both an in-app deletion path *and*
a web deletion URL declared in the Data safety form. Non-compliance risks removal from Play. The
in-app path currently does not work, and there is no evidence in the repo of a web deletion
resource at all. Taking payments while holding accounts you cannot delete makes that worse, not
better — you would be adding payment data to the set of data you are obligated to be able to
erase.

Revised order:

1. Fix in-app account deletion. Ship the web deletion page. Update the Data safety form.
2. Entitlement infrastructure — server-authoritative, Play Billing 8, RTDN.
3. Paywall + Pro, $6.99 / $39.99.
4. Analytics instrumentation (you cannot run any of the §11 experiments without it).
5. Create Recipe flow simplification.
6. Creator cohort — free.
7. TURN/SFU, then and only then paid Live.

Items 1–4 are specified as work in `HANDOFF_MONETIZATION_AND_ACCOUNT_DELETE.md`.

---

## 9. What the playbook gets right

Worth stating plainly, because most of it is sound:

- Freemium for distribution, paid for depth. Correct for this product.
- Do not lead with banner ads. Correct — display ads on a $6.99 subscription funnel cannibalize
  the thing you actually want to sell.
- The flywheel in §9 is a real flywheel, not a diagram. Recipe sharing is genuinely the cheapest
  acquisition channel available to you.
- "100 paying customers before 100,000 downloads" is the right first milestone.
- §18's caution on Live is right, and should be applied more aggressively than the playbook
  itself applies it.
- Creator transactions and affiliate commerce are legitimate Stage 3 revenue. They are also both
  negligible on a small base — affiliate revenue on 10,000 MAU is a rounding error — so they
  belong exactly where the playbook puts them: later.

---

## Sources

- [Understanding Google Play's app account deletion requirements — Play Console Help](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [Understanding Google Play's lower service fees — Play Console Help](https://support.google.com/googleplay/android-developer/answer/16954621?hl=en)
- [Expanded billing choice and lower fees on Google Play — Android Developers Blog](https://android-developers.googleblog.com/2026/06/play-expanded-billing.html)
- [Google Play Billing Library version deprecation — Android Developers](https://developer.android.com/google/play/billing/deprecation-faq)
- [The State of Subscription Apps 2026: trends and benchmarks — RevenueCat](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- [Recipe Apps Compared: Pricing Models for 2026 — MyMealTicket](https://mymealticket.app/blog/recipe-apps-compared/)
- [Food+ — Samsung Food](https://samsungfood.com/food-plus/)
- [Best Platforms for Food Creators in 2026 — Nellie](https://nellie.food/blog/best-platforms-food-creators-comparison)
