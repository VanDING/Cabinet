# Type-A Tool Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 6 existing backend capabilities into Agent-callable tools: dashboard stats, task delegation, decision audit, memory lifecycle, enhanced status, and workflow run history.

**Architecture:** Add tool definitions to `packages/agent/src/tools/index.ts`, bind them to backend services in `apps/server/src/routes/secretary.ts` via the `ToolDependencies` interface, and verify with unit tests. No new backend services — only tool-layer bindings.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Hono

---

## File Structure

| File                                                 | Role                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/agent/src/tools/index.ts`                  | Tool definitions (`createCabinetTools`) and `ToolDependencies` interface |
| `packages/agent/src/tools/__tests__/tools.test.ts`   | Unit tests for all tools                                                 |
| `apps/server/src/routes/secretary.ts`                | `buildToolDependencies` — binds tools to backend services                |
| `apps/server/src/routes/dashboard.ts`                | **Read-only reference** — shows how dashboard data is already aggregated |
| `packages/storage/src/repositories/workflow-repo.ts` | **Read-only reference** — shows workflow run storage methods             |

---

### Task 1: Add `get_dashboard_stats` tool

**Files:**

- Modify: `packages/agent/src/tools/index.ts`
- Modify: `packages/agent/src/tools/__tests__/tools.test.ts`
- Modify: `apps/server/src/routes/secretary.ts`

- [ ] **Step 1: Add `getDashboardStats` to `ToolDependencies` interface**

In `packages/agent/src/tools/index.ts`, add inside the `ToolDependencies` interface (after `getProjectContext`):

```typescript
getDashboardStats: () => {
  pendingDecisions: number;
  activeWorkflows: number;
  activeProjects: number;
  todayCost: number;
  totalLLMCalls: number;
  totalTokens: number;
  totalDecisions: number;
  errors: number;
  recentEvents: {
    message: string;
    time: string;
  }
  [];
};
```

- [ ] **Step 2: Add `get_dashboard_stats` tool definition in `createCabinetTools`**

In `packages/agent/src/tools/index.ts`, add after the `get_status` tool definition:

```typescript
    {
      name: 'get_dashboard_stats',
      execute: async (_args: Record<string, unknown>) => {
        return deps.getDashboardStats();
      },
    },
```

- [ ] **Step 3: Add mock `getDashboardStats` to test deps**

In `packages/agent/src/tools/__tests__/tools.test.ts`, inside the `beforeEach` block where `deps` is defined, add after `getProjectContext`:

```typescript
      getDashboardStats: () => ({
        pendingDecisions: 2,
        activeWorkflows: 1,
        activeProjects: 3,
        todayCost: 0.42,
        totalLLMCalls: 150,
        totalTokens: 45000,
        totalDecisions: 8,
        errors: 0,
        recentEvents: [{ message: 'Workflow completed', time: new Date().toISOString() }],
      }),
