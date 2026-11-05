import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * Browser gate (cross-browser, accessibility, layout, speed, PWA).
 *
 * Local run (`npm run e2e`): Chromium against two servers that this config starts:
 *  - the Vite dev server (sample-data screen previews at `#/design/<screen>`, API mocked per test)
 *  - `vite preview` of the production build (service worker, manifest, offline launch).
 *
 * BrowserStack run (`npm run e2e:browserstack`, needs BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY and
 * BrowserStack Local so the remote browsers reach localhost): adds the supported-browser matrix.
 */
const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 5199);
const PROD_PORT = Number(process.env.E2E_PROD_PORT ?? 4199);
export const DEV_URL = `http://localhost:${DEV_PORT}`;
export const PROD_URL = `http://localhost:${PROD_PORT}`;

function browserstack(name: string, caps: Record<string, string>, use: Project['use'] = {}): Project {
  const all = {
    ...caps,
    'browserstack.username': process.env.BROWSERSTACK_USERNAME ?? '',
    'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY ?? '',
    'browserstack.local': 'true',
    project: 'Dhaba POS', build: process.env.BROWSERSTACK_BUILD ?? 'pos-web gate',
  };
  return {
    name,
    use: { ...use, connectOptions: { wsEndpoint: `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(all))}` } },
  };
}

const remote: Project[] = process.env.BROWSERSTACK_USERNAME ? [
  browserstack('bs-windows-chrome', { os: 'Windows', os_version: '11', browser: 'chrome', browser_version: 'latest' }),
  browserstack('bs-windows-edge', { os: 'Windows', os_version: '11', browser: 'edge', browser_version: 'latest' }),
  browserstack('bs-android10-chrome', { deviceName: 'Samsung Galaxy A51', osVersion: '10.0', browserName: 'chrome', realMobile: 'true' }),
  // iOS 15 Safari = WebKit 15 on BrowserStack's macOS Monterey (Safari 15) at a phone viewport.
  browserstack('bs-ios15-safari', { os: 'osx', os_version: 'Monterey', browser: 'playwright-webkit' }, { viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true }),
] : [];

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...remote,
  ],
  webServer: [
    {
      command: `npx vite --port ${DEV_PORT} --strictPort`,
      cwd: 'apps/pos-web',
      url: DEV_URL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PROD_PORT} --strictPort`,
      cwd: 'apps/pos-web',
      url: PROD_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
