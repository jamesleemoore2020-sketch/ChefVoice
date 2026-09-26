# ChefVoice — full audit brief (2026-09-26)

**Audience: a Claude *chat* session (claude.ai), not Claude Code.** You are being asked to run
a full, opinionated audit of ChefVoice and come back with a prioritized list of what to add,
improve, or make run better. A Claude Code session will execute what you recommend, so your
output needs to be specific enough to act on.

This brief was written from a Claude Code session with the repo open, so the numbers in §5 and
the leads in §8 are measured, not estimated. Baseline: branch
`claude/chefvoice-2026-09-11-handoff-be3999`, clean, HEAD `46e8ee0`, Android
**versionCode 78 / 0.11.17**, PWA **0.5.17**.

---

## 1. What ChefVoice is

An Android app (Kotlin/Compose) plus a PWA. A chef narrates a cooking session out loud; a
**deterministic, non-LLM parser** turns the raw speech transcript into structured ingredients
and method steps. Around that core sits a Firebase social/community layer (recipes, profiles,
following, comments, likes, messaging, live WebRTC video), a notifications system, a billing /
entitlement system, and a recipe-import-from-URL feature.

The product bet is that the voice-to-recipe core is the moat: a chef cooks and talks, and gets
a clean recipe without typing. Everything else is the community that makes recipes worth
creating. Judge additions and improvements against that bet.

---

## 2. Getting at the code

You will not have the repo. Pick whichever of these fits how you're set up:

- **Ask James to upload a zip of the repo** (excluding `node_modules`, `build/`, `.git`). This
  is the best option — it makes a structural audit possible rather than a surface one.
- **Ask for specific files.** If uploads are awkward, the files worth asking for first are
  listed in §5 with line counts so you can size the ask. Start with
  `app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt`, `ui/ChefAppState.kt`,
  `web/js/app.js`, and `firestore.rules`.
- **Audit the live surfaces only** (§3) and say plainly in your report that the structural half
  is unreviewed. Do not guess at code you haven't seen and present it as a finding.

Whatever you can't reach, list explicitly under "not audited" rather than silently skipping it.

---

## 3. What is live and reachable from a browser right now

- **PWA: https://chefvoice-d7fec.web.app** — the full app, 0.5.17, deployed. This is your main
  hands-on surface. Drive it, sign in, create a recipe, import one, poke every tab.
- **Account-deletion page: https://chefvoice-delete-account.web.app** — the required-by-policy
  standalone page.
- **Play Store listing** for `com.chefvoice.app` — 0.11.17 was uploaded on 2026-09-18; rollout
  state was never confirmed. Audit the listing as a listing: title, short and full description,
  screenshots, feature graphic, data-safety answers, content rating.
- **Firebase console** (project `chefvoice-d7fec`) and **Play Console** — both James's accounts.
  Read freely; **do not change settings, publish, or deploy anything.** If a finding needs a
  console change, write it down for James to do.

Treat production as read-mostly regardless of what your tools allow: create test content under
a test account, don't touch other users' data, and don't delete anything.

---

## 4. The four independently-deployed backend pieces

Each is a deliberately isolated deploy unit. Keeping them separate is a decision, not an
accident — it exists so a notifications deploy can never take down the speech function.

1. **`chefvoice-notifications`** Cloud Functions (1051 lines) — Firestore triggers plus
   callables: message / comment / reply / like / follower / live notifications, push delivery,
   account and recipe deletion, report moderation, Storage upload permits.
2. **`chefvoice-billing`** Cloud Functions (650 lines) — Pro entitlement writes at
   `users/{uid}/entitlements/pro`, Admin-SDK-only. Currently grants launch access: 2 free years
   to the first 10 signups, 90 free days after, with a kill switch and a backfill.
3. **`chefvoice-import`** Cloud Functions (~1200 lines including tests) — fetches a recipe URL
   server-side and returns a structured draft. Never returns the page itself, by design.
4. **`firestore.rules`** (719 lines) + **`storage.rules`** (176) + `firestore.indexes.json` (62).

Plus a separate `transcribeChefVoice` speech function (Chirp 3) that the deploy scripts
deliberately never touch.

---

## 5. Surface inventory (measured)

### Android — one Gradle module, flat package `com.chefvoice.app`, no DI framework

