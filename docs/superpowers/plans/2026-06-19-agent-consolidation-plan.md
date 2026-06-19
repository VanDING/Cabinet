# Agent System Consolidation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix security issues, architectural smells, and fill critical test gaps across the Agent subsystem (daemon, routes, harness, SDK).

**Architecture:** The Agent system spans 4 packages and 2 apps. Tasks are organized by subsystem and can be implemented independently within phases. Phase 1 (security/correctness) must precede Phase 3 (daemon refactoring) if it touches the same files, but otherwise all phases are parallelizable.

**Tech Stack:** TypeScript strict, Hono, better-sqlite3, Vitest, Zod

---

## File Map

Key files that will be created or modified:

| File                                                    | Role                                       |
| ------------------------------------------------------- | ------------------------------------------ |
| `apps/server/src/routes/external-agent.ts`              | HMAC default secret, childSession scan bug |
| `apps/server/src/routes/agents.ts`                      | A2AClient singleton, message stub cleanup  |
| `apps/server/src/context.ts`                            | A2AClient migration target                 |
| `packages/agent/src/daemon/agent-daemon/internal.ts`    | `AgentDaemonState` interface cleanup       |
| `packages/agent/src/daemon/agent-daemon/daemon.ts`      | 410-line class, split further              |
| `packages/agent/src/daemon/agent-daemon/adapters.ts`    | Minor consistency fix                      |
| `packages/agent/src/daemon/agent-daemon/execution.ts`   | Minor consistency fix                      |
| `packages/agent/src/daemon/task-queue-poller.ts`        | Concurrency safety                         |
| `packages/agent/src/daemon/auto-discoverer.ts`          | Registration path validation               |
| `apps/desktop/src/pages/EmployeesPage.tsx`              | UI improvement                             |
| `apps/desktop/src/pages/settings/ExternalAgentsTab.tsx` | Enhance or merge                           |
| `packages/agent/src/adapters/cli-adapter.ts`            | Minor deprecation note                     |
| `Dockerfile`                                            | Remove meeting ref                         |
| `scripts/publish.sh`                                    | Remove meeting ref                         |
| `packages/agent-sdk/package.json`                       | Deprecation decision                       |

---

## Phase 1: Security & Correctness (P0-P1)

### Task 1.1: HMAC Default Secret → Production-Ready Secret Management

**Files:**

- Modify: `apps/server/src/routes/external-agent.ts:47,58`

**Issue:** `CABINET_SECRET` env var defaults to `'cabinet-dev-secret'` in all environments. In production, if this env var is not explicitly set (easy to forget), the HMAC is trivially forgeable.

- [ ] **Step 1: Remove hardcoded fallback and force env-var requirement on production**

Replace the two occurrences:

```typescript
// Line 47 — inside validateTaskToken()
const secret = process.env.CABINET_SECRET;
if (!secret) {
  // In dev, use a warn-level fallback. In prod, reject.
  if (process.env.NODE_ENV === 'production') {
    return { valid: false };
  }
  return { valid: token.length >= 40 }; // dev-only weak check: require longer tokens
}
const expected = crypto.createHmac('sha256', secret).update(taskId).digest('hex').slice(0, 16);
```

```typescript
// Line 58 — inside generateTaskToken()
const secret = process.env.CABINET_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CABINET_SECRET is required in production');
  }
  // Dev fallback — generate per-run token
  const devSecret = `cabinet-dev-${Date.now()}`;
  const hmac = crypto.createHmac('sha256', devSecret).update(taskId).digest('hex').slice(0, 16);
  return `task_${taskId}_${hmac}`;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd apps/server && npx vitest run --reporter=verbose 2>&1 | head -40`

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/external-agent.ts
git commit -m "fix: require CABINET_SECRET in production for HMAC tokens"
```

### Task 1.2: Fix childSession Linear Scan Bug

**Files:**

- Modify: `apps/server/src/routes/external-agent.ts:128-131,290-293`

**Issue:** In `POST /api/slot/:taskId/write` (line 128-131) and `POST /api/external/deliverables` (line 290-293), the code scans ALL sessions linearly with a fragile `agentType?.startsWith('external_')` filter. This is O(n), yields wrong session on concurrent tasks, and misses the task-level association entirely (the `taskId` from the URL or body is ignored for session lookup).

**Fix:** Use the `taskId` from the request to find the correct session (or create a sessionByTaskId index).

- [ ] **Step 1: Add a `getSessionByTaskId(taskId)` method to SessionManager (or use existing lookup)**

First, check if SessionManager already has a task-to-session mapping:

Read `@cabinet/storage` session manager types:

```bash
grep -n "getSession\|findByTask\|sessionByTask\|taskToSession" packages/storage/src/**/*.ts
```

If it doesn't exist, add a `Map<string, string>` (taskId → sessionId) to `SessionManager`:

```typescript
// In packages/storage or wherever SessionManager lives
class SessionManager {
  private taskSessions = new Map<string, string>();

