---
description: "Git workflow: branch naming, commit format, PR requirements, forbidden operations"
tags: ["git", "workflow"]
---

# Git Workflow

## Commit Format

- Chinese or English accepted; stay consistent within a branch.
- First line: imperative summary under 72 characters.
- Body: what changed and why (not how).

## Forbidden Operations

- NEVER `git push --force` to `main`.
- NEVER skip hooks (`--no-verify`, `--no-gpg-sign`) unless the user explicitly requests it.
- NEVER amend published commits.
- NEVER run destructive commands (`git reset --hard`, `git clean -f`) without user confirmation.

## Branch Convention

- Feature branches: `feat/<description>` or `<username>/<description>`.
- Bug fixes: `fix/<description>`.
- Keep branches short-lived; merge frequently.

## Before Committing

- Run `pnpm typecheck` and `pnpm lint`.
- Run `pnpm test` for the packages you changed.
- Do NOT commit: `node_modules/`, `dist/`, `*.tsbuildinfo`, `src-tauri/target/`, `.env` files.
