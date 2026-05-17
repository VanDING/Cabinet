---
description: 'Testing conventions: Vitest, test location, coverage expectations'
globs: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/__tests__/**']
tags: ['testing']
---

# Testing Conventions

## Test Runner

- Vitest for all packages: `vitest run` (single run), `vitest` (watch mode).
- E2E tests in `tests/e2e/` use Vitest as well.

## Test Location

- Unit tests: co-located in `__tests__/` subdirectory alongside the source.
- Test files: `*.test.ts` or `*.test.tsx`.
- E2E tests: `tests/e2e/` directory at repo root.

## Expectations

- New features must include at least one integration-level test.
- Bug fixes must include a regression test.
- Snapshot tests (`insta`-like) for UI components — update snapshots in the same PR.
- Tests must be deterministic: no `setTimeout`, no random values without seeded RNG, no network calls (mock them).

## Running Tests

```bash
# Single package
pnpm -F @cabinet/agent test

# All packages
pnpm test

# E2E
cd tests/e2e && vitest run
```