  /** Associate a task ID with a session ID. */
  associateTask(taskId: string, sessionId: string): void {
    this.taskSessions.set(taskId, sessionId);
  }

  /** Look up a session by task ID. */
  getSessionByTaskId(taskId: string): Session | undefined {
    const sessionId = this.taskSessions.get(taskId);
    if (!sessionId) return undefined;
    // ... resolve from sessions map
  }
}
```

- [ ] **Step 2: Replace the linear scan in slot write handler**

```typescript
// Before (lines 128-131):
const sessions = sessionManager.list();
const childSession = sessions.find(
  (s) => s.contextSlot !== undefined && s.agentType?.startsWith('external_'),
);

// After:
const childSession =
  sessionManager.getSessionByTaskId(taskId) ||
  sessionManager.list().find((s) => s.id === taskId && s.contextSlot !== undefined);
```

- [ ] **Step 3: Replace the linear scan in deliverables handler**

Same pattern at lines 290-293.

- [ ] **Step 4: Run tests**

Run: `cd apps/server && npx vitest run --reporter=verbose 2>&1 | head -40`

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/external-agent.ts
git commit -m "fix: replace childSession linear scan with taskId lookup"
```

### Task 1.3: Fix AgentDaemon Concurrency Safety in TaskQueuePoller

**Files:**

- Modify: `packages/agent/src/daemon/task-queue-poller.ts`

**Issue:** `tick()` has no concurrency guard — if the poll interval is shorter than `onPoll()` execution time, overlapping polls can claim the same task or exceed maxConcurrency.

- [ ] **Step 1: Add a running guard**

```typescript
export class TaskQueuePoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentIntervalMs: number;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private wsDisconnected = true;
  private running = false; // ← add

  // ... existing constructor

  private async tick(): Promise<void> {
    if (!this.wsDisconnected) return;
    if (this.running) return; // ← skip overlapping polls
    this.running = true;
    try {
      const claimed = await this.onPoll();
      if (claimed) {
        this.adjustInterval(this.minIntervalMs);
      } else {
        this.adjustInterval(Math.min(this.currentIntervalMs * 2, this.maxIntervalMs));
      }
    } catch {
      // non-fatal
    } finally {
      this.running = false; // ← release
    }
  }
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `cd packages/agent && npx tsc --noEmit --pretty 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/daemon/task-queue-poller.ts
git commit -m "fix: add concurrency guard to TaskQueuePoller tick"
```

---

## Phase 2: Route & Server Cleanup (P1-P2)

### Task 2.1: Migrate A2AClient from Module-Level Singleton to Server Context

**Files:**

- Modify: `apps/server/src/routes/agents.ts:14-21`
- Modify: `apps/server/src/context.ts`

**Issue:** `A2AClient` is instantiated as a module-level singleton via `let a2aClient` + `getA2AClient()`. This breaks DI, makes testing impossible, and persists across requests. It should live in `ServerContext`.

- [ ] **Step 1: Check existing ServerContext interface**

```bash
grep -n "interface ServerContext\|class ServerContext\|export.*context" apps/server/src/context.ts | head -20
```

Read the relevant section of context.ts:

```bash
sed -n '1,50p' apps/server/src/context.ts
```

- [ ] **Step 2: Add a2aClient to ServerContext**

```typescript
// In apps/server/src/context.ts
import { A2AClient } from './a2a/a2a-client.js';

export interface ServerContext {
  // ... existing fields
  a2aClient: A2AClient;
}
```

Initialize in the context factory:

```typescript
a2aClient: new A2AClient(logger),
```

- [ ] **Step 3: Replace module-level singleton in agents.ts**

```typescript
// Remove lines 14-21 (let a2aClient, getA2AClient function)

// In the discover handler (line 250):
const { a2aClient } = getServerContext(); // instead of const client = getA2AClient();
```

- [ ] **Step 4: Clean up unused imports**

Remove any imports that were only used for the old singleton pattern.

- [ ] **Step 5: Run tests**

Run: `cd apps/server && npx vitest run --reporter=verbose 2>&1 | head -20`

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/agents.ts apps/server/src/context.ts
git commit -m "refactor: move A2AClient singleton to ServerContext"
```

