import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'threads',
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
    include: ['server/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'server-dist'],
  },
});
