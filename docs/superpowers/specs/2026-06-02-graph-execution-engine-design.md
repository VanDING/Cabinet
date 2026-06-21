# Graph Execution Engine — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Scope:** Phase 1 — StateGraph core + AgentLoop migration + WorkflowEngine migration

## 1. Motivation

### Current State

Cabinet has two separate execution models:

1. **AgentLoop** (`packages/agent/src/agent-loop.ts`, 1175 lines): A linear ReAct loop — build context → LLM call → execute tools → repeat. All control flow (context monitoring, handoff, parallel/serial tool dispatch, error handling) is inline in a single `while` loop.

2. **WorkflowEngine** (`packages/workflow/src/engine.ts`, 614 lines): A DAG executor with 16 node types (start, end, agentGroup, llm, skill, tool, code, workflow, ifElse, loop, parallel, merge, pass, intentClassify, knowledgeBase, approval, human). Uses an untyped `Map<string, unknown>` for state. Conditional branching is static (pre-configured field/operator/value triples). Checkpointing only at approval nodes.

### Problems

- **No typed state**: `WorkflowRun.results` is `Map<string, unknown>` — no schema, no type safety, no custom merge reducers for parallel branches.
- **Static conditionals only**: `ifElse` nodes compare predefined fields against literal values. Cannot route based on LLM output quality, confidence scores, or dynamic state inspection.
- **No general checkpoint/resume**: Only approval/human nodes support pause-and-resume. Cannot interrupt at arbitrary points.
- **No compile-time validation**: DAG errors (missing edges, unreachable nodes) surface as runtime crashes.
- **Duplicated control flow**: AgentLoop and WorkflowEngine each re-implement graph traversal, error handling, and state management independently.
- **No per-node streaming**: Workflow execution is a black box until complete.

### Goal

Introduce a shared **StateGraph** primitive (~400 lines) as the single execution abstraction. Both AgentLoop and WorkflowEngine become graph instances. This unifies control flow, adds typed state with reducers, enables dynamic conditional routing, and provides general checkpoint/resume — matching the core capabilities of LangGraph without external dependencies.

## 2. Design Decisions

| Decision              | Choice                                                                                                                 | Rationale                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Architecture          | Full replacement — WorkflowEngine's execution core rewritten to use StateGraph                                         | Eliminates dual control flow; both AgentLoop and WorkflowEngine benefit from the same improvements                                 |
| Checkpoint model      | Linked-list (LangGraph-style) — each superstep creates a new row with `parent_checkpoint_id`                           | Enables time-travel (Phase 2); marginal cost over single-row overwrite                                                             |
| State schema API      | Annotation pattern — `Annotation<T>({ reducer, default })` per field                                                   | Aligns with LangGraph mental model; TypeScript type inference friendly; explicit reducer per field enables parallel branch merging |
| AgentLoop granularity | Fine-grained — LLM and Tools as separate graph nodes with conditional edges                                            | Enables skipping LLM for mechanical routing decisions, saves tokens                                                                |
| Streaming model       | Node events + LLM token stream — `node:start`, `node:end`, `llm:chunk`, `tool:call`, `tool:result`, `checkpoint:saved` | Frontend can show task progress ("searching..." → "analyzing..." → "editing...")                                                   |
| Error handling        | Error edges + per-node retry policies — `addErrorEdge(from, to)` + `maxRetries/backoff` on node options                | Retries handle transient failures; error edges handle failures requiring logic (permission denied → notify user)                   |

## 3. Core API

### 3.1 State Annotation

```typescript
import { Annotation } from '@cabinet/graph';

// Built-in reducers available via Annotation.append, Annotation.lastWrite, etc.
// Custom reducer: (a: T, b: T) => T

const AgentState = {
  messages: Annotation<Message[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  findings: Annotation<Finding[]>({
    reducer: dedupByKey('detail'),
    default: () => [],
  }),
  budget: Annotation<number>({
    reducer: (_, b) => b, // last-write-wins
    default: () => 0,
  }),
  systemPrompt: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
};

type AgentState = typeof AgentState; // inferred
```

