# ChefVoice Review now fills Recipe Details — PWA 0.5.8

Reported live on Android Chrome right after 0.11.10 shipped: cook time and recipe name
were *still* blank. The earlier fixes were real but addressed a different path.

## What actually happened

The screenshots show the chef went through **ChefVoice Review**, and the review header read
"**0 confirmed · 5 to review**" — live recognition had caught essentially nothing usable. So
capture-time detection ran against a near-empty transcript, found no recipe name and no cook
time, and correctly left both blank.

ChefVoice Review then returned the real transcript:

> "Okay, so today we're going to cook my famous top ramen meal. We start with one pack of top
> ramen, 1 tbsp of salt, 1 tbsp of pepper, and then you're going to let it cook for 2 minutes
> and you serve it up."

Parsed on its own, that transcript already yields `title: "Famous top ramen meal"` and
`cookMinutes: 2`. The parser was never the problem here either.

The gap was in the wiring: `rebuildCaptureSecondPass()` ran `applySuggestion` /
`applyMethodSuggestion` and rebuilt the review, but `applyDetectedRecipeMeta()` was only ever
called from `toggleCapture()` (capture finished) and the Transcript-recovery `#reanalyze`
button. Accepting review suggestions therefore filled Ingredients and Method and nothing else,
leaving Recipe Details permanently blank whenever the live transcript was the bad one — which
is precisely when a chef reaches for the review in the first place.

## Fix

`fromCloudTranscript()` already parses the second-pass transcript internally to build its
suggestions; it now also returns that parse's `title`, `prepMinutes` and `cookMinutes`, so the
caller does not parse the same transcript twice. `rebuildCaptureSecondPass()` passes that
result to `applyDetectedRecipeMeta()`.

Timing is deliberate. Detection is applied when the chef **accepts** review content, not when
the review merely returns results — ChefVoice Review stays explicit, opt-in review rather than
automatic correction. And `applyDetectedRecipeMeta()` still only fills fields the chef has left
empty, so a name or time they typed themselves is never overwritten.

Android needs no equivalent change: it has no pre-save review (`captureSecondPass` is
PWA-only). Its review runs against an already-saved recipe, which by then has its title and
times.

## Tests

`web/tests/cook-wizard.dom.mjs` gained four checks covering this exact report: review results
alone leave Recipe Details untouched, accepting review content fills the spoken recipe name and
cook time, and those values reach the mounted Recipe Details inputs. Confirmed failing against
the pre-fix `app.js`.

Gates: PWA 120/120, cook-wizard DOM 68/68, Android `:app:testDebugUnitTest` green (unchanged).

## Not changed

No parser change in this release — `cooking-session-parser.js` and `CookingSessionParser.kt`
are untouched, and parsing stays fully deterministic. Firestore and Storage rules, Functions,
Live/WebRTC, billing and App Check (still monitoring-only) were untouched. Android
versionCode/versionName are unchanged at 71 / 0.11.10; this is a PWA-only release.
