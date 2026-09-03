# ChefVoice Android v0.9.12 — Second Pass Method Alignment

Android v0.9.11 passed the deterministic live-parser real-device burger test. The user then ran optional Second Pass against that same recipe. Ingredient review was clean (5 confirmed / 0 review), but Method review exposed a matching defect:

- live `Shake them.` was left as a live-only step;
- cleaner Second Pass `Shape them, and pack them down.` was greedily paired only to live `Pat them down.`;
- `In between.` correctly paired with `Flip them in between.`;
- formatting-equivalent wording such as `five minutes` vs `5 minutes` and `two tablespoon` vs `2 tbsp` generated unnecessary review cards.

The user noted they may in fact have said **tablespoon**, so v0.9.12 does not change ingredient quantities or units.

## Review-only alignment fix

The deterministic Cook & Capture parser is unchanged. v0.9.12 changes only how explicit Second Pass Method suggestions are paired for review.

1. A second-pass Method row containing two action clauses may be split into two **review candidates only** when both clauses strongly align to two adjacent live Method rows.
2. In the exact real-device case, `Shape them, and pack them down.` becomes review candidates `Shape them.` and `Pack them down.` and aligns to neighboring live rows `Shake them.` and `Pat them down.` respectively.
3. A one-edit action-word similarity check (for action words of length 4+) helps pair ASR-near verbs such as `shake` / `shape`. This affects matching only; it never edits the live recipe.
4. Common number words and cooking-unit abbreviations are canonicalized for review comparison only (`five` ↔ `5`, `tablespoon` ↔ `tbsp`, etc.). This suppresses cosmetic/no-op cards without changing stored Method text.
5. Every material correction remains explicit. `Shake them.` → `Shape them.`, `Pat them down.` → `Pack them down.`, and `In between.` → `Flip them in between.` still require the user to press **Use second pass**.

Expected exact regression result before accepting suggestions:

- Method confirmed: **5**
- Method review cards: **3**
- `Shake them.` → `Shape them.`
- `Pat them down.` → `Pack them down.`
- `In between.` → `Flip them in between.`
- no seasoning formatting-only card
- no rest `five` vs `5` formatting-only card

After accepting those three explicit suggestions and rebuilding the reviewer, all **8** Method rows confirm with **0** review cards.

## Protected architecture

Original cooking audio remains the truth source. Second Pass remains optional suggestion/review only and never silently rewrites. No LLM was added to deterministic parsing.

## Cloud scope

No Firestore, Storage, Functions, IAM, App Check, Speech backend, or Live WebRTC changes are required. Android requires APK build/install only.
