# Development Guide

## Environment Setup

```bash
# Install dependencies
pnpm install

# Build all packages (required before running apps)
pnpm build

# Type-check the entire monorepo
pnpm typecheck

# Run all tests
pnpm test
```

## Running in Development

### Full Stack (Desktop + Server)

```bash
# Terminal 1 — backend with hot reload
cd apps/server && pnpm dev

# Terminal 2 — desktop app (Vite + Tauri dev mode)
cd apps/desktop && pnpm tauri:dev
```

The server runs on `http://localhost:3000`. The desktop app loads the UI from Vite's dev server and communicates with the backend via HTTP and WebSocket.

### Server Only

```bash
cd apps/server
pnpm dev
```

Useful for headless testing or when working on API endpoints.

### Desktop Web Mode (No Tauri)

```bash
cd apps/desktop
pnpm dev
```

Runs the React app in the browser. Native APIs (system dialog, auto-updater) are stubbed.

## Testing Strategy

| Level           | Target                           | Tool       | Location                     |
| :-------------- | :------------------------------- | :--------- | :--------------------------- |
| **Unit**        | Individual functions, pure logic | Vitest     | `packages/*/src/__tests__/`  |
| **Integration** | Cross-package core flows         | Vitest     | `apps/server/src/__tests__/` |
| **E2E**         | Full user flows                  | Playwright | `tests/e2e/`                 |

### Running Specific Test Suites

```bash
# All package tests
pnpm test

# E2E tests
pnpm test:e2e

# Watch mode for a specific package
cd packages/agent && pnpm test --watch
```

### Test Database

Integration tests use an in-memory SQLite instance seeded with test fixtures. The `storage` package exposes a test helper to create isolated database instances:

```ts
import { createTestDatabase } from '@cabinet/storage';

const db = createTestDatabase();
// Run tests...
db.destroy();
```

## Code Conventions

### Type Safety

- **No `any`**. All API boundaries use Zod schemas.
- Shared types live in `@cabinet/types`. Do not redefine the same type in multiple packages.
- Use `satisfies` for literal objects when inference is sufficient.

### Error Handling

Every async operation must be wrapped in `try-catch`. Error logs must include:

```ts
logger.error('Operation failed', {
  operation: 'createDecision',
  input: { title: input.title },
  error: err.message,
  stack: err.stack,
});
```

### State Machines

When implementing state machines (e.g., decisions, workflows), handle three paths explicitly:

1. **Normal path** — expected transition
2. **Exception path** — invalid transition attempt
3. **Boundary path** — terminal state behavior

The `Decision` state machine in `@cabinet/types` is the canonical example:

```ts
[DecisionStatus.Pending]: [
  DecisionStatus.Approved,
  DecisionStatus.Rejected,
  DecisionStatus.Expired,
],
[DecisionStatus.Rejected]: [DecisionStatus.Archived, DecisionStatus.Pending],
```

### Module Boundaries

- Lower-layer packages **must not** import from upper layers.
- Same-layer packages communicate through `@cabinet/events` or explicit interfaces.
- Never bypass the `LLMGateway` interface to call provider SDKs directly from business logic.

## Debugging

### Structured Logs

Logs are written as JSON to `~/.cabinet/logs/` and roll daily. In development, the server also prints colorized output to stdout.

### WebSocket Events

Open the browser DevTools Network tab and filter by `WS` to observe real-time events. Event types follow the `MessageType` enum in `@cabinet/types`.

### Context Window Monitoring

The `ContextMonitor` (`@cabinet/agent`) exposes snapshots of token usage per session. Access via:

```ts
import { ContextMonitor, DEFAULT_WINDOW_CONFIG } from '@cabinet/agent';
const monitor = new ContextMonitor(DEFAULT_WINDOW_CONFIG);
const snapshot = monitor.snapshot(messages, modelName);
console.log(snapshot.zone); // 'smart' | 'warning' | 'critical' | 'dumb'
```

### Budget Alerts

During development, budget limits are checked per-call. If you hit a limit, either:

- Adjust the cap in `Settings > Budget`
- Temporarily switch to `T3 FullAutonomy` delegation tier

## Database Migrations

Migrations live in `packages/storage/src/migrations/`. They use better-sqlite3 and must be idempotent.

Migrations live in `packages/storage/src/migrations/`. They use better-sqlite3 and must be idempotent. Add new migrations by creating sequentially numbered `.sql` files in the migrations directory.

## Adding a New Package

1. Create the directory under `packages/<name>/`
2. Add `package.json` with `"name": "@cabinet/<name>"`
3. Reference `tsconfig.base.json` for shared compiler options
4. Export public APIs from `src/index.ts`
5. Add tests in `src/__tests__/`
6. Register the package in `pnpm-workspace.yaml` if not already covered by the wildcard

## Common Pitfalls

| Pitfall                        | Prevention                                                                                      |
| :----------------------------- | :---------------------------------------------------------------------------------------------- |
| Bypassing `LLMGateway`         | Always route LLM calls through the gateway; never import Anthropic/OpenAI SDKs in business code |
| Scattered type definitions     | If two packages need the same type, it belongs in `@cabinet/types`                              |
| Missing error context          | Every `catch` block must log the operation name, input summary, and error message               |
| Implicit cross-module coupling | Use the EventBus or explicit interfaces; no global variables                                    |
| Skipping safety checks         | The `SafetyChecker` runs automatically inside `AgentLoop`; do not short-circuit it              |
