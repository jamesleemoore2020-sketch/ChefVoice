# ChefVoice Android v0.9.10 — Continuation + Ingredient Artifact Recovery

A fresh v0.9.9 real-device burger capture was run without Second Pass. It proved the v0.9.9 intra-segment split and ingredient-tail cleanup, then exposed two narrower live-parser defects:

- a standalone timestamp card `For 20 minutes` was dropped instead of attaching to `Cook them at 375 degrees`;
- ASR artifacts produced `1 Grab` and `1 lb Ground beef it took`, with the latter surviving beside a clean duplicate ground-beef row.

## Deterministic fix

- Duration-only cards are attached only to the immediately preceding time-bearing cooking Method step (`cook`, `bake`, `roast`, `simmer`, `boil`, `fry`, `sear`, `broil`, `rest`, `settle`, `marinate`, `heat`) and only when that step does not already contain a duration.
- `Cook them for 350.` remains separate and unchanged because ChefVoice does not guess what the bare `350` means.
- `Cook them at 375 degrees.` + `For 20 minutes` becomes `Cook them at 375 degrees for 20 minutes.`
- The exact observed bare ingredient artifact `Grab` is rejected.
- A terminal narration stub `it took` is trimmed from a measured ingredient before the existing exact ingredient de-duplication pass.

No LLM was added. Original cooking audio remains the truth source, and Second Pass remains explicit suggestion/review only.

## Cloud scope

No Firestore, Storage, Functions, IAM, App Check, Speech backend, or Live WebRTC changes are required.
