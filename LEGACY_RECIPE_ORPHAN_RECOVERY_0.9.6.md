# ChefVoice Android v0.9.6 — Legacy Recipe Orphan Recovery

## Fix

A legacy local recipe can still be marked public even after its corresponding `recipes/{recipeId}` Firestore document has already been removed. Android v0.9.5 correctly refused to remove the local copy when the cloud delete returned `PERMISSION_DENIED`, but that left an orphan recipe impossible to delete or unpublish.

v0.9.6 adds a read-only cloud preflight before recipe delete/unpublish. If the expected cloud document is confirmed absent, ChefVoice treats Community removal as already complete and allows the owner to delete the local recipe or keep it private. If a cloud document exists, its `authorId` must still match the signed-in user before any cloud mutation is attempted.

## Rules scope

The recipe read rule is split into `get` and `list`. A signed-in single-document `get` may resolve a missing recipe path so the client can receive a clean not-found result. Existing private recipes remain owner-only and collection/query (`list`) access is unchanged. Recipe create/update/delete ownership rules are unchanged.

## Protected architecture

No parser, Second Pass, Storage, IAM, App Check, notification, Live transport, or cooking-capture behavior is changed.
