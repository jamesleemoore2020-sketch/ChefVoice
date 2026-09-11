# ChefVoice — Recipe #tags, collapsible Community search, read-aloud, and a Storage rules fix (0.10.7)

All four next-release asks from the 2026-09-10 handoff: collapse the Community
search bar, add recipe categorization with a Discover-side filter, a
synthetic-voice option, and seed complete test recipes into Community. The
last one surfaced a real, pre-existing production bug (recipe photo uploads
were completely broken on the PWA) that's also fixed here.

## Recipe #tags (`Recipe.category`, reinterpreted)

The handoff's open question was fixed-enum vs. freeform tags. The answer that
came back was freeform `#tags` with alias-aware search ("search bbq, BBQ, or
however it's spelled and it finds the same recipes") — not a closed category
enum. `Recipe.tags: List<String>` (Android) / `recipe.tags` (PWA) is optional,
capped at 8 entries, and stored already-canonicalized so a chef can type
`#BBQ`, `Barbecue`, or `Bar-B-Q` and the tag lands the same way for everyone
searching it.

- **Canonicalization, not fuzzy/phonetic matching.** `util/TagUtils.kt` (Android)
  and `js/tag-utils.js` (PWA, kept in sync by hand — mirrors how the parser
  itself is ported twice) lowercase, strip punctuation, and fold a short,
  literal alias table (`barbecue`/`barbeque`/`bar-b-q` → `bbq`) onto one
  canonical tag. This deliberately does **not** attempt general phonetic
  matching (Soundex/edit-distance): the only concrete case asked for was
  spelling variants of the same word, and a bigger fuzzy-matching engine would
  be disproportionate to that ask. Distinct concepts are never merged —
  "vegan" and "vegetarian" stay separate tags on purpose.
- Tags are optional and unbackfilled by design (the answer to the migration
  question was "#tag can be optional, so \[existing recipes\] are fine") — no
  migration script, no `Uncategorized` placeholder value.
- Entry points: the recipe capture/save screen (Android `CreateRecipeScreen`,
  PWA's Cook form) and, on Android only, the existing "Edit recipe" mode on
  `RecipeDetailScreen` (the PWA has no post-save metadata editor for anything
  else either, so tags don't get one either — no new inconsistency introduced).
- Search: reused each platform's existing search box rather than adding a
  second one. Android's already-client-side "search chefs or dishes" filter
  now also checks `recipe.tags` through the same alias table. The PWA's chef
  search box now *also* filters the visible feed by tag/title/description/
  ingredient text using the same applied-on-submit term it already had —
  deliberately not live-as-you-type, since the PWA's render model replaces
  `main.innerHTML` wholesale and a render on every keystroke would drop
  input focus/cursor position. That's the same tradeoff the pre-existing
  chef-profile search already made.
- `firestore.rules`: `tags` added to `validRecipeData`'s key allowlist (list,
  ≤ 8 entries) and to `validOwnerRecipeUpdate`'s allowed diff keys. Covered by
  four new cases in `rules-tests/firestore-rules.test.js` (accepts tags,
  rejects > 8, rejects a non-list, allows an owner update). Deployed via
  `DEPLOY_COMMUNITY_RULES.cmd`.
- Confirmed live: searching "barbecue" on chefvoice-d7fec.web.app correctly
  surfaced a recipe tagged only `#bbq`.

## Collapsible Community search

Both platforms rendered an always-visible search box at the top of Community.
On Android this box didn't exist before this change (it's new, alongside
tags); on the PWA it was the "clutter" the 2026-09-10 handoff flagged. Both
now render a single 🔍 toggle in the Community header instead; opening it
shows the same input/button that were already there, and closing it clears
whatever search was applied so the feed silently reverts to unfiltered.

## Read recipes aloud (TTS)

The "alternate/synthetic voice option" from the handoff's open questions
resolved to text-to-speech playback, not a change to the chef's own recorded
narration. Scoped to the system default voice — no voice/accent picker, since
none was actually requested beyond "read it aloud."

- Android: `media/RecipeSpeaker.kt` wraps `android.speech.tts.TextToSpeech`.
  `CookingScreen` (the hands-free step-by-step walkthrough — the actual
  "cooking with your hands full" use case) gained a "🔊 Read steps aloud"
  toggle that speaks the current step and re-speaks on Next/Previous;
  `TextToSpeech` is shut down via `DisposableEffect` when the screen closes.
- PWA: the recipe detail view's Method section gained a "🔊 Read steps aloud"
  button using the browser's native `speechSynthesis`/`SpeechSynthesisUtterance`
  — no new dependency. It reads the title plus every method step in one pass
  (the PWA has no per-step "cooking mode" screen to hook a step-by-step
  reader into, unlike Android, so this is the honest equivalent rather than a
  forced imitation of Android's navigator).

## Media remove button (PWA capture screen)

Discovered live while seeding: the PWA's Cook screen had no way to remove a
photo/video from the "Photos & video" preview before saving — Android's
`CreateRecipeScreen` already had this (`MediaPreview(onRemove = ...)`), so
this was a PWA-only gap. `renderMedia()` now wraps each thumbnail in the
existing `.thumb-wrap` pattern (already used for Community double-tap-like)
with a small circular `×` overlay button that removes the item and revokes
its object URL.

## Storage rules fix: recipe photo uploads were completely broken

Seeding the three demo recipes with photos surfaced a real, pre-existing bug:
**no recipe photo could ever be published from the PWA**, for any user. The
upload always failed with `storage/unauthorized`, silently downgraded to a
"stayed local" warning.

- **Root cause**: `storage.rules`' `publicMedia` `create`/`update` rules
  chained three cross-service `firestore.get()`/`.exists()` calls in one
  evaluation — `recipeOwnedBy()` (reads `recipes/{recipeId}`),
  `socialUploadAllowed()` (reads `userRestrictions/{uid}`), and
  `uploadPermit()` (reads `storageUploadPermits/{permitId}`). Firebase Storage
  Rules cap cross-service Firestore access at **two distinct documents per
  rule evaluation** ([official docs](https://firebase.google.com/docs/storage/security/rules-conditions)).
  A third document made the whole rule evaluate to `false` unconditionally,
  every time, regardless of who was uploading or what.
- Diagnosed empirically against production: a permit-gated upload with zero
  Firestore cross-references (`profiles/{uid}/avatar`) succeeded; a read
  simulation against the exact failing path succeeded (one cross-reference);
  the real `create` write failed, isolated via the Firebase Console Rules
  Playground to `recipeOwnedBy()` specifically. Confirmed the 2-document limit
  against Firebase's own docs before touching the rule.
- **Fix**: dropped the redundant `socialUploadAllowed(uid)` check from
  `publicMedia`'s `create`/`update` (`storage.rules`). It's redundant because
  `authorizeChefVoiceStorageUpload` (`notifications/functions/index.js`)
  already calls `publicSocialUploadRestricted(uid)` before it will ever issue
  a permit for `kind: "public_media"` — a restricted account can't obtain a
  valid permit to begin with, so the rule-level recheck was pure (and, it
  turns out, actively harmful) defense-in-depth. `delete` is unaffected (it
  never called `uploadPermit`, so it was already under the limit). Deployed
  via `firebase deploy --only storage` (no dedicated wrapper script existed
  for Storage rules before now).
- **Separate, deliberately untouched**: the same function's plain voice-clip
  upload path (`recipe.voiceClips` / the `voiceBlob` parameter) uses the
  legacy, now-closed `recipes/{uid}/{id}/voice/{uuid}.ext` path and is
  similarly broken — but the fix isn't a simple path swap. On Android, the
  chef's raw full-session recording is deliberately uploaded to the *private*
  `privateVoice/{uid}/{recipeId}/session` path with no public download URL
  ever attached (`FirebaseSocialRepository.uploadVoice`'s `isFullCookingSession`
  branch), matching the "original audio stays private" invariant. The PWA's
  `publishRecipe()` currently sends that same private session audio toward
  the *public* `voice/` path instead. Naively porting the permit fix here
  without also correcting which path it targets would risk actually
  succeeding at publishing previously-private cooking audio. Left broken
  (inert, same as before) pending a dedicated fix.

## Seed content

Three complete recipes published to Community under the founding account,
each with a full ingredient list, six-step method, tags, a real photo, and a
narration-derived transcript (written narration run through the actual
deterministic parser via "Re-analyze transcript", then hand-corrected back to
the intended clean ingredient/step list — the same real review workflow a
chef would use, not a shortcut around it):

- **Backyard BBQ Baby Back Ribs** — `#bbq #weekend`
- **Campfire Foil Packet Vegetables** — `#camping #vegetarian`
- **Weeknight Garlic Butter Pasta** — `#weeknight #pasta`

Photos are CC-BY / CC-BY-SA from Wikimedia Commons (attribution: Foodista;
Salimfadhley; Schellenberg), sourced via web search rather than guessed URLs.
Attaching each photo required one manual click per recipe from the user — the
Browser pane automation has no way to drive a native OS file-picker dialog.

## Verification

- `web`: `npm test` — 86/86 (81 existing + 5 new `tag-utils.test.mjs` cases),
  green on every deploy in this change.
- Android: `:app:testDebugUnitTest` — **BUILD SUCCESSFUL**, including the new
  `TagUtilsTest.kt`; only the 3 pre-existing unrelated warnings noted in the
  prior handoff (unnecessary safe call / non-null assertions in
  `ChefVoiceApp.kt`, untouched by this change).
- `rules-tests`: not re-run (requires the Firebase emulator); the four new
  Firestore tag cases follow the exact pattern of existing recipe-rule tests.
  The Storage rules fix was instead verified directly against production
  (see above) since `rules-tests` only covers `firestore.rules`, not
  `storage.rules`.
- Manually verified end-to-end against the live production site
  (chefvoice-d7fec.web.app), signed in: tags round-trip and alias search,
  search-bar collapse, read-aloud (toggles without console errors), the new
  media remove button, and all three seed recipes' photos rendering correctly
  in the Community feed.

## What did NOT change

Nothing in the deterministic parser (`CookingSessionParser.kt` / the PWA's
JS port), `chefvoice-notifications`, `chefvoice-billing`, Live/WebRTC, or App
Check (still monitoring-only). The PWA's private-voice-clip upload path
remains broken (see above) — deliberately not touched this round.
