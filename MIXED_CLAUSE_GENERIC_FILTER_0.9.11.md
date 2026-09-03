# ChefVoice Android v0.9.11 — Mixed-Clause Recovery + Generic Ingredient Filtering

A fresh v0.9.10 real-device burger capture was run **without Second Pass**. It proved the v0.9.10 duration-continuation fix on-device: `Cook them at 375 degrees` plus the standalone `For 20 minutes` card became one ordered Method step. It also exposed the next two narrow deterministic defects:

- a timestamp containing a real ingredient followed by `make ...` method narration could lose the method clause when ASR lost the spoken count (`four` -> `faux`);
- generic ASR placeholders such as measured `stuff` and count `tasteful` could survive as ingredient rows.

## Deterministic fix

- `make` is recognized as a Method action even when ASR loses the numeric output count.
- The observed past-tense `shaped` action is recognized as Method text without rewriting the word.
- `but then` is treated as the same soft narration boundary as `then`, so the exact mixed timestamp can preserve both ordered clauses instead of leaving a dangling `but`.
- The observed generic ingredient artifact names `stuff` and `tasteful` are rejected, alongside the already-protected `grab` artifact.
- Nounless measured/count fragments remain rejected because an ingredient name is still required.

For the exact real-device fixture:

- `Take one pound of ground beef and make faux burger patties but then evenly shaped them`
  keeps `1 lb Ground beef` and also produces ordered Method text `Make faux burger patties.` then `Evenly shaped them.`
- `two teaspoon and stuff`, `One teaspoon`, and `One tasteful` do not become ingredient rows.
- `1 tsp Lemon pepper` remains valid.
- `Cook them at 375 degrees` + `For 20 minutes` remains `Cook them at 375 degrees for 20 minutes.`
- uncertain ASR such as `Good name in between` remains verbatim for optional Second Pass review.

No LLM was added. Original cooking audio remains the truth source, and Second Pass remains explicit suggestion/review only.

## Cloud scope

No Firestore, Storage, Functions, IAM, App Check, Speech backend, or Live WebRTC changes are required.
