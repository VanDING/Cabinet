---
description: 'TypeScript coding standards and conventions'
globs: ['**/*.ts', '**/*.tsx']
tags: ['typescript', 'style']
---

# TypeScript Standards

## Compiler Flags (tsconfig.base.json)

- `strict: true` — never disable.
- `noUncheckedIndexedAccess: true` — all index access must handle undefined.
- `verbatimModuleSyntax: true` — use `import type` for type-only imports.
- Build with `tsc -b` (composite mode), not plain `tsc`.

## Code Style

- No JSDoc comment blocks unless explaining WHY (not WHAT).
- Prefer `interface` over `type` for object shapes in public APIs.
- Async functions must have explicit return type annotations on public API boundaries.
- Use `import type` for imports only used as types.
- No `any` without an explicit `// eslint-disable-next-line` comment explaining why.

## Barrel Exports

- Every package's `src/index.ts` is the public API surface.
- Internal implementation details stay in non-exported modules.
- Do not create `index.ts` files in subdirectories unless that subdirectory is a meaningful sub-package.
