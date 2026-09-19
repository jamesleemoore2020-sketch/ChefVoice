# Current handoff — 2026-09-18 (recipe import on the PWA, and the publish policy)

PWA 0.5.17 + **Android 78 / 0.11.17** + a **new Cloud Functions codebase, `chefvoice-import`**.
The last thing Android could do that the PWA could not. A browser refuses to fetch another
site's page from a script, so this is the one stage that could not be a port: a separately
deployed function reads the page on the chef's behalf. It is **not a page proxy** — it returns
a recipe draft or the reason there wasn't one, never the page. Sign-in required, 30 imports
per chef per day, counted before the fetch. The counter lives at `importUsage/{uid}`, a path
`firestore.rules` never matches and therefore denies to clients, so **no rules deploy**.
**The function and PWA 0.5.17 are both deployed and verified live**; `chefvoice-notifications`, `chefvoice-billing`,
`transcribeChefVoice`, Hosting, rules and App Check were not touched. See
`PWA_RECIPE_IMPORT_0.5.17.md`.

- **SSRF, where it matters more than on a phone.** On Google's infrastructure "not a public
  address" also means the metadata server. Android's rules were ported exactly and **one check
  was added**: every redirect hop's hostname is *resolved first*, and the fetch is refused if
  any address it resolves to is not public — which a hostname-only rule cannot catch, since
  `evil.example` can point at `169.254.169.254`. DNS rebinding after the check is still open
  and is written down in `page-fetcher.js` rather than left implied.
- **Publish policy decided: warn, but allow.** Publishing an imported recipe now asks first,
  names the site, and says the method came from someone else's page. Declining keeps it
  private. Needed one new field, `Recipe.importedFrom`, **local on both platforms** and never
  written to Firestore, so **no rules change**.
- **98 import tests / 0 failures** — real behaviour tests, not source-text checks, because the
  whole importer is pure functions with injectable fetch and DNS. **They caught two real port
  bugs**: a regex that lost its anchor and threw away the amount on any line containing a
  hyphen ("all-purpose flour"), and an IPv6 classifier that read `fe80::1` as public.
- **Verified against the deployed function**: bbcgoodfood.com imported end to end; a site that
  answered 402 was reported as refusing rather than half-guessed; the publish warning fired and
  declining left the recipe private.
- **Android 78 / 0.11.17 is built, signed and uploaded to Play.** `assembleRelease` and
  `bundleRelease` both succeeded; the AAB is at `app/build/outputs/bundle/release/app-release.aab`
  (33.7 MB) with its mapping beside it, and the APK verifies as v2-signed by the release key.
  James uploaded it; the track and rollout state were not checked from here.

# Current handoff — 2026-09-18 (PWA parity, stage 3)

PWA 0.5.16 (service-worker cache bumped). **The two swipes.** Swipe a Community card right to
keep the dish — it only ever *adds*, never unsaves, because the gesture reads as "keep this"
not "toggle this". Swipe a notification either way to clear it, with a ✕ for chefs who would
rather tap and **Clear read notifications** for everything already read. Android untouched
(still 77 / 0.11.16); parser, corpus, `firestore.rules`, Functions, Live and App Check
untouched, and **no new backend surface** — the swipes call the `toggleBookmark` and
`deleteNotification` the client already had. PWA 243 tests / 0 failures (227 before), plus a
new jsdom check for the Activity tab. **Live: deployed to https://chefvoice-d7fec.web.app/
(`hosting:pwa` only)**; `sw.js` on the deployed site reports `chefvoice-pwa-v0.5.16`. See
`PWA_PARITY_STAGE3_0.5.16.md`.

- **The axis lock is the rule that matters on a phone.** A gesture commits to an axis after
  ten pixels and never changes: a finger that started scrolling the feed keeps scrolling it,
  even if it later curves sideways. Rows carry `touch-action: pan-y` so the browser owns
  vertical scrolling and only a sideways gesture reaches the app at all.
- **A swipe that ends over a button no longer fires it**, so saving a dish cannot also open it.
- **Notification rows now match Android**: type glyph, title, body, arrival time, ✕. A cleared
  row is faded out at once rather than after a Firestore round trip, and **a failed delete
  puts it back** and says why.
- **The Activity tab cannot be tested against a real account** — notification documents are
  backend-created, so a client can never make one. `tests/inbox-activity.dom.mjs` is the only
  coverage it has, and was confirmed to fail on a broken threshold rather than pass regardless.

# Current handoff — 2026-09-18 (PWA parity, stage 2)

PWA 0.5.15 (service-worker cache bumped so phones pick it up). **The PWA can now be cooked
from.** Stage 1 shipped the ported modules but nothing imported them; stage 2 is the user
interface on top: a **cook-along screen** (one step at a time, Wake Lock, read-aloud split
from repeat, tappable timers, hands-free voice commands), a **servings stepper with As
written / Metric / Imperial**, a **shopping list**, and **collections**. Android untouched
(still 77 / 0.11.16); parser, corpus, `firestore.rules`, Functions, Live and App Check
untouched. Collections and the shopping list are `localStorage`, so **no rules deploy**.
PWA 227 tests / 0 failures (183 before), plus both optional jsdom checks fixed — they had
been failing since 0.5.14 and 0.11.14 respectively. **Live: deployed to
https://chefvoice-d7fec.web.app/ (`hosting:pwa` only) and verified by driving the deployed
client**, not localhost — the cook-along, its timer, the shopping shortcut and the collection
chips all work there. See `PWA_PARITY_STAGE2_0.5.15.md`.

- **Cook-along.** "🍳 Cook this recipe" on a saved recipe, a Community recipe, and a
  Recipes-tab card. Timers are offered **only for durations the chef actually stated** in
  that step, a range timing its lower bound; a step with no stated duration gets no timer
  rather than a guessed one. Hands-free fires only reversible commands on an interim result,
  so a half-heard "stop" cannot act.
- **Scaling is display only.** Nothing is written back — the saved recipe still reads the
  servings and units the chef narrated, and the panel says so while scaled. Quantities that
  cannot be read as numbers pass through untouched; volume is never converted to weight.
- **Shopping list and collections are local to the browser**, matching Android's reasoning:
  cloud bookmarks already cover saving other chefs' dishes, so neither needs a Firestore
  collection or a security rule.
- **Bug found in the browser and fixed**: a shopping line's tick box was wrapped in its own
  `<label>`, so every click reached it twice and the line landed back where it started.

# Current handoff — 2026-09-18 (PWA save fix)

PWA 0.5.13 (service-worker cache bumped so phones pick it up). **Saving a Community recipe
from the PWA was rejected with "Missing or insufficient permissions"**: the client wrote
`{createdAt}` but `firestore.rules` requires the bookmark to carry `recipeId` equal to its
path id, as Android writes it. It has failed since the rules were written. One-line fix in
`web/js/firebase-client.js`, pinned by `web/tests/bookmark-rules.test.mjs` (fails on the old
code). PWA 132 tests / 0 failures. No rules change, nothing deployed yet -- the fix is not
live until `DEPLOY_PWA.cmd` is run. **Swipe-to-save is Android-only (0.11.13); the PWA never
had it**, so "swipe doesn't work on the PWA" is a missing feature, not a regression.

# Current handoff — 2026-09-18 (recipe import)

Android versionCode 77 / versionName 0.11.16. **Recipe import from a web address**, plus a
bug fix found on the way in. Parser, corpus, rules, Functions, Live and App Check
untouched; nothing in `web/` changed, so the PWA stays at 0.5.12. Android 205 tests / 0
failures (108 before). See `RECIPE_URL_IMPORT_0.11.16.md`.

- **Recipes tab → "Import from a web address".** Paste a link; the page is read on the
  phone and saved as an ordinary **private** recipe, opened straight away with a notice
  asking the chef to check it against the page. New `importer/` package, entirely apart
  from `voice/`. It reads the schema.org `Recipe` JSON-LD a site publishes and reports what
  it says: no scraping of visible text, no guessed yield or time, no paragraph split into
  steps. Gaps the page leaves are named in the notice. A page with no structured recipe is
  refused, not half-guessed.
- **Written-form ingredient parser, separate from the voice one** so it cannot disturb a
  corpus row. Fails soft (a size like "1 1/2-inch" is not an amount; ranges kept as
  written) and emits the voice parser's canonical units, so scaling, unit conversion and
  shopping-list merging treat an imported recipe like a narrated one.
- **Attribution lives in the description** ("Source: author · url"), so it travels with a
  published recipe and needs no Firestore field and **no rules deploy**. **Open decision:**
  nothing stops publishing an imported recipe to Community; see the writeup.
- **Safe fetch:** https only (http upgraded), private/local hosts and credentials refused,
  the same rules re-applied to every redirect hop, timeouts, 5 MB cap, plain-language
  errors. Nothing is deployed and no Cloud Function is involved.
