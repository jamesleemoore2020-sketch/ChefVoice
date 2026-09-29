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
const {
  doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, limit, getDocs
} = require("firebase/firestore");

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

test("a recipe can be published with freeform tags", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(
    setDoc(doc(db, "recipes", "recipe-9"), recipe(ALICE, "Alice", { tags: ["bbq", "camping"] }))
  );
});

test("a recipe rejects more than 8 tags", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  const tooMany = Array.from({ length: 9 }, (_, i) => `tag${i}`);
  await assertFails(setDoc(doc(db, "recipes", "recipe-10"), recipe(ALICE, "Alice", { tags: tooMany })));
});

test("a recipe rejects tags that are not a list", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(setDoc(doc(db, "recipes", "recipe-11"), recipe(ALICE, "Alice", { tags: "bbq" })));
});

test("an owner can update their recipe's tags", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "recipes", "recipe-12"), recipe(ALICE, "Alice", { tags: ["bbq"] }));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(
    updateDoc(doc(db, "recipes", "recipe-12"), { tags: ["bbq", "camping"], updatedAt: now() })
  );
});

// ---------------------------------------------------------------------------
// Live sessions
// ---------------------------------------------------------------------------

function liveSession(hostId, hostName, overrides = {}) {
  return {
    hostId,
    hostName,
    title: "Test live",
    status: "LIVE",
    startedAt: now(),
    heartbeatAt: now(),
    endedAt: 0,
    heartCount: 0,
    fireCount: 0,
    clapCount: 0,
    ...overrides,
  };
}

test("a live session can be started with tags", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(
    setDoc(doc(db, "liveSessions", "live-tags-1"), liveSession(ALICE, "Alice", { tags: ["italian", "baking"] }))
  );
});

test("a live session rejects more than 8 tags", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  const tooMany = Array.from({ length: 9 }, (_, i) => `tag${i}`);
  await assertFails(setDoc(doc(db, "liveSessions", "live-tags-2"), liveSession(ALICE, "Alice", { tags: tooMany })));
});

test("a live session rejects tags that are not a list", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(setDoc(doc(db, "liveSessions", "live-tags-3"), liveSession(ALICE, "Alice", { tags: "italian" })));
});

test("a host cannot change tags after going live", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "liveSessions", "live-tags-4"), liveSession(ALICE, "Alice", { tags: ["italian"] }));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    updateDoc(doc(db, "liveSessions", "live-tags-4"), { tags: ["italian", "baking"], heartbeatAt: now() })
  );
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

// Pro entitlement is server-authoritative. These are the tests the monetization
// design leans on: if a signed-in client can write its own entitlement document,
// the paywall is decorative and a modified APK unlocks Pro for free.
test("a signed-in chef can read their own Pro entitlement", async () => {
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "users", ALICE, "entitlements", "pro"), {
      status: "active",
      productId: "chefvoice_pro_monthly",
      expiresAt: now() + 30 * DAY_MS,
      autoRenewing: true,
      source: "play",
      updatedAt: now(),
    });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(getDoc(doc(db, "users", ALICE, "entitlements", "pro")));
});

test("a signed-in chef cannot grant themselves a Pro entitlement", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    setDoc(doc(db, "users", ALICE, "entitlements", "pro"), {
      status: "active",
      productId: "chefvoice_pro_annual",
      expiresAt: now() + 365 * DAY_MS,
      autoRenewing: true,
      source: "play",
      updatedAt: now(),
    })
  );
});

test("a chef cannot extend or delete an entitlement written by the backend", async () => {
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "users", ALICE, "entitlements", "pro"), {
      status: "expired",
      productId: "chefvoice_pro_monthly",
      expiresAt: now() - DAY_MS,
      autoRenewing: false,
      source: "play",
      updatedAt: now(),
    });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    updateDoc(doc(db, "users", ALICE, "entitlements", "pro"), { status: "active" })
  );
  await assertFails(deleteDoc(doc(db, "users", ALICE, "entitlements", "pro")));
});

