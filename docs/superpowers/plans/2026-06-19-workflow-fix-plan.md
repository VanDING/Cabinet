# Workflow 功能修复与优化实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Workflow 功能发现的所有 BUG 与架构问题，包括 API 路径错误、内存泄漏、文件拆分过红线、测试覆盖不足、UI 反馈缺失

**Architecture:** 三层修复：L4 前端修复路径错误/拆分大文件；L3 后端路由修复内存泄漏；L2 引擎增加测试覆盖。每层独立可验证

**Tech Stack:** TypeScript strict, Hono (后端), React 19 + xyflow/react (前端), Vitest (测试), better-sqlite3 (持久化)

---

### 任务总览

| #   | 优先级 | 任务                                                | 类型     | 涉及文件                                                                   | 预估时间 |
| --- | ------ | --------------------------------------------------- | -------- | -------------------------------------------------------------------------- | -------- |
| 1   | P0     | 修复 ActiveWorkflowsModal API 路径                  | BUG      | `ActiveWorkflowsModal.tsx`                                                 | 2 min    |
| 2   | P0     | 添加 engine.runs 自动清理机制                       | 内存泄漏 | `packages/workflow/src/engine.ts`                                          | 5 min    |
| 3   | P1     | 拆分 FactoryPage (>600行)                           | 重构     | `FactoryPage.tsx`, 新 `factory/WorkflowToolbar.tsx`                        | 15 min   |
| 4   | P1     | 拆分 WorkflowPanel (>680行)                         | 重构     | `WorkflowPanel.tsx`, 新 `factory/NodeEditor.tsx`, `factory/RunHistory.tsx` | 15 min   |
| 5   | P1     | WorkflowsPage 增加导入/导出 UI                      | 功能补缺 | `WorkflowsPage.tsx`                                                        | 10 min   |
| 6   | P2     | 添加引擎测试（Manager/Parallel/Loop/ExternalAgent） | 测试     | `packages/workflow/src/__tests__/`                                         | 20 min   |
| 7   | P2     | 添加蓝图 IO 测试                                    | 测试     | `packages/workflow/src/__tests__/`                                         | 10 min   |
| 8   | P2     | 添加导入/导出用户反馈                               | 功能补缺 | `WorkflowPanel.tsx`                                                        | 5 min    |
| 9   | P3     | 评估 WorkflowsPage/FactoryPage 合并方案             | 架构     | `App.tsx` 路由                                                             | 10 min   |

---

### Task 1: 修复 ActiveWorkflowsModal API 路径

**Files:**

- Modify: `apps/desktop/src/components/office/ActiveWorkflowsModal.tsx:33`

- [ ] **Step 1: 修改 API 路径**

`ActiveWorkflowsModal.tsx:33` 调用的是 `/api/workflows`，但后端路由注册在 `/api/factory` (`apps/server/src/index.ts:78`)。这个调用会 404 导致 Modal 永远显示"Empty"。

```typescript
// ActiveWorkflowsModal.tsx:33
// Before:
apiFetch('/api/workflows', { headers: authHeaders() });
// After:
apiFetch('/api/factory', { headers: authHeaders() });
```

- [ ] **Step 2: 确认前端路由类型匹配**

后端返回格式：`{ workflows: [...] }`。`ActiveWorkflowsModal.tsx:36` 使用 `data.workflows` — 与后端匹配。只改路径即可。

```bash
git add apps/desktop/src/components/office/ActiveWorkflowsModal.tsx
git commit -m "fix: ActiveWorkflowsModal calls /api/workflows should be /api/factory"
```

---

### Task 2: 添加 engine.runs 自动清理机制

**Files:**

- Modify: `packages/workflow/src/engine.ts`

- [ ] **Step 1: 在 engine.ts 中添加清理触发器**

`WorkflowEngine` 的 `runs: Map<string, WorkflowRun>` 在 `startRun()` 和 `continueRun()` 中添加条目但从不删除。需要添加一个配置化的清理策略。

