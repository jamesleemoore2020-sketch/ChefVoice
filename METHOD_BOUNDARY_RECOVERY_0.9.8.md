# ChefVoice Android v0.9.8 — Method Boundary Recovery

## Real-device regression

The v0.9.7 Android build passed build/install and produced clean burger ingredients, but the live transcript contained three separate timestamped segments:

- `00:36 Cook them for 375 degrees for 20 minutes`
- `00:39 Foot them in between`
- `00:43 Let them rest with five we feel serving`

The deterministic parser merged all three into one Method step. This release fixes that boundary error without guessing the uncertain ASR words.

## Deterministic behavior

For captures with multiple transcript segments, whole-transcript and 2/3-segment windows remain available for ingredient recovery, but Method steps are collected in original segment order. Known action clauses inside one segment can still split deterministically. Ingredient-only seasoning continuations may attach to the immediately preceding seasoning/add/mix step. A non-action phrase with a strong method-continuation cue such as `in between` is preserved as its own uncertain Method step.

The narrow temperature grammar also changes `cook ... for <number> degrees` to `cook ... at <number> degrees`. No temperature value, appliance, or cooking technique is invented.

## Golden fixture

`real-android-burgers-timestamp-boundaries-098` reproduces the exact timestamped capture and requires clean ingredients plus separate cook, uncertain-mid-step, and rest Method entries.

## Protected architecture

Original audio remains the truth source. The parser is deterministic. Second Pass remains optional review only. No cloud security, notification, Live transport, IAM, Storage, or App Check changes are included.
