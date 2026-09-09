import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudRecipesRemaining, daysRemaining, EntitlementSource, EntitlementStatus, FoundingAccess,
  FreeTierLimits, FREE_ENTITLEMENT, isComplimentary, isEntitlementActive, isFounding, isPromo,
  normalizeEntitlement, photosPerRecipe, ProTierLimits, remainingLabel, secondPassMonthlyLimit,
  videoAllowed
} from '../js/entitlement.js';

// Mirrors the semantics asserted on the Android side in Models.kt. The entitlement
// is server-authoritative, so the only thing worth testing here is that every check
// fails closed to Free.

const NOW = 1_700_000_000_000;
const DAY = 86400000;
const active = (over = {}) => ({ status: EntitlementStatus.ACTIVE, productId: '', expiresAt: 0, autoRenewing: false, source: EntitlementSource.PLAY, updatedAt: 0, ...over });

test('a missing entitlement document is Free, not an error', () => {
  assert.equal(isEntitlementActive(null, NOW), false);
  assert.equal(isEntitlementActive(undefined, NOW), false);
  assert.deepEqual(normalizeEntitlement(null), { ...FREE_ENTITLEMENT });
});

test('active and in_grace unlock Pro; on_hold, paused and unknown do not', () => {
  assert.equal(isEntitlementActive(active({ status: EntitlementStatus.ACTIVE }), NOW), true);
  // Grace keeps access while Play retries a failed card -- pulling features there
  // turns a recoverable failure into a cancellation.
  assert.equal(isEntitlementActive(active({ status: EntitlementStatus.IN_GRACE }), NOW), true);
  assert.equal(isEntitlementActive(active({ status: EntitlementStatus.ON_HOLD }), NOW), false);
  assert.equal(isEntitlementActive(active({ status: EntitlementStatus.PAUSED }), NOW), false);
  assert.equal(isEntitlementActive(active({ status: 'something_new_from_the_backend' }), NOW), false);
});

test('an expired window is not Pro even when the status still says active', () => {
  assert.equal(isEntitlementActive(active({ expiresAt: NOW - 1 }), NOW), false);
  assert.equal(isEntitlementActive(active({ expiresAt: NOW + DAY }), NOW), true);
  // expiresAt 0 means no expiry rather than "expired at the epoch".
  assert.equal(isEntitlementActive(active({ expiresAt: 0 }), NOW), true);
});

test('founding and promo are complimentary; play is not', () => {
  const founding = active({ source: EntitlementSource.FOUNDING });
  const promo = active({ source: EntitlementSource.PROMO });
  const play = active({ source: EntitlementSource.PLAY });
  assert.equal(isFounding(founding), true);
  assert.equal(isPromo(promo), true);
  assert.equal(isComplimentary(founding), true);
  assert.equal(isComplimentary(promo), true);
  assert.equal(isComplimentary(play), false);
});

test('daysRemaining ceilings partial days and floors at zero', () => {
  assert.equal(daysRemaining(active({ expiresAt: NOW + DAY }), NOW), 1);
  assert.equal(daysRemaining(active({ expiresAt: NOW + DAY + 1 }), NOW), 2);
  assert.equal(daysRemaining(active({ expiresAt: NOW - DAY }), NOW), 0);
  assert.equal(daysRemaining(active({ expiresAt: 0 }), NOW), Number.POSITIVE_INFINITY);
  assert.equal(daysRemaining(active({ expiresAt: NOW + FoundingAccess.PROMO_DAYS * DAY }), NOW), FoundingAccess.PROMO_DAYS);
});

test('free tier caps cloud recipes and video; Pro does not', () => {
  assert.equal(cloudRecipesRemaining(false, 0), FreeTierLimits.CLOUD_RECIPES);
  assert.equal(cloudRecipesRemaining(false, FreeTierLimits.CLOUD_RECIPES), 0);
  // Never negative, however many were synced before an entitlement lapsed.
  assert.equal(cloudRecipesRemaining(false, FreeTierLimits.CLOUD_RECIPES + 5), 0);
  assert.equal(cloudRecipesRemaining(true, 999), Number.POSITIVE_INFINITY);

  assert.equal(videoAllowed(false), false);
  assert.equal(videoAllowed(true), true);
  assert.equal(photosPerRecipe(false), FreeTierLimits.PHOTOS_PER_RECIPE);
  assert.equal(photosPerRecipe(true), Number.POSITIVE_INFINITY);
  assert.equal(secondPassMonthlyLimit(false), FreeTierLimits.SECOND_PASS_PER_MONTH);
  assert.equal(secondPassMonthlyLimit(true), ProTierLimits.SECOND_PASS_PER_MONTH);
});

test('remainingLabel switches to months only once days stop being useful', () => {
  assert.equal(remainingLabel(1), '1 day');
  assert.equal(remainingLabel(45), '45 days');
  assert.equal(remainingLabel(59), '59 days');
  assert.equal(remainingLabel(60), '2 months');
  assert.equal(remainingLabel(730), '24 months');
});

test('a malformed entitlement document is read the same way Android reads it', () => {
  // Firestore's getString returns null for a non-string field, so Kotlin falls
  // through to "expired". Plain JS coercion would turn ['active'] into 'active'
  // and unlock Pro, so the normalizer reads strictly.
  assert.equal(isEntitlementActive({ status: ['active'] }, NOW), false);
  assert.equal(isEntitlementActive({ status: 42 }, NOW), false);
  assert.equal(isEntitlementActive({}, NOW), false);
  assert.equal(isEntitlementActive('not an object', NOW), false);

  // A non-numeric expiresAt reads as 0 on both platforms (getLong returns null),
  // and 0 means "no expiry" rather than "expired". This unlocks Pro -- which is a
  // backend bug if it ever happens, not an attack: the document is Admin-SDK-only.
  // Matching Android matters more than being stricter here; divergent gating would
  // mean Pro working on the phone but not in Safari for the same account.
  assert.equal(isEntitlementActive({ status: 'active', expiresAt: 'not-a-number' }, NOW), true);
  assert.equal(normalizeEntitlement({ status: 'active', expiresAt: 'not-a-number' }).expiresAt, 0);
});
