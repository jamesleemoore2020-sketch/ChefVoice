# ChefVoice Review auto-applies missed ingredients — PWA 0.5.10

Requested after 0.5.9 confirmed working live ("Detected title 'Famous top ramen', 2m cook"):
ingredients the review heard should go in on their own, with no "Use second pass" button.

## What is now automatic

Only issues of type **`possible-missed-ingredient`**. That kind exists precisely for an
ingredient the live transcript never caught at all, so applying it is **purely additive** — it
cannot overwrite a value or drop anything the chef recorded. Those are applied as soon as the
review returns, the review is rebuilt against the updated ingredient list so the resolved cards
disappear instead of lingering, and the status line reports what happened
("Added 3 ingredients ChefVoice Review heard.").

## What still requires "Use second pass"

Everything that changes or discards what was actually said:

| type | why it stays manual |
| --- | --- |
| `quantity-change` | overwrites a quantity the chef recorded |
| `ingredient-name-cleanup` | rewrites a name the chef recorded |
| `remove-live-artifact` | deletes an ingredient |
| `live-only-low-confidence` | flags an ingredient for removal |
| `method-wording-disagreement` | rewrites a cooking step |
| `possible-missed-step` | adds a method step |
| `live-only-step` | flags a step |

This keeps the Second Pass contract intact where it matters: the chef's own recorded content is
never silently rewritten or deleted, and "Keep current" stays a real choice for all of it.
Method steps were deliberately left manual even though `possible-missed-step` is also additive
— the request named ingredients, and a wrong auto-inserted instruction is more disruptive to a
recipe than a wrong ingredient row, which reads as an obvious extra line.

`possible-missed-step` remains a one-line change if the same treatment is wanted for method.

## Analytics

Auto-applied ingredients deliberately do **not** fire `ChefAnalytics.secondPassAccepted` —
nothing was accepted by the chef, and counting them would inflate the acceptance metric. That
event still fires for every issue the chef accepts by hand.

## Tests

`web/tests/cook-wizard.dom.mjs`:
- an ingredient the live pass missed fills the draft with no accept click, and its card resolves
  rather than lingering;
- method wording is never auto-applied and still offers an accept;
- a disagreeing quantity (chef has 3 tbsp salt, review heard 1 tbsp) is **not** overwritten and
  is still offered for review;
- the existing flour scenario updated, since that suggestion is now automatic.

Gates: PWA 120/120, cook-wizard DOM 74/74, Android `:app:testDebugUnitTest` green.

## Not changed

No parser change. Firestore and Storage rules, Functions, Live/WebRTC, billing and App Check
(still monitoring-only) untouched. Android is unchanged at versionCode 72 / versionName
0.11.11 — it has no pre-save review, so this is PWA-only.