- **Bug fix: local tags were never saved.** `RecipeRepository` never wrote or read
  `Recipe.tags`, so every tag vanished when the app closed while the screen said "Tags
  saved", and a restart then **Update Community** pushed an empty tag list over the
  published one. Fixed, with a round-trip test confirmed to fail without the fix. Tags
  lost before this are not recoverable; published recipes' tags still exist in Firestore.
- **Validated on five live recipe pages from five sites** (all extracted correctly, 5-77
  ms each), which found six real ingredient-line gaps the synthetic tests missed; all
  fixed and pinned. Live pages are not committed as fixtures.
- **NOT verified on a device.** No phone attached and no emulator installed: the import
  screen, its keyboard/Paste/back behaviour, and the fetch through Android's own network
  stack have not been run. Debug and release (R8, release-signed) builds are clean.
- **One real site blocked the fetch.** Run end to end against live servers from a desktop
  JVM, two of three real recipe sites imported (including an `http://` link that was
  upgraded and a link pasted inside a sentence with tracking parameters); **Simply Recipes
  returned a Cloudflare bot challenge (403)** to the JVM's `HttpURLConnection` while curl and
  Java's newer HTTP client, with identical headers, got the page. It is reported as "that
  site wouldn't let ChefVoice read the page". Whether the phone is challenged the same way is
  the first thing to test on the device. The escalation, if many sites refuse, is a
  WebView-based read, not imitating a browser.

**Install:** build `:app:assembleRelease` and install over the top (see the install note
below), then try a real recipe link on the Recipes tab.

# Current handoff — 2026-09-18 (device-test fixes)

Android versionCode 76 / versionName 0.11.15. Three fixes from testing 0.11.14 on the
SM-S938U. Parser, corpus, rules, Functions, Live and App Check untouched; nothing in
`web/` changed, so the PWA stays at 0.5.12. Android 108 tests / 0 failures.

- **The Community banner and the Following/Discover switch now scroll away.** They sat in
  a fixed `Column` above the feed, so 170dp of hero artwork stayed on screen permanently
  and the dishes -- the reason anyone opens the tab -- scrolled in a short window beneath
  it. The whole screen is now one `LazyColumn` with the banner, the mode switch, search,
  notices and chef results as items, so the feed gets the full screen once you scroll.
  Verified on device: after two swipes the banner is gone entirely.
- **"Read out loud" is now its own hands-free command, separate from "repeat".** Repeat
  used to double as the way to switch reading on, which meant saying a word that means
  "again" to start something that had not happened yet. Now `read out loud` / `read
  aloud` / `start reading` turns continuous reading on, `repeat` says the current step
  once, and `stop reading` / `be quiet` turns it off. The narration guard still holds:
  "read the recipe before you start cooking" does not fire it.
- **The shopping list is reachable from where it is filled.** The list itself was working
  correctly -- 9 items had saved from a real recipe -- but the only way in was the button
  on the Recipes tab, which is a long way back from the recipe you just added from. The
  confirmation now carries a **View list** action straight to it. The Recipes-tab button
  also already shows a count once the list is non-empty ("Shopping list · 9 to buy").

