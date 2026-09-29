/**
 * Private backup (audit F11) against the rules, for real. The PWA's own writeBackupCopy,
 * toCloudMap and listOwnRecipes are lifted out of web/js/firebase-client.js, which cannot be
 * imported here (it loads the Firebase SDK from gstatic), and run against the emulator, so the
 * transaction a backup makes is the one tested. Android's backup makes the same two writes with
 * the recipe map its publish already sends.
 *
 * Its own project id, like the backfill tests, so the suites beside it cannot clear its documents.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, collection, query, where, getDocs, runTransaction } = require("firebase/firestore");

const PROJECT_ID = "chefvoice-backup-test";
const RULES = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const CLIENT = fs.readFileSync(path.resolve(__dirname, "../web/js/firebase-client.js"), "utf8").replace(/\r\n/g, "\n");
const ALICE = "alice0000000000000000000001";
const BOB = "bob00000000000000000000000002";
const BUCKET = "https://firebasestorage.googleapis.com/v0/b/chefvoice-d7fec.firebasestorage.app/o/";

function slice(from, to) {
  const start = CLIENT.indexOf(from);
  const end = CLIENT.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `found ${from} in firebase-client.js`);
  return CLIENT.slice(start, end).replace(/^export /, "");
}
const SOURCE = [
  slice("async function writeBackupCopy(", "\n/**\n * Every recipe in the signed-in chef's account"),
  slice("export async function listOwnRecipes(", "\n/**\n * A recipe's original cooking audio"),
  slice("function toCloudMap(", "function normalizeProfile("),
].join("\n");

/**
 * The client's functions, bound to one signed-in chef's view of the emulator. Built in this
 * realm, not a vm context: the SDK refuses objects whose prototype is another realm's Object.
 */
const build = new Function(
  "db", "doc", "collection", "query", "where", "getDocs", "runTransaction", "crypto", "requireUser",
  `${SOURCE}\nreturn { writeBackupCopy, listOwnRecipes };`
);
function clientFor(uid) {
  const db = env.authenticatedContext(uid).firestore();
  const client = build(db, doc, collection, query, where, getDocs, runTransaction, crypto, () => ({ uid }));
  return { db, ...client };
}

const now = () => Date.now();
const photo = (i) => ({ id: `m${i}`, type: "IMAGE", url: `${BUCKET}${encodeURIComponent(`recipes/${ALICE}/bk-1/publicMedia/slot-0${i}`)}?alt=media&token=t${i}` });
/** A recipe as this browser keeps it, with the local-only fields a backup must not send. */
const localRecipe = (overrides = {}) => ({
  id: "bk-1", title: "Weeknight soup", description: "", servings: 2, prepTimeMinutes: 5, cookTimeMinutes: 20,
  ingredients: [{ id: "i1", quantity: "1", unit: "l", name: "stock" }], steps: ["Simmer."], tags: ["soup"],
  voiceClips: [], media: [], createdAt: now() - 60_000, updatedAt: now(), likes: 0, commentCount: 0,
  isPublic: false, authorId: ALICE, authorName: "Alice",
  transcript: [{ text: "simmer it" }], sessionAudio: { stored: true }, backedUpAt: 0, audioBackedUp: false,
  ...overrides,
});

/** What the account holds of a recipe: none of the fields that stay on the device. */
const cloudShape = ({ transcript, sessionAudio, backedUpAt, audioBackedUp, ...rest }) => rest;

let env;

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES } });
});
test.after(async () => { if (env) await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, name] of [[ALICE, "Alice"], [BOB, "Bob"]]) {
      await setDoc(doc(db, "users", uid), { displayName: name, bio: "", photoUrl: "", coverPhotoUrl: "", favoriteThings: [], createdAt: 1 });
    }
  });
});

async function seedRecipe(id, data) {
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "recipes", id), data));
}
async function stored(id) {
  let data = null;
  await env.withSecurityRulesDisabled(async (context) => { data = (await getDoc(doc(context.firestore(), "recipes", id))).data() || null; });
  return data;
}

