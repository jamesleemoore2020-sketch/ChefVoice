# ChefVoice Android — audit fix pass

Applied on top of v0.10.1 (versionCode 52). **Bump `versionCode` to 53 and
`versionName` to `0.10.2` in `app/build.gradle.kts` before uploading** —
`tools/BuildProductionTrust.ps1` now reads both from there, so that file is the
only place the version is written.

Every change below is either verified in this pass or clearly marked as needing
your device. Nothing here has been compiled against the Android SDK.

---

## Blockers

### B1 — Restriction path threw before reaching the network
`moderation/userRestrictions/{uid}` is three segments. Firestore documents need an
even number, so `db.doc()` threw immediately. Reproduced against the pinned
`firebase-admin@14.2.0`.

Restrictions now live at `userRestrictions/{uid}`, defined once as
`RESTRICTIONS_COLLECTION` in `notifications/functions/index.js` and referenced by
`firestore.rules` and `storage.rules`.

- `notifications/functions/index.js` — new `RESTRICTIONS_COLLECTION` / `restrictionPath()`; call sites in `applyModerationAction()` and `publicSocialUploadRestricted()`
- `firestore.rules` — `restrictionActive()`, plus a closed `match /userRestrictions/{uid}`
- `storage.rules` — `socialUploadAllowed()`

**Restores:** profile photo upload, cover photo upload, and public recipe media
upload. All three were failing with an internal error, which also meant
`publishRecipe` left recipes at `isPublic = false`.

**Deploy note:** if any restriction documents were written under the old layout,
they are unreachable and can be ignored. The old `match /moderation/{document=**}`
deny-all is kept so they stay closed.

### B2 — Moderation event path threw before reaching the network
`db.collection("moderation/events")` is two segments; collections need an odd
number. `recordModerationEvent()` is called on every `moderateChefVoiceReport`
invocation, so no report status could ever change. Events now go to a top-level
`moderationEvents` collection, also closed to clients in the rules.

### B3 — Nobody could edit their Chef Profile after signup
Two independent failures on the same write.

1. The client sent a fresh `createdAt` on every save, which put `createdAt` into
   `diff().affectedKeys()` and violated the update allowlist.
2. `validUserProfile` was applied to updates and required `createdAt` to be less
   than 24 hours old, while `createdAt` is immutable — so every account older than
   a day failed regardless.

- `FirebaseSocialRepository.saveProfile()` takes `isNewProfile` and sends
  `createdAt` only when creating. Sign-up and the profile listener can both decide
  a profile is missing, so the create path re-checks and downgrades to a normal
  update if it lost that race.
- `firestore.rules` splits `validUserProfile` into `validUserProfileCreate` (keeps
  the recency check) and `validUserProfileUpdate` (drops it), and pins
  `createdAt == resource.data.createdAt` on update.
- Call sites updated in `ChefAppState` (sign-in listener) and
  `FirebaseSocialRepository.signUp()`.

**Restores:** editing display name, bio and favorite things, and attaching an
uploaded avatar or cover to the profile.

---

## High

### H1 — Rules now provably enforce restrictions
Fixed by B1. Added `rules-tests/` — a real behavioral suite that runs the rules in
the Firestore emulator, covering restriction enforcement, profile editing, recipe
ownership and visibility, live signaling access, and cross-conversation messaging.

```
RUN_RULES_GATES.cmd
```

**This suite has not been run.** The emulator could not be downloaded in the audit
environment. Run it before your next deploy; it is what would have caught B3.

### H2 — Image loading replaced with Coil
Four sites fetched images with `URL.openStream()` and decoded them with
`BitmapFactory` at full resolution, with no cache. A 25 MB community photo became
roughly 48 MB of heap to fill a 56.dp avatar, and a scrolling feed re-downloaded
and re-decoded on every item recycle.

- New `ChefVoiceApplication` configures one Coil `ImageLoader` — memory cache at
  25% of app memory, 96 MB disk cache, OkHttp networking, video frame decoding
