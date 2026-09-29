import { test, expect, tab } from './fixtures.mjs';

// A shared recipe link, /r/{id} (audit F29). The page there is for link previews and is
// served by share/functions; serve.mjs answers it the way that function does when a recipe is
// not public, since there is no Firestore here. Every spec also fails on a console error or a
// Content-Security-Policy violation (fixtures.mjs).

const meta = (html, key) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1] ?? null;

/**
 * Every URL the page's main frame is navigated to. The app reads a ?recipe= deep link at start
 * and then tidies its own URL back to "/", so the deep link is seen here, not at the end.
 */
function navigations(page) {
  const seen = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) seen.push(new URL(frame.url()).pathname + new URL(frame.url()).search); });
  return seen;
}

test('a shared link answers a crawler with preview tags and no app', async ({ request }) => {
  const response = await request.get('/r/abc123');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  const html = await response.text();
  expect(meta(html, 'og:title')).toBe('ChefVoice');
  expect(meta(html, 'og:image')).toBe('https://chefvoice-d7fec.web.app/assets/chefvoice-icon.png');
  expect(html).not.toContain('id="main"');
  // Hosting's own headers reach it too.
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
});

test('a person who follows a shared link lands on the recipe in the app', async ({ page }) => {
  const seen = navigations(page);
  await page.goto('/r/abc123');
  // Community is where a shared recipe opens; the deep link is how the app was told which one.
  await expect(tab(page, 'Community')).toHaveClass(/active/);
  expect(seen).toContain('/?tab=community&recipe=abc123');
});

test('a link to nothing in particular lands on the app', async ({ page }) => {
  await page.goto('/r/not..a.recipe');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#main .cook-wizard')).toBeVisible();
});

test('with the app installed, a shared link skips the page and the offline app stays the app', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const served = [];
  page.on('response', (response) => { if (new URL(response.url()).pathname.startsWith('/r/') && !response.fromServiceWorker()) served.push(response.url()); });
  const seen = navigations(page);
  await page.goto('/r/abc123');
  await expect(tab(page, 'Community')).toHaveClass(/active/);
  expect(seen).toContain('/?tab=community&recipe=abc123');
  expect(served, 'the service worker should answer a shared link itself').toEqual([]);
  // What the worker keeps as the app shell is still the app, so the next offline launch works.
  const shell = await page.evaluate(async () => (await (await caches.match('/index.html'))?.text()) ?? '');
  expect(shell).toContain('id="main"');
  await context.setOffline(true);
  try {
    await page.goto('/?tab=cook');
    await expect(tab(page, 'Cook')).toHaveClass(/active/);
    await page.goto('/r/def456');
    await expect(tab(page, 'Community')).toHaveClass(/active/);
    expect(seen).toContain('/?tab=community&recipe=def456');
  } finally {
    await context.setOffline(false);
  }
});
