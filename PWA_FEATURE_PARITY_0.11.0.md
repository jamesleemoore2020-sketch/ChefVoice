# ChefVoice PWA — Feature Parity with Android (0.11.0)

Completes the work started in `PWA_PARSER_PARITY_0.11.0.md` (parser restored to
56/56 on the shared corpus) and `PWA_SOCIAL_BILLING_ANALYTICS_0.11.0.md`
(entitlements, analytics, blocking and moderation).

`npm test` in `web/`: **69/69**, up from 26 at the start of this work.

## Landed in this round

### Direct messages
Conversation ids are both uids sorted and joined with `--`, participant names are
checked against the live profiles by `profileNameMatches`, and preview metadata is
created empty because backend triggers own it. Read markers are monotonic by rule,
and the client marks read against the newest message actually seen rather than
"now", so the marker stays honest. Blocked chefs' conversations are hidden from the
list, but an open thread stays readable — blocking stops new contact, it does not
erase history.

### In-app activity notifications
Records are backend-created (`allow create: if false`); the client advances `readAt`
or deletes its own. Surfaced in a new Inbox tab alongside messages, with an unread
badge on the nav.

### Threaded comment replies
One level deep, matching Android, carrying only the three extra keys the comment
rule allows. A reply whose parent is gone — deleted, or hidden because its author is
blocked — is promoted to top level rather than vanishing with the parent.

### Chef search and public profiles
Mirrors `searchChefProfiles` including its scan caps (50 per page, 12 matches, 300
scanned). Sign-in gated, because listing the users collection is: the rule keeps
single profile reads open for recipe cards but requires auth to list, so that anyone
holding the API key cannot enumerate every chef. Profiles show the
backend-maintained follower count; follower identities stay private.

### Second Pass (ChefVoice Review)
`SecondPassReviewer.kt` and `IngredientReviewClassifier.kt` ported to JS, with the
private re-transcription flow: authorize an upload, attach the returned
permitId/token as object metadata (the Storage rule compares both against the permit
document), upload to `privateVoice/{uid}/{recipeId}/session`, then call
`transcribeChefVoice`.

**All 19 tests from `SecondPassReviewerTest.kt` are ported verbatim and pass.** That
is the cross-platform contract for Second Pass, the same role the golden corpus
plays for the parser: both clients must review a transcript identically.

Review stays explicit and opt-in — nothing is applied until a specific card is
accepted, and accepting rebuilds the review against the updated recipe because the
indices in the remaining cards refer to the list that just changed. Quota is local
bookkeeping (Free 2/month, Pro 30/month) counted only after a successful cloud call,
so a failed review never burns an allowance.

Browser `MediaRecorder` sometimes reports `video/webm` for an audio-only capture,
which the permit and Storage rule would both reject, so the content type is
normalized to `audio/*`.

### Web push
`firebase-messaging-sw.js` for background messages, permission and registration
flow, device registration keyed by installation id, and an off switch. The backend
needed no change: it already fans out to Firebase Installation IDs (the current
Admin SDK multicast API — `tokens` is deprecated), and the rules already accepted
`platform: 'web'`.

## Two pre-existing bugs found and fixed

1. **Liking and commenting were broken outright.** `toggleLike` updated
   `recipes.likes` and `addComment` batch-incremented `recipes.commentCount`, but
   `validOwnerRecipeUpdate` requires both counters to be unchanged *and* only lets
   the author update the recipe at all — so those writes failed the whole
   transaction/batch. Both counters are backend-maintained; the client now writes
   only the child documents, as Android does.

2. **Rule-bound writes sent a fallback display name.** `chefName()` falls back to an
   email prefix or "Chef", but `profileNameMatches` compares against the profile's
   `displayName`, so the fallback is a permission denial. Publishing, comments,
   replies, conversations and messages now use a strict accessor that fails with
   something a chef can act on. Opening a conversation reads the target's live
   profile rather than trusting a feed card's cached `authorName`, which goes stale
   on rename.

A third was caught by its own test during the entitlement work: JS coercion turned a
malformed `['active']` status into `'active'` and would have unlocked Pro, where
Kotlin's `getString` returns null and falls through to expired.

## Deliberately not done

- **Video and per-recipe photo caps.** Both exist in the tier model on both
  platforms, but Android has no call site for either. An earlier draft gated them on
  web and it was reverted before shipping: enforcing on web alone would give a Free
  chef a worse deal in Safari than on their phone for the same account.
- **Live / WebRTC.** Still gated on both platforms pending real-device
  signalling/media/reconnection testing, exactly as `WEBRTC_LIVE_SETUP.md` and the
  PWA README describe. Not a gap — a deliberate hold on both sides.

## Verified, and not

Verified in a browser against the live Firebase project: the app loads with no
console errors on any of the six tabs, the Community feed renders real recipes, the
membership card and paywall render and dismiss, the cloud-recipe gate blocks at 10
synced for Free and not for Pro, the Second Pass card shows the correct remaining
quota and its exhausted state, and a signed-out Second Pass attempt routes to
sign-in before any quota logic.

**Not verified end to end:** anything requiring real credentials or console config —
the signed-in message/block/report round trips, the Second Pass cloud call (needs a
verified-email account), and push delivery (needs the VAPID key and a browser
grant). The rule-shape gates in `tests/safety-payloads.test.mjs` are the substitute
for the write paths, and they are source-text checks: they cannot evaluate a
Firestore rule.

## Known cross-platform gap

Android consults `isUserBlocked` only in its messaging UI, so its Community feed and
comments still show blocked chefs' content, which the web now hides. Filed as a
follow-up rather than left implicit.

## Protected surfaces

Android parser and golden corpus, Second Pass semantics, Firestore/Storage rules,
both Functions codebases, `transcribeChefVoice`, and App Check (still OFF) are
unchanged. Nothing was deployed. Version unchanged: 0.10.6 / `versionCode 58`.