test("a chef cannot read another chef's entitlement", async () => {
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "users", BOB, "entitlements", "pro"), {
      status: "active",
      productId: "chefvoice_pro_monthly",
      expiresAt: now() + 30 * DAY_MS,
      autoRenewing: true,
      source: "play",
      updatedAt: now(),
    });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(getDoc(doc(db, "users", BOB, "entitlements", "pro")));
});

test("purchase records holding Play tokens are not client-writable", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    setDoc(doc(db, "users", ALICE, "purchases", "token-abc"), {
      purchaseToken: "forged",
      productId: "chefvoice_pro_annual",
      acknowledged: true,
    })
  );
});

// Launch access: the first 10 signups get Pro for life and everyone after gets 90
// free days, both written by the chefvoice-billing Admin SDK. The founding seat
// counter and the promo kill switch live in config/monetization, which the client
// must not be able to read or write -- a writable counter mints founding seats, and
// a readable one leaks how many accounts exist.
test("a signed-in chef cannot write the launch access config", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    setDoc(doc(db, "config", "monetization"), {
      promoEnabled: true,
      foundingSeats: 10000,
      foundingSeatsClaimed: 0,
    })
  );
});

test("a signed-in chef cannot read the launch access config", async () => {
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "config", "monetization"), {
      promoEnabled: true,
      foundingSeats: 10,
      foundingSeatsClaimed: 3,
      updatedAt: now(),
    });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(getDoc(doc(db, "config", "monetization")));
});

test("a chef cannot forge a founding entitlement for themselves", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    setDoc(doc(db, "users", ALICE, "entitlements", "pro"), {
      status: "active",
      productId: "",
      expiresAt: 0,
      autoRenewing: false,
      source: "founding",
      grantedAt: now(),
      updatedAt: now(),
    })
  );
});

test("a chef on a 90-day promo cannot extend their own expiry", async () => {
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "users", ALICE, "entitlements", "pro"), {
      status: "active",
      productId: "",
      expiresAt: now() + 90 * DAY_MS,
      autoRenewing: false,
      source: "promo",
      grantedAt: now(),
      updatedAt: now(),
    });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    updateDoc(doc(db, "users", ALICE, "entitlements", "pro"), {
      expiresAt: now() + 3650 * DAY_MS,
    })
  );
});

// Regression: the PWA's saveUserProfile wrote only displayName, bio, photoUrl and
// createdAt. validUserProfileShape uses hasAll, so the create was rejected and the
// account ended up with no profile document -- which then broke every write the
// rules check with profileNameMatches (comments, replies, publishing, messaging).
// The chef only ever saw "your chef profile is still loading".
test("a profile create missing coverPhotoUrl and favoriteThings is rejected", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), "users", ALICE));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    setDoc(doc(db, "users", ALICE), {
      displayName: "Alice",
      bio: "",
      photoUrl: "",
      createdAt: now(),
    })
  );
  // The same write with the two missing keys present is accepted, which is the
  // whole difference between a working account and one with no profile at all.
  await assertSucceeds(setDoc(doc(db, "users", ALICE), profile("Alice", now())));
});

test("a profile update may not move createdAt", async () => {
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "users", ALICE), profile("Alice", now() - 90 * DAY_MS));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  // What the client did when the profile had not loaded: a fresh timestamp.
  await assertFails(setDoc(doc(db, "users", ALICE), profile("Alice Renamed", now()), { merge: true }));
});

test("a profile update preserving the stored createdAt succeeds", async () => {
  const createdAt = now() - 90 * DAY_MS;
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "users", ALICE), profile("Alice", createdAt));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(setDoc(doc(db, "users", ALICE), profile("Alice Renamed", createdAt), { merge: true }));
});

test("a chef cannot raise their own follower count through a profile write", async () => {
  const createdAt = now() - 90 * DAY_MS;
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "users", ALICE), { ...profile("Alice", createdAt), followerCount: 3 });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertFails(
    setDoc(doc(db, "users", ALICE), { ...profile("Alice", createdAt), followerCount: 9999 }, { merge: true })
  );
});

