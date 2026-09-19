# PWA parity, stage 2 — cooking from a recipe (PWA 0.5.15)

Stage 1 (PWA 0.5.14, commit `0d5ee21`) ported the four pure modules Android's cooking
features are built on — step timers, hands-free commands, ingredient scaling and the
shopping list — but nothing imported them, so they changed nothing for a chef. Stage 2 is
the user interface on top of them: the PWA can now be cooked from, not just read.

The rule for every port here is the same one the corpus enforces for the parser: the PWA
does what Android does, in the same words, with the same refusals. Where Android declines to
guess — a timer only for a duration the chef actually stated, a unit only where the
conversion is unambiguous — the PWA declines in exactly the same place, because the logic is
the same ported module.

## What a chef gets

**A cook-along screen.** "🍳 Cook this recipe" on a saved recipe, on a Community recipe, and
directly on a Recipes-tab card. One method step at a time in large type, Previous/Next, and:

- **The screen is held awake** through the Wake Lock API while the screen is open, and the
  lock is taken again when the chef comes back to a tab the browser suspended. A phone that
  sleeps mid-recipe with flour on the chef's hands is the whole problem this solves.
- **Read steps aloud**, through `speechSynthesis`, split from **Say this step again** exactly
  as they were split on Android in 0.11.15: repeat says the current step once, reading aloud
  is a mode that follows the chef from step to step.
- **Tappable timers, only from durations the chef stated in that step.** "Simmer for 20 to 25
  minutes" offers one timer at 20 minutes — the lower bound, so the chef is called back while
  there is still a decision to make. A step with no stated duration offers no timer rather
  than a guessed one. A finished timer says so out loud as well as showing it, because the
  chef may not be looking at the screen.
- **Hands-free**, through `SpeechRecognition` where the browser has it. Matching is the
  ported `matchCommand`: a phrase either *is* one of the commands or it is nothing. Only
  reversible commands (next, back, repeat, read aloud) may fire on an interim result;
  everything that stops something waits for a final one, because a half-heard "stop" is the
  one mistake a chef cannot undo by saying the word again. A refused microphone turns
  hands-free back off and says why, instead of retrying in a loop.

**A servings stepper and As written / Metric / Imperial**, on the saved-recipe detail. Both
are **display only** and neither is ever written back: the header still reads the servings
the chef narrated, and the panel says "the saved recipe is unchanged" whenever it is scaled.
A quantity that cannot be read as a number — "a pinch", "to taste" — passes through
untouched, and volume is never converted to weight.

**A shopping list**, reachable from the Recipes tab with the count still to buy on the
button, and from the confirmation after adding a recipe. Ingredients arrive already measured,
scaled the way the chef is currently viewing them but in the chef's own units, and matching
lines are added together only when that is certainly safe — same thing, comparable units,
both quantities readable as numbers. Ticked lines stay on the list, struck through and sorted
to the bottom, so a chef in a shop can see what is already in the basket; they are cleared
explicitly, in one go. The list can be shared through `navigator.share`, falling back to the
clipboard.

**Collections** — the chef's own filing of their own library. Chips on the Recipes tab filter
it; a picker on each recipe files it. Deliberately local to this browser, for the same reason
they are local on Android: cloud bookmarks already cover saving *other* chefs' dishes, so
collections need no Firestore collection, **no security rule and no rules deploy**, and they
keep working for a chef who is signed out. A recipe id that no longer resolves is skipped at
read time rather than pruned, so deleting a recipe can never corrupt a collection.

## What did not change

- **The parser is untouched.** No file under the voice pipeline, and no corpus row, was
  edited. `shared/golden-cooking-corpus.tsv` and both parser ports are byte-identical.
- **No Firestore rules change and no deploy of anything but Hosting.** Collections and the
  shopping list are `localStorage`; nothing new is written to Firestore.