**Install note for future sessions:** the dev phone carries a **release-signed** build, so
a debug APK is refused with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` and the only way to force
it is an uninstall, which wipes local recipes and private cooking audio. Build
`:app:assembleRelease` instead -- the four `CHEFVOICE_RELEASE_*` signing variables are set
in the environment and the keystore is at
`C:\Users\james\Documents\ChefVoice-Release-Key\chefvoice-release.jks`, so a signed APK
installs straight over the top with data intact, and exercises R8 at the same time.

# Current handoff — 2026-09-18 (later)

- **Five cook-along and library features, all built on structure the parser already
  produces.** Android versionCode 75 / versionName 0.11.14. Nothing in `web/` changed, so
  the PWA stays at 0.5.12. See `COOK_ALONG_AND_LIBRARY_0.11.14.md`.
- **Tappable step timers.** `util/StepTimers.kt` reads the durations a chef actually said
  out of a finished step ("20 minutes", "1 1/2 hours", "fifteen minutes", "10 to 12
  minutes") and the cook-along screen offers each as a timer with pause, cancel and a
  spoken finish. A range times the **lower** bound so the chef is called back while there
  is still a decision to make. Deliberately a **read-only extractor outside
  `CookingSessionParser`** -- it never edits a step and cannot change a corpus row. A bare
  number with no time unit is not a timer, so "preheat to 350 degrees" offers nothing.
- **Hands-free step advance.** A toggle listens for `next` / `back` / `repeat` /
  `start timer` / `stop timer` / `stop listening`. **Nothing said to it is recorded,
  transcribed or kept** -- `CookCommandListener` shares no code with capture and discards
  every result after matching. Matching is literal on purpose: "the next thing you want to
  do is add the garlic" must not advance the step. Only reversible commands may fire on a
  partial result.
- **Shopping list** from the structured ingredients, with a narrow merge rule: lines
  combine only when the name matches, the units are comparable **and** both quantities are
  readable numbers. "2 cups flour" + "200 g flour" stays two lines rather than guessing how
  flour packs. Merging into a ticked line un-ticks it, because there is more to buy.
- **Serving scaling and metric/imperial conversion**, both strictly a **view** -- nothing
  is written back, matching the rule the parser and Second Pass follow. Unreadable
  quantities ("a pinch") pass through untouched so scaling can never lose an ingredient,
  and volume is never converted to weight.
- **Collections**, chef-named groups of their own recipes, **local to the device**. Cloud
  bookmarks already cover other chefs' dishes, so this needed no Firestore collection, no
  rule and **no rules deploy**. Deleting a collection keeps every recipe in it.
- Parser, corpus, rules, Functions, Live/WebRTC and App Check all untouched. Gates: Android
  106 tests / 0 failures (`GoldenCookingCorpusTest` still 24), `assembleDebug` clean. The
  two `SwipeToDismissBox` call sites moved off the deprecated `confirmValueChange`.
- **Not yet device-verified.** The logic is unit-tested, but the gestures, voice commands
  and running timer are UI behavior needing a real device -- hands-free especially, whose
  recognizer cannot be exercised by a unit test. That is the next check before shipping.

# Current handoff — 2026-09-18

- **ChefVoice Review now sends at most 5 minutes of audio per review, down from 90.**
  Review does not record anything of its own -- it uploads the cooking-session recording
  the chef already made and hands it to Chirp 3, which is billed per minute, so that
  ceiling is what decides what a review costs. The cap does not limit Cook & Capture,
  does not truncate the local recording, and does not review "the first five minutes" of
  a longer session: an over-long recording is refused outright, naming both the limit and
  the actual length. The private cloud copy written at publish time costs storage but no
  speech time, so it keeps its own separate 90-minute ceiling.
- **The uploaded audio is deleted as soon as the review finishes with it**, on success and
  on failure alike. Nothing read the object after transcription, so it had been a standing
  storage charge per reviewed recipe. Best-effort and fire-and-forget: a failed delete is
  a cost problem, not a correctness one. **No rules or Functions change was needed** --
  `storage.rules` already allowed the owner to delete their own
  `privateVoice/{uid}/{recipeId}/session`, and a new test pins that permission so
  tightening it later cannot silently restart the leak.
- **Notifications got timestamps, a per-row close button, and swipe-to-clear**, so a
  single alert can be dealt with without clearing everything already read. Both routes
  share one optimistic `dismissNotification` over the existing batch delete; the PWA
  already had a Dismiss button and only needed the timestamp.
- **Swiping a Community dish right saves it to the cookbook.** Like the existing
  double-tap-to-like it only ever adds -- swiping an already-saved dish does not unsave
  it -- and it reuses the existing bookmark plumbing with no new collection or rule.
- Android versionCode 74 / versionName 0.11.13, PWA cache/package version 0.5.12. Parser,
  corpus, rules, Functions, Live/WebRTC, App Check and tier counts all untouched. Gates:
  Android 59 tests / 0 failures (`GoldenCookingCorpusTest` still 24 of them), PWA 130 / 0.
  See `REVIEW_COST_AND_LIST_GESTURES_0.5.12_0.11.13.md`.

# Current handoff — 2026-09-16

- On top of the 0.5.3 (orphaned-audio cleanup) and 0.5.4 (cloud recipe
  delete) commits already on this branch: the Cook wizard now fills Recipe
  name, Prep min and Cook min from the cooking narration itself when the
  chef says them (an explicit "today I'm making X" announcement; prep/cook
  time from a direct "prep time N minutes" statement or otherwise estimated
  from chop/cook-verb durations already in the parsed steps), without ever
  overwriting a manual edit. Also fixes three real ingredient-extraction
  bugs (a bare cut-state modifier like "Ground" left standalone by a segment
  break, a dangling bare "Or", and an ingredient name running on into the
  next sentence) found from a real chili-recipe capture. PWA cache/package
  version 0.5.5. See `PWA_TITLE_PREP_COOK_ESTIMATE_0.5.5.md`.
- Same-day follow-up: ported that whole change to Android's
  `CookingSessionParser.kt`/`ChefVoiceApp.kt` for parity -- identical title/
  prep-cook-time detection and the same three ingredient-bug fixes, wired
  into `CreateRecipeScreen`'s capture-stop merge the same way. Android
  versionCode 68 / versionName 0.11.7. No rules/Functions/Live/App Check/
  billing changes. See `TITLE_PREP_COOK_ANDROID_PARITY_0.11.7.md`.
- Found live testing the above: the PWA had the "verify your email" gate on
  ChefVoice Review but never had the flow to actually send or recheck one --
  every PWA sign-up was permanently stuck unverified. Ported Android's
  existing `sendVerificationEmail()`/`refreshEmailVerification()` and Profile
  UI to the PWA. PWA cache/package version 0.5.6. See
  `PWA_EMAIL_VERIFICATION_0.5.6.md`.
- Found live cooking a real ramen recipe through the PWA: a run-on sentence
  with no pause made Chrome's continuous SpeechRecognition re-finalize the
  same utterance ~20 times, and each overlapping fragment got parsed
  independently into duplicate/garbled ingredients. Fixed the capture-layer
  duplication (`voice-capture.js` now collapses a re-finalized revision into
  the existing transcript segment instead of appending a new one) plus two
  narrow deterministic-parser bugs it exposed on both platforms (bare
  "add in" leaving a stray "In" ingredient; "going to let the X" with its
  leading pronoun dropped by ASR not being rejected as a dangling
  instruction). PWA cache/package version 0.5.7, Android versionCode 69 /
  versionName 0.11.8. No rules/Functions/Live/App Check/billing changes. See
  `RUNON_TRANSCRIPT_DUPLICATION_0.5.7_0.11.8.md`.
- Chased two more defects out of the same real ramen capture. A spoken "cook
  for 2 minutes" never reached Recipe Details on the PWA: the parser had it
  right all along, but a capture finished while the Recipe Details inputs were
  mounted wrote the detected value only to `form`, and the next wizard
  navigation read the still-empty input back over it. Android was unaffected
  (Compose state, no DOM read-back). Separately, a plain present-tense "and
  you let it cook for 2 minutes" bled into the last ingredient on both
  platforms (`1 tsp Pepper, and you let it`, plus a phantom `1 tsp You let
  it`) because the existing dangling-tail rule only covered "going to let
  it". Android versionCode 70 / versionName 0.11.9. No rules/Functions/Live/
  App Check/billing changes. See `COOK_TIME_AND_LET_IT_TAIL_0.11.9.md`.
- Closed the recipe-title gap left open by 0.11.9. The title was blank because
  the chef dropped the copula ("we going to make", not "we're going to make"),
  which the title pattern required. Making the auxiliary optional outright
  regressed a fixture -- "we going to cook our ground beef for 10 mins" became
  a title and its step was then deleted, halving cookMinutes -- so the
  auxiliary-free path additionally requires "going to"/"gonna" and the verb
  "make". A leading "my" is now stripped from titles, with a matching optional
  "my" in the title-announcement step filter so the announcement still does not
  survive as a bogus first method step. Android versionCode 71 / versionName
  0.11.10. No rules/Functions/Live/App Check/billing changes. See
  `TITLE_DROPPED_COPULA_0.11.10.md`.
- Reported live that cook time and recipe name were *still* blank after the
  above. Both earlier fixes were real but addressed other paths: this capture
  went through ChefVoice Review with "0 confirmed - 5 to review", so
  capture-time detection had a near-empty transcript to work with and
  correctly filled nothing. Accepting review suggestions only ever updated
  Ingredients/Method -- `applyDetectedRecipeMeta()` was never called on the
  review path -- so Recipe Details stayed blank exactly when the review was
  most needed. `fromCloudTranscript()` now returns the title/prep/cook it
  already parses internally, and accepting review content applies them (on
  accept, not on results, keeping the review opt-in; still fills only empty
  fields). PWA cache/package version 0.5.8. No parser change, and no Android
  change (pre-save review is PWA-only). See
  `REVIEW_FILLS_RECIPE_DETAILS_0.5.8.md`.
- Cook time confirmed filling live (Cook min 1 from "let it cook for 1
  minute"), but the recipe name was still blank: this capture said "we going
  to *do* my famous top ramen" and the title verb list only had
  make/cook, so `doing|do` was added on both paths. Third phrasing of the same
  announcement to miss in as many rounds -- the list stays explicit on purpose,
  since that is what keeps "we going to cook our ground beef for 10 mins" an
  instruction rather than a title. Also, by request, Recipe Details now fills
  as soon as ChefVoice Review returns instead of waiting for a "Use second
  pass" click; ingredient and method wording still require an accept, and the
  autofill only writes into fields left empty. PWA cache/package version
  0.5.9, Android versionCode 72 / versionName 0.11.11. No rules/Functions/
  Live/App Check/billing changes. See
  `REVIEW_AUTOFILLS_DETAILS_0.5.9_0.11.11.md`.
- Autofill confirmed working live, so by request ChefVoice Review now also
  applies "possible missed ingredient" suggestions on its own, with no "Use
  second pass" button for them. Scoped to that one issue type because it is
  purely additive -- the live transcript never caught the ingredient, so
  applying it cannot overwrite or delete anything recorded. Quantity changes,
  name cleanups, artifact removal and every method issue still require an
  explicit accept, so the chef's own content is never silently rewritten and
  "Keep current" stays meaningful. Auto-applied items deliberately do not fire
  the secondPassAccepted analytic. PWA cache/package version 0.5.10. No parser
  change, no Android change. See
  `REVIEW_AUTOAPPLIES_MISSED_INGREDIENTS_0.5.10.md`.
- Built the signed Play artifact for 0.11.11 / versionCode 72 via
  `BUILD_PRODUCTION_TRUST_APK.cmd`: `ChefVoice-v0.11.11-Production.aab`,
  SHA-256 `a0a4366618c8267bc8d42cb238f3f4dfbb22dee37a8d64844a0de0d3bc2614f9`,
  plus the sideload `.apk` and `ChefVoice-v0.11.11-mapping.txt` (upload the
  mapping with the release). APK verified under signature scheme v2.
- Uploaded that AAB to the Play Console Production track and **saved it as a
  draft release** -- not rolled out. Console state, checked directly rather
  than inferred: Production is Active at **versionCode 69 (0.11.8)**, 177
  countries, 3 installs. The older note below claiming code 67's acceptance was
  unconfirmed is stale; 69 is live, so this is a clean 69 -> 72. The draft has
  release name "72 (0.11.11)", the bundle accepted as version 72 (0.11.11),
  API 26+, target SDK 36, and en-US release notes covering the two
  user-visible Android changes (recipe-name recognition, ingredient names no
  longer absorbing a trailing narration clause).
- Before rolling that draft out: R8 minify/shrink is on and this release build
  has still not been smoke-tested on a device (none was attached), which is
  exactly the failure mode the `buildTypes` comment warns about -- sideload
  `ChefVoice-v0.11.11-Production.apk` first. Also note the ChefVoice Review
  autofill/auto-apply work in 0.5.8-0.5.10 is PWA-only, so this Android build
  carries the parser fixes but none of that review UX.
- **That smoke test has now been done** on a Galaxy S25 Ultra (SM-S938U,
  Android 16) against the split-APK install of the signed code 72 bundle --
  i.e. what Play actually delivers, not the universal APK. R8 is clean: no
  `ClassNotFoundException`/`NoSuchMethodError`/`VerifyError`/`UnsatisfiedLinkError`
  anywhere, Firestore read *and* write correct with real data, mic ->
  SpeechRecognizer -> foreground service and the saved "Full cooking session"
  clip both working, and **WebRTC Live initialized under minification**
  (`libjingle_peerconnection_so.so` loaded, `PeerConnectionFactory` up, session
  went LIVE and ended cleanly) -- the exact path the `org.jni_zero` keeps were
  added for in 0.11.5, never previously run minified. On-device parser output
  matched the JS reference byte for byte.
- That same capture surfaced two real parser bugs, both of which *deleted the
  chef's recorded content* and neither of which was a regression (the parser at
  `522c433` produces identical output): a run-on title announcement swallowed
  the instruction that followed it, and an unclassifiable segment naming a
  duration was discarded outright. Fixed deterministically in both parsers --
  the announcement is now stripped as a prefix rather than suppressing the whole
  step, and a stranded duration-bearing segment is kept verbatim. Android
  versionCode 73 / versionName 0.11.12, PWA cache/package version 0.5.11,
  corpus 59 -> 60 rows. No rules/Functions/Live/App Check/billing changes. See
  `RUNON_TITLE_AND_STRANDED_SEGMENT_0.5.11_0.11.12.md`.
- Because of that, the saved Play draft (code 72 / 0.11.11) is now behind the
  source. A fresh code 73 / 0.11.12 bundle carrying the parser fixes has been
  built and signed to replace it: `ChefVoice-v0.11.12-Production.aab`, SHA-256
  `6284cacc9dab9783d4a33d203384c36a1e2513ffdc3d49a398533aeb1364de60`, with
  `ChefVoice-v0.11.12-Production.apk` (SHA-256
  `6f10fef91323b10880b1f9f5c7dc0317d3ad4aee97bd321412ba6bf9359d5403`) for
  sideloading. Signing certificate verified identical to the accepted 0.11.11
  artifact (SHA-256 `3c81185f...c98e3274`, Plugged'N LLC).
- **Correction to the note above: code 72 (0.11.11) was already live.** By the
  time the Console was opened the production track read `Active - Latest
  release: 72 (0.11.11) - 177 countries/regions - 3 installs`, rolled out at
  100% earlier the same evening. The earlier "draft only, not rolled out" note
  was stale, so there was no draft to replace.
- **Code 73 (0.11.12) has been submitted to production.** A new production
  release was created with the 0.11.12 bundle, release name `73 (0.11.12)`,
  en-US notes covering the two parser fixes, roll-out percentage 100%, all
  targeted countries, previous 72 bundle deliberately *not* included. Managed
  publishing is off, so it auto-publishes once Google's review passes;
  Publishing overview now shows "Changes in review". Two non-blocking warnings
  were present and are pre-existing, not introduced by 0.11.12: the advertising
  ID declaration says the app uses an ad ID while the manifest has no
  `com.google.android.gms.permission.AD_ID` (release-blocking errors are turned
  off), and the bundle ships native code with no uploaded debug symbols, so
  native WebRTC crashes will not symbolicate. Consider `ndk { debugSymbolLevel =
  "FULL" }` and correcting the ad-ID declaration before the next release.
- **Code 73 (0.11.12) is live.** Confirmed in the Play Console on 2026-09-18:
  the production track reads `Active - Latest release: 73 (0.11.12) - 177
  countries/regions - 3 installs`, and the Releases tab shows `73 (0.11.12)`
  as "Available on Google Play - 1 version code - Released on Sep 16 9:41 PM".
  Publishing overview is empty (nothing in review, nothing pending) and reads
  "Last published on September 16, 2026". Review passed and managed publishing
  being off auto-published it as expected; no further Play action is needed.
- No separate `mapping.txt` upload is needed: the bundle already embeds
  `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`, so Play
  deobfuscates Java/Kotlin crashes automatically.
- PWA 0.5.11 is deployed and verified by running the *deployed*
  `js/cooking-session-parser.js` from `chefvoice-d7fec.web.app` against the
  device transcript, not just the local file.

# Current handoff — 2026-09-15

- The five-patch stack described in the entries below (PWA Live viewer
  0.4.1, PWA Go Live hosting 0.5.0, Cook wizard 0.5.1, Android Live JNI keep
  fix 0.11.5, Community layout parity 0.11.6 / code 67) is committed and
  pushed: `80652e4` on `claude/chefvoice-2026-09-11-handoff-be3999`. Android
  `:app:testDebugUnitTest` is green. Play's acceptance of the code 67 upload
  is still unconfirmed -- nothing in this session re-checked the Play Console.
- New on top of that stack: the Cook wizard's Capture step can now run
  ChefVoice Review (Second Pass) against the just-recorded audio before the
  recipe is saved, prefilling Ingredients/Method instead of the chef
  re-typing them by hand. PWA cache/package version 0.5.2. See
  `PWA_CAPTURE_SECOND_PASS_0.5.2.md`.
- See `HANDOFF_2026-09-14.md`, `PWA_GO_LIVE_0.5.0.md` and
  `PWA_CAPTURE_SECOND_PASS_0.5.2.md`. Older entries below describe their
  status at the time and are superseded by this update.

# Current handoff — 2026-09-14

- Android Live 0.11.5 / 65 and PWA viewer 0.4.1 were confirmed working by James.
- Community patch applied and signed Android 0.11.6 / 66 built successfully. Play rejected already-used code 66; a code 67 rebuild/upload is not yet confirmed.
- PWA Go Live candidate 0.5.0 implemented locally: explicit preview, hosting, mute, comments/reactions and cleanup. PWA tests 95/95, Firestore emulator tests 53/53, and host DOM checks 16/16 passed. Actual iPhone hosting and deployment remain pending.
- GitHub connector is read-only; no remote push was performed. The handoff provides commands for James's authorized checkout.
- See `HANDOFF_2026-09-14.md` and `PWA_GO_LIVE_0.5.0.md`. Older entries below describe their status at the time and are superseded by this update.

---

# ChefVoice — Community layout parity (Android 0.11.6 / 66, PWA 0.4.2)

- James confirmed both the Android 0.11.5 Live crash fix and the PWA 0.4.1
  iPhone viewer permission fix are working.
- Android gains the existing PWA Community banner. Both place search,
  messages, and notification buttons with unread badges inside its top-right
  corner.
- PWA posts now match Android's full-photo layout, with chef controls at the
  top, a dark caption at the bottom, and a vertical like/comment/share/save
  rail inside the photo. Following/Discover and existing social handlers remain
  connected.
- PWA tests 95/95; notification source gates 74/74; 23 local DOM interaction
  checks with simulated API/navigation endpoints; JavaScript syntax checks pass.
  Browser preview was blocked by the session URL policy. Signed Android build
  and final appearance checks on Android/iPhone remain pending on James's devices.
- Build with `BUILD_PRODUCTION_TRUST_APK.cmd`; deploy the PWA with
  `DEPLOY_PWA.cmd`. Parser, rules, Functions, billing, App Check, and the working
  WebRTC fixes are unchanged.

See `COMMUNITY_LAYOUT_PARITY_0.11.6.md` for application and release steps.

---

# ChefVoice PWA — Live signaling join fix (0.4.1)

- James confirmed Android Live starts successfully on signed 0.11.5 / 65.
  The iPhone viewer then reported "Live signaling error: Missing or
  insufficient permissions."
- Confirmed the deployed viewer attaches its private Firestore listeners
  before creating the peer document that authorizes those listeners. The
  emulator reproduces the denial under the existing rules.
- The PWA now awaits the join write before subscribing, cleans up abandoned
  ICE documents before rejoining, and finishes a previous connection's cleanup
  before starting its replacement. PWA/cache version: 0.4.1.
- Real Firestore emulator suite: 42/42, including five new viewer tests that
  execute the production controller with a simulated media engine. PWA tests:
  95/95. Actual iPhone audio/video verification remains pending deployment.
- Deploy only `DEPLOY_PWA.cmd`. Android stays on 0.11.5 / 65; Firestore rules,
  App Check, Functions, billing, and the cooking parser are unchanged.

See `PWA_LIVE_SIGNALING_FIX_0.4.1.md`.

---

# ChefVoice — Live JNI release fix candidate (0.11.5 / 65)

- The supplied build-64 log contains eight identical ARM64 `SIGTRAP` crashes
  inside WebRTC's `JNI_OnLoad`. The Maven library's build ID exactly matches
  the device log: `0cc2410c540e806e`. Its failing initialization path looks up
  `org/jni_zero/JniInit` by name.
- Added an R8 keep rule for `org.jni_zero.**`, which the existing
  `org.webrtc.**` rule does not cover. WebRTC remains at `144.7559.15`.
- An isolated run of R8 9.3.16 on the actual WebRTC classes removes
  `JniInit` with the previous rules and preserves its name and native-called
  methods with the patch. Notification source gates: 74/74; function syntax
  check passes.
- Signed app build, final AAB inspection, and Play-installed device/Live
  verification remain pending on James's machine. No Firebase deployment is
  needed for this Android packaging change.

See `LIVE_WEBRTC_JNI_KEEP_FIX_0.11.5.md` for evidence and release steps.

---

# ChefVoice PWA — Live viewer (0.4.0)

- The PWA's Live tab was a static "remains intentionally gated" placeholder;
  three root docs (`WEBRTC_LIVE_SETUP.md`'s PWA sections, `LIVE_IPHONE_TEST.md`,
  `LIVE_TWO_WAY_TEST.md`) described a working PWA viewer/host that had never
  actually been committed to `web/` -- confirmed via `git log` and a source
  grep finding zero WebRTC code there before this change. Those three docs now
  carry correction banners.
- Added a real, viewer-only Live experience: an iPhone/PWA chef can watch an
  Android host's video + audio, chat, and react (♥/🔥/👏), all against the
  *existing* `liveSessions/{id}/peers/{peerId}` signaling contract
  `WebRtcLiveTransport.kt` already implements. `firestore.rules` needed no
  changes -- `peerId == request.auth.uid` was already generic, not
  Android-specific.
- New `web/js/webrtc-signaling.js` (pure helpers, unit-tested) and
  `web/js/webrtc-live-viewer.js` (`RTCPeerConnection` + Firestore
  orchestration, mirroring `WebRtcViewerController`); `firebase-client.js`
  gained matching discovery/comments/reactions functions.
- `npm test`: 95/95 (86 pre-existing + 9 new). Live-browser check against the
  real Firebase project: loads clean, correct empty state, no leaked
  listeners across tab navigation. Not verified: an actual two-device video
  call (no Android device available this session) -- the contract was instead
  cross-checked line-by-line against the real Kotlin and rules source.
- Going Live *from* an iPhone, the Android app, `firestore.rules`,
  notifications and billing are all untouched. PWA version 0.3.0 → 0.4.0.

See `PWA_LIVE_VIEWER_0.4.0.md`.

---

# ChefVoice — Live discovery search and tags (0.11.4)

- The "Live now" list was already global (no follow-scoping, `firestore.rules`
  already had `allow read: if true` on `liveSessions`) — the actual gap James
  hit was that a session could only be found by scrolling and recognizing a
  title/host name, with nothing to categorize or search by.
- Added `LiveSession.tags` (freeform strings, same convention as
  `Recipe.tags`), a tags field on the "Start a Live" form, and a search field
  on the "Live now" list that filters by chef name, title, or tag — reusing
  the existing `TagUtils`/`CommunityScreen` search pattern rather than adding
  a new system.
- `firestore.rules`: `tags` is optional (max 8, must be a list) at creation
  and immutable afterward, matching `hostId`/`hostName`/`startedAt`'s
  treatment. No new Firestore index needed — same as recipe tag search, this
  filters an already-loaded, already-open client-side list.
- `rules-tests/firestore-rules.test.js` gained 4 tests for the new
  validation; full suite 37/37 against the emulator. Notification gates
  74/74. `testDebugUnitTest` BUILD SUCCESSFUL.
- Play Billing, WebRTC signaling/heartbeat logic, and the PWA are untouched.
  Version 0.11.3/63 → 0.11.4/64.

See `LIVE_DISCOVERY_TAGS_0.11.4.md`.

---

# ChefVoice — Live/WebRTC native crash fixed (0.11.3)

- Tapping "Go Live" was fatally crashing every time on the Samsung Galaxy S25
  Ultra test device (`SIGABRT` inside `libjingle_peerconnection_so.so`'s own
  `JNI_OnLoad`) — see `LIVE_WEBRTC_NATIVE_CRASH_FINDINGS_0.11.2.md` for the
  original diagnosis.
- Fixed by moving `io.github.webrtc-sdk:android` from `150.7871.01` to
  `144.7559.15` in `app/build.gradle.kts`. Confirmed on-device via `adb
  logcat`: the native library now loads cleanly and
  `ChefVoiceLive: markLiveSessionReady callback: error=null` fires with no
  crash. Verified interactively on the phone.
- Root cause of *why* `150.7871.01` regressed (it had previously fixed a
  different crash on this same device) is still unknown — this is a
  confirmed-working version pin, not a root-cause fix. See
  `LIVE_WEBRTC_CRASH_FIXED_0.11.3.md`.
- Play Billing, Firestore/Storage rules, notifications, and the PWA are
  untouched. Version 0.11.2/62 → 0.11.3/63.

See `LIVE_WEBRTC_CRASH_FIXED_0.11.3.md`.

---

# ChefVoice — Play Billing query fix (0.11.2)

- Once `chefvoice_pro` (base plans `monthly`/`annual`) and
  `chefvoice_pro_lifetime` were actually created and activated in Play
  Console, the paywall still never resolved real prices — confirmed via
  `adb logcat` that `queryOffers()` in `PlayBillingManager.kt` was mixing
  a `SUBS` product and an `INAPP` product in one `queryProductDetailsAsync`
  call, which Play's billing service rejects outright
  (`IllegalArgumentException: All products should be of the same product
  type`), thrown before any `BillingResult` ever reached the app's
  callback. Not a catalog-propagation delay — a deterministic client bug.
- Fixed by splitting into two separate `queryProductDetailsAsync` calls
  (one per product type) and merging results before calling `onReady`,
  matching Google's own documented pattern.
- Also fixed, found during on-device verification: `ProPaywallDialog`'s
  "Not now" button was passed as `AlertDialog`'s separate `dismissButton`,
  which Material3 lays out beside the full-width `confirmButton` column
  rather than below it. Moved into the same column as the last item.
- `:app:testDebugUnitTest` BUILD SUCCESSFUL (5 suites / 37 tests, 0
  failures) both before and after the layout fix. Verified visually on a
  real device: paywall now shows `$39.99/year`, `$6.99/month`, `$79.99
  once, forever`, and "Not now" sits correctly below the three buttons.
- `billing/functions/index.js`, both Firestore/Storage rules files,
  `chefvoice-notifications`, and the PWA are untouched — Android-client-only.
  Nothing (re-)deployed or (re-)uploaded to Play Console yet. Version
  0.11.1/61 → 0.11.2/62.

See `PLAY_BILLING_QUERY_FIX_0.11.2.md`.

---

# ChefVoice — Play Billing integration (0.11.1)

- Real Google Play purchases, client and backend. Android:
  `PlayBillingManager.kt` wraps Billing Library 9.1.0 (added to
  `app/build.gradle.kts` — not actually present despite being described as
  already there), wired into `ChefAppState`/`ProPaywallDialog` following
  the existing callback-based repository pattern. Backend:
  `verifyChefVoicePurchase` (callable) and `processChefVoiceRtdn`
  (Pub/Sub-triggered) added to `billing/functions/index.js`, the same file
  the founding-seat/promo launch access already lives in.
- One deliberate deviation from spec, documented in full in the writeup
  below: `verifyChefVoicePurchase` runs *as*
  `chefvoice-billing-verifier@...` (as asked), but `processChefVoiceRtdn`
  impersonates that service account per-call instead of running as it,
  because giving a 2nd-gen Pub/Sub/EventArc trigger a custom runtime
  service account hits a currently-open firebase-tools bug.
- Both new functions log their own runtime identity on every invocation
  specifically so that IAM setup can be verified against Cloud Logging,
  rather than trusted on paper.
- `gradlew.bat :app:testDebugUnitTest` — BUILD SUCCESSFUL, same 3
  pre-existing warnings, confirms the Billing Library 9.1.0 API surface
  used here is real. `node --check` + the full `billing/` and
  `notifications/` gates (91 tests) pass with no regressions. Installed on
  a physical device (launches); the live paywall screen itself has not
  yet been walked through by hand.
- **Deployed via `DEPLOY_BILLING.cmd`.** Along the way, found and deleted a
  stale `onChefVoicePlayNotification` function left live in the project by
  a separate, never-merged attempt at this same feature
  (`claude/android-publisher-adc-auth-fe9407`) — one RTDN code path now,
  not two. The one-time IAM grant (`Service Account Token Creator` for
  `processChefVoiceRtdn`'s default identity on `chefvoice-billing-verifier`)
  is also done. **Still unverified against a real purchase or RTDN event**
  — no product exists in Play Console yet, so nothing has actually
  exercised either function for real. See "Not done" in the writeup.
- `firestore.rules`, `storage.rules`, `chefvoice-notifications`, the PWA,
  and the existing launch-access logic are all untouched. Version
  0.10.8/60 → 0.11.1/61 (jumping to the 0.11.x line already used for the
  rest of the monetization work, not continuing 0.10.x's parser/UI-fix
  sequence).

See `PLAY_BILLING_INTEGRATION_0.11.1.md`.

---

# ChefVoice — Create Recipe flow simplification (0.10.8)

- `CreateRecipeScreen` was one long scrolling flow covering capture,
  details, ingredients, method, chef voice and media all at once —
  flagged in `UI_BRANDING_AUDIT.md` and again in
  `MONETIZATION_REVIEW_2026-09.md`'s sequencing as the thing standing
  between a new user and their first successful recipe.
- Split into five steps matching the audit's proposal exactly: Capture →
  Recipe Details → Ingredients/Method → Media → Review, with a step
  progress header and Back/Next navigation. No capture, parsing,
  validation or save logic changed — same fields, same buttons, same
  save-enabled condition, just spread across steps instead of one scroll.
- Added a Review step that didn't exist before: a summary of the recipe
  (name, description, times, tags, every ingredient and method step,
  media/voice counts) shown right before Save.
- `gradlew.bat :app:testDebugUnitTest` — BUILD SUCCESSFUL, same 3
  pre-existing unrelated warnings. Built, installed and walked through
  end to end on a real device (all five steps, Back navigation, Review,
  Save) — confirmed working.
- The deterministic voice pipeline (`CookingSessionCapture.kt`,
  `CookingSessionParser.kt`, `IngredientParser.kt`), Firestore/Storage
  rules, Cloud Functions, and the PWA are all untouched — this is an
  Android-only presentation change. Version 0.10.7/59 → 0.10.8/60.

See `CREATE_RECIPE_FLOW_SIMPLIFICATION_0.10.8.md`.

---

# ChefVoice — Firestore rules deploy gate hardening (0.10.7 line)

- `DEPLOY_COMMUNITY_PROFILE_RULES.cmd` now runs `RUN_RULES_GATES.cmd` (the
  Firestore emulator suite — the only gate that actually evaluates a rule,
  not just its source text) before deploying, and refuses to deploy on
  failure. Closes a real gap: the prior `firestore.rules` deploy (adding
  `tags`) shipped without that gate having been run.
- Verified both the refusal path (deliberately broke a test, confirmed the
  script refuses and never reaches `firebase deploy`, then reverted the
  test cleanly) and the pass path (33/33 rules-tests green) without ever
  triggering a live deploy — `firestore.rules` itself is unchanged, so
  there was nothing to ship.
- Also folded in two other items from the same backlog: a
  `DEPLOY_STORAGE_RULES.cmd` wrapper (Storage was the one deploy surface
  without a scoped script) and `BuildAndInstall.ps1` no longer forcing
  `--no-daemon clean` on every debug build — that was turning ~10-second
  incremental installs into 2-11 minute full rebuilds for no benefit on
  this fast dev-loop script.
- Android/PWA app code, Cloud Functions, and Storage/Firestore rules
  content are all untouched. `app/build.gradle.kts` stays at 0.10.7 / 59.

See `RULES_DEPLOY_GATE_HARDENING_0.10.7.md`.

---

# ChefVoice PWA — Private cooking-session upload hotfix (0.10.7 line)

- Fixes the item this handoff's prior entry deliberately left broken: the
  PWA's `publishRecipe()` was uploading the chef's full-session recording
  to a closed legacy Storage path with no upload permit, so it silently
  failed on every publish. Now uploads to `privateVoice/{uid}/{recipeId}/session`
  with a `private_session` permit, never a public URL, and never listed
  in the recipe's public `voiceClips` — matching Android's `uploadVoice()`
  exactly, so a recipe published from the PWA can be re-reviewed with
  ChefVoice Review from any device.
- PWA-only: `storage.rules`, `firestore.rules`, Cloud Functions and Android
  app code are all untouched. `app/build.gradle.kts` stays at 0.10.7 / 59.
- `npm test` 86/86, unchanged. Not verified end-to-end against the live
  Firebase project (would need a signed-in, verified-email account
  publishing a real recipe with recorded audio); not yet deployed.
- While running the full `notifications/` gate to check for regressions,
  found 5 pre-existing failures unrelated to this fix — stale hardcoded
  `versionCode`/`versionName` and a search-placeholder string assertion
  left behind by the *previous* entry's own version bump and collapsible-search
  change. Flagged separately rather than fixed here.

See `PWA_PRIVATE_SESSION_UPLOAD_HOTFIX_0.10.7.md`.

---

# ChefVoice — Recipe #tags, collapsible search, read-aloud, Storage rules fix (0.10.7)

- All four next-release asks from the 2026-09-10 handoff, done: collapsible
  Community search (both platforms), freeform alias-aware `#tags` replacing
  the fixed-enum idea (both platforms + `firestore.rules`), TTS read-aloud
  (Android `CookingScreen` step-by-step; PWA reads the whole method in one
  pass), and three complete seed recipes published to Community with photos.
