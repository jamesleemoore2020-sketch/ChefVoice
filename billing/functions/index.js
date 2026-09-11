"use strict";

/**
 * ChefVoice launch-access entitlements (`chefvoice-billing`).
 *
 * A separate Functions codebase from `chefvoice-notifications`, deployed by its own
 * scoped script, because entitlement is the one security-relevant value in the app and
 * it should not share a deploy blast radius with social notifications.
 *
 * Two entitlement sources live here:
 *
 *   - Launch access, with no purchase involved: the first 10 signups get Pro free
 *     for 2 years (`source: "founding"`, `expiresAt: granted + 730d`); everyone
 *     after them gets Pro free for 90 days from signup (`source: "promo"`,
 *     `expiresAt: signup + 90d`). Both stop when the kill switch is thrown.
 *   - Real Google Play purchases (`source: "play"`), verified by
 *     `verifyChefVoicePurchase` right after purchase and kept in sync afterward by
 *     `processChefVoiceRtdn`, Play's real-time developer notifications.
 *
 * All of it lands in the same `users/{uid}/entitlements/pro` document, written only
 * by the Admin SDK -- clients cannot write it, and a `source: "play"` entitlement is
 * never touched by the launch-access kill switch below.
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldPath } = require("firebase-admin/firestore");
const { GoogleAuth, Impersonated } = require("google-auth-library");

initializeApp();
const db = getFirestore();

const REGION = "us-central1";

const PACKAGE_NAME = "com.chefvoice.app";
const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const ANDROID_PUBLISHER_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

/**
 * The dedicated service account granted "View financial data" and "Manage orders
 * and subscriptions" in Play Console, with no JSON key -- this project has
 * iam.disableServiceAccountKeyCreation, so it can only ever be used as a runtime
 * identity or an impersonation target, never a key file.
 *
 * verifyChefVoicePurchase runs *as* this identity directly, via its `serviceAccount`
 * option below, so plain Application Default Credentials resolve to it with no
 * extra code. processChefVoiceRtdn cannot do the same: it is a Pub/Sub (EventArc)
 * trigger, and giving a 2nd-gen EventArc trigger a custom runtime service account
 * has an open firebase-tools bug where deploy tries to grant the EventArc invoker
 * role to the project's default compute service account and fails outright if that
 * account has been removed or disabled -- see
 * github.com/firebase/firebase-tools/issues/6814 (still open) and the related
 * github.com/firebase/firebase-tools/issues/8841 for the same class of failure on
 * callable/request functions. So processChefVoiceRtdn stays on whatever default
 * identity Cloud Functions gives a Pub/Sub trigger in this project, and impersonates
 * this service account for just the one Android Publisher API call it needs (see
 * `impersonatedVerifierAuthClient`). That needs one manual one-time IAM grant: give
 * that default runtime identity the "Service Account Token Creator" role on this
 * service account. Both paths log their effective identity on every invocation
 * (see `logRuntimeIdentity`) specifically so a real deploy can be checked against
 * Cloud Logging rather than trusted on paper.
 */
const VERIFIER_SERVICE_ACCOUNT = "chefvoice-billing-verifier@chefvoice-d7fec.iam.gserviceaccount.com";

/** Must match the Pub/Sub topic wired to Real-time Developer Notifications in Play Console. */
const RTDN_TOPIC = "play-billing-rtdn";

/** The one Play Console subscription (two base plans) and the one managed product. */
const SUBSCRIPTION_PRODUCT_ID = "chefvoice_pro";
const LIFETIME_PRODUCT_ID = "chefvoice_pro_lifetime";

/**
 * These must match ProEntitlement.PRODUCT_MONTHLY / PRODUCT_ANNUAL in the Android
 * app's Models.kt exactly -- they are the app-facing productId the client compares
 * against (`isAnnual`), not a raw Play Console id. chefvoice_pro is one subscription
 * with two base plans ("monthly", "annual"); this backend is the one place that
 * translates a purchased base plan into that app-facing productId.
 */
const BASE_PLAN_TO_PRODUCT_ID = {
  monthly: "chefvoice_pro_monthly",
  annual: "chefvoice_pro_annual"
};

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
const STATUS_IN_GRACE = "in_grace";
const STATUS_ON_HOLD = "on_hold";
const STATUS_PAUSED = "paused";
const STATUS_EXPIRED = "expired";

