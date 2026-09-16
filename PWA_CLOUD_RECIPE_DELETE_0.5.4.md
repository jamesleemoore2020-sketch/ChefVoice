# PWA — real cloud deletion for a published recipe (0.5.4)

## Context

`bindRecipes()`'s delete handler in `web/js/app.js` (the Recipes screen's delete
button) only ever did local cleanup -- `deleteAudioBlob(id)` (IndexedDB) and
`deleteRecipeMedia(r)` -- regardless of whether the recipe was published
(`r.isPublic`). There was no code path anywhere in `web/` that deleted a
published recipe's Firestore doc, Storage media, likes or comments. A chef who
published a recipe to Community and then deleted it from their device only
removed their own local copy: the recipe, and everything attached to it, stayed
live in Community forever, with no PWA action able to remove it.

`web/js/firebase-client.js` already exported a same-named `deleteCloudRecipe(recipeId)`,
but grep confirmed it had zero callers, and it could not have worked even if
someone had wired it up: it was a raw client-side `deleteDoc(doc(db,'recipes',recipeId))`,
and `firestore.rules` sets `allow delete: if false` on `recipes/{recipeId}`
specifically because "permanent cloud deletion is backend-owned so Storage and
child records are cleaned atomically/retry-safely." `PWA_ORPHANED_AUDIO_CLEANUP_0.5.3.md`
noticed this dead export while adding a narrower, unrelated fix (cleaning up
orphaned private Second-Pass audio for a *never-published* recipe) and explicitly
left it alone: "wiring up real cloud deletion of a published PWA recipe is a
separate, bigger gap this pass does not touch." This pass closes that gap.

The Android app already does this correctly: `ChefAppState.deleteRecipe()` treats
any recipe with `isPublic == true` or a non-blank `authorId` as potentially
cloud-backed, runs a read-only ownership preflight
(`FirebaseSocialRepository.inspectRecipeForMutation`) to tell a real cloud
document apart from a legacy local-only orphan, and only then calls
`FirebaseSocialRepository.deleteCloudRecipe()` -- which, despite the same name as
the PWA's dead function, actually calls the `deleteChefVoiceRecipe` Cloud
Function (the same callable `web/js/firebase-client.js` gained a wrapper for in
`f1934aa`, for the unrelated 0.5.3 fix). This pass mirrors that Android flow.

## Fix

- Removed the dead, non-functional `deleteCloudRecipe` export from
  `firebase-client.js`.
- Added `inspectRecipeForMutation(recipeId)` to `firebase-client.js`: a
  read-only `getDoc` preflight mirroring Android's
  `FirebaseSocialRepository.inspectRecipeForMutation`, returning
  `{exists, authorId}` so the caller can tell "never published" apart from
  "belongs to a different account" before doing anything destructive.
- Rewired `bindRecipes()`'s delete handler in `app.js`. A recipe that is public
  now, or was ever published (`Unpublish` clears `isPublic` but never
  `authorId`), is treated as cloud-backed -- mirroring Android's
  `hasCloudCopy` check -- and the click handler now:
  1. Requires the chef to be signed in; otherwise it blocks with a status
     message and keeps the local copy (deleting only the local half of a cloud
     recipe is exactly the bug being fixed).
  2. Confirms with the chef via `confirm()`, since this now permanently deletes
     the recipe from Community (media, likes, comments included) rather than
     just this device -- reusing the same `confirm()` pattern already used for
     blocking a chef.
  3. Runs the ownership preflight. A mismatched `authorId` or a failed preflight
     blocks the delete and keeps the local copy; a cloud doc that is already
     absent skips straight to local cleanup, exactly like Android's
     "already absent" branch.
  4. Calls `deleteChefVoiceRecipe(recipeId)` when the cloud doc exists and is
     owned by the signed-in chef. Server-side, `deleteRecipeArtifacts` deletes
     the `recipes/{uid}/{recipeId}/` and `privateVoice/{uid}/{recipeId}/`
     Storage prefixes, the likes/comments subcollections, and the Firestore doc
     itself.
  5. Only then falls through to the pre-existing local cleanup
     (`deleteAudioBlob`/`deleteRecipeMedia`/local array filter), unchanged.
- The 0.5.3 best-effort orphaned-private-audio cleanup is preserved as-is, now
  reached only through the `else` branch for a recipe that was truly never
  cloud-backed (no `isPublic`, no `authorId`).
- `recipesTemplate()`'s button now reads "Delete" instead of "Delete local" for
  any cloud-backed recipe, since it no longer only touches this device.

## What did not change

Cloud Functions (`deleteChefVoiceRecipe`, `deleteRecipeArtifacts`),
`storage.rules`, `firestore.rules`, the deterministic parser, Live/WebRTC, and
App Check (still monitoring-only) are all untouched. The Android app already had
the correct flow and was not touched.

## Verification

- `npm test` (`web/`): 95/95.
- `node tests/cook-wizard.dom.mjs`: 60/60, unaffected.
- `node tests/recipes-list.dom.mjs`: rewritten and expanded from 8 to 33 checks,
  covering: signed-out local-only delete (unaffected), signed-in unpublished
  orphan-audio cleanup (unaffected), a published+owned delete going through
  preflight then `deleteChefVoiceRecipe` then local cleanup, the button label
  change, signed-out-but-published being blocked entirely, a cancelled
  confirmation blocking everything, an `authorId` mismatch being blocked, a
  previously-published-then-unpublished recipe still routing through cloud
  deletion, an already-cloud-absent recipe skipping the callable but still
  cleaning up locally, and a failed preflight keeping the local copy.
- Not exercised in a real browser this pass -- no new screen, only a behavior
  change to an existing button's handler plus one new native `confirm()` prompt.

Cache/package version is 0.5.4.

## Deploy

```
DEPLOY_PWA.cmd
```

Reload/reopen the PWA after deployment to pick up cache version 0.5.4.
