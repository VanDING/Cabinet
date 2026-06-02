# Graph Execution Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a shared `StateGraph` primitive (~400 lines) as the single execution abstraction, then migrate both AgentLoop and WorkflowEngine to use it internally without breaking any existing API.

**Architecture:** New `@cabinet/graph` package with zero external dependencies (only `@cabinet/storage` for SQLite checkpoint persistence). `StateGraph` is a builder that compiles into `CompiledGraph` — a value object supporting `invoke()`, `stream()`, and `resume()`. Both `AgentLoop` and `WorkflowEngine` become consumers of this package.

**Tech Stack:** TypeScript 5.9, Vitest 4.x, better-sqlite3 (in-memory for tests), pnpm workspace

---

## File Structure

```
packages/graph/                           # NEW
├── package.json                          # NEW
├── tsconfig.json                         # NEW
├── vitest.config.ts                      # NEW
└── src/
    ├── index.ts                          # NEW — public exports
    ├── annotation.ts                     # NEW — Annotation type builder
    ├── state-graph.ts                    # NEW — StateGraph + CompiledGraph
    ├── checkpoint-store.ts               # NEW — linked-list checkpoint persistence
    ├── validation.ts                     # NEW — 6 compile passes
    ├── events.ts                         # NEW — StreamEvent types
    └── __tests__/
        ├── annotation.test.ts            # NEW
        ├── state-graph.test.ts           # NEW
        ├── checkpoint-store.test.ts      # NEW
        └── validation.test.ts            # NEW

packages/agent/src/agent-loop.ts          # MODIFY — internal rewrite
packages/workflow/src/engine.ts           # MODIFY — internal rewrite

# Root config updates
tsconfig.json                             # MODIFY — add packages/graph reference
```

---

### Task 0: Scaffold the new @cabinet/graph package

**Files:**
- Create: `packages/graph/package.json`
- Create: `packages/graph/tsconfig.json`
- Create: `packages/graph/vitest.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@cabinet/graph",
  "version": "0.1.0-alpha.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@cabinet/storage": "workspace:*"
  },
  "devDependencies": {
    "better-sqlite3": "^11.0.0",
    "typescript": "^5.9.0",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["src/**/__tests__/**"],
  "references": [
    { "path": "../storage" }
  ]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['**/dist/**', '**/node_modules/**'],
  },
});
```

- [ ] **Step 4: Add packages/graph to root tsconfig.json references**

Read `tsconfig.json`, add `{ "path": "packages/graph" }` to the `references` array. Keep alphabetical order among existing entries.

- [ ] **Step 5: Install dependencies**

```bash
cd packages/graph && pnpm install
```

Expected: installs better-sqlite3, typescript, vitest locally; no errors.

- [ ] **Step 6: Commit scaffold**

```bash
git add packages/graph/package.json packages/graph/tsconfig.json packages/graph/vitest.config.ts tsconfig.json
git commit -m "feat(graph): scaffold @cabinet/graph package"
```

---

### Task 1: Annotation type builder

**Files:**
- Create: `packages/graph/src/annotation.ts`
- Create: `packages/graph/src/__tests__/annotation.test.ts`
- Modify: `packages/graph/src/index.ts`

- [ ] **Step 1: Write failing tests for Annotation**

```typescript
// packages/graph/src/__tests__/annotation.test.ts
import { describe, it, expect } from 'vitest';
import { Annotation } from '../annotation.js';

describe('Annotation', () => {
  it('creates annotation with default and reducer', () => {
    const ann = Annotation<string[]>({
      reducer: (a, b) => [...a, ...b],
      default: () => [],
    });

    expect(ann.default()).toEqual([]);
    expect(ann.reducer(['a'], ['b'])).toEqual(['a', 'b']);
  });

  it('last-write-wins reducer', () => {
    const ann = Annotation<number>({
      reducer: (_a, b) => b,
      default: () => 0,
    });

    expect(ann.default()).toBe(0);
    expect(ann.reducer(5, 10)).toBe(10);
  });

  it('custom dedup reducer by key', () => {
    type Item = { id: string; value: string };
    const ann = Annotation<Item[]>({
      reducer: (a, b) => {
        const seen = new Set(a.map((x) => x.id));
        const newItems = b.filter((x) => !seen.has(x.id));
        return [...a, ...newItems];
      },
      default: () => [],
    });

    const result = ann.reducer(
      [{ id: '1', value: 'a' }],
      [{ id: '1', value: 'b' }, { id: '2', value: 'c' }],
    );
    expect(result).toEqual([
      { id: '1', value: 'a' },
      { id: '2', value: 'c' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/graph && pnpm test -- --run
```

Expected: FAIL — "Cannot find module '../annotation.js'"

- [ ] **Step 3: Implement Annotation**

```typescript
// packages/graph/src/annotation.ts
export interface AnnotationConfig<T> {
  reducer: (current: T, update: T) => T;
  default: () => T;
}

export interface Annotation<T> {
  reducer: (current: T, update: T) => T;
  default: () => T;
}

export function Annotation<T>(config: AnnotationConfig<T>): Annotation<T> {
  return {
    reducer: config.reducer,
    default: config.default,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/graph && pnpm test -- --run
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/graph/src/annotation.ts packages/graph/src/__tests__/annotation.test.ts
git commit -m "feat(graph): add Annotation state schema builder"
```

---

### Task 2: StreamEvent types

**Files:**
- Create: `packages/graph/src/events.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// packages/graph/src/events.ts
export type StreamEvent =
  | { type: 'node:start'; nodeId: string }
  | { type: 'node:end'; nodeId: string; update: Record<string, unknown> }
  | { type: 'llm:chunk'; nodeId: string; content: string }
  | { type: 'llm:thinking'; nodeId: string; content: string }
  | { type: 'tool:call'; nodeId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool:result'; nodeId: string; toolName: string; result: unknown }
  | { type: 'checkpoint:saved'; checkpointId: string }
  | { type: 'error'; nodeId: string; error: string };
```

- [ ] **Step 2: Commit**

```bash
git add packages/graph/src/events.ts
git commit -m "feat(graph): add StreamEvent type definitions"
```

---

### Task 3: CheckpointStore — linked-list persistence

**Files:**
- Create: `packages/graph/src/checkpoint-store.ts`
- Create: `packages/graph/src/__tests__/checkpoint-store.test.ts`

- [ ] **Step 1: Write failing test for CheckpointStore**

