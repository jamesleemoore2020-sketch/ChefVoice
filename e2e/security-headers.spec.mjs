import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';

// Every spec runs under the pwa target's Content-Security-Policy and fails on a violation
// (fixtures.mjs). That only means something while serve.mjs sends what Hosting sends.

const firebaseJson = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const pwa = firebaseJson.hosting.find((h) => h.target === 'pwa');
const expected = Object.fromEntries(pwa.headers.find((h) => h.source === '**').headers.map(({ key, value }) => [key.toLowerCase(), value]));

test('every path is served with the security headers the pwa target sends', async ({ request }) => {
  // A deep link is served index.html by the rewrite and must still get the headers.
  for (const path of ['/', '/?tab=community&recipe=abc', '/a/deep/link', '/js/app.js', '/sw.js', '/manifest.webmanifest', '/assets/chefvoice-icon.png']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const headers = response.headers();
    for (const [key, value] of Object.entries(expected)) expect(headers[key], `${key} on ${path}`).toBe(value);
  }
});

test('a policy violation is caught', async ({ page, cspViolations }) => {
  await page.goto('/');
  await expect(page.locator('#main .cook-wizard')).toBeVisible();
  await page.evaluate(() => {
    const probe = new Image();
    probe.src = 'https://example.com/csp-probe.png';
    document.body.append(probe);
  });
  await expect.poll(() => cspViolations.length).toBe(1);
  expect(cspViolations[0]).toContain('img-src refused https://example.com/csp-probe.png');
  // The probe was this test's point; the fixture's own check at the end must still pass.
  cspViolations.length = 0;
});
