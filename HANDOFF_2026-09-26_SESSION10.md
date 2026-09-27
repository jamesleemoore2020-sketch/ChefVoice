# ChefVoice session handoff — 2026-09-26 (session 10: audit implementation, part 2)

## 1. TASK
Implement the 2026-09-26 full audit (F1–F31). The report is at
`C:\Users\james\Downloads\AUDIT_2026-09-26_FULL.md`, deliberately not in this public repo. Part 2,
the UI batch that opens Android 0.11.19 / PWA 0.5.19, is done and pushed, and nothing from it is
deployed yet.

## 2. TOUCHED
Branch `claude/audit-implementation-7bb2be`, pushed, clean. Per-item detail:
`ACCESSIBILITY_AND_DARK_MODE_0.5.19_0.11.19.md`; rollup at the top of `BUILD_STATUS.md`.
- Android 0.11.19 / 80: `ChefVoiceApp.kt` (labels, badge, schemes, Appearance), `MainActivity.kt`
  (system bars follow the app), `AndroidManifest.xml` (theme, `uiMode`), `res/values*/themes.xml`
  and `colors.xml`, `app/build.gradle.kts` (Robolectric, test JVM flag, version).
- Android tests: `app/src/test/java/com/chefvoice/app/ui/` (Navigation, AccessibilityLabels,
  Appearance, RenderScreens), `app/src/test/resources/robolectric.properties`.
- PWA 0.5.19: `web/css/styles.css` (colour tokens, dark blocks, segmented control),
  `web/js/theme-boot.js` (new), `web/js/app.js` (Appearance card), `web/index.html`, `web/sw.js`,
  `web/package.json`, `web/tests/theme.test.mjs`, `e2e/appearance.spec.mjs`.
- `.github/workflows/gates.yml` (Robolectric runtime cache); two notification gates now match
  `fun NotificationsScreen(` at any visibility.

Done: F2 (Android half), F12, F19 (badge and highlight), F20, F26. Also: Android's schemes no
longer leak Material's baseline purple, and a dark-theme switch no longer stops a cooking capture.

## 3. DECISIONS
- Android `primary` is `#B03E0E`, the PWA's fill `#c94a12`. Material draws every TextButton label
  in `primary` on tinted cards and dialogs, where `#C94A12` is 3.6–3.8:1; the PWA's cards are
  white. The numbers are in the writeup.
- The added Material roles come from material-color-utilities' tonal-spot scheme for `#F06423`;
  Blackout's containers sit a few tones darker.
- Auto (follow the device) is the default on both platforms. Android keeps an old "blackout"
  flag as that choice; its new pref is `appearance` = system/light/blackout. The PWA stores
  `chefvoice.appearance` = light/dark in localStorage, and absent means Auto.
- The unread badge rides on the Community tab; no Messages tab was added. Renaming or reordering
  tabs to match the PWA was left for James (a product call).
- A control with a description has its visible label hidden from TalkBack: Compose sends a
  control's description and its visible label as separate pieces, and TalkBack reads both.
- The Android launch splash is black in both themes, matching the brand cover.

## 4. RULED OUT
- `captureToImage()` under Robolectric: it waits for a hardware frame the paused looper never
  draws. Draw the decor view to a software canvas instead (see `RenderScreensTest`).
- Starting `MainActivity` in a test: its App Check bootstrap initialises Firebase, against
  production. Read its manifest entry through `PackageManager` instead.
- `gradlew.bat -i` / `--info` from PowerShell: `tools/gradle-bootstrap.ps1` takes them as its own
  (ambiguous) parameters. Read `app/build/test-results/.../*.xml` instead.
- PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM; it slipped into the manifest once and
  was removed. Edit files with Edit/Write or Bash.
- material-color-utilities 0.4.0 does not load in Node (extensionless ESM imports); 0.3.0 does.

## 5. STATE
- CI green through the Android `uiMode` commit (`cecea13`); this handoff is docs only. Android
  226 / 0 (2 skipped: the opt-in renderer), PWA 276 / 0, jsdom 74 / 35 / 46, e2e 17 / 0,
  notification gates 78 / 0.
- **Not deployed:** PWA 0.5.19 (`DEPLOY_PWA.cmd`); Android 0.11.19 / 80 needs a release build
  and the six-step device check at the end of the writeup.
- The Claude Browser pane's `localhost:4173` tab is signed in to James's real account, and
  Firebase is reachable there (unlike e2e). Only local-only actions were done there.
- Carried from session 9: the `chefvoice-notifications` (F15) deploy is still unverified.

## 6. GOTCHAS
- Robolectric needs `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED` (set in
  `app/build.gradle.kts`) and downloads about 200 MB into `~/.m2` on its first run.
- New PWA colours go in as tokens in all three blocks (`:root`, the media-query dark block,
  `[data-theme=dark]`). `theme.test.mjs` fails on a hard-coded colour outside photo overlays, and
  the e2e contrast audit fails on any text below AA in either theme.
- `web/js/theme-boot.js` must stay a classic script loaded from `<head>`, and it is in `sw.js`
  `CORE` (the precache test requires every `web/js` file there).
- The next Android release after 0.11.19 is versionCode 81.

## 7. NEXT
1. With James's go-ahead: deploy PWA 0.5.19 and check the deployed `sw.js` reports
   `chefvoice-pwa-v0.5.19`; build Android 0.11.19 / 80, run the device check, upload.
2. Then, per session 9: F22, F23 (emulator tests first, console diff before any rules deploy),
   F21, F30, F11, F29, F17, F10, F18, F31.
3. Left from this batch: tab naming and order across platforms (F19); buttons whose label starts
   with an emoji still read its name (F12).

## 8. OPEN
- Play: 0.11.18 rollout; Advertising ID → No and Data safety (Videos, Purchase history)
  answered?
- Keystore password rotation (flagged 09-07 and 09-11) unconfirmed.
- F25: repo public or private, and API-key restrictions.
- Uncommitted files in the main checkout need a home.
- `master` (`8dcda41`) is far behind this lineage; merge plan undecided.
- The "testing2" test recipe is still public.