### Task 2.2: Clean Up agents.ts Message Stubs

**Files:**

- Modify: `apps/server/src/routes/agents.ts:256-293`

**Issue:** `POST /api/agents/message` (line 256-266) and `POST /api/agents/message/stream` (line 268-293) are stubs that echo input back. They claim to implement A2A protocol but don't.

**Options:** (a) Implement real A2A message dispatch, or (b) mark as deprecated with clear TODO. Given scope, choose (b).

- [ ] **Step 1: Replace stubs with documented deprecation warnings**

```typescript
// Replace lines 256-266:
/**
 * A2A message endpoint — currently returns a stub response.
 * @deprecated A2A message routing is not yet implemented. Use AgentDispatcher instead.
 * TODO(CAB-XXX): Implement real A2A message dispatch via AgentDispatcher.
 */
agentsRouter.post('/message', async (c) => {
  const { logger } = getServerContext();
  logger.warn('A2A /message called but not yet implemented');
  return c.json(
    {
      error: 'not_implemented',
      message:
        'A2A message routing is not yet implemented. Use POST /api/agents/import to register agents, then use the Employees page to dispatch tasks.',
    },
    501,
  );
});
```

```typescript
// Replace lines 268-293 with the same pattern for /message/stream
agentsRouter.post('/message/stream', async (c) => {
  const { logger } = getServerContext();
  logger.warn('A2A /message/stream called but not yet implemented');
  return c.json(
    {
      error: 'not_implemented',
      message: 'A2A streaming is not yet implemented.',
    },
    501,
  );
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/server && npx vitest run --reporter=verbose 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/agents.ts
git commit -m "refactor: mark A2A message stubs as 501 not implemented"
```

---

## Phase 3: Daemon & Engine Cleanup (P1-P2)

### Task 3.1: Replace `AgentDaemonState` Cast Pattern with Proper Composition

**Files:**

- Modify: `packages/agent/src/daemon/agent-daemon/internal.ts`
- Modify: `packages/agent/src/daemon/agent-daemon/daemon.ts`
- Modify: `packages/agent/src/daemon/agent-daemon/execution.ts`
- Modify: `packages/agent/src/daemon/agent-daemon/adapters.ts`
- Modify: `packages/agent/src/daemon/agent-daemon/discovery.ts`
- Modify: `packages/agent/src/daemon/agent-daemon/metrics.ts`

**Issue:** `daemon.ts:104` uses `this as unknown as AgentDaemonState` to pass the full class instance as a plain interface to sub-module functions. This exposes private fields, makes interface boundaries unclear, and breaks if class shape changes.

**Fix:** Extract state into a proper `AgentDaemonState` object that's constructed separately and passed explicitly.

- [ ] **Step 1: Refactor `internal.ts` to include only mutable state (no methods)**

```typescript
export interface AgentDaemonState {
  taskRepo: AgentTaskQueueRepository;
  daemonRepo: AgentDaemonRepository;
  registry: AgentRoleRegistry;
  opts: Required<AgentDaemonOptions>;
  workspaceManager: WorkspaceManager;
  discoverer: AutoDiscoverer;
  adapterCache: Map<string, ExternalAgentAdapter>;
  harnessRuntimeCache: Map<string, HarnessRuntime>;
  activeTasks: Map<string, ExternalAgentAdapter>;
  startedAt: number;
  completedCount: number;
  failedCount: number;
  wsClient: WSDaemonClient | null;
  squadRouter: SquadRouter | null;
  processMetrics: Map<string, PidMetrics>;
  lastCpuUsage: ReturnType<typeof process.cpuUsage>;
  logger: Logger;
  /** Methods removed — these belong to AgentDaemon, not state */
}

export interface PidMetrics {
  pid: number;
  cpu: number;
  mem: number;
  ports: number[];
}

export interface Logger {
  info: (msg: string, ctx?: unknown) => void;
  warn: (msg: string, ctx?: unknown) => void;
  error: (msg: string, ctx?: unknown) => void;
}
```

- [ ] **Step 2: Remove `rowToEntry`, `getAdapter`, `getHarnessRuntime`, `buildHarnessContext` from `AgentDaemonState`**

These are methods, not state. The sub-module functions (`execution.ts`, `adapters.ts`) should import and call their own utility functions directly.

- [ ] **Step 3: Create an `AgentDaemonState` builder in `daemon.ts`**

