import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['**/dist/**', '**/node_modules/**'],
    include: ['**/*.test.ts'],
    pool: 'threads',
    singleThread: true,
  },
});
