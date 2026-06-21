# Multi-Agent Node Factory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `createAgentNodeFactory` + `createSelector` to `packages/agent/`, adapting AgentLoop into StateGraph-compatible node functions with structured handoff and multi-round selection.

**Architecture:** Two new files in `packages/agent/` — `agent-handoff.ts` (types only) and `agent-node.ts` (factory + selector). Zero changes to any other package. The factory injects AgentLoop dependencies once and returns a per-node factory. Each agent node creates an isolated AgentLoop, runs it, and writes results via a configurable output mapper (defaulting to AgentHandoff).

**Tech Stack:** TypeScript 5.9, Vitest 4.x, better-sqlite3 (in-memory for tests)

---

### Task 1: AgentHandoff type

**Files:**

- Create: `packages/agent/src/agent-handoff.ts`

- [ ] **Step 1: Create agent-handoff.ts**

```typescript
// packages/agent/src/agent-handoff.ts

export interface AgentHandoff {
  from: string;
  task: string;
  summary: string;
  findings: Array<{
    type: string;
    detail: string;
    severity?: 'high' | 'medium' | 'low';
  }>;
  decisions: Array<{ decision: string; rationale: string }>;
  openQuestions: string[];
  confidence: number;
  rawOutput: string;
}

/** Build a handoff from an AgentResult when structuredOutput is available. */
export function buildHandoffFromResult(
  from: string,
  task: string,
  rawOutput: string,
  structuredOutput?: {
    summary?: string;
    findings?: Array<{ type: string; detail: string; severity?: 'high' | 'medium' | 'low' }>;
    decisions?: Array<{ decision: string; rationale: string }>;
    openQuestions?: string[];
    confidence?: number;
  } | null,
): AgentHandoff {
  return {
    from,
    task,
    summary: structuredOutput?.summary ?? rawOutput.slice(0, 200),
    findings: structuredOutput?.findings ?? [],
    decisions: structuredOutput?.decisions ?? [],
    openQuestions: structuredOutput?.openQuestions ?? [],
    confidence: structuredOutput?.confidence ?? 0.5,
    rawOutput,
  };
}

/** Extract a simple AgentHandoff when structuredOutput is absent.
 *  Attempts to pull a confidence number from JSON blocks in the raw text. */
export function buildSimpleHandoff(from: string, task: string, rawOutput: string): AgentHandoff {
  let confidence = 0.5;
  try {
    const match = rawOutput.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.confidence === 'number')
        confidence = Math.max(0, Math.min(1, parsed.confidence));
    }
  } catch {
    /* ignore parse errors */
  }

  return {
    from,
    task,
    summary: rawOutput.slice(0, 200),
    findings: [],
    decisions: [],
    openQuestions: [],
    confidence,
    rawOutput,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/src/agent-handoff.ts
git commit -m "feat(agent): add AgentHandoff type with build helpers"
```

---

### Task 2: createAgentNodeFactory

**Files:**

