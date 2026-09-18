# Step timers, hands-free cooking, shopping list, scaling, collections — 0.11.14

Android `versionCode 75` / `versionName 0.11.14`. Android only this release; see
**Platform scope** at the end for why.

Five features, all built on structure the deterministic parser already produces. None of
them changes the parser, the corpus, the cloud, or any security rule.

## 1. Tappable timers from durations the chef already said

`util/StepTimers.kt` reads the durations out of a finished method step, and the
cook-along screen offers each one as a timer chip. Tapping one starts a countdown with
pause, cancel, and a spoken "timer finished" when it ends, since the chef's hands are
busy and they may not be looking at the screen.

It handles what chefs actually say: "20 minutes", "45 seconds", "1 1/2 hours", "10 mins",
"fifteen minutes", "half an hour", and ranges like "10 to 12 minutes" or "5-7 minutes".

**A range times the lower bound.** "Simmer 10 to 12 minutes" calls the chef back at 10,
while there is still a decision to make, rather than at 12 when it has been made for
them. The chip still shows the full range the chef said.

**This is a read-only extractor, deliberately outside `CookingSessionParser`.** It never
edits a step, never contributes to what is saved, and running it or not cannot change a
single row of `shared/golden-cooking-corpus.tsv`. The parser's own duration code is not
reused: it sums one duration per step for the prep/cook estimate, while a timer needs
every duration in a step along with where in the text it sits.

It is as literal as the rest of the pipeline. A bare number with no time unit is not a
timer — "add 2 cups of flour", "preheat to 350 degrees" and "cut into 4 pieces" all offer
nothing — and a step with no stated duration simply has no chip rather than a guessed
one. A wrong timer calls the chef back at the wrong moment and they trust it, so the
failure mode is always "no timer offered".

## 2. Hands-free step advance

A toggle on the cook-along screen listens for a short spoken command: **next**, **back**,
**repeat**, **start timer**, **stop timer**, **stop listening**, plus the natural
variants ("go back", "say that again", "cancel timer") and one leading politeness marker
("ok next", "chef voice next step").

**Nothing said to it is recorded, transcribed, kept or parsed.** `CookCommandListener`
shares no code with the capture pipeline. Each recognition result is matched against a
fixed vocabulary in `util/CookCommands.kt` and then discarded.

**Matching is literal, and that is the point.** A command word buried in a sentence is
ignored: "the next thing you want to do is add the garlic" contains "next" but is
narration, not an instruction to the phone. A kitchen is full of speech that is not
addressed to the device, and a screen that jumps to another step mid-recipe is far worse
than one that makes a chef say "next" twice.

Stepping commands may fire on a partial recognition result, because moving between steps
is instantly reversible and acting early feels responsive. Anything that *stops*
something waits for a final result — a half-heard "stop" is the one mistake a chef cannot
undo by just repeating themselves.

The screen is also held awake for the whole cook-along, not just during capture.

## 3. Shopping list

`util/ShoppingList.kt` turns structured ingredients into a list, so a chef never retypes
what they narrated. Reached from the library, with a count of what is still to buy.

**The merge rule is deliberately narrow.** Two lines combine only when they name the same
thing, are measured in comparable units, *and* both quantities can be read as numbers.
"2 cups flour" + "1 cup flour" becomes "3 cups flour"; "2 cups flour" + "200 g flour"
stays as two lines, because turning volume into weight needs to know what the ingredient
is. A list with a duplicate on it is a small annoyance; one with a silently wrong total
sends the chef to the shop to buy the wrong amount and they find out while cooking.

Unit spellings fold together ("tbsp" = "tablespoons") and singular/plural names match
("Onions" = "onion"), but nothing beyond that — "scallion" and "green onion" stay
separate even though Second Pass treats them as comparable, because merging them would
change what has to be bought.

Merging into a line the chef had already ticked off **un-ticks it**: there is more to buy
now, so it must not stay silently satisfied. Ticked lines stay visible rather than
vanishing, because a chef in a shop wants to see what is already in the basket; they are
cleared explicitly with "Clear basket". Swiping a line removes it, and the list shares as
plain text.

## 4. Serving scaling and unit conversion

A servings stepper and an As written / Metric / Imperial toggle on the recipe screen.

**Both are a view, and never written back.** A chef who narrated "two cups of flour" said
two cups, and the saved recipe keeps saying two cups no matter where the stepper is — the
same rule the parser and Second Pass follow, for the same reason. The card says so on
screen when a recipe is being shown scaled.

Both fail soft: a quantity that cannot be read ("a pinch", "to taste", blank) passes
through completely untouched rather than being dropped or guessed at, so scaling can
never lose an ingredient. Scaled amounts come back as fractions a cook would write —
halving 3 cups gives "1 1/2", not "1.5" — and conversions step up to the larger unit once
they earn it, so 454 g reads "1 lb" and not "16 oz".

**Volume is never converted to weight.** A cup of flour and a cup of honey do not weigh
the same, so a cup becomes millilitres and never grams. Units with no unambiguous
conversion are left exactly as the chef said them, and the UI says so.

## 5. Collections

Chef-named groups of their own recipes — "Weeknight", "Thanksgiving" — as filter chips on
the library, with an "Add to a collection" picker on each owned recipe.

**Local to the device, by design.** Cloud bookmarks already cover saving *other* chefs'
dishes; this is the chef's own filing of their own library, so it needs no Firestore
collection, no security rule and therefore **no rules deploy**, and it keeps working
signed out.

"All" is always the first chip and always returns the whole library, so a collection can
never make recipes look like they have gone missing. Deleting a collection removes the
grouping only — every recipe in it stays in the library, and the menu item says so.
Recipe ids that no longer resolve are skipped at read time rather than pruned, so
deleting a recipe cannot corrupt a collection that mentioned it.

## Platform scope

Android only. Step timers and hands-free have nowhere to go on the PWA yet: it has no
cook-along screen at all (its routes are recipes, inbox, live and profile), so porting
them means building that screen first, which is a larger piece of work than a port. The
shopping list, scaling and collections could be ported on their own and are the obvious
next parity step.

## What did not change

- **The parser.** `CookingSessionParser.kt`, `IngredientParser.kt`, the JS ports and
  `shared/golden-cooking-corpus.tsv` were not touched. `GoldenCookingCorpusTest` still
  passes all 24 tests.
- **`firestore.rules`, `storage.rules`, `firestore.indexes.json`** — no edits, nothing
  deployed. Collections and the shopping list are local, so neither needed a rule.
- **Cloud Functions.** Neither codebase was changed.
- **Live/WebRTC**, and **App Check**, still monitoring-only.
- **ChefVoice Review**, including the 5-minute cap and cleanup from 0.11.13.
- **The PWA.** No `web/` file changed, so PWA version stays at 0.5.12.

## Gates

Android `:app:testDebugUnitTest` — 106 tests, 0 failures:

| Suite | Tests |
| --- | --- |
| `StepTimersTest` | 12 |
| `IngredientScalingTest` | 16 |
| `ShoppingListTest` | 12 |
| `CookCommandsTest` | 7 |
| `GoldenCookingCorpusTest` | 24 (unchanged) |
| `SecondPassReviewerTest` | 19 (unchanged) |
| others | 16 |

`:app:assembleDebug` builds clean, and the two `SwipeToDismissBox` call sites were moved
off the deprecated `confirmValueChange` in the same pass.

**Not yet verified on a device.** The five features' logic is unit-tested, but the
gestures, the voice commands and the running timer are UI behavior that needs a real
device — in particular hands-free, whose recognizer behavior cannot be exercised by a
unit test at all. That is the next check before this ships.
