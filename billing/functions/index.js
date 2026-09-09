"use strict";

/**
 * ChefVoice launch-access entitlements (`chefvoice-billing`).
 *
 * A separate Functions codebase from `chefvoice-notifications`, deployed by its own
 * scoped script, because entitlement is the one security-relevant value in the app and
 * it should not share a deploy blast radius with social notifications. When Play
 * Billing lands, `verifyChefVoicePurchase` and the real-time developer notification
 * handler belong here too, beside `writeEntitlement`.
 *
 * What this grants today, with no Play Billing anywhere in the picture:
 *
 *   - The first 10 signups get Pro free for 2 years
 *     (`source: "founding"`, `expiresAt: granted + 730d`).
 *   - Everyone after them gets Pro free for 90 days from signup
 *     (`source: "promo"`, `expiresAt: signup + 90d`).
 *   - Both stop when the kill switch is thrown.
 *
 * Nothing here fakes a purchase. These are real entitlement documents written by the
 * Admin SDK, which is exactly how a verified Play purchase will be written later, so
 * the whole entitlement path is exercised end to end before any money moves.
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldPath } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const REGION = "us-central1";

/** Seats awarded the long free window, in signup order. */
const FOUNDING_SEATS = 10;

/**
 * The founding window. Two years expressed as a flat 730 days rather than calendar
 * arithmetic: a fixed millisecond span cannot land on a leap day, a DST boundary or a
 * month with no 31st, and every one of those is a way to compute an expiry that is
 * off by a day for one chef and not another.
 */
const FOUNDING_DAYS = 730;
const FOUNDING_MS = FOUNDING_DAYS * 24 * 60 * 60 * 1000;

/** Free Pro window for everyone after the founding seats, from their signup. */
const PROMO_DAYS = 90;
const PROMO_MS = PROMO_DAYS * 24 * 60 * 60 * 1000;

const CONFIG_COLLECTION = "config";
const CONFIG_DOC = "monetization";

const STATUS_ACTIVE = "active";
const STATUS_EXPIRED = "expired";

const SOURCE_FOUNDING = "founding";
const SOURCE_PROMO = "promo";

/** Page size for the sweeps. Kept small; these run rarely and by hand. */
const SWEEP_PAGE = 200;

function configRef() {
  return db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC);
}

function entitlementRef(uid) {
  return db.collection("users").doc(uid).collection("entitlements").doc("pro");
}

function adminAuthorized(request) {
  return request.auth?.token?.admin === true;
}

/**
 * Absent config means the promo is running. This is deliberate: the codebase deploys
 * and works with no manual Firestore setup, and the kill switch is what creates the
 * document. A missing config document must never mean "grant nothing", or a failed
 * console edit would silently switch the promo off.
 */
function readConfig(snapshot) {
  const data = (snapshot && snapshot.exists && snapshot.data()) || {};
  const seats = Number(data.foundingSeats);
  return {
    promoEnabled: data.promoEnabled !== false,
    foundingSeats: Number.isFinite(seats) && seats >= 0 ? seats : FOUNDING_SEATS,
    foundingSeatsClaimed: Number(data.foundingSeatsClaimed || 0)
  };
}

function entitlementFor(founding, signupAt, now) {
  return {
    status: STATUS_ACTIVE,
    productId: "",
    // A founding window runs from the grant, not from signup. The trigger fires
    // within moments of signup so the two are the same thing for a new account --
    // but the backfill grants seats to people who signed up before this code
    // existed, and dating their two years from a signup months in the past would
    // quietly shorten the reward for exactly the chefs it is meant to thank.
    // The 90-day promo does run from signup: it is a trial window, not a thank-you.
    expiresAt: founding ? now + FOUNDING_MS : (signupAt || now) + PROMO_MS,
    autoRenewing: false,
    source: founding ? SOURCE_FOUNDING : SOURCE_PROMO,
    grantedAt: now,
    updatedAt: now
  };
}

