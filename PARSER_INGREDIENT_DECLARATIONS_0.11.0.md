# ChefVoice 0.11.0 — Ingredient declarations, yield sentences and back-references

Deterministic parser fix, driven by a real Android capture (a nachos recipe, 0909).
Version unchanged: versionCode 58 / `0.10.6`.

## What the real capture showed

The chef narrated a nachos recipe. Second Pass ran, Chirp 3 returned a clean transcript,
and the review flagged 6 ingredient and 3 method issues — including correctly identifying
"People maybe thing" as a capture artifact at 0.9 confidence.

**Second Pass was not the defect.** Re-parsing the *clean* Chirp 3 transcript through
`CookingSessionParser` still produced garbage, which is the important finding: both passes
run the same parser, so any systematic parser defect appears identically in both and is
marked "confirmed" rather than flagged. Second Pass can only surface disagreements. It
cannot see a mistake both passes agree on.

Saved ingredients before, from a transcript that plainly named every one of them:

| | |
|---|---|
| `1 bag Cubes` | "Dorito chips" misheard, then kept |
| `1 bag Should be the least` | from "One pack **should** feed at **least**…" |
| `1 lb Ground beef` | correct |
| `1 tsp Salted pepper` | "salt and pepper" |
| `1 tsp Lemon pepper` | correct |
| `It on top of your nachos` | a method sentence |
| `2 People maybe` | from "…two **people, maybe** three" |
| `2 People maybe thing` | same, duplicated |

Sour cream, hot sauce and jalapeños were missing entirely, though each was declared twice.

## The three defects

Each was added to `shared/golden-cooking-corpus.tsv` as a row first, confirmed failing,
then fixed — the process in `shared/README.md`.

**1. "You're going to need some X" was not an ingredient declaration.** `need` had been
deliberately excluded from `unmeasuredIngredientContext`, with a comment explaining why:
narration like "what you need to do" would otherwise become an ingredient. That exclusion
was right about the risk and wrong about the scope — it cost three real ingredients.

`need` is now admitted in exactly one shape, when a determiner follows it
(`need\s+(?:some|an?)`). "What you need **to** do" still fails, because "to" is not a
determiner. The lookahead carries the evidence, not the verb. A leading discourse
connector ("**then** you're going to need…") is also tolerated, which it was not before.

**2. Yield sentences were mined for ingredients.** "One pack should feed at least two
people, maybe three" describes servings, not contents, but it carries numbers that look
exactly like ingredient quantities. Clauses containing `feed`/`feeds`/`serves`/
`serving`/`servings` now return no ingredients. Bare "serve" is deliberately excluded —
it is a method verb ("ready to serve and eat") and suppressing it would drop real
closing steps.

**3. Back-reference names became ingredients.** "You sprinkle **it** on top of your
nachos" produced the ingredient "It on top of your nachos". An unmeasured name opening
with `it/its/them/they/this/that/those/these` is pointing at something already
introduced, and is rejected.

## The regression this introduced, and its fix

Making "need some X" yield ingredients broke method steps. This step:

> Sprinkle it on top of your nachos.

became:

> Sprinkle it on top of your nachos then you're going to need some sour cream need some
> hot sauce need some jalapenos.

`collectSegmentAwareSteps` arms `acceptsIngredientContinuation` after any segment
matching `ingredientMethodContinuationAction`, which includes `sprinkle`. The next
segment then joins onto the previous step **if it yields ingredients** — a branch that
exists so "season the patties" followed by "with salt and pepper" become one step. Once
"need some sour cream" started yielding ingredients, it qualified for that branch.

A fresh declaration is not a continuation of anything. The branch now skips segments
matching `ingredientDeclarationSegment`, which is the same shape the declaration is
admitted by, so the two rules move together.

This was caught only because the full transcript was re-run and diffed against the
pre-change parser. No corpus row covered it: the corpus asserts *required* step
substrings and cannot express "this step must not contain X". That gap is why the guard
is a dedicated fixture test rather than a corpus row.

## Result on the real transcript

| Before | After |
|---|---|
| 8 ingredients, 2 correct | 6 ingredients, 6 correct |
| sour cream / hot sauce / jalapeños lost | all three recovered |
| 5 phantom rows | none |
| 7 steps | 7 steps, byte-identical to before |

## Tests

- 3 new corpus rows (`real-android-need-some-unquantified-0909`,
  `real-android-serving-yield-not-ingredient-0909`,
  `real-android-sprinkle-on-top-not-ingredient-0909`). Corpus row count guard raised
  52 → 55.
- `realNachosFixtureKeepsIngredientDeclarationsOutOfMethodSteps` — asserts the exact
  ingredient list, that the sprinkle step stands alone, and that no step absorbs a
  declaration.
- `gradlew.bat :app:testDebugUnitTest` — BUILD SUCCESSFUL, 31/31, all 55 corpus rows.
- 91/91 node gates (74 notification + 17 billing).

## What did NOT change

- **`SecondPassReviewer.kt` is untouched.** It was doing its job; the defect was upstream.
  Its 19 tests pass unchanged.
- **No existing corpus row was weakened or edited.** Only additions.
- **Method step output is unchanged** on the real transcript and on the burger fixture.
- **Firestore/Storage rules, Live/WebRTC, App Check (still OFF), `chefvoice-notifications`,
  `chefvoice-billing` and `transcribeChefVoice` are untouched.** Nothing was deployed.

## Still open

- **"Need your favorite Dorito chips, one bag" is still lost.** The determiner gate admits
  `some/a/an` but not `your`, and the quantity trails the name rather than leading it.
  That is a different parse shape and wants its own corpus row.
- `Mix it with taco.` still drops "seasoning", and the 5-minute rest step is still absent.
  Both are pre-existing and unaddressed here.
- The PWA half of the corpus contract cannot be run — there is no `web/` directory in this
  checkout, so these three rows are Android-verified only.