// ---------------------------------------------------------------------------
// Hardening (audit F23): photos, videos and profile pictures only from ChefVoice's
// own Storage, replies that name who they answer truthfully, bounded reports, Live
// chat only while live, and recipe authors and Live hosts can clear comments in
// their own space.
// ---------------------------------------------------------------------------

const CAROL = "carol000000000000000000000003";
const BUCKET = "https://firebasestorage.googleapis.com/v0/b/chefvoice-d7fec.firebasestorage.app/o/";

// A download URL as getDownloadURL (web) and downloadUrl (Android) return it.
function storageUrl(objectPath) {
  return `${BUCKET}${encodeURIComponent(objectPath)}?alt=media&token=0b2f6a8e-4c1d-4f5e-9a7b-2c3d4e5f6a7b`;
}

function mediaList(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    type: "IMAGE",
    url: storageUrl(`recipes/${ALICE}/r/publicMedia/slot-${String(i).padStart(2, "0")}`),
  }));
}

function voiceList(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `v${i}`,
    label: `Chef voice ${i + 1}`,
    createdAt: now(),
    url: storageUrl(`recipes/${ALICE}/r/voice/clip-${String(i).padStart(2, "0")}`),
  }));
}

// URLs that must never be accepted where a Storage download URL is expected.
const OUTSIDE_URLS = [
  "https://evil.example/pixel.png",
  "http://firebasestorage.googleapis.com/v0/b/chefvoice-d7fec.firebasestorage.app/o/x?alt=media",
  "https://firebasestorage.googleapis.com/v0/b/another-project.appspot.com/o/x?alt=media",
  "https://firebasestorage.googleapis.com.evil.example/v0/b/chefvoice-d7fec.firebasestorage.app/o/x",
  `${BUCKET}x/../../another-project.appspot.com/o/pixel`,
  // A browser reads a backslash in an https URL as a slash.
  `${BUCKET}..\\..\\another-project.appspot.com\\o\\pixel`,
  `${BUCKET}x?alt=media#https://evil.example/`,
];

async function denied(promise, what) {
  try {
    await assertFails(promise);
  } catch (error) {
    throw new Error(`${what}: ${error.message}`);
  }
}

test("recipe photos and videos must be download URLs from ChefVoice's own Storage", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(setDoc(doc(db, "recipes", "media-1"), recipe(ALICE, "Alice", { media: mediaList(3) })));
  // Android adds stepId and caption to each item.
  await assertSucceeds(
    setDoc(doc(db, "recipes", "media-2"), recipe(ALICE, "Alice", { media: [{ ...mediaList(1)[0], stepId: "s1", caption: "" }] }))
  );
  for (const url of [...OUTSIDE_URLS, ""]) {
    await denied(setDoc(doc(db, "recipes", "media-3"), recipe(ALICE, "Alice", { media: [{ id: "m0", type: "IMAGE", url }] })), url || "empty url");
  }
  await denied(setDoc(doc(db, "recipes", "media-3"), recipe(ALICE, "Alice", { media: [{ id: "m0", type: "IMAGE" }] })), "no url");
});

test("every photo and video slot is checked, up to the 24 Storage allows", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(setDoc(doc(db, "recipes", "slots-1"), recipe(ALICE, "Alice", { media: mediaList(24) })));
  await denied(setDoc(doc(db, "recipes", "slots-2"), recipe(ALICE, "Alice", { media: mediaList(25) })), "25 photos");
  // The last slot is checked as closely as the first.
  const media = mediaList(24);
  media[23] = { ...media[23], url: OUTSIDE_URLS[0] };
  await denied(setDoc(doc(db, "recipes", "slots-3"), recipe(ALICE, "Alice", { media })), "an outside URL in slot 23");
});