compileSdk 36, minSdk 26, targetSdk 36, Java 17, Compose, R8 and resource shrinking **on** for
release. 16,078 lines of Kotlin across ~39 files. The big ones:

| File | Lines |
|---|---|
| `ui/ChefVoiceApp.kt` | 4508 |
| `ui/ChefAppState.kt` | 2031 |
| `cloud/FirebaseSocialRepository.kt` | 1709 |
| `voice/CookingSessionParser.kt` | 1048 |
| `voice/SecondPassReviewer.kt` | 832 |
| `ui/WebRtcLiveTransport.kt` | 760 |
| `voice/CookingSessionCapture.kt` | 538 |
| `data/RecipeRepository.kt` | 486 |
| `model/Models.kt` | 423 |

Sub-packages: `voice/` (the parser pipeline), `model/`, `data/`, `cloud/`, `media/`,
`notifications/`, `ui/`, `importer/`, `billing/`, `analytics/`, `util/`.

**Tabs:** Recipes, Create, Community, Messages, Notifications, Live, Profile — but only five are
in the bottom bar (`AndroidPrimaryTabs` = Library, Create, Community, Live, Profile). Messages
and Notifications are reached some other way. Worth auditing as a navigation question.

**34 composables live in `ChefVoiceApp.kt`**, including `LibraryScreen`, `CreateRecipeScreen`,
`CommunityScreen`, `MessagesScreen`, `ConversationScreen`, `NotificationsScreen`,
`LiveHubScreen`, `LiveRoomScreen`, `ProfileScreen`, `PublicChefProfileScreen`,
`RecipeDetailScreen`, `RecipeImportScreen`, `ShoppingListScreen`, `CookingScreen`,
`ProPaywallDialog`, and a dozen smaller pieces.

**Theme:** two hard-coded Material 3 schemes in that same file — a warm light scheme (primary
`#F06423`) and a "blackout" dark scheme (primary `#FF8A50`). No dynamic color. Whether it
follows the system theme is worth checking on device.

### PWA — `web/`, vanilla JS, no framework, no build step

7682 lines of JS across 23 modules. Largest: `app.js` 2502, `firebase-client.js` 955,
`cooking-session-parser.js` 912, `second-pass-reviewer.js` 798, `webm-duration-fix.js` 496.

Notable shape: **`index.html` is 35 lines and all CSS totals 164 lines** (`styles.css` 142 plus
`cook-wizard.css` 22) for a seven-tab app. Essentially the entire UI is generated in JS via
template strings. `app.js` uses `innerHTML` 29 times and `createElement` once.

Tabs: recipes, cook, community, inbox, live, profile.

Service worker `sw.js` caches under `chefvoice-pwa-v0.5.17`, network-first with a cache fallback
to `index.html`.

### Data model — 28 collection / subcollection matches in the rules

`users`, `recipes`, `comments`, `likes`, `bookmarks`, `followers`, `following`, `conversations`,
`messages`, `messageReads`, `blocks`, `notifications`, `notificationDevices`, `settings`,
`liveSessions`, `hostCandidates`, `viewerCandidates`, `peers`, `reactionState`, `reports`,
`moderation`, `moderationEvents`, `userRestrictions`, `entitlements`, `purchases`, `config`.

### Tests

- Android: 17 JVM unit test files, **209 tests / 0 failures** at last run.
- PWA: 24 test files, **243 / 0**. Import functions: **98 / 0**.
- `shared/golden-cooking-corpus.tsv` is the cross-platform parser regression contract — the same
  corpus runs against the Kotlin parser and the JS port, and both must pass every row.
- **There is no `app/src/androidTest` directory and no Espresso or Compose UI test dependency.**
  Every Android test is JVM-only. There are no end-to-end tests on either platform beyond three
  optional jsdom checks.

### Docs

**127 markdown files in the repo root.** Most are per-version writeups (`METHOD_*`,
`SECOND_PASS_*`, `PWA_*`), each documenting one real-device bug and the narrow deterministic fix
for it. There are also 14 prior handoffs. Two earlier audits exist and are both narrow:
`UI_BRANDING_AUDIT.md` (a v0.6.1 branding and imagery pass) and `AUDIT_FIXES_0.10.2.md` (a
backend and rules correctness pass). Neither is a full product audit.

---

## 6. Audit scope

Cover all of the following. Where a dimension needs code you don't have, say so.

