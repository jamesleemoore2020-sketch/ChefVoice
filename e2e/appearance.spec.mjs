import { test, expect, TABS, tab, localRecipe, seedRecipes } from './fixtures.mjs';

// Dark mode (audit F26) and text contrast (F20), in a real browser: the device's colour
// scheme is emulated, and every piece of text on every tab is measured against what is
// actually drawn behind it.

/**
 * Text whose contrast with what is drawn behind it is below WCAG AA: 4.5:1, or 3:1 for large
 * text. Translucent layers are composited; a gradient is checked against each of its stops.
 * Skipped: text over photos, video or the hero artwork (the overlays there are fixed dark
 * scrims), emoji-only text, disabled controls (exempt in WCAG), anything not visible.
 */
async function lowContrastText(page) {
  return page.evaluate(() => {
    const parse = (css) => {
      const m = css && css.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1
    });
    const luminance = ({ r, g, b }) => {
      const ch = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [luminance(a), luminance(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    // The solid colours this element's text can sit on, or null over imagery.
    function backdrops(el) {
      const translucent = [];
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage && style.backgroundImage !== 'none') {
          if (style.backgroundImage.includes('url(')) return null;
          const stops = [...style.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0]));
          if (stops.length) return stops.map((stop) => translucent.reduceRight((acc, layer) => over(layer, acc), stop));
        }
        const colour = parse(style.backgroundColor);
        if (colour && colour.a > 0) {
          if (colour.a >= 1) return [translucent.reduceRight((acc, layer) => over(layer, acc), colour)];
          translucent.push(colour);
        }
      }
      return [translucent.reduceRight((acc, layer) => over(layer, acc), { r: 255, g: 255, b: 255, a: 1 })];
    }
    const failures = [];
    const imagery = '.hero,.community-hero,.community-card,.live-video-wrap,.sr-only';
    for (const el of document.querySelectorAll('#app *')) {
      const text = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
      if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
      if (el.closest(imagery) || el.closest('[disabled],[aria-disabled="true"]')) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!rect.width || !rect.height || style.visibility === 'hidden') continue;
      let faded = false;
      for (let node = el; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 1) faded = true;
      if (faded) continue;
      const colour = parse(style.color);
      const behind = backdrops(el);
      if (!colour || !behind) continue;
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const needed = large ? 3 : 4.5;
      for (const bg of behind) {
        const fg = colour.a < 1 ? over(colour, bg) : colour;
        const measured = ratio(fg, bg);
        if (measured < needed) {
          failures.push(`${measured.toFixed(2)}:1 "${text.slice(0, 40)}" <${el.tagName.toLowerCase()} class="${el.className}"> ${style.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
          break;
        }
      }
    }
    return failures;
  });
}

const PAGE_BACKGROUND = { light: 'rgb(255, 251, 248)', dark: 'rgb(5, 5, 5)' };
const pageBackground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

for (const scheme of ['light', 'dark']) {
  test.describe(`on a ${scheme} device`, () => {
    test.use({ colorScheme: scheme });

    test('every tab draws in the device theme with readable text', async ({ page }) => {
      await seedRecipes(page, [localRecipe()]);
      await page.goto('/');
      await expect(page.locator('#main .cook-wizard')).toBeVisible();
      expect(await pageBackground(page)).toBe(PAGE_BACKGROUND[scheme]);
      for (const name of TABS) {
        await tab(page, name).click();
        await expect(tab(page, name)).toHaveClass(/active/);
        expect(await lowContrastText(page), `${name} tab, ${scheme}`).toEqual([]);
      }
    });

    test('cook-along and every Cook step are readable', async ({ page }) => {
      await seedRecipes(page, [localRecipe()]);
      await page.goto('/');
      for (let step = 0; step < 5; step++) {
        expect(await lowContrastText(page), `Cook step ${step + 1}, ${scheme}`).toEqual([]);
        if (step < 4) await page.getByRole('button', { name: 'Next' }).click();
      }
      await tab(page, 'Recipes').click();
      await page.getByRole('button', { name: /Cook/ }).filter({ hasText: '🍳 Cook' }).first().click();
      await expect(page.locator('.cook-step-card')).toBeVisible();
      expect(await lowContrastText(page), `cook-along, ${scheme}`).toEqual([]);
    });
  });
}

test.describe('the Appearance choice in Profile', () => {
  test.use({ colorScheme: 'light' });

  test('Blackout on a light device is kept across a reload, and Auto hands back to the device', async ({ page }) => {
    await page.goto('/?tab=profile');
    const appearance = page.getByRole('group', { name: 'Appearance' });
    await expect(appearance.getByRole('radio', { name: 'Auto' })).toBeChecked();
    await expect(page.locator('#appearanceNote')).toHaveText('Light while your device is in light theme');

    await appearance.getByRole('radio', { name: 'Blackout' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await pageBackground(page)).toBe(PAGE_BACKGROUND.dark);
    await expect(page.locator('#appearanceNote')).toHaveText('Always Blackout: no bright white screens');
    await expect(page.locator('meta[name="theme-color"][data-scheme="light"]')).toHaveAttribute('content', '#050505');

    // theme-boot.js applies the choice from <head>, before app.js has run. (The reload opens
    // on Cook: the app consumes ?tab= links.)
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    expect(await pageBackground(page)).toBe(PAGE_BACKGROUND.dark);
    await tab(page, 'Profile').click();
    await expect(page.getByRole('group', { name: 'Appearance' }).getByRole('radio', { name: 'Blackout' })).toBeChecked();
    expect(await lowContrastText(page), 'Profile, chosen Blackout').toEqual([]);

    await page.getByRole('group', { name: 'Appearance' }).getByRole('radio', { name: 'Auto' }).check();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await pageBackground(page)).toBe(PAGE_BACKGROUND.light);
  });

  test('the choice is a real radio group: arrow keys move it', async ({ page }) => {
    await page.goto('/?tab=profile');
    const appearance = page.getByRole('group', { name: 'Appearance' });
    await appearance.getByRole('radio', { name: 'Auto' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(appearance.getByRole('radio', { name: 'Light' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('ArrowRight');
    await expect(appearance.getByRole('radio', { name: 'Blackout' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('the Appearance choice on a dark device', () => {
  test.use({ colorScheme: 'dark' });

  test('Light wins over the device, and nothing on Profile is unreadable', async ({ page }) => {
    await page.goto('/?tab=profile');
    await expect(page.locator('#appearanceNote')).toHaveText('Blackout while your device is in dark theme');
    await page.getByRole('group', { name: 'Appearance' }).getByRole('radio', { name: 'Light' }).check();
    expect(await pageBackground(page)).toBe(PAGE_BACKGROUND.light);
    expect(await lowContrastText(page), 'Profile, chosen Light on a dark device').toEqual([]);
  });
});