// Firestore stops evaluating a request at 1,000 expressions and denies it. The costliest
// write either app makes is Android's publish: a set() over the staged recipe, going public,
// with every photo, video and voice-clip slot filled at once and every optional field set.
// Checking voice clips as well pushed exactly this write over the limit, which is why the
// rules check photos and videos only.
test("the largest recipe Android can publish still fits the rules' budget", async () => {
  const createdAt = now() - DAY_MS;
  const largest = (overrides = {}) => recipe(ALICE, "Alice", {
    title: "T".repeat(180),
    description: "D".repeat(5000),
    servings: 12,
    prepTimeMinutes: 30,
    cookTimeMinutes: 240,
    ingredients: Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, quantity: "2", unit: "tablespoons", name: `ingredient ${i}` })),
    steps: Array.from({ length: 300 }, (_, i) => `Step ${i}: stir and taste.`),
    stepIds: Array.from({ length: 300 }, (_, i) => `s${i}`),
    tags: ["a", "b", "c", "d", "e", "f", "g", "h"],
    isPublic: false,
    createdAt,
    ...overrides,
  });
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "recipes", "largest"), largest());
  });
  const db = env.authenticatedContext(ALICE).firestore();
  const everySlot = {
    isPublic: true,
    media: mediaList(24).map((item, i) => ({ ...item, stepId: `s${i}`, caption: "Plated and ready" })),
    voiceClips: voiceList(16),
  };
  await assertSucceeds(setDoc(doc(db, "recipes", "largest"), largest(everySlot)));
  await assertSucceeds(setDoc(doc(db, "recipes", "largest-new"), largest(everySlot)));
});

test("a recipe whose media predates the check stays editable, but gains no outside media", async () => {
  const legacy = [{ id: "old", type: "IMAGE", url: "https://legacy.example/photo.jpg" }];
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "recipes", "legacy-1"), recipe(ALICE, "Alice", { media: legacy }));
    await setDoc(doc(db, "recipes", "legacy-2"), recipe(ALICE, "Alice", { media: legacy }));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(updateDoc(doc(db, "recipes", "legacy-1"), { title: "Renamed", updatedAt: now() }));
  await assertSucceeds(updateDoc(doc(db, "recipes", "legacy-1"), { isPublic: false, updatedAt: now() }));
  await denied(
    updateDoc(doc(db, "recipes", "legacy-2"), { media: [...legacy, ...mediaList(1)], updatedAt: now() }),
    "changing media while an outside URL remains"
  );
  await assertSucceeds(updateDoc(doc(db, "recipes", "legacy-2"), { media: mediaList(1), updatedAt: now() }));
});

test("a profile photo or cover is empty or from ChefVoice's own Storage", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(updateDoc(doc(db, "users", ALICE), { photoUrl: storageUrl(`profiles/${ALICE}/avatar/profile.jpg`) }));
  await assertSucceeds(updateDoc(doc(db, "users", ALICE), { coverPhotoUrl: storageUrl(`profiles/${ALICE}/cover/profile.jpg`) }));
  await assertSucceeds(updateDoc(doc(db, "users", ALICE), { photoUrl: "", coverPhotoUrl: "" }));
  for (const url of OUTSIDE_URLS) {
    await denied(updateDoc(doc(db, "users", ALICE), { photoUrl: url }), `photoUrl ${url}`);
    await denied(updateDoc(doc(db, "users", ALICE), { coverPhotoUrl: url }), `coverPhotoUrl ${url}`);
  }
  const carol = env.authenticatedContext(CAROL).firestore();
  await denied(setDoc(doc(carol, "users", CAROL), { ...profile("Carol", now()), photoUrl: OUTSIDE_URLS[0] }), "a new profile with an outside photo");
  await assertSucceeds(setDoc(doc(carol, "users", CAROL), profile("Carol", now())));
});

test("a profile edit keeps a photo URL saved before the check", async () => {
  const createdAt = now() - 90 * DAY_MS;
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", ALICE), { ...profile("Alice", createdAt), photoUrl: "https://legacy.example/me.jpg" });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  // Both clients send the stored photo URL back with every profile save.
  await assertSucceeds(
    setDoc(doc(db, "users", ALICE), { ...profile("Alice", createdAt), bio: "Braises.", photoUrl: "https://legacy.example/me.jpg" }, { merge: true })
  );
});

