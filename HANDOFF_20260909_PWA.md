# ChefVoice — PWA parity + production bugfix, 2026-09-09

## 1. TASK
Restore the missing PWA (`web/`), bring it to feature/parser parity with Android, deploy it, and fix bugs found testing the live deploy.

## 2. TOUCHED
All committed on `v0.11.0-monetization` (26 commits ahead of `origin/master`, unpushed). Working tree clean.
- `web/` — restored from a user-supplied backup (v0.7.0 alpha.3), then rewritten: `js/cooking-session-parser.js`, `ingredient-parser.js` (parser parity, 56/56 golden corpus), `entitlement.js`, `chef-analytics.js` (new), `firebase-client.js` (+messaging, +chef search, +Second Pass, +blocking/reports), `second-pass-reviewer.js`, `inbox.js` (new), `app.js` (Inbox tab, chef profiles, Second Pass UI, paywall), `firebase-messaging-sw.js` (new). `tests/*.test.mjs` — 80 tests total.
- `firestore.rules` — unchanged this session, but `saveUserProfile`'s old payload was rejected by it (see below); rules were confirmed already-deployed and correct.
- `rules-tests/firestore-rules.test.js` — +4 tests (profile create/update/follower-count).
- `firebase.json`, `.firebaserc` (new) — multi-site hosting (`pwa` + `delete-account` targets).
- `DEPLOY_PWA.cmd` (new), `DEPLOY_ACCOUNT_DELETION_PAGE.cmd` (repointed).
- `CLAUDE.md`, `BUILD_STATUS.md`, 4 new `*_0.11.0.md` writeups.
- **Deployed live**: rules, `chefvoice-billing` functions, PWA (all via the `DEPLOY_*.cmd` scripts).
- **Uncommitted, separate worktree** (`.claude/worktrees/eloquent-pare-cea166`, branch `claude/eloquent-pare-cea166`): Android blocking-filter work (`BlockedContentFilter.kt` etc.) — in progress, not merged.

## 3. DECISIONS
- Second Pass ported with all 19 `SecondPassReviewerTest.kt` cases verbatim — cross-platform contract, same role as the golden corpus.
- Video/photo tier caps NOT enforced on web — Android has no call site for either; enforcing on one platform only was reverted before shipping.
- Hosting split into pinned targets (`pwa`, `delete-account`) — old single-site config would've shipped the deletion page over the PWA.

## 4. RULED OUT
- Fixing `sendEachForMulticast({fids})` in the notifications backend — looked wrong (multicast usually takes `tokens`), but checked installed `firebase-admin@14.2.0` typings: FID-based is the current API, `tokens` is deprecated. Not a bug.
- Enforcing video/photo caps client-side on web only — rejected, see Decisions.

## 5. STATE
Builds and deploys. PWA 80/80, node (notifications+billing) 91/91, Android `BUILD SUCCESSFUL`, Firestore rules emulator 29/29 (the only gate that evaluates real rules — rest are source-text checks). Live and smoke-tested at `https://chefvoice-d7fec.web.app`.

## 6. GOTCHAS
- Firestore emulator JVM leaks past `emulators:exec` on Windows, blocks next run with "port taken" — kill via `Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" | Where-Object { $_.CommandLine -like '*firebase*emulator*' } | Stop-Process -Force`. Documented in `CLAUDE.md`.
- `validUserProfileShape` uses `hasAll` on 6 fields — omitting any one silently fails profile *create*, leaving an account with no profile doc and no error surfaced anywhere until this session's fix.

## 7. NEXT
Browser back button exits the whole PWA instead of navigating tabs. Root cause: `nav()` in `web/js/app.js` only swaps `currentTab` and re-renders — no `history.pushState`/`popstate` anywhere in `web/`. Fix: push a history entry per tab nav (and per conversation/chef-profile drill-in), listen for `popstate`, restore view from `state`.

## 8. OPEN
- Signed-in round trips (message, block, report, Second Pass cloud call) — user-verified working after the profile fix; not independently re-verified by me post-deploy.
- Push notification delivery — unverified, blocked on VAPID key (Console → Cloud Messaging → Web Push certificates), currently empty in `web/js/firebase-config.js`.
- Version still 0.10.6/58; 4 notification tests pin it — bump all 5 together when ready.
- Branch unpushed; Android blocking-filter worktree uncommitted and unmerged.
