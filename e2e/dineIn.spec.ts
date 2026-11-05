import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DEV_URL } from '../playwright.config';
import { login, mockApi } from './mockApi';

/** Counts every tap (pointer press) the user makes from the moment counting starts. */
async function countTaps(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __taps: number }).__taps = 0;
    document.addEventListener('pointerdown', () => { (window as unknown as { __taps: number }).__taps += 1; }, true);
  });
  return () => page.evaluate(() => (window as unknown as { __taps: number }).__taps);
}

async function dineInThreeItems(page: Page) {
  const log = await mockApi(page);
  await page.goto(DEV_URL);
  await login(page);
  await expect(page.locator('[data-action="tables"]')).toBeVisible();
  const taps = await countTaps(page);
  const started = Date.now();

  await page.locator('[data-action="tables"]').click();
  await page.getByRole('button', { name: /^Table 01 Available/ }).click();
  for (const name of ['Dal Makhani', 'Tandoori Roti', 'Sweet Lassi']) {
    await page.locator('.food-card', { hasText: name }).getByRole('button', { name: 'Add +' }).click();
  }
  await page.getByRole('button', { name: 'Send to Kitchen →' }).click();
  await expect(page.getByText('Sent to kitchen. KOT 1')).toBeVisible();

  return { taps: await taps(), seconds: (Date.now() - started) / 1000, log };
}

for (const width of [360, 768, 1024]) {
  test(`REQ-133 REQ-135: a 3-item dine-in order reaches the kitchen in at most 8 taps and under 30 s at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const { taps, seconds, log } = await dineInThreeItems(page);
    expect(taps).toBeLessThanOrEqual(8);
    expect(seconds).toBeLessThan(30);
    expect(log.kots).toHaveLength(1);
    expect(JSON.stringify(log.kots[0])).toContain('v-i3');
  });
}

test('REQ-134: the dine-in flow passes at 200% zoom', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const { taps } = await dineInThreeItems(page);
  expect(taps).toBeLessThanOrEqual(8);
  await context.close();
});

test('REQ-134: the login screen has no WCAG 2.1 AA violations and no horizontal scroll at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockApi(page);
  await page.goto(DEV_URL);
  await page.getByRole('button', { name: /Ramesh/ }).waitFor();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: /Ramesh/ }).click();
  const pin = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(pin.violations.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