### 3.2 StateGraph Builder

```typescript
const END = Symbol('END');

type NodeFn<S> = (state: S) => Promise<Partial<S>> | Partial<S>;
type RouterFn<S> = (state: S) => Promise<string> | string;

class StateGraph<S extends Record<string, any>> {
  addNode(
    id: string,
    fn: NodeFn<S>,
    opts?: { maxRetries?: number; backoff?: 'linear' | 'exponential'; retryDelay?: number },
  ): this;
  addEdge(from: string, to: string | typeof END): this;
  addConditionalEdges(
    from: string,
    router: RouterFn<S>,
    targets: Record<string, string | typeof END>,
  ): this;
  // Router must return a key in targets. Unrecognized return values terminate the graph (END).
  addErrorEdge(from: string, to: string): this;
  compile(opts: { entry: string }): CompileResult<S>;
}
```

### 3.3 CompiledGraph

```typescript
interface CompiledGraph<S> {
  invoke(input: Partial<S>, config?: { runId?: string; checkpoint?: boolean }): Promise<S>;
  stream(input: Partial<S>, config?: { runId?: string }): AsyncIterable<StreamEvent>;
  resume(checkpointId: string, override?: Partial<S>): Promise<S>;
}

type StreamEvent =
  | { type: 'node:start'; nodeId: string }
  | { type: 'node:end'; nodeId: string; update: Partial<S> }
  | { type: 'llm:chunk'; nodeId: string; content: string }
  | { type: 'llm:thinking'; nodeId: string; content: string }
  | { type: 'tool:call'; nodeId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool:result'; nodeId: string; toolName: string; result: unknown }
  | { type: 'checkpoint:saved'; checkpointId: string }
  | { type: 'error'; nodeId: string; error: string };
```

### 3.4 Checkpoint Store

```typescript
interface CheckpointRecord {
  id: string; // "checkpoint_<runId>_<seq>"
  runId: string;
  parentId: string | null; // linked list
  nodeId: string;
  state: string; // JSON serialized S
  pendingTasks: string | null; // JSON for interrupted async tasks
  metadata: string; // JSON { source, step, timestamp }
  createdAt: string;
}

class CheckpointStore {
  save(record: CheckpointRecord): void;
  load(checkpointId: string): CheckpointRecord | null;
  getPrior(checkpointId: string): CheckpointRecord | null; // follows parent_id chain
  listRun(runId: string): CheckpointRecord[];
  gc(runId: string, keepLast: number): void; // retain last N checkpoints from head of chain, delete older ancestors
}
```

## 4. AgentLoop Migration

### Current Control Flow (simplified)

```
while (steps < maxSteps) {
  ctx = contextBuilder.build(...)       // Tier 1-3 assembly
  if (contextMonitor) { snapshot }      // zone check
  if (shouldHandoff) { compress }       // emergency context compaction
  response = gateway.generateText(...)  // LLM call
  if (no tool calls) { break }          // done
  for (tc of toolCalls) {               // execute tools
    safetyChecker.check(...)
    await execute(tc)
  }
}
```

### Post-Migration Graph

