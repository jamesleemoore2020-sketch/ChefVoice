# ChefVoice Android 0.7.4 / PWA 0.11.9 — Correction Closure

Real Android test phrase:

`We're going to do two tablespoons of pepper. Oh wait, no. We're going to do one tablespoon of pepper.`

Expected final ingredient:
- 1 tbsp Pepper

The earlier 2 tbsp Pepper is superseded and must not remain confirmed.

Fixes:
- Natural correction cues now tolerate filler between the cue and corrected measurement:
  - `oh wait, no, we're going to do ...`
  - `sorry, we're going to use ...`
  - `no, add ...`
  - `oops, put ...`
- Earlier same-name measurement is replaced inside the deterministic parser.
- Second-pass reviewer can therefore surface any stale live quantity as `Superseded quantity`.
- Recipe detail shows only one `Full cooking session` playback button even if local persistence contains duplicate full-session clip records.
- Raw Cooking transcript remains untouched as evidence.
- Focused chef voice notes are not deduplicated.

Expected supplied test recipe after review:
- 2 tbsp Salt
- 1 cup Water
- 2 cup Chicken stock
- 1 tbsp Pepper

No silent second-pass rewriting behavior changed.
