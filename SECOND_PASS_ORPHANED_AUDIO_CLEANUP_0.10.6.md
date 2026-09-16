# ChefVoice — orphaned private-audio cleanup on recipe delete (v0.10.6)

## Context

ChefVoice Review (Second Pass) uploads the original cooking-session audio to Cloud Storage
at `privateVoice/{uid}/{recipeId}/session` even before the recipe has a Firestore
`recipes/{id}` document — `privateRecipeOwnedBy` (`storage.rules`) and
`authorizeChefVoiceStorageUpload` (Cloud Functions) both explicitly treat "no Firestore doc
yet" as an unpublished-but-owned recipe, exactly so Review can run on a saved-but-never-
published recipe.

`ChefAppState.deleteRecipe()` did not account for that. Its `hasCloudCopy` check
(`recipe.isPublic || recipe.authorId.isNotBlank()`) is false for any recipe that was saved
locally but never published, so deleting one took the pure-local branch — `recipes.removeAll`
plus `persist()`, with no call to the cloud at all. If that recipe had ever run ChefVoice
Review, its uploaded audio under `privateVoice/{uid}/{recipeId}/` was orphaned in Cloud
Storage, recoverable only by the account-wide `deleteStoragePrefix('privateVoice/${uid}/')`
sweep inside `deleteChefVoiceAccount` — which runs only on full account deletion, not on a
single recipe's delete.

This is a storage-hygiene issue, not a security one: the path stays access-controlled to the
owning `uid` throughout, and the leaked cost is bounded (one audio file per never-cleaned-up
recipe).

## Fix

`ChefAppState.deleteRecipe()`'s local-only branch now also calls the existing
`deleteChefVoiceRecipe` callable — already used a few lines below by the published-recipe
delete path — whenever `recipe.secondPass != null`. That field is the durable signal that
ChefVoice Review actually ran (it is only ever set from a successful `transcribeChefVoice`
response, which only happens after the private audio upload already succeeded) and is never
cleared back to null afterward, so it reliably tracks "there is private audio in Cloud
Storage for this recipe id" for the recipe's whole local lifetime.

No new Cloud Function was needed. `deleteChefVoiceRecipe` already tolerates a missing
`recipes/{id}` doc: `deleteRecipeArtifacts` deletes the `privateVoice/{uid}/{recipeId}/` and
`recipes/{uid}/{recipeId}/` Storage prefixes unconditionally, and only deletes the Firestore
doc itself if one exists. It was already correct for this exact never-published case — it
just wasn't being invoked from this path.

The call is deliberately best-effort and fire-and-forget (default no-op callback, no busy
state, result not surfaced to the user): it only fires when `cloudConfigured && isSignedIn`.
Local recipe delete must keep working exactly as it did before — instantly, offline, signed
out or not — because this is a cleanup opportunity, not a correctness requirement; the
account-deletion-time sweep remains the backstop either way.

## What did not change

Cloud Functions (`deleteChefVoiceRecipe`, `deleteRecipeArtifacts`), `storage.rules`,
`firestore.rules`, the deterministic parser, Live/WebRTC, and App Check (still
monitoring-only) are all untouched.

## PWA counterpart not fixed here

The same gap exists in the PWA's `bindRecipes()` delete handler (`web/js/app.js`): it only
calls `deleteAudioBlob`/`deleteRecipeMedia` locally and never `deleteChefVoiceRecipe`, so a
never-published recipe with ChefVoice Review audio has the identical orphan there too — and
the recently-added Cook-wizard "run Review against the just-recorded draft" flow (branch
`claude/chefvoice-2026-09-11-handoff-be3999`, commit `d60442f`) makes it easier to reach,
since it can upload private audio before the recipe is saved at all.

That branch is not merged into `master`, and this checkout has no `web/` directory at all
(consistent with this repo's `CLAUDE.md`, which notes `web/` does not currently exist here) —
so the PWA side could not be fixed from this branch. The equivalent fix (call the delete
callable when the local draft/recipe has stored session audio and was never published) still
needs to be applied on that branch.

## Verification

- `gradlew.bat :app:compileDebugKotlin` — clean (pre-existing, unrelated warnings in
  `ChefVoiceApp.kt` only).
- `gradlew.bat :app:testDebugUnitTest` — full suite green.
- Not exercised on a connected device this pass — the change is a non-UI behavior addition
  to `deleteRecipe()` with no new screen or control to click through.
