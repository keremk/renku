import { defineConfig } from 'vitest/config';
import { loadEnv } from '@gorenku/core';

// Load .env from monorepo root
loadEnv(import.meta.url);

export default defineConfig({
  test: {
    name: 'integration',
    include: [
      'tests/integration/**/*.test.ts',
    ],
    exclude: ['node_modules'],
    environment: 'node',
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
