import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

// Defense in depth for a UI built from template strings. Escaping is opt-in at every one of
// app.js's interpolations; the Content-Security-Policy is the backstop for the one that gets
// missed. Every Hosting site sends a policy -- Report-Only until it has been watched in
// production -- plus nosniff, a referrer policy and a framing ban, which are enforced now.
//
// These gates tie each policy to what its page really loads: a new Firebase module, host or
// inline script cannot ship unless the policy allows it, and the policy cannot quietly grow
// a hole. They are source-text checks. The browser half is e2e/, which runs the PWA under
// these exact headers and fails on any violation.

const root = new URL('../../', import.meta.url);
const readRoot = (name) => readFileSync(new URL(name, root), 'utf8');
const firebaseJson = JSON.parse(readRoot('firebase.json'));
const TARGETS = ['pwa', 'delete-account', 'legal'];

function siteHeaders(target) {
  const site = firebaseJson.hosting.find((h) => h.target === target);
  // Hosting matches a header rule against the path requested, not the rewrite's
  // destination, so a narrower rule would miss every deep link the "**" rewrite serves.
  const rule = (site.headers || []).find((h) => h.source === '**');
  assert.ok(rule, `${target}: the security headers must be on a "**" header rule`);
  return Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
}

function policyOf(target) {
  const headers = siteHeaders(target);
  const enforced = headers['Content-Security-Policy'];
  const reportOnly = headers['Content-Security-Policy-Report-Only'];
  // Promoting the policy means renaming the header, not adding a second one that can drift.
  assert.ok(Boolean(enforced) !== Boolean(reportOnly), `${target}: send exactly one Content-Security-Policy header`);
  const policy = new Map();
  for (const part of (enforced || reportOnly).split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    assert.ok(!policy.has(name), `${target}: ${name} appears twice, and browsers ignore the second`);
    policy.set(name, sources);
  }
  return policy;
}

// The sources a fetch of this kind is checked against, with CSP's fallback to default-src.
function sourcesFor(policy, directive) {
  const fallback = { 'script-src-elem': 'script-src', 'style-src-elem': 'style-src' }[directive];
  return policy.get(directive) ?? (fallback && policy.get(fallback)) ?? policy.get('default-src') ?? [];
}

// Just enough CSP source matching to answer "would this URL load": scheme, host with an
// optional leading *. wildcard, and a path that must match exactly or, ending in /, as a
// prefix. Query strings never take part, as in the browser.
function allows(sources, url) {
  const u = new URL(url);
  return sources.some((source) => {
    if (source === u.protocol) return true;
    const m = source.match(/^(https):\/\/(\*\.)?([^/]+)(\/.*)?$/);
    if (!m || `${m[1]}:` !== u.protocol) return false;
    const [, , wildcard, host, path] = m;
    if (wildcard ? !u.hostname.endsWith(`.${host}`) : u.hostname !== host) return false;
    if (!path) return true;
    return path.endsWith('/') ? u.pathname.startsWith(path) : u.pathname === path;
  });
}

function assertAllowed(target, directive, url, why) {
  const sources = sourcesFor(policyOf(target), directive);
  assert.ok(allows(sources, url), `${target}: ${directive} must allow ${url} (${why}); it allows ${sources.join(' ') || 'nothing'}`);
}