- **Found and fixed a real production bug while seeding**: PWA recipe photo
  uploads were completely broken for every user — `storage.rules`' `publicMedia`
  create/update chained three cross-service Firestore reads, one over
  Firebase's hard limit of two per rule evaluation. Fixed by dropping the
  redundant restriction recheck (already enforced before permit issuance);
  confirmed against Firebase's own docs before deploying. Deployed via
  `firebase deploy --only storage` — no wrapper script existed for Storage
  rules before now.
- Also fixed live: the PWA's Cook screen had no way to remove an
  accidentally-added photo before saving (Android already had this). Small
  `×` overlay added to each media thumbnail.
- Deliberately **not** fixed: the PWA's voice-clip upload path uses the same
  closed legacy Storage path, but also sends the chef's private full-session
  recording toward a *public* path (unlike Android, which keeps it private
  with no public URL). Fixing the permit call without first correcting which
  path it targets risked actually publishing previously-private audio, so
  it's left broken (same as before) pending a dedicated fix.
- `npm test` 86/86 (81 + 5 new tag-utils cases). Android `:app:testDebugUnitTest`
  BUILD SUCCESSFUL, including new `TagUtilsTest.kt`; same 3 pre-existing
  unrelated warnings as the last handoff. Verified end-to-end against live
  production, signed in: tag alias search, search collapse, read-aloud, the
  new remove button, and all three seed recipes' photos rendering in Community.