- New `ui/ChefImage.kt` — `ChefAsyncImage` and `mediaModel()`
- `RemoteProfileImage`, `RecipeMediaBanner` and `MediaPreview` rewritten
- `MediaTools.loadMediaThumbnail` deleted
- `android:name=".ChefVoiceApplication"` added to the manifest

Remote videos deliberately resolve to `null` rather than pulling a 200 MB file to
render one thumbnail frame; they show the 🎬 tile and play on tap, as before.

### H3 — Foreground service for capture and Live
Android 11 cuts microphone input to background apps and Android 9 blocks the
camera. Cooking capture had no guard at all and recorded silence whenever the chef
switched apps or the screen locked.

- New `notifications/ChefVoiceForegroundService` with a low-importance ongoing
  notification, typed `microphone` (cooking) or `microphone|camera` (Live)
- Manifest: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`,
  `FOREGROUND_SERVICE_CAMERA`
- Started and stopped alongside `sessionCapture` and the WebRTC host controller
- `KeepScreenOn` holds the display awake while capturing

**Left as your decision:** `ChefVoiceApp` still ends a Live broadcast on `ON_STOP`.
That is a deliberate privacy choice, so it was not changed. With the service in
place, deleting that handler is all it now takes to support background
broadcasting.

### H4 — Six failing unit tests, all fixed at the source
Ran with a JUnit-4 shim against sources compiled by `kotlinc 2.1.20`. **21/21 now
pass**, up from 15/21. Five of the six were real defects, not stale tests.

| Test | Cause | Fix |
|---|---|---|
| `materiallyDifferentMethodWordingRequiresReviewBeforeReplacement` | `methodMeaningIsContained()` treated any word-superset as confirmation | narrowed |
| `expandedSecondPassMethodDetailPairsAsWordingReview` | same | same |
| `accepted0912NeighboringMethodCorrectionsRebuildCleanly` | same | same |
| `realDevice0912AlignsCompositeSecondPassMethodToNeighboringLiveSteps` | same | same |
| `realDeviceSecondPassCleansLegacyLiveArtifactsWithoutSilentRewrite` | `IngredientReviewClassifier` never stripped ASR tails, so "Pepper You gonna" scored 0.33 against "Pepper" | comparison-only tail strip |
| `quantityDisagreementIsReviewOnlyUntilAccepted` | test asserted the pre-rename type string | test corrected |

**`methodMeaningIsContained` (`SecondPassReviewer.kt`)** — extra Second Pass wording
still counts as confirmation, but no longer when the added words introduce a new
cooking action, duration or temperature. "Cook for 20 minutes" →
"Cook for 20 minutes, flipping halfway" is a real instruction and gets a review
card again, matching the 0.7.5 Method Review contract.

**`IngredientReviewClassifier`** — a conversational tail on an ingredient name
defeated the "pepper vs lemon pepper" distinction rule and produced a bogus
"possible missed ingredient" plus a "live-only" card instead of the name cleanup.
Stripped for comparison only; saved recipe text is untouched.

**`quantity-change`** stays the emitted type. It is persisted in local JSON on
users' devices and matches its "Quantity changed" title. `applySuggestion` still
accepts the legacy `measurement-disagreement` for older saved reviews.

### H5 — WebRTC permissions added; TURN still outstanding
`ACCESS_NETWORK_STATE` and `MODIFY_AUDIO_SETTINGS` added to the manifest.

**Not fixed:** there is still no TURN relay, only STUN. Mobile-to-mobile calls
behind carrier-grade NAT will not connect. This needs a service (Twilio,
Cloudflare Calls, or self-hosted coturn) and credentials — your call.

### H6 — Collection-group indexes declared
`firestore.indexes.json` now declares `COLLECTION_GROUP`-scope indexes for
`comments.authorId`, `comments.replyToUid`, `notifications.actorUid` and
`bookmarks.recipeId`, plus the `conversations` composite for H8's ordering.

```
firebase deploy --only firestore:indexes --project chefvoice-d7fec
```

Wait for the indexes to build, then **delete a real test account end to end** and
confirm nothing is left behind.

### H7 — Edge-to-edge handled
`enableEdgeToEdge()` in `MainActivity`, and everything except the brand cover now
sits inside `WindowInsets.safeDrawing`. `Scaffold` gets
`contentWindowInsets = WindowInsets(0, 0, 0, 0)` so the padding is not applied
twice.

**Still open:** the app theme is the platform `Theme.Material.Light.NoActionBar`,
so system bars stay light when blackout mode is on. A proper
`res/values/themes.xml` with a `values-night` variant is the fix.

---

## Medium and low

| ID | Change |
|---|---|
| M1 | `BuildProductionTrust.ps1` builds `bundleRelease` and produces the `.aab` for Play, keeps the APK for the signature gate and sideloading, and copies the R8 mapping file |
| M2 | R8 enabled (`isMinifyEnabled`, `isShrinkResources`) with a new `app/proguard-rules.pro` |
| M3 | Real adaptive launcher icon — background, foreground and monochrome layers at five densities, generated from the brand artwork with the waveform cropped out |
| M4 | `gradle/wrapper/gradle-wrapper.properties` restored so Android Studio can sync; your verified bootstrap scripts are untouched |
| M6 | `RecipeRepository.pruneOrphanedMedia()` deletes media and cooking audio no recipe references, skipping anything under an hour old; runs off-thread at startup |
| M8 | Conversation inbox now orders by `updatedAt` descending |
| M9 | `users` split into `allow get: if true` / `allow list: if signedIn()`, so the collection can no longer be scraped anonymously |
| L1 | Version read from `build.gradle.kts` by the release script instead of retyped |
| L2 | `local.properties` removed from the package |
| L3 | `RUN_PARSER_GATES.cmd` skips the PWA step when there is no `web/` directory |
| L6 | `AudioRecorder.start()` returns null instead of crashing when the mic is busy; the UI shows a message |

### New gate: `notifications/firestore-path-shape.test.js`
Checks the segment parity of every literal Firestore path in the backend and both
rules files, and that all three agree on where restrictions live. Verified against
the pre-fix source: it fails all five checks there and passes all five here. This
is the gate that would have caught B1 and B2.

---

## Not done, and why

| Item | Why |
|---|---|
| **H5 TURN server** | Needs a paid relay and credentials |
| **M5 chef search** | Still scans up to 300 user documents per search. A proper fix needs a server-maintained `displayNameLower` field plus a backfill for existing accounts — worth doing, but it touches the rules and needs the emulator suite running first |
| **M7 deletion fan-out** | `deleteRecipeUserMirrors` and `deleteIncomingBlockReferences` still page every user. Fine at your size; the legacy bookmark scan can be dropped once you run it once as a migration |
| **M10 state restoration** | `ChefAppState` should move to a `ViewModel` with `rememberSaveable` for the current tab and open recipe. Real refactor, not a patch |
| **L4 string resources** | Every string is hardcoded English in Kotlin. Mechanical but large |
| **L5 accessibility** | Tab icons are emoji text, so TalkBack reads emoji names |
| **App theme** | See H7 |

---

## Before you upload

1. Bump `versionCode` to 53 and `versionName` to `0.10.2`.
2. `firebase deploy --only firestore:rules,storage,firestore:indexes,functions --project chefvoice-d7fec`
3. `RUN_RULES_GATES.cmd` — first run, has never been executed.
4. `RUN_NOTIFICATION_GATES.cmd` — 72/72 here.
5. `gradlew :app:testDebugUnitTest` — 21/21 in the shim harness; confirm under Gradle.
6. `tools\BuildProductionTrust.ps1`.
7. **Install the release build on a real phone.** R8 is newly enabled and shrinking
   problems only appear at runtime. Walk the whole path: sign up, edit the profile,
   add an avatar, record a cooking session with the screen locked partway through,
   publish to Community with a photo, scroll the feed, start a Live session, delete
   a test account.
8. Upload the `.aab`, and upload `ChefVoice-v<version>-mapping.txt` with it.