function commentByBob() {
  return { authorId: BOB, authorName: "Bob", text: "Lovely.", createdAt: now() };
}

function replyToBob(overrides = {}) {
  return {
    authorId: ALICE,
    authorName: "Alice",
    text: "Thank you!",
    createdAt: now(),
    parentCommentId: "c1",
    replyToUid: BOB,
    replyToName: "Bob",
    ...overrides,
  };
}

test("a reply names the chef it answers exactly as their comment does", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "recipes", "reply-1"), recipe(ALICE, "Alice"));
    await setDoc(doc(db, "recipes", "reply-1", "comments", "c1"), commentByBob());
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(setDoc(doc(db, "recipes", "reply-1", "comments", "r1"), replyToBob()));
  await denied(setDoc(doc(db, "recipes", "reply-1", "comments", "r2"), replyToBob({ replyToName: "The ChefVoice team" })), "a made-up name");
  await denied(setDoc(doc(db, "recipes", "reply-1", "comments", "r3"), replyToBob({ replyToName: "B".repeat(121) })), "a 121-character name");
  // Bob renames himself. His comment still carries the name he had, and so do replies to it:
  // checking against his current profile name instead would refuse every reply to his old comments.
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "users", BOB), { displayName: "Robert" });
  });
  await assertSucceeds(setDoc(doc(db, "recipes", "reply-1", "comments", "r4"), replyToBob()));
});

test("a top-level comment cannot claim to be a reply", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "recipes", "reply-2"), recipe(BOB, "Bob"));
  });
  const db = env.authenticatedContext(ALICE).firestore();
  const comment = { authorId: ALICE, authorName: "Alice", text: "Great.", createdAt: now() };
  await assertSucceeds(setDoc(doc(db, "recipes", "reply-2", "comments", "t1"), comment));
  await denied(setDoc(doc(db, "recipes", "reply-2", "comments", "t2"), { ...comment, replyToName: "Bob" }), "replyToName without a parent");
  await denied(setDoc(doc(db, "recipes", "reply-2", "comments", "t3"), { ...comment, replyToUid: BOB }), "replyToUid without a parent");
});

test("a report's target and context fields are bounded", async () => {
  const db = env.authenticatedContext(ALICE).firestore();
  const report = {
    reporterUid: ALICE,
    targetType: "recipe",
    targetId: "r1",
    targetUid: BOB,
    contextId: "r1",
    reason: "Spam",
    createdAt: now(),
    status: "open",
  };
  // Both clients cut these to 180 characters before writing.
  await assertSucceeds(
    setDoc(doc(db, "reports", "rep-1"), { ...report, targetId: "t".repeat(180), targetUid: "u".repeat(180), contextId: "c".repeat(180) })
  );
  for (const field of ["targetId", "targetUid", "contextId"]) {
    await denied(setDoc(doc(db, "reports", `rep-${field}`), { ...report, [field]: "x".repeat(181) }), `a 181-character ${field}`);
  }
});

test("Live chat is open only while the broadcast is live", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "liveSessions", "chat-live"), liveSession(ALICE, "Alice"));
    await setDoc(doc(db, "liveSessions", "chat-ended"), liveSession(ALICE, "Alice", { status: "ENDED", heartbeatAt: 0, endedAt: now() }));
    // The host's app stopped renewing its lease five minutes ago.
    await setDoc(doc(db, "liveSessions", "chat-stale"), liveSession(ALICE, "Alice", { heartbeatAt: now() - 5 * 60 * 1000 }));
  });
  const db = env.authenticatedContext(BOB).firestore();
  const comment = { authorId: BOB, authorName: "Bob", text: "Smells great", createdAt: now() };
  await assertSucceeds(setDoc(doc(db, "liveSessions", "chat-live", "comments", "l1"), comment));
  await denied(setDoc(doc(db, "liveSessions", "chat-ended", "comments", "l1"), comment), "chat on an ended broadcast");
  await denied(setDoc(doc(db, "liveSessions", "chat-stale", "comments", "l1"), comment), "chat on a stale broadcast");
});

