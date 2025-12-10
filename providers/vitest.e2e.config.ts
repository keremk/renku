import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from providers directory
config({ path: resolve(__dirname, '.env') });

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
