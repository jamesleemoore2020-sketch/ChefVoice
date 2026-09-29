/**
 * backfillChefVoiceDeletionIndexes (audit F17) against the Firestore emulator: the real callable
 * from notifications/functions/index.js, through firebase-functions' own test entry point
 * (`.run`), with the Admin SDK pointed at the emulator by `firebase emulators:exec`.
 *
 * It uses its own project id, so its documents never meet firestore-rules.test.js's, which runs
 * alongside it. notifications/functions must have its dependencies installed (npm ci there).
 */

// Both, because emulators:exec sets FIREBASE_CONFIG to the rules suite's project and the Admin SDK
// prefers it; sharing that project let the rules suite's clearFirestore() empty this one mid-test.
const PROJECT_ID = "chefvoice-deletion-test";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID });

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run this with npm test, which starts the Firestore emulator");

const functionsDir = path.resolve(__dirname, "../notifications/functions");
const functions = require(path.join(functionsDir, "index.js"));
// The same Admin SDK instance the functions use, not a second copy of it.
const { getFirestore } = require(require.resolve("firebase-admin/firestore", { paths: [functionsDir] }));
const db = getFirestore();

const backfill = functions.backfillChefVoiceDeletionIndexes;
const asAdmin = { auth: { uid: "admin-1", token: { admin: true } }, data: {} };

/** Writes many documents in batches of at most 400. */
async function seed(entries) {
  for (let start = 0; start < entries.length; start += 400) {
    const batch = db.batch();
    for (const [docPath, data] of entries.slice(start, start + 400)) batch.set(db.doc(docPath), data);
    await batch.commit();
  }
}

test("the functions under test talk to this file's own emulator project", () => {
  assert.equal(db.projectId, PROJECT_ID);
});

test("only an admin can run the backfill", async () => {
  await assert.rejects(backfill.run({ auth: { uid: "chef-1", token: {} }, data: {} }), /admin access is required/);
  await assert.rejects(backfill.run({ auth: { uid: "mod-1", token: { moderator: true } }, data: {} }), /admin access is required/);
  await assert.rejects(backfill.run({ data: {} }), /admin access is required/);
  assert.equal((await db.doc("config/deletionIndexes").get()).exists, false, "a refused call writes nothing");
});

test("the backfill gives older documents what deletion finds them by, then retires the walks", async () => {
  const legacyBlocks = Array.from({ length: 305 }, (_, i) => [`users/blocker-${String(i).padStart(3, "0")}/blocks/target-1`, { createdAt: 1 }]);
  await seed([
    ...legacyBlocks,
    ["users/alice/blocks/bob", { blockedUid: "bob", createdAt: 2 }],
    ["users/alice/bookmarks/recipe-old", { createdAt: 3 }],
    ["users/alice/bookmarks/recipe-new", { recipeId: "recipe-new", createdAt: 4 }],
    ["recipes/recipe-1", { title: "Soup", authorId: "carol", isPublic: true }],
    ["recipes/recipe-1/likes/alice", { createdAt: 500 }],
    ["recipes/recipe-1/likes/bob", { createdAt: 600 }],
    ["users/bob/likes/recipe-1", { createdAt: 600 }],
    ["users/dave/likes/recipe-gone", { createdAt: 700 }]
  ]);

  const result = await backfill.run(asAdmin);
  assert.equal(result.done, true);
  assert.deepEqual(result.fixed, { blocks: 305, bookmarks: 1, likes: 1 });
  assert.ok(result.backfilledAt > 0);

  // Blocks, across the page boundary: every legacy one now says whom it blocks.
  const blocks = await db.collectionGroup("blocks").where("blockedUid", "==", "target-1").get();
  assert.equal(blocks.size, 305);
  assert.equal((await db.doc("users/alice/blocks/bob").get()).get("createdAt"), 2, "a block that had the field is untouched");
  // Bookmarks: the old one is now found by its recipe, the new one kept as it was.
  assert.equal((await db.doc("users/alice/bookmarks/recipe-old").get()).get("recipeId"), "recipe-old");
  assert.equal((await db.doc("users/alice/bookmarks/recipe-old").get()).get("createdAt"), 3);
  // Likes: the missing mirror exists, with the like's own time; nothing else changed.
  assert.equal((await db.doc("users/alice/likes/recipe-1").get()).get("createdAt"), 500);
  assert.equal((await db.doc("users/bob/likes/recipe-1").get()).get("createdAt"), 600);
  assert.equal((await db.doc("recipes/recipe-gone/likes/dave").get()).exists, false, "a mirror is never turned into a like");

  const state = (await db.doc("config/deletionIndexes").get()).data();
  assert.ok(state.backfilledAt > 0, "deletion now skips the walks");
  assert.deepEqual(state.cursors, { blocks: "done", bookmarks: "done", likes: "done" });

  // Once finished, a second call does nothing and says so.
  await seed([["users/erin/blocks/frank", { createdAt: 9 }]]);
  const again = await backfill.run(asAdmin);
  assert.equal(again.done, true);
  assert.equal(again.backfilledAt, state.backfilledAt);
  assert.equal((await db.doc("users/erin/blocks/frank").get()).get("blockedUid"), undefined);
});