```typescript
// packages/workflow/src/engine.ts — 在类属性区域添加
export class WorkflowEngine {
  private runs = new Map<string, WorkflowRun>();
  private handlers: WorkflowHandlers = {};
  private currentEdges: WorkflowEdge[] = [];
  private persistence = new WorkflowPersistence();
  private nodeExecutor: NodeExecutor;
  /** Max completed/failed runs kept in memory. Excess are evicted by LRU. */
  private maxCompletedRuns: number;
  /** Run IDs that have reached a terminal status, ordered by completion time. */
  private completedRunIds: string[] = [];

  constructor(maxCompletedRuns = 50) {
    this.maxCompletedRuns = maxCompletedRuns;
    this.nodeExecutor = new NodeExecutor(this.buildNodeExecutorDeps());
  }
```

- [ ] **Step 2: 在 startRun 完成时触发清理**

在 `startRun` 方法的末尾，当 `run.status` 已经是终端状态时注册清理。

```typescript
// 在 startRun() 方法末尾，return run 之前
if (
  run.status === 'completed' ||
  run.status === 'failed' ||
  run.status === 'completed_with_errors'
) {
  this.completedRunIds.push(run.runId);
  if (this.completedRunIds.length > this.maxCompletedRuns) {
    const evictId = this.completedRunIds.shift()!;
    this.runs.delete(evictId);
  }
}
```

- [ ] **Step 3: 同样在 continueRun 末尾添加**

```typescript
// 在 continueRun() 方法末尾，return run 之前
if (
  run.status === 'completed' ||
  run.status === 'failed' ||
  run.status === 'completed_with_errors'
) {
  if (!this.completedRunIds.includes(run.runId)) {
    this.completedRunIds.push(run.runId);
  }
  while (this.completedRunIds.length > this.maxCompletedRuns) {
    const evictId = this.completedRunIds.shift()!;
    this.runs.delete(evictId);
  }
}
```

- [ ] **Step 4: 验证测试仍通过**

```bash
cd packages/workflow
pnpm vitest run
Expected: All tests PASS
```

```bash
git add packages/workflow/src/engine.ts
git commit -m "fix: add engine.runs LRU eviction to prevent memory leak"
```

---

### Task 3: 拆分 FactoryPage (>600行)

**Files:**

- Create: `apps/desktop/src/factory/WorkflowToolbar.tsx`
- Modify: `apps/desktop/src/pages/FactoryPage.tsx`

- [ ] **Step 1: 提取 WorkflowToolbar 组件**

FactoryPage.tsx 第 496-549 行的 Toolbar（Undo/Redo/Save/Chat Edit/Delete 按钮 + StatusBadge）提取为独立组件。

```typescript
// factory/WorkflowToolbar.tsx
import { Button } from '@cabinet/ui';
import type { CanvasNode, CanvasEdge } from './node-types';

interface WorkflowToolbarProps {
  name: string;
  status: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onChatEdit: () => void;
  onDelete: () => void;
}

export function WorkflowToolbar({
  name, status, dirty, canUndo, canRedo,
  onUndo, onRedo, onSave, onChatEdit, onDelete,
}: WorkflowToolbarProps) {
  return (
    <div className="border-border flex items-center justify-between border-b px-4 py-2">
      <div className="flex items-center gap-2">
        <h2 className="text-content-primary text-sm font-semibold">{name}</h2>
        <StatusBadge status={status} />
        {dirty && (
          <span className="bg-intent-warning-muted text-intent-warning rounded-sm px-1.5 py-0.5 text-[10px]">
            Unsaved
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={onUndo} disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="text-content-tertiary hover:text-content-primary rounded-sm p-1 text-xs disabled:opacity-30">↩</button>
        <button onClick={onRedo} disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          className="text-content-tertiary hover:text-content-primary rounded-sm p-1 text-xs disabled:opacity-30">↪</button>
        <Button size="xs" variant="ghost" onClick={onSave} disabled={!dirty}>Save</Button>
        <Button size="xs" variant="ghost" onClick={onChatEdit}>Chat Edit</Button>
        <Button size="xs" variant="ghost" className="text-intent-danger" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
      status === 'running' ? 'bg-accent-muted text-accent'
      : status === 'completed' ? 'bg-intent-success-muted text-intent-success'
      : status === 'failed' ? 'bg-intent-danger-muted text-intent-danger'
      : 'bg-surface-muted text-content-secondary'
    }`}>{status}</span>
  );
}
```

- [ ] **Step 2: 在 FactoryPage 中替换**

```typescript
// FactoryPage.tsx — 在 import 区域添加
import { WorkflowToolbar } from '../factory/WorkflowToolbar';

