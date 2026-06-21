# Multi-Agent Node Factory — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Scope:** Two new files in `packages/agent/` — `agent-node.ts` (factory), `agent-handoff.ts` (types). Plus one helper: `createSelector` in `agent-node.ts`.

## 1. Motivation

StateGraph nodes are pure functions. AgentLoop is a stateful class. To compose multi-agent graphs (Meeting: Chair → Advisor ⇄ Reviewer, Workflow: agentGroup transitions), there must be:

1. A factory that adapts AgentLoop into a graph-compatible `(state) => Partial<state>` function.
2. A standard handoff format so agents write their outputs to a predictable shape that selectors and downstream agents can read.
3. A selector pattern for multi-round agent conversation — an agent can be revisited based on runtime state.

## 2. Design Decisions

| Decision        | Choice                                                                                          | Rationale                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factory API     | `createAgentNodeFactory(deps)` → `(config) → NodeFn`                                            | One deps injection, many nodes                                                                                                                           |
| Input mapping   | `{ message: string, systemPrompt?: string }`                                                    | message for task text; optional systemPrompt appended to role's default                                                                                  |
| Default output  | `output` **is now optional**. Omitted → writes `AgentHandoff` to `state.agentHandoffs[agentId]` | Convention over configuration. Explicit output overrides default.                                                                                        |
| Handoff format  | `AgentHandoff` type: `{ from, task, findings, decisions, confidence, openQuestions }`           | Matches the structured fields AgentResult already has via `structuredOutput`                                                                             |
| Selector        | `createSelector(targets, fn, maxRounds)` — a pure graph node + conditional edges                | No new abstraction. Selector is just a node that returns `{ nextSpeaker }`, and conditional edges route based on that. `maxRounds` enforces termination. |
| Multi-round     | No new mechanism. Selector's conditional edge back to an agent node = revisit                   | Graph's existing cycle support with conditional exit                                                                                                     |
| Layer placement | All in `packages/agent/`                                                                        | Agent primitives only. graph package stays agent-agnostic                                                                                                |

## 3. Types

### 3.1 AgentHandoff

```typescript
// packages/agent/src/agent-handoff.ts

interface AgentHandoff {
  from: string; // agent ID (e.g. "chair", "reviewer")
  task: string; // what this agent was asked to do
  summary: string; // 1-2 sentence summary of output
  findings: Array<{ type: string; detail: string; severity?: 'high' | 'medium' | 'low' }>;
  decisions: Array<{ decision: string; rationale: string }>;
  openQuestions: string[];
  confidence: number; // 0.0–1.0
  rawOutput: string; // full AgentResult.content
}
```

### 3.2 State Schema Convention

```typescript
// Users add this to their graph's state:
const MyState = {
  agentHandoffs: Annotation<Record<string, AgentHandoff>>({
    reducer: (a, b) => ({ ...a, ...b }), // merge, latest wins per agentId
    default: () => ({}),
  }),
  nextSpeaker: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
};
```

### 3.3 AgentNodeDeps

```typescript
interface AgentNodeDeps {
  gateway: LLMGateway;
  toolExecutor: ToolExecutor;
  safetyChecker: SafetyChecker;
  db: Database;
  memoryProvider: MemoryProvider;
}
```

### 3.4 AgentNodeConfig

```typescript
interface AgentNodeConfig<S> {
  role: AgentRole;
  agentId: string; // unique within this graph (e.g. "advisor_main").
  // NOT the same as role.type ("advisor").
  // Allows multiple instances of the same role in one graph.
  input: (state: S) => { message: string; systemPrompt?: string };
  output?: (state: S, result: AgentResult) => Partial<S>; // optional — defaults to writing handoff
}
```

### 3.5 Factory

```typescript
type AgentNodeFn<S> = (state: S) => Promise<Partial<S>>;

function createAgentNodeFactory<S>(
  deps: AgentNodeDeps,
): (config: AgentNodeConfig<S>) => AgentNodeFn<S>;
```

### 3.6 Selector

```typescript
interface SelectorConfig<S> {
  targets: string[]; // agent node IDs this selector can route to
  decide: (state: S) => string | typeof END; // pure function: state → next agent ID (or END)
  maxRounds: number; // safety limit — after this many, routes to END
}

function createSelector<S>(config: SelectorConfig<S>): (state: S) => { nextSpeaker: string };
```

The selector node writes `{ nextSpeaker }` to state. The caller adds conditional edges from the selector node mapping each target + `__default__` (END).

## 4. Behavior

### 4.1 createAgentNode

1. **Tool filter**: `deps.toolExecutor.createView(config.role.allowedTools)`.
2. **AgentLoop construction**: Uses `role` fields directly.
3. **System prompt**: `effectivePrompt = role.systemPrompt + '\n\n' + override` (if override provided).
4. **Session isolation**: Each invocation gets a unique `sessionId`.
5. **Default output** (when `config.output` is omitted): parses `result.structuredOutput` if available, falls back to simple extraction from `result.content`. Writes `AgentHandoff` to `state.agentHandoffs[config.agentId]`.
6. **Explicit output** (when `config.output` is provided): calls the custom function. Skips default handoff.
7. **Error propagation**: Throws to graph error handling.

