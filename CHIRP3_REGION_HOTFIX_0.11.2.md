# ChefVoice 0.11.2 — Chirp 3 Region Hotfix

## Fixed
Google Cloud Speech-to-Text returned:

`The model "chirp_3" does not exist in the location named "global".`

Chirp 3 is configured for the Google Cloud `us` multi-region.

The backend now uses:

- Speech endpoint: `https://us-speech.googleapis.com/v2`
- Recognizer: `projects/{project}/locations/us/recognizers/_`
- Model: `chirp_3`

## Deploy
From this build's `web` directory:

```bat
cd functions
npm install
cd ..
firebase deploy --only functions,hosting --project chefvoice-d7fec
```

No Firebase rule changes are required.

The previous Cloud Run `--no-invoker-iam-check`, Speech API enablement, Speech Client IAM role,
and explicit Firebase Storage bucket configuration remain required and unchanged.