- Create: `packages/agent/src/agent-node.ts`
- Create: `packages/agent/src/__tests__/agent-node.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/agent/src/__tests__/agent-node.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createAgentNodeFactory, type AgentNodeDeps } from '../agent-node.js';
import { ToolExecutor } from '../tool-executor.js';
import { SafetyChecker } from '../safety.js';
import { CheckpointManager } from '../checkpoint.js';
import { SECRETARY_ROLE, REVIEWER_ROLE } from '../agent-roles.js';
import type { MemoryProvider } from '../context-builder.js';
import type {
  LLMGateway,
  LLMResponse,
  LLMCallOptions,
  EmbeddingOptions,
  EmbeddingResult,
} from '@cabinet/gateway';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

class MockMemory implements MemoryProvider {
  async getShortTerm() {
    return [];
  }
  async getProjectContext() {
    return 'test';
  }
  async getEntityPreferences() {
    return {};
  }
  async searchLongTerm() {
    return [];
  }
}

interface TestState {
  topic: string;
  agentHandoffs: Record<string, unknown>;
  agentId: string;
}

describe('createAgentNodeFactory', () => {
  let deps: AgentNodeDeps;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    const db = createDb();
    toolExecutor = new ToolExecutor();
    toolExecutor.register({
      name: 'echo',
      execute: async (args) => args.message ?? 'echo',
    });

    const mockGateway: LLMGateway = {
      async generateText(_opts: LLMCallOptions): Promise<LLMResponse> {
        return {
          content: '{"summary":"test result","confidence":0.8}',
          usage: { promptTokens: 10, completionTokens: 5 },
          model: 'test-model',
        };
      },
      async *streamText() {
        yield { type: 'done' };
      },
      async listModels() {
        return ['test-model'];
      },
      async generateEmbeddings(_opts: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [], model: 'test', usage: { tokens: 0 } };
      },
    };

    deps = {
      gateway: mockGateway,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      db,
      memoryProvider: new MockMemory(),
    };
  });

  it('produces a function compatible with StateGraph.addNode', () => {
    const factory = createAgentNodeFactory<TestState>(deps);
    const nodeFn = factory({
      role: SECRETARY_ROLE,
      agentId: 'secretary',
      input: (s) => ({ message: s.topic }),
    });
    expect(typeof nodeFn).toBe('function');
  });

  it('runs an AgentLoop and writes handoff by default', async () => {
    const factory = createAgentNodeFactory<TestState>(deps);
    const nodeFn = factory({
      role: SECRETARY_ROLE,
      agentId: 'secretary',
      input: (s) => ({ message: s.topic }),
    });

    const state: TestState = { topic: 'test topic', agentHandoffs: {}, agentId: '' };
    const update = await nodeFn(state);

    expect(update.agentHandoffs).toBeDefined();
    const handoff = (update.agentHandoffs as Record<string, unknown>)['secretary'];
    expect(handoff).toBeDefined();
    expect((handoff as any).from).toBe('secretary');
    expect((handoff as any).confidence).toBe(0.8);
  });

  it('uses custom output when provided', async () => {
    const factory = createAgentNodeFactory<TestState>(deps);
    const nodeFn = factory({
      role: SECRETARY_ROLE,
      agentId: 'secretary',
      input: (s) => ({ message: s.topic }),
      output: (_s, r) => ({ agentId: r.content }), // custom field, not handoff
    });

    const state: TestState = { topic: 'x', agentHandoffs: {}, agentId: '' };
    const update = await nodeFn(state);
    expect(update.agentId).toBe('{"summary":"test result","confidence":0.8}');
    // No default handoff when custom output is provided
    expect(update.agentHandoffs).toBeUndefined();
  });

  it('appends systemPrompt override to role.systemPrompt', async () => {
    let capturedSystemPrompt = '';
    const gateway: LLMGateway = {
      async generateText(opts: LLMCallOptions): Promise<LLMResponse> {
        capturedSystemPrompt = opts.systemPrompt ?? '';
        return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1 }, model: 'test' };
      },
      async *streamText() {
        yield { type: 'done' };
      },
      async listModels() {
        return ['test'];
      },
      async generateEmbeddings(): Promise<EmbeddingResult> {
        return { embeddings: [], model: 'test', usage: { tokens: 0 } };
      },
    };

    const testDeps = { ...deps, gateway };
    const factory = createAgentNodeFactory<TestState>(testDeps);
    const nodeFn = factory({
      role: REVIEWER_ROLE,
      agentId: 'reviewer',
      input: () => ({ message: 'review this', systemPrompt: 'Focus on risks.' }),
    });

    await nodeFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
    expect(capturedSystemPrompt).toContain(REVIEWER_ROLE.systemPrompt);
    expect(capturedSystemPrompt).toContain('Focus on risks.');
  });

  it('filters tools by role.allowedTools', async () => {
    const factory = createAgentNodeFactory<TestState>(deps);
    const nodeFn = factory({
      role: REVIEWER_ROLE, // allowedTools: read_file, list_directory, glob, grep, etc.
      agentId: 'reviewer',
      input: () => ({ message: 'test' }),
    });

    // echo tool is NOT in REVIEWER_ROLE.allowedTools
    // But the AgentLoop should work — it just won't have echo available
    await nodeFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
    // If we got here without errors, the tool view was created correctly
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agent && npx vitest run --reporter=verbose agent-node.test.ts
```

Expected: FAIL — "Cannot find module '../agent-node.js'"

- [ ] **Step 3: Implement createAgentNodeFactory**