```

- [ ] **Step 4: Write the failing test**

Add to `packages/agent/src/tools/__tests__/tools.test.ts`, after the existing `get_status` test:

```typescript
it('get_dashboard_stats returns dashboard data', async () => {
  const r = await executor.execute('get_dashboard_stats', 'tc_dash_1', {});
  const out = r.output as any;
  expect(out.pendingDecisions).toBe(2);
  expect(out.activeWorkflows).toBe(1);
  expect(out.todayCost).toBe(0.42);
  expect(out.totalLLMCalls).toBe(150);
  expect(out.recentEvents).toHaveLength(1);
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd packages/agent && npx vitest run src/tools/__tests__/tools.test.ts -t "get_dashboard_stats"
```

Expected: FAIL — `get_dashboard_stats` tool not registered (or test not found).

- [ ] **Step 6: Bind `getDashboardStats` in server `buildToolDependencies`**

In `apps/server/src/routes/secretary.ts`, inside `buildToolDependencies`, add after `getProjectContext`:

```typescript
    getDashboardStats() {
      const pendingDecisions = ctx.decisionRepo.listAllPending().length;
      const activeWorkflows = ctx.workflowRepo.countByStatus(['running']);
      const activeProjects = ctx.projectRepo.listAll().filter((p) => !p.archived).length;
      const todayCost = ctx.costTracker.getDailyCost();
      const summary = ctx.metrics.getSummary();
      let recentEvents: { message: string; time: string }[] = [];
      try {
        const events = ctx.eventRepo.findAll().slice(-10);
        recentEvents = events.map((e) => ({
          message: e.messageType,
          time: e.timestamp.toISOString(),
        }));
      } catch { /* non-fatal */ }
      return {
        pendingDecisions,
        activeWorkflows,
        activeProjects,
        todayCost,
        totalLLMCalls: summary.totalLLMCalls,
        totalTokens: summary.totalTokens,
        totalDecisions: summary.totalDecisions,
        errors: summary.errors,
        recentEvents,
      };
    },
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd packages/agent && npx vitest run src/tools/__tests__/tools.test.ts -t "get_dashboard_stats"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/tools/index.ts packages/agent/src/tools/__tests__/tools.test.ts apps/server/src/routes/secretary.ts
git commit -m "feat(tools): add get_dashboard_stats tool"
```

---

### Task 2: Add `delegate_task`, `get_task_status`, `list_active_tasks` tools

**Files:**

- Modify: `packages/agent/src/tools/index.ts`
- Modify: `packages/agent/src/tools/__tests__/tools.test.ts`
- Modify: `apps/server/src/routes/secretary.ts`

- [ ] **Step 1: Add task tracker callbacks to `ToolDependencies` interface**

In `packages/agent/src/tools/index.ts`, add inside `ToolDependencies`:

```typescript
  delegateTask: (name: string, agentName?: string, description?: string) => string;
  getTaskStatus: (taskId: string) => { id: string; name: string; status: string; startTime?: number; endTime?: number } | null;
  listActiveTasks: () => { id: string; name: string; status: string }[];
```

- [ ] **Step 2: Add tool definitions in `createCabinetTools`**

Add after the `get_dashboard_stats` tool:

```typescript
    {
      name: 'delegate_task',
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const agentName = args.agentName as string | undefined;
        const description = args.description as string | undefined;
        if (!name) return { error: 'name is required' };
        const taskId = deps.delegateTask(name, agentName, description);
        return { delegated: true, taskId };
      },
    },
    {
      name: 'get_task_status',
      execute: async (args: Record<string, unknown>) => {
        const taskId = args.taskId as string;
        if (!taskId) return { error: 'taskId is required' };
        const task = deps.getTaskStatus(taskId);
        if (!task) return { error: `Task not found: ${taskId}` };
        return task;
      },
    },
    {
      name: 'list_active_tasks',
      execute: async (_args: Record<string, unknown>) => {
        return { tasks: deps.listActiveTasks() };
      },
    },
```

- [ ] **Step 3: Add a shared `TaskTracker` instance in server context**

In `apps/server/src/context.ts`, add after the `FileAccessTracker` class definition (around line 192):

```typescript
export class TaskTracker {
  private tasks: Array<{
    id: string;
    name: string;
    agentName?: string;
    description?: string;
    status: string;
    startTime: number;
    endTime?: number;
  }> = [];

  addTask(name: string, agentName?: string, description?: string): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.tasks.push({ id, name, agentName, description, status: 'running', startTime: Date.now() });
    return id;
  }

  completeTask(id: string, success = true) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      task.status = success ? 'done' : 'error';
      task.endTime = Date.now();
    }
  }

  getTask(id: string) {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  listActive() {
    return this.tasks.filter((t) => t.status === 'running');
  }

  listAll() {
    return [...this.tasks];
  }
}
```

Then instantiate it in `getServerContext` before the `ctx = { ... }` block (around line 1678):

```typescript
const taskTracker = new TaskTracker();
```

And add `taskTracker` to the `ctx` object.

- [ ] **Step 4: Bind task tracker callbacks in `buildToolDependencies`**

In `apps/server/src/routes/secretary.ts`, add after `getDashboardStats`:

```typescript
    delegateTask(name, agentName, description) {
      return ctx.taskTracker.addTask(name, agentName, description);
    },
    getTaskStatus(taskId) {
      const task = ctx.taskTracker.getTask(taskId);
      if (!task) return null;
      return {
        id: task.id,
        name: task.name,
        status: task.status,
        startTime: task.startTime,
        endTime: task.endTime,
      };
    },
    listActiveTasks() {
      return ctx.taskTracker.listActive().map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
      }));
    },
```

- [ ] **Step 5: Add mock callbacks to test deps**

In `packages/agent/src/tools/__tests__/tools.test.ts`, add after `getDashboardStats`:

```typescript
      delegateTask: (name) => `task_${name}`,
      getTaskStatus: (taskId) => {
        if (taskId === 'task_test') {
          return { id: taskId, name: 'Test Task', status: 'running', startTime: Date.now() };
        }
        return null;
      },
      listActiveTasks: () => [{ id: 'task_1', name: 'Task 1', status: 'running' }],
