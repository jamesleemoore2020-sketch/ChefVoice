# ChefVoice — Create Recipe flow simplification (0.10.8)

## Problem

`CreateRecipeScreen` was one long scrolling flow — cooking capture, recipe
details, ingredients, method, chef voice, photos/video and the save button
all stacked in a single `LazyColumn`. Flagged as high priority in
`UI_BRANDING_AUDIT.md` #4 and again in `MONETIZATION_REVIEW_2026-09.md`'s
sequencing (§8, item 5): "the thing standing between a new user and their
first successful recipe."

## Fix

Split into five progressive steps, exactly as the audit proposed:
**Capture → Recipe Details → Ingredients/Method → Media → Review**, with a
step-progress header ("Step 2 of 5 · Recipe Details") and Back/Next
navigation at the bottom. No capture, parsing, validation or save logic
changed — every field, button and behavior from the original single-screen
flow is present, just distributed across steps instead of one continuous
scroll.

New: a Review step. The original flow had no summary before saving — the
Save button was just the last item in the scroll. Review now shows the
recipe name, description, servings/prep/cook time, tags, and every
ingredient and method step, plus counts of media/voice clips, before the
same Save button (same enabled condition as before: title present and at
least one ingredient).

`CreateRecipeStep` is a plain five-value enum; `key(wizardStep)` around the
per-step `LazyColumn` ensures each step starts scrolled to the top rather
than inheriting the previous step's scroll position.

## Verified

`gradlew.bat :app:testDebugUnitTest` — BUILD SUCCESSFUL, same 3
pre-existing unrelated warnings, no new ones. Built, installed and
exercised on a real device end to end: capture, all four field/list steps,
Back navigation, Review's summary, and Save — confirmed working by hand.

## What did not change

`CookingSessionCapture.kt`, `CookingSessionParser.kt`, `IngredientParser.kt`
and every other part of the deterministic voice pipeline are untouched —
this is presentation-only. Firestore/Storage rules, Cloud Functions, and
the PWA are untouched.
