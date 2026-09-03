/**
 * Behavioral tests for firestore.rules, run against the Firestore emulator.
 *
 * The existing notifications/*.test.js gates match regular expressions against
 * source text. They cannot evaluate a rule, which is why a rule that rejected its
 * own client (profile updates) and an unreachable document path (user restrictions)
 * both passed 67/67 green. This suite evaluates the rules for real.
 *
 *   cd rules-tests
 *   npm install
 *   npm test
 *
 * npm test starts the emulator itself via `firebase emulators:exec`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, updateDoc, deleteDoc } = require("firebase/firestore");

const PROJECT_ID = "chefvoice-rules-test";
const RULES = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");

const ALICE = "alice0000000000000000000001";
const BOB = "bob00000000000000000000000002";

const DAY_MS = 24 * 60 * 60 * 1000;

let env;

function now() {
  return Date.now();
}

function profile(displayName, createdAt) {
  return {
    displayName,
    bio: "",
    photoUrl: "",
    coverPhotoUrl: "",
    favoriteThings: [],
    createdAt,
  };
}

function recipe(authorId, authorName, overrides = {}) {
  return {
    title: "Test recipe",
    description: "",
    servings: 2,
    ingredients: [],
    steps: [],
    isPublic: true,
    authorId,
    authorName,
    createdAt: now(),
    updatedAt: now(),
    likes: 0,
    commentCount: 0,
    ...overrides,
  };
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES },
  });
});

test.after(async () => {
  if (env) await env.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
  // Seed both profiles with a createdAt far in the past. A profile that is only
  // reachable when it is less than 24 hours old is exactly the bug this catches.
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", ALICE), profile("Alice", now() - 90 * DAY_MS));
    await setDoc(doc(db, "users", BOB), profile("Bob", now() - 90 * DAY_MS));
  });
});

// ---------------------------------------------------------------------------
// B3 - profile editing
// ---------------------------------------------------------------------------

test("an account older than 24 hours can still edit its profile", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(
    updateDoc(doc(db, "users", ALICE), {
      displayName: "Alice Cooks",
      bio: "Braises and stews.",
      favoriteThings: ["braising", "sourdough"],
    })
  );
});

test("a profile edit that also moves createdAt is denied", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    updateDoc(doc(db, "users", ALICE), {
      displayName: "Alice Cooks",
      createdAt: now(),
    })
  );
});

test("a profile edit cannot touch followerCount", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(updateDoc(doc(db, "users", ALICE), { followerCount: 9999 }));
});

test("nobody can edit another chef's profile", async () => {
  const db = env.authenticatedContext(BOB).firestore();
  await assertFails(updateDoc(doc(db, "users", ALICE), { displayName: "Hijacked" }));
});

test("a new profile must carry a fresh createdAt", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), "users", ALICE));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(setDoc(doc(db, "users", ALICE), profile("Alice", now() - 90 * DAY_MS)));
  await assertSucceeds(setDoc(doc(db, "users", ALICE), profile("Alice", now())));
});

// ---------------------------------------------------------------------------
// B1 / H1 - moderation restrictions actually take effect
// ---------------------------------------------------------------------------

test("an unrestricted chef can publish a recipe", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(setDoc(doc(db, "recipes", "recipe-1"), recipe(ALICE, "Alice")));
});

test("an active restriction blocks social writes", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "userRestrictions", ALICE), {
      active: true,
      expiresAt: 0,
    });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(setDoc(doc(db, "recipes", "recipe-2"), recipe(ALICE, "Alice")));
});

test("an expired restriction does not block social writes", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "userRestrictions", ALICE), {
      active: true,
      expiresAt: now() - 60_000,
    });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(setDoc(doc(db, "recipes", "recipe-3"), recipe(ALICE, "Alice")));
});

test("a lifted restriction does not block social writes", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "userRestrictions", ALICE), {
      active: false,
      expiresAt: 0,
    });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(setDoc(doc(db, "recipes", "recipe-4"), recipe(ALICE, "Alice")));
});

test("restriction and moderation-event records are closed to clients", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(getDoc(doc(db, "userRestrictions", ALICE)));
  await assertFails(setDoc(doc(db, "userRestrictions", ALICE), { active: false }));
  await assertFails(getDoc(doc(db, "moderationEvents", "any")));
  await assertFails(setDoc(doc(db, "moderationEvents", "any"), { note: "x" }));
});

// ---------------------------------------------------------------------------
// Recipe ownership and visibility
// ---------------------------------------------------------------------------

test("a recipe author name must match the trusted profile", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(setDoc(doc(db, "recipes", "recipe-5"), recipe(ALICE, "Somebody Else")));
});

test("nobody can edit another chef's recipe", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "recipes", "recipe-6"), recipe(ALICE, "Alice"));
  });
  const db = env.authenticatedContext(BOB).firestore();
  await assertFails(updateDoc(doc(db, "recipes", "recipe-6"), { title: "Stolen", updatedAt: now() }));
});

test("a private recipe is not readable by another chef", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), "recipes", "recipe-7"),
      recipe(ALICE, "Alice", { isPublic: false })
    );
  });
  await assertFails(getDoc(doc(env.authenticatedContext(BOB).firestore(), "recipes", "recipe-7")));
  await assertSucceeds(getDoc(doc(env.authenticatedContext(ALICE).firestore(), "recipes", "recipe-7")));
});

test("an owner cannot inflate their own like or comment counts", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "recipes", "recipe-8"), recipe(ALICE, "Alice"));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(updateDoc(doc(db, "recipes", "recipe-8"), { likes: 5000, updatedAt: now() }));
});

// ---------------------------------------------------------------------------
// Live signaling
// ---------------------------------------------------------------------------

test("only the host and the bound viewer can read a peer signaling document", async () => {
  const CAROL = "carol000000000000000000000003";
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", CAROL), profile("Carol", now() - DAY_MS));
    await setDoc(doc(db, "liveSessions", "live-1"), {
      hostId: ALICE,
      hostName: "Alice",
      title: "Sunday sauce",
      status: "LIVE",
      startedAt: now(),
      heartbeatAt: now(),
      endedAt: 0,
      heartCount: 0,
      fireCount: 0,
      clapCount: 0,
    });
    await setDoc(doc(db, "liveSessions", "live-1", "peers", BOB), {
      viewerUid: BOB,
      state: "JOINING",
      joinedAt: now(),
      updatedAt: now(),
    });
  });
  const peer = ["liveSessions", "live-1", "peers", BOB];
  await assertSucceeds(getDoc(doc(env.authenticatedContext(ALICE).firestore(), ...peer)));
  await assertSucceeds(getDoc(doc(env.authenticatedContext(BOB).firestore(), ...peer)));
  await assertFails(getDoc(doc(env.authenticatedContext(CAROL).firestore(), ...peer)));
});

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

test("a chef cannot send a message into a conversation they are not part of", async () => {
  const CAROL = "carol000000000000000000000003";
  const conversationId = `${ALICE}--${BOB}`;
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", CAROL), profile("Carol", now() - DAY_MS));
    await setDoc(doc(db, "conversations", conversationId), {
      participantIds: [ALICE, BOB],
      participantNames: { [ALICE]: "Alice", [BOB]: "Bob" },
      lastMessage: "",
      lastSenderId: "",
      createdAt: now(),
      updatedAt: now(),
    });
  });
  const message = { senderId: CAROL, senderName: "Carol", text: "hello", createdAt: now() };
  const db = env.authenticatedContext(CAROL).firestore();
  await assertFails(setDoc(doc(db, "conversations", conversationId, "messages", "m1"), message));
});
