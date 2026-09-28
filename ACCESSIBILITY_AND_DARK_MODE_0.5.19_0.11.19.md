# Accessibility, contrast and dark mode (PWA 0.5.19, Android 0.11.19 / 80)

The user-interface batch from the 2026-09-26 full audit: **F2** (the Android half), **F12**,
**F19**, **F20** and **F26**, plus two defects found while doing them. Committed and green in CI
on `claude/audit-implementation-7bb2be`. **PWA 0.5.19 is live since 2026-09-27**, deployed with
`DEPLOY_PWA.cmd` and verified on the deployed site. Android 0.11.19 still needs a release build,
a device check and a Play upload (see the end).

**Not touched:** the parser (`voice/`, `web/js/*parser*`) and the golden corpus,
`firestore.rules`, `storage.rules`, every Functions codebase, `transcribeChefVoice`, Live
signaling, App Check. No backend deploy is needed for anything here, and no Play Console answer
changes: no new permission, no new data.

## F2 — Android UI tests, on the JVM

Android had no UI test of any kind. Robolectric 4.17 now runs the real `ChefVoiceApp`
composable inside `testDebugUnitTest`, so the existing CI `android` job runs it with no emulator.
Firebase is never initialised under Robolectric, so the app runs in its demo mode (local
recipes, the demo Community feed, signed out) and no test can reach the production project.

- `NavigationSmokeTest` (7): every tab opens its screen; Create opens on the capture step; Back
  retraces the tabs visited; Messages and Notifications open from Community's banner; the unread
  badge; the feed's labelled actions; a shopping line.
- `AccessibilityLabelsTest` (2): the two surfaces the signed-out demo cannot reach, drawn on
  their own: a signed-in alert list and a viewer's Live reactions.
- `AppearanceTest` (6): see F26.
- **Each fix was reverted once to check that its test fails.**
- `RenderScreensTest` is not a check. It is skipped unless `CHEFVOICE_SCREENSHOTS` names a folder,
  and then it writes a PNG of every main tab in light and in Blackout, drawn by Robolectric's
  native graphics at a 393 x 851 dp phone size. It is the only way to look at the Android
  screens without a phone:

  ```
  set CHEFVOICE_SCREENSHOTS=C:\somewhere\shots
  gradlew.bat :app:testDebugUnitTest --tests "com.chefvoice.app.ui.RenderScreensTest"
  ```

Plumbing: `testOptions.unitTests.isIncludeAndroidResources`; the test JVM gets
`--add-exports=java.base/jdk.internal.access=ALL-UNNAMED`, without which every Robolectric test
dies in setup on Java 17+; `app/src/test/resources/robolectric.properties` pins the Android 16
runtime rather than following `targetSdk`; CI caches that runtime (about 200 MB in `~/.m2`).

## F12 — TalkBack says what a control does, and whether it is on

TalkBack read emoji by their Unicode names ("white heart suit 2", "outbox tray", "black star")
and said nothing about whether a dish was liked or saved. Icon-only controls now carry a
description and a state, and the glyph drawn on them is hidden from TalkBack:

| Control | TalkBack now |
|---|---|
| Feed card Like, and the recipe's Like | "Like, 2 likes", Liked / Not liked |
| Feed card Save | "Save to cookbook", Saved / Not saved |
| Feed card comments and share | "Open recipe and comments, 3 comments"; "Share recipe" |
| Card and chef-profile kebab | "More options" |
| Notification ✕ | "Clear notification" (the type glyph before each title is no longer read) |
| Live reactions (viewer) | "Send a heart, 3 hearts", "Send fire, 1 fire reaction", "Send applause, 0 claps" |
| Live counts (host, Live list) | "3 hearts, 1 fire reaction, 0 claps" |
| Servings − / + | "Fewer servings" / "More servings" |
| Published marker on a library card | "Published" |

**Switch rows are one stop each.** The shopping list, the alert preferences, the collection
picker and the Pro preview each drew a text row and a separate `Switch`. The switch was its own
TalkBack stop, and it said "On, switch" without saying what it switched. Each row is now a
single toggle, read as its label and state; a shopping line says "In the basket" or "To buy".

How this was checked: Robolectric was asked for the real `AccessibilityNodeInfo`s. In this
Compose version, a control's own description and each visible label under it reach TalkBack as
separate pieces, read in order. That is why the drawn glyph is hidden wherever a description is
set: otherwise a tab would be read "Community, 3 unread, Community".

Also: "1 ingredients" and "1 steps" on Android library and feed cards (the PWA fixed its copy in
0.5.18), and the double-tap heart and the no-photo plate are decoration, hidden from TalkBack.

**Still open:** buttons whose label starts with an emoji ("🎙 Create a recipe") still read the
emoji's name before the words. They are not icon-only, and replacing the emoji with Material
Symbols is a design change of its own. The audit marked the exact TalkBack wording "suspected
until checked on device", so a device pass is still worth doing (see below).

## F19 — the tab bar shows unread activity

Messages and Notifications have no tab; they open from Community's banner and from Profile.
A reply that arrived by push left no mark anywhere in the bar, and on those two screens no tab
was highlighted.

- The **Community tab carries a badge**: unread conversations plus unread alerts. TalkBack reads
  "Community, 3 unread".
- While Messages or Notifications is open, **the tab it was opened from stays highlighted**
  (Community or Profile).
- **Not done:** the audit also noted that the two platforms name and order their tabs
  differently (Android: Recipes, Create, Community, Live, Profile; PWA: Cook, Recipes, Community,
  Inbox, Live, Profile). Aligning them is a product decision, left for James.

