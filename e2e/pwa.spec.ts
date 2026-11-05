import { spawn, type ChildProcess } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import { PROD_URL } from '../playwright.config';
import { login, mockApi } from './mockApi';

/** Production build (`vite preview`): service worker, manifest, offline launch, speed. */

test('REQ-012: opening the app URL in desktop Chrome without installing renders the login screen', async ({ page }) => {
  await mockApi(page);
  await page.goto(PROD_URL);
  await expect(page.getByRole('button', { name: /Ramesh/ })).toBeVisible();
});

test('REQ-012: the manifest makes the installed app open full-screen (standalone) from the same URL', async ({ page, request }) => {
  await page.goto(PROD_URL);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(new URL(href!, PROD_URL).toString())).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  expect(manifest.icons?.length).toBeGreaterThan(0);
  expect(manifest.name).toBeTruthy();
});

/** Starts a private `vite preview` of the build so the test can switch "the network" (the server) off. */
async function startPrivateServer(port: number): Promise<ChildProcess> {
  const child = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort'],
    { cwd: 'apps/pos-web', stdio: 'ignore', detached: true });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${port}/`)).ok) return child; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('preview server did not start');
}

test('REQ-012: with the network off, launching the app shows the cached app shell, not a browser error', async ({ browser }) => {
  const port = 4299;
  const url = `http://localhost:${port}`;
  const server = await startPrivateServer(port);
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    // No page.route() here: request routing makes Chromium bypass the service worker.
    const page = await context.newPage();
    await page.goto(url);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    process.kill(-server.pid!, 'SIGTERM');
    await expect.poll(async () => { try { await fetch(url); return 'up'; } catch { return 'down'; } }).toBe('down');

    await page.goto(url);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.locator('main, .screen, .shell').first()).toBeVisible();
  } finally {
    await context.close();
    try { process.kill(-server.pid!, 'SIGTERM'); } catch { /* already stopped */ }
  }
});

/** Mid-range Android over local Wi-Fi: 4x slower CPU, 20 ms round trips. */
async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 3_000_000, uploadThroughput: 1_000_000 });
}

async function tableGridOpenMs(page: Page) {
  await page.locator('[data-action="tables"]').waitFor();
  const started = Date.now();
  await page.locator('[data-action="tables"]').click();
  await page.getByRole('button', { name: /^Table 12 Available/ }).waitFor();
  return Date.now() - started;
}

test('REQ-125: on a throttled mid-range phone profile the table grid opens in under 1 second', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await mockApi(page, { delayMs: 20 });
  await throttle(page);
  await page.goto(PROD_URL);
  await login(page);
  expect(await tableGridOpenMs(page)).toBeLessThan(1000);
  await context.close();
});

test('REQ-125: with 10 devices connected at once, every table grid still opens in under 1 second', async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 10 }, () => browser.newContext({ viewport: { width: 360, height: 800 } })));
  const pages = await Promise.all(contexts.map(async (c) => {
    const page = await c.newPage();
    await mockApi(page, { delayMs: 20 });
    await page.goto(PROD_URL);
    await login(page);
    return page;
  }));
  const times = await Promise.all(pages.map(tableGridOpenMs));
  for (const ms of times) expect(ms).toBeLessThan(1000);
  await Promise.all(contexts.map((c) => c.close()));
});
