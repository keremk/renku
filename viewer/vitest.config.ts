import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'threads',
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
    include: ['server/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', 'server-dist'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@gorenku/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@gorenku/providers': path.resolve(__dirname, '../providers/src/index.ts'),
      '@gorenku/compositions': path.resolve(
        __dirname,
        '../compositions/src/index.ts'
      ),
    },
  },
});