/**
 * Grants launch access when a profile document is created.
 *
 * `signUp` writes `users/{uid}` immediately after `createUserWithEmailAndPassword`, so
 * this fires once per real signup. It is triggered on the profile document rather than
 * on Auth user creation because a blocking Auth trigger would sit in the signup
 * critical path, and a failure there would break account creation itself. A missed
 * grant is recoverable by `backfillChefVoiceLaunchAccess`; a broken signup is not.
 */
exports.grantChefVoiceLaunchAccess = onDocumentCreated(
  { region: REGION, document: "users/{uid}" },
  async (event) => {
    const uid = event.params.uid;
    if (!uid) return;
    const signupAt = Number(event.data?.data()?.createdAt || 0);

    try {
      const outcome = await db.runTransaction(async (tx) => {
        const cfgRef = configRef();
        const entRef = entitlementRef(uid);
        // All reads before any write: Firestore transactions require it.
        const [cfgSnap, entSnap] = await Promise.all([tx.get(cfgRef), tx.get(entRef)]);

        // Never overwrite an entitlement that already exists. A real Play purchase
        // must always win over a promotional grant, and a retried trigger must not
        // reset someone's clock or re-spend a founding seat.
        if (entSnap.exists) return "already_entitled";

        const config = readConfig(cfgSnap);
        if (!config.promoEnabled) return "promo_closed";

        const founding = config.foundingSeatsClaimed < config.foundingSeats;
        const now = Date.now();
        tx.set(entRef, entitlementFor(founding, signupAt, now));

        // The seat count is only advanced inside the same transaction that granted
        // the seat, so two simultaneous signups cannot both take seat 10.
        if (founding) {
          tx.set(
            cfgRef,
            { foundingSeatsClaimed: config.foundingSeatsClaimed + 1, updatedAt: now },
            { merge: true }
          );
        }
        return founding ? SOURCE_FOUNDING : SOURCE_PROMO;
      });

      logger.info("ChefVoice launch access evaluated", { uid, outcome });
    } catch (error) {
      // A failed grant must not fail the signup path. It is recoverable by backfill.
      logger.error("ChefVoice launch access grant failed", { uid, message: error.message });
    }
  }
);

/**
 * Grants launch access to accounts that predate this codebase.
 *
 * The trigger above only fires for new profile documents, so anyone who signed up
 * before it deployed has no entitlement. Founding seats are awarded in real signup
 * order, oldest `createdAt` first, so "the first 10 signups" stays true for people who
 * signed up before the code that promises it existed.
 *
 * Deliberately ordered in memory rather than with `orderBy("createdAt")`: a Firestore
 * orderBy silently excludes documents missing the field, and early profile documents
 * may not all carry `createdAt`. Skipping exactly the oldest accounts would be the
 * worst possible failure for a founding-seat sweep.
 */
