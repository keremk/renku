import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
  resolve: {
    alias: [
      {
        find: '@gorenku/movie-core',
        replacement: new URL('../movie-core/src/index.ts', import.meta.url).pathname,
      },
    ],
  },
});
