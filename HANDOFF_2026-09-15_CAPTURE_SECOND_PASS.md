# ChefVoice session handoff — 2026-09-15 (Capture Second Pass)

## 1. TASK
Continuation of `HANDOFF_2026-09-15.md`: verify+commit the uncommitted 5-patch stack it described, then build Second Pass-on-Capture for the PWA Cook wizard. Both are done, committed, and pushed.

## 2. TOUCHED
Worktree `C:\Users\james\ChefVoice\.claude\worktrees\chefvoice-2026-09-11-handoff-be3999`, branch `claude/chefvoice-2026-09-11-handoff-be3999`, pushed through `d60442f`. Working tree clean.
- `80652e4` — the stack from the prior handoff, committed as-is after Android tests confirmed green: PWA Live viewer fix, PWA Live hosting, Cook wizard, Android WebRTC JNI keep fix, Community layout parity (30 files).
- `d60442f` — the actual new feature, in `web/js/app.js`: `draftRecipeId`/`captureSecondPass` state, `captureSecondPassTemplate`/`renderCaptureSecondPass`/`bindCaptureSecondPass`/`runCaptureSecondPass`, save-time reuse of `draftRecipeId` as `recipe.id`, quota/busy guards on `canSaveRecipe`. Also `web/package.json`+`web/sw.js` (0.5.1→0.5.2), `web/tests/cook-wizard.dom.mjs` (+17 checks, new mocks for `cloud`/`isPro`/entitlement/second-pass-reviewer, an in-memory `localStorage` polyfill), `BUILD_STATUS.md`, new `PWA_CAPTURE_SECOND_PASS_0.5.2.md`.

## 3. DECISIONS
- Reused the existing "unpublished recipe" support in `privateRecipeOwnedBy` (storage.rules) and `authorizeChefVoiceStorageUpload` (notifications/functions/index.js) rather than building new backend plumbing — it already allows a private-audio upload under a recipe id with no Firestore doc yet.
- Opt-in button, not automatic — matches James's own phrasing quoted in the prior handoff.
- Capture-time review burns the same monthly quota (`secondPassRemaining`/`recordSecondPassUse`) as the post-save review — same paid Chirp 3 call either way; not charging it would be a free-tier loophole.
- Did not extend Second Pass to prep/cook time — `second-pass-reviewer.js` only ever classified ingredient/method text; that's new parser scope nobody asked for.
- `draftRecipeId` is minted lazily on first use and reused as the real recipe id at save, and is deliberately NOT reset when the chef re-records — reusing it means an old take's uploaded audio just gets overwritten at save, rather than permanently orphaned under an id that never gets a Firestore doc.
- Added a tiny in-memory `localStorage` polyfill in the DOM test: Node 24 has no global `localStorage` (confirmed directly), and `entitlement.js`'s quota math needs a working one to test for real.

## 4. RULED OUT
- No new analytics taxonomy for capture-time vs post-save Second Pass — kept `ChefAnalytics.secondPassOpened/secondPassAccepted` as-is rather than inventing a "source" param nobody asked for.
- Real-browser test of the actual Chirp 3 round-trip: impossible here — the sandboxed Browser pane blocks `getUserMedia` outright (confirmed live: "Microphone could not start: Permission denied"), and `audioBlob` is module-private, unreachable from devtools. Used the DOM test's mock instead.
- First test draft clicked the first `[data-accept-capture-method]` button and asserted on "batter" — failed, because the deterministic parser legitimately keeps "Add two cups of flour" as both an ingredient AND a method step (intentional dual extraction), so two method cards existed. Fixed by selecting the card whose text actually contains "batter" instead of assuming order.

## 5. STATE
Android `:app:testDebugUnitTest`: green. PWA `npm test` (web/): 95/95. `node tests/cook-wizard.dom.mjs` (needs `npm install --no-save --package-lock=false jsdom` once): 60/60. Manual browser pass at localhost:4173: wizard renders through all 5 steps, zero console errors; real capture blocked by sandbox (expected). `rules-tests`/notification gates were NOT re-run this session — nothing in `d60442f` touches rules or notifications/functions.

## 6. GOTCHAS
- Reached this worktree via `EnterWorktree(path=...)` from a different one (`mid-task-handoff-e6a4a5`); a fresh session should target this worktree's path directly.
- `preview_start` with a `name` reads `.claude/launch.json` from the session's *original* pre-EnterWorktree directory, not the current worktree — start the static server manually and use `preview_start` with an explicit `url` instead.
- James started the spawned follow-up task (`task_e352bbe1`, orphaned private-audio-on-delete cleanup) in its own separate session — unrelated to and not blocking this thread.

## 7. NEXT
Nothing required — both parts of the prior handoff are complete. If continuing: real-device/real-browser verification of the Capture-time Chirp 3 round-trip is still outstanding (only mock-tested), same class of gap as Live/WebRTC's real-device verification.

## 8. OPEN
- Play Console status of Android code 67 remains unconfirmed (carried over from the prior handoff, out of scope here).