```

- [ ] **Step 6: Write failing tests**

Add to `packages/agent/src/tools/__tests__/tools.test.ts`:

```typescript
it('delegate_task returns task id', async () => {
  const r = await executor.execute('delegate_task', 'tc_task_1', { name: 'Research market' });
  const out = r.output as any;
  expect(out.delegated).toBe(true);
  expect(out.taskId).toContain('Research market');
});

it('get_task_status returns task info', async () => {
  const r = await executor.execute('get_task_status', 'tc_task_2', { taskId: 'task_test' });
  const out = r.output as any;
  expect(out.id).toBe('task_test');
  expect(out.status).toBe('running');
});

it('list_active_tasks returns active tasks', async () => {
  const r = await executor.execute('list_active_tasks', 'tc_task_3', {});
  const out = r.output as any;
  expect(out.tasks).toHaveLength(1);
  expect(out.tasks[0].status).toBe('running');
});
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
cd packages/agent && npx vitest run src/tools/__tests__/tools.test.ts -t "delegate_task"
```

Expected: FAIL — tools not registered.

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd packages/agent && npx vitest run src/tools/__tests__/tools.test.ts -t "delegate_task|get_task_status|list_active_tasks"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/agent/src/tools/index.ts packages/agent/src/tools/__tests__/tools.test.ts apps/server/src/routes/secretary.ts apps/server/src/context.ts
git commit -m "feat(tools): add task delegation and tracking tools"
```

---

### Task 3: Add `get_decision_audit` tool

**Files:**

- Modify: `packages/agent/src/tools/index.ts`
- Modify: `packages/agent/src/tools/__tests__/tools.test.ts`
- Modify: `apps/server/src/routes/secretary.ts`

- [ ] **Step 1: Add callback to `ToolDependencies` interface**

In `packages/agent/src/tools/index.ts`:

```typescript
getDecisionAudit: (decisionId: string) =>
  Array<{
    action: string;
    actor: string;
    changes: Record<string, unknown>;
    timestamp: string;
  }>;
```

- [ ] **Step 2: Add tool definition in `createCabinetTools`**

```typescript
    {
      name: 'get_decision_audit',
      execute: async (args: Record<string, unknown>) => {
        const decisionId = args.decisionId as string;
        if (!decisionId) return { error: 'decisionId is required' };
        const entries = deps.getDecisionAudit(decisionId);
        return { decisionId, entries };
      },
    },
```

- [ ] **Step 3: Bind in `buildToolDependencies`**

In `apps/server/src/routes/secretary.ts`, add after `listActiveTasks`:

```typescript
    getDecisionAudit(decisionId) {
      const rows = ctx.auditLogRepo.findByEntity('decision', decisionId);
      return rows.map((r) => ({
        action: r.action,
        actor: r.actor,
        changes: (() => { try { return JSON.parse(r.changes ?? '{}'); } catch { return {}; } })(),
        timestamp: r.timestamp,
      }));
    },
```

- [ ] **Step 4: Add mock to test deps**

In test file:

```typescript
      getDecisionAudit: (decisionId) => [
        { action: 'created', actor: 'system', changes: { level: 'L1' }, timestamp: new Date().toISOString() },
      ],
```

- [ ] **Step 5: Write failing test**

```typescript
it('get_decision_audit returns audit entries', async () => {
  const r = await executor.execute('get_decision_audit', 'tc_audit_1', { decisionId: 'dec_1' });
  const out = r.output as any;
  expect(out.decisionId).toBe('dec_1');
  expect(out.entries).toHaveLength(1);
  expect(out.entries[0].action).toBe('created');
});
```

- [ ] **Step 6: Run tests**

```bash
cd packages/agent && npx vitest run src/tools/__tests__/tools.test.ts -t "get_decision_audit"
```

Expected: PASS after implementation.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/index.ts packages/agent/src/tools/__tests__/tools.test.ts apps/server/src/routes/secretary.ts
git commit -m "feat(tools): add get_decision_audit tool"
```

---

### Task 4: Add `update_memory` and `delete_memory` tools

**Files:**

- Modify: `packages/agent/src/tools/index.ts`
- Modify: `packages/agent/src/tools/__tests__/tools.test.ts`

These tools reuse the existing `deps.longTerm` object which already has `updateMemory()` and `delete()` methods.

- [ ] **Step 1: Add tool definitions in `createCabinetTools`**

```typescript
    {
      name: 'update_memory',
      execute: async (args: Record<string, unknown>) => {
        const memoryId = args.memoryId as string;
        const status = args.status as string | undefined;
        const importance = args.importance as number | undefined;
        const confidence = args.confidence as number | undefined;
        if (!memoryId) return { error: 'memoryId is required' };
        const success = await deps.longTerm.updateMemory(memoryId, { status, importance, confidence });
        return { updated: success, memoryId };
      },
    },
    {
      name: 'delete_memory',
      execute: async (args: Record<string, unknown>) => {
        const memoryId = args.memoryId as string;
        if (!memoryId) return { error: 'memoryId is required' };
        const success = await deps.longTerm.delete(memoryId);
        return { deleted: success, memoryId };
      },
    },
