# ChefVoice session handoff — 2026-09-16 (session 4: cook time / recipe name / Play draft)

## 1. TASK
Close out `HANDOFF_2026-09-16_SESSION3.md`'s open items (cook time and recipe name not
auto-filling), then get Android 0.11.11 onto the Play Store.

## 2. TOUCHED
Worktree `.claude/worktrees/chefvoice-2026-09-11-handoff-be3999`, branch
`claude/chefvoice-2026-09-11-handoff-be3999`. Commits `206a217`, `73c90d3`, `4481628`,
`eff5aa3`, `17dd284`, `25423ac`, `f1cdcbe`, `15d36a4` — all pushed, working tree clean.

- `web/js/app.js` — `applyDetectedRecipeMeta()` now calls `captureForm()` first and writes back
  into mounted inputs; `runCaptureSecondPass()` applies detected title/prep/cook on return and
  auto-applies `possible-missed-ingredient` issues.
- `web/js/second-pass-reviewer.js` — `fromCloudTranscript()` returns `title`/`prepMinutes`/`cookMinutes`.
- `web/js/cooking-session-parser.js` + `app/.../voice/CookingSessionParser.kt` — identical changes:
  optional `going to` in the dangling `let it` tail rule; title verbs gained `doing|do`;
  dropped-copula title path; leading `my` stripped; `(?:my\s+)?` in the restatement pattern.
- `shared/golden-cooking-corpus.tsv` — row `real-pwa-plain-pronoun-let-it-0916` (count 58→59,
  bumped in both runners).
- Tests: `web/tests/cook-wizard.dom.mjs` (64→74 checks), `parser.test.mjs`,
  `real-device-fixtures.test.mjs`, `GoldenCookingCorpusTest.kt`.
- Writeups: `COOK_TIME_AND_LET_IT_TAIL_0.11.9.md`, `TITLE_DROPPED_COPULA_0.11.10.md`,
  `REVIEW_FILLS_RECIPE_DETAILS_0.5.8.md`, `REVIEW_AUTOFILLS_DETAILS_0.5.9_0.11.11.md`,
  `REVIEW_AUTOAPPLIES_MISSED_INGREDIENTS_0.5.10.md`, plus `BUILD_STATUS.md`.

## 3. DECISIONS
- Auto-apply scoped to `possible-missed-ingredient` only — it is purely additive, so it cannot
  overwrite or delete recorded content. `quantity-change`, `ingredient-name-cleanup`,
  `remove-live-artifact` and all method issues stay behind "Use second pass" so "Keep current"
  stays meaningful.
- Title verb list extended per real phrase rather than loosened to "pronoun + any verb".
- Auto-applied items do not fire `ChefAnalytics.secondPassAccepted` (nothing was accepted).

## 4. RULED OUT
- **Cook time being a parser bug** — the parser returned `cookMinutes: 2` in every
  segmentation on both platforms. Do not go looking in the parser for this class of report.
- **Making the title auxiliary optional for all verbs** — "we going to cook our ground beef for
  10 mins" then became the title, and `isTitleAnnouncementStep()` deleted that step, dropping
  `cookMinutes` 20→10. Caught by `estimates prep and cook minutes from chop/cook verbs...`.
- **Stripping "my" without touching the restatement pattern** — leaves "Make my famous top
  ramen meal." as a bogus first method step.

## 5. STATE
PWA 120/120, cook-wizard DOM 74/74, Android `:app:testDebugUnitTest` green. PWA 0.5.10 deployed
and verified by running the *deployed* JS. Android AAB built, signed (scheme v2), SHA-256
`a0a4366618c8267bc8d42cb238f3f4dfbb22dee37a8d64844a0de0d3bc2614f9`.

## 6. GOTCHAS
- `captureForm()` re-reads mounted DOM inputs into `form` on every navigation — state-only
  writes to Recipe Details get silently wiped. Always write to the inputs too.
- Play Console **Production is Active at code 69 (0.11.8)**, 177 countries, 3 installs.
- `cook-wizard.dom.mjs` is not in `npm test` (it is `.dom.mjs`); run it directly.
- Its second-pass quota is deliberately exhausted mid-file; later scenarios must
  `localStorage.removeItem('chefvoice.secondPass.usage')`.
- Play Console screenshots time out intermittently; prefer `find`/`read_page`.

## 7. NEXT
Smoke-test `ChefVoice-v0.11.11-Production.apk` on a device (R8 minify + shrink are on and this
build has never run), then roll out the saved Play draft — release name `72 (0.11.11)`, bundle
and en-US notes already in place, open in Chrome, **draft only, not rolled out**. Consider a
staged percentage rollout for 69→72.

## 8. OPEN
- Whether `possible-missed-step` should auto-apply like ingredients do (left manual: a wrong
  auto-inserted instruction is more disruptive than an extra ingredient row). One-line change.
- Android has no pre-save ChefVoice Review, so 0.5.8–0.5.10's review UX is PWA-only and absent
  from the Play build — never verified whether Android wants an equivalent.
