# ChefVoice PWA Build Status — 0.7 Reliability + Trust

Built from the two-way Live 0.6.1 hotfix baseline.

## Implemented in this build
- iPhone Live camera switching remembers physical device IDs and recovers the prior camera if a switch fails.
- Cook & Capture has a recording/recognition state model and a kitchen-instrument active UI.
- MediaRecorder audio chunks are checkpointed to IndexedDB while cooking.
- Transcript, ingredients, steps, form state and capture metadata are checkpointed continuously.
- Reload/crash recovery reconstructs the cooking draft and checkpointed audio.
- Ingredient provenance stores transcript evidence, source timing, parser rule and confidence.
- Low-confidence ingredients appear in a review-only queue.
- After capture, a chef can tap Hear source to play the relevant audio window.
- Local-only Ingredient Acceptance metrics are recorded without storing raw speech in telemetry.
- New raw cooking-session audio uploads use privateVoice/{uid}/{recipeId} and are not attached to public recipe documents.
- New public photos/videos use recipes/{uid}/{recipeId}/publicMedia.
- Storage rules add owner-only raw voice plus media/audio MIME and size limits.

## Protected core
The deterministic ingredient parser itself was not rewritten. Existing parser regression behavior remains a release gate.

## Deferred intentionally
- cloud/AI second-pass transcription
- hands-free ChefVoice intents
- shared Android/Web golden corpus refactor
- App Check/moderation/rate limiting
- server-authoritative social counters
- full automatic background sync queue

## Deployment
Hosting only:
`firebase deploy --only hosting --project chefvoice-d7fec`

Storage rules must also be deployed for the new privacy paths:
From the combined ChefVoiceAndroid project root, use the root Firebase config/rules workflow, or paste/publish `storage.rules` in Firebase Console before testing private raw-audio upload.
