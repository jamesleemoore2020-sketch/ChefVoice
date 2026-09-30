# ChefVoice session handoff — 2026-09-28 (session 12: audit implementation, part 4)

## 1. TASK
Implement the 2026-09-26 full audit. The report is at
`C:\Users\james\Downloads\AUDIT_2026-09-26_FULL.md`, deliberately kept out of this public repo.
Part 4 is done in code: F21, F30, F29, F17, F10, F11, the F18 viewer cap, and the parts of F31
that move no files. **Nothing from part 4 is deployed.**

## 2. TOUCHED
Branch `claude/audit-implementation-2026-09-28-e6a4a5`, pushed, clean. It continues
`claude/audit-implementation-2026-09-26-02973b` from `c6ef9af`. One commit per finding: `0befb4c`
F21, `043bc2a` F30, `242c2d1` F29, `348dfe0` F17, `ba76796` F10, then the docs commit with this
handoff.
- **F21, cook-along:**
  - PWA: `web/js/app.js`, `web/css/styles.css`, new `web/js/step-ingredients.js`.
  - Android: `CookingScreen` and `CookingStepDock` in `ChefVoiceApp.kt`, new `util/StepIngredients.kt`,
    `RecipeView` in `IngredientScaling.kt`, `ChefAppState.recipeView`.
  - Shared: `shared/step-ingredients.tsv`.
  - PWA Community recipes gain servings and units.
- **F30, import:** `import/functions/page-fetcher.js`, which adds undici 7.30.0. CI and
  `RUN_IMPORT_GATES.cmd` install that codebase's dependencies.
- **F29, share links:**
  - New `share/functions` (the `chefvoice-share` codebase), plus a codebase entry and the `/r/**`
    rewrite in `firebase.json`.
  - PWA: `web/js/share-redirect.js`, the `/r/` redirect in `web/sw.js`, and `/r/` links from the PWA
    and Android.
  - Scripts: `DEPLOY_SHARE.cmd`, `RUN_SHARE_GATES.cmd`, the function check in `DEPLOY_PWA.cmd`, and
    the rewrite mirror in `e2e/serve.mjs`.
- **F17, deletion:** `notifications/functions/deletion-indexes.js`,
  `backfillChefVoiceDeletionIndexes`, the like-mirror delete rule in `firestore.rules`, and the
  `blocks.blockedUid` index.
- **F10, chef search:**
  - Backend: `notifications/functions/search-tokens.js`, `syncChefSearchTokens`,
    `backfillChefVoiceSearchTokens`, and the profile `searchTokens` rule.
  - Apps: `web/js/chef-search.js` and `util/ChefSearch.kt`.
  - Shared: `shared/chef-search-words.tsv`.
- **F31, in part:** `CLAUDE.md`, which described four backend pieces and none of import, share, CI,
  e2e or five deploy scripts; the `README.md` header, which said v0.10.0.
- **F11, private backup** (its own commit, after the docs commit):
  - Android: new `util/RecipeBackup.kt`; `backupRecipe`, `writeBackupCopy`, `listOwnCloudRecipes`,
    `downloadSessionAudio` in `FirebaseSocialRepository.kt`; the backup block in `ChefAppState`;
    `PrivateBackupCard` and `RestoreOfferCard` in `ChefVoiceApp.kt`; `backedUpAt` and
    `backedUpAudioId` on `Recipe`.
  - PWA: new `web/js/backup.js`; `backupRecipe`, `writeBackupCopy`, `listOwnRecipes`,
    `downloadSessionAudio` in `firebase-client.js`; the backup section in `app.js`.
  - Both: ChefVoice Review keeps a recording the account holds (`keepInAccount`).
  - `storage-cors.json`, the deletion page's wording, `rules-tests/private-backup.test.js`.
- **F18, the Live viewer cap** (its own commit, after F11): `LIVE_MAX_VIEWERS` and the `FULL` answer
  in `web/js/webrtc-signaling.js`, `webrtc-live-host.js`, `webrtc-live-viewer.js` and
  `WebRtcLiveTransport.kt`; Try again in `app.js` and the Android viewer panel;
  `validLivePeerHostFull` in `firestore.rules`.