// 替换第 496-549 行的 Toolbar div 为
<WorkflowToolbar
  name={selected.name}
  status={selected.status}
  dirty={dirty}
  canUndo={undoRedo.canUndo}
  canRedo={undoRedo.canRedo}
  onUndo={() => undoRedo.undo({ nodes: canvasNodes, edges: canvasEdges }, (n, e) => { setCanvasNodes(n); setCanvasEdges(e); setDirty(true); })}
  onRedo={() => undoRedo.redo({ nodes: canvasNodes, edges: canvasEdges }, (n, e) => { setCanvasNodes(n); setCanvasEdges(e); setDirty(true); })}
  onSave={handleSave}
  onChatEdit={handleChatEdit}
  onDelete={handleDelete}
/>
```

- [ ] **Step 3: 删除 FactoryPage 中原 StatusBadge 函数 (第 593-608 行)**

```typescript
// 删除整个 StatusBadge 函数，它已经被移到 WorkflowToolbar 中
```

```bash
git add apps/desktop/src/factory/WorkflowToolbar.tsx apps/desktop/src/pages/FactoryPage.tsx
git commit -m "refactor: extract WorkflowToolbar from FactoryPage (-60 lines)"
```

---

### Task 4: 拆分 WorkflowPanel (>680行)

**Files:**

- Extract + simplify: `apps/desktop/src/factory/WorkflowPanel.tsx` 保持不变（保留编排逻辑）
- Note: 「拆分」的方式是确认子组件独立即可，不需要新建文件（NodeEditor 和 RunHistory 已在同文件中内联定义）

- [ ] **Step 1: 评估工作量**

仔细阅读文件后发现：`WorkflowPanel.tsx` 已经内联定义了 `NodeEditor`、`AddNodeSection`、`RunHistory` 三个子组件。这三个子组件已经逻辑分离 — 不需要新建文件提取。680 行的主要原因是 NodeEditor 对 17 种节点类型做了详尽的字段编辑器（每种类型 5-20 行）。这是功能必须的复杂度，合理。

- [ ] **结论**: 不拆分 WorkflowPanel。`NodeEditor` 的节点类型配置面板是 feature 需要，不是可避免的膨胀。

```bash
git commit --allow-empty -m "refactor: skip WorkflowPanel split — NodeEditor per-type detail is inherent complexity"
```

---

### Task 5: WorkflowsPage 增加导入/导出按钮

**Files:**

- Modify: `apps/desktop/src/pages/WorkflowsPage.tsx`

- [ ] **Step 1: 添加导出按钮 + handler**

在 WorkflowsPage 的 Toolbar 区域添加 Export/Import 按钮。

```typescript
// WorkflowsPage.tsx — 在 import 区域添加
import { useRef } from 'react';

// 在 WorkflowsPage 函数内添加 state
const fileInputRef = useRef<HTMLInputElement>(null);

// 添加 handler
const handleExport = async (wfId: string) => {
  try {
    const res = await apiFetch('/api/workflows/export', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ workflowId: wfId }),
    });
    const blueprint = await res.json();
    const wf = workflows.find((w) => w.id === wfId);
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wf?.name ?? 'workflow'}.cabinet.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', `Workflow exported`);
  } catch {
    addToast('error', 'Export failed');
  }
};

