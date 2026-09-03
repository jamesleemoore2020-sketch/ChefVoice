# ChefVoice PWA v0.7.1 — iPhone Real-Device Fix

## Fixed from real iPhone testing

1. Live camera now releases the currently active iPhone video track before requesting the opposite facing camera. The switch is verified and falls back to iOS camera enumeration when needed. The test now simulates Safari's exclusive-camera behavior and checks front → back → front → back → front.
2. Live cooking speech now parses interim/partial Safari recognition results, so ingredients can appear immediately instead of waiting for Safari to finalize the phrase. Finalized phrases are committed into the editable ingredient list during capture.
3. A visible `Hearing now` line and `Ingredient detected` pop-up were added for real-device diagnosis and feedback.

Protected parser behavior remains unchanged.