- **Versions:** PWA 0.5.21; Android 0.11.20 / 81, which includes the unreleased 0.11.19.
- **Writeups:** `COOK_ALONG_FOR_REAL_KITCHENS_0.5.21_0.11.20.md`, `IMPORT_DNS_REBINDING_0.5.21.md`,
  `SHARE_LINK_PREVIEWS_0.5.21.md`, `DELETION_WITHOUT_FULL_SCANS_0.5.21.md`,
  `CHEF_SEARCH_TOKENS_0.5.21.md`, `PRIVATE_BACKUP_0.5.21_0.11.20.md`,
  `LIVE_VIEWER_CAP_0.5.21_0.11.20.md`. The top entry of `BUILD_STATUS.md` holds the release order.

## 3. DECISIONS
- **F21:**
  - The step-ingredient matcher errs towards showing nothing. An ending two ingredients share, or
    "sauce", "mixture", "seasoning", or the verb "cream", names nothing.
  - The last step keeps a disabled Next rather than a Done button, which would end a running timer.
  - Amounts carry over from the recipe screen, with a note saying so. The step text is never
    rewritten.
- **F30:** The address check lives only in the socket's lookup; the separate pre-check is gone.
  IPv6 accepts global unicast only.
- **F29:**
  - `/r/{id}` is a tags page with a same-origin redirect script, not the app.
  - A private recipe's page is identical to a missing one's.
  - The edge caches a described recipe for 5 minutes.
- **F17:** The full walks retire only once the backfill records `backfilledAt`, so deploying the
  code first is safe.
- **F10:** Only the backend writes tokens. Bios are no longer searched, and a word matches from its
  start.
- **F11 (James):** Pro only; off until the chef turns it on; restore for every signed-in chef.
  Then, in code:
  - A backup never publishes, unpublishes or sends a published recipe's edits. Its writes are
    transactions that stop at a recipe published or deleted meanwhile.
  - The recording goes up once, not with every edit. Publishing no longer re-sends it either.
  - Review keeps its upload when backup is on or the account holds that recording; otherwise it
    cleans up as before.
  - Android keeps a restore offered until its recording downloads. The web restores the recipe
    anyway and offers the recording's download later, because browser downloads need bucket CORS.
  - Not backed up: transcript and parse details, Second Pass results, collections, shopping list.
- **F18 (James):** cap viewers now; TURN later. Then, in code:
  - Six a room, both platforms. The host answers a seventh join `FULL`, so no connection is made
    for it. A failed connection frees its place.
  - The viewer leaves and offers Try again; nothing retries by itself.
  - The Android host answers only a `JOINING` peer, as the PWA host already did.
  - The cap is the host's own choice, so it is enforced where the cost is, in the host. The rules
    only let the host say `FULL` over a waiting join.
- The emulator suite runs its files one at a time, because five files at once garbled a Live test.

## 4. RULED OUT
- **F29:**
  - The app at `/r/` with a `<base>` tag: the CSP has `base-uri 'none'`.
  - A meta refresh: Facebook's crawler follows it and loses the tags.
  - User-agent sniffing.
- **F30:** undici 8 needs Node 22.19 or later; Cloud Functions' Node 22 may be older.
- **F17:** A `uid` field on likes would change the rules and both clients; the mirror rule does the
  same job with neither.
- **F10:**
  - Tokens written by the apps: rules cannot check they come from the name, so chefs could stuff
    in others' names.
  - Mid-word matching: it needs every substring as a token.
- **F31:** Moving the 128 root docs into `docs/` is held for James. Several branches are still open,
  and the master merge is pending.

## 5. VERIFIED — do not re-verify
- **CI green** on `043bc2a` (F21 and F30), `242c2d1`, `348dfe0`, `ba76796`, `b25496d`, `a7aac61`
  (F11) and `5ae105b` (F18).
- **Local suites, with F11 and F18:** PWA 379 / 0, jsdom 74 / 35 / 18 / 56, e2e 30 / 0, Android
  267 / 0 (2 skipped), rules emulator 87 / 0, notification gates 119 / 0, billing 17 / 0, import
  102 / 0, share 8 / 0.
- **F11 breaks caught:** PWA 18, Android 13, emulator 3. The emulator test runs the PWA's own
  backup transaction against the real rules.