**A. In-app functionality.** Walk every flow end to end on the live PWA and reason about the
Android equivalent. Record a recipe by voice; review the draft; run Second Pass; save; publish;
import from a URL; cook along with servings scaling and unit switching; build a shopping list;
use collections; follow a chef; comment and reply; like; message; block; report; go live and
view a live session; delete a recipe; delete an account. For each: does it work, does it explain
itself, what happens when it fails, and what happens offline or on a bad connection?

**B. UI and UX.** Visual consistency between the two platforms and within each. Information
hierarchy, empty states, loading and error states, touch-target sizes, typography scale. Does it
work one-handed, and with wet or greasy hands, which is the actual use case? Is the cooking
screen readable at arm's length on a counter? Dark mode, landscape, tablet, font scaling at 200%.

**C. Accessibility.** TalkBack and screen-reader passes on both platforms, contrast ratios
against the orange palette, focus order, keyboard operation of the PWA, motion sensitivity,
captions or transcripts for live video. This is likely the weakest dimension — see §8.

**D. Structure and architecture.** The four-file concentration in §5 is the headline. Where would
you split, and what migration order keeps the golden corpus green? Is the manual object graph
still paying for itself at this size? Is the PWA's template-string UI sustainable, and if not,
what is the smallest change that helps — not a framework rewrite.

**E. Performance and smoothness.** App start time, tab-switch latency, list scrolling with many
recipes, Compose recomposition scope given the size of `ChefAppState`, image loading and caching,
PWA bundle size and time-to-interactive, the service worker's network-first choice, memory during
live video and long recordings, battery during a long cooking session with the screen held on.

**F. Security and privacy.** Rules coverage per collection including read paths, escaping at
every PWA interpolation site, PII handling, what the import function can be pointed at, whether
the analytics collect anything they shouldn't, whether the data-safety declarations match
reality, and whether account deletion actually deletes.

**G. Data model and cost.** Read and write amplification per screen, fanout costs, index
coverage, whether any counter can drift, what a popular recipe costs to serve, and where
Firestore is being used as a cache it doesn't need to be.

**H. Product and growth.** What's missing that a chef would expect. What's present that nobody
uses. Onboarding and first-run. Whether the free-then-Pro launch-access model makes sense.
Discovery and search. What would make someone come back on day 7. Be opinionated here.

**I. Store presence and release hygiene.** Listing quality, screenshots, the missing release
notes for 0.11.12–0.11.17, version and docs drift, whether 127 root markdown files help or hurt,
and whether the release process has gaps.

---

## 7. Protected invariants — do not recommend breaking these

These are deliberate, long-standing decisions. A recommendation that violates one will be
rejected, so if you want to argue against one, argue explicitly and say why.

- **No LLM anywhere in parsing.** `CookingSessionParser.kt` is 100% deterministic regex and
  heuristic logic. It does not guess or silently correct ASR mistakes — an uncertain phrase is
  left verbatim for the user or Second Pass to review. "Just use an LLM to clean up the
  transcript" is the single most likely bad recommendation; don't make it.
- **The original recorded audio is the source of truth**, kept private. The transcript and parse
  are derived from it and can be redone.
- **Second Pass is explicit, opt-in review**, never automatic correction. It re-parses and shows
  a diff the user accepts or rejects.
- **The golden corpus is a ratchet.** A new failing phrase becomes a corpus row first, then the
  parser is fixed, and no existing row may weaken. Both platforms must pass before either ships.
- **The four deploy units stay isolated**, and Hosting targets stay pinned. Never a bare
  `firebase deploy --only hosting`.
- **A rules deploy replaces the entire live ruleset**, and there is no CLI command to fetch the
  deployed one, so rules changes get diffed against the console by hand first.
- **App Check is monitoring-only on purpose**, until metrics justify enforcement.
- **`Recipe.importedFrom` is local-only on both platforms** and deliberately never sent to
  Firestore.

---

## 8. Leads already found — start from these, don't rediscover them

Measured in this session. Each is a lead, not a confirmed defect; confirm before reporting.

1. **Four files hold most of the app.** `ChefVoiceApp.kt` at 4508 lines with 34 composables and
   both color schemes; `ChefAppState.kt` at 2031 holding cross-screen state;
   `FirebaseSocialRepository.kt` at 1709 covering recipes, likes, comments, follows, messaging,
   live and moderation; `app.js` at 2502 doing much the same on the web. Everything about
   testability, recomposition scope and merge friction traces back here.
