import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Use child_process fork pool to avoid better-sqlite3 native module
    // shutdown crash on Windows (v8::ToLocalChecked Empty MaybeLocal).
    pool: 'forks',
    exclude: ['**/bus.contract.test.ts', '**/dist/**', '**/node_modules/**'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 40,
        functions: 30,
        branches: 40,
        statements: 40,
      },
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/__tests__/**', 'src/**/__mocks__/**'],
    },
  },
});
