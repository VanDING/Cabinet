import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      '**/.claude/**',
      '**/coverage/**',
      'apps/desktop/src-tauri/target/**',
      'apps/desktop/src-tauri/resources/server-dist/**',
      'apps/server/bundle/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'import': importPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Complexity guardrails (warn only — do not block builds)
      'complexity': ['warn', 15],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
      // Prevent circular dependencies
      'import/no-cycle': ['warn', { maxDepth: 3 }],
    },
  },
  {
    files: [
      'tools/**/*.ts',
      '**/scripts/**/*.mjs',
      'tests/**/*.ts',
      '**/__tests__/**/*.{ts,tsx}',
      '**/__mocks__/**/*.{ts,tsx}',
      '**/migrations/**/*.ts',
      'packages/cli/**/*.ts',          // CLI user-facing output
      '**/themes/**/*.ts',             // build-time CSS generation
      '**/generate-css.ts',            // build-time CSS generation
      'packages/agent/src/daemon/**/*.ts',  // fallback logger
      'packages/agent/src/trace.ts',        // tracing utility uses console
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