// Inline <script> hashes the way the browser computes them: over the element's text after
// the HTML parser has turned every CRLF into LF. The files are checked out with CRLF on
// Windows and LF in CI, and both must give the hash firebase.json pins.
const inlineScripts = (html) => [...html.replace(/\r\n?/g, '\n').matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\ssrc\s*=/.test(m[1] || '')).map((m) => m[2]);
const scriptSources = (html) => [...html.matchAll(/<script\s[^>]*\bsrc\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const inlineHandler = /<[a-z][^<>]*\son[a-z]+\s*=/i;

test('every Hosting site sends the security headers', () => {
  for (const target of TARGETS) {
    const headers = siteHeaders(target);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff', target);
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin', target);
    // Enforced now, while frame-ancestors waits in the Report-Only policy. Hosting leaves its
    // reserved /__/auth/ pages alone (checked on live sites), so the sign-in iframe the
    // Firebase SDK embeds from the auth domain is not caught by this.
    assert.equal(headers['X-Frame-Options'], 'DENY', target);
    policyOf(target);
  }
});

test('no policy allows inline or eval script, plugins, a <base> or being framed', () => {
  for (const target of TARGETS) {
    const policy = policyOf(target);
    const scriptSrc = sourcesFor(policy, 'script-src');
    for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", '*', 'https:', 'http:', 'data:', 'blob:']) {
      assert.ok(!scriptSrc.includes(unsafe), `${target}: script-src must not contain ${unsafe}`);
    }
    for (const [directive, sources] of policy) {
      for (const source of sources) {
        // A host with no scheme also matches plain http.
        if (/^[a-z0-9*-]+(\.[a-z0-9-]+)+/i.test(source)) assert.fail(`${target}: ${directive} names ${source} without https://`);
      }
    }
    assert.deepEqual(sourcesFor(policy, 'object-src'), ["'none'"], `${target}: object-src`);
    // base-uri, form-action and frame-ancestors never fall back to default-src.
    assert.deepEqual(policy.get('base-uri'), ["'none'"], `${target}: base-uri`);
    assert.deepEqual(policy.get('frame-ancestors'), ["'none'"], `${target}: frame-ancestors`);
    assert.ok(policy.has('form-action'), `${target}: form-action must be set`);
    // gstatic and googletagmanager also serve code that runs anything: old AngularJS builds,
    // and any stranger's Tag Manager container. Only these paths are needed.
    for (const source of scriptSrc) {
      if (source.includes('www.gstatic.com')) assert.equal(source, 'https://www.gstatic.com/firebasejs/', target);
      if (source.includes('googletagmanager.com')) assert.equal(source, 'https://www.googletagmanager.com/gtag/js', target);
    }
  }
});

const config = Object.fromEntries([...readRoot('web/js/firebase-config.js').matchAll(/(\w+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
const clientSource = readRoot('web/js/firebase-client.js');
const SDK = clientSource.match(/const SDK\s*=\s*'([\d.]+)'/)?.[1];

test('the PWA has no inline script or inline event handler for the policy to allow', () => {
  const indexHtml = readRoot('web/index.html');
  assert.deepEqual(inlineScripts(indexHtml), [], 'web/index.html: an inline script needs a hash in the pwa policy; load it from js/ instead');
  for (const src of scriptSources(indexHtml)) assert.ok(!/^[a-z]+:/i.test(src), `web/index.html loads ${src} from another origin`);
  for (const file of ['web/index.html', ...readdirSync(new URL('web/js/', root)).map((f) => `web/js/${f}`)]) {
    assert.ok(!inlineHandler.test(readRoot(file)), `${file}: an inline onxxx= handler is inline script; bind it with addEventListener or .onxxx`);
  }
});

test('the PWA policy allows every script the app loads', () => {
  assert.ok(SDK, 'firebase-client.js must pin the Firebase SDK version as const SDK=...');
  const files = ['web/firebase-messaging-sw.js', ...readdirSync(new URL('web/js/', root)).map((f) => `web/js/${f}`)];
  let checked = 0;
  for (const file of files) {
    for (const [url] of readRoot(file).matchAll(/https:\/\/[^'"`\s)]+\.js/g)) {
      assertAllowed('pwa', 'script-src', url.replace(/\$\{[^}]+\}/g, SDK), `loaded by ${file}`);
      checked++;
    }
  }
  assert.ok(checked >= 8, `expected the Firebase SDK imports, found ${checked} script URLs`);
});

// What each Firebase module the PWA imports talks to. A module missing here fails the test
// below: add what it loads (DevTools Network tab) here and to the pwa policy together.
const FIREBASE_MODULE_NEEDS = {
  'firebase-app.js': [],
  'firebase-auth.js': [
    ['connect-src', 'https://identitytoolkit.googleapis.com/v1/accounts:lookup'],
    ['connect-src', 'https://securetoken.googleapis.com/v1/token'],
    // On phones and Safari the SDK embeds a sign-in iframe from the auth domain at startup,
    // loaded through Google's API loader.
    ['script-src', 'https://apis.google.com/js/api.js'],
    ['script-src', 'https://apis.google.com/_/scs/abc-static/_/js/k=gapi.lb.en.x.O/m=gapi_iframes/rt=j/cb=gapi.loaded_0'],
    ['frame-src', `https://${config.authDomain}/__/auth/iframe`]
  ],
  'firebase-firestore.js': [['connect-src', 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel']],
  'firebase-storage.js': [
    ['connect-src', `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o`],
    // Published photos, videos and voice clips are shown by their download URLs.
    ['img-src', `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/recipes%2Fx`],
    ['media-src', `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/recipes%2Fx`]
  ],
  'firebase-functions.js': [['connect-src', `https://us-central1-${config.projectId}.cloudfunctions.net/transcribeChefVoice`]],
  'firebase-messaging.js': [['connect-src', `https://fcmregistrations.googleapis.com/v1/projects/${config.projectId}/registrations`]],
  'firebase-installations.js': [['connect-src', `https://firebaseinstallations.googleapis.com/v1/projects/${config.projectId}/installations`]],
  'firebase-analytics.js': [
    ['connect-src', `https://firebase.googleapis.com/v1alpha/projects/-/apps/${config.appId}/webConfig`],
    ['script-src', 'https://www.googletagmanager.com/gtag/js'],
    ['connect-src', 'https://www.google-analytics.com/g/collect'],
    ['connect-src', 'https://region1.google-analytics.com/g/collect'],
    ['img-src', 'https://www.google-analytics.com/g/collect']
  ]
};

test('the PWA policy allows the Firebase services the app uses', () => {
  const sources = ['web/firebase-messaging-sw.js', ...readdirSync(new URL('web/js/', root)).map((f) => `web/js/${f}`)].map(readRoot).join('\n');
  const modules = new Set([...sources.matchAll(/firebasejs\/[^/'"`]+\/(firebase-[a-z-]+?)(?:-compat)?\.js/g)].map((m) => `${m[1]}.js`));
  assert.ok(modules.has('firebase-auth.js') && modules.has('firebase-firestore.js'), 'expected to find the SDK imports');
  // Callables are built from the region the client names; the policy allows only that one.
  assert.match(clientSource, /getFunctions\(app,'us-central1'\)/);
  for (const module of modules) {
    const needs = FIREBASE_MODULE_NEEDS[module];
    assert.ok(needs, `the PWA imports ${module}, which this test does not know: list what it loads here and allow it in the pwa policy`);
    for (const [directive, url] of needs) assertAllowed('pwa', directive, url, `used by ${module}`);
  }
});

test('the PWA policy allows what the app builds locally', () => {
  // Recordings and picked photos and videos are previewed from object URLs.
  assertAllowed('pwa', 'media-src', 'blob:http://localhost/x', 'a recording played back before saving');
  assertAllowed('pwa', 'img-src', 'blob:http://localhost/x', 'a photo previewed before publishing');
  const policy = policyOf('pwa');
  // The templates set style="..." on dozens of elements; without this they all lose it.
  assert.ok(sourcesFor(policy, 'style-src').includes("'unsafe-inline'"), 'style-src needs \'unsafe-inline\' while the templates use style attributes');
  for (const directive of ['worker-src', 'manifest-src']) {
    assert.ok(sourcesFor(policy, directive).includes("'self'"), `${directive} must allow the app's own ${directive === 'worker-src' ? 'service workers' : 'manifest'}`);
  }
});

test('the deletion page policy allows its scripts and pins its inline script by hash', () => {
  const html = readRoot('hosting/index.html');
  const policy = policyOf('delete-account');
  for (const src of scriptSources(html)) assertAllowed('delete-account', 'script-src', src, 'a <script src> on the page');
  const inline = inlineScripts(html);
  assert.ok(inline.length > 0, 'expected the page\'s inline script');
  for (const script of inline) {
    const hash = sha256(script);
    assert.ok(sourcesFor(policy, 'script-src').includes(hash),
      `hosting/index.html's inline script changed: put ${hash} in place of the old hash in the delete-account policy in firebase.json`);
  }
  // Hashes cover <script> elements only, never onclick= and friends.
  assert.ok(!inlineHandler.test(html), 'hosting/index.html must not use inline event handlers');
  const pageConfig = Object.fromEntries([...html.matchAll(/(\w+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const region = html.match(/\.functions\("([a-z0-9-]+)"\)/)?.[1];
  assert.ok(region, 'the page must name its Functions region');
  assertAllowed('delete-account', 'connect-src', `https://${region}-${pageConfig.projectId}.cloudfunctions.net/deleteChefVoiceAccount`, 'the deletion callable');
  assertAllowed('delete-account', 'connect-src', 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', 'sign-in');
  assertAllowed('delete-account', 'connect-src', 'https://securetoken.googleapis.com/v1/token', 'the fresh token deletion requires');
  assertAllowed('delete-account', 'script-src', 'https://apis.google.com/js/api.js', 'the sign-in iframe on phones');
  assertAllowed('delete-account', 'frame-src', `https://${pageConfig.authDomain}/__/auth/iframe`, 'the sign-in iframe on phones');
});

test('the privacy policy page loads nothing but itself', () => {
  const html = readRoot('legal/privacy.html');
  assert.deepEqual(sourcesFor(policyOf('legal'), 'default-src'), ["'none'"]);
  assert.ok(!/<(script|img|iframe|object|embed|video|audio|link\s[^>]*stylesheet)\b/i.test(html),
    'legal/privacy.html now loads something; allow it in the legal policy in firebase.json');
});

test('escapeHtml escapes every character that can end text or an attribute', () => {
  const definition = readRoot('web/js/app.js').match(/^const escapeHtml=.*;$/m);
  assert.ok(definition, 'app.js must define escapeHtml on one line');
  const escapeHtml = vm.runInNewContext(`${definition[0]}escapeHtml`);
  assert.equal(escapeHtml(`<b title='a' data-x="b">Mom's & Dad's</b>`),
    '&lt;b title=&#39;a&#39; data-x=&quot;b&quot;&gt;Mom&#39;s &amp; Dad&#39;s&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(3), '3');
});
