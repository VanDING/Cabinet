import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Use child_process fork pool to avoid better-sqlite3 native module
    // shutdown crash on Windows (v8::ToLocalChecked Empty MaybeLocal).
    pool: 'forks',
    exclude: ['**/bus.contract.test.ts', '**/dist/**', '**/node_modules/**'],
  },
});
