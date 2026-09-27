import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

// Deploy-scoping gates, in the same spirit as billing/launch-access.test.js.
//
// Hosting is a multi-site config: the PWA lives on the default site and the Play-
// required account-deletion page lives on its own. Without a pinned target the CLI
// deploys every site at once, so a single page could replace the whole PWA. These
// checks are source-text only -- they cannot talk to Firebase -- but they catch the
// drift that would make a deploy destructive.

const root = new URL('../../', import.meta.url);
const readRoot = (name) => readFileSync(new URL(name, root), 'utf8');

const firebaseJson = JSON.parse(readRoot('firebase.json'));
const firebaserc = JSON.parse(readRoot('.firebaserc'));

test('hosting declares both sites as separate pinned targets', () => {
  assert.ok(Array.isArray(firebaseJson.hosting), 'hosting must be an array for multi-site deploys');
  const targets = firebaseJson.hosting.map((h) => h.target);
  assert.deepEqual([...targets].sort(), ['delete-account', 'pwa']);
  // Every entry must be pinned. An untargeted entry is the destructive case.
  assert.ok(firebaseJson.hosting.every((h) => typeof h.target === 'string' && h.target));
});

test('each hosting target serves its own directory', () => {
  const pwa = firebaseJson.hosting.find((h) => h.target === 'pwa');
  const deleteAccount = firebaseJson.hosting.find((h) => h.target === 'delete-account');
  assert.equal(pwa.public, 'web');
  assert.equal(deleteAccount.public, 'hosting');
  assert.notEqual(pwa.public, deleteAccount.public, 'the two sites must never share a public directory');
});

test('.firebaserc maps both targets to distinct sites', () => {
  const hosting = firebaserc.targets?.['chefvoice-d7fec']?.hosting;
  assert.ok(hosting, '.firebaserc must declare hosting targets or --only hosting:<target> cannot resolve');
  assert.deepEqual(hosting.pwa, ['chefvoice-d7fec']);
  assert.deepEqual(hosting['delete-account'], ['chefvoice-delete-account']);
  assert.equal(firebaserc.projects?.default, 'chefvoice-d7fec');
});

test('the PWA does not publish its tests, lockfile or dependencies', () => {
  const pwa = firebaseJson.hosting.find((h) => h.target === 'pwa');
  for (const pattern of ['**/tests/**', '**/node_modules/**', '**/package.json']) {
    assert.ok(pwa.ignore.includes(pattern), `hosting ignore no longer excludes ${pattern}`);
  }
});

test('service workers are served no-cache', () => {
  // A cached service worker pins chefs to an old build: the worker that would
  // fetch the new one is itself the stale copy. Both workers must revalidate.
  const pwa = firebaseJson.hosting.find((h) => h.target === 'pwa');
  const sources = (pwa.headers || []).map((h) => h.source);
  for (const worker of ['/sw.js', '/firebase-messaging-sw.js']) {
    assert.ok(sources.includes(worker), `${worker} must be served with no-cache`);
    const entry = pwa.headers.find((h) => h.source === worker);
    const cacheControl = entry.headers.find((h) => h.key === 'Cache-Control');
    assert.match(cacheControl.value, /no-cache/);
  }
});

test('the app shell and its JS/CSS are served no-cache', () => {
  // None of index.html, app.js or the other JS/CSS files are content-hashed, so
  // Firebase Hosting's default Cache-Control (max-age=3600) lets a browser -- or
  // this app's own service worker, whose "network" fetch still consults the HTTP
  // cache -- keep serving a build from before the latest deploy for up to an hour.
  // A chef testing a just-shipped fix would silently be running the old code.
  //
  // '/' needs its own entry distinct from '/index.html': Hosting matches header
  // rules against the path actually requested, not the rewrite's destination, so
  // a rule on '/index.html' alone never applies to the root request every chef
  // actually makes.
  const pwa = firebaseJson.hosting.find((h) => h.target === 'pwa');
  const sources = (pwa.headers || []).map((h) => h.source);
  for (const noCached of ['/', '/index.html', '/js/**', '/css/**']) {
    assert.ok(sources.includes(noCached), `${noCached} must be served with no-cache`);
    const entry = pwa.headers.find((h) => h.source === noCached);
    const cacheControl = entry.headers.find((h) => h.key === 'Cache-Control');
    assert.match(cacheControl.value, /no-cache/);
  }
});

