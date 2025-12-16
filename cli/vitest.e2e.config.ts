import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/end-to-end/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    setupFiles: ['tests/end-to-end/setup.ts'],
  },
  resolve: {
    alias: [
      {
        find: '@renku/core',
        replacement: new URL('../core/src/index.ts', import.meta.url).pathname,
      },
      {
        find: '@renku/providers',
        replacement: new URL('../providers/src/index.ts', import.meta.url).pathname,
      },
    ],
  },
});
