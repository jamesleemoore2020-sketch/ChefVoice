import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Audit F16: account deletion and privacy, as a chef meets them. The deletion page needs a
// sign-in, so a forgotten password used to mean no way to delete the account at all; the PWA
// had no route to the policy or the deletion page; and both said less than the backend does.

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const app = read('web/js/app.js');
const client = read('web/js/firebase-client.js');
const deletionPage = read('hosting/index.html');
const policy = read('legal/privacy.html');
const android = read('app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt');

const POLICY_URL = 'https://chefvoice-d7fec-legal.web.app/privacy.html';
const DELETION_URL = 'https://chefvoice-delete-account.web.app/';

test('the PWA can reset a forgotten password', () => {
  assert.match(client, /export async function sendPasswordReset\(email\)/);
  assert.match(client, /await sendPasswordResetEmail\(auth,clean\)/);
  assert.match(app, /id="cloudForgot"/);
  assert.match(app, /await cloud\.api\.sendPasswordReset\(email\)/);
});

test('the PWA links the privacy policy and the deletion page from Profile', () => {
  assert.ok(app.includes(`const PRIVACY_POLICY_URL='${POLICY_URL}';`));
  assert.ok(app.includes(`const ACCOUNT_DELETION_URL='${DELETION_URL}';`));
  assert.match(app, /\$\{accountPrivacyTemplate\(\)\}/);
});

test('Android links the privacy policy whether or not the chef is signed in', () => {
  assert.ok(android.includes(`private const val PRIVACY_POLICY_URL = "${POLICY_URL}"`));
  assert.match(android, /uriHandler\.openUri\(PRIVACY_POLICY_URL\)/);
  assert.match(android, /It does not cancel a Google Play subscription/);
});

test('the deletion page has a way in for a forgotten password', () => {
  assert.match(deletionPage, /id="forgotBtn"/);
  assert.match(deletionPage, /auth\.sendPasswordResetEmail\(email\)/);
  // One answer whether or not the address has an account, so the page cannot enumerate them.
  assert.match(deletionPage, /else showMsg\(signInMsg, sent, "success"\);/);
});

test('the deletion page says what goes, what stays, and what it cannot cancel', () => {
  assert.match(deletionPage, /including the other chef&rsquo;s messages/);
  assert.match(deletionPage, /Pro membership record/);
  assert.match(deletionPage, /What is kept/);
  assert.match(deletionPage, /anonymous identifier/);
  assert.match(deletionPage, /does not cancel a Google Play subscription/);
  assert.ok(deletionPage.includes(POLICY_URL));
  assert.doesNotMatch(deletionPage, /ChefVoice on Android\./, 'web-only chefs delete here too');
});

test('the privacy policy matches what the app does now', () => {
  // It said there was no Google Play Billing flow, a year of releases after there was one.
  assert.doesNotMatch(policy, /does not include a third-party advertising SDK or a Google Play Billing flow/);
  assert.match(policy, /sold through Google Play Billing/);
  assert.match(policy, /advertising ID/);
  assert.match(policy, /Recipe import/);
  assert.match(policy, /does not cancel a Google Play subscription/);
  assert.match(policy, /moderation records with a pseudonymous deleted-account identifier/);
});

test('Profile no longer shows engineering copy', () => {
  // "ASR homophone repair" read as the automatic correction ChefVoice promises not to do.
  assert.doesNotMatch(app, /homophone repair/i);
  assert.doesNotMatch(app, /Protected voice behavior/);
  assert.doesNotMatch(app, /Connected to ChefVoice Firebase/);
  assert.doesNotMatch(app, /verified ChefVoice Firebase project/);
  assert.doesNotMatch(android, /v0\.10\.1 adds optional prep\/cook time/);
});
