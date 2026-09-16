# Recipe title from a dropped copula — 0.11.10

Follow-up to `COOK_TIME_AND_LET_IT_TAIL_0.11.9.md`, which deliberately left this open.

## Why the title was blank

From the same real Android Chrome capture:

> "So today **we going to make** my famous top ramen meal. ..."

`titleMakingPattern` required a pronoun **and** an auxiliary (`I'm` / `we're` / `I am` /
`we are`). This chef dropped the copula — "we going to make", not "we're going to make" —
which is both ordinary casual speech and a very common ASR output. So the announcement was
not recognized and the title stayed empty.

That requirement was not arbitrary. The comment above the pattern explains it guards against
a bare imperative like "make four burger patties", a real mid-recipe instruction, being read
as a title. The dropped-copula case is genuinely different: the pronoun is still there, so
the guard's actual concern does not apply.

## The trap in the obvious fix

Simply making the auxiliary optional regressed an existing fixture. The prep/cook estimate
test narrates:

> "we going to chop up our veggies thats going to be 5 mins" /
> "**we going to cook** our ground beef for 10 mins" / "than stir and cook for another 10 mins"

With the auxiliary optional, "we going to cook our ground beef for 10 mins" matched as a title
announcement. That did double damage: a nonsense title, *and* `isTitleAnnouncementStep()` then
removed that step, dropping `cookMinutes` from 20 to 10. Caught by
`estimates prep and cook minutes from chop/cook verbs with stated durations`.

## What shipped

The auxiliary is optional only on a deliberately narrower second path:

- **With** an auxiliary: unchanged — `making|make|cooking|cook`, `going to`/`gonna` optional.
- **Without** an auxiliary: `going to`/`gonna` is now **mandatory**, and the verb must be
  `make`/`making`. "we going to cook X" therefore stays an instruction.

The pronoun stays mandatory on both paths, so a bare imperative is still rejected.

A leading "my" is now stripped from the captured title the same way `a`/`an`/`the`/`some`
already were, so the result is "Famous top ramen meal" rather than "My famous top ramen meal".
`isTitleAnnouncementStep()`'s restatement pattern gained a matching optional `my`, so the
spoken announcement is still recognized as a restatement and does not survive as a bogus first
method step — without that, stripping "my" would have left "Make my famous top ramen meal." in
the Method list.

Because this changes an established expectation, the existing "today I'm making my famous
chili" test now expects `Famous chili` on both platforms.

## Tests

- `web/tests/parser.test.mjs` / `GoldenCookingCorpusTest.kt` — a dropped copula announces a
  title for "make" but not for "cook"; the updated `my famous chili` expectation.
- `web/tests/real-device-fixtures.test.mjs` / `GoldenCookingCorpusTest.kt` — the ramen fixture
  now also asserts the title and that the announcement does not survive as a method step.

Gates: PWA 120/120, Android `:app:testDebugUnitTest` green.

## Not changed

Parsing stays fully deterministic — no LLM, no guessing. Ingredient parsing, prep/cook
estimation, Second Pass / ChefVoice Review, Firestore and Storage rules, Live/WebRTC, billing
and App Check (still monitoring-only) were untouched.
