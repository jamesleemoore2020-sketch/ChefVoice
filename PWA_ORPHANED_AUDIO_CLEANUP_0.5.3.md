# PWA — orphaned private-audio cleanup on recipe delete (0.5.3)

## Context

ChefVoice Review (Second Pass) uploads the original cooking-session audio to Cloud Storage
at `privateVoice/{uid}/{recipeId}/session` even before a recipe has a Firestore `recipes/{id}`
document -- `privateRecipeOwnedBy` (`storage.rules`) and `authorizeChefVoiceStorageUpload`
(Cloud Functions) both explicitly treat "no Firestore doc yet" as an unpublished-but-owned
recipe. `PWA_CAPTURE_SECOND_PASS_0.5.2.md` leans on exactly this to let Review run during
Capture, before the recipe is even saved, minting a `draftRecipeId` that becomes the real
recipe id at save time.

`bindRecipes()`'s delete handler in `web/js/app.js` did not account for any of this. It only
ever did local cleanup -- `deleteAudioBlob(id)` (IndexedDB) and `deleteRecipeMedia(r)` -- for
every "Delete local" click, published or not. A recipe that was saved but never published,
and had ChefVoice Review run against it (post-save, or during Capture before that first save),
left its uploaded audio under `privateVoice/{uid}/{recipeId}/` in Cloud Storage with nothing
ever cleaning it up short of a full account deletion.

This is a storage-hygiene issue, not a security one: the path stays access-controlled to the
owning `uid` throughout, and the leaked cost is bounded (one audio file per never-cleaned-up
recipe). The Android app had the identical gap in `ChefAppState.deleteRecipe()`; see
`SECOND_PASS_ORPHANED_AUDIO_CLEANUP_0.10.6.md` for that fix, landed first on a different
branch since this PWA branch was not merged to `master` at the time.

## Fix

Added `deleteChefVoiceRecipe(recipeId)` to `web/js/firebase-client.js`, calling the existing
`deleteChefVoiceRecipe` Cloud Function the same way `transcribePrivateChefVoice` already calls
`transcribeChefVoice` via the shared `callFunction()` helper. No new Cloud Function was needed:
that callable already tolerates a missing `recipes/{id}` doc (`deleteRecipeArtifacts` deletes
the `privateVoice/{uid}/{recipeId}/` and `recipes/{uid}/{recipeId}/` Storage prefixes
unconditionally, and only conditionally deletes the Firestore doc/likes/comments if any exist)
-- it was already correct for the never-published case, it just had no PWA caller. (There is
a same-named `deleteCloudRecipe` already in `firebase-client.js`, but it is an unrelated,
currently-unused raw client-side `deleteDoc()` with no Storage cleanup at all -- left as-is;
wiring up real cloud deletion of a *published* PWA recipe is a separate, bigger gap this pass
does not touch.)

`bindRecipes()`'s delete handler now best-effort calls it when the recipe being deleted is
unpublished and has `sessionAudio?.stored` (the local flag `saveAudioBlob()` already sets
whenever a recording was kept for this recipe -- the closest available signal to "Review may
have uploaded audio for this id", since the PWA has no persisted per-recipe Second Pass
result to check more precisely, unlike Android's `Recipe.secondPass`). The call is
fire-and-forget (`.catch(()=>{})`, result never surfaced) and gated on `cloud.api && cloud.user`:
it must never block or fail the local delete, which has to keep working exactly as before when
offline or signed out. The account-deletion-time sweep remains the backstop either way.

## What did not change

Cloud Functions (`deleteChefVoiceRecipe`, `deleteRecipeArtifacts`), `storage.rules`,
`firestore.rules`, the deterministic parser, Live/WebRTC, and App Check (still
monitoring-only) are all untouched. The Android fix is separate and already shipped
(`SECOND_PASS_ORPHANED_AUDIO_CLEANUP_0.10.6.md`).

## Verification

- `npm test` (`web/`): 95/95.
- `node tests/cook-wizard.dom.mjs`: 60/60, unaffected -- that harness deliberately excludes
  `recipesTemplate`/`bindRecipes` from its sliced VM context.
- New `node tests/recipes-list.dom.mjs` (8/8): a minimal jsdom harness slicing just
  `recipesTemplate`/`bindRecipes` out of `app.js`, covering all four gating conditions --
  signed-out (no cloud call, local delete still happens), signed-in + unpublished + stored
  audio (cloud call fires, local cleanup still happens), signed-in + unpublished + no stored
  audio (no cloud call), and signed-in + published + stored audio (no cloud call).
- Not exercised in a real browser this pass -- no new UI, only a behavior addition to an
  existing button's handler.

Cache/package version is 0.5.3.

## Deploy

```
DEPLOY_PWA.cmd
```

Reload/reopen the PWA after deployment to pick up cache version 0.5.3.
