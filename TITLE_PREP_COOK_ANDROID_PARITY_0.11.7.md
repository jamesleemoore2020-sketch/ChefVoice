# ChefVoice Android — Title + prep/cook time from narration (0.11.7 / 68)

Ports the PWA's 0.5.5 change (`PWA_TITLE_PREP_COOK_ESTIMATE_0.5.5.md`) to
`CookingSessionParser.kt`, so both platforms now behave identically here.
Same behavior, same regex sources, same rationale as the PWA writeup --
summarized rather than repeated in full:

- **Title** from an explicit opening announcement ("Today I'm making X" /
  "This is my recipe for X" / "This recipe is X"), gated the same way (a
  mandatory pronoun for the "making/make/cooking/cook" form, restricted to
  the first two spoken segments) so a real mid-recipe instruction like "make
  four burger patties" -- present verbatim in this file's own burger
  fixtures -- is never mistaken for a title.
- **Prep/cook time** from either a direct "prep time N minutes, cook time N
  minutes" statement (pulled out before anything else parses, so it never
  becomes a meaningless "Cook time." step), or otherwise an estimate summed
  from chop/cook-verb durations already in the parsed steps.
- The title-announcement step itself no longer also shows up as a redundant
  first Method step.
- The three real ingredient bugs the PWA fix found from an actual chili
  capture, ported identically: a bare cut-state modifier (ground/diced/
  sliced/chopped/minced/grated/shredded/crushed/boneless/skinless/peeled/
  cubed) left standalone by a segment break is rejected the same way a
  temperature-only or noise name already was; "or" is now rejected as a
  standalone ingredient name the same way "and" already was; and an
  ingredient clause ending "...and you're going to let it [verb]" no longer
  runs on into the next sentence when the verb itself lands in a different
  clause via the existing action-word boundary.

`CreateRecipeScreen`'s `mergeCookingDraft()` (`ChefVoiceApp.kt`) fills
`title`/`prepTimeText`/`cookTimeText` from the parsed draft the same way it
already merges ingredients/steps -- only into a field the chef hasn't typed
into yet, appending a one-line "Detected ..." note to the existing capture
status message when it does. `RecipeDetailScreen` (the already-saved recipe
view) is unchanged; prep/cook time there remains manual-entry only, same as
`PREP_COOK_TIME_0.9.14.md` shipped it.

`CookingDraft` gains `title: String = ""`, `prepMinutes: Int? = null`,
`cookMinutes: Int? = null` alongside the existing `ingredients`/`steps`.

No Firestore/Storage rules, Functions, Live, App Check, or billing changes.
`shared/golden-cooking-corpus.tsv` is untouched -- title/prep/cook time is
not part of that cross-platform ingredient/step contract, so the new
coverage lives as ordinary `@Test` functions in `GoldenCookingCorpusTest.kt`
next to the existing real-device fixtures, mirroring exactly where the
equivalent PWA tests landed in `real-device-fixtures.test.mjs`/
`parser.test.mjs`.

versionCode 68, versionName 0.11.7.

## Validation

- `gradlew.bat :app:testDebugUnitTest --tests "com.chefvoice.app.voice.GoldenCookingCorpusTest"`:
  all existing corpus/fixture tests plus 15 new ones (title extraction
  including the real hamburger/nachos fixtures extended to also assert on
  title/cook time, the prep/cook estimate, the direct spoken statement, and
  the three ingredient fixes reproduced as their own regression cases).
- Full `gradlew.bat :app:testDebugUnitTest` re-run to confirm no regression
  elsewhere in the suite.
- Not deployed/installed to a device this session -- source-level parity
  change only, mirrors the already-live PWA behavior.

## Deploy

Normal `BUILD_AND_INSTALL.cmd` entry point. No backend deploy scripts
involved.