test('deploy scripts stay pinned to their own target', () => {
  const pwaScript = readRoot('DEPLOY_PWA.cmd');
  const deleteScript = readRoot('DEPLOY_ACCOUNT_DELETION_PAGE.cmd');
  assert.match(pwaScript, /--only hosting:pwa/);
  assert.match(deleteScript, /--only hosting:delete-account/);
  // An unpinned `--only hosting` would deploy both sites at once.
  assert.ok(!/--only hosting\s+--project/.test(pwaScript), 'DEPLOY_PWA must not deploy hosting unpinned');
  assert.ok(!/--only hosting\s+--project/.test(deleteScript), 'deletion page must not deploy hosting unpinned');
});

test('the superseded standalone PWA hosting config is gone', () => {
  // web/firebase.hosting.json was the config from when web/ was its own project.
  // Deploying with it would publish the PWA untargeted, bypassing both tripwires.
  assert.ok(!existsSync(new URL('web/firebase.hosting.json', root)),
    'web/firebase.hosting.json is superseded by the hosting targets in firebase.json');
});

const swSource = readRoot('web/sw.js');
const precached = () => {
  const list = swSource.match(/const CORE=\[([\s\S]*?)\];/);
  assert.ok(list, 'sw.js must declare its precache list as const CORE=[...]');
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

test('the service worker precaches every module and stylesheet the app can load', () => {
  // The worker does not control the first page load, so anything missing from CORE was
  // never cached at all. Six modules were missing in 0.5.17, two of them static imports of
  // app.js, and an offline reopen served index.html in their place: the app did not boot.
  const core = new Set(precached());
  for (const dir of ['js', 'css']) {
    for (const file of readdirSync(new URL(`web/${dir}/`, root))) {
      if (!/\.(js|css)$/.test(file)) continue;
      assert.ok(core.has(`./${dir}/${file}`), `web/${dir}/${file} is not in sw.js CORE, so it cannot load offline`);
    }
  }
  for (const entry of core) {
    if (entry === './') continue;
    assert.ok(existsSync(new URL(`web/${entry.slice(2)}`, root)), `sw.js precaches ${entry}, which does not exist, so the worker would fail to install`);
  }
});

test('the service worker never caches another origin', () => {
  // Firestore's Listen channel carries direct messages and notifications. The 0.5.17 worker
  // cached every GET, so they sat in Cache Storage after sign-out on a shared device.
  assert.match(swSource, /if\(new URL\(request\.url\)\.origin!==self\.location\.origin\)return;/);
  const originCheck = swSource.indexOf('origin!==self.location.origin');
  const firstRespond = swSource.indexOf('respondWith(');
  assert.ok(originCheck > 0 && originCheck < firstRespond, 'the origin check must come before the worker answers any request');
  // A range request's 206 cannot be stored; the old worker rejected on every video.
  assert.match(swSource, /response\.status===200/);
  assert.match(swSource, /request\.headers\.has\('range'\)/);
});

test('the version shown, the cache key and package.json agree', () => {
  // The header badge said "PWA 0.2 · Firebase" for three months of releases while the real
  // version lived only in the cache key.
  const { version } = JSON.parse(readRoot('web/package.json'));
  assert.match(swSource, new RegExp(`const CACHE='chefvoice-pwa-v${version.replace(/\./g, '\\.')}';`));
  const badge = readRoot('web/index.html').match(/<span id="modeBadge"[^>]*>([^<]*)<\/span>/);
  assert.ok(badge, 'index.html must keep the #modeBadge version badge');
  assert.equal(badge[1].trim(), `PWA ${version}`);
});

test('the required PWA entry points would actually be published', () => {
  for (const file of ['web/index.html', 'web/manifest.webmanifest', 'web/sw.js', 'web/firebase-messaging-sw.js']) {
    assert.ok(existsSync(new URL(file, root)), `${file} is missing and the deploy would ship a broken PWA`);
  }
});