exports.backfillChefVoiceLaunchAccess = onCall(
  { region: REGION, enforceAppCheck: false, timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    if (!adminAuthorized(request)) {
      throw new HttpsError("permission-denied", "ChefVoice admin access is required.");
    }

    const users = [];
    let cursor = null;
    while (true) {
      let query = db.collection("users").orderBy(FieldPath.documentId()).limit(SWEEP_PAGE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      page.docs.forEach((doc) => {
        users.push({ uid: doc.id, createdAt: Number(doc.data()?.createdAt || 0) });
      });
      cursor = page.docs[page.docs.length - 1];
      if (page.size < SWEEP_PAGE) break;
    }

    // Oldest first. Accounts with no createdAt sort to the front, which is correct:
    // a missing createdAt means the document predates the field being written.
    users.sort((a, b) => a.createdAt - b.createdAt);

    let granted = 0;
    let skipped = 0;
    for (const user of users) {
      const outcome = await db.runTransaction(async (tx) => {
        const cfgRef = configRef();
        const entRef = entitlementRef(user.uid);
        const [cfgSnap, entSnap] = await Promise.all([tx.get(cfgRef), tx.get(entRef)]);
        if (entSnap.exists) return "already_entitled";

        const config = readConfig(cfgSnap);
        if (!config.promoEnabled) return "promo_closed";

        const founding = config.foundingSeatsClaimed < config.foundingSeats;
        const now = Date.now();
        tx.set(entRef, entitlementFor(founding, user.createdAt, now));
        if (founding) {
          tx.set(
            cfgRef,
            { foundingSeatsClaimed: config.foundingSeatsClaimed + 1, updatedAt: now },
            { merge: true }
          );
        }
        return founding ? SOURCE_FOUNDING : SOURCE_PROMO;
      });
      if (outcome === SOURCE_FOUNDING || outcome === SOURCE_PROMO) granted += 1;
      else skipped += 1;
    }

    const config = readConfig(await configRef().get());
    logger.info("ChefVoice launch access backfilled", { granted, skipped });
    return {
      ok: true,
      granted,
      skipped,
      foundingSeatsClaimed: config.foundingSeatsClaimed,
      foundingSeats: config.foundingSeats
    };
  }
);

/**
 * The kill switch. Two levels, because they are genuinely different promises.
 *
 * Default (soft): stops all new grants. Anyone already inside their 90 days keeps it
 * until it runs out on its own. This is the honest default -- someone told "Pro free
 * for 90 days" was told a thing, and ending it early because a price list changed is
 * a broken promise for a rounding error of revenue.
 *
 * `revokeActive: true` (hard): also expires every live 90-day promo immediately. Use
 * it when the giveaway itself has to stop, not merely stop growing.
 *
 * Founding seats are never touched by either. Those two years were promised outright,
 * so a founding grant survives the switch, a price change and the arrival of Play
 * Billing, and runs out only on its own clock. A `source: "play"` entitlement is never
 * touched either -- this function must never be able to revoke something a person
 * paid for.
 */
exports.endChefVoiceLaunchPromo = onCall(
  { region: REGION, enforceAppCheck: false, timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    if (!adminAuthorized(request)) {
      throw new HttpsError("permission-denied", "ChefVoice admin access is required.");
    }

    const revokeActive = request.data?.revokeActive === true;
    const now = Date.now();

    await configRef().set(
      { promoEnabled: false, promoClosedAt: now, updatedAt: now },
      { merge: true }
    );

    let revoked = 0;
    if (revokeActive) {
      // Walks users and reads each entitlement directly rather than running a
      // collection-group query on `source`. That query would need a COLLECTION_GROUP
      // field override deployed before it worked, and an undeployed index override is
      // exactly what broke account deletion in 0.10.5. This needs no index at all, and
      // it runs once, by hand.
      let cursor = null;
      while (true) {
        let query = db.collection("users").orderBy(FieldPath.documentId()).limit(SWEEP_PAGE);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        if (page.empty) break;

        const refs = page.docs.map((doc) => entitlementRef(doc.id));
        const snaps = await db.getAll(...refs);
        const batch = db.batch();
        let batched = 0;
        snaps.forEach((snap) => {
          if (!snap.exists) return;
          const source = snap.data()?.source;
          // Founding grants and real purchases are out of scope, always.
          if (source !== SOURCE_PROMO) return;
          batch.set(
            snap.ref,
            { status: STATUS_EXPIRED, expiresAt: now, updatedAt: now },
            { merge: true }
          );
          batched += 1;
        });
        if (batched > 0) {
          await batch.commit();
          revoked += batched;
        }

        cursor = page.docs[page.docs.length - 1];
        if (page.size < SWEEP_PAGE) break;
      }
    }

    logger.info("ChefVoice launch promo closed", { revokeActive, revoked, by: request.auth.uid });
    return { ok: true, promoEnabled: false, revokeActive, revoked };
  }
);