test("a recipe's author can clear comments on it, and nobody else can", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", CAROL), profile("Carol", now() - DAY_MS));
    await setDoc(doc(db, "recipes", "mod-1"), recipe(ALICE, "Alice"));
    await setDoc(doc(db, "recipes", "mod-1", "comments", "c1"), commentByBob());
    await setDoc(doc(db, "recipes", "mod-1", "comments", "c2"), commentByBob());
    await setDoc(doc(db, "recipes", "mod-2"), recipe(BOB, "Bob"));
    await setDoc(doc(db, "recipes", "mod-2", "comments", "c1"), { ...commentByBob(), authorId: CAROL, authorName: "Carol" });
  });
  const alice = env.authenticatedContext(ALICE).firestore();
  const bob = env.authenticatedContext(BOB).firestore();
  const carol = env.authenticatedContext(CAROL).firestore();
  await denied(deleteDoc(doc(carol, "recipes", "mod-1", "comments", "c1")), "a third chef clearing a comment");
  await assertSucceeds(deleteDoc(doc(alice, "recipes", "mod-1", "comments", "c1")));
  await assertSucceeds(deleteDoc(doc(bob, "recipes", "mod-1", "comments", "c2")));
  await denied(deleteDoc(doc(alice, "recipes", "mod-2", "comments", "c1")), "clearing a comment on someone else's recipe");
});

test("a Live host can clear chat in their room, and nobody else can", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", CAROL), profile("Carol", now() - DAY_MS));
    await setDoc(doc(db, "liveSessions", "room-1"), liveSession(ALICE, "Alice"));
    await setDoc(doc(db, "liveSessions", "room-1", "comments", "l1"), commentByBob());
    await setDoc(doc(db, "liveSessions", "room-1", "comments", "l2"), commentByBob());
    await setDoc(doc(db, "liveSessions", "room-2"), liveSession(ALICE, "Alice", { status: "ENDED", heartbeatAt: 0, endedAt: now() }));
    await setDoc(doc(db, "liveSessions", "room-2", "comments", "l1"), commentByBob());
  });
  const alice = env.authenticatedContext(ALICE).firestore();
  const bob = env.authenticatedContext(BOB).firestore();
  const carol = env.authenticatedContext(CAROL).firestore();
  await denied(deleteDoc(doc(carol, "liveSessions", "room-1", "comments", "l1")), "a viewer clearing someone else's chat");
  await assertSucceeds(deleteDoc(doc(alice, "liveSessions", "room-1", "comments", "l1")));
  await assertSucceeds(deleteDoc(doc(bob, "liveSessions", "room-1", "comments", "l2")));
  // Clearing up after the broadcast has ended.
  await assertSucceeds(deleteDoc(doc(alice, "liveSessions", "room-2", "comments", "l1")));
});

test("liking writes both halves of a like together", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", ALICE), profile("Alice", now() - DAY_MS));
    await setDoc(doc(db, "recipes", "like-create-1"), recipe(BOB, "Bob"));
  });
  const alice = env.authenticatedContext(ALICE).firestore();
  const createdAt = now();
  // One half on its own is refused either way round: each rule checks the other half exists.
  await denied(setDoc(doc(alice, "recipes", "like-create-1", "likes", ALICE), { createdAt }), "a like with no mirror");
  await denied(setDoc(doc(alice, "users", ALICE, "likes", "like-create-1"), { createdAt }), "a mirror with no like");
  const batch = writeBatch(alice);
  batch.set(doc(alice, "recipes", "like-create-1", "likes", ALICE), { createdAt });
  batch.set(doc(alice, "users", ALICE, "likes", "like-create-1"), { createdAt });
  await assertSucceeds(batch.commit());
});

