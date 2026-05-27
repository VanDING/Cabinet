# Contributing Guide

## Code of Conduct

Be respectful. Assume good intent. Focus on the work.

## Branch Strategy

- `main` — stable, deployable
- `feat/*` — new features
- `fix/*` — bug fixes
- `docs/*` — documentation only

Always branch from `main`. Keep branches short-lived (1-3 days).

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): message
```

| type       | use case                            |
| ---------- | ----------------------------------- |
| `feat`     | new feature (minor bump)            |
| `fix`      | bug fix (patch bump)                |
| `refactor` | code change without behavior change |
| `docs`     | documentation only                  |
| `test`     | adding or updating tests            |
| `chore`    | maintenance, dependencies           |
| `ci`       | CI/CD changes                       |

## Pull Request Process

1. Create a branch from `main`
2. Make changes with conventional commit messages
3. Run `pnpm typecheck && pnpm test && pnpm test:e2e` locally
4. Push and open a PR
5. Ensure CI passes (lint → typecheck → test → build)
6. Request review from a maintainer

## Changesets

When making changes that affect published packages, create a changeset:

```bash
pnpm changeset
```

This prompts you to:

1. Select affected packages
2. Choose bump level (major / minor / patch)
3. Write a description of the change

The changeset file is committed alongside your code. On merge to `main`, the release workflow opens a Version Packages PR. When that PR is merged, packages are published to npm automatically.

## Development Setup

```bash
git clone https://github.com/cabinet/cabinet.git
cd cabinet
pnpm install
pnpm build
```

### Useful Commands

| Command          | Purpose                 |
| ---------------- | ----------------------- |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test`      | Run all unit tests      |
| `pnpm test:e2e`  | Run E2E API tests       |
| `pnpm lint`      | Lint all files          |
| `pnpm build`     | Build all packages      |