const SOURCE_FOUNDING = "founding";
const SOURCE_PROMO = "promo";
const SOURCE_PLAY = "play";

/** Page size for the sweeps. Kept small; these run rarely and by hand. */
const SWEEP_PAGE = 200;

function configRef() {
  return db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC);
}

function entitlementRef(uid) {
  return db.collection("users").doc(uid).collection("entitlements").doc("pro");
}

/**
 * RTDN delivers a purchaseToken, never a uid -- Play has no idea what a Firebase
 * account is. verifyChefVoicePurchase records this mapping (using the authenticated
 * uid it already has) the moment a purchase is first verified, so the RTDN handler
 * has somewhere to look the uid up later.
 */
function purchaseTokenRef(token) {
  return db.collection("purchaseTokens").doc(token);
}

function adminAuthorized(request) {
  return request.auth?.token?.admin === true;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * Logs which service account a function actually ran as. The whole point of this
 * function existing is the "actually verify" step this identity setup demands --
 * see the comment on VERIFIER_SERVICE_ACCOUNT above -- so check Cloud Logging for
 * this line after the first real deploy of each function, rather than trusting the
 * `serviceAccount` option or the impersonation grant took effect on paper.
 */
async function logRuntimeIdentity(functionName) {
  try {
    const response = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
      { headers: { "Metadata-Flavor": "Google" } }
    );
    logger.info(`${functionName} runtime identity`, { email: (await response.text()).trim() });
  } catch (error) {
    logger.warn(`${functionName} could not read its own runtime identity`, { message: error.message });
  }
}

let cachedVerifierClient = null;
/** verifyChefVoicePurchase's own runtime identity IS VERIFIER_SERVICE_ACCOUNT, so plain ADC resolves to it. */
async function verifierAuthClient() {
  if (!cachedVerifierClient) {
    cachedVerifierClient = await new GoogleAuth({ scopes: [ANDROID_PUBLISHER_SCOPE] }).getClient();
  }
  return cachedVerifierClient;
}

let cachedImpersonatedClient = null;
/**
 * processChefVoiceRtdn's own runtime identity is the project's default Pub/Sub
 * trigger service account, not VERIFIER_SERVICE_ACCOUNT -- see the comment on
 * VERIFIER_SERVICE_ACCOUNT above for why. It impersonates VERIFIER_SERVICE_ACCOUNT
 * for this one API call instead, which requires that default identity to hold
 * "Service Account Token Creator" on VERIFIER_SERVICE_ACCOUNT (a one-time IAM
 * grant, not something this code can set up for itself).
 */
async function impersonatedVerifierAuthClient() {
  if (!cachedImpersonatedClient) {
    const sourceClient = await new GoogleAuth().getClient();
    cachedImpersonatedClient = new Impersonated({
      sourceClient,
      targetPrincipal: VERIFIER_SERVICE_ACCOUNT,
      targetScopes: [ANDROID_PUBLISHER_SCOPE],
      lifetime: 300
    });
  }
  return cachedImpersonatedClient;
}

async function fetchSubscriptionPurchase(purchaseToken, authClient) {
  const url = `${ANDROID_PUBLISHER_BASE}/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await authClient.request({ url, method: "GET" });
  return response.data;
}

async function fetchLifetimePurchase(purchaseToken, authClient) {
  const url = `${ANDROID_PUBLISHER_BASE}/${PACKAGE_NAME}/purchases/products/${LIFETIME_PRODUCT_ID}/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await authClient.request({ url, method: "GET" });
  return response.data;
}

/**
 * Maps a fresh purchases.subscriptionsv2.get response onto the entitlement shape.
 * Always re-derived from the live API response, never from an RTDN notificationType:
 * Play's own docs are explicit that a notification only signals "something changed
 * for this token", not what it changed to. `subscriptionState` is the one
 * authoritative field, which is also why this same function serves both
 * verifyChefVoicePurchase and every subscription RTDN notification type.
 */
