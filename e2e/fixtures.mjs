import { test as base, expect } from '@playwright/test';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export const test = base.extend({
  // Every request that leaves the local server is refused: the Firebase SDK on gstatic,
  // Firestore, Auth, Storage, Analytics. The app then runs exactly as it does with Firebase
  // down or the phone offline, and no spec can read from or write to production.
  context: async ({ context }, use) => {
    await context.route((url) => !LOCAL_HOSTS.has(url.hostname), (route) => route.abort('internetdisconnected'));
    await use(context);
  },

  // Fails the test on any uncaught exception or console error the app itself produced. A
  // refused Firebase request logs "Failed to load resource" -- that is this setup, not a bug.
  consoleErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const where = message.location()?.url || '';
      let host = '';
      try { host = new URL(where).hostname; } catch { /* no location */ }
      if (/Failed to load resource/.test(message.text()) && !LOCAL_HOSTS.has(host)) return;
      errors.push(`console: ${message.text()}${where ? ` (${where})` : ''}`);
    });
    await use(errors);
    expect(errors, 'the page reported errors').toEqual([]);
  }, { auto: true }]
});

export { expect };

/** The six bottom-bar tabs, in the order the PWA shows them. */
export const TABS = ['Cook', 'Recipes', 'Community', 'Inbox', 'Live', 'Profile'];

export function tab(page, name) {
  return page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name });
}

/** A saved local recipe in the shape storage.js keeps, for specs that start from one. */
export function localRecipe(overrides = {}) {
  const now = Date.now();
  return {
    id: 'e2e-recipe-1',
    title: 'Weeknight tomato pasta',
    description: '',
    servings: 2,
    prepTimeMinutes: 0,
    cookTimeMinutes: 0,
    ingredients: [
      { quantity: '200', unit: 'g', name: 'spaghetti' },
      { quantity: '2', unit: 'tablespoons', name: 'olive oil' }
    ],
    steps: ['Boil the pasta for 10 minutes.', 'Warm the oil in a pan.', 'Toss the pasta through the oil.'],
    transcript: [],
    createdAt: now,
    updatedAt: now,
    isPublic: false,
    media: [],
    tags: [],
    ...overrides
  };
}

export async function seedRecipes(page, recipes) {
  await page.addInitScript((value) => {
    localStorage.setItem('chefvoice.web.recipes.v1', value);
  }, JSON.stringify(recipes));
}
