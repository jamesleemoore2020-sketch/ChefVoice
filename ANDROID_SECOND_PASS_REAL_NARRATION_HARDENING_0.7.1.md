# ChefVoice Android 0.7.1 — Real Narration Hardening

Built from the user's first real Android second-pass screenshots.

What the screenshots proved:
- Android second pass is present and reaches Chirp 3.
- Original private audio playback is available.
- The raw cloud transcript is strong enough to recover the recipe.
- The deterministic parser was over-producing live ingredients from narration and ASR fragments.

Fixes:
- Exact real Boyardee transcript added to the shared golden corpus.
- Correct expected ingredients: paprika, wood fired garlic, pepper, salt, ground beef.
- `tbsp spoon` / `tsp spoon` normalizes to the intended unit.
- Shared-measure parsing no longer swallows a following independently measured ingredient.
- Conversational `need/take` wording can no longer create unmeasured fake ingredients.
- Time phrases and narration fragments are rejected as ingredients.
- Bare article phrases inside methods (`a burger patty`) are not ingredients.
- Mid-narration subject + cooking verb (`You cook`) becomes a method boundary.
- Obvious old live-parser garbage is shown as `Likely capture artifact` with an explicit `Remove artifact` action.
- Artifact removal rebuilds review indexes immediately so later review actions stay safe.
- No silent recipe rewrite.

Real-device status:
- v0.7.0 second pass is proven operational from the supplied screenshots.
- v0.7.1 parser/review cleanup is test-validated but still needs a new Android real-device run.