```typescript
// In daemon.ts constructor, after initializing fields:
private createState(): AgentDaemonState {
  return {
    taskRepo: this.taskRepo,
    daemonRepo: this.daemonRepo,
    registry: this.registry,
    opts: this.opts,
    workspaceManager: this.workspaceManager,
    discoverer: this.discoverer,
    adapterCache: this.adapterCache,
    harnessRuntimeCache: this.harnessRuntimeCache,
    activeTasks: this.activeTasks,
    startedAt: this.startedAt,
    completedCount: this.completedCount,
    failedCount: this.failedCount,
    wsClient: this.wsClient,
    squadRouter: this.squadRouter,
    processMetrics: this.processMetrics,
    lastCpuUsage: this.lastCpuUsage,
    logger: this.logger,
  };
}
```

- [ ] **Step 4: Replace `this as unknown as AgentDaemonState` with `this.createState()`**

In `daemon.ts`, replace:

```typescript
private get state(): AgentDaemonState {
  return this as unknown as AgentDaemonState;
}
```

with:

```typescript
private get state(): AgentDaemonState {
  return this.createState();
}
```

- [ ] **Step 5: Update sub-module functions to use imported utilities instead of state methods**

In `execution.ts`, replace `daemon.rowToEntry(row)` with a direct import:

```typescript
import { rowToEntry } from './conversion.js';
```

In `adapters.ts`, already uses standalone functions — verify they don't reference `daemon.rowToEntry` or `daemon.getAdapter` (should be `getAdapter(daemon, ...)`).

- [ ] **Step 6: Verify TS compiles**

Run: `cd packages/agent && npx tsc --noEmit --pretty 2>&1 | tail -20`

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/daemon/agent-daemon/
git commit -m "refactor: replace AgentDaemonState cast with proper composition"
```

### Task 3.2: Split daemon.ts Further

**Files:**

- Modify: `packages/agent/src/daemon/agent-daemon/daemon.ts` (410 lines → ~200)
- Create: `packages/agent/src/daemon/agent-daemon/tasks.ts` (task lifecycle methods)
- Create: `packages/agent/src/daemon/agent-daemon/status.ts` (status/ports/discovery delegation)

**Issue:** `daemon.ts` is 410 lines despite already having extracted sub-modules. It mixes: lifecycle (start/stop), task queue management (enqueue/cancel/retry/list/get), status reporting, port management, delegation methods, and state creation.

- [ ] **Step 1: Extract task management methods to `tasks.ts`**

Move to `tasks.ts`:

- `enqueueTask()`
- `cancelTask()`
- `retryTask()`
- `getTask()`
- `listTasks()`
- `executeAssignedTask()`
- The adapter cache and harness runtime cache management

```typescript
// tasks.ts
import type { ContextSlot, TaskQueueEntry } from '@cabinet/types';
import type { AgentDaemonState } from './internal.js';

export async function enqueueTask(
  daemon: AgentDaemonState,
  params: {
    agentId: string;
    sessionId: string;
    capability?: string;
    input: unknown;
    slot: ContextSlot;
    priority?: number;
    maxRetries?: number;
    timeoutMs?: number;
  },
): Promise<string> {
  // body from daemon.ts enqueueTask()
}

export function cancelTask(daemon: AgentDaemonState, taskId: string): boolean {
  // body from daemon.ts cancelTask()
}

// etc.
```

- [ ] **Step 2: Extract status/ports methods to `status.ts`**

Move to `status.ts`:

- `getStatus()`
- `getPorts()`
- `killOrphanPort()`
- `getDiscoveredAgents()`
- `triggerDiscovery()`
- `runWorkspaceGC()`

- [ ] **Step 3: Update `daemon.ts` to delegate to extracted functions**

```typescript
// daemon.ts — keeps only:
// - constructor
// - start() / stop()
// - state builder
// - setWSClient() / setSquadRouter() / setAgentRoleRepo()
// - getPoller()

async enqueueTask(params: ...): Promise<string> {
  return enqueueTask(this.state, params);
}
cancelTask(taskId: string): boolean {
  return cancelTask(this.state, taskId);
}
// etc.
```

- [ ] **Step 4: Verify TS compiles**

Run: `cd packages/agent && npx tsc --noEmit --pretty 2>&1 | tail -20`

- [ ] **Step 5: Run existing tests**

Run: `cd packages/agent && npx vitest run --reporter=verbose 2>&1 | tail -30`

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/daemon/agent-daemon/
git commit -m "refactor: split daemon.ts into daemon.ts + tasks.ts + status.ts"
```