function entitlementFromSubscription(data, now) {
  const lineItem = Array.isArray(data?.lineItems) ? data.lineItems[0] : null;
  const basePlanId = lineItem?.offerDetails?.basePlanId || "";
  const productId = BASE_PLAN_TO_PRODUCT_ID[basePlanId] || "";
  const expiresAtMs = lineItem?.expiryTime ? Date.parse(lineItem.expiryTime) : NaN;
  const autoRenewing = lineItem?.autoRenewingPlan?.autoRenewEnabled === true;
  const state = String(data?.subscriptionState || "");

  let status = STATUS_EXPIRED;
  if (state === "SUBSCRIPTION_STATE_ACTIVE") {
    status = STATUS_ACTIVE;
  } else if (state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") {
    status = STATUS_IN_GRACE;
  } else if (state === "SUBSCRIPTION_STATE_ON_HOLD") {
    status = STATUS_ON_HOLD;
  } else if (state === "SUBSCRIPTION_STATE_PAUSED") {
    status = STATUS_PAUSED;
  } else if (state === "SUBSCRIPTION_STATE_CANCELED") {
    // Canceled means auto-renew is off, not that access ended -- Play keeps a
    // subscriber through the period they already paid for.
    status = Number.isFinite(expiresAtMs) && expiresAtMs > now ? STATUS_ACTIVE : STATUS_EXPIRED;
  }
  // SUBSCRIPTION_STATE_EXPIRED, SUBSCRIPTION_STATE_PENDING and anything unrecognized
  // fail closed to STATUS_EXPIRED, matching ProEntitlement.isActive's own philosophy.

  if (!productId) {
    logger.warn("ChefVoice billing: unrecognized subscription base plan", { basePlanId, state });
  }

  return {
    status,
    productId,
    expiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : 0,
    autoRenewing,
    source: SOURCE_PLAY,
    updatedAt: now
  };
}

