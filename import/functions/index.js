"use strict";

// The `chefvoice-import` Cloud Functions codebase: one callable that reads a recipe from a web
// address on the chef's behalf.
//
// **Why this exists at all.** On Android the phone fetches the page itself. A browser cannot:
// it refuses to read another site's page from a script, so the PWA has no way to do what the
// app does without something fetching on its behalf. That something is this function, and
// nothing else. It is deployed on its own, exactly like `chefvoice-notifications` and
// `chefvoice-billing`, so it can never take the speech function or the notification triggers
// down with it.
//
// **What it deliberately is not.** It is not a page proxy. It never returns the page it
// fetched: it returns a recipe draft, or it returns why there wasn't one. Nothing a caller
// asks for can make it hand back arbitrary content from a site, which is what keeps an
// authenticated fetch endpoint from being a general-purpose reading tool for the internal
// network or for anyone's paywalled page.
//
// Every safety rule lives in recipe-url.js and page-fetcher.js and is documented there.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { importFrom } = require("./recipe-importer");
const RecipeUrl = require("./recipe-url");

initializeApp();
const db = getFirestore();

const REGION = "us-central1";
/**
 * A day's worth of imports for one chef. Generous for cooking, mean for scraping: without a
 * cap, any account is a free fetch-anything proxy. The counter lives in a top-level
 * `importUsage` collection, which `firestore.rules` never matches and therefore denies to
 * every client in both directions -- only this Admin SDK can see or change it, so no rules
 * deploy was needed to add it.
 */
const DAILY_LIMIT = 30;
const USAGE_COLLECTION = "importUsage";
const RATE_LIMITED =
  "You've imported a lot of recipes today. Try again tomorrow, or narrate this one with ChefVoice.";

const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/**
 * Counts this import against the chef's day and says whether it may go ahead. Counted before
 * the fetch, not after, so a chef cannot spend the network by asking for pages that fail.
 */
async function claimImportSlot(uid, now = Date.now()) {
  const today = dayKey(now);
  const ref = db.collection(USAGE_COLLECTION).doc(uid);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const count = data.day === today ? Number(data.count || 0) : 0;
    if (count >= DAILY_LIMIT) return false;
    transaction.set(ref, { day: today, count: count + 1, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

exports.importChefVoiceRecipe = onCall({ region: REGION, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const uid = request.auth?.uid;
  // Signed in, always. An unauthenticated fetch endpoint is a public proxy, and the chef has
  // to be signed in to save the result anyway.
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to import a recipe from a web address.");

  const link = String(request.data?.url ?? "").trim();
  if (!link) return { ok: false, message: RecipeUrl.NOT_A_LINK };
  if (link.length > 4096) return { ok: false, message: RecipeUrl.NOT_A_LINK };

  let allowed;
  try {
    allowed = await claimImportSlot(uid);
  } catch (error) {
    logger.error("import: could not record usage", { uid, error: error?.message });
    throw new HttpsError("internal", "ChefVoice couldn't start that import. Try again in a moment.");
  }
  if (!allowed) return { ok: false, message: RATE_LIMITED };

  const result = await importFrom(link);
  if (result.failed) {
    // The address is logged without the chef: useful for spotting a site that changed its
    // markup, and not a record of who reads what.
    logger.info("import: nothing saved", { host: RecipeUrl.displayHost(link), reason: result.failed });
    return { ok: false, message: result.failed };
  }
  return {
    ok: true,
    recipe: result.recipe,
    notes: result.notes,
    host: result.host,
    sourceUrl: result.sourceUrl
  };
});