```
Nodes:
  buildContext     — ContextBuilder.build() + ProjectSnapshot + skillContext
  contextCheck     — ContextMonitor.snapshot() + zone classification
  compressContext  — ContextHandoff.performHandoff() + message compression
  llm              — gateway.generateText() + cost tracking
  safetyCheck      — SafetyChecker.check() per tool call
  tools            — parallel/serial dispatch + timeout + result summarization
  formatOutput     — parseStructuredOutput() + final assembly

Edges:
  buildContext → contextCheck (static)

  contextCheck → llm                  (router: zone === 'smart' | 'warning')
  contextCheck → compressContext      (router: zone === 'critical' | 'dumb')
  compressContext → contextCheck      (static, after handoff)

  llm → safetyCheck                   (router: has tool_calls)
  llm → formatOutput                  (router: no tool_calls → END)

  safetyCheck → tools                 (router: all allowed)
  safetyCheck → llm                   (router: any blocked, notify and loop back)

  tools → llm                         (static, results back to LLM)

  formatOutput → END

Error edges:
  llm.error → compressContext         (LLM call failed → handoff + retry)
  tools.error → llm                   (tool failed → let LLM decide how to recover)
```

### Compatibility Layer

```typescript
class AgentLoop {
  private graph: CompiledGraph<AgentState>;

  constructor(options: AgentLoopOptions) {
    this.graph = buildAgentGraph(options);  // pre-compiled once
  }

  async run(userMessage: string): Promise<AgentResult> {
    const state = await this.graph.invoke({
      messages: [{ role: 'user', content: userMessage }],
    });
    return this.toAgentResult(state);
  }

  async runStreaming(userMessage: string, callback: StreamingCallback): Promise<AgentResult> {
    let state: AgentState;
    for await (const event of this.graph.stream({ messages: [...] })) {
      this.emitCallback(event, callback);
    }
    return this.toAgentResult(state);
  }
}
```

External API unchanged: `run()`, `runStreaming()`, `continueWithUserInput()`, `getConversationHistory()`, `setDelegationTier()`, `setSkillContext()`.

## 5. WorkflowEngine Migration

### Current Architecture

```
WorkflowEngine
  ├── runs: Map<string, WorkflowRun>
  ├── handlers: WorkflowHandlers
  ├── buildGraph() → adjacence list
  ├── executeNode() → 16-case switch
  └── saveRun/loadRun → SQLite
```

### Post-Migration Architecture

```
WorkflowEngine (API surface unchanged)
  ├── internals rewritten to use StateGraph
  ├── handlers: WorkflowHandlers  (unchanged — nodes call these)
  ├── buildStateGraph() → converts WorkflowNodeDef[] + WorkflowEdge[] → StateGraph
  ├── executeNode() deleted — replaced by CompiledGraph.invoke()
  └── saveRun/loadRun → delegates to CheckpointStore
```

Each existing node type becomes a graph node function:

```
start → buildContext
end → END
agentGroup → createAgentLoop + run children as subgraph
llm → agentLoop handle.run(prompt)
skill → handlers.skill(skillId, input)
tool → handlers.tool(toolId, params)
code → handlers.runCode(code, input, timeout)
workflow → handlers.runSubWorkflow(workflowId, input)
ifElse → conditional edge (static condition → router function)
loop → loop node with exit edge detection
parallel → parallel edges (fan-out from one node to multiple)
merge → reducer-based merge (benefits from Annotation reducers!)
pass → identity node (passes state through)
approval → handlers.humanApproval → set status 'awaiting_approval' + END
human → handlers.humanTask → set status 'awaiting_human' + END
intentClassify → handlers.intentClassify → conditional edge based on result.intent
knowledgeBase → handlers.knowledgeBase
```

### Declarative Definition → Graph Conversion

`normalizeDefinition()` (in `workflows.ts`) continues to convert step-based declarative definitions to nodes/edges. Those nodes/edges are then fed into `WorkflowEngine.buildStateGraph()` which constructs a `StateGraph` from them. The conversion function `convertStepsToNodes()` is unchanged.

## 6. Compile-Time Validation

Six validation passes run during `StateGraph.compile()`:

