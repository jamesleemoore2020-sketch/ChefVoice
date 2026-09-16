# ChefVoice Review autofills Recipe Details + "going to do X" titles — PWA 0.5.9 / Android 0.11.11

Third round on the same live report. Cook time now filled correctly (Cook min = 1 from
"let it cook for 1 minute" — the 0.5.8 fix working), but the recipe name was still blank and
the chef asked for the details to fill without having to press "Use second pass".

## 1. "we going to do my famous top ramen" produced no title

The title verb list was `making|make|cooking|cook`. This capture used **"do"**:

> "So today we going to **do** my famous top ramen. ..."

"Do" is an ordinary way to announce a dish, so `doing|do` joins the verb list on both paths —
the auxiliary path (`I'm/we're [going to] do X`) and the narrower dropped-copula path, which
still requires `going to`/`gonna` plus a mandatory pronoun. The title is now
"Famous top ramen".

This is the third phrasing of the same announcement to miss in as many rounds
("we going to make", "we're going to cook", "we going to do"), which is the cost of the verb
list being explicit. That explicitness is deliberate — it is what keeps "we going to cook our
ground beef for 10 mins" an instruction rather than a title — so the list gets extended per
real phrase rather than loosened into a general "pronoun + any verb" rule.

## 2. Recipe Details now fills without an accept click

Previously (0.5.8) the review's detected title/prep/cook were applied when the chef **accepted**
a suggestion. Requested change: fill as soon as the review returns.

`runCaptureSecondPass()` now calls `applyDetectedRecipeMeta(result)` on success, and the
detection note becomes the review's status message.

This does not weaken the "explicit, opt-in review, never automatic correction" rule that
governs Second Pass:

- Running ChefVoice Review is itself the explicit opt-in.
- Only **Recipe Details** fills, and only into fields the chef left **empty**. A name or time
  they typed is never overwritten — covered by a test.
- **Ingredient and method wording still require "Use second pass".** Nothing the chef
  recorded is silently rewritten; "Keep current" remains the alternative for all recipe
  content. Also covered by a test asserting the autofill leaves `ingredients` and `steps`
  untouched.

## Tests

- `web/tests/parser.test.mjs` / `GoldenCookingCorpusTest.kt` — a dropped copula announces a
  title for "do" as well as "make", and still not for "cook".
- `web/tests/cook-wizard.dom.mjs` — the review fills name and cook time with no accept click;
  the autofill does not touch ingredients or steps; a manually typed recipe name survives it.

Gates: PWA 120/120, cook-wizard DOM 70/70, Android `:app:testDebugUnitTest` green.

## Not changed

Parsing stays fully deterministic — no LLM, no guessing, no silent rewriting of what the chef
said. Ingredient parsing, prep/cook estimation, Firestore and Storage rules, Functions,
Live/WebRTC, billing and App Check (still monitoring-only) were untouched. The Android parser
change is the title verb list only; Android has no pre-save review, so the autofill change is
PWA-only.