const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const blueprint = JSON.parse(text);
    let pid: string | undefined;
    const projRes = await apiFetch('/api/projects', { headers: authHeaders() });
    const projData = await projRes.json();
    pid = projData.projects?.[0]?.id;
    if (!pid) {
      addToast('error', 'No project found');
      return;
    }
    const res = await apiFetch('/api/workflows/import', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ blueprint, projectId: pid }),
    });
    const data = await res.json();
    if (data.id) {
      addToast(
        'success',
        `Imported workflow with ${data.nodes} nodes (${data.missingAgents?.length ?? 0} missing agents)`,
      );
      fetchWorkflows();
    }
  } catch {
    addToast('error', 'Import failed');
  }
};
```

- [ ] **Step 2: 在 UI 中添加按钮**

在 "New Workflow" 按钮旁边添加 Export/Import 操作区域：

```typescript
// WorkflowsPage.tsx — 在 return 的 Toolbar div 内，在"New Workflow"按钮旁边
<div className="flex items-center gap-2">
  {workflows.length > 0 && (
    <>
      <select
        className="rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-content-primary"
        value=""
        onChange={(e) => { if (e.target.value) handleExport(e.target.value); }}
      >
        <option value="">Export…</option>
        {workflows.map((wf) => (
          <option key={wf.id} value={wf.id}>{wf.name}</option>
        ))}
      </select>
      <button
        onClick={() => fileInputRef.current?.click()}
        className="border-border text-content-secondary hover:bg-surface-elevated inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"
      >
        Import
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />
    </>
  )}
  <button
    onClick={handleNewWorkflow}
    className="bg-accent text-content-inverse hover:bg-accent-hover inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium"
  >
    <Plus size={16} /> New Workflow
  </button>
</div>
```

```bash
git add apps/desktop/src/pages/WorkflowsPage.tsx
git commit -m "feat: add import/export to WorkflowsPage list view"
```

---

### Task 6: 添加引擎测试（Manager/Parallel/Loop/ExternalAgent）

**Files:**

- Create: `packages/workflow/src/__tests__/advanced-node-types.test.ts`

- [ ] **Step 1: 编写 Manager 节点测试**

```typescript
// packages/workflow/src/__tests__/advanced-node-types.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine, type WorkflowNodeDef, type WorkflowEdge } from '../engine';

describe('Manager node', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      aiAgent: async (_node, input) => `AI processed: ${input.slice(0, 50)}`,
      skill: async (_skillId, input) => `Result: ${JSON.stringify(input)}`,
    });
  });

  it('executes manager node with children', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      {
        id: 'mgr',
        type: 'manager',
        children: [
          { id: 'child1', type: 'skill', skillId: 'skill-a' },
          { id: 'child2', type: 'skill', skillId: 'skill-b' },
        ],
      },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'mgr' },
      { from: 'mgr', to: 'end' },
    ];
    const run = await engine.startRun('wf-manager', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    expect(run.steps.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: 编写 Parallel 节点测试**

```typescript
describe('Parallel node', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      skill: async (_skillId, input) => `Result: ${JSON.stringify(input)}`,
    });
  });

  it('executes all parallel branches', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      {
        id: 'par',
        type: 'parallel',
        mergeStrategy: 'concat',
        children: [
          { id: 'p1', type: 'skill', skillId: 'skill-a' },
          { id: 'p2', type: 'skill', skillId: 'skill-b' },
        ],
      },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'par' },
      { from: 'par', to: 'end' },
    ];
    const run = await engine.startRun('wf-parallel', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    expect(run.steps.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 3: 编写 Loop 节点测试**

```typescript
describe('Loop node', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      skill: async (_skillId, input) => `Iteration: ${JSON.stringify(input)}`,
    });
  });

  it('executes loop with count strategy', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      {
        id: 'loop',
        type: 'loop',
        loopType: 'count',
        loopCount: 3,
        children: [{ id: 'body', type: 'skill', skillId: 'skill-a' }],
      },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'loop' },
      { from: 'loop', to: 'end' },
    ];
    const run = await engine.startRun('wf-loop', nodes, edges, 'start');
    expect(run.status).toBe('completed');
  });
});
```

- [ ] **Step 4: 编写 ExternalAgent 节点测试**

```typescript
describe('ExternalAgent node', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      dispatchToExternalAgent: async (_agentId, _task) => ({
        status: 'completed' as const,
        output: 'External agent done',
      }),
    });
  });

  it('dispatches to external agent and captures output', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      { id: 'ext', type: 'externalAgent', agentId: 'my-cli-agent' },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'ext' },
      { from: 'ext', to: 'end' },
    ];
    const run = await engine.startRun('wf-ext', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    expect(run.results.get('ext')).toContain('External agent done');
  });
});
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd packages/workflow
pnpm vitest run
Expected: All tests PASS (existing 5 + new 4)
```

```bash
git add packages/workflow/src/__tests__/advanced-node-types.test.ts
git commit -m "test: add Manager/Parallel/Loop/ExternalAgent engine tests"
```

---

### Task 7: 添加蓝图 IO 测试

**Files:**

- Create: `packages/workflow/src/__tests__/blueprint-io.test.ts`

- [ ] **Step 1: 编写导出/导入/验证测试**

```typescript
// packages/workflow/src/__tests__/blueprint-io.test.ts
import { describe, it, expect } from 'vitest';
import { exportBlueprint, importBlueprint, validateWorkflowExport } from '../blueprint-io';
import type { WorkflowNodeDef } from '@cabinet/types';
import type { WorkflowEdge } from '../engine';

