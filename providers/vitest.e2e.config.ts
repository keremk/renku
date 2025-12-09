import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config();

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
