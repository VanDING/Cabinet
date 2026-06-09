---
description: 'Core architecture constraints: 4-layer dependency rule, package naming, tech stack'
alwaysApply: true
tags: ['architecture', 'constraints']
---

# Core Architecture Rules

## 4-Layer Dependency Direction

```
Layer 4 (Interface):   ui, server, desktop, cli
Layer 3 (Business):    decision, secretary, workflow, harness, organize
Layer 2 (Agent Core):  gateway, agent, memory, agent-sdk
Layer 1 (Infra):       graph, types, events, storage
```

- Lower layers NEVER import from upper layers.
- Same-layer imports are allowed.
- `@cabinet/types` is the only package that ALL layers can depend on.
- When creating a new package, declare its layer and ensure all deps point same-layer or lower.

## Package Conventions

- All packages use `@cabinet/` scope.
- Public API exported via barrel `index.ts`.
- Internal modules must NOT be imported directly by other packages.
- New packages must be added to `pnpm-workspace.yaml`.

## Module Size

- Target: under 500 lines per file (excluding tests).
- Hard limit: 800 lines — split into a new module.