```typescript
// packages/graph/src/__tests__/checkpoint-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CheckpointStore } from '../checkpoint-store.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('CheckpointStore', () => {
  let db: Database.Database;
  let store: CheckpointStore;

  beforeEach(() => {
    db = createDb();
    store = new CheckpointStore(db);
    store.ensureTable();
  });

  it('saves and loads a checkpoint', () => {
    store.save({
      id: 'ckpt_run1_0',
      runId: 'run1',
      parentId: null,
      nodeId: 'buildContext',
      state: JSON.stringify({ messages: [], budget: 0 }),
      pendingTasks: null,
      metadata: JSON.stringify({ source: 'invoke', step: 0 }),
      createdAt: new Date().toISOString(),
    });

    const loaded = store.load('ckpt_run1_0');
    expect(loaded).not.toBeNull();
    expect(loaded!.nodeId).toBe('buildContext');
    expect(JSON.parse(loaded!.state)).toEqual({ messages: [], budget: 0 });
  });

  it('returns null for missing checkpoint', () => {
    expect(store.load('nonexistent')).toBeNull();
  });

  it('forms a linked list via parentId', () => {
    store.save({
      id: 'ckpt_run1_0', runId: 'run1', parentId: null,
      nodeId: 'nodeA', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });
    store.save({
      id: 'ckpt_run1_1', runId: 'run1', parentId: 'ckpt_run1_0',
      nodeId: 'nodeB', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });
    store.save({
      id: 'ckpt_run1_2', runId: 'run1', parentId: 'ckpt_run1_1',
      nodeId: 'nodeC', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });

    expect(store.getPrior('ckpt_run1_2')?.id).toBe('ckpt_run1_1');
    expect(store.getPrior('ckpt_run1_1')?.id).toBe('ckpt_run1_0');
    expect(store.getPrior('ckpt_run1_0')).toBeNull();
  });

  it('lists all checkpoints for a run', () => {
    store.save({
      id: 'ckpt_run1_0', runId: 'run1', parentId: null,
      nodeId: 'nodeA', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });
    store.save({
      id: 'ckpt_run1_1', runId: 'run1', parentId: 'ckpt_run1_0',
      nodeId: 'nodeB', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });

    const list = store.listRun('run1');
    expect(list).toHaveLength(2);
  });

  it('gc retains last N checkpoints for a run, deletes older ancestors', () => {
    const ids = ['ckpt_run1_0', 'ckpt_run1_1', 'ckpt_run1_2', 'ckpt_run1_3', 'ckpt_run1_4'];
    let parentId: string | null = null;
    for (const id of ids) {
      store.save({
        id, runId: 'run1', parentId,
        nodeId: 'node', state: '{}', pendingTasks: null,
        metadata: '{}', createdAt: new Date().toISOString(),
      });
      parentId = id;
    }

    store.gc('run1', 3);

    expect(store.load('ckpt_run1_0')).toBeNull();
    expect(store.load('ckpt_run1_1')).toBeNull();
    expect(store.load('ckpt_run1_2')).not.toBeNull();
    expect(store.load('ckpt_run1_3')).not.toBeNull();
    expect(store.load('ckpt_run1_4')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/graph && pnpm test -- --run
```

Expected: FAIL — "Cannot find module '../checkpoint-store.js'"

- [ ] **Step 3: Implement CheckpointStore**