```

- [ ] **Step 2: Write failing tests**

```typescript
it('update_memory updates memory metadata', async () => {
  const storeResult = await deps.longTerm.store({
    content: 'Test memory',
    metadata: {},
    timestamp: new Date(),
  });
  const r = await executor.execute('update_memory', 'tc_upd_1', {
    memoryId: storeResult,
    status: 'archived',
    importance: 0.3,
  });
  const out = r.output as any;
  expect(out.updated).toBe(true);
  expect(out.memoryId).toBe(storeResult);
});

it('delete_memory removes memory', async () => {
  const storeResult = await deps.longTerm.store({
    content: 'Memory to delete',
    metadata: {},
    timestamp: new Date(),
  });
  const r = await executor.execute('delete_memory', 'tc_del_1', { memoryId: storeResult });
  const out = r.output as any;
  expect(out.deleted).toBe(true);
});
```

- [ ] **Step 3: Run tests**

```bash
cd packages/agent && npx vitest run src/tools/__tests__/tools.test.ts -t "update_memory|delete_memory"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/tools/index.ts packages/agent/src/tools/__tests__/tools.test.ts
git commit -m "feat(tools): add update_memory and delete_memory tools"
```

---

### Task 5: Enhance `get_status` with system metrics

**Files:**

- Modify: `packages/agent/src/tools/index.ts`
- Modify: `packages/agent/src/tools/__tests__/tools.test.ts`
- Modify: `apps/server/src/routes/secretary.ts`

- [ ] **Step 1: Add `getSystemMetrics` callback to `ToolDependencies` interface**

```typescript
getSystemMetrics: () => {
  totalLLMCalls: number;
  totalTokens: number;
  totalDecisions: number;
  errors: number;
};
```

- [ ] **Step 2: Update `get_status` tool definition**

Replace the existing `get_status` tool definition:

```typescript
    {
      name: 'get_status',
      execute: async (_args: Record<string, unknown>) => {
        const metrics = deps.getSystemMetrics();
        return {
          status: 'operational',
          timestamp: new Date().toISOString(),
          toolsAvailable: deps.listAgents ? 49 : 0,
          metrics,
        };
      },
    },
```

- [ ] **Step 3: Add mock to test deps**

In test file, add to deps:

```typescript
      getSystemMetrics: () => ({ totalLLMCalls: 10, totalTokens: 3000, totalDecisions: 2, errors: 0 }),
```

- [ ] **Step 4: Update existing `get_status` test**

Modify the existing test to also check metrics:

```typescript
it('get_status returns operational with metrics', async () => {
  const r = await executor.execute('get_status', 'tc5', {});
  const out = r.output as any;
  expect(out.status).toBe('operational');
  expect(out.metrics).toBeDefined();
  expect(out.metrics.totalLLMCalls).toBe(10);
});
```

- [ ] **Step 5: Bind in `buildToolDependencies`**

In `apps/server/src/routes/secretary.ts`, add after `getDecisionAudit`:

```typescript
    getSystemMetrics() {
      return ctx.metrics.getSummary();
    },
```

- [ ] **Step 6: Run tests**

```bash
cd packages/agent && npx vitest run src/tools/__tests__/tools.test.ts -t "get_status"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/index.ts packages/agent/src/tools/__tests__/tools.test.ts apps/server/src/routes/secretary.ts
git commit -m "feat(tools): enhance get_status with system metrics"
```

---

### Task 6: Add `get_workflow_run` and `list_workflow_runs` tools

**Files:**

- Modify: `packages/agent/src/tools/index.ts`
- Modify: `packages/agent/src/tools/__tests__/tools.test.ts`
- Modify: `apps/server/src/routes/secretary.ts`

- [ ] **Step 1: Add callbacks to `ToolDependencies` interface**

```typescript
  getWorkflowRun: (runId: string) => {
    runId: string;
    workflowId: string;
    status: string;
    steps: unknown[];
    startedAt: string;
    updatedAt: string;
  } | null;
  listWorkflowRuns: (workflowId: string) => Array<{
    runId: string;
    workflowId: string;
    status: string;
    startedAt: string;
    updatedAt: string;
  }>;
