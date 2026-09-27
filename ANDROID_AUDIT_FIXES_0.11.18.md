# Android audit fixes (0.11.18, versionCode 79)

Android's share of the 2026-09-26 full audit. This build is **not released**: nothing here has
been built for release, signed or uploaded. Items are added as they land.

**Not touched:** the parser (`voice/`) and the golden corpus, `firestore.rules`,
`storage.rules`, every Functions codebase, `transcribeChefVoice`, Live signaling, App Check.

## F5 — threads show their newest messages, not their oldest

Direct messages, recipe comments and Live chat each listened with
`orderBy("createdAt").limit(n)`, which returns the **oldest** n. Once a thread passed its cap
— 250 messages, 100 comments, 150 Live comments — new items were silently never shown, and a
busy Live lost its chat at comment 151. All three now use `limitToLast(n)`, which keeps the
newest n, still oldest-first, so nothing on screen changes order. The PWA made the same fix in
0.5.18 with the same three windows, and `web/tests/thread-windows.test.mjs` holds both
platforms to them. No rules change: the rules constrain these reads by path, not by limit.

## F13 — no advertising ID

ChefVoice shows no ads, but `firebase-analytics` merges three permissions into the release
manifest: `com.google.android.gms.permission.AD_ID`, `ACCESS_ADSERVICES_AD_ID` and
`ACCESS_ADSERVICES_ATTRIBUTION` (confirmed in the merged manifest of the 0.11.17 release
build). A manifest that declares AD_ID must be declared on Play's Data safety form as
advertising-ID use. `AndroidManifest.xml` now removes all three (`tools:node="remove"`) and
sets `google_analytics_adid_collection_enabled` and
`google_analytics_default_allow_ad_personalization_signals` to false. Analytics still counts
the activation funnel; it never had any personal or recipe content in it. Verified by merging
the release manifest: no AD_ID or AdServices permission remains (only an optional
`uses-library` declaration, which is not a permission). A gate in
`notifications/production-trust.test.js` keeps it that way.

**Play Console, with the upload of this build (James, or a browser session):**

1. App content → **Advertising ID** → "Does your app use advertising ID?" → **No**. Play checks
   this against the manifest of each upload; answering No with 0.11.17 still live would be
   inaccurate, so change it when 0.11.18 goes up, not before.
2. **Data safety** → also declare what the audit found missing (F13): **Photos and videos →
   Videos** (recipe videos up to 200 MB are uploaded to public Storage when a chef publishes)
   and **Financial info → Purchase history** (Play purchases are verified server-side and the
   entitlement is stored). Both are collected, linked to the account and not shared. Videos are
   deleted with the account today; purchase records only once the F15 change to
   `chefvoice-notifications` is deployed, so answer "deleted on request" after that deploy.