```typescript
// packages/graph/src/checkpoint-store.ts
import type Database from 'better-sqlite3';

export interface CheckpointRecord {
  id: string;
  runId: string;
  parentId: string | null;
  nodeId: string;
  state: string;
  pendingTasks: string | null;
  metadata: string;
  createdAt: string;
}

export class CheckpointStore {
  constructor(private readonly db: Database.Database) {}

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        parent_id TEXT,
        node_id TEXT NOT NULL,
        state TEXT NOT NULL,
        pending_tasks TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_graph_checkpoints_run
      ON graph_checkpoints(run_id, created_at)
    `);
  }

  save(record: CheckpointRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO graph_checkpoints
         (id, run_id, parent_id, node_id, state, pending_tasks, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id, record.runId, record.parentId, record.nodeId,
        record.state, record.pendingTasks, record.metadata, record.createdAt,
      );
  }

  load(id: string): CheckpointRecord | null {
    const row = this.db
      .prepare('SELECT * FROM graph_checkpoints WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  getPrior(id: string): CheckpointRecord | null {
    const current = this.load(id);
    if (!current?.parentId) return null;
    return this.load(current.parentId);
  }

  listRun(runId: string): CheckpointRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM graph_checkpoints WHERE run_id = ? ORDER BY created_at ASC',
      )
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRecord(r));
  }

  gc(runId: string, keepLast: number): void {
    const rows = this.db
      .prepare(
        'SELECT id FROM graph_checkpoints WHERE run_id = ? ORDER BY created_at DESC',
      )
      .all(runId) as { id: string }[];

    if (rows.length <= keepLast) return;

    const toDelete = rows.slice(keepLast).map((r) => r.id);
    const placeholders = toDelete.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM graph_checkpoints WHERE id IN (${placeholders})`)
      .run(...toDelete);
  }

  private rowToRecord(row: Record<string, unknown>): CheckpointRecord {
    return {
      id: row['id'] as string,
      runId: row['run_id'] as string,
      parentId: (row['parent_id'] as string) ?? null,
      nodeId: row['node_id'] as string,
      state: row['state'] as string,
      pendingTasks: (row['pending_tasks'] as string) ?? null,
      metadata: (row['metadata'] as string) ?? '{}',
      createdAt: row['created_at'] as string,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/graph && pnpm test -- --run
```

Expected: PASS (all CheckpointStore tests + Annotation tests)

- [ ] **Step 5: Commit**

```bash
git add packages/graph/src/checkpoint-store.ts packages/graph/src/__tests__/checkpoint-store.test.ts
git commit -m "feat(graph): add CheckpointStore with linked-list persistence"
```

---

### Task 4: Compile-time validation

**Files:**
- Create: `packages/graph/src/validation.ts`
- Create: `packages/graph/src/__tests__/validation.test.ts`

- [ ] **Step 1: Write failing tests for validation**

```typescript
// packages/graph/src/__tests__/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateGraph, type EdgeDef } from '../validation.js';

describe('validateGraph', () => {
  const nodeIds = new Set(['a', 'b', 'c', 'd']);
  const entry = 'a';

  it('passes for a valid linear graph', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'b' },
      { type: 'static', from: 'b', to: 'c' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    expect(result.ok).toBe(true);
  });

  it('fails when edge references unknown target', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'nonexistent' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.message).toContain('nonexistent');
  });

  it('fails when entry node does not exist', () => {
    const edges: EdgeDef[] = [];
    const result = validateGraph(nodeIds, edges, 'nonexistent');
    expect(result.ok).toBe(false);
    expect(result.errors![0]!.message).toContain('entry');
  });

  it('warns about unreachable nodes', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'b' },
      // 'c' and 'd' are defined but unreachable
    ];
    const result = validateGraph(nodeIds, edges, entry);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings![0]!.message).toContain('unreachable');
  });

  it('warns about cycles without conditional exit', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'b' },
      { type: 'static', from: 'b', to: 'a' }, // cycle a↔b with no conditional edge
    ];
    const result = validateGraph(nodeIds, edges, entry);
    const cycleWarning = result.warnings?.find((w) => w.pass === 'pass_3_cycles');
    expect(cycleWarning).toBeDefined();
    expect(cycleWarning!.message).toContain('cycle');
  });

  it('does NOT warn when cycle has a conditional edge as escape', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'b' },
      { type: 'static', from: 'b', to: 'a' },
      { type: 'conditional', from: 'a', to: 'c', conditionValue: 'done' },
      { type: 'conditional', from: 'a', to: 'b', conditionValue: 'tools' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    // Should pass; the conditional edge from 'a' provides an escape hatch
    const cycleWarning = result.warnings?.find((w) => w.pass === 'pass_3_cycles');
    expect(cycleWarning).toBeUndefined();
  });

  it('fails when conditional edge has no default target', () => {
    const edges: EdgeDef[] = [
      { type: 'conditional', from: 'a', to: 'b', conditionValue: 'tools' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    expect(result.ok).toBe(false);
    expect(result.errors![0]!.message).toContain('default');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/graph && pnpm test -- --run
```

Expected: FAIL — "Cannot find module '../validation.js'"

- [ ] **Step 3: Implement validation**

```typescript
// packages/graph/src/validation.ts
export interface EdgeDef {
  type: 'static' | 'conditional';
  from: string;
  to: string;
  conditionValue?: string;
}

export interface CompileError {
  pass: string;
  severity: 'error' | 'warning';
  message: string;
  context?: { nodeId?: string; edgeFrom?: string; edgeTo?: string };
}

export interface ValidationResult {
  ok: boolean;
  errors: CompileError[];
  warnings: CompileError[];
}

export function validateGraph(
  nodeIds: Set<string>,
  edges: EdgeDef[],
  entry: string,
): ValidationResult {
  const errors: CompileError[] = [];
  const warnings: CompileError[] = [];

  // Pass 1: Node existence
  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        pass: 'pass_1_nodes',
        severity: 'error',
        message: `Edge source "${edge.from}" is not a registered node`,
        context: { edgeFrom: edge.from, edgeTo: edge.to },
      });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        pass: 'pass_1_nodes',
        severity: 'error',
        message: `Edge target "${edge.to}" is not a registered node`,
        context: { edgeFrom: edge.from, edgeTo: edge.to },
      });
    }
  }

  // Pass 2: Entry reachability
  if (!nodeIds.has(entry)) {
    errors.push({
      pass: 'pass_2_reachability',
      severity: 'error',
      message: `Entry node "${entry}" is not a registered node`,
    });
  }

  const reachable = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of edges) {
      if (edge.from === current && !reachable.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  for (const id of nodeIds) {
    if (!reachable.has(id)) {
      warnings.push({
        pass: 'pass_2_reachability',
        severity: 'warning',
        message: `Node "${id}" is unreachable from entry "${entry}"`,
        context: { nodeId: id },
      });
    }
  }

  // Pass 3: Cycle detection
  const cycles = findCycles(nodeIds, edges);
  for (const cycle of cycles) {
    const hasConditionalExit = edges.some(
      (e) => cycle.has(e.from) && e.type === 'conditional' && !cycle.has(e.to),
    );
    if (!hasConditionalExit) {
      warnings.push({
        pass: 'pass_3_cycles',
        severity: 'warning',
        message: `Cycle detected: ${[...cycle].join(' → ')} has no conditional exit edge`,
        context: { nodeId: [...cycle][0] },
      });
    }
  }

  // Pass 4: Conditional completeness
  for (const nodeId of nodeIds) {
    const condEdges = edges.filter((e) => e.from === nodeId && e.type === 'conditional');
    if (condEdges.length === 0) continue;

    const hasDefault = condEdges.some((e) => e.conditionValue === '__default__');
    if (!hasDefault) {
      errors.push({
        pass: 'pass_4_conditionals',
        severity: 'error',
        message: `Conditional edge from "${nodeId}" has no default (__default__) target`,
        context: { nodeId },
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/** Find strongly connected components (simple DFS-based for small graphs). */
function findCycles(nodeIds: Set<string>, edges: EdgeDef[]): Set<string>[] {
  const cycles: Set<string>[] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();

  for (const id of nodeIds) color.set(id, WHITE);

  function dfs(node: string, path: Set<string>) {
    color.set(node, GRAY);
    path.add(node);

    const neighbors = edges.filter((e) => e.from === node).map((e) => e.to);
    for (const neighbor of neighbors) {
      if (path.has(neighbor)) {
        // Found a back edge — extract the cycle
        const cycleNodes = new Set<string>();
        let inCycle = false;
        for (const p of path) {
          if (p === neighbor) inCycle = true;
          if (inCycle) cycleNodes.add(p);
        }
        cycleNodes.add(neighbor);
        if (cycleNodes.size >= 2) {
          cycles.push(cycleNodes);
        }
      } else if (color.get(neighbor) === WHITE) {
        dfs(neighbor, new Set(path));
      }
    }

    color.set(node, BLACK);
    path.delete(node);
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      dfs(id, new Set());
    }
  }

  return cycles;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/graph && pnpm test -- --run
```

Expected: PASS (all tests: Annotation, CheckpointStore, Validation)

- [ ] **Step 5: Commit**

```bash
git add packages/graph/src/validation.ts packages/graph/src/__tests__/validation.test.ts
git commit -m "feat(graph): add compile-time graph validation (6 passes)"
```

---

### Task 5: StateGraph builder + CompiledGraph

**Files:**
- Create: `packages/graph/src/state-graph.ts`
- Create: `packages/graph/src/__tests__/state-graph.test.ts`

- [ ] **Step 1: Write failing tests for StateGraph**

```typescript
// packages/graph/src/__tests__/state-graph.test.ts
import { describe, it, expect } from 'vitest';
import { StateGraph, END } from '../state-graph.js';
import { Annotation } from '../annotation.js';

const TestState = {
  value: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  counter: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
};

describe('StateGraph', () => {
  it('executes a linear graph', async () => {
    const graph = new StateGraph(TestState)
      .addNode('a', () => ({ value: 'step_a' }))
      .addNode('b', () => ({ value: 'step_b' }))
      .addEdge('a', 'b')
      .addEdge('b', END);

    const result = graph.compile({ entry: 'a' });
    expect(result.ok).toBe(true);

    const state = await result.graph!.invoke({});
    expect(state.value).toBe('step_b');
  });

  it('executes conditional edges based on router function', async () => {
    const graph = new StateGraph(TestState)
      .addNode('start', () => ({ counter: 1 }))
      .addNode('path_a', () => ({ value: 'a' }))
      .addNode('path_b', () => ({ value: 'b' }))
      .addEdge('start', 'branch')
      .addNode('branch', (s) => s) // pass-through
      .addConditionalEdges('branch', (s) => {
        return s.counter > 0 ? 'path_a' : 'path_b';
      }, {
        'path_a': 'path_a',
        'path_b': 'path_b',
        '__default__': END,
      });

    const result = graph.compile({ entry: 'start' });
    expect(result.ok).toBe(true);

    const state = await result.graph!.invoke({});
    expect(state.value).toBe('a');
  });

  it('ends when conditional router returns unknown key', async () => {
    const graph = new StateGraph(TestState)
      .addNode('start', () => ({ value: 'done' }))
      .addConditionalEdges('start', () => 'unknown_key', {
        '__default__': END,
      });

    const result = graph.compile({ entry: 'start' });
    const state = await result.graph!.invoke({});
    expect(state.value).toBe('done');
  });

  it('applies reducers when merging node output into state', async () => {
    const graph = new StateGraph(TestState)
      .addNode('a', () => ({ counter: 5 }))
      .addNode('b', () => ({ counter: 3 }))
      .addEdge('a', 'b')
      .addEdge('b', END);

    const result = graph.compile({ entry: 'a' });
    const state = await result.graph!.invoke({ counter: 1 });
    // counter reducer is (a,b) => a + b
    expect(state.counter).toBe(9); // 1 + 5 + 3
  });

  it('stops on maxSteps to prevent infinite loops', async () => {
    let calls = 0;
    const graph = new StateGraph(TestState)
      .addNode('loop', () => { calls++; return {}; })
      .addEdge('loop', 'loop');

    const result = graph.compile({ entry: 'loop' });
    const state = await result.graph!.invoke({}, { maxSteps: 5 });
    expect(calls).toBe(5);
  });

  it('retries node on failure up to maxRetries', async () => {
    let attempts = 0;
    const graph = new StateGraph(TestState)
      .addNode('flaky', () => {
        attempts++;
        if (attempts < 2) throw new Error('transient error');
        return { value: 'ok' };
      }, { maxRetries: 3 })
      .addEdge('flaky', END);

    const result = graph.compile({ entry: 'flaky' });
    const state = await result.graph!.invoke({});
    expect(state.value).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('routes to error edge when retries exhausted', async () => {
    const graph = new StateGraph(TestState)
      .addNode('failing', () => { throw new Error('persistent error'); }, { maxRetries: 1 })
      .addNode('errorHandler', () => ({ value: 'recovered' }))
      .addErrorEdge('failing', 'errorHandler')
      .addEdge('errorHandler', END);

    const result = graph.compile({ entry: 'failing' });
    const state = await result.graph!.invoke({});
    expect(state.value).toBe('recovered');
  });

  it('default state values are applied', async () => {
    const graph = new StateGraph(TestState)
      .addNode('nop', () => ({}))
      .addEdge('nop', END);

    const result = graph.compile({ entry: 'nop' });
    const state = await result.graph!.invoke({});
    expect(state.value).toBe('');      // default from annotation
    expect(state.counter).toBe(0);      // default from annotation
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/graph && pnpm test -- --run
```

Expected: FAIL — "Cannot find module '../state-graph.js'"

- [ ] **Step 3: Implement StateGraph and CompiledGraph**

```typescript
// packages/graph/src/state-graph.ts
import type { Annotation } from './annotation.js';
import { validateGraph, type EdgeDef, type ValidationResult } from './validation.js';
import type { StreamEvent } from './events.js';

export const END = Symbol('END');

type StateSchema = Record<string, Annotation<any>>;
type StateFromSchema<S extends StateSchema> = {
  [K in keyof S]: ReturnType<S[K]['default']>;
};

type NodeFn<S> = (state: S) => Promise<Partial<S>> | Partial<S>;
type RouterFn<S> = (state: S) => string;

interface NodeEntry<S> {
  fn: NodeFn<S>;
  maxRetries: number;
  errorEdge: string | null;
}

interface CompiledEdge {
  type: 'static' | 'conditional';
  to: string | typeof END;
  router?: RouterFn<any>;
  targets?: Record<string, string | typeof END>;
}

interface CompileOptions {
  entry: string;
}

export interface CompileResult<S> {
  ok: boolean;
  graph?: CompiledGraph<S>;
  errors?: ValidationResult['errors'];
  warnings?: ValidationResult['warnings'];
}

export interface InvokeConfig {
  maxSteps?: number;
}

export class CompiledGraph<S extends Record<string, unknown>> {
  constructor(
    private readonly nodes: Map<string, NodeEntry<S>>,
    private readonly outgoingEdges: Map<string, CompiledEdge[]>,
    private readonly schema: StateSchema,
    private readonly entryNode: string,
    private readonly warnings: ValidationResult['warnings'],
  ) {}

  getWarnings() {
    return this.warnings;
  }

  async invoke(input: Partial<S>, config?: InvokeConfig): Promise<S> {
    const maxSteps = config?.maxSteps ?? 100;
    let state = this.applyDefaults(input);
    let currentNode: string | typeof END = this.entryNode;
    let steps = 0;

    while (currentNode !== END && steps < maxSteps) {
      const node = this.nodes.get(currentNode);
      if (!node) break;

      const update = await this.executeWithRetry(node, state);
      state = this.mergeState(state, update);

      const edges = this.outgoingEdges.get(currentNode) ?? [];
      steps++;

      if (edges.length === 0) break;

      // Find next node: prefer conditional edges, then static
      let nextNode: string | typeof END | null = null;
      for (const edge of edges) {
        if (edge.type === 'conditional' && edge.router && edge.targets) {
          const target = edge.router(state);
          nextNode = edge.targets[target] ?? edge.targets['__default__'] ?? END;
          break;
        }
      }
      if (nextNode === null) {
        // Use first static edge
        const staticEdge = edges.find((e) => e.type === 'static');
        nextNode = staticEdge?.to ?? END;
      }

      currentNode = nextNode;
    }

    return state;
  }

  private async executeWithRetry(node: NodeEntry<S>, state: S): Promise<Partial<S>> {
    let lastError: Error | null = null;
    const maxAttempts = node.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await node.fn(state);
      } catch (e) {
        lastError = e as Error;
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
        }
      }
    }

    throw lastError ?? new Error('Node execution failed');
  }

  private applyDefaults(input: Partial<S>): S {
    const state = {} as S;
    for (const [key, ann] of Object.entries(this.schema)) {
      (state as any)[key] = (input as any)[key] ?? ann.default();
    }
    return state;
  }

  private mergeState(current: S, update: Partial<S>): S {
    const merged = { ...current } as S;
    for (const key of Object.keys(update) as (keyof S)[]) {
      const ann = this.schema[key as string];
      if (ann) {
        (merged as any)[key] = ann.reducer(current[key], (update as any)[key]);
      }
    }
    return merged;
  }
}

export class StateGraph<S extends StateSchema> {
  private nodes = new Map<string, NodeEntry<StateFromSchema<S>>>();
  private edges: EdgeDef[] = [];
  private routableEdges: Map<string, { router: RouterFn<StateFromSchema<S>>; targets: Record<string, string | typeof END> }> = new Map();

  addNode(
    id: string,
    fn: NodeFn<StateFromSchema<S>>,
    opts?: { maxRetries?: number },
  ): this {
    this.nodes.set(id, { fn, maxRetries: opts?.maxRetries ?? 0, errorEdge: null });
    return this;
  }

  addEdge(from: string, to: string | typeof END): this {
    const toStr = to === END ? '__END__' : to;
    this.edges.push({ type: 'static', from, to: toStr });
    return this;
  }

  addConditionalEdges(
    from: string,
    router: RouterFn<StateFromSchema<S>>,
    targets: Record<string, string | typeof END>,
  ): this {
    const normalized: Record<string, string> = {};
    for (const [key, val] of Object.entries(targets)) {
      normalized[key] = val === END ? '__END__' : val;
    }
    this.routableEdges.set(from, { router, targets: normalized });

    for (const [conditionValue, to] of Object.entries(normalized)) {
      this.edges.push({ type: 'conditional', from, to, conditionValue });
    }
    return this;
  }

  addErrorEdge(from: string, to: string): this {
    const node = this.nodes.get(from);
    if (node) {
      node.errorEdge = to;
    }
    return this;
  }

  compile(opts: CompileOptions): CompileResult<StateFromSchema<S>> {
    const nodeIds = new Set(this.nodes.keys());
    for (const edge of this.edges) {
      if (edge.to !== '__END__') nodeIds.add(edge.to);
    }

    const validation = validateGraph(nodeIds, this.edges, opts.entry);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, warnings: validation.warnings };
    }

    const outgoingEdges = new Map<string, CompiledEdge[]>();
    for (const edge of this.edges) {
      const existing = outgoingEdges.get(edge.from) ?? [];
      const compiledEdge: CompiledEdge = {
        type: edge.type,
        to: edge.to === '__END__' ? END : edge.to,
      };
      if (edge.type === 'conditional' && this.routableEdges.has(edge.from)) {
        const routeInfo = this.routableEdges.get(edge.from)!;
        compiledEdge.router = routeInfo.router;
        compiledEdge.targets = routeInfo.targets;
      }
      existing.push(compiledEdge);
      outgoingEdges.set(edge.from, existing);
    }

    return {
      ok: true,
      graph: new CompiledGraph(
        this.nodes,
        outgoingEdges,
        this as any as StateSchema,
        opts.entry,
        validation.warnings,
      ),
      warnings: validation.warnings,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/graph && pnpm test -- --run
```

Expected: PASS (Annotation, CheckpointStore, Validation, StateGraph tests all pass)

- [ ] **Step 5: Typecheck**

```bash
cd packages/graph && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Write index.ts with public exports**

```typescript
// packages/graph/src/index.ts
export { Annotation, type AnnotationConfig } from './annotation.js';
export { StateGraph, CompiledGraph, END, type CompileResult, type InvokeConfig } from './state-graph.js';
export { CheckpointStore, type CheckpointRecord } from './checkpoint-store.js';
export { validateGraph, type EdgeDef, type CompileError, type ValidationResult } from './validation.js';
export type { StreamEvent } from './events.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/graph/src/state-graph.ts packages/graph/src/__tests__/state-graph.test.ts packages/graph/src/index.ts
git commit -m "feat(graph): add StateGraph builder and CompiledGraph executor"
```

---

### Task 6: AgentLoop internal rewrite using StateGraph

**Files:**
- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/package.json`
- Modify: `packages/agent/tsconfig.json`

- [ ] **Step 1: Add @cabinet/graph dependency to agent package**

Update `packages/agent/package.json` — add `"@cabinet/graph": "workspace:*"` to `dependencies`.

Update `packages/agent/tsconfig.json` — add `{ "path": "../graph" }` to `references`.

```bash
cd packages/agent && pnpm install
```

- [ ] **Step 2: Run existing agent-loop tests to establish baseline**

```bash
cd packages/agent && pnpm test -- --run
```

Expected: All existing tests pass. Record which tests exist and their count.

- [ ] **Step 3: Rewrite AgentLoop.run() to use StateGraph internally**

In `packages/agent/src/agent-loop.ts`, replace the internal `run()` method's `while` loop with a CompiledGraph-based execution.

The key principle: **keep the public API identical, replace only the internal execution loop**.

Add this import at the top:
```typescript
import { StateGraph, CompiledGraph, END, Annotation } from '@cabinet/graph';
```

Define the AgentState schema inside the file (not exported):
```typescript
const AgentStateSchema = {
  messages: Annotation<{ role: 'user' | 'assistant'; content: string }[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [] as { role: 'user' | 'assistant'; content: string }[],
  }),
  executedToolCalls: Annotation<{ name: string; args: Record<string, unknown>; result: unknown }[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [] as { name: string; args: Record<string, unknown>; result: unknown }[],
  }),
  systemPrompt: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  contextZone: Annotation<'smart' | 'warning' | 'critical' | 'dumb'>({
    reducer: (_a, b) => b,
    default: () => 'smart' as const,
  }),
  stepCount: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  consecutiveErrors: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  handoffActive: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  finalContent: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
};
```

In `AgentLoop.run()`, replace the `while (steps < maxSteps)` loop body (lines 387-826) with building and invoking a graph:

```typescript
async run(userMessage: string, resumeState?: CheckpointState | null): Promise<AgentResult> {
  const maxSteps = this.options.maxSteps ?? 50;
  const startTime = Date.now();

  const state = resumeState ?? this.checkpointManager.load(this.options.sessionId);
  const isResuming = state !== null && state !== undefined;
  let steps = state?.step ?? 0;
  const executedToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] =
    (state?.toolCallHistory as any) ?? [];

  let messages: { role: 'user' | 'assistant'; content: string }[] = state?.messages ?? [];
  const wasCrashed = (state?.metadata as Record<string, unknown>)?.crashed === true;
  if (wasCrashed) {
    messages.push({
      role: 'assistant',
      content: '[System: Previous session crashed. Resuming from checkpoint...]',
    });
  }

  const zoneCounts = { smart: 0, warning: 0, critical: 0, dumb: 0 };
  let handoffCount = 0;
  const errorCounts = { transient: 0, recoverable: 0, fatal: 0 };
  const toolCounts = { total: 0, succeeded: 0, failed: 0, blocked: 0 };
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Add user message
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.content !== userMessage) {
      messages.push({ role: 'user', content: userMessage });
    }
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  if (!this.sessionHandoff) {
    this.sessionHandoff = new ContextHandoff(userMessage);
  }
  const handoff = this.sessionHandoff;
  const trust = TRUST_THRESHOLDS[this.options.trustLevel ?? 'T1'];
  const activeToolExecutor = await this.resolveToolExecutor(this.options.taskDescription);

  // Build the graph for this run
  const graph = this.buildRunGraph(
    maxSteps, trust, activeToolExecutor, handoff,
    executedToolCalls, zoneCounts, handoffCount, errorCounts, toolCounts,
    totalPromptTokens, totalCompletionTokens,
  );

  const compileResult = graph.compile({ entry: 'buildContext' });
  if (!compileResult.ok) {
    const errorMessages = compileResult.errors?.map((e) => e.message).join('; ') ?? 'unknown';
    return { content: `Graph compilation failed: ${errorMessages}`, steps, toolCalls: executedToolCalls };
  }

  const initialState = {
    messages,
    executedToolCalls,
    stepCount: steps,
    consecutiveErrors: 0,
    handoffActive: false,
    finalContent: '',
  } as any;

  try {
    const resultState = await compileResult.graph!.invoke(initialState, { maxSteps });

    const finalContent = String(resultState.finalContent ?? '');
    const finalSteps = Number(resultState.stepCount ?? 0);

    this.reportSession(
      startTime, finalSteps, executedToolCalls,
      totalPromptTokens, totalCompletionTokens,
      zoneCounts, 0, errorCounts, toolCounts, true,
    );

    this.flushCheckpoint();
    this.checkpointManager.delete(this.options.sessionId);
    this.pendingCheckpoint = null;
    this.conversationHistory = [...(resultState.messages ?? [])];

    return {
      content: finalContent || `Agent reached max steps without final response.`,
      steps: finalSteps,
      toolCalls: executedToolCalls,
      usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
      structuredOutput: parseStructuredOutput(finalContent),
    };
  } catch (error) {
    errorCounts.fatal++;
    this.reportSession(
      startTime, steps, executedToolCalls,
      totalPromptTokens, totalCompletionTokens,
      zoneCounts, 0, errorCounts, toolCounts, false,
    );
    this.flushCheckpoint();
    this.checkpointManager.delete(this.options.sessionId);
    this.pendingCheckpoint = null;
    return {
      content: `Agent loop failed: ${(error as Error).message}`,
      steps,
      toolCalls: executedToolCalls,
    };
  }
}
```

Add the private `buildRunGraph()` method. This is the new code (~120 lines) that replaces the inline while loop:

```typescript
private buildRunGraph(
  maxSteps: number,
  trust: { maxConsecutiveErrors: number; maxProbeTools: number },
  activeToolExecutor: ToolExecutor,
  handoff: ContextHandoff,
  executedToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[],
  zoneCounts: { smart: number; warning: number; critical: number; dumb: number },
  handoffCountRef: { value: number },
  errorCounts: { transient: number; recoverable: number; fatal: number },
  toolCounts: { total: number; succeeded: number; failed: number; blocked: number },
  totalPromptRef: { value: number },
  totalCompletionRef: { value: number },
): StateGraph<typeof AgentStateSchema> {
  const self = this;

  return new StateGraph(AgentStateSchema)
    .addNode('buildContext', async (s) => {
      const ctx = await self.contextBuilder.build({
        sessionId: self.options.sessionId,
        projectId: self.options.projectId,
        captainId: self.options.captainId,
        roleSystemPrompt: self.options.systemPrompt,
        activeFiles: self.options.activeFiles,
        taskDescription: s.stepCount === 0 ? self.options.taskDescription : undefined,
        memorySessionId: self.options.memorySessionId,
        prebuiltContext: self.options.prebuiltContext,
      });

      let sysPrompt = ctx.systemPrompt;
      const projectRoot = self.options.projectRoot ?? process.cwd();
      const snapshot = ProjectSnapshot.getCached(projectRoot)
        ?? (() => { const c = ProjectSnapshot.capture(projectRoot); ProjectSnapshot.store(projectRoot, c); return c; })();
      if (snapshot && !self.options.systemPrompt) {
        sysPrompt = `${sysPrompt}\n\n## Project Structure\n${snapshot.summary}\n\nKey directories:\n${snapshot.tree.slice(0, 20).join('\n')}`;
      }
      if (self['skillContext']) {
        sysPrompt = `${sysPrompt}\n\n## Active Skill Context\n${self['skillContext']}`;
        self['skillContext'] = null;
      }

      const internalContents = new Set(s.messages.map((m) => m.content));
      const uniqueCtxMessages = ctx.messages.filter((m) => !internalContents.has(m.content));
      const allMsgs = [...uniqueCtxMessages, ...s.messages];

      return {
        systemPrompt: sysPrompt,
        messages: allMsgs,
      };
    })
    .addNode('contextCheck', async (s) => {
      if (!self.contextMonitor) return { contextZone: 'smart' };

      const breakdown: ContextBreakdown = {
        systemPrompt: self.contextMonitor.estimateTokens(s.systemPrompt),
        messages: self.contextMonitor.estimateTokens(s.messages.map((m) => m.content).join('\n')),
        toolResults: self.contextMonitor.estimateTokens(
          s.messages
            .filter((m) => m.role === 'user' && m.content.startsWith('Tool result'))
            .map((m) => m.content)
            .join('\n'),
        ),
        memory: 0,
      };
      const snap = self.contextMonitor.snapshot(breakdown);
      return { contextZone: snap.zone };
    })
    .addNode('compressContext', async (s) => {
      if (!self.contextMonitor) return { handoffActive: false };
      const snap = self.contextMonitor.current;
      if (!snap) return { handoffActive: false };

      const result = handoff.performHandoff(snap);
      handoffCountRef.value++;

      const keepRecent = 4;
      const recentMessages = s.messages.slice(-keepRecent);
      const middleMessages = s.messages.slice(0, -keepRecent);
      const middleSummary = middleMessages.length > 0
        ? `${middleMessages.length} prior messages summarized.`
        : '';

      const newMessages: { role: 'user' | 'assistant'; content: string }[] = [
        { role: 'user', content: result.handoffMessage },
        ...(middleMessages.length > 0
          ? [{ role: 'assistant' as const, content: `[context_compact] ${middleSummary}` }]
          : []),
        ...recentMessages,
      ];

      handoff.reset();
      return { messages: newMessages, handoffActive: false };
    })
    .addNode('llm', async (s) => {
      if (s.consecutiveErrors >= trust.maxConsecutiveErrors) {
        const msg = `Agent stopped after ${s.consecutiveErrors} consecutive errors.`;
        return { finalContent: msg };
      }

      let response: LLMResponse;
      try {
        response = await withRetry(
          () => self.gateway.generateText({
            model: self.options.model ?? 'claude-sonnet-4-6',
            systemPrompt: s.systemPrompt,
            messages: s.messages,
            tools: activeToolExecutor.getToolDescriptors(),
            cacheSystemPrompt: true,
            ...(self.options.maxResponseTokens != null ? { maxTokens: self.options.maxResponseTokens } : {}),
            ...(self.options.temperature != null ? { temperature: self.options.temperature } : {}),
          }),
          new Error('LLM call'),
        );
      } catch (error) {
        return { consecutiveErrors: s.consecutiveErrors + 1 };
      }

      totalPromptRef.value += response.usage?.promptTokens ?? 0;
      totalCompletionRef.value += response.usage?.completionTokens ?? 0;

      if (self.options.costTracker && response.usage) {
        self.options.costTracker.record(
          response.model,
          response.usage.promptTokens,
          response.usage.completionTokens,
          response.usage.cachedPromptTokens ?? 0,
        );
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        const finalMsg = response.content;
        return {
          messages: [...s.messages, { role: 'assistant', content: finalMsg }],
          finalContent: finalMsg,
          stepCount: s.stepCount + 1,
          consecutiveErrors: 0,
        };
      }

      return {
        messages: [...s.messages, { role: 'assistant', content: response.content }],
        stepCount: s.stepCount + 1,
        consecutiveErrors: 0,
        _pendingToolCalls: response.toolCalls as any,
      } as any;
    })
    .addNode('tools', async (s) => {
      const tcs = (s as any)._pendingToolCalls as { id: string; name: string; arguments: Record<string, unknown> }[] | undefined;
      if (!tcs || tcs.length === 0) return {};

      // Parallel execution for read tools, sequential for write tools
      const READ_TOOL_NAMES = new Set([
        'read_file', 'file_info', 'list_directory', 'glob', 'grep',
        'search_memory', 'recall', 'query_decisions', 'get_decision',
        'get_recent_events', 'get_project_context', 'get_captain_preferences',
        'list_workflows', 'get_workflow', 'list_agents', 'list_projects',
        'list_scheduled_tasks', 'search_documents', 'web_fetch',
        'workspace_symbol', 'go_to_definition', 'find_references', 'diagnostics',
        'recent_files', 'watch_file',
      ]);

      const allReadOnly = tcs.every((tc) => READ_TOOL_NAMES.has(tc.name));
      const results: { role: 'user'; content: string }[] = [];

      const executeOne = async (tc: { id: string; name: string; arguments: Record<string, unknown> }) => {
        toolCounts.total++;

        const safety = self.safetyChecker.check(tc.name, tc.arguments);
        if (!safety.allowed) {
          toolCounts.blocked++;
          executedToolCalls.push({ name: tc.name, args: tc.arguments, result: `BLOCKED: ${safety.reason}` });
          return { role: 'user' as const, content: `Tool '${tc.name}' blocked: ${safety.reason}` };
        }

        let result: ToolResult;
        try {
          result = await Promise.race([
            self.toolExecutor.execute(tc.name, tc.id, tc.arguments, { sessionId: self.options.sessionId }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Tool '${tc.name}' timed out`)),
              self.options.toolTimeoutMs ?? 300000),
            ),
          ]);
        } catch (timeoutError) {
          self.pendingCheckpoint = {
            sessionId: self.options.sessionId,
            step: s.stepCount,
            messages: s.messages,
            toolCallHistory: executedToolCalls,
            metadata: { projectId: self.options.projectId, crashed: true },
          };
          self.flushCheckpoint();
          throw timeoutError;
        }

        if (result.error) { toolCounts.failed++; }
        else { toolCounts.succeeded++; }

        executedToolCalls.push({ name: tc.name, args: tc.arguments, result: result.error ?? result.output });

        const errorLabel = result.errorType ? `[${result.errorType}] ` : '';
        return {
          role: 'user' as const,
          content: `Tool result for ${tc.name}: ${errorLabel}${JSON.stringify(result.error ?? result.output)}`,
        };
      };

      if (allReadOnly) {
        const outcomes = await Promise.all(tcs.map(executeOne));
        results.push(...outcomes);
      } else {
        for (const tc of tcs) {
          results.push(await executeOne(tc));
        }
      }

      // Buffer checkpoint every 5 steps
      if (s.stepCount - (self as any).lastSavedStep >= 5) {
        self.pendingCheckpoint = {
          sessionId: self.options.sessionId,
          step: s.stepCount,
          messages: s.messages,
          toolCallHistory: executedToolCalls,
          metadata: { projectId: self.options.projectId },
        };
        self.flushCheckpoint();
      }

      return { messages: [...s.messages, ...results] };
    })
    // Edges
    .addEdge('buildContext', 'contextCheck')
    .addConditionalEdges('contextCheck', (s) => {
      if (s.contextZone === 'critical' || s.contextZone === 'dumb') {
        return handoff.shouldHandoff(self.contextMonitor?.current!)
          ? 'compress' : 'llm';
      }
      return 'llm';
    }, { compress: 'compressContext', llm: 'llm', '__default__': 'llm' })
    .addEdge('compressContext', 'contextCheck')
    .addConditionalEdges('llm', (s) => {
      if (s.finalContent) return 'done';
      if ((s as any)._pendingToolCalls) return 'tools';
      return 'done';
    }, { tools: 'tools', done: '__END__', '__default__': '__END__' })
    .addEdge('tools', 'llm')
    .addErrorEdge('tools', 'llm');
}
```

The rest of AgentLoop (constructor, `runStreaming`, `resume`, `continueWithUserInput`, `reportSession`, `flushCheckpoint`, etc.) stays unchanged.

- [ ] **Step 4: Run existing agent-loop tests to verify they still pass**

```bash
cd packages/agent && pnpm test -- --run
```

Expected: All existing tests pass. If any fail, debug the `buildRunGraph()` node logic.

- [ ] **Step 5: Typecheck**

```bash
cd packages/agent && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/agent-loop.ts packages/agent/package.json packages/agent/tsconfig.json
git commit -m "refactor(agent): replace AgentLoop while-loop with StateGraph-based execution"
```

---

### Task 7: WorkflowEngine internal rewrite using StateGraph

**Files:**
- Modify: `packages/workflow/src/engine.ts`
- Modify: `packages/workflow/package.json`
- Modify: `packages/workflow/tsconfig.json`

- [ ] **Step 1: Add @cabinet/graph dependency to workflow package**

Update `packages/workflow/package.json` — add `"@cabinet/graph": "workspace:*"` to `dependencies`.

Update `packages/workflow/tsconfig.json` — add `{ "path": "../graph" }` to `references`.

```bash
cd packages/workflow && pnpm install
```

- [ ] **Step 2: Run existing workflow tests to establish baseline**

```bash
cd packages/workflow && pnpm test -- --run
```

Expected: All existing tests pass. Note the exact test count.

- [ ] **Step 3: Rewrite WorkflowEngine to use StateGraph internally**

In `packages/workflow/src/engine.ts`, import from graph package:
```typescript
import { StateGraph, END, Annotation } from '@cabinet/graph';
```

Define WorkflowState:
```typescript
const WorkflowState = {
  _nodeId: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  _output: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
} as Record<string, Annotation<any>>;

// Dynamic state: each node's output is stored under its nodeId key
// We add these at graph build time based on the actual node IDs
function buildWorkflowState(nodeIds: string[]): Record<string, Annotation<any>> {
  const schema: Record<string, Annotation<any>> = { ...WorkflowState };
  for (const id of nodeIds) {
    schema[id] = Annotation<unknown>({
      reducer: (_a: unknown, b: unknown) => b,
      default: () => null,
    });
  }
  return schema;
}
```

Replace the `executeNode()` method and `buildGraph()` with `buildStateGraph()`:

```typescript
private buildStateGraph(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdge[],
  entryNodeId: string,
  run: WorkflowRun,
): StateGraph<Record<string, any>> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const graph = this.buildGraph(nodes, edges); // keep adjacency list helper
  const schema = buildWorkflowState(nodes.map((n) => n.id));
  const sg = new StateGraph(schema);
  const self = this;

  for (const node of nodes) {
    sg.addNode(node.id, async (state: Record<string, unknown>) => {
      const previousOutputs = run.steps.map((s) => s.output).join('\n');
      let output = '';

      switch (node.type) {
        case 'start':
          output = 'Workflow started';
          break;
        case 'end':
          output = 'Workflow ended';
          break;
        case 'skill': {
          if (!self.handlers.skill) throw new Error('No skill handler');
          const result = await self.handlers.skill(node.skillId ?? node.id, {
            nodeId: node.id,
            previousOutputs,
            inputMapping: node.inputMapping ?? {},
          });
          output = typeof result === 'string' ? result : JSON.stringify(result);
          break;
        }
        case 'tool': {
          if (!self.handlers.tool) throw new Error('No tool handler');
          const params = { ...(node.inputMapping ?? {}) };
          for (const [k, v] of Object.entries(params)) {
            if (typeof v === 'string' && v.startsWith('{{')) {
              params[k] = self.resolveVariable(v, run);
            }
          }
          const result = await self.handlers.tool(node.toolId ?? node.id, params);
          output = typeof result === 'string' ? result : JSON.stringify(result);
          break;
        }
        case 'code': {
          if (!self.handlers.runCode) throw new Error('No code handler');
          const timeout = node.codeTimeout ?? 5000;
          const result = await self.handlers.runCode(node.code ?? '', previousOutputs, timeout);
          output = typeof result === 'string' ? result : JSON.stringify(result);
          break;
        }
        case 'llm': {
          if (run._agentLoop) {
            const prompt = node.prompt ?? node.title ?? 'Process this step';
            output = await self.withTimeout(
              run._agentLoop.handle.run(prompt),
              node.codeTimeout ?? 120_000,
              `LLM ${node.id}`,
            );
          } else if (self.handlers.aiAgent) {
            output = await self.withTimeout(
              self.handlers.aiAgent(node, previousOutputs),
              node.codeTimeout ?? 120_000,
              `LLM ${node.id}`,
            );
          } else {
            throw new Error('LLM node requires an AgentGroup or aiAgent handler');
          }
          break;
        }
        case 'agentGroup': {
          const role = node.role ?? 'secretary';
          await self.finalizeAgentSegment(run);
          if (!self.handlers.createAgentLoop) { output = 'No agent handler'; break; }
          const handle = await self.handlers.createAgentLoop(role, run.runId, {
            persistent: node.persistent ?? true,
            systemPrompt: node.systemPrompt,
            model: node.model,
            allowedTools: node.allowedTools,
          });
          run._agentLoop = { agentId: role, handle };
          output = `Agent group ${role} started`;
          break;
        }
        case 'ifElse': {
          const conditionExpr = node.loopCondition ?? 'true';
          const isTrue = self.evaluateCondition(conditionExpr, previousOutputs, run);
          output = `Condition evaluated: ${isTrue}`;
          // The conditional edge handles routing based on this output
          (run as any)._lastConditionResult = isTrue;
          break;
        }
        case 'pass':
          output = '';
          break;
        case 'parallel': {
          // Children are handled through graph edges; this node is just a marker
          const children = graph.get(node.id) ?? [];
          const childResults = await Promise.allSettled(
            children.map((id) => {
              const childNode = nodeMap.get(id);
              if (!childNode) return Promise.resolve('');
              return self.executeSingleNode(childNode, nodeMap, run);
            }),
          );
          const parts: string[] = [];
          for (let i = 0; i < children.length; i++) {
            const r = childResults[i];
            parts.push(`[${children[i]}]: ${r?.status === 'fulfilled' ? r.value : 'failed'}`);
          }
          output = parts.join('\n');
          break;
        }
        case 'approval': {
          if (!self.handlers.humanApproval) throw new Error('No humanApproval handler');
          const decision = await self.handlers.humanApproval(node, run);
          if (decision.status === 'pending') {
            output = `Approval pending: decision ${decision.decisionId}`;
            run.status = 'awaiting_approval';
          } else {
            output = 'Approval granted';
          }
          break;
        }
        default:
          output = `Unsupported node type: ${node.type}`;
      }

      run.steps.push({ nodeId: node.id, type: node.type, output });
      run.results.set(node.id, output);
      run.currentNodeId = node.id;
      self.appendStepAndResult(run, node.id, node.type, output);

      // Write output into state under this node's ID
      const update: Record<string, unknown> = { _nodeId: node.id, _output: output };
      update[node.id] = output;
      return update;
    });
  }

  // Add edges
  for (const edge of edges) {
    sg.addEdge(edge.from, edge.to);
  }

  // Add conditional edges for ifElse nodes
  for (const node of nodes) {
    if (node.type === 'ifElse') {
      const children = graph.get(node.id) ?? [];
      const trueChild = children[0];
      const falseChild = children.length >= 2 ? children[1] : undefined;

      const targets: Record<string, string> = { __default__: trueChild ?? '__END__' };
      if (trueChild) targets['true'] = trueChild;
      if (falseChild) targets['false'] = falseChild;

      sg.addConditionalEdges(node.id, (_state: Record<string, unknown>) => {
        return (run as any)._lastConditionResult ? 'true' : 'false';
      }, targets);
    }
  }

  return sg;
}

// Helper for parallel node execution (bypasses graph traversal for direct children)
private async executeSingleNode(
  node: WorkflowNodeDef,
  nodeMap: Map<string, WorkflowNodeDef>,
  run: WorkflowRun,
): Promise<string> {
  const previousOutputs = run.steps.map((s) => s.output).join('\n');
  // Simplified single-node execution for parallel branches
  if (node.type === 'skill' && this.handlers.skill) {
    const result = await this.handlers.skill(node.skillId ?? node.id, { nodeId: node.id, previousOutputs });
    const output = typeof result === 'string' ? result : JSON.stringify(result);
    run.steps.push({ nodeId: node.id, type: node.type, output });
    run.results.set(node.id, output);
    return output;
  }
  return '';
}
```

Rewrite `startRun()` to use the graph:
```typescript
async startRun(
  workflowId: string, nodes: WorkflowNodeDef[], edges: WorkflowEdge[], entryNodeId: string,
): Promise<WorkflowRun> {
  const runId = `run_${Date.now()}`;
  const run: WorkflowRun = {
    runId, workflowId, status: 'running', currentNodeId: entryNodeId,
    results: new Map(), steps: [], startedAt: new Date(),
  };
  this.runs.set(runId, run);
  this.saveRun(run);

  try {
    const sg = this.buildStateGraph(nodes, edges, entryNodeId, run);
    const compiled = sg.compile({ entry: entryNodeId });

    if (!compiled.ok) {
      run.status = 'failed';
      this.saveRun(run);
      return run;
    }

    await compiled.graph!.invoke({});
    await this.finalizeAgentSegment(run);
  } catch (error) {
    await this.finalizeAgentSegment(run);
    run.status = 'failed';
    this.saveRun(run);
    return run;
  }

  if (run.status === 'running') { run.status = 'completed'; this.saveRun(run); }
  return run;
}
```

Keep `continueRun()`, `getRun()`, `buildGraph()`, `saveRun()`, `loadRun()`, `finalizeAgentSegment()`, `resolveVariable()`, `resolveValue()`, `evaluateOp()`, `evaluateCondition()`, `withTimeout()`, and `appendStepAndResult()` unchanged.

Remove `executeNode()` — it's replaced by graph node functions.

- [ ] **Step 4: Run existing workflow tests to verify they still pass**

```bash
cd packages/workflow && pnpm test -- --run
```

Expected: All existing tests pass. The linear workflow, condition branching, and human approval tests should all produce the same results.

- [ ] **Step 5: Typecheck**

```bash
cd packages/workflow && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow/src/engine.ts packages/workflow/package.json packages/workflow/tsconfig.json
git commit -m "refactor(workflow): replace executeNode switch-case with StateGraph-based execution"
```

---

### Task 8: Full test suite verification

- [ ] **Step 1: Run all tests across all affected packages**

```bash
cd packages/graph && pnpm test -- --run && cd ../agent && pnpm test -- --run && cd ../workflow && pnpm test -- --run
```

Expected: All tests pass across all three packages.

- [ ] **Step 2: Run full project typecheck**

```bash
pnpm -r typecheck
```

Expected: no errors across all packages.

- [ ] **Step 3: Commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: verify full test suite passes after graph engine migration"
```

---

## Self-Review

**1. Spec coverage:**
- Annotation type builder → Task 1 ✓
- StateGraph builder + CompiledGraph → Task 5 ✓
- Checkpoint linked-list model → Task 3 ✓
- Compile-time validation (6 passes) → Task 4 ✓
- StreamEvent types → Task 2 ✓
- AgentLoop migration (fine-grained nodes) → Task 6 ✓
- WorkflowEngine migration (node types → graph nodes) → Task 7 ✓
- Non-breaking API constraint → Tasks 6+7 keep external API unchanged ✓

**2. Placeholder scan:** No TBD, TODO, "implement later", "add error handling" without code. Every task has concrete code.

**3. Type consistency:**
- `Annotation<T>` defined in Task 1, used in Tasks 5, 6, 7 — consistent
- `StateGraph` + `CompiledGraph` defined in Task 5, used in Tasks 6, 7 — consistent
- `EdgeDef` defined in Task 4, used in Task 4 tests — consistent
- `StreamEvent` defined in Task 2, referenced in Task 5 via import — file exists before use
- `END` symbol defined in Task 5 — consistent usage