```

- [ ] **Step 2: Add tool definitions in `createCabinetTools`**

```typescript
    {
      name: 'get_workflow_run',
      execute: async (args: Record<string, unknown>) => {
        const runId = args.runId as string;
        if (!runId) return { error: 'runId is required' };
        const run = deps.getWorkflowRun(runId);
        if (!run) return { error: `Run not found: ${runId}` };
        return run;
      },
    },
    {
      name: 'list_workflow_runs',
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        return { runs: deps.listWorkflowRuns(workflowId) };
      },
    },
```

- [ ] **Step 3: Bind in `buildToolDependencies`**

In `apps/server/src/routes/secretary.ts`, add after `getSystemMetrics`:

```typescript
    getWorkflowRun(runId) {
      const row = ctx.workflowRepo.findRunById(runId);
      if (!row) return null;
      let steps: unknown[] = [];
      try {
        steps = ctx.workflowRepo.findStepsByRunId(runId);
      } catch { /* non-fatal */ }
      return {
        runId: row.run_id,
        workflowId: row.workflow_id,
        status: row.status,
        steps,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
      };
    },
    listWorkflowRuns(workflowId) {
      const rows = ctx.workflowRepo.findRunsByWorkflow(workflowId);
      return rows.map((r) => ({
        runId: r.run_id,
        workflowId: r.workflow_id,
        status: r.status,
        startedAt: r.started_at,
        updatedAt: r.updated_at,
      }));
    },
```

- [ ] **Step 4: Add mocks to test deps**

In test file:

```typescript
      getWorkflowRun: (runId) => {
        if (runId === 'run_test') {
          return { runId, workflowId: 'wf_1', status: 'completed', steps: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        }
        return null;
      },
      listWorkflowRuns: (workflowId) => [
        { runId: 'run_1', workflowId, status: 'completed', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
```

- [ ] **Step 5: Write failing tests**

```typescript
it('get_workflow_run returns run details', async () => {
  const r = await executor.execute('get_workflow_run', 'tc_wfr_1', { runId: 'run_test' });
  const out = r.output as any;
  expect(out.runId).toBe('run_test');
  expect(out.status).toBe('completed');
});

it('list_workflow_runs returns runs for workflow', async () => {
  const r = await executor.execute('list_workflow_runs', 'tc_wfr_2', { workflowId: 'wf_1' });
  const out = r.output as any;
  expect(out.runs).toHaveLength(1);
  expect(out.runs[0].workflowId).toBe('wf_1');
});
```

- [ ] **Step 6: Run tests**

```bash
cd packages/agent && npx vitest run src/tools/__tests__/tools.test.ts -t "get_workflow_run|list_workflow_runs"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/index.ts packages/agent/src/tools/__tests__/tools.test.ts apps/server/src/routes/secretary.ts
git commit -m "feat(tools): add workflow run history tools"
```

---

## Self-Review

**1. Spec coverage:**

| Gap                | Task                                                            |
| ------------------ | --------------------------------------------------------------- |
| Dashboard 数据查询 | Task 1: `get_dashboard_stats`                                   |
| 任务委派与追踪     | Task 2: `delegate_task`, `get_task_status`, `list_active_tasks` |
| 决策审计查询       | Task 3: `get_decision_audit`                                    |
| 记忆更新/删除      | Task 4: `update_memory`, `delete_memory`                        |
| 系统指标           | Task 5: enhanced `get_status`                                   |
| 工作流运行历史     | Task 6: `get_workflow_run`, `list_workflow_runs`                |

All 6 Type-A gaps are covered. No Type-B (new backend service) work is included, consistent with the "wiring only" scope.

**2. Placeholder scan:**

- No "TBD", "TODO", "implement later" found.
- All test code is complete with actual assertions.
- All tool definitions include complete `execute` bodies.
- All server bindings include complete callback implementations.

**3. Type consistency:**

- `ToolDependencies` interface additions use consistent naming (`camelCase` for properties, matching existing style).
- `getDashboardStats` return type matches the actual aggregated shape from `dashboard.ts`.
- `getWorkflowRun` return type matches `WorkflowRunRow` from `workflow-repo.ts`.
- `TaskTracker` class in `context.ts` matches the `AgentTask` shape from `task-tracker.ts`.

**4. One concern addressed:**
The `TaskTracker` class is newly introduced in `apps/server/src/context.ts`. It is intentionally lightweight (in-memory) because task delegation is currently a tool-layer concept, not a persisted entity. If persistence is needed later, it can be promoted to use a repository without changing the tool interface.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-27-type-a-tool-wiring.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
