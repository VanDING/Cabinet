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
      'apps/desktop/src-tauri/resources/frontend/**',
      'apps/server/bundle/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
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
      complexity: ['warn', 50],
      'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
      'max-depth': ['warn', 5],
      'max-params': ['warn', 7],
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
      'packages/cli/**/*.ts', // CLI user-facing output
      '**/themes/**/*.ts', // build-time CSS generation
      '**/generate-css.ts', // build-time CSS generation
      'packages/agent/src/daemon/**/*.ts', // fallback logger
      'packages/agent/src/trace.ts', // tracing utility uses console
      'packages/agent/src/tools/**/*.ts', // tool registration (API type compat)
      'packages/gateway/src/ai-sdk-adapter.ts', // Vercel AI SDK type compatibility
      'packages/secretary/src/**/*.ts', // intent matching (complexity) + dynamic dispatch
      'packages/workflow/src/**/*.ts', // workflow engine (complexity, any for flexibility)
      'packages/memory/src/**/*.ts', // memory serialization (any for generic storage)
      'packages/decision/src/**/*.ts', // policy engine (complexity)
      'packages/storage/src/**/*.ts', // repo layer (any for DB row mapping)
      'packages/events/src/**/*.ts', // event bus (any for generic payloads)
      'packages/agent/src/**/*.ts', // agent core (any for LLM response flexibility)
      'packages/harness/src/**/*.ts', // harness (any for evaluation flexibility)
      'packages/agent-sdk/src/**/*.ts', // external SDK (any for protocol compat)
      'packages/types/src/**/*.ts', // type definitions (any for generic types)
      'packages/ui/src/**/*.tsx', // UI components (React patterns)
      'apps/server/src/**/*.ts', // server routes (any for Hono wrappers)
      'apps/desktop/src/**/*.{ts,tsx}', // desktop UI (React patterns, any for Tauri)
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react-refresh/only-export-components': 'off',
      'react-hooks/exhaustive-deps': 'off',
      complexity: 'off',
      'max-lines': 'off',
      'max-depth': 'off',
      'max-params': 'off',
    },
  },
);
