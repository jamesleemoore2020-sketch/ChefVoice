import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Saving a Community recipe from the PWA was rejected with "Missing or insufficient
// permissions" because the client wrote {createdAt} while firestore.rules requires the
// bookmark to carry recipeId equal to its path id (as Android writes it). Nothing in the
// UI hinted at the cause, so the shape is pinned against the rule itself.

const client = readFileSync(new URL('../js/firebase-client.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

test('the bookmarks rule still requires recipeId to equal the path id', () => {
  const block = rules.slice(rules.indexOf('match /bookmarks/{recipeId}'));
  const create = block.slice(0, block.indexOf('allow update'));
  assert.match(create, /hasOnly\(\['recipeId', 'createdAt'\]\)/);
  assert.match(create, /request\.resource\.data\.recipeId == recipeId/);
});

test('toggleBookmark writes recipeId as well as createdAt', () => {
  const fn = client.slice(client.indexOf('export async function toggleBookmark'));
  const body = fn.slice(0, fn.indexOf('export async function toggleFollow'));
  assert.match(body, /setDoc\(target,\{recipeId,createdAt:Date\.now\(\)\}\)/);
});
