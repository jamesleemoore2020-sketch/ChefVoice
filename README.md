# ChefVoice Android — v0.10.0 (versionCode 51)

## v0.10.0 — Production Trust

Production Trust carries the accepted v0.9.14 cooking baseline forward through four hardening builds. It adds Live signaling authorization, backend-owned social counters, private follower identities, bounded cloud fanout, owned-recipe media enforcement, cloud recipe/account cleanup, Second Pass quotas, moderator report disposition, account recovery/deletion controls, Android backup/cleartext/FileProvider hardening, and verified Gradle bootstrap inputs. The deterministic parser and Android Second Pass reviewer are byte-identical to the accepted v0.9.14 source.

**Acceptance status:** source/security gates pass; this candidate has not received real-device acceptance because that step was explicitly skipped for these four builds.

---

## v0.9.14 — Prep + Cook Time

v0.9.14 carries the real-device accepted v0.9.13 saved recipe step-media flow forward and adds optional prep/cook time metadata. Owners can set times on new recipes or under **Edit recipe** after save. Public changes remain local until **Update Community**. The deterministic parser, Second Pass reviewer, rules, notifications, App Check state, Speech backend, and Live transport are unchanged.

## v0.9.13 — Post-Save Recipe Photo + Video Editing

Android v0.9.12 is the accepted cooking-review baseline for this candidate. v0.9.13 adds owner-only media editing after a recipe has already been saved, without changing the deterministic parser or Second Pass reviewer.

- Open one of your saved recipes and choose **Edit media**.
- Add a **photo or video** to the recipe generally, or attach it directly to a specific Method step.
- Normal reading mode stays compact: add/remove controls are visible only while editing.
- Each Method row has a stable `stepId`; media stores that ID instead of a fragile step number, so attachments stay with the intended step when a later Second Pass action inserts a new Method row.
- Existing recipes are migrated locally with deterministic legacy step IDs; newly created recipes receive UUID step IDs.
- Android **Cook this recipe** can surface media attached to the active Method step as a visual reference.
- A public-recipe media edit is saved locally first and sets **Update Community** pending. It is not silently pushed to Community; the owner explicitly chooses when to republish the updated recipe.
- Recipe media metadata now carries optional `stepId` and `caption` fields in local/cloud serialization. Captions are schema-ready but this release does not add caption editing UI.

The existing public recipe media Storage path and ownership rules already support these uploads, so v0.9.13 does **not** require Firestore rules, Storage rules, Functions, IAM, App Check, Speech backend, or Live WebRTC changes. Original cooking audio remains private and remains the truth source.

## v0.9.11 — Mixed-Clause Recovery + Generic Ingredient Filtering

The v0.9.10 real-device burger capture was run without Second Pass and passed the duration-continuation target. It then exposed a narrower mixed-clause problem: when ASR heard `Take one pound of ground beef and make faux burger patties but then evenly shaped them`, ChefVoice kept the ground beef but lost the later Method narration. The same capture also produced generic false ingredients `2 tsp Stuff` and `1 Tasteful`.

v0.9.11 recognizes `make` and the observed `shaped` wording as Method actions without rewriting ASR text, treats `but then` as a soft ordered clause boundary, and rejects the exact observed generic ingredient artifacts `stuff` / `tasteful` (plus the existing `grab` filter). Nounless quantities still require an ingredient name. Uncertain wording such as `Good name in between` remains verbatim for optional Second Pass review.

No Firestore, Storage, Functions, IAM, App Check, Speech backend, or Live WebRTC changes are required for v0.9.11.

## v0.9.10 — Continuation + Ingredient Artifact Recovery

The v0.9.9 real-device burger capture proved intra-segment splitting and `Garlic i want` cleanup, then exposed two narrow deterministic defects. A duration-only timestamp (`For 20 minutes`) was dropped instead of attaching to the immediately preceding timed cook step, and observed ASR artifacts produced `1 Grab` plus `1 lb Ground beef it took`/duplicate ground-beef rows.

v0.9.10 keeps timestamp order and attaches a standalone duration only when the immediately preceding Method step is a time-bearing cooking action and does not already contain a duration. Thus `Cook them at 375 degrees` followed by `For 20 minutes` becomes `Cook them at 375 degrees for 20 minutes`, while the separate uncertain `Cook them for 350` fragment remains untouched for Second Pass review.

Ingredient cleanup is equally narrow: the observed bare `Grab` artifact is rejected, and the terminal narration stub `it took` is trimmed from a measured ingredient before exact deduplication. ChefVoice does not invent food names, temperatures, actions, or corrections.

No Firestore, Storage, Functions, IAM, App Check, Speech backend, or Live WebRTC changes are required for v0.9.10.

## v0.9.9 — Intra-Segment Method Refinement

A fresh v0.9.8 real-device burger capture proved temperature/time/order and timestamp boundaries, but one long recognition card still bundled several predicates and a measured ingredient retained the narration tail `I want`. v0.9.9 adds a narrow deterministic clause-boundary rule for repeated `... them ... <verb> them ...` predicates and trims trailing first-person narration markers from measured ingredient chunks.

ChefVoice does **not** silently correct uncertain ASR words. In the exact regression fixture, `pet them` and `see them` remain verbatim Method steps for optional Second Pass review; the parser does not invent `pat` or `season`. The measured `2 tbsp Garlic i want` artifact is cleaned to `2 tbsp Garlic`.

No Firestore, Storage, Functions, IAM, App Check, Speech backend, or Live WebRTC changes are required for v0.9.9.