See `RECIPE_TAGS_SEARCH_READ_ALOUD_0.10.7.md`.

---

# ChefVoice PWA — Feature Parity with Android (0.11.0)

- Completes the PWA catch-up: direct messages, in-app activity notifications,
  threaded comment replies, chef search and public chef profiles, Second Pass
  (ChefVoice Review) and web push registration. `npm test` 69/69, up from 26.
- Second Pass ports `SecondPassReviewer.kt` + `IngredientReviewClassifier.kt`, with
  **all 19 tests from `SecondPassReviewerTest.kt` ported verbatim and passing** —
  the cross-platform contract for Second Pass, the same role the golden corpus plays
  for the parser. The private upload is permit-gated exactly as on Android.
- Messaging follows the rules exactly: sorted `uid--uid` ids, live profile names,
  empty preview metadata on create, monotonic read markers marked against the newest
  message actually seen.
- Web push needed no backend change — the backend already targets Firebase
  Installation IDs (current Admin SDK API; `tokens` is deprecated) and the rules
  already accepted `platform: 'web'`. The VAPID key is the one piece of config that
  must be created by hand in the Firebase Console; until it is, push stays disabled
  and the in-app Activity feed covers it.
- **Two pre-existing bugs fixed:** `toggleLike` and `addComment` were writing the
  backend-maintained `likes`/`commentCount` counters, which `validOwnerRecipeUpdate`
  rejects — liking and commenting were broken outright against the deployed rules.
  And rule-bound writes were sending `chefName()`'s email-prefix fallback, which
  `profileNameMatches` rejects.
