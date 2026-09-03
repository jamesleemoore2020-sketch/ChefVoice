# ChefVoice 0.7 Reliability + Trust Test Guide

1. Deploy the PWA hosting build and confirm badge `PWA 0.7 · Reliability + Trust`.
2. iPhone Live: start front camera, flip to back, then flip back to front at least three times.
3. Cook & Capture: start a session, speak 3+ ingredients, wait at least 10 seconds, then force-close/reopen the PWA. The draft should recover and report recovered audio.
4. Complete a capture. Low-confidence items should appear under `Review only what’s uncertain`.
5. Tap `Hear source` on a detected ingredient and confirm the matching part of the original audio plays.
6. Save a recipe and confirm it remains local.
7. Publish Storage rules before publishing a recipe with new media/private raw audio.
8. Publish a recipe. Photos/video should remain visible to Community; raw full-session audio should not appear publicly.
