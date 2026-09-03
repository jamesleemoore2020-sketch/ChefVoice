# ChefVoice Android v0.9.7 — Deterministic Cooking Method Sequencing

## Scope

This release is a targeted deterministic cooking-parser upgrade based on a real Android burger cooking session. It does **not** replace the parser with an LLM and it does not change the original-audio truth source or Second Pass acceptance model.

## Exact real-device regression fixture

The shared golden corpus contains `real-android-burgers-temp-time-sequence-097`, captured before parser changes. Its second-pass narration includes:

- 1 lb ground beef
- four burger patties
- 2 tsp salt
- 1 tsp pepper
- 1 tsp garlic
- 1 tsp lemon pepper
- season both sides
- 375° cooking temperature
- cook for 20 minutes and flip during cooking
- rest for 5 minutes

Before this release, ChefVoice could pollute ingredient rows with narration, turn `375°` into a possible ingredient, create fake ingredient rows from the four patties, duplicate measured ingredients, and leave method actions in overly long/noisy sentences.

## Deterministic changes

- Reject bare cooking temperatures such as `375°`, `375 degrees`, or degree values with F/C suffixes as ingredient names.
- Keep bare duration facts out of Second Pass ingredient suggestions.
- Recognize narrated method-output counts such as “make four burger patties” as method context rather than ingredients.
- Split omitted-ASR-punctuation narration at explicit/future cooking-action boundaries while preserving older protected corpus behavior.
- Trim dangling conversational prepositions from measured ingredient names, e.g. `1 tsp lemon pepper on` → `1 tsp Lemon pepper`.
- Preserve chronological method ordering from the transcript timeline.
- Collapse only adjacent strict method expansions, preferring the later more-specific wording without semantic invention.
- Preserve uncertain appliance wording rather than inventing a technique. For the burger fixture, ChefVoice keeps the transcript fact `375°` but does not silently rewrite uncertain “on the oven” wording into “bake”.

## Expected burger result

Ingredients:

1. 1 lb Ground beef
2. 2 tsp Salt
3. 1 tsp Pepper
4. 1 tsp Garlic
5. 1 tsp Lemon pepper

Ordered method facts:

1. Make four different burger patties.
2. Split them all evenly.
3. Shape them well.
4. Pat them down.
5. Season the ground beef patties on both sides.
6. Preserve the 375° cooking instruction.
7. Cook for 20 minutes, flipping during cooking.
8. Let them sit/rest for 5 minutes before serving.

## Protected architecture

Unchanged:

**MIC → ORIGINAL AUDIO → LIVE TRANSCRIPTION → DETERMINISTIC COOKING PARSER → INGREDIENTS + METHODS → OPTIONAL SECOND-PASS REVIEW**

Original cooking audio remains the truth source. Second Pass remains explicit review only and never silently rewrites the recipe. Cook & Capture remains local-first. Firebase rules, notification Functions, IAM, Storage, App Check policy, and Live WebRTC transport are unchanged from the accepted v0.9.6 baseline.

## Candidate acceptance

Source validation is complete. A Windows Android build/install and a fresh real-device cooking acceptance pass are still required for v0.9.7.
