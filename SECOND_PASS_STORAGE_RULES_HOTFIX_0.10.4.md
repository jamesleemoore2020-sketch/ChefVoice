# ChefVoice — Second Pass storage-rules ownership hotfix (v0.10.4 line)

Follow-up to `DEVICE_VERIFICATION_FIXES_0.10.3.md`. That pass fixed
`authorizeChefVoiceStorageUpload` (the Cloud Function that issues the upload
*permit*) to stop requiring a Firestore `recipes/{id}` doc for unpublished
Cook & Capture recipes. Deploying that fix (`DEPLOY_NOTIFICATIONS.cmd`, run
today after being unshipped since the prior day's commit) was not enough —
Second Pass still failed on-device with:

```
StorageException: User does not have permission to access this object.
Code: -13021 HttpResult: 403
```

## Root cause

The permit only authorizes the upload request; the actual object write to
Firebase Storage is separately gated by `storage.rules`. Its
`recipeOwnedBy(uid, recipeId)` function unconditionally read
`firestore.get(.../recipes/{recipeId}).data.authorId`, which throws (and
denies) when the document doesn't exist — exactly the never-published-recipe
case the Cloud Function fix was for. The two ownership checks had drifted:
the callable was fixed, the security rule enforcing the same invariant on
the actual file write was not.

## Fix

Added `privateRecipeOwnedBy(uid, recipeId)` in `storage.rules`, used only by
the two genuinely-private paths Second Pass writes to —
`recipes/{uid}/{recipeId}/voice/{fileName}` and
`privateVoice/{uid}/{recipeId}/{fileName}` — mirroring the callable's logic:
allow when no `recipes/{id}` doc exists yet, block only when one exists and
belongs to someone else. Both paths are already scoped to the caller's own
`uid`, so a missing doc carries no ownership ambiguity.

`recipeOwnedBy` itself is untouched and still requires an existing,
caller-owned recipe doc for `publicMedia` (published Community media) and
the legacy `media/` delete path — those genuinely should never exist without
a backing Firestore recipe.

Updated `notifications/production-trust.test.js`'s
`recipe media and private audio require an existing recipe owned by the
signer` test, which asserted the exact strict behavior being relaxed here,
into two tests: one keeping the strict assertion for `publicMedia`, one
covering the new `privateRecipeOwnedBy` relaxation for `voice/`/`privateVoice/`.

## Deploy note

This is a Storage security-rules change — it has no effect until deployed
with:

```
firebase deploy --only storage --project chefvoice-d7fec
```

There is no wrapper `.cmd` for this (only `firestore:rules` has one via
`DEPLOY_COMMUNITY_RULES.cmd`). Deployed and verified via
`firebase deploy --only storage` in this pass; confirmed on-device (sideloaded
debug v0.10.4 build) that Second Pass on an unpublished recipe completes with
no `StorageException` in logcat.

## What did not change

App code, `firestore.rules`, Cloud Functions, App Check enforcement
(still monitoring-only), and the WebRTC dependency from the prior
`WEBRTC_JNI_ONLOAD_CRASH_0.10.4.md` pass are all untouched.
