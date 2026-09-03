# ChefVoice PWA 0.11 — Private Second-Pass Transcription

## Purpose
Improve recipe accuracy without replacing the live ChefVoice parser.

## Flow
1. Live phone speech recognition still provides immediate ingredients.
2. Original cooking audio remains stored privately.
3. From a saved recipe, the chef taps **Check original audio**.
4. ChefVoice uploads/reuses the private audio under `privateVoice/{uid}/{recipeId}/`.
5. An authenticated Firebase callable function sends that GCS object to Google Cloud Speech-to-Text V2 using `chirp_3`.
6. Cloud STT returns transcript segments, confidence and word timestamps.
7. The same deterministic ChefVoice parser parses the second transcript.
8. ChefVoice compares live ingredients against second-pass ingredients.
9. Only disagreements/possible misses are shown to the chef.
10. Nothing is silently rewritten.

## Privacy
- Raw cooking audio remains owner-private.
- The callable requires Firebase Authentication.
- No Firebase Admin or Speech API credentials are shipped to browser JavaScript.
- Second-pass transcript/review data is stored locally in IndexedDB in this alpha.

## Required one-time Google Cloud setup
Enable the Cloud Speech-to-Text API (`speech.googleapis.com`) for project `chefvoice-d7fec`.

## Deploy
From the PWA `web` directory:

```bat
firebase deploy --only functions,hosting --project chefvoice-d7fec
```

The first Functions deploy may prompt Firebase/Google Cloud to enable required Cloud Functions build/runtime services.

## If Speech returns a permission error
Verify the deployed Cloud Function runtime service account has permission to invoke Cloud Speech-to-Text and read the Firebase Storage bucket.

## Current backend behavior
- Region: `us-central1`
- Speech recognizer location: `global`
- Model: `chirp_3`
- Auto-detect audio decoding
- Word time offsets: enabled
- Word confidence: enabled
- Automatic punctuation: enabled
- One private audio file per request
- Callable timeout: 30 minutes
- Batch operation polling occurs inside the callable

## Cost note
Speech-to-Text is a paid Google Cloud service with its own usage pricing. ChefVoice only invokes it when the chef explicitly requests a second pass.