test("a backup stages a new recipe privately, then finishes it with its photos", async () => {
  const alice = clientFor(ALICE);
  const recipe = localRecipe();
  assert.equal(await alice.writeBackupCopy({ ...recipe, updatedAt: now() }, false), "written");
  assert.equal(await alice.writeBackupCopy({ ...recipe, media: [photo(0), photo(1)], updatedAt: now() }, true), "written");
  const saved = await stored("bk-1");
  assert.equal(saved.isPublic, false);
  assert.equal(saved.authorId, ALICE);
  assert.equal(saved.createdAt, recipe.createdAt);
  assert.deepEqual(saved.media.map((m) => m.id), ["m0", "m1"]);
  // What stays on the device stays there: the cloud map is an allow-list.
  for (const local of ["transcript", "sessionAudio", "backedUpAt", "audioBackedUp"]) assert.equal(saved[local], undefined, local);
});

test("a backup stops at a recipe published meanwhile, and leaves it published", async () => {
  await seedRecipe("bk-1", { ...cloudShape(localRecipe()), isPublic: true, likes: 4 });
  const alice = clientFor(ALICE);
  assert.equal(await alice.writeBackupCopy(localRecipe(), false), "published");
  assert.equal(await alice.writeBackupCopy(localRecipe(), true), "published");
  const saved = await stored("bk-1");
  assert.equal(saved.isPublic, true);
  assert.equal(saved.likes, 4);
});

test("the write that finishes a backup does not bring back a recipe deleted meanwhile", async () => {
  const alice = clientFor(ALICE);
  assert.equal(await alice.writeBackupCopy(localRecipe(), true), "gone");
  assert.equal(await stored("bk-1"), null);
});

test("a backup keeps the account's counters and creation time, which the rules hold fixed", async () => {
  // Published once, liked and commented on, then unpublished: the account's numbers stand.
  const account = cloudShape(localRecipe({ createdAt: 1_000, likes: 3, commentCount: 2 }));
  await seedRecipe("bk-1", account);
  const alice = clientFor(ALICE);
  const onThisDevice = localRecipe({ title: "Weeknight soup, again", createdAt: now() - 5_000, likes: 0, commentCount: 0 });
  // Written as the device has them, the rules refuse it.
  await assertFails(setDoc(doc(alice.db, "recipes", "bk-1"), { ...account, title: onThisDevice.title, likes: 0, commentCount: 0, updatedAt: now() }));
  assert.equal(await alice.writeBackupCopy(onThisDevice, true), "written");
  const saved = await stored("bk-1");
  assert.equal(saved.title, "Weeknight soup, again");
  assert.equal(saved.createdAt, 1_000);
  assert.equal(saved.likes, 3);
  assert.equal(saved.commentCount, 2);
});

test("a chef lists every recipe in the account, private or published, and nobody else can", async () => {
  const alice = clientFor(ALICE);
  await alice.writeBackupCopy(localRecipe(), false);
  await seedRecipe("pub-1", { ...cloudShape(localRecipe({ id: "pub-1" })), isPublic: true });
  await seedRecipe("bob-1", { ...cloudShape(localRecipe({ id: "bob-1", authorId: BOB, authorName: "Bob" })), isPublic: true });
  const mine = await alice.listOwnRecipes();
  assert.deepEqual(mine.map((r) => r.id).sort(), ["bk-1", "pub-1"]);
  assert.equal(mine.find((r) => r.id === "bk-1").isPublic, false);

  const bob = clientFor(BOB);
  await assertFails(getDocs(query(collection(bob.db, "recipes"), where("authorId", "==", ALICE))));
  await assertFails(getDoc(doc(bob.db, "recipes", "bk-1")));
  // Nor can another chef's backup write over it: the transaction cannot even read it.
  await assert.rejects(bob.writeBackupCopy(localRecipe({ authorId: BOB, authorName: "Bob" }), true));
  assert.equal((await stored("bk-1")).authorId, ALICE);
});

test("the backup's writes go through only as the chef's own profile name", async () => {
  // profileNameMatches: a backup sends the name the rules check, as publishing does.
  const alice = clientFor(ALICE);
  await assert.rejects(alice.writeBackupCopy(localRecipe({ authorName: "Someone else" }), false));
  await assertSucceeds(alice.writeBackupCopy(localRecipe(), false));
});