- **F18 breaks caught:** 10. The emulator test runs the real PWA host and viewers against the real
  rules; Android's transport is held by source gates, and needs the device check.
- **Every new check was broken on purpose and caught:**
  - the step matcher, 19 ways;
  - the PWA cook-along, 12;
  - the Android cook-along, 13;
  - the import fetch, 10;
  - share links, 5;
  - the deletion backfill, 5;
  - the search rules, 2.
  - The like-mirror rule and the profile-save rule each failed on the old rules first.
- **Seen:** the PWA cook-along in the browser pane at phone size, and the Android cook-along drawn by
  `RenderScreensTest` in light and Blackout.
- `DEPLOY_PWA.cmd`'s new check was run both ways with a copy that could not deploy. The only thing
  it touched in production was a read-only `firebase functions:list`.

## 6. GOTCHAS
- **Gradle:**
  - A PowerShell pipe around Gradle never returns, because the daemon holds it open. Use
    `cmd /c "<repo>\gradlew.bat ... > <log> 2>&1"`.
  - Use the full path: a bare `gradlew.bat` is blocked by `NoDefaultCurrentDirectoryInExePath`.
- **Robolectric** measures text a few pixels wide unless a test uses
  `@GraphicsMode(GraphicsMode.Mode.NATIVE)`. `CookAlongTest` does.
- **Emulator:**
  - A test that runs Admin code needs its own project id and must set `FIREBASE_CONFIG` too.
    `emulators:exec` points it at the rules suite's project, which clears itself before each test.
  - The emulator JVM survives each run; stop it with the command in `CLAUDE.md`.
- **Line endings:**
  - Git Bash's `grep -c $'\r$'` misreports line endings; count with node.
  - `firestore.rules` and `app.js` are CRLF in this worktree; `ChefVoiceApp.kt` and `sw.js` are LF.
- The PWA replaces its URL with `/` once it has read `?recipe=`. A test sees the deep link in its
  navigations, not in the final URL.
- **Versions:** next Android versionCode is 82; next PWA version is 0.5.22.

## 7. NEXT
1. **James: the release order at the top of `BUILD_STATUS.md`.**
   - Indexes, then rules after the console diff, then `DEPLOY_NOTIFICATIONS.cmd`.
   - Both backfills in `functions:shell`, each until it answers done.
   - `DEPLOY_IMPORT.cmd`, `DEPLOY_SHARE.cmd`, then `DEPLOY_PWA.cmd`.
   - Android 0.11.20: release build, the nine device checks (`COOK_ALONG_…md`), Play.
   - F11: the bucket's CORS setting and `DEPLOY_ACCOUNT_DELETION_PAGE.cmd`, then the seven device
     checks in `PRIVATE_BACKUP_…md`.
   - F18: its rule rides the batch's rules deploy, before the apps; then the device checks in
     `LIVE_VIEWER_CAP_…md`.
2. **James:** pick a TURN provider (F18's other half), with credentials; then a small callable
   mints short-lived ones and both `LIVE_ICE_SERVERS` lists take them.
3. **F31:** move the root docs into `docs/` only after the master merge.

## 8. OPEN
- **New:**
  - Android does not open `/r/` links itself; that needs App Links.
  - A recipe unpublished just now can still preview for 5 minutes.
  - The Android importer checks hostnames, not what they resolve to (noted in the F30 writeup).
  - Metric scaling shows "59.15 ml". Scaled units are not pluralised: "4 clove garlic". Both predate
    this work.
  - F11: collections and the shopping list are still kept on the device only. Review uploads a
    recording the account already holds rather than reusing it: `transcribeChefVoice` is not in
    this repo, so what it checks on the object could not be confirmed.
- **Carried over from session 11:**
  - Test leftovers for James to delete: two private "Rules check test" recipes and the phone folder
    `Pictures/ChefVoiceRulesCheck`.
  - The CSP is still Report-Only.
  - Neither app has a button yet for authors or Live hosts to delete comments.
  - The Play rollout percentage is unknown.
  - The F15 deploy is unverified.
  - AD_ID and Data safety answers; keystore rotation; F25.
  - Uncommitted files in the main checkout; the master merge plan.
  - The public "testing2" recipe.
  - TalkBack wording on a device; tab naming (F19); emoji-first button labels (F12).
