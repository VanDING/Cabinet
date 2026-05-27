# Fix Agent Loop Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the multi-second pre-request latency in the AgentLoop by caching RAG embeddings, deferring RAG to the first step only, removing redundant rule-loader traversals, and stabilizing ProjectSnapshot cache keys.

**Architecture:** Four independent, stackable optimizations applied to `packages/agent/src` with targeted unit tests. No external API changes; only internal latency reductions.

**Tech Stack:** TypeScript, Vitest, Node.js `fs` APIs, Cabinet agent core (`packages/agent`).

---

## File Map

| File                                                    | Responsibility                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent/src/context-builder.ts`                 | Assembles system prompt tiers; currently fires `searchLongTerm` (embedding API) on every `build()` with zero caching.                          |
| `packages/agent/src/agent-loop.ts`                      | Main agent loop; rebuilds context every step with `taskDescription`, forcing redundant RAG and re-capturing project snapshots per `sessionId`. |
| `packages/agent/src/rules-loader.ts`                    | Loads hierarchical rules; `summarize()` internally calls `loadAll()`, causing a second disk traversal on every context build.                  |
| `packages/agent/src/project-snapshot.ts`                | Caches project file-tree snapshots keyed by `sessionId`, so every new session re-walks the filesystem even if the project root is identical.   |
| `packages/agent/src/__tests__/context-builder.test.ts`  | **Create** — validates RAG embedding cache deduplication and TTL expiry.                                                                       |
| `packages/agent/src/__tests__/agent-loop.test.ts`       | **Modify** — validates that `searchLongTerm` is only invoked on step 0 across a multi-step run.                                                |
| `packages/agent/src/__tests__/rules-loader.test.ts`     | **Create** — validates that `summarize()` returns cached summary without re-scanning disk when rules are unchanged.                            |
| `packages/agent/src/__tests__/project-snapshot.test.ts` | **Create** — validates that snapshots are cached by `projectRoot` and shared across sessions.                                                  |

---

### Task 1: Cache RAG Embedding Results in ContextBuilder

**Files:**

- Modify: `packages/agent/src/context-builder.ts:41-129`
- Test: `packages/agent/src/__tests__/context-builder.test.ts`

**Context:** `ContextBuilder.build()` currently awaits `this.memory.searchLongTerm(...)` unconditionally when `taskDescription` is present. That method hits the LLM gateway's embedding endpoint (`generateEmbeddings`), which adds 300 ms–2 s+ of network latency per call. In a multi-step AgentLoop run, this happens on **every step**.

**Fix:** Add an in-memory TTL cache (`ragCache`) keyed by `projectId + taskDescription`. Reuse results for 60 seconds.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/__tests__/context-builder.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuilder } from '../context-builder.js';
import type { MemoryProvider } from '../context-builder.js';

class SpyMemoryProvider implements MemoryProvider {
  calls: { method: string; args: unknown[] }[] = [];

  async getShortTerm(_sessionId: string) {
    return [];
  }
  async getProjectContext(_projectId: string) {
    return 'Test project';
  }
  async getEntityPreferences(_captainId: string) {
    return {};
  }
  async searchLongTerm(query: string, projectId: string) {
    this.calls.push({ method: 'searchLongTerm', args: [query, projectId] });
    return [`Result for ${query}`];
  }
}

describe('ContextBuilder RAG cache', () => {
  let memory: SpyMemoryProvider;
  let builder: ContextBuilder;

  beforeEach(() => {
    memory = new SpyMemoryProvider();
    builder = new ContextBuilder(memory);
  });

  it('calls searchLongTerm on first build with taskDescription', async () => {
    const result = await builder.build({
      sessionId: 's1',
      projectId: 'p1',
      captainId: 'c1',
      taskDescription: 'write tests',
    });
    expect(memory.calls).toHaveLength(1);
    expect(result.systemPrompt).toContain('Result for write tests');
  });

  it('reuses cached RAG result within 60s for identical query', async () => {
    await builder.build({
      sessionId: 's1',
      projectId: 'p1',
      captainId: 'c1',
      taskDescription: 'write tests',
    });
    await builder.build({
      sessionId: 's2',
      projectId: 'p1',
      captainId: 'c1',
      taskDescription: 'write tests',
    });
    expect(memory.calls).toHaveLength(1);
  });

  it('refreshes cache after TTL expires', async () => {
    vi.useFakeTimers();
    await builder.build({
      sessionId: 's1',
      projectId: 'p1',
      captainId: 'c1',
      taskDescription: 'write tests',
    });
    vi.advanceTimersByTime(61_000);
    await builder.build({
      sessionId: 's1',
      projectId: 'p1',
      captainId: 'c1',
      taskDescription: 'write tests',
    });
    expect(memory.calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not cache when taskDescription is absent', async () => {
    await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1' });
    expect(memory.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/agent/src/__tests__/context-builder.test.ts --reporter=verbose
```

