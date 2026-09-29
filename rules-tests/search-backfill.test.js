/**
 * Chef search tokens (audit F10) against the Firestore emulator: the real syncChefSearchTokens
 * trigger and backfillChefVoiceSearchTokens callable from notifications/functions/index.js, run
 * through firebase-functions' own `.run`, with the Admin SDK pointed at the emulator.
 *
 * Its own project id, like deletion-backfill.test.js, so the suites beside it cannot clear its
 * documents. notifications/functions must have its dependencies installed (npm ci there).
 */

const PROJECT_ID = "chefvoice-search-test";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID });

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run this with npm test, which starts the Firestore emulator");

const functionsDir = path.resolve(__dirname, "../notifications/functions");
const functions = require(path.join(functionsDir, "index.js"));
const { chefSearchTokens } = require(path.join(functionsDir, "search-tokens.js"));
const { getFirestore } = require(require.resolve("firebase-admin/firestore", { paths: [functionsDir] }));
const db = getFirestore();

const asAdmin = { auth: { uid: "admin-1", token: { admin: true } }, data: {} };
const profile = (displayName, extra = {}) => ({
  displayName, bio: "", photoUrl: "", coverPhotoUrl: "", favoriteThings: [], createdAt: 1, ...extra
});

async function seed(entries) {
  for (let start = 0; start < entries.length; start += 400) {
    const batch = db.batch();
    for (const [docPath, data] of entries.slice(start, start + 400)) batch.set(db.doc(docPath), data);
    await batch.commit();
  }
}

/** Runs the trigger as Firestore would after a write to this profile. */
async function afterWrite(uid) {
  const after = await db.doc(`users/${uid}`).get();
  await functions.syncChefSearchTokens.run({ data: { before: null, after }, params: { uid } });
}

test("the functions under test talk to this file's own emulator project", () => {
  assert.equal(db.projectId, PROJECT_ID);
});

test("a saved profile gets its tokens, a rename replaces them, and an unchanged one is not rewritten", async () => {
  await seed([["users/chef-a", profile("DaPlug", { favoriteThings: ["Ramen"] })]]);
  await afterWrite("chef-a");
  let tokens = (await db.doc("users/chef-a").get()).get("searchTokens");
  assert.deepEqual(tokens, chefSearchTokens({ displayName: "DaPlug", favoriteThings: ["Ramen"] }));
  assert.ok(tokens.includes("plug") && tokens.includes("ramen"));

  await db.doc("users/chef-a").update({ displayName: "Mary Berry" });
  await afterWrite("chef-a");
  tokens = (await db.doc("users/chef-a").get()).get("searchTokens");
  assert.ok(tokens.includes("berry") && !tokens.includes("plug"), "a rename drops the old name's tokens");

  // Its own write fires the trigger again; that run must find nothing to do, or it would loop.
  const before = (await db.doc("users/chef-a").get()).updateTime;
  await afterWrite("chef-a");
  assert.ok((await db.doc("users/chef-a").get()).updateTime.isEqual(before), "an up-to-date profile is not written");
});

test("only an admin can run the search backfill", async () => {
  await assert.rejects(functions.backfillChefVoiceSearchTokens.run({ auth: { uid: "chef-1", token: {} }, data: {} }), /admin access is required/);
  await assert.rejects(functions.backfillChefVoiceSearchTokens.run({ data: {} }), /admin access is required/);
  assert.equal((await db.doc("config/searchTokens").get()).exists, false);
});

test("the backfill gives every earlier profile its tokens, across pages, then says it is done", async () => {
  const earlier = Array.from({ length: 305 }, (_, i) => [`users/early-${String(i).padStart(3, "0")}`, profile(`Chef Number${i}`)]);
  await seed([
    ...earlier,
    ["users/current", profile("Bo", { searchTokens: chefSearchTokens({ displayName: "Bo" }) })],
    ["users/stale", profile("New Name", { searchTokens: ["ol", "old"] })]
  ]);
  const result = await functions.backfillChefVoiceSearchTokens.run(asAdmin);
  assert.equal(result.done, true);
  // chef-a from the test above is already current, so only the earlier and stale ones change.
  assert.equal(result.updated, 306);
  const found = await db.collection("users").where("searchTokens", "array-contains", "number304").get();
  assert.deepEqual(found.docs.map((d) => d.id), ["early-304"]);
  assert.ok((await db.doc("users/stale").get()).get("searchTokens").includes("new"));
  assert.ok((await db.doc("config/searchTokens").get()).get("backfilledAt") > 0);
  const again = await functions.backfillChefVoiceSearchTokens.run(asAdmin);
  assert.equal(again.done, true);
  assert.equal(again.updated, 306);
});
