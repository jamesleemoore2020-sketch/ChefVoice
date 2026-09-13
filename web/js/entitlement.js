// Ported from app/src/main/java/com/chefvoice/app/model/Models.kt (ProEntitlement,
// FreeTierLimits, ProTierLimits, FoundingAccess) and the gating getters in
// ChefAppState.kt.
//
// The entitlement is server-authoritative: `chefvoice-billing` writes
// users/{uid}/entitlements/pro with the Admin SDK, and firestore.rules makes it
// read-only to clients (`allow write: if false`). Nothing here grants anything --
// this module only interprets what the backend already decided, and every check
// fails closed to Free.

export const EntitlementStatus = Object.freeze({
  ACTIVE: 'active',
  IN_GRACE: 'in_grace',
  ON_HOLD: 'on_hold',
  PAUSED: 'paused',
  EXPIRED: 'expired'
});

export const ProductId = Object.freeze({
  MONTHLY: 'chefvoice_pro_monthly',
  ANNUAL: 'chefvoice_pro_annual'
});

export const EntitlementSource = Object.freeze({
  /** A verified Google Play purchase. */
  PLAY: 'play',
  /** One of the first 10 signups. Two free years, written by chefvoice-billing. */
  FOUNDING: 'founding',
  /** The free 90-day launch window granted at signup. */
  PROMO: 'promo'
});

export const FreeTierLimits = Object.freeze({
  CLOUD_RECIPES: 10,
  SECOND_PASS_PER_MONTH: 2,
  PHOTOS_PER_RECIPE: 1,
  VIDEO_ALLOWED: false
});

export const ProTierLimits = Object.freeze({
  SECOND_PASS_PER_MONTH: 30,
  VIDEO_ALLOWED: true
});

/**
 * Launch access display copy. The backend owns the real decision; these numbers are
 * mirrored so the membership card can say "one of the first 10", "2 years" and
 * "90 days" without inventing them. `billing/functions/index.js` holds the
 * authoritative set -- change both together.
 */
export const FoundingAccess = Object.freeze({
  SEATS: 10,
  FOUNDING_YEARS: 2,
  PROMO_DAYS: 90
});

export const PaywallTrigger = Object.freeze({
  SECOND_PASS: 'second_pass',
  CLOUD_LIMIT: 'cloud_limit',
  VIDEO: 'video',
  PROFILE: 'profile'
});

const DAY_MS = 86400000;

/** A missing entitlement document means Free, not an error. */
export const FREE_ENTITLEMENT = Object.freeze({
  status: EntitlementStatus.EXPIRED,
  productId: '',
  expiresAt: 0,
  autoRenewing: false,
  source: EntitlementSource.PLAY,
  updatedAt: 0
});

// Firestore's getString/getLong return null when a field holds another type, and
// the Kotlin side leans on that: a non-string status falls through to "expired".
// JS coercion is looser -- String(['active']) is 'active' -- so read strictly here
// or a malformed document could read as Pro.
const readString = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
const readNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function normalizeEntitlement(data) {
  if (!data || typeof data !== 'object') return { ...FREE_ENTITLEMENT };
  return {
    status: readString(data.status, EntitlementStatus.EXPIRED),
    productId: readString(data.productId, ''),
    expiresAt: readNumber(data.expiresAt),
    autoRenewing: data.autoRenewing === true,
    source: readString(data.source, EntitlementSource.PLAY),
    updatedAt: readNumber(data.updatedAt)
  };
}

/**
 * Whether Pro features should be unlocked right now.
 *
 * Grace period keeps access while Play retries a failed payment, which is a large
 * share of involuntary churn -- pulling features immediately turns a recoverable
 * card failure into a cancellation. Account hold does not: at that point Play has
 * already suspended the subscription. Unknown statuses are not Pro.
 */
export function isEntitlementActive(entitlement, nowMs = Date.now()) {
  const e = normalizeEntitlement(entitlement);
  if (e.status !== EntitlementStatus.ACTIVE && e.status !== EntitlementStatus.IN_GRACE) return false;
  return e.expiresAt === 0 || e.expiresAt > nowMs;
}

