# ChefVoice Android 0.7.5 / PWA 0.12.0 — Second-Pass Method Review

## Status
Generated candidate. Automated/core gates pass. **Not real-device accepted until the user confirms it on Android/iPhone.**

## Protected architecture
Unchanged:

MIC → ORIGINAL AUDIO → LIVE TRANSCRIPTION → DETERMINISTIC COOKING PARSER → INGREDIENTS + METHODS → OPTIONAL SECOND-PASS REVIEW

Original audio remains private and authoritative. Second pass remains review-only and never silently rewrites recipe data.

## What this candidate adds
The existing Chirp 3 transcript is still parsed by the same deterministic `CookingSessionParser`. The parsed second-pass Method/Steps are now compared with the saved live Method/Steps.

Method review cards:
- **Possible missed step** — second pass contains a method step not matched to live capture.
- **Check method wording** — live and second-pass steps are related but materially different.
- **Live-only step** — a live step was not confirmed by second pass.

Actions:
- **Use second pass** is offered only when there is an explicit second-pass replacement/addition.
- **Keep current** dismisses the review item without changing the recipe.
- Live-only steps are never auto-deleted and currently expose only **Keep current**.

## Persistence / backward compatibility
New second-pass fields:
- second-pass parsed `steps`
- `methodIssues`
- `methodConfirmedCount`

Older saved second-pass results still load. They need **Run second pass again** to populate Method Review.

## Audio / timestamp rule
No fake word timestamps were introduced. Method review uses the visible full original cooking session as evidence until reliable source alignment exists.

## Automated validation
- PWA tests: **114/114 PASS**
- Android shared golden cooking corpus: **44/44 PASS**
- Android Method Review pure-Kotlin gates: **5/5 PASS**
- PWA Method Review tests: included in the 114/114 suite
- PWA JavaScript syntax check: PASS
- Android core Kotlin compile (`Models`, ingredient parser, cooking parser, second-pass reviewer): PASS

The final Android Gradle/APK compile remains the user's Windows `ChefVoiceAndroid\\BUILD_AND_INSTALL.cmd` gate.

## Real-device acceptance target
Run second pass on a recipe containing useful method narration and verify:
1. Ingredient review still behaves as before.
2. A matching Method step is confirmed without review.
3. A missing/changed Method step appears as an explicit review card.
4. **Use second pass** changes only that reviewed Method step.
5. **Keep current** leaves the current Method unchanged.
6. Original cooking transcript and original audio remain available.
7. Portrait ↔ landscape still stays in the current app/session.
