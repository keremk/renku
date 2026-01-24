import { defineConfig } from 'vitest/config';
import { loadEnv } from '@gorenku/core';

// Load .env from monorepo root
loadEnv(import.meta.url);

export default defineConfig({
  test: {
    name: 'e2e',
    include: [
      'tests/e2e/**/*.e2e.test.ts',
    ],
    exclude: ['node_modules'],
    environment: 'node',
    globals: true,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