/** purchases.products.get's purchaseState is documented as an int (0 = purchased) on this older API surface. */
function entitlementFromLifetime(data, now) {
  const purchaseState = data?.purchaseState;
  const purchased = purchaseState === 0 || purchaseState === "0" || purchaseState === "PURCHASED";
  return {
    status: purchased ? STATUS_ACTIVE : STATUS_EXPIRED,
    productId: LIFETIME_PRODUCT_ID,
    expiresAt: 0, // Never expires -- ProEntitlement.isActive treats expiresAt 0 as "no expiry".
    autoRenewing: false,
    source: SOURCE_PLAY,
    updatedAt: now
  };
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

/**
 * Verifies a Play purchase the client just made and, if it is real and active,
 * writes the entitlement document. Called once right after BillingClient's
 * PurchasesUpdatedListener reports a PURCHASED state, before the client acknowledges
 * it -- this is the one and only place a client-reported purchase becomes something
 * the rest of the app trusts.
 *
 * Also records the purchaseToken -> uid mapping processChefVoiceRtdn depends on,
 * using request.auth.uid (never anything the client claims about itself), so a
 * purchase can only ever be attributed to the account that actually verified it.
 */
exports.verifyChefVoicePurchase = onCall(
  { region: REGION, serviceAccount: VERIFIER_SERVICE_ACCOUNT, enforceAppCheck: false, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    await logRuntimeIdentity("verifyChefVoicePurchase");
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const uid = request.auth.uid;
    const purchaseToken = cleanText(request.data?.purchaseToken, 4096);
    const productId = cleanText(request.data?.productId, 200);
    if (!purchaseToken) throw new HttpsError("invalid-argument", "Missing purchase token.");

    const authClient = await verifierAuthClient();
    const now = Date.now();

    let entitlement;
    try {
      if (productId === SUBSCRIPTION_PRODUCT_ID) {
        entitlement = entitlementFromSubscription(await fetchSubscriptionPurchase(purchaseToken, authClient), now);
      } else if (productId === LIFETIME_PRODUCT_ID) {
        entitlement = entitlementFromLifetime(await fetchLifetimePurchase(purchaseToken, authClient), now);
      } else {
        throw new HttpsError("invalid-argument", "Unrecognized ChefVoice product.");
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("ChefVoice purchase verification call failed", { uid, productId, message: error.message });
      throw new HttpsError("unavailable", "Could not verify this purchase with Google Play. Try again.");
    }

    // A verified-but-inactive purchase (already refunded, already expired) is not
    // an error -- it just grants nothing. The client stays on whatever entitlement
    // it already had.
    if (entitlement.status === STATUS_EXPIRED) {
      logger.info("ChefVoice purchase verified but not active", { uid, productId });
      return { ok: true, active: false };
    }

    await purchaseTokenRef(purchaseToken).set({ uid, productId, updatedAt: now }, { merge: true });
    await entitlementRef(uid).set(entitlement, { merge: true });

    logger.info("ChefVoice purchase verified", { uid, productId, status: entitlement.status });
    return { ok: true, active: true };
  }
);

/**
 * Keeps entitlement state in sync with Play in the background: renewals,
 * cancellations, refunds, grace periods, account holds and expirations all arrive
 * here, not through the app. Every branch re-fetches the purchase from the Android
 * Publisher API rather than trusting the notification payload, for the same reason
 * verifyChefVoicePurchase does -- see entitlementFromSubscription's comment.
 */
exports.processChefVoiceRtdn = onMessagePublished(
  { region: REGION, topic: RTDN_TOPIC, memory: "256MiB", timeoutSeconds: 60 },
  async (event) => {
    await logRuntimeIdentity("processChefVoiceRtdn");

    let notification;
    try {
      notification = event.data.message.json;
    } catch (error) {
      logger.error("ChefVoice RTDN: unreadable Pub/Sub message", { message: error.message });
      return;
    }

    const subscriptionNotification = notification?.subscriptionNotification;
    const oneTimeNotification = notification?.oneTimeProductNotification;
    const voidedNotification = notification?.voidedPurchaseNotification;
    if (!subscriptionNotification && !oneTimeNotification && !voidedNotification) {
      // testNotification (sent by Play Console's "Send test notification" button)
      // and any future notification type this handler does not know about yet.
      logger.info("ChefVoice RTDN: no actionable notification in payload", { notification });
      return;
    }

    const purchaseToken = (subscriptionNotification || oneTimeNotification || voidedNotification).purchaseToken;
    if (!purchaseToken) {
      logger.warn("ChefVoice RTDN: notification carried no purchase token", { notification });
      return;
    }

    const mapping = await purchaseTokenRef(purchaseToken).get();
    if (!mapping.exists) {
      // Only happens if verifyChefVoicePurchase never ran for this token, e.g. the
      // app was killed between purchase and verification. There is no uid to credit
      // yet -- queryPurchasesAsync on the client's next launch re-verifies it and
      // creates this mapping, so there is nothing safe to do here but log it.
      logger.warn("ChefVoice RTDN: no known uid for this purchase token yet", { purchaseToken });
      return;
    }
    const uid = mapping.data().uid;
    const now = Date.now();

    if (voidedNotification) {
      // A refund or chargeback. Play does not expect a Developer API round trip for
      // this one -- the notification itself is the authoritative signal to revoke.
      await entitlementRef(uid).set(
        { status: STATUS_EXPIRED, expiresAt: now, autoRenewing: false, source: SOURCE_PLAY, updatedAt: now },
        { merge: true }
      );
      logger.info("ChefVoice RTDN: purchase voided", { uid, purchaseToken });
      return;
    }

    let entitlement;
    try {
      const authClient = await impersonatedVerifierAuthClient();
      entitlement = subscriptionNotification
        ? entitlementFromSubscription(await fetchSubscriptionPurchase(purchaseToken, authClient), now)
        : entitlementFromLifetime(await fetchLifetimePurchase(purchaseToken, authClient), now);
    } catch (error) {
      // Pub/Sub retries a thrown error, which is exactly what should happen here --
      // a transient Android Publisher API failure must not silently leave
      // entitlement stale.
      logger.error("ChefVoice RTDN: purchase re-verification failed", { uid, purchaseToken, message: error.message });
      throw error;
    }

    await entitlementRef(uid).set(entitlement, { merge: true });
    logger.info("ChefVoice RTDN processed", {
      uid,
      purchaseToken,
      notificationType: subscriptionNotification?.notificationType ?? oneTimeNotification?.notificationType,
      status: entitlement.status
    });
  }
);