## F20 — orange text and buttons meet AA contrast

White on the brand orange `#F06423` is **3.2:1**, below the 4.5:1 a button label needs.

- **PWA:** fills behind label text use `--primary: #c94a12` (4.7:1 under white), blending into
  the existing red. Orange text uses `--accent` (the same colour); orange text on peach uses
  `--on-peach`. The brand orange is kept for decoration only: focus rings, borders, progress.
- **Android uses `#B03E0E`, not `#C94A12`.** Material 3 draws every `TextButton` label in
  `primary`, on tinted cards and dialogs as well as on the page, and one colour has to pass
  everywhere:

  | as primary | white on it | on the page | on peach | on a card | on a dialog |
  |---|---|---|---|---|---|
  | `#F06423` (before) | 3.21 | 3.11 | 2.84 | 2.49 | 2.61 |
  | `#C94A12` (the audit's) | 4.70 | 4.56 | 4.16 | **3.64** | **3.82** |
  | `#B03E0E` (Android) | 5.93 | 5.76 | 5.26 | 4.60 | 4.82 |

  The PWA's cards are white, so `#C94A12` passes there.
- Android's selected tab label was drawn in `secondary`, the red, which is 3.9:1 on the bar. It
  now uses `primary` (5.1:1).

**Found while doing this — Android's themes leaked Material's baseline purple.** The two color
schemes set 10 of Material 3's roles. The rest fell back to Material's defaults: lavender-grey
cards, nav bar and selected-tab pill in light, purple-grey ones in Blackout. Both schemes now
name every role. The added neutrals and containers are the tones Material's own tonal-spot
algorithm (material-color-utilities 0.3.0) derives from `#F06423`; Blackout's containers sit a
few tones darker, to stay near-black. Photo-less feed cards now use the PWA's brown. Before,
they were a bright salmon block in Blackout.

## F26 — dark mode on both platforms

- **Android:** Profile → Appearance is now **Auto / Light / Blackout**, and Auto, the default,
  follows the phone's dark theme. A chef who pressed the old Blackout switch keeps what they
  chose; one who never touched it now follows the phone. The status and navigation bar icons and
  the window background follow the app's theme, which can differ from the phone's; before this,
  dark icons on Blackout were invisible. The window theme is day/night (`values-night`), so a
  dark phone no longer opens on a white window. The launch splash is black in both themes,
  matching the brand cover the app always opens on.
- **PWA:** the stylesheet draws every colour a theme changes from a token and redefines the
  tokens for dark from Android's Blackout palette. The PWA follows the device's colour scheme,
  and Profile has the same Auto / Light / Blackout choice, as a real radio group.
  `js/theme-boot.js`, a small blocking script in `<head>`, applies the choice before anything is
  drawn. `app.js` is a module and runs too late to avoid a flash. The script also points the
  browser's theme-color at the chosen theme, and falls back to Auto when storage is blocked.

**Found while doing this — a dark-theme switch stopped a cooking capture.** `MainActivity`
handled rotation itself but not `uiMode`, so every dark-theme switch recreated the activity.
That disposed the Create screen, and its cleanup stops the foreground service, closes the
capture and cancels the recorder. Phones switch themes on a schedule, at sunset, which is
dinner time, so a following theme made this a realistic way to lose a session. `uiMode` is now
declared, and Compose re-themes in place. The bug predates this release: Android recreated the
activity on a theme switch even when the app ignored the theme.

## Tests

- Android **226 / 0** (209 before), 2 skipped: the opt-in renderer.
- PWA **276 / 0** (265 before). `tests/theme.test.mjs` checks that:
  - every text/background token pair is at least 4.5:1 in both themes;
  - the two dark blocks stay identical and every token exists in both;
  - only photo and video overlays hard-code colours;
  - theme-boot behaves as described, including with blocked storage.
- jsdom **74 / 35 / 46** (unchanged). e2e **17 / 0** (10 before). `e2e/appearance.spec.mjs`
  emulates light and dark devices and measures every piece of text on every tab, every Cook step
  and cook-along against what is actually drawn behind it. Translucent layers are composited and
  gradients checked stop by stop. It was checked by putting `#F06423` back under the button
  labels, and it named both buttons at 3.21:1.
- Notification gates **78 / 0**. Two of them sliced `ChefVoiceApp.kt` on
  `private fun NotificationsScreen(`, which is `internal` now so a test can draw it; they match
  either visibility.

## To release

**PWA 0.5.19: done 2026-09-27.** `DEPLOY_PWA.cmd` deployed the `pwa` Hosting target only, after
its gates passed (276 / 0). On the deployed site, `sw.js` reports `chefvoice-pwa-v0.5.19`, the
page loads `js/theme-boot.js` and the tokenised stylesheet, and a dark device gets the dark theme
with the Blackout button colours. The first attempt stopped at an expired Firebase CLI login,
before uploading anything; James ran `firebase login --reauth`.

**Android 0.11.19 / 80:** a release build from the shell that holds the `CHEFVOICE_RELEASE_*`
variables, then on a phone:

1. TalkBack on a Community card: Like and Save announce their state, and nothing reads an emoji
   name.
2. Phone in dark theme: the app opens without a white flash, in Blackout, and Profile →
   Appearance shows Auto.
3. Start a cooking capture, switch the phone's dark theme: the capture keeps running.
4. Blackout chosen on a light phone: the status bar icons are light, and visible.
5. A phone that had Blackout switched on before this update is still in Blackout.
6. An unread message or alert shows a badge on the Community tab.
