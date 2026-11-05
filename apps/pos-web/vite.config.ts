/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emits sw.js at build time with the full list of built files, so the
 * service worker precaches the whole app shell for offline launch.
 */
function serviceWorker(): Plugin {
  return {
    name: 'dhaba-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).map((f) => `/${f}`);
      const shell = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', ...files];
      const template = readFileSync(fileURLToPath(new URL('./src/pwa/sw-template.js', import.meta.url)), 'utf8');
      const version = Date.now().toString(36);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__PRECACHE__', JSON.stringify(shell))
          .replace('__VERSION__', version),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: {
      '/api': process.env.POS_API_URL ?? 'http://localhost:3000',
      // Realtime events (Socket.IO) from the same server.
      '/socket.io': { target: process.env.POS_API_URL ?? 'http://localhost:3000', ws: true },
    },
  },
  test: {
    name: 'pos-web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Process CSS so design-rule tests can read the stylesheets through `?raw`.
    css: true,
  },
});
