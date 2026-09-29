# Cook-along for a real kitchen (PWA 0.5.21, Android 0.11.20 / 81)

Audit finding **F21**: the cook-along is the screen used mid-cook, at arm's length, with greasy
hands, and it was laid out like any other screen. Both platforms change. Committed on
`claude/audit-implementation-2026-09-28-e6a4a5`. **Not deployed yet**, and **no backend change**:
PWA 0.5.21 ships with `DEPLOY_PWA.cmd`, and Android 0.11.20 needs a release build (see the end).

**Not touched:** the parser (`voice/`, `web/js/*parser*`) and the golden corpus,
`firestore.rules`, `storage.rules`, every Functions codebase, `transcribeChefVoice`, Live
signaling, App Check. No new permission and no new data, so no Play Console answer changes.

## What the chef sees

| | Before | Now |
|---|---|---|
| Step text | PWA 20 px on a phone; Android 28 sp | PWA 28 px on a phone (30 px wider), Android 28 sp |
| Next | Same size as Previous (PWA 46 px tall), below the step | 72 px/dp tall, about twice as wide as Previous, docked at the bottom of the screen |
| Long step | PWA: Next scrolled away. Android: the screen did not scroll, so a long step pushed Next and Previous off the bottom | The step scrolls; the dock stays |
| Tab bar (PWA) | Shown, so a mis-tap on Live or Inbox left the recipe, and its timer and wake lock with it | Hidden while cooking; the back button at the top still leaves |
| Ingredients | Not on the screen | "In this step" lists what the step names, with amounts; "All ingredients" is one tap away |
| Servings and units | Cook-along always showed the recipe as written | It uses the servings and units set on the recipe screen, and says so |
| Community recipes (PWA) | No servings stepper or unit switch | Same stepper and switch as the chef's own recipes |

Android already hid its tab bar while cooking and already offered scaling on Community recipes,
so those two rows were PWA-only.

**The last step keeps its button**, disabled and reading "Last step". A Done button there would
end the cook-along, and any timer running in it, on the tap after the last Next.

**Amounts carry over, the step does not change.** "Add two cups of flour" still says two cups at
four servings, so when the amounts beside it are scaled or converted, the card says
"Amounts for 4 servings (the chef cooked 2). The step reads as the chef said it." The recipe
screen's setting now survives the cook-along on Android too: it lived in the recipe screen, which
leaves composition while cooking, so coming back reset it. It is held in `ChefAppState.recipeView`
now, one recipe at a time, like the PWA's `recipeView`.

**On the PWA, the Community stepper redraws only the ingredients.** Redrawing the whole recipe would
blank the comment thread and wipe a half-written comment.

Accessibility, both platforms: TalkBack and screen readers hear the new step when Next or a spoken
command changes it (not while read-aloud is already saying it); "In this step" is a heading; the
All-ingredients toggle says Expanded or Collapsed; the PWA keeps focus on the button just pressed,
or moves it to the step when that button becomes disabled; a new step scrolls back to its first
word.

## Which ingredients a step names

`util/StepIngredients.kt` and its port `web/js/step-ingredients.js`. A read-only view, like the
step timers: it never edits a step or an ingredient, never contributes to what is saved, and is
not the parser. The golden corpus cannot move because of it.

It is literal on purpose:

- **Whole name, or the end of one.** "the olive oil" and "the oil" both name olive oil; "the
  onion" names diced onion. Singular and plural match ("onions", "tomatoes", "cherries",
  "bay leaves"), accents and hyphens are ignored ("jalapeno", "all purpose flour"), and whole
  words only ("eggplant" does not name egg).
- **An end that belongs to two ingredients names neither.** "Heat the oil" with olive oil and
  sesame oil, "season with pepper" with black pepper and bell pepper, "brown the chicken" with
  breasts and thighs: nothing is shown rather than a guess.
- **Longest first.** "kosher salt" is the kosher salt, not also the salt; "lemon pepper" is not the
  pepper; a whole name beats the end of another.
- **Some words never count alone**, because they usually mean something the chef made or did, not
  something they bought: sauce, mixture, mix, batter, dressing, filling, glaze, marinade,
  seasoning, cream (the verb), topping, juice (pan juices), and cut shapes. "Simmer the sauce"
  does not name the hot sauce; "cream the butter and sugar" does not name the heavy cream.
  The whole name still counts: "add the hot sauce".
