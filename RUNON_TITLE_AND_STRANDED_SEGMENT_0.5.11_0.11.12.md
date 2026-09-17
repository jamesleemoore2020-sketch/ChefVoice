# Run-on title announcement and stranded duration segment — PWA 0.5.11 / Android 0.11.12

Two deterministic parser fixes, both found by running the **signed R8 release build**
(`ChefVoice-v0.11.11-Production`, code 72) on a real device and narrating a short recipe.
Neither was a regression: the parser at `522c433`, immediately before session 4's title
work, produces byte-identical output for the same transcript. Both losses were triggered
by on-device speech recognition errors, and both were losing the chef's recorded content.

## The capture

Spoken into the release build on a Galaxy S25 Ultra (SM-S938U, Android 16):

> "I'm going to make my famous top ramen meal. You add two teaspoons of salt.
> Then sauté the garlic for five minutes. Let it cook for ten minutes."

What the recognizer actually returned, and what the parser was given:

| t | recognized text |
|---|---|
| 01:03 | `I'm going to make my famous top romantle` |
| 01:06 | `You had two tablespoon of salt` |
| 01:10 | `Then so I tell you the garlic for five minutes` |
| 01:12 | `Let it cook for 10 minutes` |

Three separate mishearings — `ramen meal` → `romantle`, `add` → `had`, `sauté` → `so I tell you`.
The parser is not allowed to correct any of them, and it does not. But two of them made it
*delete* content, which is a different failure and the subject of this change.

## Bug 1 — a run-on title announcement swallowed the next instruction

Before:

```
1. Make my famous top romantle you had two tablespoon of salt.
2. Cook for 10 minutes.
```

`isTitleAnnouncementStep()` suppressed a step only when the step was **entirely** the title
restatement — the pattern was anchored `^…${title}$`. That holds when the announcement lands
in its own segment, which is the case 0.11.10's `(?:my\s+)?` fix was built against.

Here it did not. `had` is not a step-start verb, so "You had two tablespoon of salt" never
opened a step of its own; it ran on from the announcement. The combined step no longer matched
the anchored pattern, so the announcement survived — as a redundant first method step that also
buried a real instruction inside it.

The fix drops the trailing `$` anchor and strips the announcement as a *prefix*:
`isTitleAnnouncementStep()` becomes `stripTitleAnnouncement()`, returning the remainder. A step
that is only the announcement still disappears, exactly as before; a step that continues past it
keeps everything after it, sentence-cased. The announcement is removed, the instruction is not.

## Bug 2 — an unclassifiable segment was discarded outright

"Then so I tell you the garlic for five minutes" produced **no step at all**. In
`collectSegmentAwareSteps()`, a segment with no recognized method clause, no ingredient, no
duration-only continuation and no `methodContinuationCue` match fell through every branch and
was silently dropped.

That is the one behavior the pipeline is not supposed to have. The rule stated throughout these
writeups is that an uncertain phrase is **left verbatim for the chef to review, never rewritten** —
and deleting it is worse than rewriting it, because the chef cannot review something that is gone.
Here the discarded segment also carried the only mention of the garlic and a five-minute duration.

The fix adds one narrow branch before the silent drop: a segment naming a concrete duration
(`strandedDurationClause` — seconds/minutes/hours) is kept verbatim as a step. A duration is
strong evidence of a real instruction, and it is precisely the detail the recent cook-time work
has been protecting. Filler ("okay", "so where were we") names no duration and is still dropped,
so this does not turn chatter into method steps.

## Result

```
1. You had two tablespoon of salt.
2. Then so I tell you the garlic for five minutes.
3. Cook for 10 minutes.
```

Title `Famous top romantle`, cook 10m, ingredient `2 tbsp Salt` — all unchanged. The mishearings
are still there, verbatim, for the chef (or Second Pass) to fix. Nothing was invented and nothing
was deleted.

## Tests

- `shared/golden-cooking-corpus.tsv` — new row `real-device-runon-title-announcement-0916`
  (count 59 → 60, bumped in both runners). The corpus format carries only required substrings,
  so it asserts the salt ingredient, the surviving garlic segment and the cook step.
- `GoldenCookingCorpusTest.kt` —
  `realDeviceRunOnTitleAnnouncementKeepsTheInstructionAndTheStrandedDurationSegment` asserts the
  exact three-step list plus the negative the corpus cannot express: no step may still contain
  the announcement.
- `web/tests/parser.test.mjs` — the identical assertions against the PWA parser.
- Gates: PWA 121/121, cook-wizard DOM 74/74, Android `:app:testDebugUnitTest` green
  (`GoldenCookingCorpusTest` 24 tests, 0 failures). No existing corpus row weakened.

## What did not change

The protected surfaces are untouched: no LLM anywhere in the parse, Second Pass is still explicit
opt-in review, the original recorded audio is still the source of truth, and `firestore.rules`,
`storage.rules`, the Live/WebRTC path and App Check (still monitoring-only) were not modified.

## R8 smoke test recorded alongside this

The same device session verified the 0.11.11 release build end to end, since R8 minification and
resource shrinking had never been exercised at runtime:

- Cold start clean; no `ClassNotFoundException`, `NoSuchMethodError`, `VerifyError` or
  `UnsatisfiedLinkError` anywhere in the log.
- Firestore read and write both correct with real data; the saved recipe round-tripped with its
  ingredient count, step count, cook time and attached voice clip.
- Mic → `SpeechRecognizer` → foreground service, and `AudioRecord` → saved "Full cooking session"
  clip, both working.
- **WebRTC Live initialized under minification** — `libjingle_peerconnection_so.so` loaded,
  `PeerConnectionFactory` and `EglBase14Impl` came up, session went LIVE and ended cleanly. This is
  the exact path the `org.jni_zero` keep rules were added for in 0.11.5, and it had never been run
  in a minified build until now.
- The parser output on-device matched the JS reference implementation byte for byte, confirming
  R8 does not perturb the protected core.

There are no `toObject()`/`toObjects()` call sites in the app and no reflection by name
(`Class.forName`, Gson, Moshi, `@Serializable`, `ServiceLoader`), so the `-keep class
com.chefvoice.app.model.**` rule is defensive rather than load-bearing.