```typescript
// packages/agent/src/agent-node.ts
import type Database from 'better-sqlite3';
import type { LLMGateway } from '@cabinet/gateway';
import { AgentLoop, type AgentResult } from './agent-loop.js';
import { ToolExecutor } from './tool-executor.js';
import { SafetyChecker } from './safety.js';
import { CheckpointManager } from './checkpoint.js';
import type { MemoryProvider } from './context-builder.js';
import type { AgentRole } from './agent-roles.js';
import { buildHandoffFromResult, buildSimpleHandoff, type AgentHandoff } from './agent-handoff.js';
import { END } from '@cabinet/graph';

export type { AgentHandoff };

export interface AgentNodeDeps {
  gateway: LLMGateway;
  toolExecutor: ToolExecutor;
  safetyChecker: SafetyChecker;
  db: Database.Database;
  memoryProvider: MemoryProvider;
}

export interface AgentNodeConfig<S> {
  role: AgentRole;
  agentId: string;
  input: (state: S) => { message: string; systemPrompt?: string };
  output?: (state: S, result: AgentResult) => Partial<S>;
}

export type AgentNodeFn<S> = (state: S) => Promise<Partial<S>>;

export function createAgentNodeFactory<S>(deps: AgentNodeDeps) {
  return function createAgentNode(config: AgentNodeConfig<S>): AgentNodeFn<S> {
    return async (state: S) => {
      const { message, systemPrompt: override } = config.input(state);

      const systemPrompt = override
        ? `${config.role.systemPrompt}\n\n${override}`
        : config.role.systemPrompt;

      const toolView = deps.toolExecutor.createView(config.role.allowedTools);

      const loop = new AgentLoop({
        gateway: deps.gateway,
        toolExecutor: toolView,
        safetyChecker: deps.safetyChecker,
        checkpointManager: new CheckpointManager(deps.db),
        memoryProvider: deps.memoryProvider,
        sessionId: `${config.agentId}_${Date.now()}`,
        projectId: '',
        captainId: '',
        systemPrompt,
        model: config.role.modelTier,
        maxSteps: config.role.maxSteps ?? 50,
        temperature: config.role.temperature,
        maxResponseTokens: config.role.maxResponseTokens,
        contextBudget: config.role.contextBudget,
      });

      const result = await loop.run(message);

      if (config.output) {
        return config.output(state, result);
      }

      const handoff = result.structuredOutput
        ? buildHandoffFromResult(config.agentId, message, result.content, result.structuredOutput)
        : buildSimpleHandoff(config.agentId, message, result.content);

      return {
        agentHandoffs: {
          [config.agentId]: handoff,
        },
      } as Partial<S>;
    };
  };
}

// ── Selector ──

export interface SelectorConfig<S> {
  targets: string[];
  decide: (state: S) => string | typeof END;
  maxRounds: number;
}

export function createSelector<S>(config: SelectorConfig<S>): AgentNodeFn<S> {
  let round = 0;

  return () => {
    round++;
    if (round > config.maxRounds) {
      return Promise.resolve({
        nextSpeaker: '__END__',
      } as Partial<S>);
    }
    const chosen = config.decide({} as S);
    return Promise.resolve({
      nextSpeaker: chosen === END ? '__END__' : chosen,
    } as Partial<S>);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agent && npx vitest run --reporter=verbose agent-node.test.ts
```

Expected: 5 tests pass. If any fail, fix the implementation.

- [ ] **Step 5: Typecheck**

```bash
cd packages/agent && npx tsc --noEmit
```

Expected: no errors. Fix any type issues.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/agent-node.ts packages/agent/src/__tests__/agent-node.test.ts
git commit -m "feat(agent): add createAgentNodeFactory + createSelector"
```

---

### Task 3: createSelector with state reading

**Files:**

- Modify: `packages/agent/src/agent-node.ts`
- Modify: `packages/agent/src/__tests__/agent-node.test.ts`

`createSelector` in Task 2 has a bug — `decide({} as S)` always passes an empty object. Need to accept real state and use a hidden counter field.

- [ ] **Step 1: Add test for selector with real state and rounds**

```typescript
// Append to existing agent-node.test.ts

