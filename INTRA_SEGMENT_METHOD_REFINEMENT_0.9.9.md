# ChefVoice Android v0.9.9 — Intra-Segment Method Refinement

A fresh Android v0.9.8 burger capture confirmed that timestamp boundaries, temperature, cook duration, rest duration, and overall Method order were working, but exposed two narrower deterministic parser problems inside a single ASR card:

- `shape them and pet them down see them both sides ...` stayed partly merged instead of becoming smaller ordered clauses.
- `2 tbsp Garlic i want` retained a narration tail from the next spoken quantity phrase.

v0.9.9 adds two narrow deterministic rules:

1. Repeated direct-object predicates inside one timestamp may split at a safe `... them ... <recognized-word> them ...` boundary when the intervening particle is from a small cooking-safe set. The recognized words are preserved exactly.
2. Measured ingredient chunks drop trailing first-person narration stubs such as `I want`, `I need`, `I mean`, or `I think` when those words occur only at the end of the chunk before the next measured ingredient.

The exact real-device capture is stored in the shared golden corpus as `real-android-burgers-intra-segment-tail-099`.

Expected deterministic Method output for the uncertain ASR portion is intentionally:

- `Shape them.`
- `Pet them down.`
- `See them both sides with two tablespoon of salt.`

ChefVoice does **not** silently rewrite `pet` to `pat` or `see` to `season`. Optional Second Pass may later propose corrections from the private original cooking audio.

Cloud/backend scope: none. Firestore rules, Storage rules, notification Functions, IAM, App Check enforcement, Speech backend, and Live WebRTC are unchanged.
