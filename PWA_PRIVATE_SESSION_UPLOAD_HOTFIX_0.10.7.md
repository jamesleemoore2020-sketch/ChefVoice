# ChefVoice — PWA private cooking-session upload hotfix (v0.10.7 line)

Follow-up to `RECIPE_TAGS_SEARCH_READ_ALOUD_0.10.7.md`, which found this bug
while seeding Community recipes and deliberately left it broken rather than
risk publishing previously-private audio with a rushed fix (see that doc's
"Deliberately not fixed" note, also recorded in `BUILD_STATUS.md`).

## Root cause

`publishRecipe()` in `web/js/firebase-client.js` uploaded the chef's full
Cook & Capture recording to `recipes/{uid}/{recipeId}/voice/{clipId}.{ext}`
with no upload permit requested at all. That path was wrong two ways over:

- `storage.rules`' `voice/{fileName}` slot only accepts filenames matching
  `clip-00`..`clip-15` (`validVoiceSlot`); `publishRecipe` was writing
  `session-{recipeId}.{ext}`, which never matches, so the upload always
  failed and fell into the warnings path — the chef's original narration
  was never actually available for ChefVoice Review on a recipe published
  from the PWA.
- Even if the filename had matched, `voice/{fileName}` is the slot Android
  uses for short *public* highlight clips (a `getDownloadURL()` is a
  shareable link that bypasses read rules by design). Routing the private
  full-session recording through it would have made previously-private
  cooking audio fetchable by anyone with the link the moment the filename
  bug was fixed naively — worse than leaving it broken.

## Fix

Mirrors Android's `uploadVoice()` `isFullCookingSession` branch
(`FirebaseSocialRepository.kt`) and the PWA's own
`transcribePrivateChefVoice()` (already used by ChefVoice Review, and
already correct):

- Request a `private_session` permit via `authorizeChefVoiceStorageUpload`
  with the fixed `fileName: 'session'`.
- Upload to `privateVoice/{uid}/{recipeId}/session` (no extension) with
  `chefvoiceDurationMs`/`chefvoicePermitId`/`chefvoiceUploadToken`
  metadata, skipping the upload with a warning if the audio's duration
  can't be read or exceeds the 90-minute cloud limit — the same guard
  ChefVoice Review already uses.
- Never request a public download URL, and never add the clip to
  `uploadedVoice` (the recipe's public `voiceClips` list) — matching
  Android's `toCloudMap()`, which drops any clip labeled "Full cooking
  session" from the published recipe doc regardless of URL. The private
  recording exists only at its Storage path, for a later ChefVoice Review
  pass to read directly.

Removed `extensionFor()`, which had no remaining caller once the upload
stopped needing a public filename extension.

## What did not change

`storage.rules`, `firestore.rules`, Cloud Functions and all Android app
code are untouched — the `private_session` permit kind and the
`privateVoice/{uid}/{recipeId}/{fileName}` rule already existed for
ChefVoice Review, so no backend surface needed to move. `app/build.gradle.kts`
is unchanged (still 0.10.7 / 59): this is a PWA-only fix with nothing for
the Android build to pick up.

## Verification

`node --check web/js/firebase-client.js` passes, and `npm --prefix web
test` is 86/86 (unchanged — no existing test exercises the live
Storage/Cloud Functions round trip). Not verified end-to-end against the
deployed project: that would need a signed-in, verified-email account
publishing a real recipe with recorded audio against production Storage.
Deploy with `DEPLOY_PWA.cmd` (runs the same `npm test` gate first, then
`firebase deploy --only hosting:pwa --project chefvoice-d7fec`) — not yet
deployed.

## Also found, not fixed here (out of scope)

Running the full `notifications/` gate (`RUN_NOTIFICATION_GATES.cmd`)
turned up 5 pre-existing failures unrelated to this change, introduced by
the prior session's own commits before this fix started:
`chef-discovery-following-feed.test.js`, `live-lease-safety.test.js`,
`production-trust.test.js` and `recipe-time-metadata.test.js` all assert a
literal `versionCode = 58` / `versionName = "0.10.6"` in
`app/build.gradle.kts`, which the prior session's tags/search/read-aloud
work bumped to 59 / 0.10.7 without updating these tests; and
`chef-discovery-following-feed.test.js` also expects the literal string
`Search chefs or dishes` in `ChefVoiceApp.kt`, which the same session's
collapsible-search change apparently altered. Flagged as a follow-up task
rather than fixed here to keep this change scoped to the voice-upload bug.
