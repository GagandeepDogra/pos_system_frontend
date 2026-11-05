import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DEV_URL } from '../playwright.config';

/** Every staff screen, rendered with sample data by the dev-only screen previews. */
export const STAFF_SCREENS = [
  'dashboard', 'dashboard-admin', 'dashboard-kitchen', 'tables', 'choose-food', 'order', 'kitchen', 'kitchen-dark',
  'bills', 'payment', 'takeaway',
  'admin-reports', 'admin-menu', 'admin-prices', 'admin-tables', 'admin-staff', 'admin-history', 'admin-dayClose',
  'admin-backup', 'admin-settings', 'admin-device',
];

async function open(page: Page, screen: string) {
  // The previews never need a server, but the connection poll does: answer /health green.
  await page.route('**/api/v1/health', (r) => r.fulfill({ json: { status: 'green' } }));
  await page.goto(`${DEV_URL}/#/design/${screen}`);
  await page.locator('main').first().waitFor();
  await page.waitForLoadState('networkidle');
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const screen of STAFF_SCREENS) {
  test.describe(screen, () => {
    test(`REQ-134: WCAG 2.1 AA audit has no violations (${screen})`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await open(page, screen);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });

    test(`REQ-013: no horizontal scroll at 360 px (${screen})`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await open(page, screen);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    // 200% browser zoom halves the CSS viewport and doubles the device pixel ratio.
    for (const width of [1280, 1024, 768]) {
      test(`REQ-134: at 200% zoom of ${width} px nothing scrolls sideways and the primary button is whole (${screen})`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: width / 2, height: 400 }, deviceScaleFactor: 2 });
        const page = await context.newPage();
        await open(page, screen);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        const viewportWidth = width / 2;
        for (const box of await page.locator('.btn--primary').evaluateAll((els) =>
          els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, sw: el.scrollWidth, cw: el.clientWidth }; }))) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(viewportWidth + 0.5);
          expect(box.sw, 'button text is not clipped').toBeLessThanOrEqual(box.cw + 1);
        }
        await context.close();
      });
    }
  });
}

test('REQ-013: the table grid switches from 2 to 4 columns between 767 and 768 px, and to 6 at 1024', async ({ page }) => {
  const columns = () => page.locator('.table-grid').first().evaluate((el) =>
    getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
  await page.setViewportSize({ width: 767, height: 900 });
  await open(page, 'tables');
  expect(await columns()).toBe(2);
  await page.setViewportSize({ width: 768, height: 900 });
  expect(await columns()).toBe(4);
  await page.setViewportSize({ width: 1023, height: 900 });
  expect(await columns()).toBe(4);
  await page.setViewportSize({ width: 1024, height: 900 });
  expect(await columns()).toBe(6);
});
