import { test, expect, TABS, tab, localRecipe, seedRecipes } from './fixtures.mjs';

// The class of bug no unit test catches: a tab that renders blank, a button that does
// nothing, a navigation route that throws. Every spec also fails on any console error.

test('every tab renders and becomes the selected tab', async ({ page }) => {
  await page.goto('/');
  const main = page.locator('#main');
  await expect(main.locator('.cook-wizard')).toBeVisible();
  const expected = {
    Cook: 'Cook naturally.',
    Recipes: 'Recipes with a voice.',
    Community: 'ChefVoice Community',
    Inbox: 'Messages and activity.',
    Live: 'Cook together, live.',
    Profile: 'Sign in'
  };
  for (const name of [...TABS.slice(1), TABS[0]]) {
    await tab(page, name).click();
    await expect(main).toContainText(expected[name]);
    await expect(tab(page, name)).toHaveClass(/active/);
  }
});

test('the Cook wizard walks forward and back and saves a typed recipe', async ({ page }) => {
  await page.goto('/');
  const progress = page.locator('#cookProgress p');
  const labels = ['Capture', 'Recipe Details', 'Ingredients/Method', 'Media', 'Review'];
  for (let step = 0; step < labels.length; step++) {
    await expect(progress).toHaveText(`Step ${step + 1} of 5 · ${labels[step]}`);
    if (step === 1) await page.getByLabel('Recipe name').fill('Smoke test toast');
    if (step === 2) {
      await page.getByLabel('Add an ingredient').fill('two slices of bread');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      for (const text of ['Toast the bread until golden.', 'Butter it while hot.']) {
        await page.getByLabel('Add a cooking step').fill(text);
        await page.getByRole('button', { name: 'Add step' }).click();
      }
    }
    if (step < labels.length - 1) await page.getByRole('button', { name: 'Next' }).click();
  }
  for (let step = labels.length - 1; step > 0; step--) {
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(progress).toHaveText(`Step ${step} of 5 · ${labels[step - 1]}`);
  }
  // What was typed survives the round trip.
  for (let step = 0; step < labels.length - 1; step++) await page.getByRole('button', { name: 'Next' }).click();
  const review = page.locator('#recipeReview');
  await expect(review).toContainText('Smoke test toast');
  await expect(review).toContainText('1 ingredient');
  await expect(review).toContainText('2 method steps');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(tab(page, 'Recipes')).toHaveClass(/active/);
  await expect(page.locator('#main')).toContainText('Smoke test toast');
});

test('cook-along steps forward and back through a saved recipe', async ({ page }) => {
  await seedRecipes(page, [localRecipe()]);
  await page.goto('/?tab=recipes');
  await page.getByRole('button', { name: /Cook/ }).filter({ hasText: '🍳 Cook' }).first().click();
  const card = page.locator('.cook-step-card');
  const where = page.getByText(/^STEP \d OF 3/);
  await expect(card).toHaveText('Boil the pasta for 10 minutes.');
  await expect(where).toContainText('STEP 1 OF 3');
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(card).toHaveText('Warm the oil in a pan.');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(card).toHaveText('Toss the pasta through the oil.');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(card).toHaveText('Warm the oil in a pan.');
  // A step that says how long offers exactly that timer.
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByRole('button', { name: /10 min/ })).toBeVisible();
  // Leaving goes back to where the chef came from.
  await page.getByRole('button', { name: /Weeknight tomato pasta/ }).click();
  await expect(page.locator('#main')).toContainText('Recipes with a voice.');
});

test('the screen can be zoomed and <main> is not a live region', async ({ page }) => {
  await page.goto('/');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/);
  await expect(page.locator('#main')).not.toHaveAttribute('aria-live', /.*/);
  await expect(page.locator('#srStatus')).toHaveAttribute('role', 'status');
});

test('an empty Inbox shows no unread badge', async ({ page }) => {
  // The badge's display:grid outranked [hidden], so it always showed, reading "0".
  await page.goto('/');
  await expect(page.locator('#inboxBadge')).toBeHidden();
});

test('nothing on any tab scrolls sideways on a phone', async ({ page }) => {
  await page.goto('/');
  for (const name of TABS) {
    await tab(page, name).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${name} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test('Profile links the privacy policy and the deletion page, and offers a password reset', async ({ page }) => {
  await page.goto('/?tab=profile');
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', 'https://chefvoice-d7fec-legal.web.app/privacy.html');
  await expect(page.getByRole('link', { name: 'Delete my account' })).toHaveAttribute('href', 'https://chefvoice-delete-account.web.app/');
  const forgot = page.getByRole('button', { name: 'Forgot password?' });
  await expect(forgot).toBeVisible();
  // Asking without an email explains what to do instead of failing silently.
  await forgot.click();
  await expect(page.locator('#cloudAuthStatus')).not.toBeEmpty();
});
