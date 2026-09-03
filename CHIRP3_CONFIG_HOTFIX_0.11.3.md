# ChefVoice 0.11.3 — Chirp 3 Config Compatibility Hotfix

## Fixed
Google Cloud Speech-to-Text returned:

`Config contains unsupported fields.`

The Chirp 3 request previously enabled:
- word-level timestamps
- word-level confidence

Google's current Chirp 3 documentation lists those as unsupported.

The request now uses the documented minimal batch configuration:
- auto decoding
- `en-US`
- `chirp_3`
- US multi-region endpoint/recognizer

## Timestamp behavior
Because Chirp 3 batch transcription does not provide supported word-level
timestamps, ChefVoice no longer fabricates `0 ms` source positions.

- Ingredient comparison still works.
- Second-pass transcript still works.
- Quantity/unit disagreement review still works.
- "Hear source" is only shown if the provider actually supplies a real source timestamp.

## Deploy
From this build's `web` directory:

```bat
cd functions
npm install
cd ..
firebase deploy --only functions,hosting --project chefvoice-d7fec
```
