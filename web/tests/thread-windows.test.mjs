import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Direct messages, recipe comments and Live chat each keep a window of the newest items.
// All three used orderBy('createdAt') + limit(n), which is the OLDEST n: past the cap a
// thread silently stopped showing anything new, on both platforms. Checked against source
// because the queries only run against Firestore; both platforms are held to the same
// windows so a conversation looks the same on a phone and in a browser.

const web = readFileSync(new URL('../js/firebase-client.js', import.meta.url), 'utf8');
const android = readFileSync(new URL('../../app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt', import.meta.url), 'utf8');

const WINDOWS = { RECIPE_COMMENT_WINDOW: 100, DIRECT_MESSAGE_WINDOW: 250, LIVE_COMMENT_WINDOW: 150 };

test('the PWA keeps the newest items of every thread', () => {
  for (const [name, size] of Object.entries(WINDOWS)) {
    assert.match(web, new RegExp(`const ${name}=${size};`));
    assert.match(web, new RegExp(`orderBy\\('createdAt'\\),limitToLast\\(${name}\\)`));
  }
  assert.doesNotMatch(web, /orderBy\('createdAt'\),limit\(/, 'an ascending createdAt query with limit() returns the oldest items');
});

test('Android keeps the newest items of every thread', () => {
  const compact = android.replace(/\s+/g, '');
  for (const [name, size] of Object.entries(WINDOWS)) {
    assert.match(android, new RegExp(`private const val ${name} = ${size}L`));
    assert.match(compact, new RegExp(`\\.orderBy\\("createdAt"\\)\\.limitToLast\\(${name}\\)`));
  }
  assert.doesNotMatch(compact, /\.orderBy\("createdAt"\)\.limit\(/, 'an ascending createdAt query with limit() returns the oldest items');
});