test("a like's mirror goes with the recipe's half, never before it", async () => {
  // Account deletion finds a chef's likes through their own mirrors (audit F17), so a like
  // whose mirror had been deleted first would outlive the account.
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", ALICE), profile("Alice", now() - DAY_MS));
    await setDoc(doc(db, "recipes", "like-delete-1"), recipe(BOB, "Bob"));
    await setDoc(doc(db, "recipes", "like-delete-1", "likes", ALICE), { createdAt: now() });
    await setDoc(doc(db, "users", ALICE, "likes", "like-delete-1"), { createdAt: now() });
    await setDoc(doc(db, "users", ALICE, "likes", "like-delete-orphan"), { createdAt: now() });
  });
  const alice = env.authenticatedContext(ALICE).firestore();
  await denied(deleteDoc(doc(alice, "users", ALICE, "likes", "like-delete-1")), "deleting a mirror while the recipe keeps the like");
  // Unliking as both apps do it: the two halves in one write.
  const batch = writeBatch(alice);
  batch.delete(doc(alice, "recipes", "like-delete-1", "likes", ALICE));
  batch.delete(doc(alice, "users", ALICE, "likes", "like-delete-1"));
  await assertSucceeds(batch.commit());
  // A mirror whose recipe half is already gone can always go.
  await assertSucceeds(deleteDoc(doc(alice, "users", ALICE, "likes", "like-delete-orphan")));
});

test("a profile the backend gave search tokens can still be saved by its chef", async () => {
  // syncChefSearchTokens adds searchTokens to every profile (audit F10). Both apps save a profile
  // with a merge, so the stored tokens are part of what the rule sees on the next save.
  const createdAt = now() - DAY_MS;
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", ALICE), { ...profile("Alice", createdAt), searchTokens: ["al", "ali", "alic", "alice"] });
  });
  const alice = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(setDoc(doc(alice, "users", ALICE), { ...profile("Alice", createdAt), bio: "Soups" }, { merge: true }));
});

test("a chef cannot write their own search tokens", async () => {
  // Carol has no profile yet (only Alice and Bob are seeded), so these are real creates.
  const carol = env.authenticatedContext(CAROL).firestore();
  await denied(setDoc(doc(carol, "users", CAROL), { ...profile("Carol", now()), searchTokens: ["gordon"] }), "a new profile with search tokens");
  // The same profile without them is a valid create: the refusal above is the tokens.
  await assertSucceeds(setDoc(doc(carol, "users", CAROL), profile("Carol", now())));
  const alice = env.authenticatedContext(ALICE).firestore();
  const createdAt = now() - DAY_MS;
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", ALICE), { ...profile("Alice", createdAt), searchTokens: ["al", "alice"] });
  });
  await denied(updateDoc(doc(alice, "users", ALICE), { searchTokens: ["gordon", "ramsay"] }), "changing the search tokens");
  await denied(setDoc(doc(alice, "users", ALICE), { ...profile("Alice", createdAt), searchTokens: ["gordon"] }, { merge: true }), "saving a profile with other tokens");
});

test("chefs are found by one query on their search tokens", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", ALICE), { ...profile("DaPlug", now() - DAY_MS), searchTokens: ["da", "pl", "plu", "plug"] });
    await setDoc(doc(db, "users", BOB), { ...profile("Bob", now() - DAY_MS), searchTokens: ["bo", "bob"] });
  });
  const bob = env.authenticatedContext(BOB).firestore();
  const found = await assertSucceeds(getDocs(query(collection(bob, "users"), where("searchTokens", "array-contains", "plug"), limit(30))));
  assert.deepEqual(found.docs.map((d) => d.id), [ALICE]);
  // Signed out, the directory stays closed, as it was.
  const nobody = env.unauthenticatedContext().firestore();
  await denied(getDocs(query(collection(nobody, "users"), where("searchTokens", "array-contains", "plug"))), "searching signed out");
});

test("the import counter is closed to clients", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "importUsage", ALICE), { count: 1 });
  });
  const db = env.authenticatedContext(ALICE).firestore();
  await denied(getDoc(doc(db, "importUsage", ALICE)), "reading the import counter");
  await denied(setDoc(doc(db, "importUsage", ALICE), { count: 0 }), "resetting the import counter");
});
