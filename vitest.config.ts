import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/shared',
      'apps/pos-web',
      { test: { name: 'tools', include: ['tools/**/*.test.mjs'], environment: 'node' } },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['apps/*/src/**', 'packages/*/src/**'],
      exclude: ['**/*.test.*', '**/test/**'],
    },
  },
});