- **Android is untouched** — no `app/` file changed and `versionCode` stays at 77 / 0.11.16.
- **Cloud Functions, Live/WebRTC and App Check are untouched.** App Check stays
  monitoring-only.
- Cooking from a Community recipe **reads** it; it does not copy it into the chef's library.

## Files

New, all ports with their Android source named at the top:

- `web/js/collections.js` — the collections half of `ChefAppState`.
- `web/js/cook-along.js` — `CookingScreen`'s state handling, as pure functions, so what
  "next" does at the last step or when a timer may start is testable without a browser.
- `web/js/shopping-list.js` gained `additionMessage`, the wording `addRecipeToShoppingList`
  reports back.
- `web/js/storage.js` gained `loadCollections`/`saveCollections` and
  `loadShoppingItems`/`saveShoppingItems`. A corrupt or missing value reads as empty and a
  failed write is swallowed, so neither can lock a chef out of the app in a kitchen.

Changed: `web/js/app.js` (the screens and their bindings), `web/css/styles.css`, `web/sw.js`
(cache bumped to `v0.5.15`, new modules precached), `web/package.json`.

## Tests

PWA **227 tests / 0 failures** (183 before): `tests/collections.test.mjs` (14),
`tests/cook-along.test.mjs` (27) and three additions to `tests/shopping-list.test.mjs`.

Both optional jsdom checks were **broken before this change** and are now green again:

- `tests/recipes-list.dom.mjs` threw `savedCookbookTemplate is not defined` from 0.5.14,
  which moved that function above the slice the test takes out of `app.js`. The slice now
  starts at `savedCookbookTemplate`, the real collection helpers are used rather than stubs,
  and 13 new checks cover the shopping shortcut's count, the chips filtering, "Cook" being
  offered only for a recipe that has steps, and an empty collection reading as an empty
  collection rather than an empty library. 46 checks.
- `tests/cook-wizard.dom.mjs` threw `SecondPassLimits is not defined` from the 0.11.14 review
  cap. It now imports that constant. 74 checks.

## Verified in a browser

Run against `web/` on `localhost:4173` in the Browser pane, at a 375×812 phone viewport:
scaling 2 cups → 3 cups at 6 servings and → "709 3/4 ml" in Metric while the header still
read "Serves 4"; the list receiving those four lines in the chef's own units; ticking,
striking through and re-sorting a line; a two-minute timer counting down and then holding at
1:57 while paused; a two-second timer reaching zero and flipping the card to "⏰ 2 seconds is
up" with Pause replaced by Clear; hands-free degrading to "Hands-free needs microphone
permission" with no restart loop when the pane refused the microphone; and cooking a
Community recipe and returning to it.

**One real bug was found this way and fixed**: the tick box on a shopping line was wrapped in
its own `<label>`, so every click reached it twice — once directly, once forwarded by the
label — and the line landed back where it started. The box is now a sibling of its label,
which also gives each one an accessible name.

## Deployed

`firebase deploy --only hosting:pwa --project chefvoice-d7fec`, after the same two tripwires
`DEPLOY_PWA.cmd` applies (both Hosting targets still declared in `firebase.json`) and the PWA
gates. 32 files, Hosting only — Functions, Firestore rules, Storage rules, App Check and the
`chefvoice-delete-account` site were not touched.

Then verified against the **deployed** client at https://chefvoice-d7fec.web.app/, per the
rule this project has used since 0.5.11: `sw.js` reports `chefvoice-pwa-v0.5.15`, all six
cooking modules return 200, and cooking a recipe there started a timer that counted down.
The throwaway recipe used for that check was deleted from the browser afterwards, and nothing
was published.

## Still to do

Stage 3 (swipe-to-save on Community cards, notification ✕ / swipe-to-clear) and stage 4
(recipe import, which needs a server-side fetch because the browser blocks the cross-origin
read — a new Cloud Function, and therefore James's approval). Not ported: "Play chef's voice"
inside the cook-along, and scaling on a *Community* recipe detail, neither of which Android
offers either.