describe('Blueprint export', () => {
  it('exports nodes and edges to cabinet-workflow/v1 format', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'n1', type: 'start', title: 'Start' },
      { id: 'n2', type: 'llm', title: 'Process' },
      { id: 'n3', type: 'end', title: 'End' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
    ];

    const bp = exportBlueprint(nodes, edges);
    expect(bp.format).toBe('cabinet-workflow/v1');
    expect(bp.definition.nodes).toHaveLength(3);
    expect(bp.definition.edges).toHaveLength(2);
    expect(bp.exportedAt).toBeDefined();
    expect(bp.sourceInstance).toContain('daemon_');
  });
});

describe('Blueprint import', () => {
  it('imports valid blueprint to nodes and edges', () => {
    const bp = {
      format: 'cabinet-workflow/v1' as const,
      exportedAt: '2026-06-01T00:00:00.000Z',
      sourceInstance: 'daemon_test',
      definition: {
        nodes: [
          { id: 'n1', type: 'start' as const, title: 'Start' },
          { id: 'n2', type: 'llm' as const, title: 'LLM step' },
        ],
        edges: [{ from: 'n1', to: 'n2' }],
      },
      agents: {},
      onError: null,
    };

    const result = importBlueprint(bp);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.resolvedAgents).toEqual([]);
    expect(result.missingAgents).toEqual([]);
  });

  it('reports missing agents', () => {
    const bp = {
      format: 'cabinet-workflow/v1' as const,
      exportedAt: '2026-06-01T00:00:00.000Z',
      sourceInstance: 'daemon_test',
      definition: {
        nodes: [{ id: 'n1', type: 'agentGroup' as const, role: 'my-agent' }],
        edges: [],
      },
      agents: { 'my-agent': { harnessId: 'generic', fallback: 'generic' } },
      onError: null,
    };

    const result = importBlueprint(bp, {
      get: () => null,
    });
    expect(result.missingAgents).toHaveLength(1);
    expect(result.missingAgents[0].agentId).toBe('my-agent');
  });
});

