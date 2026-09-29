# Account and recipe deletion that scale with the account, not the platform (0.5.21 batch)

Audit finding **F17**, in the `chefvoice-notifications` codebase, `firestore.rules` and
`firestore.indexes.json`. Committed on `claude/audit-implementation-2026-09-28-e6a4a5`. **Nothing is
deployed yet**, and the order matters (see the end). The apps are unchanged.

## The problem

Deleting one recipe paged through **every user** on ChefVoice, to remove bookmarks of it saved before
bookmarks carried their recipe's id. Deleting an account paged through every user again (to remove
other chefs' blocks of it) and through **every recipe** (to remove its likes), and repeated the
per-recipe walk for each of its recipes. About recipes × users + users + recipes operations, inside a
540-second timeout. It works at today's size, and would start timing out half-done as ChefVoice grows.

## The fix

Each walk exists only for documents older than a field or a rule that now makes them findable
directly (`notifications/functions/deletion-indexes.js`):

- **Blocks** carry `blockedUid`, which the rules require, so a collection-group query finds every block
  of an account. `firestore.indexes.json` gains that query's index.
- **Bookmarks** carry `recipeId`, also required, and were already found that way.
- **Likes** are two documents written together, the recipe's and the chef's own mirror. The rules now
  also **keep the mirror while the recipe's half exists** (both apps unlike in one write, which passes),
  so the mirrors list every like.

A new admin-only callable, **`backfillChefVoiceDeletionIndexes`**, gives the older documents those
fields and mirrors once: blocks without `blockedUid`, bookmarks without `recipeId`, likes without a
mirror. It is resumable and idempotent. Each call works for up to eight minutes, saves its place in
`config/deletionIndexes` (closed to clients both ways), and says whether it has finished. When every
phase has, it records `backfilledAt`, and from then on deletion **skips the walks by itself**. Until
then they still run, so deploying first loses nothing.

## Tests

- **Notification gates 91 / 0** (78 before): `notifications/functions/deletion-indexes.test.js` runs
  the decisions (7), and `notifications/deletion-scans.test.js` (6) pins the rest in source: each walk
  stops only once retired, the blocks query comes first, deletion asks once and passes it on, the
  backfill is admin-only and records its finish only when done, the index, and the rule.
  `production-trust.test.js` now says the recipe sweep lasts until the backfill.
- **Rules emulator**: two new tests. Liking writes both halves together, and neither half alone.
  A mirror cannot be deleted while the recipe keeps the like, unliking both at once passes, and an
  orphaned mirror can always go. The mirror test **failed on the old rules** before the change.
- **`rules-tests/deletion-backfill.test.js`** runs the real callable against the Firestore emulator
  through firebase-functions' `.run`. It checks that only an admin can run it and that a refusal writes
  nothing. It fixes 305 legacy blocks across a page boundary, one bookmark and one missing mirror. It
  leaves documents that had their fields untouched and never turns a mirror into a like. It records the
  finish, and a second call changes nothing. It runs in its own emulator project, because the rules
  suite beside it clears its own. Five breaks of the callable were each caught: no admin check,
  the finish never recorded, blocks never fixed, mirrors made without checking for one, and a
  finished backfill running again.
- **Rules emulator 71 / 0** (66 before): the two rules tests and the three backfill tests.
- CI's rules job and `RUN_RULES_GATES.cmd` install `notifications/functions`' dependencies for it.

## To release, in this order

1. **`DEPLOY_FIRESTORE_INDEXES.cmd`**, for the `blocks.blockedUid` collection-group index. Without it
   the new blocks query fails, and with it account deletion.
2. **`DEPLOY_COMMUNITY_RULES.cmd`** after diffing the console's live rules against the last deployed
   version: this adds one condition to the like mirror's delete rule. It runs the rules gates first.
3. **`DEPLOY_NOTIFICATIONS.cmd`**.
4. Then, once, as an admin, until it answers `done: true`:

   ```
   firebase functions:shell --project chefvoice-d7fec
   > backfillChefVoiceDeletionIndexes({}, {auth: {uid: '<your-uid>', token: {admin: true}}})
   ```

   Its answer counts what it fixed. `config/deletionIndexes` in the console shows the same.

The backfill must come after step 2. Before the rule, a custom client could delete a like's mirror and
keep the like, and once the walks have stopped nothing would find that like at account deletion.
