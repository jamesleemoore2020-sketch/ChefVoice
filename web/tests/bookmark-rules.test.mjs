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

test('setBookmark writes recipeId as well as createdAt', () => {
  const fn = client.slice(client.indexOf('export async function setBookmark'));
  const body = fn.slice(0, fn.indexOf('export async function toggleFollow'));
  assert.match(body, /setDoc\(target,\{recipeId,createdAt:Date\.now\(\)\}\)/);
});

// Saves were recorded but nothing showed them: the Recipes tab listed only local recipes.
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

test('saving and liking set the state the chef asked for instead of flipping the server', () => {
  // A toggle inverted whatever the server held, so a Save button drawn before the
  // bookmarks listener caught up removed the bookmark it promised to add.
  assert.doesNotMatch(client, /export async function toggleBookmark/);
  assert.doesNotMatch(client, /export async function toggleLike/);
  const save = client.slice(client.indexOf('export async function setBookmark'), client.indexOf('export async function toggleFollow'));
  // The rule never allows an update, so re-saving must not write again.
  assert.match(save, /if\(\(await getDoc\(target\)\)\.exists\(\)\)return true;/);
  const like = client.slice(client.indexOf('export async function setLike'), client.indexOf('export async function setBookmark'));
  assert.match(like, /if\(liked&&!likeSnap\.exists\(\)\)/);
  assert.match(like, /else if\(!liked&&likeSnap\.exists\(\)\)/);
  assert.doesNotMatch(app, /cloud\.api\.toggle(Like|Bookmark)/);
});

test('an open Community recipe follows the like and save listeners', () => {
  // The detail view is held steady against feed re-renders, so without a patch its
  // buttons kept whatever state they were drawn with -- a saved recipe read "Save".
  assert.match(app, /function patchCommunityDetail\(\)/);
  assert.match(app, /observeUserRecipeIds\(user\.uid,'likes',s=>\{cloud\.liked=s;if\(shouldRenderCommunity\(\)\)render\(\);else patchCommunityDetail\(\);\}\)/);
  assert.match(app, /observeUserRecipeIds\(user\.uid,'bookmarks',s=>\{cloud\.bookmarks=s;if\(shouldRenderCommunity\(\)\|\|onRecipesList\(\)\)render\(\);else patchCommunityDetail\(\);\}\)/);
});

test('the Recipes tab shows a Saved cookbook built from the bookmarked feed recipes', () => {
  assert.match(app, /function savedCookbookTemplate\(\)/);
  assert.match(app, /cloud\.recipes\.filter\(r=>cloud\.bookmarks\.has\(r\.id\)\)/);
  assert.match(app, /\$\{savedCookbookTemplate\(\)\}/);
});

test('saved cards open, and refreshing saves never closes an open recipe', () => {
  assert.match(app, /const onRecipesList=\(\)=>currentTab==='recipes'&&!openCommunityRecipeId/);
  assert.match(app, /if\(shouldRenderCommunity\(\)\|\|onRecipesList\(\)\)render\(\)/);
});
