// Ported from app/src/main/java/com/chefvoice/app/analytics/ChefAnalytics.kt.
//
// Three rules this module holds to, same as the Android original:
//
// 1. It never throws and never blocks. Every call is wrapped and every failure is
//    swallowed. The rule that entitlement checks must not stop someone cooking
//    applies to telemetry with more force, not less.
// 2. It is a no-op when Firebase Analytics is unavailable -- a CDN outage, a
//    blocked measurement endpoint, or a browser with storage disabled must not
//    break local cooking capture.
// 3. No personal or recipe content leaves the device. Parameters are enums,
//    booleans and counters only -- never a recipe title, transcript, ingredient,
//    display name, email or uid.
//
// `install` is deliberately not emitted: Firebase Analytics logs `first_open`
// automatically with campaign attribution, and a custom duplicate would
// double-count installs in every funnel built on it.

// ---- Activation funnel ------------------------------------------------------
export const FIRST_RECIPE_STARTED = 'first_recipe_started';
export const FIRST_RECIPE_COMPLETED = 'first_recipe_completed';
export const SECOND_RECIPE_COMPLETED = 'second_recipe_completed';

// ---- Second Pass ------------------------------------------------------------
export const SECOND_PASS_OPENED = 'second_pass_opened';
export const SECOND_PASS_ACCEPTED = 'second_pass_accepted';

// ---- Paywall ----------------------------------------------------------------
export const PAYWALL_SHOWN = 'paywall_shown';
export const PAYWALL_DISMISSED = 'paywall_dismissed';

// ---- Billing ----------------------------------------------------------------
// Declared but not yet emitted: there is no billing integration in the PWA. The
// names are fixed now so the event vocabulary does not drift when it lands.
export const CHECKOUT_STARTED = 'checkout_started';
export const PURCHASE_COMPLETED = 'purchase_completed';
export const SUBSCRIPTION_CANCELLED = 'subscription_cancelled';
export const BILLING_FAILURE = 'billing_failure';

// ---- Parameters -------------------------------------------------------------
export const PARAM_TRIGGER = 'trigger';
export const PARAM_KIND = 'kind';
export const PARAM_PRODUCT_ID = 'product_id';
export const PARAM_REASON = 'reason';

export const KIND_INGREDIENT = 'ingredient';
export const KIND_METHOD = 'method';

const MILESTONE_PREFIX = 'chefvoice.analytics.milestone.';
const RECIPES_COMPLETED_KEY = 'chefvoice.analytics.recipes_completed';

let analytics = null;
let logEventFn = null;

/**
 * Called once at startup. Safe to call again; safe to never call, in which case
 * every event below is a no-op. Firebase Analytics is loaded separately from the
 * rest of the SDK so a measurement outage cannot take the app down with it.
 */
export async function initialize(app, sdkVersion) {
  if (analytics) return true;
  try {
    const sdk = await import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-analytics.js`);
    if (typeof sdk.isSupported === 'function' && !(await sdk.isSupported())) return false;
    analytics = sdk.getAnalytics(app);
    logEventFn = sdk.logEvent;
    return true;
  } catch {
    analytics = null;
    logEventFn = null;
    return false;
  }
}

// ---- Emitters ---------------------------------------------------------------

/**
 * A cooking capture actually started -- the microphone is open, not merely that the
 * button was tapped. Only the first one per browser is recorded; the question worth
 * answering is how many people ever get as far as narrating once.
 */
export function recipeCaptureStarted() {
  logMilestoneOnce(FIRST_RECIPE_STARTED);
}

/**
 * A new recipe was saved to the library. Counted rather than flagged, so the first
 * and second completions cannot fire twice or out of order however the caller
 * behaves. Edits to an existing recipe are not completions and must not call this.
 */
export function recipeCompleted() {
  const completed = bumpCounter(RECIPES_COMPLETED_KEY);
  if (completed === 1) log(FIRST_RECIPE_COMPLETED);
  else if (completed === 2) log(SECOND_RECIPE_COMPLETED);
}

export function secondPassOpened() {
  log(SECOND_PASS_OPENED);
}

export function secondPassAccepted(kind) {
  log(SECOND_PASS_ACCEPTED, { [PARAM_KIND]: kind });
}

export function paywallShown(trigger) {
  log(PAYWALL_SHOWN, { [PARAM_TRIGGER]: trigger });
}

export function paywallDismissed(trigger) {
  log(PAYWALL_DISMISSED, { [PARAM_TRIGGER]: trigger });
}

export function checkoutStarted(productId) {
  log(CHECKOUT_STARTED, { [PARAM_PRODUCT_ID]: productId });
}

export function purchaseCompleted(productId) {
  log(PURCHASE_COMPLETED, { [PARAM_PRODUCT_ID]: productId });
}

export function subscriptionCancelled(productId) {
  log(SUBSCRIPTION_CANCELLED, { [PARAM_PRODUCT_ID]: productId });
}

export function billingFailure(reason) {
  log(BILLING_FAILURE, { [PARAM_REASON]: reason });
}

// ---- Plumbing ---------------------------------------------------------------

function log(name, params) {
  if (!analytics || !logEventFn) return;
  try {
    logEventFn(analytics, name, params);
  } catch {
    /* telemetry must never surface to the chef */
  }
}

function bumpCounter(key) {
  try {
    const next = (Number(localStorage.getItem(key)) || 0) + 1;
    localStorage.setItem(key, String(next));
    return next;
  } catch {
    return 0;
  }
}

/**
 * Fires an event the first time it is ever requested in this browser and never
 * again. If storage is unavailable the event is dropped rather than logged
 * unguarded -- a once-only metric that silently becomes a per-visit metric is worse
 * than a missing one.
 */
function logMilestoneOnce(name, params) {
  let alreadyFired;
  try {
    alreadyFired = localStorage.getItem(MILESTONE_PREFIX + name) === '1';
  } catch {
    return;
  }
  if (alreadyFired) return;
  try {
    localStorage.setItem(MILESTONE_PREFIX + name, '1');
  } catch {
    /* fall through: the event is still worth one attempt */
  }
  log(name, params);
}