| Pass | Name                     | What It Checks                                                             | Severity      |
| ---- | ------------------------ | -------------------------------------------------------------------------- | ------------- |
| 1    | Node existence           | All edge targets refer to registered nodes                                 | Error         |
| 2    | Entry reachability       | All nodes are reachable from entry; entry node exists                      | Error/Warning |
| 3    | Cycle detection          | Cycles exist and have conditional exits (no infinite loops without escape) | Warning       |
| 4    | Conditional completeness | Router return value maps to a declared target; default/fallback exists     | Error         |
| 5    | Error edge coverage      | Nodes with maxRetries > 0 should have error edges defined                  | Warning       |
| 6    | State compatibility      | Node return types are compatible with state schema                         | Warning       |

`compile()` returns either `{ ok: true, graph, warnings }` or `{ ok: false, errors }`.

## 7. Package Structure

```
packages/graph/
├── index.ts              # public exports
├── annotation.ts         # Annotation<T> — state schema (~50 lines)
├── state-graph.ts        # StateGraph builder + CompiledGraph (~150 lines)
├── checkpoint-store.ts   # linked-list checkpoint persistence (~80 lines)
├── validation.ts         # 6 compile passes (~80 lines)
└── events.ts             # StreamEvent types (~30 lines)
```

**Dependencies:** Only `@cabinet/storage` (for SQLite checkpoint persistence). No dependency on `@cabinet/gateway`, `@cabinet/agent`, or `@cabinet/events` — graph engine is pure orchestration. LLM calls, tool execution, and event emission happen inside node functions, not in the graph engine itself.

## 8. Migration Phases

### Phase 1a — New Package + Unit Tests

- Write all 6 source files in `packages/graph/`
- Write unit tests: annotation, state-graph, checkpoint-store, validation
- No changes to existing packages
- Verify: all tests pass

### Phase 1b — AgentLoop Internal Rewrite

- Modify `packages/agent/src/agent-loop.ts` — replace inline `while` loop with CompiledGraph
- Keep external API identical: `run()`, `runStreaming()`, `continueWithUserInput()`, `getConversationHistory()`, `setDelegationTier()`, `setSkillContext()`
- Remove ~200 lines of inline control flow
- Keep: configuration management, conversationHistory buffer, skillContext, callbacks
- Verify: existing `agent-loop.test.ts` all pass; manual smoke test with secretary agent

### Phase 1c — WorkflowEngine Internal Rewrite

- Modify `packages/workflow/src/engine.ts` — replace `executeNode()` switch-case with CompiledGraph
- Keep external API identical: `startRun()`, `continueRun()`, `setHandlers()`, `WorkflowRun` type
- Keep: handler registration, AgentLoop pool, declarative step conversion
- Remove: `buildGraph()`, `executeNode()`, inline graph traversal
- Verify: existing `workflow.test.ts` all pass; manual smoke test with sample workflow

## 9. Non-Goals (Phase 1)

- **Time travel** (browsing/restoring arbitrary historical checkpoints) — checkpoint linked-list enables it but resume API only supports latest checkpoint in Phase 1
- **Subgraph as first-class value** — `agentGroup` and `workflow` nodes still use manual nesting via `handlers.runSubWorkflow`
- **Graph serialization/portability** — no JSON export of compiled graphs
- **Per-node streaming in WorkflowEngine** — streaming only wired through AgentLoop in Phase 1; WorkflowEngine continues to return final output only
- **Breaking existing API** — zero changes to server routes, SecretaryAgent, or AgentDispatcher

## 10. Success Criteria

1. All existing tests pass without modification:
   - `packages/agent/src/__tests__/agent-loop.test.ts`
   - `packages/workflow/src/__tests__/workflow.test.ts`
2. New tests cover:
   - Annotation reducer behavior (append, last-write-wins, custom dedup)
   - StateGraph compilation: valid graph succeeds, invalid graphs produce specific errors
   - Graph execution: static edges, conditional edges, error edges, retry behavior
   - Checkpoint save/load/getPrior/listRun/gc
3. Manual verification:
   - Secretary agent conversation works identically
   - Existing workflows run and produce identical output
   - Context handoff triggers correctly when context fills