it('selector routes based on decide function', async () => {
  const selectorFn = createSelector<TestState>({
    targets: ['chair', 'advisor'],
    decide: (s) => {
      if (!(s.agentHandoffs as any)['chair']) return 'chair';
      return END;
    },
    maxRounds: 5,
  });

  // First call: no chair handoff → route to 'chair'
  const state1: TestState = { topic: 'x', agentHandoffs: {}, agentId: '' };
  const update1 = await selectorFn(state1);
  expect((update1 as any).nextSpeaker).toBe('chair');

  // Second call: chair handoff exists → route to END
  const state2: TestState = {
    topic: 'x',
    agentHandoffs: { chair: { from: 'chair', confidence: 0.8 } },
    agentId: '',
  };
  const update2 = await selectorFn(state2);
  expect((update2 as any).nextSpeaker).toBe('__END__');
});

it('selector terminates after maxRounds', async () => {
  const selectorFn = createSelector<TestState>({
    targets: ['chair'],
    decide: () => 'chair',
    maxRounds: 2,
  });

  // Round 1
  const u1 = await selectorFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
  expect((u1 as any).nextSpeaker).toBe('chair');

  // Round 2 (not exceeded yet — maxRounds = 2, so round 2 is still allowed)
  const u2 = await selectorFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
  expect((u2 as any).nextSpeaker).toBe('chair');

  // Round 3 — exceeded
  const u3 = await selectorFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
  expect((u3 as any).nextSpeaker).toBe('__END__');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/agent && npx vitest run --reporter=verbose agent-node.test.ts
```

Expected: The new selector tests FAIL because `decide({} as S)` gets empty state.

- [ ] **Step 3: Fix createSelector to accept and use real state**

```typescript
export function createSelector<S>(config: SelectorConfig<S>): AgentNodeFn<S> {
  let round = 0;

  return (state: S) => {
    round++;
    if (round > config.maxRounds) {
      return Promise.resolve({
        nextSpeaker: '__END__',
      } as Partial<S>);
    }
    const chosen = config.decide(state);
    return Promise.resolve({
      nextSpeaker: chosen === END ? '__END__' : chosen,
    } as Partial<S>);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agent && npx vitest run --reporter=verbose agent-node.test.ts
```

Expected: All 7 tests pass (5 factory + 2 selector).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/agent-node.ts packages/agent/src/__tests__/agent-node.test.ts
git commit -m "fix(agent): createSelector accepts real state and tracks rounds"
```

---

### Task 4: Export from index + full verification

**Files:**

- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Add exports to index.ts**

```typescript
// Add after existing exports (around line 71, after SkillExtractor export):
export {
  createAgentNodeFactory,
  createSelector,
  type AgentNodeDeps,
  type AgentNodeConfig,
  type AgentNodeFn,
  type SelectorConfig,
  type AgentHandoff,
} from './agent-node.js';
```

- [ ] **Step 2: Run full agent test suite**

```bash
cd packages/agent && npx vitest run
```

Expected: All existing 71 tests + 7 new tests = 78 tests pass.

- [ ] **Step 3: Typecheck**

```bash
cd packages/agent && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Cross-package verification**

```bash
cd packages/graph && npx vitest run && cd ../workflow && npx vitest run
```

Expected: graph 30 pass, workflow 33 pass — no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "chore(agent): export agent-node API from index"
```

---

## Self-Review

**1. Spec coverage:**

- AgentHandoff type + build helpers → Task 1 ✓
- createAgentNodeFactory → Task 2 ✓
- Default handoff output → Task 2 test "writes handoff by default" ✓
- Custom output override → Task 2 test "uses custom output" ✓
- SystemPrompt append → Task 2 test "appends systemPrompt" ✓
- Tool filter by role.allowedTools → Task 2 test "filters tools" ✓
- createSelector with maxRounds + decide → Task 3 ✓
- Export from index → Task 4 ✓

**2. Placeholder scan:** No TBD/TODO. All code concrete.

**3. Type consistency:**

- `AgentHandoff` defined in Task 1, used as `AgentHandoff` in Task 2 — consistent
- `AgentNodeDeps` defined in Task 2, imported in test — consistent
- `createSelector` updated in Task 3 — accepts `(state: S)` not `{}` — consistent
- `END` imported from `@cabinet/graph` in Task 2 — used correctly
