'use strict';

// Chef search on backend-written tokens (audit F10). Source-text gates, like the others here.
// notifications/functions/search-tokens.test.js runs the tokens for real, and
// rules-tests/search-backfill.test.js runs the trigger and the backfill against the emulator.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const functions = read('notifications/functions/index.js');
const rules = read('firestore.rules');
const pwaClient = read('web/js/firebase-client.js');
const androidRepo = read('app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt');

test('every profile write brings its tokens up to date, and a write that leaves them right writes nothing', () => {
  const trigger = functions.slice(functions.indexOf('exports.syncChefSearchTokens'), functions.indexOf('exports.backfillChefVoiceSearchTokens'));
  assert.match(trigger, /onDocumentWritten\(\s*\{ document: "users\/\{uid\}", region: REGION \}/);
  const check = trigger.indexOf('if (sameTokens(data.searchTokens, tokens)) return;');
  const write = trigger.indexOf('await after.ref.update({ searchTokens: tokens });');
  assert.ok(check > 0 && write > check, 'the trigger must compare before it writes, or its own write would loop');
});

test('the search backfill is for admins only', () => {
  const backfill = functions.slice(functions.indexOf('exports.backfillChefVoiceSearchTokens'));
  assert.match(backfill, /if \(request\.auth\?\.token\?\.admin !== true\) throw new HttpsError\("permission-denied"/);
});

test('the rules accept the backend field on a profile, but no chef can write it', () => {
  const shape = rules.slice(rules.indexOf('function validUserProfileShape('), rules.indexOf('function validUserProfileCreate('));
  assert.match(shape, /'searchTokens'/);
  assert.match(shape, /data\.searchTokens is list && data\.searchTokens\.size\(\) <= 300/);
  const users = rules.slice(rules.indexOf('match /users/{uid} {'), rules.indexOf('match /likes/{recipeId} {'));
  assert.match(users, /allow create:[\s\S]*!request\.resource\.data\.keys\(\)\.hasAny\(\['searchTokens'\]\)/);
  const update = users.slice(users.indexOf('allow update:'), users.indexOf('allow delete:'));
  assert.match(update, /affectedKeys\(\)\.hasOnly\(\[\s*'displayName', 'bio', 'photoUrl', 'coverPhotoUrl', 'favoriteThings'\s*\]\)/);
});

test('both apps search the tokens and neither ever writes them', () => {
  assert.match(pwaClient, /where\('searchTokens','array-contains',queryKey\(words\)\)/);
  assert.match(androidRepo, /whereArrayContains\("searchTokens", ChefSearch\.queryKey\(words\)\)/);
  const pwaSave = pwaClient.slice(pwaClient.indexOf('export async function saveUserProfile'), pwaClient.indexOf('export async function saveUserProfile') + 1500);
  assert.ok(!pwaSave.includes('searchTokens'), 'the PWA must not write searchTokens');
  const androidSave = androidRepo.slice(androidRepo.indexOf('fun saveProfile'), androidRepo.indexOf('fun saveProfile') + 1500);
  assert.ok(!androidSave.includes('searchTokens'), 'Android must not write searchTokens');
  // The old walk over every profile is gone from both.
  assert.ok(!/SEARCH_MAX_SCANNED/.test(pwaClient));
  assert.ok(!/scanned >= 300/.test(androidRepo));
});
