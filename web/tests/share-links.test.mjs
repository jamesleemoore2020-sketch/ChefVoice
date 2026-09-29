import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Shared recipe links, /r/{id} (audit F29): Hosting sends them to share/functions for link
// previews, and a person is sent on to the app's ?recipe= deep link by js/share-redirect.js or by
// the service worker. Three pieces read the same path, so they are held to one pattern here, and
// the Hosting rewrite has to reach the function before the app's catch-all does.

const root = new URL('../../', import.meta.url);
const readRoot = (name) => readFileSync(new URL(name, root), 'utf8');
const require = createRequire(import.meta.url);
const sharePage = require('../../share/functions/share-page.js');

const firebaseJson = JSON.parse(readRoot('firebase.json'));
const pwa = firebaseJson.hosting.find((h) => h.target === 'pwa');
const swSource = readRoot('web/sw.js');
const redirectSource = readRoot('web/js/share-redirect.js');
const appSource = readRoot('web/js/app.js');

test('a shared link reaches the share function before the app catch-all does', () => {
  const rewrites = pwa.rewrites;
  const share = rewrites.findIndex((r) => r.source === '/r/**');
  const catchAll = rewrites.findIndex((r) => r.source === '**');
  assert.ok(share >= 0, 'the pwa target must rewrite /r/** to the share function');
  assert.ok(share < catchAll, 'Hosting uses the first rewrite that matches; /r/** must come before **');
  assert.deepEqual(rewrites[share].function, { functionId: 'recipeSharePage', region: 'us-central1' });
  assert.equal(rewrites[catchAll].destination, '/index.html');
  // Only the PWA's site answers share links.
  for (const other of firebaseJson.hosting.filter((h) => h.target !== 'pwa')) {
    assert.ok(!(other.rewrites || []).some((r) => r.function), `${other.target} must not rewrite to a function`);
  }
});

test('the share function is its own deploy unit, in the region the rewrite names', () => {
  const codebase = firebaseJson.functions.find((f) => f.codebase === 'chefvoice-share');
  assert.ok(codebase, 'firebase.json must declare the chefvoice-share codebase');
  assert.equal(codebase.source, 'share/functions');
  const index = readRoot('share/functions/index.js');
  assert.match(index, /exports\.recipeSharePage = onRequest\(/);
  assert.match(index, /region: "us-central1"/);
  assert.match(index, /invoker: "public"/);
  // It must never describe a recipe that is not public.
  assert.match(index, /snapshot\.get\("isPublic"\) === true/);
  // And no other codebase defines it.
  for (const other of ['notifications/functions/index.js', 'billing/functions/index.js', 'import/functions/index.js']) {
    assert.ok(!readRoot(other).includes('recipeSharePage'), `${other} must not define recipeSharePage`);
  }
});

test('the PWA shares /r/ links', () => {
  const share = appSource.slice(appSource.indexOf('async function shareRecipe('), appSource.indexOf('// ---- Live: hosting and watching'));
  assert.match(share, /const url=`\$\{location\.origin\}\/r\/\$\{encodeURIComponent\(recipe\.id\)\}`;/);
});

test('the function, the redirect script and the service worker read /r/ paths the same way', () => {
  const swPattern = new RegExp(/const SHARE_LINK=\/(.+)\/;/.exec(swSource)[1]);
  const redirectPattern = new RegExp(/const shared = \/(.+)\/\.exec\(location\.pathname\);/.exec(redirectSource)[1]);
  const samples = [
    '/r/abc123', '/r/abc-DEF_123', '/r/abc/', '/r/', '/r', '/r/abc/extra', '/r/a.b', '/r/..', '/r/%2e%2e',
    '/r/a%2Fb', `/r/${'a'.repeat(128)}`, `/r/${'a'.repeat(129)}`, '/recipes/abc', '/r/ab c', '/r/abc?x=1'
  ];
  for (const path of samples) {
    const fromFunction = sharePage.recipeIdFromPath(path);
    assert.equal(swPattern.exec(path)?.[1] ?? '', fromFunction, `sw.js disagrees about ${path}`);
    assert.equal(redirectPattern.exec(path)?.[1] ?? '', fromFunction, `share-redirect.js disagrees about ${path}`);
  }
});

test('the service worker turns a share link into the deep link before it can store anything', () => {
  const handler = swSource.slice(swSource.indexOf("self.addEventListener('fetch'"), swSource.indexOf('function withTimeout('));
  const redirect = handler.indexOf("path.startsWith('/r/')");
  assert.ok(redirect > 0, 'sw.js must answer /r/ navigations itself');
  // openApp stores the page it fetched as the app shell; a share page must never get there.
  assert.ok(redirect < handler.indexOf('openApp(event)'), 'the /r/ redirect must come before openApp');
  assert.match(handler, /Response\.redirect\(new URL\(target,self\.location\.origin\)\.href,302\)/);
  assert.match(handler, /`\/\?tab=community&recipe=\$\{encodeURIComponent\(shared\[1\]\)\}`/);
});

test('the redirect script goes where the share page\'s own link goes', () => {
  assert.match(redirectSource, /location\.replace\(shared \? `\/\?tab=community&recipe=\$\{encodeURIComponent\(shared\[1\]\)\}` : '\/'\);/);
  assert.equal(sharePage.deepLink('abc123'), '/?tab=community&recipe=abc123');
  // The share page loads exactly this script, which the pwa policy allows as 'self'.
  assert.match(sharePage.renderSharePage({ id: 'abc123', recipe: null }).html, /<script src="\/js\/share-redirect\.js"><\/script>/);
});
