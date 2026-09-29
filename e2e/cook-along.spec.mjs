import { test, expect, localRecipe, seedRecipes } from './fixtures.mjs';

// Cook-along for a real kitchen (audit F21): step text that reads from arm's length, one big
// Next where a thumb lands, the amounts beside the step that uses them, and no tab bar to brush
// on the way past and fall out of the recipe.

const primaryNav = page => page.getByRole('navigation', { name: 'Primary' });
const stepCard = page => page.locator('.cook-step-card');
const inThisStep = page => page.getByRole('region', { name: 'In this step' });

async function cookFromList(page, recipe = localRecipe()) {
  await seedRecipes(page, [recipe]);
  await page.goto('/?tab=recipes');
  await page.getByRole('button', { name: /Cook/ }).filter({ hasText: '🍳 Cook' }).first().click();
  await expect(stepCard(page)).toBeVisible();
}

test('the tab bar is gone while cooking, and back once the chef leaves', async ({ page }) => {
  await cookFromList(page);
  await expect(primaryNav(page)).toBeHidden();
  await page.getByRole('button', { name: /Weeknight tomato pasta/ }).click();
  await expect(primaryNav(page)).toBeVisible();
  await expect(page.locator('#main')).toContainText('Recipes with a voice.');
});

test('Next is the biggest target on the screen and stays docked at the bottom', async ({ page }) => {
  // Long enough to scroll, so the dock has something to stay put over, and so the page is still
  // scrollable on the next step: a short one would snap the page to the top by itself.
  const long = 'Stir the oil through the pasta slowly, scraping the bottom of the pan, until every strand is coated and glossy. '.repeat(4).trim();
  const alsoLong = `Warm the oil in a pan. ${'Keep the heat low and let it shimmer without smoking, tilting the pan so it pools evenly. '.repeat(4).trim()}`;
  await cookFromList(page, localRecipe({ steps: [long, alsoLong, 'Serve.'] }));
  const viewport = page.viewportSize();
  const next = await page.getByRole('button', { name: 'Next step' }).boundingBox();
  const previous = await page.getByRole('button', { name: 'Previous' }).boundingBox();
  expect(next.height).toBeGreaterThanOrEqual(64);
  expect(next.width).toBeGreaterThan(previous.width * 1.5);
  const fontSize = name => page.getByRole('button', { name }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(await fontSize('Next step')).toBeGreaterThan(await fontSize('Previous'));
  expect(next.y + next.height).toBeGreaterThan(viewport.height - 40);
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const scrolled = await page.getByRole('button', { name: 'Next step' }).boundingBox();
  expect(Math.abs(scrolled.y - next.y)).toBeLessThan(2);
  // Nothing on the page ends up hidden behind the dock: the last control scrolls clear of it.
  await page.mouse.wheel(0, 5000);
  const lastControl = await page.getByRole('button', { name: /Hands-free/ }).boundingBox();
  expect(lastControl.y + lastControl.height).toBeLessThanOrEqual(scrolled.y);
  // A new step starts at its first word.
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(stepCard(page)).toHaveText(alsoLong);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe('on the narrowest phones', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('both step buttons show their whole label on one line', async ({ page }) => {
    await cookFromList(page);
    for (const button of await page.locator('.cook-dock button').all()) {
      const fit = await button.evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return { lines: range.getClientRects().length, overflow: el.scrollWidth - el.clientWidth, label: el.textContent };
      });
      expect(fit.lines, `${fit.label} wraps`).toBe(1);
      expect(fit.overflow, `${fit.label} spills out of its button`).toBeLessThanOrEqual(0);
    }
  });
});

test('the step text reads from arm\'s length', async ({ page }) => {
  await cookFromList(page);
  const size = await stepCard(page).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(28);
});

test('a step shows the ingredients it names, with their amounts, and the rest are a tap away', async ({ page }) => {
  await cookFromList(page);
  // "Boil the pasta" does not name anything on the list, which says spaghetti.
  await expect(inThisStep(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(stepCard(page)).toHaveText('Warm the oil in a pan.');
  await expect(inThisStep(page)).toContainText('2 tablespoons olive oil');
  await expect(inThisStep(page)).not.toContainText('spaghetti');
  const all = page.locator('#cookAllIngredients');
  await expect(all).not.toHaveAttribute('open', /.*/);
  await page.getByText('All ingredients (2)').click();
  await expect(all).toContainText('200 g spaghetti');
  // Opened stays open across the next step.
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(all).toHaveAttribute('open', /.*/);
});

test('the servings the chef set carry into the cook-along, and it says so', async ({ page }) => {
  await seedRecipes(page, [localRecipe()]);
  await page.goto('/?tab=recipes');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'More servings' }).click();
  await page.getByRole('button', { name: 'More servings' }).click();
  await expect(page.locator('#main')).toContainText('Serves 4');
  await page.getByRole('button', { name: '🍳 Cook this recipe' }).click();
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(inThisStep(page)).toContainText('4 tablespoons olive oil');
  await expect(inThisStep(page)).toContainText('for 4 servings (the chef cooked 2)');
  await expect(inThisStep(page)).toContainText('The step reads as the chef said it.');
  // Coming back keeps the chef's setting.
  await page.getByRole('button', { name: /Weeknight tomato pasta/ }).click();
  await expect(page.locator('#main')).toContainText('Serves 4');
});

test('keyboard focus stays on Next from one step to the next', async ({ page }) => {
  await cookFromList(page);
  await page.getByRole('button', { name: 'Next step' }).focus();
  await page.keyboard.press('Enter');
  await expect(stepCard(page)).toHaveText('Warm the oil in a pan.');
  await expect(page.getByRole('button', { name: 'Next step' })).toBeFocused();
  await page.keyboard.press('Enter');
  // The last step's button is disabled, so focus lands on the step instead of being lost.
  await expect(stepCard(page)).toHaveText('Toss the pasta through the oil.');
  await expect(stepCard(page)).toBeFocused();
});