export function isAnnual(entitlement) {
  return normalizeEntitlement(entitlement).productId === ProductId.ANNUAL;
}

/** Granted a founding seat: 2 free years, never revoked by the promo kill switch. */
export function isFounding(entitlement) {
  return normalizeEntitlement(entitlement).source === EntitlementSource.FOUNDING;
}

/** Inside the free 90-day launch window rather than paying. */
export function isPromo(entitlement) {
  return normalizeEntitlement(entitlement).source === EntitlementSource.PROMO;
}

/**
 * Pro without paying for it. The UI must not describe these chefs as subscribers,
 * offer them a "manage subscription" link, or warn them about a payment method they
 * never entered.
 */
export function isComplimentary(entitlement) {
  return isFounding(entitlement) || isPromo(entitlement);
}

/**
 * Whole days of a window still remaining, floored at zero. Infinity means the grant
 * carries no expiry at all.
 */
export function daysRemaining(entitlement, nowMs = Date.now()) {
  const e = normalizeEntitlement(entitlement);
  if (e.expiresAt <= 0) return Number.POSITIVE_INFINITY;
  const remaining = e.expiresAt - nowMs;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / DAY_MS);
}

/** Cloud-synced recipes still allowed against the Free cap. Infinity for Pro. */
export function cloudRecipesRemaining(isPro, cloudRecipeCount) {
  if (isPro) return Number.POSITIVE_INFINITY;
  return Math.max(0, FreeTierLimits.CLOUD_RECIPES - Math.max(0, Number(cloudRecipeCount) || 0));
}

export function videoAllowed(isPro) {
  return isPro ? ProTierLimits.VIDEO_ALLOWED : FreeTierLimits.VIDEO_ALLOWED;
}

/** Photos per recipe. Infinity for Pro. */
export function photosPerRecipe(isPro) {
  return isPro ? Number.POSITIVE_INFINITY : FreeTierLimits.PHOTOS_PER_RECIPE;
}

export function secondPassMonthlyLimit(isPro) {
  return isPro ? ProTierLimits.SECOND_PASS_PER_MONTH : FreeTierLimits.SECOND_PASS_PER_MONTH;
}

const SECOND_PASS_KEY = 'chefvoice.secondPass.usage';

/** Calendar-month key, so the allowance resets the way the copy says it does. */
export function monthKey(nowMs = Date.now()) {
  const date = new Date(nowMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Second Pass reviews used this calendar month, on this device. Local bookkeeping
 * only -- the cloud call is the real cost centre and the backend enforces its own
 * budget; this exists so the UI can say what is left without lying.
 */
export function secondPassUsedThisMonth(nowMs = Date.now()) {
  try {
    const stored = JSON.parse(localStorage.getItem(SECOND_PASS_KEY) || 'null');
    if (!stored || stored.monthKey !== monthKey(nowMs)) return 0;
    return Math.max(0, Number(stored.used) || 0);
  } catch {
    return 0;
  }
}

/**
 * Counted only after a successful cloud call. A failed review must not burn an
 * allowance the chef never got the benefit of.
 */
export function recordSecondPassUse(nowMs = Date.now()) {
  const used = secondPassUsedThisMonth(nowMs) + 1;
  try {
    localStorage.setItem(SECOND_PASS_KEY, JSON.stringify({ monthKey: monthKey(nowMs), used }));
  } catch {
    /* a browser with storage disabled still gets the review */
  }
  return used;
}

export function secondPassRemaining(isPro, nowMs = Date.now()) {
  return Math.max(0, secondPassMonthlyLimit(isPro) - secondPassUsedThisMonth(nowMs));
}

/**
 * Remaining complimentary access in whatever unit reads naturally. "641 days left" is
 * true and useless; a chef two years into free Pro wants to hear months. Only used for
 * the founding window -- the 90-day promo stays in days, where the precision is the
 * point and "2 months left" would blur a deadline that is close enough to matter.
 */
export function remainingLabel(days) {
  if (days >= 60) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}
