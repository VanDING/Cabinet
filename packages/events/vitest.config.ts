import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['**/bus.contract.test.ts', '**/dist/**', '**/node_modules/**'],
  },
});