### Task 3.3: Unify External Agent Registration Paths

**Files:**

- Modify: `packages/agent/src/daemon/auto-discoverer.ts`
- Modify: `apps/desktop/src/pages/EmployeesPage.tsx:111-136`

**Issue:** External CLI agents can be registered via two independent paths that don't coordinate:

1. **AutoDiscoverer** (daemon startup): Registers in `AgentRoleRegistry` directly
2. **EmployeesPage scan** (user-initiated): Posts to `/api/employees` which presumably stores in the employees DB table

Neither path checks the other's state. This can lead to:

- Duplicate registration (agent shows up twice)
- Inconsistent config (one path has command args, the other doesn't)

- [ ] **Step 1: Add a central `registerExternalAgent()` function in `packages/agent/src/agent-roles.ts`**

```typescript
// In agent-roles.ts
export function registerExternalAgent(
  registry: AgentRoleRegistry,
  params: {
    protocol: 'cli' | 'a2a';
    name: string;
    command?: string;
    baseUrl?: string;
    description: string;
    identity: string;
  },
): boolean {
  // Check if already registered
  if (registry.get(params.name)) return false;

  registry.register({
    type: params.protocol === 'cli' ? 'external_cli' : 'external_a2a',
    name: params.name,
    description: params.description,
    modules: { identity: params.identity },
    modelTier: 'default',
    temperature: 0.7,
    allowedTools: [],
    contextBudget: 0.3,
    external: {
      protocol: params.protocol,
      configSource: 'agent_native',
      ...(params.protocol === 'cli'
        ? { command: params.command!, args: ['--print'], timeoutMs: 300_000, maxRetries: 2 }
        : { baseUrl: params.baseUrl!, timeoutMs: 120_000, maxRetries: 2 }),
    },
  });
  return true;
}
```

- [ ] **Step 2: Have both paths call the central function**

In `auto-discoverer.ts`, replace inline registration with call to `registerExternalAgent()`.

In `EmployeesPage.tsx`, check if the scan handler should also call through `registerExternalAgent()` or if `/api/employees` POST is the intentional path (different from AgentRoleRegistry). If `/api/employees` is the correct path for user-initiated registration, add a comment explaining the two-path design and add a dedup check.

- [ ] **Step 3: Verify TS compiles**

Run: `cd packages/agent && npx tsc --noEmit --pretty 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/agent-roles.ts packages/agent/src/daemon/auto-discoverer.ts apps/desktop/src/pages/EmployeesPage.tsx
git commit -m "refactor: unify external agent registration paths"
```

---

## Phase 4: Frontend Cleanup (P2)

### Task 4.1: Enhance ExternalAgentsTab or Merge into EmployeesPage

**Files:**

- Modify: `apps/desktop/src/pages/settings/ExternalAgentsTab.tsx`

**Issue:** `ExternalAgentsTab.tsx` is a read-only view (45 lines) that points users to EmployeesPage. It's redundant — the only information it provides is a filter on `source.startsWith('external_')`.

**Option A** (recommended, simpler): Remove the tab entirely and redirect via a link or message in Settings.  
**Option B**: Make it a live-editable list.

Given the codebase pattern (Settings is for configuration, Employees is for CRUD), Option A is cleaner.

- [ ] **Step 1: Replace ExternalAgentsTab with a redirect card**

```typescript
// apps/desktop/src/pages/settings/ExternalAgentsTab.tsx
export function ExternalAgentsTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-content-tertiary">
        External agent management has moved to the Employees page.
      </p>
      <a
        href="/employees"
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-content-inverse hover:bg-accent-hover px-4 py-2 text-sm font-medium"
      >
        Go to Employees
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Verify the link works with the router**

Check the navigation route for EmployeesPage:

```bash
grep -n "Employees\|employees" apps/desktop/src/**/*.tsx | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/pages/settings/ExternalAgentsTab.tsx
git commit -m "refactor: replace ExternalAgentsTab with redirect to Employees"
```

---

## Phase 5: Test Coverage (P2-P3)

### Task 5.1: AgentDaemon Tests

**Files:**

- Create: `packages/agent/src/daemon/__tests__/agent-daemon.test.ts`

Test scope: claim and execute flow, orphan recovery, heartbeat, task lifecycle (enqueue → claim → running → completed/failed).

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentDaemon } from '../agent-daemon/daemon.js';
// ... mock repos

describe('AgentDaemon', () => {
  it('enqueueTask creates a pending task', async () => {
    // ...
  });

  it('executeTask transitions task through running→completed', async () => {
    // ...
  });

  it('recoverOrphanedTasks resets stale claims', () => {
    // ...
  });

  it('startHeartbeat writes heartbeat to DB on interval', async () => {
    // ...
  });

  it('getStatus returns daemon metrics', () => {
    // ...
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail initially**

Run: `cd packages/agent && npx vitest run --reporter=verbose packages/agent/src/daemon/__tests__/agent-daemon.test.ts 2>&1 | tail -20`

- [ ] **Step 3: Implement mocks and assertions**

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/agent && npx vitest run --reporter=verbose packages/agent/src/daemon/__tests__/agent-daemon.test.ts 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/daemon/__tests__/agent-daemon.test.ts
git commit -m "test: add AgentDaemon lifecycle tests"
```

### Task 5.2: external-agent.ts Route Tests

**Files:**

- Create: `apps/server/src/routes/__tests__/external-agent.test.ts`

Test scope: HMAC auth, slot read/write, decisions, deliverables — with mocked ServerContext.

- [ ] **Step 1: Check existing test patterns in apps/server**

```bash
ls apps/server/src/routes/__tests__/
```

- [ ] **Step 2: Write route tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { externalAgentRouter } from '../external-agent.js';
// ... test Hono app with mocked context

describe('POST /api/slot/:taskId/write', () => {
  it('rejects missing Authorization header', async () => {
    // ...
  });

  it('rejects invalid HMAC token', async () => {
    // ...
  });

  it('accepts valid discoveries payload', async () => {
    // ...
  });
});

describe('POST /api/external/decisions', () => {
  it('creates a decision from valid payload', async () => {
    // ...
  });

  it('rejects missing title', async () => {
    // ...
  });
});

describe('POST /api/external/deliverables', () => {
  it('stores deliverable from valid payload', async () => {
    // ...
  });
});
```

- [ ] **Step 3: Run tests to verify pass**

Run: `cd apps/server && npx vitest run --reporter=verbose apps/server/src/routes/__tests__/external-agent.test.ts 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/__tests__/external-agent.test.ts
git commit -m "test: add external-agent route tests"
```

### Task 5.3: SquadRouter Tests

**Files:**

- Create: `packages/agent/src/daemon/squad/__tests__/squad-router.test.ts`

Test scope: all 4 routing strategies (auto, round_robin, skill_match, leader_decision), edge cases (empty squad, no active members, fallback).

- [ ] **Step 1: Write test file**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SquadRouter } from '../squad-router.js';

describe('SquadRouter', () => {
  describe('strategy: leader_decision', () => {
    it('returns leader agent ID', () => {
      // ...
    });
  });

  describe('strategy: round_robin', () => {
    it('cycles through members', () => {
      // ...
    });
  });

  describe('strategy: skill_match', () => {
    it('picks best matching member by skills', () => {
      // ...
    });
  });

  describe('strategy: auto', () => {
    it('balances skill match with load', () => {
      // ...
    });
  });

  it('returns null for disabled squad', () => {
    // ...
  });

  it('uses fallback agent when no members are active', () => {
    // ...
  });

  it('returns null when squad not found', () => {
    // ...
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/agent && npx vitest run --reporter=verbose packages/agent/src/daemon/squad/__tests__/squad-router.test.ts 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/daemon/squad/__tests__/squad-router.test.ts
git commit -m "test: add SquadRouter strategy tests"
```

### Task 5.4: InteractiveExternalAgent Tests

**Files:**

- Create: `packages/agent/src/daemon/__tests__/interactive-external-agent.test.ts`

Test scope: init, multi-turn chat, squad routing, finalization, max turn limit, error handling.

- [ ] **Step 1: Write test file**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { InteractiveExternalAgent } from '../interactive-external-agent.js';

describe('InteractiveExternalAgent', () => {
  it('initializes with context and processes initial message', async () => {
    // ...
  });

  it('processes multi-turn conversation', async () => {
    // ...
  });

  it('routes @SquadName mentions to squad members', async () => {
    // ...
  });

  it('auto-finalizes when max turns reached', async () => {
    // ...
  });

  it('returns delivery with full transcript on finalize', async () => {
    // ...
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/agent && npx vitest run --reporter=verbose packages/agent/src/daemon/__tests__/interactive-external-agent.test.ts 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/daemon/__tests__/interactive-external-agent.test.ts
git commit -m "test: add InteractiveExternalAgent tests"
```

### Task 5.5: Harness Runtime Tests

**Files:**

- Create: `packages/agent/src/adapters/harness/__tests__/claude-code.test.ts`
- Create: `packages/agent/src/adapters/harness/__tests__/codex.test.ts`
- Create: `packages/agent/src/adapters/harness/__tests__/opencode.test.ts`
- Create: `packages/agent/src/adapters/harness/__tests__/a2a.test.ts`
- Create: `packages/agent/src/adapters/harness/__tests__/generic.test.ts`
- Create: `packages/agent/src/adapters/harness/__tests__/factory.test.ts`

Test scope: `convertPrompt()` output format, `parseOutput()` parsing, `extractMetrics()`, factory auto-detection, error cases.

Given the number of files, a single combined test is more pragmatic:

- [ ] **Step 1: Write combined harness test file**

```typescript
import { describe, it, expect } from 'vitest';
import { HarnessRuntimeFactory, HARNESS_IDS } from '../factory.js';
import { ClaudeCodeRuntime } from '../claude-code.js';
// ... other runtimes

describe('HarnessRuntimeFactory', () => {
  it('detects claude from command name', () => {
    expect(HarnessRuntimeFactory.detectFromCommand('claude')).toBe('claude-code');
  });

  it('detects codex from command name', () => {
    expect(HarnessRuntimeFactory.detectFromCommand('codex')).toBe('codex');
  });

  it('falls back to generic for unknown commands', () => {
    expect(HarnessRuntimeFactory.detectFromCommand('unknown-tool')).toBe('generic');
  });
});

describe('ClaudeCodeRuntime', () => {
  it('converts task to Claude-native prompt format', () => {
    // ...
  });

  it('parses Claude tool-use output correctly', () => {
    // ...
  });
});

describe('GenericCliRuntime', () => {
  it('converts task to simple instruction format', () => {
    // ...
  });

  it('parses plain text output correctly', () => {
    // ...
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/agent && npx vitest run --reporter=verbose packages/agent/src/adapters/harness/__tests__/ 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/adapters/harness/__tests__/
git commit -m "test: add Harness runtime tests"
```

### Task 5.6: AutoDiscoverer Tests

**Files:**

- Create: `packages/agent/src/daemon/__tests__/auto-discoverer.test.ts`

Test scope: mock fs and child_process to test CLI detection, A2A directory scanning, registration dedup.

- [ ] **Step 1: Write test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoDiscoverer } from '../auto-discoverer.js';

describe('AutoDiscoverer', () => {
  it('discovers CLI agents from PATH', async () => {
    // Mock detectCommand to return true for known commands
    // ...
  });

  it('scans A2A agent directory for agent.json files', async () => {
    // Mock filesystem to simulate ~/.cabinet/agents/
    // ...
  });

  it('does not re-register already known agents', async () => {
    // ...
  });

  it('reports not-detected for missing CLI commands', async () => {
    // Mock detectCommand to return false
    // ...
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/agent && npx vitest run --reporter=verbose packages/agent/src/daemon/__tests__/auto-discoverer.test.ts 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/daemon/__tests__/auto-discoverer.test.ts
git commit -m "test: add AutoDiscoverer tests"
```

### Task 5.7: agent-sdk Tests

**Files:**

- Create: `packages/agent-sdk/src/__tests__/slot-client.test.ts`
- Create: `packages/agent-sdk/src/__tests__/a2a-helper.test.ts`

Test scope: SlotClient HTTP client mock tests, A2A helper card building and task parsing.

- [ ] **Step 1: Write SlotClient tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlotClient } from '../slot-client.js';

describe('SlotClient', () => {
  it('reads slot with auth headers', async () => {
    // Mock fetch, verify Authorization header
  });

  it('writes discoveries', async () => {
    // ...
  });

  it('submits deliverables and returns ID', async () => {
    // ...
  });

  it('requests decisions with correct schema', async () => {
    // ...
  });

  it('reports telemetry', async () => {
    // ...
  });
});
```

- [ ] **Step 2: Write A2A helper tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  createAgentCard,
  parseTask,
  agentCardResponse,
  taskResultResponse,
} from '../a2a-helper.js';

describe('A2A helper', () => {
  it('creates agent card with correct structure', () => {
    const card = createAgentCard({
      agent_id: 'test-agent',
      display_name: 'Test Agent',
      base_url: 'http://localhost:8080',
      capabilities: [{ name: 'code', description: 'Writes code' }],
    });
    expect(card.agent_id).toBe('test-agent');
    expect(card.connection.base_url).toBe('http://localhost:8080');
  });

  it('parses valid A2A task', () => {
    const task = parseTask({ task_id: 't1', capability: 'code', input: 'write hello' });
    expect(task.task_id).toBe('t1');
  });

  it('throws on missing task_id', () => {
    expect(() => parseTask({ capability: 'code' })).toThrow('Invalid A2A task');
  });

  it('builds agent card Response', () => {
    // ...
  });

  it('builds task result Response', () => {
    // ...
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/agent-sdk && npx vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add packages/agent-sdk/src/__tests__/
git commit -m "test: add agent-sdk tests"
```

---

## Phase 6: Infrastructure Cleanup (P3)

### Task 6.1: Remove `packages/meeting` References

**Files:**

- Modify: `Dockerfile:36`
- Modify: `scripts/publish.sh:14`

**Issue:** `packages/meeting` was deleted (confirmed in `deliverables/v2.0-improvement-plan.md`) but `Dockerfile` and `scripts/publish.sh` still reference it.

- [ ] **Step 1: Remove line from Dockerfile**

```bash
# Remove line 36:
# COPY --from=builder /app/packages/meeting/package.json /app/packages/meeting/
```

- [ ] **Step 2: Remove line from publish.sh**

```bash
# Remove line 14:
# "packages/meeting"
```

- [ ] **Step 3: Verify removal**

```bash
grep -n "meeting" Dockerfile scripts/publish.sh
# Should output nothing
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile scripts/publish.sh
git commit -m "chore: remove references to deleted packages/meeting"
```

### Task 6.2: Verify `@cabinet/types` Workspace Link

**Files:**

- Read: `packages/types/package.json`
- Read: `packages/agent-sdk/package.json`

**Issue:** The audit report flagged that `@cabinet/types` workspace symlink might be missing under `node_modules`. Since 73 tests pass and `tsc -b` succeeds, this may be a false alarm (pnpm uses hoisted node_modules). Verify and document.

- [ ] **Step 1: Check if the symlink exists**

```bash
ls -la node_modules/@cabinet/types 2>&1
# If symlink exists, report it's fine.
# If not, check pnpm resolution:
node -e "try { require.resolve('@cabinet/types'); console.log('resolved to', require.resolve('@cabinet/types')); } catch(e) { console.log(e.message); }"
```

- [ ] **Step 2: Document findings in a code comment or README**

If the link is missing but resolution works (pnpm isolated node_modules), document this in the relevant package README:

```bash
# No changes needed if resolution works. If it's broken, fix:
cd packages/types && pnpm link --global && cd ../../packages/agent-sdk && pnpm link @cabinet/types
```

- [ ] **Step 3: If broken, fix and commit**

```bash
git add packages/agent-sdk/package.json  # or pnpm-workspace.yaml changes
git commit -m "fix: restore @cabinet/types workspace link"
```

---

## Summary of Tasks by Dependency

```
Phase 1 (Security & Correctness)
  ├── Task 1.1 — HMAC default secret               [independent]
  ├── Task 1.2 — childSession linear scan            [needs 1.1 if same file]
  └── Task 1.3 — TaskQueuePoller concurrency         [independent]

Phase 2 (Route & Server Cleanup)
  ├── Task 2.1 — A2AClient singleton → Context       [independent]
  └── Task 2.2 — Message stub cleanup                [independent]

Phase 3 (Daemon & Engine Cleanup)
  ├── Task 3.1 — AgentDaemonState cast cleanup       [independent]
  ├── Task 3.2 — daemon.ts split                     [needs 3.1]
  └── Task 3.3 — Registration path unification        [independent]

Phase 4 (Frontend Cleanup)
  └── Task 4.1 — ExternalAgentsTab redirect          [independent]

Phase 5 (Test Coverage)              [all independent of each other]
  ├── Task 5.1 — AgentDaemon tests
  ├── Task 5.2 — external-agent route tests
  ├── Task 5.3 — SquadRouter tests
  ├── Task 5.4 — InteractiveExternalAgent tests
  ├── Task 5.5 — Harness runtime tests
  ├── Task 5.6 — AutoDiscoverer tests
  └── Task 5.7 — agent-sdk tests

Phase 6 (Infrastructure Cleanup)
  ├── Task 6.1 — Remove meeting references           [independent]
  └── Task 6.2 — Verify workspace link               [independent]
```

**Recommended execution order:** Phase 1 → Phase 2 + Phase 3 (parallel) → Phase 4 → Phase 5 (parallel) → Phase 6 (parallel).