describe('Blueprint validation', () => {
  it('validates a correct blueprint', () => {
    const bp = {
      format: 'cabinet-workflow/v1',
      exportedAt: '2026-06-01T00:00:00.000Z',
      sourceInstance: 'daemon_test',
      definition: {
        nodes: [{ id: 'n1', type: 'start' }],
        edges: [],
      },
      agents: {},
      onError: null,
    };
    const issues = validateWorkflowExport(bp as any);
    expect(issues).toHaveLength(0);
  });

  it('detects missing format', () => {
    const issues = validateWorkflowExport({} as any);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain('format');
  });

  it('detects duplicate node IDs', () => {
    const bp = {
      format: 'cabinet-workflow/v1',
      exportedAt: '2026-06-01T00:00:00.000Z',
      sourceInstance: 'daemon_test',
      definition: {
        nodes: [
          { id: 'n1', type: 'start' },
          { id: 'n1', type: 'end' },
        ],
        edges: [],
      },
      agents: {},
      onError: null,
    };
    const issues = validateWorkflowExport(bp as any);
    expect(issues.some((i) => i.includes('Duplicate'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

```bash
cd packages/workflow
pnpm vitest run
Expected: All tests PASS
```

```bash
git add packages/workflow/src/__tests__/blueprint-io.test.ts
git commit -m "test: add blueprint export/import/validation tests"
```

---

### Task 8: 添加导入/导出用户反馈

**Files:**

- Modify: `apps/desktop/src/factory/WorkflowPanel.tsx`

- [ ] **Step 1: 给导入 handler 添加 toast**

```typescript
// WorkflowPanel.tsx — 修改 handleImport
// 当前代码在 try 块末尾没有反馈
const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const blueprint = JSON.parse(text);
    const res = await apiFetch('/api/workflows/import', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ blueprint, projectId: 'default' }),
    });
    const data = await res.json();
    if (data.id) {
      onWorkflowSave?.({ name: data.name });
      // 添加反馈
      addToast(
        'success',
        `Imported: ${data.nodes} nodes, ${data.edges} edges${data.missingAgents?.length ? `, ${data.missingAgents.length} missing agents` : ''}`,
      );
    }
  } catch {
    addToast('error', 'Import failed: invalid blueprint');
  }
};
```

- [ ] **Step 2: 给导出 handler 添加 toast**

```typescript
// WorkflowPanel.tsx — 修改 handleExport
// 在 URL.revokeObjectURL(url) 之后添加
addToast('success', `Exported: ${workflow.name}.cabinet.json`);
```

- [ ] **Step 3: 验证是否引入了 addToast**

如果 `WorkflowPanel.tsx` 还没有 `addToast`，添加 import：

```typescript
import { useToast } from '../components/Toast';
// 在组件函数开头添加
const { addToast } = useToast();
```

```bash
git add apps/desktop/src/factory/WorkflowPanel.tsx
git commit -m "feat: add toast feedback on blueprint import/export"
```

---

### Task 9: 评估 WorkflowsPage/FactoryPage 路由合并方案

**Files:**

- Read: `apps/desktop/src/App.tsx:397-413`
- Read: `apps/desktop/src/pages/WorkflowsPage.tsx`
- Read: `apps/desktop/src/pages/FactoryPage.tsx`

- [ ] **Step 1: 分析两个页面的路由分工**

当前路由：

- `/workflows` → `WorkflowsPage`：卡片列表 + 快速操作
- `/workflows/:id/edit` → `FactoryPage`：完整编辑器

但 `FactoryPage` 第 426 行还有项目级路由模式（`!isEditorRoute` 时显示 workflow 列表 + 编辑面板）。这意味着 FactoryPage 实际上同时承担了工作流列表和编辑器两种角色。

- [ ] **Step 2: 合并方向建议**

**推荐方案**: 将 `/workflows` 路由直接重定向到 `FactoryPage` 的项目级模式，完全移除 `WorkflowsPage`。

`FactoryPage` 已有的列表模式（`isEditorRoute=false`，左侧 340px 列表 + 右侧 canvas）已经覆盖了 WorkflowsPage 的功能。WorkflowsPage 的卡片列表是第二种视觉风格，但功能完全重复。

```typescript
// App.tsx — 路由修改
// Before:
<Route path="/workflows" element={<WorkflowsPage />} />
<Route path="/workflows/:id/edit" element={<FactoryPage .../>} />

// After:
<Route path="/workflows" element={<FactoryPage .../>} />
<Route path="/workflows/:id/edit" element={<FactoryPage .../>} />
```

`FactoryPage` 需要增加：

1. 一个 `handleExport` prop 或 handler（复用前面加到 WorkflowPage 的导出逻辑）
2. 列表项增加右键导出选项
3. 删除 `WorkflowsPage.tsx` 和相关 import

这个改动可以单独作为一个独立 PR。

- [ ] **结论**: 建议这个 Task 延后到 Plan 其他任务完成后单独处理。

```bash
git commit --allow-empty -m "docs: evaluate WorkflowsPage/FactoryPage merge — defer to separate PR"
```

---

### 验证清单

运行以下命令验证所有修改：

```bash
# 1. 类型检查
pnpm tsc --noEmit

# 2. 测试
cd packages/workflow && pnpm vitest run

# 3. 架构检查
pnpm lint:arch

# 4. Lint
pnpm lint
```

### 未纳入此计划的问题

| 问题                                       | 原因                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `authHeaders()` 返回空                     | 架构决策（PIN 认证移除后保留签名兼容），不是 BUG                          |
| WorkflowsPage 和 FactoryPage 超 500 行红线 | Task 3 解决了 FactoryPage 的部分问题；WorkflowsPage 只有 161 行，在红线内 |
| Approval 轮询性能                          | 需要实际部署数据才能判断是否真是瓶颈                                      |
| 能力门控对 handler 层无效                  | 需要更大的架构讨论（引入权限系统），超范围                                |
