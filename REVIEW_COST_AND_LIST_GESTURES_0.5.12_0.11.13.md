# ChefVoice Review cost controls, notification list controls, swipe-to-save — 0.5.12 / 0.11.13

Android `versionCode 74` / `versionName 0.11.13`, PWA cache/package version `0.5.12`.

Four unrelated changes that happen to ship together: two that cut what ChefVoice Review
costs to run, and two that make list rows easier to act on one at a time.

## 1. One review now sends at most 5 minutes of audio (was 90)

ChefVoice Review does not record anything of its own. It uploads the cooking-session
recording the chef already made to `privateVoice/{uid}/{recipeId}/session` and hands it to
Chirp 3. Cloud speech is billed per minute of audio, so the ceiling on that upload is the
number that decides what one review costs. At 90 minutes a single review could run to
roughly a dollar and a half of speech time, and Pro allows 30 reviews a month.

The ceiling is now **5 minutes**, the same for Free and Pro. It is deliberately not a tier
lever: Free and Pro differ in *how many* reviews a chef may run, never in how much audio
one review may send.

What the cap does **not** do:

- It does not limit Cook & Capture. A chef can narrate for as long as they like.
- It does not truncate, re-encode or delete the local recording, which remains the source
  of truth and still plays back in full.
- It does not transcribe "the first five minutes" of a longer session. Reviewing part of a
  recording and presenting it as the review would be exactly the kind of silent partial
  result the parser rules exist to prevent, so an over-long recording is refused outright
  and said so.

The refusal names the actual length as well as the limit — "up to 5 minutes, and this one
is about 12" — because a bare "too long" leaves a chef unable to tell whether they are ten
seconds over or an hour over.

### Two ceilings, not one

The same Storage object is also written at publish time, as the private cloud copy of the
cooking audio. That write costs storage but no speech time, so it keeps its own, larger
ceiling. The constants are now separate and named for what they bound:

| Constant | Bound | Value |
| --- | --- | --- |
| `SecondPassLimits.MAX_REVIEW_DURATION_MS` (Android `Models.kt`, PWA `entitlement.js`) | Speech: what Review uploads and transcribes | 5 min |
| `PRIVATE_SESSION_MAX_DECLARED_DURATION_MS` / `PRIVATE_SESSION_MAX_DURATION_MS` | Storage: the private copy written on publish | 90 min |

Collapsing them back into one number would either make reviews expensive again or stop
long sessions being published at all.

The review ceiling lives in the model layer beside the tier limits rather than in the
repository, so the recipe card and both PWA review cards can quote it without importing a
cloud module — the same reason `FreeTierLimits` lives there.

## 2. The uploaded audio is deleted once the review is done with it

The object exists only to hand one recording to Chirp 3. Nothing reads it afterwards: a
later review re-uploads from the local file. Leaving it behind was a standing storage
charge per reviewed recipe for an object with no reader.

It is now released as soon as the callable returns, **whether the review succeeded or
failed** — a failed transcription leaves exactly the same orphan as a successful one, so
the cleanup cannot live only on the happy path. On the PWA that is a `finally` block; on
Android it is a call in each of the three terminal branches (success, unreadable response,
failure).

The delete is best-effort and fire-and-forget by design. A failed delete is a cost problem,
never a correctness one, so it must not turn a completed review into an error the chef
sees and must not delay the callback.

**No rules or Functions change was needed.** `storage.rules` already grants
`allow delete: if privateRecipeOwnedBy(uid, recipeId) && fileName == 'session'`, so the
owner can remove their own upload. Nothing was deployed for this; a new test pins that
permission so tightening it later cannot silently restart the leak.

Consequence worth knowing: for a recipe that had been published, a review now also clears
the private cloud copy that publish had written. The next publish re-uploads it, and the
local recording is untouched either way.

## 3. Notifications: timestamps, a per-row close button, swipe to clear

The Notifications tab rendered title and body only. A stack of similar-looking alerts gave
no way to tell a minutes-old one from a week-old one, and the only way to remove anything
was "Clear read notifications", which took all of them at once.

- **Timestamp** on every row, from the `createdAt` the model already carried and the
  existing `relativeTime` helper. Added to the PWA activity card too.
- **`✕` button** on every row, for chefs who would rather tap than swipe.
- **Swipe either way to clear**, via `SwipeToDismissBox`. `confirmValueChange` runs the
  dismiss and then returns `false`, so the box never settles into a dismissed state: the
  row leaves the list because the state it was keyed on is gone, not because the gesture
  parked it off-screen, which is what otherwise left a blank gap in the list.

Both routes call the same new `ChefAppState.dismissNotification`, which removes the row
optimistically so it goes away with the gesture rather than after a Firestore round trip,
and restores it with a reason if the delete fails. It reuses the existing
`deleteNotifications` batch call — no repository or rules change.

The PWA already had a per-notification Dismiss button, so it only needed the timestamp.

## 4. Community: swipe right to save to the cookbook

Swiping a dish right past ~110dp saves it, with the card tracking the finger and a
"★ Save to cookbook" label fading in behind it.

Like the existing double-tap-to-like, the gesture **only ever adds**: dragging a dish that
is already saved does not quietly unsave it, because the gesture reads as "keep this", not
"toggle this". An already-saved dish shows "★ Already saved" instead. Only rightward travel
is tracked — a left drag does not move the card — and travel is clamped just past the
threshold so the card hints rather than sliding away. The ☆/★ button in the action column
is unchanged and still toggles both ways.

This reuses the existing bookmark plumbing (`toggleBookmark`, `listenBookmarkIds`, the
"Saved from Community" section on Profile). No new collection, model or rule.

## What did not change

- **The parser.** `CookingSessionParser.kt`, `IngredientParser.kt`, the JS ports and
  `shared/golden-cooking-corpus.tsv` were not touched. `GoldenCookingCorpusTest` still
  passes all 24 tests and the corpus still has 60 rows.
- **`firestore.rules`, `storage.rules`, `firestore.indexes.json`** — no edits, nothing
  deployed. The cleanup relies on a delete permission that was already there.
- **Cloud Functions.** Neither `chefvoice-notifications` nor `chefvoice-billing` was
  changed, and `transcribeChefVoice` (which lives outside this repo) was not touched.
- **Live/WebRTC** and the signaling/lease behavior.
- **App Check**, still monitoring-only with enforcement intentionally off.
- **Tier counts.** Free is still 2 reviews a month, Pro still 30.

## Gates

- Android `:app:testDebugUnitTest` — 59 tests, 0 failures (`GoldenCookingCorpusTest` 24,
  `SecondPassReviewerTest` 19, plus the new `SecondPassLimitsTest` 4).
- PWA `npm test` — 130 tests, 0 failures, including the new
  `web/tests/second-pass-cost.test.mjs` (9).
- The new cost gates assert both platforms pin the same review ceiling, that the review
  and publish paths use different ceilings, that the release runs on every terminal branch,
  and that the Storage rule still permits the owner delete the cleanup depends on.