- **Descriptions are not names.** What follows a comma or sits in brackets is dropped ("butter,
  softened", "onion (diced)"), as are trailing words like "for garnish" and "to taste".
- **The part is the thing.** "garlic cloves" is named by "the garlic", "chicken breasts" by "the
  chicken", "cinnamon stick" by "the cinnamon".

A missed ingredient costs the chef a glance at the full list, which is one tap away. A wrong one,
shown with its amount beside the step, is one they might add, so every rule errs towards missing.
Known limit: a recipe whose ingredient is named just "Cream" will show it beside "cream the
butter", because a whole name always counts.

**`shared/step-ingredients.tsv` is the contract** both platforms are tested against: 47 rows,
each an ingredient list, a step, and the ingredients it should name in order. Run over every real
narration in the golden corpus, the matcher picks out what a cook would (the burger fixture's
"season your ground beef patties" names the ground beef; "take the salt, pepper, garlic and lemon
pepper" names all four, lemon pepper once).

## Tests

- **PWA 337 / 0** (285 before): `tests/step-ingredients.test.mjs` runs the shared fixture plus
  edge cases. The matcher was broken 19 ways (each word list, the ambiguity rule, longest-first,
  whole names over endings, the comma cut, the bracket removal, accents, plurals, mention order,
  whole words). The first fixture let three through: the comma cut, the bracket removal and the
  weak-word check on a part's name. Four rows were added, and now every break is caught.
- **jsdom 74 / 35 / 18 / 46**: new `tests/recipe-scaling.dom.mjs` drives a Community recipe's
  stepper and unit switch in the real app.js code: the amounts scale, the comments are not
  redrawn, a half-written comment survives, and the shopping list's Back returns to the recipe.
- **e2e 26 / 0** (19 before): new `e2e/cook-along.spec.mjs` at phone size: no tab bar while
  cooking and back afterwards; Next at least 64 px tall, much wider than Previous, with larger
  type, still in place after scrolling, with nothing hidden behind it; a new step scrolls to the
  top; the step text is at least 28 px; the step's ingredients and the collapsed full list; the
  recipe screen's servings carry over and are named; keyboard focus follows Next; both labels fit
  on one line at 320 px. Twelve one-line breaks of the screen are each caught. Two got through
  the first version of the spec. One was extra bottom padding, which was dead (the shell's own
  padding already clears the dock) and was removed. The other was the scroll back to the top,
  which passed because the next step was short; the spec now uses two long steps.
- **Android 239 / 0, 2 skipped** (226 / 0 and 2 skipped before; the skipped two are the opt-in
  renderer, which also passes when asked to run): `StepIngredientsTest` (the same shared fixture) and a new Robolectric `CookAlongTest`
  (8): no tab bar; Next at least 64 dp, docked, still on screen under a long step, much wider than
  Previous; a new step back at its top; the last step keeps a disabled button; the step's
  ingredients and the full list; TalkBack's live region; the view carried in from the recipe
  screen, and kept after cooking; and both dock labels whole on a 360 dp phone. Thirteen
  one-line breaks of the screen are each caught.
- **`CookAlongTest` runs on Robolectric's native graphics**, because this screen's rules are about
  size and position. The default graphics measure every line of text a few pixels wide: a long
  step was not long, so removing the scroll back to the top got through, and a clipped label was
  not clipped.
- **Two defects found by looking, not by the tests.** `RenderScreensTest` drew the Android dock
  reading "Previou": Material's 24 dp of padding a side left the label too little room. The label
  check now fails on the old button ("needs 128.5 px and its button gives it 101 px"). On the PWA,
  Next's larger type lost to a more specific rule; the spec now compares the two sizes.
- Notification gates **78 / 0**, billing **17 / 0**, import **98 / 0**.

## To release

**PWA 0.5.21:** `DEPLOY_PWA.cmd`, after `DEPLOY_SHARE.cmd`: 0.5.21 also carries the shared-link
previews (`SHARE_LINK_PREVIEWS_0.5.21.md`), and `DEPLOY_PWA.cmd` refuses to deploy until their
function is live. Then on a phone: open a recipe, cook it, and check that the tab bar is gone and
Next is the big button at the bottom; open a Community recipe and change its servings.

**Android 0.11.20 / 81 includes everything in 0.11.19 / 80**, which was never released. If 0.11.19
has not been uploaded yet, build 0.11.20 instead, from the shell that holds the
`CHEFVOICE_RELEASE_*` variables, and run the six steps at the end of
`ACCESSIBILITY_AND_DARK_MODE_0.5.19_0.11.19.md`, plus:

7. Cook a recipe with a long step: the text scrolls, Next stays at the bottom, and both buttons
   read in full.
8. A step that names an ingredient shows it with its amount. Set four servings on the recipe
   first: the amounts double, the card says so, and Back still shows four servings.
9. With TalkBack on, tapping Next reads the new step.
