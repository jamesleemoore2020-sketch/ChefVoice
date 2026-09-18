# ChefVoice session handoff — 2026-09-18 (session 6: Review cost controls, five features, device test)

## 1. TASK
Confirm 0.11.12 published, cap what ChefVoice Review costs to run, then build five
cook-along/library features and get them onto the device for testing.

## 2. TOUCHED
Worktree `.claude/worktrees/chefvoice-2026-09-11-handoff-be3999`, branch
`claude/chefvoice-2026-09-11-handoff-be3999`. Commits `b600c1c`, `cbe5869`, `0bf9591`,
`923cf5d` — all pushed, working tree clean.

- `util/StepTimers.kt`, `util/IngredientScaling.kt`, `util/ShoppingList.kt`,
  `util/CookCommands.kt`, `voice/CookCommandListener.kt` — new; all logic is here, all
  unit-tested.
- `model/Models.kt` — `SecondPassLimits`, `ShoppingItem`, `RecipeCollection`.
- `cloud/FirebaseSocialRepository.kt` — review cap now `SecondPassLimits`, publish path
  keeps `PRIVATE_SESSION_MAX_DECLARED_DURATION_MS` (90 min); `releasePrivateSessionAudio`.
- `ui/ChefVoiceApp.kt` — cook-along timers + hands-free, recipe scaling/shopping/collection
  UI, `ShoppingListScreen`, library collection chips, notification rows, Community feed
  restructured to one `LazyColumn`.
- `ui/ChefAppState.kt`, `data/RecipeRepository.kt`, `util/ShareUtils.kt`.
- PWA: `web/js/firebase-client.js`, `entitlement.js`, `app.js`,
  `web/tests/second-pass-cost.test.mjs`.
- Writeups `REVIEW_COST_AND_LIST_GESTURES_0.5.12_0.11.13.md`,
  `COOK_ALONG_AND_LIBRARY_0.11.14.md`, plus three `BUILD_STATUS.md` entries.

## 3. DECISIONS
- Review cap 90 min → **5 min**, same for Free and Pro: it bounds the cost of one review
  (speech is billed per minute), not how many a chef may run. Publish-time private copy
  costs storage but no speech, so it kept its own 90-min ceiling under a separate name.
- Uploaded audio deleted after the callable returns, **success and failure alike** — a
  failed transcription orphans the same object. Best-effort; a failed delete must never
  fail a completed review.
- `StepTimers` is a **read-only extractor outside `CookingSessionParser`**, so it cannot
  touch a corpus row. The parser's own duration code sums one duration per step; a timer
  needs all of them plus their positions.
- Command matching is literal — a command word inside narration must not fire. Only
  reversible commands may act on a partial recognition result.
- Shopping merge requires name + comparable unit + both quantities numeric. Scaling and
  conversion are a **view**, never written back.
- Collections are **device-local**: no Firestore collection, no rule, no rules deploy.

## 4. RULED OUT
- **Capping the recording itself** (`MediaRecorder.setMaxDuration`) — would cut a chef off
  mid-narration in the core capture flow. James chose "review upload only".
- **Transcribing only the first 5 minutes** of a long recording — a silent partial result,
  which the parser rules exist to prevent. Over-long audio is refused outright instead.
- **A scheduled cleanup function or GCS lifecycle rule** — unnecessary; `storage.rules`
  already grants the owner delete on `privateVoice/{uid}/{recipeId}/session`, so the
  client does it inline. No rules or Functions deploy happened this session.
- **`confirmValueChange` on `SwipeToDismissBox`** — deprecated in this Compose BOM. Both
  call sites drive off `dismissState.currentValue` instead.
- **Porting timers/hands-free to the PWA** — it has no cook-along screen at all (routes:
  recipes, inbox, live, profile), so that is a build, not a port.
- **Installing a debug APK on the dev phone** — see GOTCHAS.

## 5. STATE
Android **76 / 0.11.15**, PWA **0.5.12**. Android 108 tests / 0 failures
(`GoldenCookingCorpusTest` still 24, `SecondPassReviewerTest` 19). PWA 130 / 0.
`assembleDebug` and `assembleRelease` both clean.

Installed on SM-S938U as a **release-signed** build and **confirmed working by James** —
timers, hands-free, shopping list, scaling, collections, both swipe gestures, and the
Community scroll. Play production is `Active · Latest release: 73 (0.11.12)`; **76 has
not been submitted**.

## 6. GOTCHAS
- **The dev phone carries a release-signed build.** A debug APK is refused with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, and forcing it needs an uninstall that wipes local
  recipes and private cooking audio. Build `:app:assembleRelease` instead — all four
  `CHEFVOICE_RELEASE_*` variables are set in the environment, keystore at
  `C:\Users\james\Documents\ChefVoice-Release-Key\chefvoice-release.jks` — and it installs
  over the top with data intact while exercising R8.
- **Backticks and `${}` inside `node -e "..."` via Bash get eaten by the shell.** This
  silently mangled a template literal into `return +`. Use the Edit tool or a script file
  for anything containing them; the same hazard the session-5 handoff flagged for regex.
- Phone drops off `adb` when it sleeps; `adb wait-for-device` in the background is a
  reliable way to catch it reconnecting.
- Emoji/em-dash in Kotlin and Markdown also break shell-quoted node one-liners.

## 7. NEXT
Second-tier features, in James's stated order of interest: recipe import from a URL (needs
its own deterministic path, kept away from the parser core), nutrition estimates, meal
planning, "made it" posts crediting the original chef, and Live recording/replay.

## 8. OPEN
- Whether to ship 76 to Play now or batch more first. Nothing is in flight on Play.
- PWA parity for shopping list, scaling and collections (portable); timers and hands-free
  need a PWA cook-along screen first.
- Carried, still unscoped: `possible-missed-step` auto-apply; Android has no pre-save
  ChefVoice Review; `ndk { debugSymbolLevel = "FULL" }` and the ad-ID declaration;
  ~600 MB of gitignored `ChefVoice-v0.11.*` artifacts in the repo root; the ended
  `R8 test – ignore` live session doc.
