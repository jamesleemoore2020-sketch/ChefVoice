# ChefVoice Android 0.7.6 / PWA 0.12.1 — Method Correction Review Closure

Generated candidate. Not real-device accepted until the user verifies it.

Real-device regression captured first:

`Add chicken to the pan and cook for 10 minutes. Actually, cook for 20 minutes and flip halfway.`

Observed live Method row:

`Cook for 10 minutes Actually Cooked for 20 minutes the flip halfway.`

Observed second-pass steps:
- `Cook for 10 minutes.`
- `Cook for 20 minutes and flip halfway.`

Expected review behavior:
- one Method Review card only
- title: `Check corrected method`
- suggestion: `Cook for 20 minutes and flip halfway.`
- stale `Cook for 10 minutes.` is not offered as a replacement or a missed step
- recipe method remains unchanged until `Use second pass` is explicitly chosen

Implementation is deterministic and reviewer-only. No LLM parsing or silent rewrite was added. The shared cooking corpus contains the exact real-device transcript on Android and PWA.
