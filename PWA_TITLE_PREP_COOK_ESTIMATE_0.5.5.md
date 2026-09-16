# PWA — Recipe title + prep/cook time from narration (0.5.5)

The Cook wizard now fills in Recipe name, Prep min and Cook min from the
cooking narration itself, when the chef actually says them, instead of those
three fields always requiring manual entry. It never overwrites a field the
chef has already typed, and a transcript with no evidence for a field simply
leaves it blank, same as before.

- **Title** fires only on an explicit opening announcement -- "Today I'm
  making X", "This is my recipe for X", "This recipe is X" -- never inferred
  from ambient narration. The pronoun ("I'm"/"we're") is mandatory so a real
  mid-recipe instruction like "make four burger patties" is never mistaken
  for one, and the "making/make/cooking/cook" form is further gated to the
  first two spoken segments (chefs say the name at the very start).
- **Prep/cook time** comes from whichever the chef actually gave:
  1. A direct statement -- "prep time five minutes, cook time twenty
     minutes" -- taken at face value and pulled out of the transcript before
     anything else runs, so it never leaks into Method as a meaningless
     "Cook time." step or silently vanishes (neither "prep" nor a bare
     "time" phrase was ever step/ingredient evidence).
  2. Otherwise, an estimate: durations already in the parsed method steps are
     summed and bucketed by an unambiguous prep verb (chop/dice/slice/peel/
     mince, before heat) or an unambiguous cook verb (cook/bake/roast/
     simmer/boil/fry/sear/sauté/brown/toast/preheat/melt/reduce, heat
     applied). A step naming both kinds, or neither, contributes to neither
     total -- an estimate from durations actually said, never a guess.
- A step that is itself the title announcement ("Make my famous chili.") no
  longer also shows up as a redundant first Method step.

A real chili-recipe capture (screenshots from James's own device) surfaced
three separate ingredient-extraction bugs in the same session, fixed here
since they came from real evidence rather than a guess:

- A cut-state modifier word landing alone in its own ASR segment, split from
  the noun it describes ("...one pound of ground" | "beef" across a segment
  break), was a syntactically valid but meaningless standalone ingredient
  ("Ground" next to the correct "Ground beef"). Added a narrow rejection
  list (ground/diced/sliced/chopped/minced/grated/shredded/crushed/
  boneless/skinless/peeled/cubed) for words that are never themselves a
  complete ingredient.
- "Or" between two ingredient options ("salt or pepper") could leave a bare
  "Or" as its own ingredient when a segment break fell between them; "or" is
  now rejected as a standalone name the same way "and" already was.
- A window-joined ingredient clause could run straight into the next
  sentence when it began "...and you're going to let it [verb]" and the verb
  itself landed in a different clause via the existing action-word boundary;
  that dangling shell is now trimmed the same as the rest of the
  ingredient-tail cleanup.

PWA-only. `CookingSessionParser.kt` (Android) is untouched -- recipe title
and prep/cook time remain manual-entry fields there, same as
`PREP_COOK_TIME_0.9.14.md` shipped them. No Firestore/Storage rules,
Functions, Live, or App Check changes.

Cache/package version is 0.5.5, on top of the orphaned-audio-cleanup (0.5.3)
and cloud-recipe-delete (0.5.4) work already on this branch.

## Validation

- PWA tests: 110/110 (`node --test tests/*.test.mjs`), 15 new: title
  extraction (including the real hamburger and nachos golden fixtures,
  extended to also assert on title/cook time), the prep/cook estimate, the
  direct spoken prep/cook-time statement, and the three ingredient fixes
  above reproduced as their own regression cases.
- Cook wizard DOM integration: 60/60. Recipes list DOM: 33/33. Both re-run
  clean, unaffected by this change.
- Manual browser pass (`localhost:4173`): typed a real chili narration
  (recreated from James's report) into Transcript recovery and confirmed
  live in the running app -- 4 clean ingredients with none of the three bugs
  above, and Recipe Details auto-filled to "My famous chili" / Prep 5 /
  Cook 20 without touching a microphone.
- Known remaining gap: a measured ingredient whose name spans an "or"
  ("Salt or pepper") can still appear duplicated alongside a shorter
  same-quantity capture of just the first option ("Salt") when a segment
  break falls between them. Canonicalization intentionally never merges
  ingredients by anything looser than an exact name match -- a prefix-based
  merge would risk conflating genuinely different ingredients (e.g. "onion"
  vs "onion powder", or in this exact recipe, "chili" vs "chili powder").
  The existing manual delete button handles it; not fixed here.
- Android `:app:testDebugUnitTest` not re-run: this change touches no
  Android source.

## Deploy

```
DEPLOY_PWA.cmd
```

Reload/reopen the PWA after deployment to pick up cache version 0.5.5.