2. **Android accessibility looks thin.** 10 `contentDescription` usages across a 4508-line UI
   file with 34 composables. The PWA has 59 `aria-*` attributes, which is better but still needs
   a real screen-reader pass. Verify on device before quantifying it in your report.
3. **No UI or instrumented tests at all.** No `androidTest`, no Compose test dependency, no
   Espresso, no browser E2E. 550 passing tests, all unit-level, none of which would catch broken
   navigation, an unclickable button, or a screen that fails to render. This is probably the
   highest-leverage gap in the project.
4. **PWA escaping needs a site-by-site check.** There is a proper `escapeHtml` helper at
   `app.js:185` and every site I sampled uses it — but it escapes `&`, `<`, `>` and `"` and
   **not `'`**, so any interpolation into a single-quoted attribute is unprotected. With 29
   `innerHTML` assignments carrying user-generated content (recipe titles, chef names, comments,
   tags, imported-recipe fields), check every one rather than trusting the pattern.
5. **`innerHTML` rebuilding as a performance and state-loss question.** Whole sections are
   re-rendered as strings. Look at what that costs on a mid-range phone with a long feed, and
   whether it drops scroll position, focus, or in-progress input.
6. **164 lines of CSS for a seven-tab app** suggests styling is thin or inline. Check whether the
   PWA and Android actually look like the same product.
7. **Two tabs are missing from the Android bottom bar.** `Tab` defines seven;
   `AndroidPrimaryTabs` lists five. Find out how Messages and Notifications are reached and
   whether that is discoverable.
8. **Docs drift.** `README.md`'s header still says "v0.10.0 (versionCode 51)" while the app is at
   0.11.17 / 78. Release notes for 0.11.12–0.11.17 were never written. 127 root markdown files
   with no index.
9. **Code hygiene is genuinely good.** Zero `TODO` / `FIXME` / `HACK` comments in any source
   file. Don't manufacture findings here; note it as a strength.
10. **Session-6 leftovers, still unscoped:** `possible-missed-step`, an Android pre-save Review
    step, `debugSymbolLevel` for native crash symbolication, and the ad-ID declaration.

---

## 9. Already known — report only if you can add something

Don't spend the audit re-finding these. They are documented in
`HANDOFF_2026-09-18_SESSION8.md`.

- **DNS rebinding after the import fetch's address check is still possible.** Closing it needs
  pinning the socket to the checked address, which `fetch` does not allow. Documented in
  `page-fetcher.js`. If you know a real fix, that is valuable.
- **`importUsage/{uid}` relies on rules default-deny** rather than an explicit
  `allow read, write: if false`. To be added next time rules deploy for another reason.
- **Hands-free and the wake lock have never been exercised on a real phone** — only where the
  browser refused the microphone.
- **BBC Good Food's author leaked in as a tag** (`#josheagleton`); the author-tag filter did not
  catch it. Android shares the logic, so it behaves the same. Unexplained.
- **The PWA badge hard-codes "PWA 0.2 · Firebase"**; the real version is the `sw.js` cache key.
- **0.11.17's Play rollout state has never been confirmed.**

---

## 10. What to hand back

A single prioritized document. For each finding:

- **What** — one sentence, specific enough to act on.
- **Where** — platform and file or screen.
- **Why it matters** — user-visible consequence, not a style preference.
- **Severity** — blocker / high / medium / low / nice-to-have.
- **Effort** — rough size, and whether it touches a protected invariant in §7.
- **Confirmed or suspected** — say which. A suspected finding you could not verify is still
  worth reporting, labelled honestly.

Then three short lists to close: **the five things worth doing first**, **what to add** ranked by
value over effort, and **what you could not audit**.

Order the whole thing so that someone who reads only the first page still gets the most
important things.

---

## 11. Non-goals

- **Don't change code.** This is an audit; a Claude Code session executes the findings.
- **Don't deploy, publish, or change console settings.** Read-only on Firebase and Play.
- **Don't recommend rewrites** — no "port the PWA to React", no "split into Gradle modules" as a
  single step. Recommend the smallest first move that makes the next move easier.
- **Don't pad.** A short list of real findings beats a long list with filler. Item 9 in §8 is
  there to make the point: where the project is good, say so and move on.
