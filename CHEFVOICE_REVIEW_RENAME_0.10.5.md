# 0.10.5 — ChefVoice Review rename, ingredient/step delete, duplicate fixes

## What changed

**Renamed "Second Pass" → "ChefVoice Review" in all user-facing text**: section title, transcript
card title, run/re-run buttons, per-issue "Use ChefVoice Review" buttons, and the
info/error/status messages surfaced from `ChefAppState` and `FirebaseSocialRepository`
(`transcribePrivateChefVoice`). Internal identifiers (`SecondPassReviewer`, `SecondPassResult`,
the `secondPass` JSON field persisted by `RecipeRepository`, `ChefAppState.secondPassMessage`,
etc.) were intentionally left as-is — renaming those would touch persisted local-storage field
names and Cloud Function contracts for no user-visible benefit.

**Manual ingredient and method-step delete.** `RecipeDetailScreen`'s existing owner-only "Edit
recipe" mode (already used for prep/cook time and photo/video) now also shows a "Remove" button
on each ingredient and a "Remove step" button on each method step. Backed by
`ChefAppState.removeRecipeIngredient()` and the new `ChefAppState.removeRecipeStep()`, mirroring
the existing `removeRecipeMedia` pattern. Removing a step also drops any photo/video attached to
that step (deleting the local file, same as `removeRecipeMedia`). Previously the ingredient and
method lists were plain read-only `Text` once a recipe was saved — there was no way to remove
either, including a leftover created by a ChefVoice Review merge.

Both removal paths also rebuild the recipe's stored ChefVoice Review issue list
(`SecondPassReviewer.buildReview`/`buildMethodReview`) against the new, shorter ingredient/step
list. Issues carry a `liveIndex` into that list; without rebuilding, deleting an item could leave
a stale review card pointing at the wrong (or a now out-of-range) row.

**Full review of the duplicate-ingredient/duplicate-step mechanism in `SecondPassReviewer.kt`,**
with two real bugs fixed there directly (the user asked for this file to be reworked, not just
worked around):

1. `buildReview()`'s live-only pass computed `ingredientReviewConfidence` and gated on it
   *before* checking whether the item was a superseded/artifact duplicate. That meant a leftover
   live ingredient the code had already identified as "the second pass clearly corrected this to
   something else" or "this matches a known parser-artifact shape" could still be silently
   dropped from the review with **no card at all** if its unrelated "does this look like a real
   ingredient name" confidence score happened to be low — leaving a stale duplicate in the recipe
   with no way to flag it for removal. Fixed by resolving identity first: an artifact/superseded
   duplicate is now always surfaced, regardless of that confidence score. Locked in by
   `exactDuplicateLiveArtifactBelowConfidenceGateIsStillOfferedForRemoval`.
2. `applySuggestion()` and `applyMethodSuggestion()` inserted a "possible missed
   ingredient"/"possible missed step" suggestion with no check for whether an equivalent item was
   already present. Accepting the same or an overlapping suggestion twice — e.g. after a second
   ChefVoice Review run, or two review cards that turn out to describe the same real
   ingredient/step — created an actual duplicate row. Both now skip the insert when an existing
   item already matches by the same identity bar the reviewer uses elsewhere (ingredient name
   overlap via the existing `jaccard` helper at the same 0.66 threshold used for identity
   elsewhere in this file; method-step sameness via the existing "confirmed without rewrite" bar,
   factored out as `isSameMethodStep` and now shared by both the confirm check and this guard).
   Locked in by `acceptingPossibleMissedIngredientTwiceDoesNotDuplicate` and
   `acceptingPossibleMissedStepTwiceDoesNotDuplicate`.

All 19 pre-existing `SecondPassReviewerTest` cases — which encode a series of real-device bug
fixes (ASR corrections, composite step splitting, artifact cleanup, etc.) — still pass unchanged;
nothing about the existing narrow matching/threshold behavior was loosened, only the ordering bug
and the missing dedup guard.

## What did NOT change

- `CookingSessionParser.kt`, `IngredientParser.kt`, `IngredientNormalizer.kt`, and
  `IngredientReviewClassifier.kt` — the deterministic capture/parse pipeline itself — are
  untouched. `CookingSessionParser` already deduplicates ingredients (exact-key only) and method
  steps (exact-key plus a prefix/extension merge for incrementally-growing ASR text) at capture
  time via `dedupeIngredients`/`dedupeSteps`; a near-duplicate created by a spoken correction
  (different wording or quantity, not just a growing prefix) can still pass through uncaught by
  design, which is exactly what ChefVoice Review's artifact/superseded-quantity flagging (now
  fixed) and the new manual delete buttons are for.
- No changes to `firestore.rules`, `storage.rules`, or any Cloud Functions code.
- No changes to Live/WebRTC, App Check (still monitoring-only), or notification delivery.
- Golden cooking corpus (`shared/golden-cooking-corpus.tsv`) untouched; `GoldenCookingCorpusTest`
  still passes unmodified.

## Verification

- `gradlew.bat :app:compileDebugKotlin` — clean.
- `gradlew.bat :app:testDebugUnitTest` — all 3 new + all pre-existing tests pass (19/19 in
  `SecondPassReviewerTest`, full suite green).
- Installed debug build on connected device (Samsung, `R5CY54B749F`) and launched without a
  crash; logcat clean of fatal errors (only pre-existing App Check/GMS warnings, unrelated to
  this change). UI was not manually clicked through this session — worth a hands-on pass.
