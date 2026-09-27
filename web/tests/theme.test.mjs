// Colour tokens, dark mode and the Appearance choice (audit F20 and F26).
//
// styles.css draws every colour a theme changes from a token on :root, and redefines the
// tokens twice for dark: once under prefers-color-scheme (Auto on a dark device) and once
// under [data-theme=dark] (Blackout chosen in Profile). These tests read the real CSS and
// the real theme-boot.js; nothing is mocked except the browser objects boot needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const boot = fs.readFileSync(new URL('../js/theme-boot.js', import.meta.url), 'utf8');

const LIGHT_BLOCK = /:root\{color-scheme:light;([^}]*)\}/;
const MEDIA_DARK = /@media\(prefers-color-scheme:dark\)\{:root:not\(\[data-theme=light\]\)\{([^}]*)\}\}/;
const CHOSEN_DARK = /:root\[data-theme=dark\]\{([^}]*)\}/;

function tokens(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/(--[a-z-]+):([^;]+)/g)) out[name] = value.trim();
  return out;
}
const light = tokens(css.match(LIGHT_BLOCK)[1]);
const dark = tokens(css.match(MEDIA_DARK)[1]);

function luminance(hex) {
  const n = parseInt(hex.slice(1).replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'), 16);
  const channel = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Every text-on-background pairing the stylesheet makes with tokens. 4.5:1 is WCAG AA for
// normal-size text, which every one of these is (labels, buttons, captions).
const PAIRS = [
  ['--ink', '--paper'], ['--ink', '--surface'],
  ['--muted', '--paper'], ['--muted', '--surface'], ['--muted', '--peach'], ['--muted', '--warm'], ['--muted', '--pill-bg'],
  ['--on-primary', '--primary'], ['--on-primary', '--primary-end'],
  ['--accent', '--surface'], ['--accent', '--paper'],
  ['--alert', '--surface'],
  ['--on-peach', '--peach'], ['--on-peach', '--warm'],
  ['--nav-ink', '--paper'],
  ['--sunken-ink', '--sunken'], ['--time-ink', '--sunken'],
  ['--notice-ink', '--notice-bg'],
  ['--pill-ink', '--pill-bg'],
  ['--danger-ink', '--danger-bg'],
  ['--green', '--surface']
];

test('Auto on a dark device and a chosen Blackout draw the same dark theme', () => {
  assert.equal(css.match(MEDIA_DARK)[1], css.match(CHOSEN_DARK)[1]);
  assert.match(css.match(MEDIA_DARK)[1], /^color-scheme:dark;/);
});

test('every colour token is defined for both themes', () => {
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
  assert.ok(Object.keys(light).length >= 30, 'the token set should not have been lost');
});

for (const [scheme, palette] of [['light', light], ['dark', dark]]) {
  test(`every text colour is readable on its background in the ${scheme} theme (4.5:1)`, () => {
    for (const [fg, bg] of PAIRS) {
      const ratio = contrast(palette[fg], palette[bg]);
      assert.ok(ratio >= 4.5, `${fg} ${palette[fg]} on ${bg} ${palette[bg]} is ${ratio.toFixed(2)}:1 in ${scheme}`);
    }
  });
}

test('buttons are not orange-under-white any more (F20)', () => {
  // The brand orange measured 3.2:1 under white labels. It may stay as decoration.
  assert.ok(contrast('#ffffff', '#f06423') < 4.5);
  assert.equal(light['--orange'], '#f06423');
  assert.equal(light['--primary'], '#c94a12');
  assert.match(css, /\.primary\{background:linear-gradient\(135deg,var\(--primary\),var\(--primary-end\)\);color:var\(--on-primary\)\}/);
  assert.doesNotMatch(css, /linear-gradient\(135deg,var\(--orange\)/);
  // Orange text uses --accent (or --on-peach on peach), never the decoration orange.
  assert.doesNotMatch(css.replace(/@import[^;]*;/, ''), /[{;]color:var\(--orange\)/);
});

test('colours a theme changes come from tokens; only photo and video overlays hard-code theirs', () => {
  // These draw on a photo, a video or the dark hero image, so they look the same in both
  // themes: translucent black behind white text, the red badge, the live dot.
  const onImagery = /^(\.hero|\.eyebrow|\.live-|\.media-remove|\.heart-burst|\.nav-badge|\.community-(badge|card|photo|chef|post-controls|caption|actions|banner-action))/;
  const rules = css
    .replace(LIGHT_BLOCK, '').replace(MEDIA_DARK, '').replace(CHOSEN_DARK, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}').map(rule => rule.trim()).filter(Boolean);
  const offenders = rules.filter(rule => {
    const declarations = rule.slice(rule.indexOf('{') + 1).replace(/white-space/g, '');
    return /#[0-9a-f]{3,8}\b|rgba?\(|\bwhite\b|\bblack\b/i.test(declarations) && !onImagery.test(rule.replace(/^@media[^{]*\{/, ''));
  });
  assert.deepEqual(offenders, []);
});

test('the Appearance choice is applied by a blocking script in <head>, before the app module', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<script src="js\/theme-boot\.js"><\/script>/);
  assert.ok(html.indexOf('js/theme-boot.js') < html.indexOf('js/app.js'));
  assert.match(head, /<meta name="theme-color" content="#f06423" media="\(prefers-color-scheme: light\)" data-scheme="light">/);
  assert.match(head, /<meta name="theme-color" content="#050505" media="\(prefers-color-scheme: dark\)" data-scheme="dark">/);
});

function runBoot({ stored = null, storageThrows = false } = {}) {
  const attributes = {};
  const metas = [
    { scheme: 'light', content: '#f06423' },
    { scheme: 'dark', content: '#050505' }
  ].map(m => ({
    getAttribute: name => (name === 'data-scheme' ? m.scheme : name === 'content' ? m.content : null),
    setAttribute: (name, value) => { if (name === 'content') m.content = value; },
    get content() { return m.content; }
  }));
  const store = new Map(stored === null ? [] : [['chefvoice.appearance', stored]]);
  const guard = fn => (...args) => { if (storageThrows) throw new Error('SecurityError'); return fn(...args); };
  const window = {};
  const context = {
    window,
    document: {
      documentElement: {
        setAttribute: (name, value) => { attributes[name] = value; },
        removeAttribute: name => { delete attributes[name]; }
      },
      querySelectorAll: () => metas
    },
    localStorage: {
      getItem: guard(key => (store.has(key) ? store.get(key) : null)),
      setItem: guard((key, value) => store.set(key, String(value))),
      removeItem: guard(key => store.delete(key))
    }
  };
  vm.runInNewContext(boot, context);
  return { api: window.ChefVoiceAppearance, attributes, metas, store };
}

test('theme boot: a chef who never chose follows the device', () => {
  const { api, attributes, metas } = runBoot();
  assert.equal(api.read(), 'auto');
  assert.equal(attributes['data-theme'], undefined);
  assert.deepEqual(metas.map(m => m.content), ['#f06423', '#050505']);
});

test('theme boot: Blackout and Light are applied before the first paint and remembered', () => {
  const { api, attributes, metas, store } = runBoot({ stored: 'dark' });
  assert.equal(attributes['data-theme'], 'dark');
  assert.deepEqual(metas.map(m => m.content), ['#050505', '#050505']);

  api.set('light');
  assert.equal(attributes['data-theme'], 'light');
  assert.equal(store.get('chefvoice.appearance'), 'light');
  assert.deepEqual(metas.map(m => m.content), ['#f06423', '#f06423']);

  api.set('auto');
  assert.equal(attributes['data-theme'], undefined);
  assert.equal(store.has('chefvoice.appearance'), false);
  assert.deepEqual(metas.map(m => m.content), ['#f06423', '#050505']);
});

test('theme boot: blocked storage (a private window) falls back to the device, without throwing', () => {
  const { api, attributes } = runBoot({ storageThrows: true });
  assert.equal(api.read(), 'auto');
  api.set('dark');
  assert.equal(attributes['data-theme'], 'dark', 'the choice still applies for this visit');
});

test('theme boot: an unknown stored value is treated as Auto', () => {
  assert.equal(runBoot({ stored: 'purple' }).api.read(), 'auto');
});
