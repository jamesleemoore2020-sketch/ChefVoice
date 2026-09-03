# ChefVoice Android v0.7.0 — Second-Pass Transcription Parity

## Goal

Bring the native Android recipe detail screen to feature parity with the PWA/iPhone second-pass workflow without changing Android's native microphone/camera implementation.

Protected pipeline:

`MIC → ORIGINAL AUDIO → LIVE TRANSCRIPTION → DETERMINISTIC PARSER`

Second pass adds:

`ORIGINAL AUDIO → PRIVATE FIREBASE STORAGE → transcribeChefVoice callable → Google Chirp 3 → SAME DETERMINISTIC PARSER → REVIEW`

It never silently rewrites the saved recipe.

## Android UI

Every recipe detail screen now includes a **Second-pass transcription** section.

If a local `Full cooking session` recording is available and the user is signed in:

- `✨ Check original audio`
- `↻ Run second pass again`
- full second-pass transcript
- confirmed ingredient count
- review cards:
  - `Check quantity or unit`
  - `Possible missed ingredient`
  - `Clean up ingredient name`
  - `Live-only ingredient`
- `Use second pass`
- `Keep current`

No `Hear source` button is shown because the current Chirp 3 workflow does not provide supported word-level timestamps.

## Cloud path / privacy

The Android app uploads the full cooking-session audio to:

`privateVoice/{uid}/{recipeId}/session-{recipeId}.{ext}`

The raw full cooking-session recording is not given a tokenized download URL and is excluded from public recipe documents.

Storage content type is set explicitly as audio.

## Callable

Android uses the Firebase Functions Android SDK in `us-central1` and calls:

`transcribeChefVoice`

The callable timeout is raised to 30 minutes because the Android SDK's default callable timeout is too short for long batch transcription jobs.

The existing deployed function/backend is reused unchanged.

## Parser / review

The cloud transcript is converted back into `TranscriptSegment`s and run through the exact native `CookingSessionParser`.

Second-pass comparison is deterministic and follows the PWA review behavior.

Accepted changes modify only the reviewed ingredient. `Keep current` removes the review card without changing the recipe.

## Persistence

Second-pass transcript, parsed second-pass ingredients, remaining review issues, and confirmed count are persisted in the recipe's local JSON storage.

They are not written to public Firestore recipe data.

## Existing real-device regression case

The reviewer is tested against the real phrase:

`All right, so you're going to add 1 cup of chicken broth. You're going to add 2 tbsp of salt and pepper. You're going to add 1 cupful of chicken stock.`

Expected second-pass ingredients:

- 1 cup Chicken broth
- 2 tbsp Salt
- 2 tbsp Pepper
- 1 cup Chicken stock

Legacy live artifacts such as `Chicken broth gonna`, `Pepper You gonna`, `Full of chicken stock`, and the ghost `Add` are handled as review/cleanup rather than silently inserted.

## Validation performed before packaging

- Android deterministic golden cooking corpus: 40/40
- Standalone Kotlin second-pass reviewer gate: PASS
- Source package required build/install files verified

A full Android Gradle build still needs to be run on the user's Windows/Android SDK environment via `BUILD_AND_INSTALL.cmd`.

## Build/install

Extract the COMPLETE source package and run:

`ChefVoiceAndroid\BUILD_AND_INSTALL.cmd`

Then on the phone:

1. Sign in on Profile.
2. Create/save a recipe using continuous Cook & Capture so `Full cooking session` audio exists.
3. Open the saved recipe.
4. Find **Second-pass transcription** above Ingredients.
5. Tap **Check original audio**.
6. Review the Chirp 3 result.

Cloud setup should not be repeated unless the app returns a specific backend error.
