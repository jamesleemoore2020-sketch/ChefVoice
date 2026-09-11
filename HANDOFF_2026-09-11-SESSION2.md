# ChefVoice — 2026-09-11 handoff (session 2, be3999)

## 1. TASK
Continued the 2026-09-11 handoff: fixed PWA private-audio upload, hardened the rules deploy gate, split Create Recipe into steps, built Play Billing (subscriptions + lifetime), fixed Community parity on both platforms.

## 2. TOUCHED
All committed on `claude/chefvoice-2026-09-11-handoff-be3999`, pushed to `origin` and mirrored to `origin/v0.11.0-monetization`. Nothing uncommitted.
- `web/js/firebase-client.js` — `publishRecipe()` uploads session audio to `privateVoice/{uid}/{recipeId}/session` with a `private_session` permit.
- `DEPLOY_COMMUNITY_PROFILE_RULES.cmd` — runs `RUN_RULES_GATES.cmd` first, refuses deploy on failure. `DEPLOY_STORAGE_RULES.cmd` — new scoped wrapper.
- `tools/BuildAndInstall.ps1` — dropped forced `--no-daemon clean`; builds ~10s vs 2–11min.
- `ChefVoiceApp.kt` — Community decluttered (subtitle/sign-in card/section header gone, icon enlarged); `CreateRecipeScreen` split into 5 steps; paywall wired to live Play prices + lifetime option.
- `ChefAppState.kt` — `PlayBillingManager` wiring. `billing/PlayBillingManager.kt` — new, Billing Library 9.1.0 wrapper.
- `Models.kt` — `ProEntitlement.PRODUCT_LIFETIME`, `isLifetime`.
- `app/build.gradle.kts` — added `billing-ktx:9.1.0` (missing despite brief); version 0.10.7/59 → 0.11.1/61.
- `billing/functions/index.js` — added `verifyChefVoicePurchase`, `processChefVoiceRtdn`; added `google-auth-library` dep.
- `web/js/app.js` — Community: Following/Discover toggle added, hero simplified, sign-in notice dropped.
- `notifications/*.test.js` (4 files) — re-pinned version-string assertions.
- Docs: `RULES_DEPLOY_GATE_HARDENING_0.10.7.md`, `CREATE_RECIPE_FLOW_SIMPLIFICATION_0.10.8.md`, `PLAY_BILLING_INTEGRATION_0.11.1.md`, `BUILD_STATUS.md`.
- **Deployed**: `chefvoice-billing` live. Deleted stale `onChefVoicePlayNotification` from abandoned worktree `fe9407`.

## 3. DECISIONS
- RTDN handler impersonates `chefvoice-billing-verifier` rather than running as it — direct `serviceAccount` on a Pub/Sub/EventArc trigger hits open firebase-tools bug #6814.
- Entitlement state always re-derived from a live Android Publisher API call, never the RTDN payload.
- New `purchaseTokens/{token}` Firestore collection maps token→uid; RTDN carries no uid.
- `RTDN_TOPIC = "play-billing-rtdn"` — the real, confirmed topic, not the placeholder `play-rtdn` first written.
- `CreateRecipeScreen` split matches `UI_BRANDING_AUDIT.md`'s proposed steps exactly.

## 4. RULED OUT
- fe9407's product model (two separate subscriptions, no lifetime handling) — wrong; real model is one `chefvoice_pro` subscription, two base plans, plus a separate lifetime product.
- fe9407's direct `serviceAccount` on the RTDN trigger — the exact #6814 failure mode.
- "Send test notification" as RTDN verification — sends no real notification.
- Removing PWA's hero-banner pattern for parity — breaks its cross-tab consistency; simplified copy instead.

## 5. STATE
`testDebugUnitTest` — BUILD SUCCESSFUL, 3 pre-existing warnings only. `billing/`+`notifications/` gates — 91/91 pass. PWA `npm test` — 86/86. Installed on device, launches. No Play Console product exists yet, so paywall prices correctly show "loading…"; no real purchase/RTDN event has hit the deployed functions.

## 6. GOTCHAS
- Worktree, not the main checkout — `C:\Users\james\ChefVoice` is a different, behind copy with unrelated legal-page work.
- `fe9407` worktree still has uncommitted, superseded billing code — safe to discard.
- Rules emulator leaves an orphaned JVM on Windows after `emulators:exec`; see CLAUDE.md's `Stop-Process` one-liner.
- IAM: `569377936753-compute@developer.gserviceaccount.com` holds Token Creator on `chefvoice-billing-verifier@...`, direct grant.

## 7. NEXT
Create `chefvoice_pro` (base plans `monthly`/`annual`) and `chefvoice_pro_lifetime` in Play Console, add a License Tester, and test-purchase each to confirm `verifyChefVoicePurchase`/`processChefVoiceRtdn` work.

## 8. OPEN
- Build "sell individual recipes to other users" next? Stage 3 in `MONETIZATION_REVIEW_2026-09.md`; needs a separate payment rail, Play Billing can't pay creators. Raised, not decided.
- Free creator cohort + TURN/SFU for Live (review items 6–7) — not started.
- Paywall not walked end-to-end on-device (no product to buy yet).