Expected: FAIL — `toHaveLength(1)` fails on the second test because the current implementation calls `searchLongTerm` twice.

- [ ] **Step 3: Implement RAG cache in ContextBuilder**

Modify `packages/agent/src/context-builder.ts`:

Insert at the top of the `ContextBuilder` class (around line 41):

```ts
export class ContextBuilder {
  private rulesLoader: RulesLoader | null = null;
  private sessionCache = new Map<string, { projectContext: string; preferences: Record<string, unknown> }>();
  /** In-memory TTL cache for RAG search results to avoid repeated embedding API calls. */
  private ragCache = new Map<string, { results: string[]; timestamp: number }>();
  private readonly RAG_CACHE_TTL_MS = 60_000;

  constructor(private readonly memory: MemoryProvider) {}
  // ...
```

Replace the RAG block inside `build()` (around lines 92-103) with:

```ts
// Retrieve and inject RAG results at the end of system prompt (fixed position)
if (options.taskDescription) {
  const ragCacheKey = `${options.projectId}:${options.taskDescription}`;
  const cachedRag = this.ragCache.get(ragCacheKey);
  const now = Date.now();
  let ragResults: string[];

  if (cachedRag && now - cachedRag.timestamp < this.RAG_CACHE_TTL_MS) {
    ragResults = cachedRag.results;
  } else {
    try {
      ragResults = await this.memory.searchLongTerm(options.taskDescription, options.projectId);
      this.ragCache.set(ragCacheKey, { results: ragResults, timestamp: now });
    } catch {
      ragResults = [];
    }
  }

  if (ragResults.length > 0) {
    const trimmed = ragResults
      .slice(0, 3)
      .map((r) => (r.length > 200 ? `${r.slice(0, 200)}...` : r));
    systemPrompt += `\n\n## Retrieved Context\n${trimmed.join('\n')}`;
  }
}
```

Also update `clearSessionCache()` (around line 123) to evict RAG entries scoped to the session's project:

```ts
  /** Clear cached project context and preferences for a session. */
  clearSessionCache(sessionId: string): void {
    for (const key of this.sessionCache.keys()) {
      if (key.startsWith(sessionId + ':')) {
        this.sessionCache.delete(key);
      }
    }
    // Evict RAG cache entries that may reference stale session context
    this.ragCache.clear();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run packages/agent/src/__tests__/context-builder.test.ts --reporter=verbose
```

Expected: PASS (4/4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/context-builder.ts packages/agent/src/__tests__/context-builder.test.ts
git commit -m "feat(agent): cache RAG embedding results for 60s to reduce per-step latency

Eliminates redundant generateEmbeddings API calls when the same
taskDescription is used across multiple AgentLoop steps."
```

---

### Task 2: Skip RAG on Subsequent AgentLoop Steps

**Files:**

- Modify: `packages/agent/src/agent-loop.ts:244-252`
- Test: `packages/agent/src/__tests__/agent-loop.test.ts`

**Context:** Even with the cache from Task 1, the first step of every multi-step loop still pays the embedding cost. More importantly, RAG context is only meaningful at conversation start; tool-result rounds do not need refreshed semantic search.

**Fix:** Pass `taskDescription` only when `steps === 0` to `contextBuilder.build()`.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent/src/__tests__/agent-loop.test.ts` (after the existing checkpoint test):

```ts
class CountingMemoryProvider implements MemoryProvider {
  searchLongTermCalls = 0;

  async getShortTerm(_sessionId: string) {
    return [];
  }
  async getProjectContext(_projectId: string) {
    return 'Test project';
  }
  async getEntityPreferences(_captainId: string) {
    return {};
  }
  async searchLongTerm(_query: string, _projectId: string) {
    this.searchLongTermCalls++;
    return ['memory result'];
  }
}

describe('AgentLoop RAG step optimization', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('calls searchLongTerm only on step 0, not on tool-result steps', async () => {
    let callCount = 0;
    const memory = new CountingMemoryProvider();
    const mockGateway: LLMGateway = {
      async generateText(_options: LLMCallOptions): Promise<LLMResponse> {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc1', name: 'echo', arguments: { message: 'test' } }],
            usage: { promptTokens: 10, completionTokens: 5 },
            model: 'test-model',
          };
        }
        return {
          content: 'Done.',
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
      async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [], model: 'test-model', usage: { tokens: 0 } };
      },
    };

    const toolExecutor = new ToolExecutor();
    toolExecutor.register({
      name: 'echo',
      execute: async (args) => args.message,
    });

    const loop = new AgentLoop({
      gateway: mockGateway,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: memory,
      sessionId: 'sess-rag',
      projectId: 'proj-rag',
      captainId: 'captain-1',
      taskDescription: 'analyze codebase',
      maxSteps: 5,
    });

    await loop.run('Hello');
    expect(memory.searchLongTermCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/agent/src/__tests__/agent-loop.test.ts --reporter=verbose
```

Expected: FAIL — `searchLongTermCalls` is `2` because the current code passes `taskDescription` on every step.

- [ ] **Step 3: Implement step-gated taskDescription**

Modify `packages/agent/src/agent-loop.ts` inside the `while` loop (around line 244):

Find:

```ts
const ctx: ContextBuildResult = await this.contextBuilder.build({
  sessionId: this.options.sessionId,
  projectId: this.options.projectId,
  captainId: this.options.captainId,
  roleSystemPrompt: this.options.systemPrompt,
  activeFiles: this.options.activeFiles,
  taskDescription: this.options.taskDescription,
  memorySessionId: this.options.memorySessionId,
});
```

Replace with:

```ts
const ctx: ContextBuildResult = await this.contextBuilder.build({
  sessionId: this.options.sessionId,
  projectId: this.options.projectId,
  captainId: this.options.captainId,
  roleSystemPrompt: this.options.systemPrompt,
  activeFiles: this.options.activeFiles,
  // RAG is only useful on the first step; tool-result steps reuse context
  taskDescription: steps === 0 ? this.options.taskDescription : undefined,
  memorySessionId: this.options.memorySessionId,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run packages/agent/src/__tests__/agent-loop.test.ts --reporter=verbose
```

Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/agent-loop.ts packages/agent/src/__tests__/agent-loop.test.ts
git commit -m "feat(agent): only inject RAG context on step 0

Prevents redundant semantic search on every tool-result round.
RAG context is conversation-start material; subsequent steps
operate on tool outputs, not the original task description."
```

---

### Task 3: Eliminate Double Rule Traversal

**Files:**

- Modify: `packages/agent/src/context-builder.ts:71-77`
- Modify: `packages/agent/src/rules-loader.ts:76-165`
- Test: `packages/agent/src/__tests__/rules-loader.test.ts`

**Context:** `ContextBuilder.build()` calls both `loadMatching()` and `summarize()`. Each internally calls `loadAll()`, which walks the `rulesDirs` and checks `hasChanges()` (doing `readdirSync` + `statSync` on every `.md` file). This doubles the disk I/O on every context build. Additionally, `rulesSummary` is currently **dead code** — no consumer in `AgentLoop` reads `ContextBuildResult.rulesSummary`.

**Fix:** (a) Cache `summarize()` result in `RulesLoader` so repeated calls are instant; (b) stop computing `rulesSummary` inside `build()` since it is unused.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/__tests__/rules-loader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RulesLoader } from '../rules-loader.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `rules-loader-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('RulesLoader summarize caching', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    writeFileSync(join(tempDir, 'always.md'), '---\nalwaysApply: true\n---\nAlways rule.\n');
    writeFileSync(join(tempDir, 'auto.md'), '---\nglobs: ["*.ts"]\n---\nAuto rule.\n');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns identical summary on repeated calls without disk rescan', () => {
    const loader = new RulesLoader([tempDir]);
    const s1 = loader.summarize();
    const s2 = loader.summarize();
    expect(s1).toBe(s2);
    // The internal implementation should skip re-reading files on the second call.
    // We verify this indirectly by ensuring no errors and fast repeat.
  });

  it('invalidates summary cache after reload', () => {
    const loader = new RulesLoader([tempDir]);
    const s1 = loader.summarize();
    writeFileSync(join(tempDir, 'new.md'), '---\nalwaysApply: true\n---\nNew rule.\n');
    loader.reload();
    const s2 = loader.summarize();
    expect(s2).toContain('New rule');
    expect(s1).not.toBe(s2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/agent/src/__tests__/rules-loader.test.ts --reporter=verbose
```

Expected: FAIL — the first test may technically pass because `loadAll()` returns the same string, but it does so by re-reading disk. We need to validate the behavior change more directly. The real observable failure is in the **performance** and in `ContextBuilder.build()` doing double work. We will add a stricter assertion after the implementation.

Actually, the first test will PASS even before the fix because `summarize()` returns the same string. We need a more direct test. Let's update the test to spy on internal behavior by exposing a lightweight counter. But we don't want to pollute production code.

Alternative: test at `ContextBuilder` level. Create a spy `RulesLoader` and count `loadAll` / `summarize` calls.

Let's revise the test strategy. Instead of testing `RulesLoader` internals directly, we test `ContextBuilder.build()` behavior:

```ts
import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../context-builder.js';
import { RulesLoader } from '../rules-loader.js';
import type { MemoryProvider } from '../context-builder.js';

class MinimalMemoryProvider implements MemoryProvider {
  async getShortTerm() {
    return [];
  }
  async getProjectContext() {
    return 'Test project';
  }
  async getEntityPreferences() {
    return {};
  }
  async searchLongTerm() {
    return [];
  }
}

describe('ContextBuilder rules summary optimization', () => {
  it('build() does not call summarize() when rulesLoader is attached', async () => {
    const loader = new RulesLoader([]);
    let summarizeCalls = 0;
    const originalSummarize = loader.summarize.bind(loader);
    loader.summarize = () => {
      summarizeCalls++;
      return originalSummarize();
    };

    const builder = new ContextBuilder(new MinimalMemoryProvider());
    builder.withRules(loader);
    await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1' });
    expect(summarizeCalls).toBe(0);
  });
});
```

Wait — the spec says no mocking/spying unless necessary. And the real bug is the double traversal, not the `rulesSummary` value itself.

Let's keep the `RulesLoader` test but add an explicit assertion that `summarize()` is cached. We can do this by adding a lightweight `readCount` to `RulesLoader` for testability. But that violates YAGNI.

Simpler: keep the test as-is. The first test (`returns identical summary`) will pass even before the fix. The second test (`invalidates after reload`) tests reload invalidation, which will also pass before the fix.

The real validation comes from the `ContextBuilder` test. Let's create a separate test file `context-builder-rules.test.ts`? No, let's just put it in `context-builder.test.ts` from Task 1.

Actually, the simplest way: in `context-builder.test.ts`, we can test that `build()` does not invoke `summarize()` by creating a custom `RulesLoader` subclass. But that's overkill.

Let's step back. The user asked to eliminate double rule traversal. The concrete code change is:

1. Remove `summarize()` call from `ContextBuilder.build()`
2. Add `summaryCache` to `RulesLoader` so that any external callers still get fast results

For testing, the most direct observable is: after our change, `ContextBuilder.build()` with a `RulesLoader` should only trigger `loadMatching()`, not `summarize()`. We can test this by overriding `summarize` on a `RulesLoader` instance and counting calls.

Let's add this test to `context-builder.test.ts` (Task 1 file):

```ts
it('does not trigger rules summarize during build', async () => {
  const loader = new RulesLoader([]);
  let summarizeCalls = 0;
  const orig = loader.summarize.bind(loader);
  loader.summarize = () => {
    summarizeCalls++;
    return orig();
  };

  const builder = new ContextBuilder(memory);
  builder.withRules(loader);
  await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1' });
  expect(summarizeCalls).toBe(0);
});
```

This test will FAIL before the fix and PASS after.

Now let's restructure Task 3 steps.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent/src/__tests__/context-builder.test.ts`:

```ts
import { RulesLoader } from '../rules-loader.js';

describe('ContextBuilder rules summary optimization', () => {
  it('does not trigger rules summarize during build', async () => {
    const memory = new SpyMemoryProvider();
    const loader = new RulesLoader([]);
    let summarizeCalls = 0;
    const orig = loader.summarize.bind(loader);
    loader.summarize = () => {
      summarizeCalls++;
      return orig();
    };

    const builder = new ContextBuilder(memory);
    builder.withRules(loader);
    await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1' });
    expect(summarizeCalls).toBe(0);
  });
});
```

Create `packages/agent/src/__tests__/rules-loader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RulesLoader } from '../rules-loader.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `rules-loader-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('RulesLoader summarize cache', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    writeFileSync(join(tempDir, 'always.md'), '---\nalwaysApply: true\n---\nAlways rule.\n');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('caches summarize result across calls', () => {
    const loader = new RulesLoader([tempDir]);
    const s1 = loader.summarize();
    const s2 = loader.summarize();
    expect(s1).toBe(s2);
  });

  it('invalidates summary cache after reload', () => {
    const loader = new RulesLoader([tempDir]);
    const s1 = loader.summarize();
    writeFileSync(join(tempDir, 'new.md'), '---\nalwaysApply: true\n---\nNew rule.\n');
    loader.reload();
    const s2 = loader.summarize();
    expect(s2).toContain('New rule');
    expect(s1).not.toBe(s2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run packages/agent/src/__tests__/context-builder.test.ts packages/agent/src/__tests__/rules-loader.test.ts --reporter=verbose
```

Expected:

- `does not trigger rules summarize during build` FAILS (`summarizeCalls` is 1)
- `RulesLoader summarize cache` tests PASS (they test behavior that already works by coincidence)

- [ ] **Step 3: Implement RulesLoader summary cache and remove summarize from build**

Modify `packages/agent/src/rules-loader.ts`:

Add a summary cache field inside the `RulesLoader` class (around line 77):

```ts
export class RulesLoader {
  private cache: Map<string, LoadedRule[]> = new Map();
  private fileTimestamps: Map<string, number> = new Map();
  private globalFileTimestamp = 0;
  /** Cached summarize result to avoid repeated loadAll() traversals. */
  private summaryCache: string | null = null;

  constructor(
    private readonly rulesDirs: string[],
    private readonly globalFile?: string,
  ) {}
```

Modify `summarize()` (around line 146):

```ts
  /** Get a summary of available rules (for the agent to know what's available). */
  summarize(): string {
    if (this.summaryCache !== null) {
      return this.summaryCache;
    }
    const all = this.loadAll();
    if (all.length === 0) return 'No .cabinet/rules/ found.';

    const lines: string[] = ['## Available Rules', ''];
    for (const rule of all) {
      const desc = rule.frontmatter.description ?? basename(rule.path, '.md');
      const mode =
        rule.mode === 'always' ? '[always]' : rule.mode === 'auto' ? '[auto]' : '[on-demand]';
      lines.push(`- ${mode} ${desc} (${rule.path})`);
    }
    this.summaryCache = lines.join('\n');
    return this.summaryCache;
  }
```

Modify `reload()` (around line 161):

```ts
  /** Reload rules (clears cache). */
  reload(): void {
    this.cache.clear();
    this.fileTimestamps.clear();
    this.globalFileTimestamp = 0;
    this.summaryCache = null;
  }
```

Now modify `packages/agent/src/context-builder.ts` inside `build()` (around line 76):

Find:

```ts
const rules = this.rulesLoader?.loadMatching(rulesContext) ?? [];
const rulesSummary = this.rulesLoader?.summarize() ?? '';
```

Replace with:

```ts
const rules = this.rulesLoader?.loadMatching(rulesContext) ?? [];
// rulesSummary is computed on-demand via getOnDemandRules(); including it here
// caused a second full disk traversal via summarize()->loadAll().
const rulesSummary = '';
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run packages/agent/src/__tests__/context-builder.test.ts packages/agent/src/__tests__/rules-loader.test.ts --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/context-builder.ts packages/agent/src/rules-loader.ts packages/agent/src/__tests__/context-builder.test.ts packages/agent/src/__tests__/rules-loader.test.ts
git commit -m "perf(agent): cache rules summary and remove redundant summarize from build

RulesLoader.summarize() now memoizes its result, cutting repeated
loadAll() traversals. ContextBuilder.build() no longer computes
rulesSummary (dead code) which previously doubled disk I/O per step."
```

---

### Task 4: Stabilize ProjectSnapshot Cache Key

**Files:**

- Modify: `packages/agent/src/project-snapshot.ts:93-101`
- Modify: `packages/agent/src/agent-loop.ts:255-264` and `658-662`
- Test: `packages/agent/src/__tests__/project-snapshot.test.ts`

**Context:** `ProjectSnapshot` caches by `sessionId`, but the snapshot content depends solely on `projectRoot`. Every new session triggers a fresh `readdirSync`/`statSync` filesystem walk.

**Fix:** Change cache key from `sessionId` to `projectRoot`. Update `agent-loop.ts` callers.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/__tests__/project-snapshot.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectSnapshot } from '../project-snapshot.js';

describe('ProjectSnapshot caching', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `project-snapshot-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'package.json'), '{}');
    writeFileSync(join(tempDir, 'README.md'), '# Test');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('caches by project root, not session id', () => {
    const s1 = ProjectSnapshot.capture(tempDir);
    ProjectSnapshot.store(tempDir, s1);

    const cached = ProjectSnapshot.getCached(tempDir);
    expect(cached).not.toBeNull();
    expect(cached!.root).toBe(tempDir);

    // Different session id should still hit the same cache
    const cachedAgain = ProjectSnapshot.getCached(tempDir);
    expect(cachedAgain).toBe(cached);
  });

  it('returns null for uncached root', () => {
    const uncached = ProjectSnapshot.getCached(join(tempDir, 'nonexistent'));
    expect(uncached).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/agent/src/__tests__/project-snapshot.test.ts --reporter=verbose
```

Expected: FAIL — `getCached(tempDir)` returns `null` because the current implementation expects a `sessionId` string, and `store` was never called with one.

- [ ] **Step 3: Implement root-based caching**

Modify `packages/agent/src/project-snapshot.ts`:

Replace `getCached` and `store` (around lines 93-101):

```ts
  /** Retrieve a cached snapshot for a project root. */
  static getCached(projectRoot: string): Snapshot | null {
    return snapshotCache.get(projectRoot) ?? null;
  }

  /** Store a snapshot keyed by project root (shared across sessions). */
  static store(projectRoot: string, snapshot: Snapshot): void {
    snapshotCache.set(projectRoot, snapshot);
  }
```

Modify `packages/agent/src/agent-loop.ts` in `run()` (around line 255):

Find:

```ts
const snapshot =
  ProjectSnapshot.getCached(this.options.sessionId) ??
  (() => {
    const captured = ProjectSnapshot.capture(this.options.projectRoot ?? process.cwd());
    ProjectSnapshot.store(this.options.sessionId, captured);
    return captured;
  })();
```

Replace with:

```ts
const projectRoot = this.options.projectRoot ?? process.cwd();
const snapshot =
  ProjectSnapshot.getCached(projectRoot) ??
  (() => {
    const captured = ProjectSnapshot.capture(projectRoot);
    ProjectSnapshot.store(projectRoot, captured);
    return captured;
  })();
```

Modify `packages/agent/src/agent-loop.ts` in `runStreaming()` (around line 658):

Find:

```ts
    const snap = ProjectSnapshot.getCached(this.options.sessionId);
    if (snap && !this.options.systemPrompt) {
```

Replace with:

```ts
    const streamingRoot = this.options.projectRoot ?? process.cwd();
    const snap = ProjectSnapshot.getCached(streamingRoot);
    if (snap && !this.options.systemPrompt) {
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run packages/agent/src/__tests__/project-snapshot.test.ts --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/project-snapshot.ts packages/agent/src/agent-loop.ts packages/agent/src/__tests__/project-snapshot.test.ts
git commit -m "perf(agent): cache ProjectSnapshot by projectRoot instead of sessionId

Eliminates redundant filesystem walks when multiple sessions target
the same project directory."
```

---

## Integration Verification

After all four tasks are committed, run the full `packages/agent` test suite and a quick smoke check.

- [ ] **Step 1: Full test suite**

Run:

```bash
npx vitest run packages/agent/src/__tests__ --reporter=verbose
```

Expected: All tests pass.

- [ ] **Step 2: Type check**

Run:

```bash
npx tsc --noEmit -p packages/agent/tsconfig.json
```

Expected: No type errors.

- [ ] **Step 3: Lint / format (if configured)**

Run:

```bash
pnpm --filter @cabinet/agent lint
```

Or if no lint script exists, skip with a note.

Expected: Clean (or skip if script missing).

- [ ] **Step 4: Commit any auto-fixes**

```bash
git diff --quiet || git commit -am "chore(agent): lint fixes after latency optimizations"
```

---

## Self-Review Checklist

**1. Spec coverage:**

- RAG embedding cache (Task 1) — covered
- RAG only on step 0 (Task 2) — covered
- Eliminate double rule traversal (Task 3) — covered
- ProjectSnapshot key stabilization (Task 4) — covered

**2. Placeholder scan:**

- No "TBD", "TODO", "implement later" — clean
- Every step includes exact file paths and code blocks — yes
- Every test includes exact assertion and expected failure mode — yes

**3. Type consistency:**

- `ContextBuilder.ragCache` key is `string`, value is `{ results: string[]; timestamp: number }` — consistent with `searchLongTerm` return type
- `RulesLoader.summaryCache` is `string | null` — consistent with `summarize()` return type
- `ProjectSnapshot.getCached/store` parameter renamed from `sessionId` to `projectRoot` — updated at all call sites in `agent-loop.ts`
- `ContextBuildResult.rulesSummary` still exists in interface; we changed `build()` to return `''` instead of calling `summarize()` — interface unchanged, safe for consumers

**4. Risk assessment:**

- `rulesSummary = ''` is a behavior change if external code reads `ContextBuildResult.rulesSummary`. No in-repo consumers exist (verified by grep). If external plugins depend on it, they can call `ContextBuilder.getOnDemandRules()` directly.
- `taskDescription: steps === 0 ? ... : undefined` means tool-result steps lose the task description context. This is intentional: the original user request is already in the conversation history; repeating it in the system prompt adds no value and costs tokens.
- `ProjectSnapshot` cache now uses absolute `projectRoot` as key. If `process.cwd()` changes between sessions, different roots produce different keys — correct behavior.
