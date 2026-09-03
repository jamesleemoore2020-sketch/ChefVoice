# ChefVoice Android v0.9.14 — Prep + Cook Time

This release adds optional recipe-level prep and cook time metadata without changing the deterministic cooking parser.

- New recipes can enter Prep min and Cook min before save.
- Saved owned recipes expose the fields under Edit recipe.
- Existing recipes default both values to unknown (0) and require no migration.
- Recipe detail and recipe cards show compact Prep/Cook/Total summaries when values are known.
- Public recipe time edits stay local until the owner explicitly taps Update Community.
- Method-step durations remain untouched and continue to come from the protected cooking parser/transcript path.
- No Firestore/Storage rules, Functions, IAM, App Check, Speech, or Live deployment is required.