- Deliberately not done: the video/photo caps (no Android call site — enforcing on
  web alone would give Free chefs a worse deal in Safari), and Live/WebRTC (still
  gated on both platforms pending real-device testing).
- Not verified end to end: signed-in message/block/report round trips, the Second
  Pass cloud call (needs a verified-email account), and push delivery (needs the
  VAPID key). Rule-shape source gates stand in for the write paths.
- Android untouched and still passing. Nothing deployed. Version 0.10.6 / code 58.

See `PWA_FEATURE_PARITY_0.11.0.md`.

---

# ChefVoice PWA — Entitlements, Analytics, Blocking & Moderation (0.11.0)

- Brings the Android feature work that sits *around* the parser across to `web/`,
  following the parser-parity restore below.
- `entitlement.js` mirrors `ProEntitlement`/tier limits/`FoundingAccess`: active and
  in_grace unlock Pro, on_hold/paused/unknown do not, founding and promo read as
  complimentary so the membership card never treats those chefs as subscribers, and
  every check fails closed to Free. Read-only by rule; the client grants nothing.
- Found and fixed by its own test: Kotlin's `getString` returns null for a
  non-string field so a malformed status falls through to `expired`, but JS
  coercion turns `['active']` into `'active'` and would have unlocked Pro. The
  normalizer now reads strictly by type.
- `chef-analytics.js` mirrors `ChefAnalytics.kt`'s vocabulary and its three rules
  (never throws, no-op without Analytics, no personal or recipe content).
  `showPaywall`/`dismissPaywall` are the only entrance/exit, as on Android.
- Deliberately NOT enforced: the video and per-recipe photo caps. Both exist in the
  tier model on both platforms but Android has no call site for either. An earlier
  draft gated them on web and it was reverted before shipping — enforcing on web
  alone would give a Free chef a worse deal in Safari than on their phone.
- Blocking and moderation reporting ported with payloads byte-compatible with
  `firestore.rules` (exact key sets, 500-char reason cap, fixed `open` status).
  Blocked chefs' recipes and comments are hidden from the Community feed and can be
  unblocked from Profile.
- Known gap filed as follow-up: Android consults `isUserBlocked` only in the
  messaging UI, so its Community feed is still unfiltered.
- `npm test` 39/39 (up from 26), including source-text gates asserting the block and
  report payloads still match the rules. Android `:app:testDebugUnitTest` untouched
  and still passing.
- Verified in a browser against live Firebase: loads clean, feed renders, membership
  card/paywall render and dismiss, cloud-recipe gate blocks at 10 for Free not Pro.
  **Not verified:** the signed-in block/unblock/report round trip — needs real
  credentials.
- Still missing versus Android: messaging, push notifications, threaded replies,
  chef search, Second Pass, Live. Nothing deployed. Version unchanged 0.10.6 / 58.

See `PWA_SOCIAL_BILLING_ANALYTICS_0.11.0.md`.

---

# ChefVoice PWA — Parser Parity Restored (0.11.0)

