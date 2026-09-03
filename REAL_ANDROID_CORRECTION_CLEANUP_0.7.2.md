# ChefVoice Android 0.7.2 / PWA 0.11.7

Real-device regression from the user's Android test:

`Add Uh one chunk of chicken breast Actually Scratch that a half a chunk of chicken breast Two teaspoon of salt One teaspoon of pepper I could.`

Expected deterministic result:

- 1/2 chunk Chicken breast
- 2 tsp Salt
- 1 tsp Pepper

Expected method:

`Add 1/2 chunk chicken breast, 2 tsp salt, and 1 tsp pepper.`

Fixes:
- Adds `chunk` / `chunks` as count units.
- Normalizes `a half a chunk` to `half a chunk`.
- Implements named `Actually scratch that ...` ingredient correction.
- Collapses parser/window duplicates after a correction.
- Removes incomplete conversational tails such as `I could`.
- Generates a deterministic clean Add/Use/Season method from corrected ingredient lists when the raw ASR clause is correction-heavy.
- Extends second-pass artifact detection to numeric time rows such as `5 Minutes and it's ready to go`.
- No silent cloud rewrite behavior changed.

Latest correction build is a candidate until the user verifies it on a real Android device.