## v0.9.8 — Timestamp-aware Method Boundary Recovery

Android v0.9.7 cleaned the burger ingredients and preserved temperature/time facts, but a real timestamped capture exposed one remaining deterministic parser bug: the 00:36 cook segment, the uncertain 00:39 “Foot them in between” segment, and the 00:43 rest segment were merged into one Method step.

v0.9.8 keeps timestamped recognition boundaries as Method evidence while still using whole-transcript and adjacent-window parsing for ingredient recovery. The exact failing capture is now a shared golden-corpus fixture. The parser also deterministically normalizes cooking phrasing such as `Cook them for 375 degrees` to `Cook them at 375 degrees` when the numeric phrase is clearly a temperature.

Important behavior:

- `Cook them at 375 degrees for 20 minutes.` is its own step.
- The uncertain recognized phrase `Foot them in between.` remains its own step; ChefVoice does not silently guess that ASR meant “flip”.
- `Let them rest with five we feel serving.` remains its own subsequent step until optional Second Pass review can suggest a correction from the original audio.
- Measured seasoning segments immediately following a seasoning action may stay attached to that seasoning step.
- Single-segment narration keeps the existing deterministic whole-narration behavior.
- No LLM was added to parsing. Original raw cooking audio remains the truth source and Second Pass remains explicit review only.

No Firestore, Storage, Functions, IAM, App Check, Speech backend, or Live WebRTC changes are required for v0.9.8.

## Legacy recipe orphan recovery in this candidate


- **v0.9.6 orphan recovery:** a public/local recipe whose expected Firestore document is already missing can now be safely deleted locally or kept private after a read-only cloud preflight. Existing cloud documents still require matching `authorId`; recipe write permissions are unchanged.
- **Accepted v0.9.6 cloud baseline:** the cumulative Firestore rules were deployed successfully on 2026-08-15 and the legacy orphan recipe delete then passed on the real Android device. v0.9.8 does not require another rules change.
- Notification history is no longer an endless pile: users can clear read items, and the isolated notification backend prunes up to 50 records older than 30 days whenever new activity arrives.
- Public/legacy recipes are treated as potentially cloud-backed so Delete attempts the owned cloud document first and keeps the local copy if authorization/network deletion fails.
- The full isolated backend now includes message, comment, reply, like, new-follower, followed-chef-Live, and push functions.

## Live Lease Safety
Live hosts renew `heartbeatAt` every 10 seconds while hosting. A Live room is considered active only while that lease is fresh (35-second timeout). This prevents a killed/backgrounded client or failed final Firestore write from leaving a chef shown as LIVE indefinitely. Older pre-lease sessions receive a 90-second compatibility grace period.

All v0.9.5 Live lease safety, v0.9.4 navigation, reliable recipe deletion, v0.9.3 social foundation, notification preferences, Blackout, deterministic cooking parser, Second Pass, and WebRTC media architecture are carried forward.

Cumulative social/community candidate built from the protected ChefVoice cooking stack and the v0.8.9 Cleaner Notifications source baseline. Real-device acceptance for the four new social milestones is intentionally pending.

## Cumulative social milestones

- **v0.9.0 — New follower notifications + follow polish**
  - deterministic private follower activity alert
  - block-aware and preference-aware
  - New followers notification preference
  - follower alert opens that Chef Profile
- **v0.9.1 — Threaded comment replies**
  - bounded one-level replies
  - exact reply notification routing
  - Replies notification preference
- **v0.9.2 — Safety parity**
  - existing Android Block/Unblock retained
  - private immutable reports for chefs, recipes, comments/replies, and private messages
- **v0.9.3 — Chef discovery + Following feed**
  - explicit **Following | Discover** Community modes
  - search chefs or dishes
  - chef result photo, name, bio/specialties, aggregate follower count, Follow/Following
  - follower identity lists remain private/not exposed
  - no algorithmic feed ranking
  - Android system notification taps now resolve non-Live private notification events through the same in-app route, including exact reply highlighting

## Existing protected behavior retained

Deterministic parser, original private cooking audio, Second Pass review, Live WebRTC/media transport, Blackout mode, Storage rules, and App Check policy are preserved. App Check enforcement remains OFF.

## Windows build + install

1. Extract the ZIP.
2. Open `ChefVoiceAndroid`.
3. Connect an authorized Android phone if you want install as well as build.
4. Run `BUILD_AND_INSTALL.cmd`.

APK output after a successful build:

    app\build\outputs\apk\debug\app-debug.apk

## Firebase

The accepted v0.9.6 orphan-recovery Firestore rules and existing recipe-media Storage rules are carried forward unchanged. v0.9.13 itself requires only the new Android APK. Public media edits remain local until the owner explicitly taps **Update Community**, which reuses the existing recipe publish/upload path. Notification Functions, IAM, App Check, Speech, and Live infrastructure do not change. `DEPLOY_NOTIFICATIONS.cmd` remains isolated to the `chefvoice-notifications` codebase; do not rebuild working IAM.


## v0.9.4 — Navigation + Live Safety + Reliable Recipe Delete

- Android system Back now unwinds ChefVoice detail screens and previously visited tabs before exiting.
- Active Live hosts get an explicit End Live & Leave / Stay Live guard. Backgrounding ChefVoice ends local host state immediately so camera/microphone shut down and the cloud Live room is marked ended.
- Cloud recipe deletion is cloud-first: the local recipe is removed only after cloud deletion succeeds. Unpublish removes Community visibility while keeping the private recipe.