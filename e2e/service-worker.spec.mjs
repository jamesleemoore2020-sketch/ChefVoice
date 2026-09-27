import { test, expect, TABS, tab } from './fixtures.mjs';

// web/sw.js: what it keeps and what it refuses to keep.

async function waitForControl(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // sw.js claims open pages on activate, so no reload is needed to be controlled.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function cachedUrls(page) {
  return page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
}

test('a first visit is enough to reopen the app with no network', async ({ page, context }) => {
  // The worker never controls the page load that installs it, so anything the precache
  // list left out was never cached. Six modules were left out in 0.5.17, two of them static
  // imports of app.js, and reopening offline served index.html in their place.
  await page.goto('/');
  await waitForControl(page);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('.cook-wizard')).toBeVisible();
    for (const name of TABS) {
      await tab(page, name).click();
      await expect(tab(page, name)).toHaveClass(/active/);
    }
  } finally {
    await context.setOffline(false);
  }
});

test('nothing from another origin is ever cached', async ({ page, context }) => {
  // Answer the Firebase SDK request instead of refusing it, so there is a successful
  // cross-origin response the worker could keep. The 0.5.17 worker kept every GET, which put
  // Firestore's Listen channel -- direct messages, notifications -- into Cache Storage.
  await context.route('https://www.gstatic.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'export {};'
  }));
  await page.goto('/');
  await waitForControl(page);
  await page.reload();
  await expect(page.locator('.cook-wizard')).toBeVisible();
  const urls = await cachedUrls(page);
  const origin = new URL(page.url()).origin;
  expect(urls.length, 'the app shell should be precached').toBeGreaterThan(20);
  expect(urls.filter((url) => new URL(url).origin !== origin)).toEqual([]);
});

test('every precached file is this deploy', async ({ page }) => {
  await page.goto('/');
  await waitForControl(page);
  const names = await page.evaluate(() => caches.keys());
  const version = await page.locator('#modeBadge').textContent();
  expect(names).toEqual([`chefvoice-pwa-v${version.replace('PWA ', '').trim()}`]);
});
