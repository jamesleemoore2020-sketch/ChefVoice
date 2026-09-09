const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const billing = read('billing/functions/index.js');
const rules = read('firestore.rules');
const firebaseJson = JSON.parse(read('firebase.json'));
const models = read('app/src/main/java/com/chefvoice/app/model/Models.kt');
const ui = read('app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt');
const deployScript = read('DEPLOY_BILLING.cmd');

test('billing is its own isolated Functions codebase', () => {
  assert.ok(Array.isArray(firebaseJson.functions), 'functions must be an array of codebases');
  const codebases = firebaseJson.functions.map((f) => f.codebase);
  assert.ok(codebases.includes('chefvoice-notifications'));
  assert.ok(codebases.includes('chefvoice-billing'));
  const billingEntry = firebaseJson.functions.find((f) => f.codebase === 'chefvoice-billing');
  assert.equal(billingEntry.source, 'billing/functions');
});

test('the billing deploy script is scoped to its own codebase only', () => {
  // Assert on the deploy commands themselves. The script's banner names the surfaces
  // it does not touch, so a whole-file search would match its own prose.
  const deployLines = deployScript
    .split(/\r?\n/)
    .filter((line) => /^\s*firebase\s+deploy/.test(line));
  assert.equal(deployLines.length, 1, 'exactly one firebase deploy invocation');
  assert.match(deployLines[0], /--only functions:chefvoice-billing/);
  for (const forbidden of [/firestore/, /hosting/, /storage/, /chefvoice-notifications/, /,/]) {
    assert.doesNotMatch(deployLines[0], forbidden);
  }
});

test('launch access grants 10 founding seats of 2 years and 90 free days after', () => {
  assert.match(billing, /FOUNDING_SEATS = 10/);
  assert.match(billing, /FOUNDING_DAYS = 730/);
  assert.match(billing, /FOUNDING_MS = FOUNDING_DAYS \* 24 \* 60 \* 60 \* 1000/);
  assert.match(billing, /PROMO_DAYS = 90/);
  assert.match(billing, /PROMO_MS = PROMO_DAYS \* 24 \* 60 \* 60 \* 1000/);
});

test('a founding window runs from the grant and a promo window from signup', () => {
  // Dating a backfilled founding seat from a months-old signup would silently
  // shorten the reward for exactly the chefs it is meant to thank.
  assert.match(billing, /expiresAt: founding \? now \+ FOUNDING_MS : \(signupAt \|\| now\) \+ PROMO_MS/);
  // No grant is open-ended any more; 0 was the old "never expires" sentinel.
  assert.doesNotMatch(billing, /expiresAt: founding \? 0/);
});

test('a grant never overwrites an entitlement that already exists', () => {
  assert.match(billing, /if \(entSnap\.exists\) return "already_entitled";/);
});

test('founding seats are claimed inside the granting transaction', () => {
  assert.match(billing, /runTransaction/);
  assert.match(billing, /foundingSeatsClaimed: config\.foundingSeatsClaimed \+ 1/);
});

test('a missing config document means the promo is running, not stopped', () => {
  assert.match(billing, /promoEnabled: data\.promoEnabled !== false/);
});

test('the kill switch closes new grants and only ever revokes promo grants', () => {
  assert.match(billing, /endChefVoiceLaunchPromo/);
  assert.match(billing, /promoEnabled: false/);
  assert.match(billing, /const revokeActive = request\.data\?\.revokeActive === true;/);
  // Founding seats and real Play purchases must survive the switch.
  assert.match(billing, /if \(source !== SOURCE_PROMO\) return;/);
});

test('both admin callables require an admin claim', () => {
  assert.match(billing, /function adminAuthorized\(request\) \{\s*return request\.auth\?\.token\?\.admin === true;/);
  const guards = billing.match(/if \(!adminAuthorized\(request\)\) \{/g) || [];
  assert.equal(guards.length, 2, 'backfill and kill switch must both be admin-gated');
});

test('the backfill sorts in memory so accounts without createdAt are not skipped', () => {
  assert.match(billing, /backfillChefVoiceLaunchAccess/);
  assert.match(billing, /users\.sort\(\(a, b\) => a\.createdAt - b\.createdAt\)/);
  // A real call is `.orderBy("createdAt")`; the prose above it explains why there
  // isn't one, so match the leading dot rather than the bare name.
  assert.doesNotMatch(billing, /\.orderBy\("createdAt"\)/);
});

test('the revoke sweep needs no new Firestore index', () => {
  assert.doesNotMatch(billing, /collectionGroup\(/);
  assert.match(billing, /orderBy\(FieldPath\.documentId\(\)\)/);
});

test('launch access config is closed to clients in both directions', () => {
  assert.match(rules, /match \/config\/\{configId\}[\s\S]*?allow read, write: if false;/);
});

test('entitlements stay backend-owned', () => {
  assert.match(rules, /match \/entitlements\/\{entitlementId\}[\s\S]*?allow write: if false;/);
});

test('the client can tell complimentary access from a paid subscription', () => {
  assert.match(models, /const val SOURCE_FOUNDING = "founding"/);
  assert.match(models, /const val SOURCE_PROMO = "promo"/);
  assert.match(models, /val isComplimentary: Boolean/);
  assert.match(models, /object FoundingAccess/);
  assert.match(models, /const val SEATS = 10/);
  assert.match(models, /const val FOUNDING_YEARS = 2/);
  assert.match(models, /const val PROMO_DAYS = 90/);
});

test('the client copy mirrors the backend window lengths', () => {
  // FoundingAccess is display copy; billing/functions/index.js is authoritative.
  // These must move together, so assert the pair agrees.
  const seats = /const val SEATS = (\d+)/.exec(models)[1];
  const years = /const val FOUNDING_YEARS = (\d+)/.exec(models)[1];
  const promoDays = /const val PROMO_DAYS = (\d+)/.exec(models)[1];
  assert.match(billing, new RegExp(`FOUNDING_SEATS = ${seats}\\b`));
  assert.match(billing, new RegExp(`FOUNDING_DAYS = ${Number(years) * 365}\\b`));
  assert.match(billing, new RegExp(`PROMO_DAYS = ${promoDays}\\b`));
});

test('the membership card does not call a complimentary chef a subscriber', () => {
  assert.match(ui, /Founding member/);
  assert.match(ui, /no card, no renewal, /);
  assert.match(ui, /Free launch access/);
  // Founding access is a two-year window now, not an open-ended one.
  assert.doesNotMatch(ui, /Pro is yours for life/);
  assert.match(ui, /FoundingAccess\.FOUNDING_YEARS/);
});

test('the client still grants itself nothing', () => {
  // Entitlement remains read-only on the client: no write path to entitlements.
  const repo = read('app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt');
  assert.doesNotMatch(repo, /collection\("entitlements"\)[\s\S]{0,200}\.set\(/);
});