### 4.2 createSelector

1. **Round counting**: Internally tracks a round counter via a hidden state field (`_selectorRounds`). Users do NOT need to declare this field in their state schema — it's typed as part of the return value.
2. **Termination**: If counter >= `maxRounds`, writes `{ nextSpeaker: END as any }` to state. The conditional edges' `__default__` target handles this and routes to END.
3. **Normal flow**: Calls `decide(state)`. If `decide` returns END or a value not in `targets`, the `__default__` edge routes to END.
4. **Repeated agent visits**: selector can route to the same agent ID across multiple rounds (e.g., advisor called twice after reviewer feedback).

## 5. Usage: Meeting with Selector

```typescript
const deps = { gateway, toolExecutor, safetyChecker, db, memoryProvider };
const node = createAgentNodeFactory<MeetingState>(deps);
const selector = createSelector<MeetingState>({
  targets: ['chair', 'advisor', 'reviewer'],
  decide: (s) => {
    if (!s.agentHandoffs['chair']) return 'chair';
    if (!s.agentHandoffs['advisor']) return 'advisor';
    if (s.agentHandoffs['reviewer']?.confidence < 0.7) return 'advisor'; // redo
    if (!s.agentHandoffs['reviewer']) return 'reviewer';
    return END;
  },
  maxRounds: 6,
});

const graph = new StateGraph(MeetingState)
  .addNode('selector', selector)
  .addNode(
    'chair',
    node({
      role: MEETING_CHAIR_ROLE,
      agentId: 'chair',
      input: (s) => ({ message: s.topic }),
    }),
  )
  .addNode(
    'advisor',
    node({
      role: ADVISOR_ROLE,
      agentId: 'advisor',
      input: (s) => ({ message: buildAdvisorPrompt(s.agentHandoffs['chair']?.rawOutput) }),
    }),
  )
  .addNode(
    'reviewer',
    node({
      role: REVIEWER_ROLE,
      agentId: 'reviewer',
      input: (s) => ({ message: buildReviewTask(s.agentHandoffs['advisor']?.rawOutput) }),
    }),
  )
  // selector → agents
  .addConditionalEdges('selector', (s) => s.nextSpeaker, {
    chair: 'chair',
    advisor: 'advisor',
    reviewer: 'reviewer',
    __default__: END,
  })
  // agents → back to selector
  .addEdge('chair', 'selector')
  .addEdge('advisor', 'selector')
  .addEdge('reviewer', 'selector');
```

## 6. Usage: Workflow agentGroup

```typescript
// In buildStateGraph(), replacing the current agentGroup case:
sg.addNode(
  nodeId,
  node({
    role: registry.get(workflowNode.role),
    agentId: nodeId,
    input: () => ({ message: previousStepsOutput }),
  }),
);
// Edges from/to the agent node handled by existing graph edge construction
```

## 7. Layer Diagram

```
┌──────────────────────────────────────────┐
│  secretary / workflow / meeting          │  ← composes createAgentNode + createSelector + StateGraph
├──────────────────────────────────────────┤
│  agent: createAgentNode, createSelector,  │  ← agent-node.ts (factory, selector)
│  AgentHandoff, AgentLoop, Dispatcher,     │      agent-handoff.ts (types)
│  Safety, AgentRole                        │      adapts AgentLoop → graph-compatible fn
├──────────────────────────────────────────┤
│  graph: StateGraph, Annotation, Vld       │  ← unchanged, agent-agnostic
├──────────────────────────────────────────┤
│  gateway, memory, storage, events         │  ← unchanged
└──────────────────────────────────────────┘
```

## 8. File Structure

```
packages/agent/src/agent-handoff.ts   ← NEW, ~20 lines (type only)
packages/agent/src/agent-node.ts      ← NEW, ~70 lines (factory + createSelector)
packages/agent/src/index.ts           ← MODIFY, add exports
```

No changes to any other package.

## 9. Non-Goals

- **No shared AgentLoop across graph invocations** — each agent node call creates a new session.
- **No agent-to-agent direct messaging** — all communication is via graph state channels.
- **No dynamic agent registration at runtime** — all agents are declared in the graph at compile time.
- **No built-in LLM-as-selector** — `decide` is a pure function. Callers can use LLM inside decide() via a helper if needed, but the selector itself is deterministic.
- **No parallel agent execution** — agent nodes run sequentially. Parallel mode uses `addNode` directly.

## 10. Success Criteria

- `createAgentNode` produces output compatible with `StateGraph.addNode()`
- Default handoff output writes correct `AgentHandoff` from `AgentResult`
- `createSelector` correctly limits rounds and routes based on `decide` function
- Selector + agent nodes form a working multi-round graph (tested with mock AgentLoops)
- Existing agent + workflow + graph tests continue to pass
- TypeScript strict mode — no type errors