- `web/` was missing from this checkout entirely, not just out of date. Recovered
  the real source (v0.7.0 alpha.3, `chefvoice-pwa@0.3.0`) from a user-supplied
  backup and brought it back into the repo.
- Its JS parser predated roughly fifteen real-device point-release fixes and
  passed 36/56 rows of the current `shared/golden-cooking-corpus.tsv`.
- Rewrote `web/js/cooking-session-parser.js` and `web/js/ingredient-parser.js`
  to port every remaining piece of `CookingSessionParser.kt`/`IngredientParser.kt`
  (determiner-gated `need`, yield-sentence suppression, back-reference rejection,
  trailing-quantity ingredients, segment-aware step collection, scratch/wait/
  quantity corrections, `RecipeCanonicalizer` post-processing, the `chunk` unit
  alias, `cupful`/`tbsp spoon` ASR repairs), staying line-close to the Kotlin
  source so a future fix is easy to port either direction.
- Added `web/tests/golden-corpus.test.mjs` (runs the identical 56-row corpus,
  same row-count guard as Android) and `web/tests/real-device-fixtures.test.mjs`
  (ports the 5 Kotlin fixture tests that assert exact step order and step
  "must NOT contain X" negatives, which the corpus can't express).
- Result: 56/56 corpus rows, 26/26 `npm test`, all 20 pre-existing PWA tests
  unmodified and passing. `RUN_PARSER_GATES.cmd` now runs to completion.
- Explicitly out of scope: the rest of the PWA UI (community/profile/live,
  `app.js`, `firebase-client.js`) is still the v0.3.0 alpha and does not reflect
  Android's newer social/analytics/monetization features. Parser parity only.
- Protected: Android parser, rules, Live/WebRTC, App Check (still OFF), both
  Functions codebases, `transcribeChefVoice` all unchanged. Nothing deployed.
  Version unchanged: 0.10.6 / `versionCode 58`.

See `PWA_PARSER_PARITY_0.11.0.md`.

---

# ChefVoice Android 0.11.0 work — Parser: Ingredient Declarations, Yield Sentences, Back-references

- Deterministic parser fix driven by a real Android nachos capture (0909). Corpus-first
  per `shared/README.md`: three rows added and confirmed failing before any fix.
- **Second Pass was not the defect.** It ran end to end, got a clean Chirp 3 transcript,
  and flagged 6 ingredient + 3 method issues correctly. Re-parsing the *clean* transcript
  still produced garbage - both passes share the parser, so a systematic parser defect
  appears in both and is marked "confirmed" instead of flagged. `SecondPassReviewer.kt`
  is untouched.
- Fix 1: "you're going to need some X" is now an ingredient declaration. `need` had been
  deliberately excluded to protect narration like "what you need to do"; it is now
  admitted only when a determiner follows (`need some|a|an`), so that narration still
  fails. Recovered sour cream, hot sauce and jalapenos, all previously lost.
- Fix 2: yield sentences ("one pack should feed at least two people, maybe three") no
  longer yield ingredients. Bare "serve" deliberately excluded - it is a method verb.
- Fix 3: unmeasured names opening with a back-reference (it/them/this/that/these/those)
  are rejected. Killed the ingredient "It on top of your nachos".
- Regression found and fixed in the same change: making "need some X" yield ingredients
  caused `collectSegmentAwareSteps` to swallow those declarations into the preceding
  method step (the ingredient-continuation branch armed by "sprinkle"). A declaration is
  not a continuation; the branch now skips them. Caught by diffing the full transcript
  against the pre-change parser, not by the corpus - the corpus asserts required step
  substrings and cannot express "this step must NOT contain X", so the guard is a
  dedicated fixture test.
- Real transcript: 8 ingredients / 2 correct -> 6 ingredients / 6 correct, with method
  steps byte-identical to before.
- No existing corpus row weakened or edited; additions only. Corpus guard 52 -> 55.
- Rules, Live/WebRTC, App Check (still OFF), both Functions codebases and
  `transcribeChefVoice` untouched. Nothing deployed.
- Version unchanged: 0.10.6 / `versionCode 58`.
- Status: `:app:testDebugUnitTest` BUILD SUCCESSFUL 31/31 with all 55 corpus rows; 91/91
  node gates. Installed to SM-S938U (debug). Still open: "need your favorite Dorito
  chips, one bag" is a different parse shape and remains lost; PWA half of the corpus
  contract cannot run (no `web/` in this checkout).

See `PARSER_INGREDIENT_DECLARATIONS_0.11.0.md`.

---

# ChefVoice Android 0.11.0 work — Launch Access: 10 Founding Seats (2 Years) + 90 Free Days

- Grants Pro without Play Billing existing. First 10 signups get Pro free for 2 years
  (`source: "founding"`, dated from the grant); everyone after gets Pro free for 90 days from
  signup (`source: "promo"`); both stop at the kill switch.
- Rationale: with no billing integration a paywall can only take features away, and at
  fewer than five users the Free limits would ration the app's own demo to exactly the
  people whose enthusiasm it needs. No gate was disabled or loosened - people are
  simply entitled, through the real entitlement path.
- Adds `chefvoice-billing`, a fourth independently-deployed unit (`billing/functions/`,
  `DEPLOY_BILLING.cmd`, scoped to `--only functions:chefvoice-billing`). `firebase.json`
  `functions` is now an array of two codebases; `DEPLOY_NOTIFICATIONS.cmd` is unchanged.
- Three functions: `grantChefVoiceLaunchAccess` (onDocumentCreated `users/{uid}`),
  `backfillChefVoiceLaunchAccess` (admin onCall, for accounts predating the deploy),
  `endChefVoiceLaunchPromo` (admin onCall, the kill switch).
- Kill switch has two levels: soft (default) stops new grants and lets live 90-day
  promos run out; hard (`revokeActive: true`) also expires them. Founding seats and any
  `source: "play"` entitlement survive both - the revoke filter is an allowlist.
- Entitlement stays server-authoritative and Admin-SDK-written. Nothing fakes a
  purchase; the client still grants itself nothing.
- `firestore.rules` gains one block: `config/{configId}` closed to clients both ways.
  Nothing existing was modified.
- Client: `ProEntitlement` gains source constants, `isFounding`/`isPromo`/
  `isComplimentary`/`daysRemaining()`; `FoundingAccess` mirrors the two numbers for
  copy only. `ProMembershipCard` no longer describes a complimentary chef as a
  subscriber or warns them about a payment method they never entered.
- Protected parser and golden cooking corpus, Second Pass semantics, gating model,
  `chefvoice-notifications`, `transcribeChefVoice`, Hosting, Storage rules,
  Live/WebRTC and App Check state (still OFF) are all unchanged.
- Version intentionally NOT bumped: stays 0.10.6 / `versionCode 58`.
- Status: `:app:testDebugUnitTest` BUILD SUCCESSFUL 31/31 with the golden corpus
  unaffected; 89/89 node gates (74 notification + 15 new billing); 25/25 emulator rules
  tests (21 existing + 4 new). **Nothing is deployed and the trigger has never fired** -
  `DEPLOY_BILLING.cmd` is unrun, the `config` rules block is undeployed, and no admin
  custom claim has been verified.

See `LAUNCH_ACCESS_FOUNDING_AND_PROMO_0.11.0.md`.

---

# ChefVoice Android 0.11.0 work — Product Analytics Instrumentation

- Work Item D of the monetization handoff. Instrumentation only: no user-visible
  change, no behaviour change, no new gating.
- Adds `com.google.firebase:firebase-analytics` (BoM-managed) and
  `analytics/ChefAnalytics.kt`, a single object owning the event vocabulary and every
  emission.
- Events wired: `first_recipe_started`, `first_recipe_completed` (the activation
  metric), `second_recipe_completed`, `second_pass_opened`, `second_pass_accepted`
  (with `kind`), `paywall_shown` (with `trigger`), `paywall_dismissed`.
- Billing events (`checkout_started`, `purchase_completed`, `subscription_cancelled`,
  `billing_failure`) are declared but have no emitter — there is no Play Billing
  integration yet. The names are fixed now so the vocabulary does not drift.
- `install` is deliberately not emitted: Firebase Analytics logs `first_open`
  automatically with campaign attribution, and a custom duplicate would double-count
  installs in every funnel built on it.
- The module never throws, is a no-op when Firebase is not configured, and sends no
  personal or recipe content — no titles, transcripts, ingredients, names, emails,
  uids or purchase tokens.
- Only behavioural edit: `runSecondPass` and `publish` assigned `paywallTrigger`
  directly, bypassing `showPaywall`. Both now route through it so `paywall_shown`
  cannot be missed. Behaviour-preserving — same trigger strings, now from the
  `PaywallTrigger` constants rather than repeated literals.
- Protected parser and golden cooking corpus, Second Pass semantics, Firestore and
  Storage rules, Live/WebRTC, App Check state (still OFF), `transcribeChefVoice` and
  the `chefvoice-notifications` codebase are all unchanged. Nothing was deployed.
- Version intentionally NOT bumped: stays 0.10.6 / `versionCode 58`, matching the two
  monetization commits before it. 0.11.0 is not shippable without billing, and the
  four `versionCode 58` pins in `notifications/*.test.js` still hold.
- Status: compiles, `:app:testDebugUnitTest` and the golden cooking corpus pass.
  **Not yet verified on a real device** — the events still need a Firebase DebugView
  run to confirm they arrive with the right parameters.

See `ANALYTICS_INSTRUMENTATION_0.11.0.md`.

---

# ChefVoice Android v0.10.6 — Account Deletion Re-auth + Web Deletion Resource

- Policy fix only, shipped standalone (not bundled with feature work).
- Fixes in-app account deletion: the backend's `auth_time` freshness gate was
  already correct, but the client had no way to re-prove identity when it fired —
  only a hint to fully sign out and back in. Now shows an inline password
  re-authentication prompt that forces a fresh ID token and retries.
- Adds the Play-required web account-deletion page, live at
  `https://chefvoice-delete-account.web.app/`, calling the same
  `deleteChefVoiceAccount` callable Android uses — one deletion implementation, two
  front doors. It deploys to a dedicated Hosting site pinned in `firebase.json`; the
  default site still serves the PWA and must not be overwritten by a hosting deploy.
- Adds a release-signing guard in `app/build.gradle.kts`: release packaging tasks now
  throw when the `CHEFVOICE_RELEASE_*` environment variables are missing, instead of
  silently producing an unsigned artifact.
- Backend deletion sweep (recipes/media, social edges, Storage prefixes, Auth user)
  was audited and found already complete; untouched.
- Protected parser, Second Pass, Live/WebRTC, App Check, and all Firestore/Storage
  rules are unchanged.
- Version: 0.10.6 (`versionCode 58`).
- Account deletion required three independent fixes, not one: the client re-auth
  path (app), deploying `firestore.indexes.json` for the sweep's collection-group
  queries (it had never been deployed - `firebase.json` had no `indexes` key), and
  granting `roles/firebaseauth.admin` to the Functions runtime service account so
  `getAuth().deleteUser()` could succeed. Adds `DEPLOY_FIRESTORE_INDEXES.cmd`.
- Status: compiles, unit tests and golden cooking corpus pass, notification gates
  pass. **End-to-end account deletion verified on a real S25 from a >10-minute-old
  sign-in: password prompt, re-auth, retry, callable success, Auth user gone.**
  A real web-page deletion and the Play Console Data safety form update are the
  only items still outstanding - see `ACCOUNT_DELETION_REAUTH_AND_WEB_0.10.6.md`.

See `ACCOUNT_DELETION_REAUTH_AND_WEB_0.10.6.md`.

---

# ChefVoice Android v0.8.6 — Food-First Community Profiles

- Continues from v0.8.5 Followed Live Alerts.
- Community is finished-dish-photo first with chef identity inside the image.
- Public Chef Profile navigation is available from Community, recipe detail, and Live.
- Followers are count-only; follower identities are not exposed.
- Live hub prioritizes followed chefs; Follow and reactions are integrated over the Live area.
- Protected parser, Second Pass, private audio, WebRTC/media, App Check, Storage rules, and shared corpus are unchanged.
- Version: 0.8.6 (`versionCode 29`).
- Status: source implementation + source regression validation complete; Windows APK build/install and real-device acceptance pending.

See `FOOD_FIRST_COMMUNITY_PROFILES_0.8.6.md`.

---

# ChefVoice Android v0.8.5 — Followed Live Alerts

- Extends the proven v0.8.4 notification pipeline with followed-chef Live alerts.
- Adds deterministic, block-aware, bounded follower fanout from `liveSessions/{sessionId}`.
- Adds dedicated `liveSessionId` notification data on backend and Android.
- Adds in-app and system-notification routing to Live.
- Keeps the existing isolated `chefvoice-notifications` codebase and working IAM model.
- Protected cooking parser, Second Pass, private audio, Live media, App Check bootstrap, Storage rules, and shared corpus are unchanged; Firestore notification-device rules are aligned to the already-live Android/PWA rule.
- Version: 0.8.5 (`versionCode 28`).
- Status: source implementation generated; automated validation and real-device acceptance are tracked separately and must not be overstated.

See `FOLLOWED_LIVE_ALERTS_0.8.5.md`.

---

# ChefVoice Android v0.8.4 — Activity Notifications

- Adds private persistent activity notifications for Messages, recipe comments, and recipe likes.
- Adds Android system notifications through FCM using registered Firebase Installation IDs.
- Adds Android 13+ POST_NOTIFICATIONS permission handling.
- Message pushes intentionally omit private message content.
- Android verifies recipient UID before displaying a data-only push.
- Blocked account pairs do not generate social notifications.
- Notification records are backend-created; clients can only advance their own read state.
- Notification Functions are isolated in the `chefvoice-notifications` codebase and do not redeploy `transcribeChefVoice`.
- Protected cooking parser, Second Pass, private audio, Live media, App Check bootstrap, Storage rules, and shared corpus are unchanged.
- Version: 0.8.4 (`versionCode 27`).
- Status: generated/source-validated candidate; Firebase deploy, Windows build/install, and real-device acceptance pending.

See `ACTIVITY_NOTIFICATIONS_0.8.4.md`.

---

# ChefVoice Android v0.8.3 — Message Blocking

- Adds owner-private `users/{uid}/blocks/{blockedUid}` records.
- Block/Unblock is available inside an existing private conversation.
- Firestore rules stop new conversation/message writes when either participant has blocked the other.
- Existing private message history remains readable to its two participants.
- v0.8.2 unread read-markers are hardened so `lastReadAt` cannot move backward.
- Protected cooking parser, Second Pass, private raw audio, Live media, and App Check files are unchanged.
- Version: 0.8.3 (`versionCode 26`).
- Status: generated/source-validated candidate; Windows build/install and real-device acceptance pending.

See `MESSAGE_BLOCKING_0.8.3.md`.

---

# ChefVoice Android v0.7.0 — Second-Pass Parity

- Native Android recipe detail now includes authenticated second-pass transcription.
- Full cooking-session WAV uploads to the private `privateVoice/{uid}/{recipeId}/...` path.
- Reuses deployed `transcribeChefVoice` callable + Chirp 3 backend.
- Runs the returned transcript through the native deterministic parser.
- Review is explicit: Use second pass / Keep current; no silent rewriting.
- Second-pass results persist locally and are excluded from public Firestore recipe maps.
- Firebase Functions Android dependency added.
- Version: 0.7.0 (`versionCode 15`).

See `ANDROID_SECOND_PASS_PARITY_0.7.0.md`.

---

# ChefVoice v0.6.4 build compatibility fix

This revision fixes `checkDebugAarMetadata` failures on stable Android 16 / API 36.

- `compileSdk` / `targetSdk`: 36
- `androidx.activity:activity-compose`: 1.12.4
- `androidx.core:core` and `core-ktx`: strictly pinned to 1.17.0
- Reason: AndroidX Core 1.19.0 requires compileSdk 37+, while Core 1.17.0 remains compatible with API 36.
- Version: 0.6.4 (`versionCode 12`)

The normal entry point remains `BUILD_AND_INSTALL.cmd`.

---

# ChefVoice v0.6.3 build/install repair

## What failed in v0.6.2

The v0.6.2 script required `platforms;android-37`. Android 17 / API 37 is currently a preview SDK, so a normal stable SDK channel can legitimately report that package as unavailable. The failure happens before Gradle even starts building the app.

## What is changed

- Project now builds against stable Android 16 / API 36.
- `targetSdk` is 36.
- `lifecycle-runtime-compose` is pinned to 2.10.0 so the app does not inherit the API 37 compile requirement introduced by Lifecycle 2.11 Compose artifacts.
- The SDK setup checks for `platforms;android-36` instead of preview API 37.
- The installer prefers the current `android sdk install` CLI when available and falls back to `sdkmanager` for older setups.
- Android Studio's bundled JBR is preferred for the Gradle bootstrap.
- The build console remains open after errors and writes `build_install.log`.
- If the APK builds but no phone is authorized, Explorer opens directly to the APK.

## Run

1. Extract the ZIP fully.
2. Connect the Android phone and enable USB debugging.
3. Double-click `BUILD_AND_INSTALL.cmd`.

APK output:

    app\build\outputs\apk\debug\app-debug.apk

Full log:

    build_install.log

## PWA Alpha 7 — Reliability + Trust (2026-08-12)
The web client now includes crash/reload cooking-session checkpoints, ingredient provenance/confidence review, private raw cooking audio, hardened Storage paths, kitchen-instrument capture UI, local Ingredient Acceptance metrics, and more reliable iPhone front/back camera switching. Android source was not changed in this release. See `PWA_BUILD_STATUS.md` and `RELIABILITY_TRUST_0.7.md`.
