# ChefVoice session handoff — 2026-09-18 (session 7: recipe import, PWA fixes, PWA parity started)

## 1. TASK
Build recipe import from a URL (Android), get 0.11.16 ready for Play, fix PWA bugs James hit, and bring
the PWA to feature parity with Android (James: "all of the updates/features on the app should be added
to the PWA"). Parity is stage 1 of 4 done.

## 2. TOUCHED
Worktree `.claude/worktrees/mid-task-handoff-e6a4a5`, branch `claude/chefvoice-handoff-docs-f8b99a`
(fast-forwarded from the session-6 branch; **no upstream, nothing pushed**). Working tree clean.
- `e8760eb` `RecipeRepository.kt`: local `tags` were never persisted; fixed + `RecipeRepositoryJsonTest`.
- `48d3af5` new `app/.../importer/` package (extractor, written-ingredient parser, URL rules, fetcher, importer) + 93 tests.
- `21e3c58` import UI (`ChefAppState`, `ChefVoiceApp`), **Android 77 / 0.11.16**, `RECIPE_URL_IMPORT_0.11.16.md`, `BUILD_STATUS.md`.
- `e7dc56c` PWA Save fix: `toggleBookmark` now writes `recipeId` (rules require it). **PWA 0.5.13**.
- `e1d9d0b` PWA "Saved cookbook" section on the Recipes tab. **PWA 0.5.14**.
- `0d5ee21` `web/js/{step-timers,cook-commands,ingredient-scaling,shopping-list}.js` + 4 test files. Not imported by `app.js` yet.

## 3. DECISIONS
- Import attribution goes in the recipe **description** ("Source: author · url"): `firestore.rules` `validRecipeData` allow-lists fields, so a new field needs a rules deploy.
- Separate written-ingredient parser; `voice/IngredientParser` untouched (corpus-pinned, speech-tuned).
- Plain GET fetch; no bot-detection workarounds.
- PWA ports are literal translations so Android's tests port unchanged.

## 4. RULED OUT
- Switching the fetcher to OkHttp: Android's `HttpURLConnection` shares Conscrypt TLS, so no evidence it changes bot-challenge outcomes.
- Imitating a browser to beat Cloudflare: not doing it. Escalation if needed is a WebView read.
- Emulator to verify UI: no system images installed; multi-GB download.
- Uploading the AAB via the Chrome tool: `file_upload` caps at 10 MB; AAB is 32 MB.

## 5. STATE
Android 205 tests / 0 failures; `assembleDebug`, `assembleRelease`, `bundleRelease` clean; APK verified v2-signed (release key), 77 / 0.11.16.
AAB: `app/build/outputs/bundle/release/app-release.aab` (32.1 MB); mapping: `app/build/outputs/mapping/release/mapping.txt`.
PWA 183 tests / 0 failures. **Live: PWA 0.5.14** (deployed via `firebase deploy --only hosting:pwa`). Stage-1 ports are committed, not deployed, and change nothing for users.
**Not deployed to Play**; James was uploading the AAB himself. Play production is still 73 (0.11.12).

## 6. GOTCHAS
- Firebase CLI login expired once; James ran `firebase login --reauth`. `DEPLOY_PWA.cmd` ends in `pause`; run its two steps directly (`npm --prefix web test`, then `firebase deploy --only hosting:pwa --project chefvoice-d7fec`).
- No python, `strings`, or adb devices in this shell. In Bash, a very large multi-heredoc command broke parsing (`unexpected EOF`); use the Write tool for files.
- `cmd /c` needs `.\gradlew.bat`; capture stderr to a file or Kotlin errors are hidden.
- `local.properties` is gitignored; copied from the session-6 worktree.
- PWA badge "PWA 0.2 · Firebase" is hard-coded in `web/index.html`; real version is `sw.js` CACHE.
- Simply Recipes blocked a desktop-JVM `HttpURLConnection` with a Cloudflare challenge; curl and Java's `HttpClient` passed.

## 7. NEXT
PWA parity, remaining stages (commit each; deploy only on James's say-so):
2. UI in `web/js/app.js`: servings stepper + As written/Metric/Imperial on recipe detail; shopping list screen (localStorage, like `storage.js`); collections; a **cook-along screen** (one step at a time, Wake Lock, `speechSynthesis` read-aloud, tappable timers from `step-timers.js`, hands-free via `SpeechRecognition` + `matchCommand`; only `safeFromPartial` commands on interim results). Add a "Cook this recipe" button on local and Community recipe pages.
3. Swipe-to-save on Community cards (adds only, never unsaves) and notification ✕ / swipe-to-clear.
4. Recipe import needs a server-side fetch (browser CORS blocks it): a Cloud Function, with SSRF rules like `RecipeUrl.kt`. Needs James's approval (new deploy).
Verify PWA UI with `preview_start` (Browser pane); nothing PWA-side has been seen rendering.

## 8. OPEN
- Play upload/rollout status unknown; notes for 0.11.12–0.11.16 not written.
- Import screen never run on a phone; is the phone Cloudflare-challenged?
- Policy: may imported recipes be published to Community? (leave / warn / block)
- Push this branch to origin? (no upstream)
- Saved cookbook only shows bookmarks still in the public feed, and its back button says "← Community".
- Old `possible-missed-step`, Android pre-save Review, `debugSymbolLevel`, ad-ID declaration items from session 6 remain unscoped.
