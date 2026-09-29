'use strict';

// Deletion without walking the whole platform (audit F17). Source-text gates, like the others
// here: they cannot run the functions. notifications/functions/deletion-indexes.test.js runs the
// decisions, and rules-tests/deletion-backfill.test.js runs the backfill against the emulator.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const functions = read('notifications/functions/index.js');
const rules = read('firestore.rules');
const indexes = JSON.parse(read('firestore.indexes.json'));

/** The source of one top-level function, up to the next top-level declaration. */
function body(name) {
  const start = functions.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = functions.slice(start + 1).search(/\n(async function |function |exports\.|const )/);
  return functions.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('incoming blocks are found by the field every block carries, before any walk', () => {
  const blocks = body('deleteIncomingBlockReferences');
  const query = blocks.indexOf('db.collectionGroup("blocks").where("blockedUid", "==", uid)');
  const retired = blocks.indexOf('if (scansRetired) return;');
  const walk = blocks.indexOf('db.collection("users").orderBy(FieldPath.documentId())');
  assert.ok(query > 0 && retired > query && walk > retired, 'query, then stop if retired, then the walk');
});

test('every walk over all users or all recipes stops once the backfill has finished', () => {
  for (const name of ['deleteRecipeUserMirrors', 'deleteUserLikes', 'deleteIncomingBlockReferences']) {
    const source = body(name);
    const retired = source.indexOf('if (scansRetired) return;');
    const walk = source.search(/orderBy\(FieldPath\.documentId\(\)\)/);
    assert.ok(retired > 0 && walk > retired, `${name} must skip its walk once the scans are retired`);
  }
});

test('account and recipe deletion ask once whether the walks are still needed, and pass it on', () => {
  const account = functions.slice(functions.indexOf('exports.deleteChefVoiceAccount'), functions.indexOf('exports.deleteChefVoiceRecipe'));
  assert.match(account, /const scansRetired = await deletionScansRetired\(\);/);
  assert.match(account, /deleteRecipeArtifacts\(uid, recipe\.ref, scansRetired\)/);
  assert.match(account, /deleteUserLikes\(uid, scansRetired\)/);
  assert.match(account, /deleteIncomingBlockReferences\(uid, scansRetired\)/);
  const recipe = functions.slice(functions.indexOf('exports.deleteChefVoiceRecipe'), functions.indexOf('exports.backfillChefVoiceDeletionIndexes'));
  assert.match(recipe, /deleteRecipeArtifacts\(uid, recipeRef, await deletionScansRetired\(\)\)/);
  assert.match(body('deleteRecipeArtifacts'), /deleteRecipeUserMirrors\(recipeId, likerUids, scansRetired\)/);
  // A missing or unreadable state document means "not retired": the walks keep running.
  assert.match(body('deletionScansRetired'), /legacyScansRetired\(snap\.exists \? snap\.data\(\) : null\)/);
});

test('the backfill is for admins only, and records that it finished only when it has', () => {
  const backfill = functions.slice(functions.indexOf('exports.backfillChefVoiceDeletionIndexes'));
  assert.match(backfill, /if \(request\.auth\?\.token\?\.admin !== true\) throw new HttpsError\("permission-denied"/);
  assert.match(backfill, /const done = backfillDone\(cursors\);/);
  assert.match(backfill, /if \(done\) await stateRef\.set\(\{ backfilledAt/);
  // It writes only what the pure functions decided.
  assert.match(backfill, /blockFixes\(page\.docs\)/);
  assert.match(backfill, /bookmarkFixes\(page\.docs\)/);
  assert.match(backfill, /likeMirrorFixes\(page\.docs,/);
});

test('the blocks query has its collection-group index', () => {
  const override = (indexes.fieldOverrides || []).find((f) => f.collectionGroup === 'blocks' && f.fieldPath === 'blockedUid');
  assert.ok(override, 'firestore.indexes.json must index blocks.blockedUid');
  assert.ok(override.indexes.some((i) => i.queryScope === 'COLLECTION_GROUP' && i.order === 'ASCENDING'));
  // The field overrides replace the defaults, so collection-scope indexing must stay.
  assert.ok(override.indexes.some((i) => i.queryScope === 'COLLECTION' && i.order === 'ASCENDING'));
});

test("the rules keep a like's mirror for as long as the recipe's half exists", () => {
  const likes = rules.slice(rules.indexOf('match /likes/{recipeId} {'), rules.indexOf('match /bookmarks/{recipeId} {'));
  assert.match(likes, /allow delete: if signedIn\(\) && request\.auth\.uid == uid\s*&& !existsAfter\(\/databases\/\$\(database\)\/documents\/recipes\/\$\(recipeId\)\/likes\/\$\(uid\)\);/);
});
