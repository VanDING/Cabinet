# Changesets

This directory contains changesets — structured descriptions of changes that will be used to determine version bumps and generate changelogs.

## Creating a changeset

```bash
pnpm changeset
```

Follow the prompts to select affected packages and describe the change (major / minor / patch).

## Usage in CI

When a PR with changesets is merged to `main`, the `changesets/action` GitHub Action will:
1. Open a "Version Packages" PR that bumps versions and updates CHANGELOGs
2. When that PR is merged, automatically publish changed packages to npm
