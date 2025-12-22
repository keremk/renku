import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
  resolve: {
    alias: [
      {
        find: '@gorenku/core',
        replacement: new URL('../core/src/index.ts', import.meta.url).pathname,
      },
      {
        find: '@gorenku/providers',
        replacement: new URL('../providers/src/index.ts', import.meta.url).pathname,
      },
    ],
  },
});
