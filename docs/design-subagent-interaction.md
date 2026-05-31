# Cabinet V2.0 Multi-Session Sub-Agent Interaction Design

**Status**: Design Draft  
**Date**: 2026-05-31  
**Scope**: Frontend UX + Backend Architecture  

---

## 1. Background & Problem

Current system uses a **single-session linear model**:

```
User Input → Secretary → Sub-agent (one-shot) → Result → Secretary continues
```

This fails in scenarios like `organize` (organizational planning), where the user needs to **iteratively refine** the sub-agent's output:

- Organize generates a workflow draft
- User says "make step 2 a loop" — this input should go **to Organize**, not restart the whole flow
- Current system has no way to route mid-flight user input to a running sub-agent
- Each revision re-runs the entire Organize agent from scratch, wasting tokens and breaking flow

---

## 2. Design Goals

| Goal | Description |
|------|-------------|
| **Natural Language Interaction** | User talks to sub-agents in plain text, just like talking to Secretary |
| **Transparent Execution** | Sub-agent's thinking/tool_calls/output visible in a collapsible sub-window |
| **Interactive While Running** | User can send input to a running sub-agent; sub-agent receives it and continues |
| **Auto-Switch Input Target** | ChatPanel automatically routes input to whichever agent the user is focused on |
| **Post-Completion Archive** | Completed sub-agents fold into read-only "history cards", preserving full execution log |
| **Parallel Sub-Agents** | Multiple sub-agents can run concurrently; strict isolation between them |
| **Persistent State** | Sub-agent sessions survive page refresh via server-side persistence |

---

## 3. Architecture Overview

### 3.1 Conceptual Model

```
Secretary Session (Main)
├── Message 1: user "Design a workflow for data processing"
├── Message 2: assistant "Launching Organize Agent..."
│
├── Sub-Agent Session A: Organize Agent (status: running)
│   ├── Sub-window (expandable)
│   │   ├── thinking: "User needs a data pipeline..."
│   │   ├── tool_call: list_directory("/project/src")
│   │   ├── output: [workflow draft JSON]
│   │   └── user input (routed here): "make step 2 a loop"
│   ├── thinking: "adjusting step 2 to loop structure..."
│   ├── output: [revised workflow JSON]
│   └── status: completed → folds to history card
│
├── Message 3: assistant "Workflow design complete. Deploy now?"
│
└── Sub-Agent Session B: Decision Agent (status: running, parallel)
    └── Sub-window: "Analyzing deployment risk..."
```

### 3.2 Two Consumers for Every Sub-Agent Event

Every event produced by a sub-agent is **dual-tracked**:

```
Sub-Agent Event
├── Track A: WebSocket → Frontend (real-time sub-window rendering)
└── Track B: Accumulated → Final result injected back into Secretary context
```

---

## 4. Session Topology

Current `useSessions` manages a flat list of chat sessions. New design requires a **session tree**:

```typescript
interface SessionNode {
  id: string;
  type: 'secretary' | 'subagent';
  agentType?: string;           // 'organize' | 'decision' | 'review' | ...
  parentId?: string;            // null for secretary, secretary-id for subagent
  status: 'active' | 'completed' | 'error';

  // Shared
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;

  // Sub-agent specific
  events: AgentEvent[];         // execution trace (thinking, tool_call, etc.)
  deliverable?: unknown;        // final structured output
  userInputs: ChatMessage[];    // mid-flight user inputs sent to this sub-agent
}
```

**Tree Invariants**:
- One `secretary` session can have 0..N `subagent` children
- Sub-agents are strictly isolated: no shared state, no cross-references
- Sub-agent lifecycle is bound to parent secretary session

---

## 5. Input Router

### 5.1 Routing Rules

| User Action | Input Target | UI Indicator |
|-------------|-------------|--------------|
| Click main chat area, no active sub-window | Secretary | Default state |
| Click an active sub-window (Organize) | That sub-agent | ChatPanel shows "Send to Organize Agent" |
| Type `@decision analyze this` anywhere | Decision Agent | Explicit override by @mention |
| Sub-agent completes (status→completed) | Auto-switch back to Secretary | No manual action needed |
| Multiple sub-windows exist | Whichever is clicked/focused | Strict isolation, one target at a time |

### 5.2 Protocol

```typescript
type UserInput = {
  content: string;
  target:
    | { type: 'secretary'; sessionId: string }
    | { type: 'subagent'; sessionId: string; agentId: string };
};
```

Frontend `ChatPanel` maintains a `currentTarget` state:
- Default: `{ type: 'secretary', sessionId: activeSecretarySession }`
- On sub-window click: `{ type: 'subagent', sessionId: subAgentSessionId, agentId }`
- On sub-agent completion: reset to secretary
- On `@mention` detection: override to mentioned agent

---

## 6. Sub-Agent Interaction Contract

Sub-agents are **not one-shot tools**. They support multi-turn interaction.

```typescript
interface InteractiveSubAgent {
  // Lifecycle
  init(context: InitContext): Promise<void>;

  // Mid-flight user input (natural language)
  onUserInput(input: string): Promise<void>;

  // User explicitly confirms "I'm satisfied"
  finalize(): Promise<Deliverable>;

  // Event stream for frontend rendering
  onEvent: EventEmitter<AgentEvent>;

  // Status
  getStatus(): 'running' | 'waiting_for_user' | 'completed' | 'error';
}
```

### 6.1 Organize Agent Example

```
T1: Secretary launches Organize Agent with context
    → Organize.init({ topic: "data processing workflow", projectId: "xxx" })
    → Frontend shows sub-window, Organize starts outputting

T2: Organize outputs draft workflow
    → User sees draft in sub-window

T3: User clicks sub-window, types: "step 2 should be a loop"
    → ChatPanel routes to Organize
    → Organize.onUserInput("step 2 should be a loop")
    → Organize revises, outputs updated workflow

T4: User satisfied, clicks "Confirm" in sub-window
    → Organize.finalize() returns final workflow JSON
    → Sub-agent status → completed, folds to history card
    → Final deliverable injected into Secretary context
    → Secretary: "Workflow confirmed. Deploy now?"
```

---

## 7. Frontend UX Design

### 7.1 Sub-Window Component

```
┌─ Sub-Agent: Organize Agent ───────────────┐
│ ○ Running...                    [─] [×]  │  ← header: status + collapse/close
├───────────────────────────────────────────┤
│ ▶ thinking: analyzing project structure   │  ← expandable event log
│ ▶ tool_call: list_directory("/src")       │
│ ▶ output: { workflow draft... }           │
│                                           │
│ [User input sent] "make step 2 a loop"    │  ← user's mid-flight inputs shown
│ ▶ thinking: adjusting step 2...           │
│ ▶ output: { revised workflow... }         │
│                                           │
│ [Confirm] [Regenerate]                    │  ← action buttons (only while active)
└───────────────────────────────────────────┘
```

**States**:
- **Running**: Expandable, shows real-time events, accepts user input
- **Completed**: Collapses to compact "history card"; expandable to view full log; **read-only, no input**
- **Error**: Shows error message, offers retry

### 7.2 ChatPanel Auto-Switch

```
┌─ ChatPanel ───────────────────────────────┐
│                                           │
│  [Send to Organize Agent]                 │  ← target indicator
│  ┌─────────────────────────────────────┐  │
│  │ step 2 should be a loop             │  │  ← input box
│  └─────────────────────────────────────┘  │
│                                    [Send] │
└───────────────────────────────────────────┘
```

- Target indicator shows current recipient
- Clicking a sub-window changes indicator + input route
- `@mention` in input box overrides target temporarily

### 7.3 Multiple Parallel Sub-Agents

```
Main Chat
├─ Message: Secretary launching Organize...
├─ Sub-window: Organize Agent [running]
├─ Message: Secretary launching Decision...
├─ Sub-window: Decision Agent [running]
└─ Message: Secretary waiting for results...
```

Each sub-window is independent. User clicks one → input routes there. Click main chat → input routes to Secretary.

---

## 8. Agent Execution Event Bus

Required by this design and also by audit item 2.6 (generic agent event bus).

### 8.1 Event Types

```typescript
type AgentEvent =
  // Execution trace
  | { type: 'thinking'; content: string; timestamp: number }
  | { type: 'tool_call'; name: string; args: unknown; timestamp: number }
  | { type: 'tool_result'; name: string; result: unknown; timestamp: number }
  | { type: 'stream_chunk'; content: string; timestamp: number }
  | { type: 'output'; content: string; timestamp: number }

  // Lifecycle
  | { type: 'started'; timestamp: number }
  | { type: 'user_input_received'; content: string; timestamp: number }
  | { type: 'completed'; deliverable?: unknown; timestamp: number }
  | { type: 'error'; message: string; timestamp: number };
```

### 8.2 Dual-Track Distribution

```typescript
class AgentEventBus {
  publish(sessionId: string, event: AgentEvent) {
    // Track A: WebSocket push to frontend
    ws.broadcast(`agent_event:${sessionId}`, event);

    // Track B: Persist to session store
    sessionStore.appendEvent(sessionId, event);

    // Track C: If sub-agent completed, notify parent secretary
    if (event.type === 'completed') {
      this.notifyParent(sessionId, event.deliverable);
    }
  }
}
```

---

## 9. Persistence

### 9.1 Current Gap

- `session-manager.ts` persists only secretary sessions to JSON files (with `writeFileSync`)
- Sub-agent execution traces are ephemeral
- Page refresh loses all sub-window state

### 9.2 Required Persistence

| Data | Current | Required |
|------|---------|----------|
| Secretary messages | JSON file | SQLite (see audit 1.1) |
| Sub-agent events | In-memory only | SQLite (new table) |
| Sub-agent deliverables | Lost on refresh | SQLite (linked to parent session) |
| Sub-agent user inputs | Lost on refresh | SQLite (as messages with target) |

### 9.3 Schema Sketch

```sql
-- Existing sessions table (needs extension)
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN agent_type TEXT;
ALTER TABLE sessions ADD COLUMN status TEXT; -- active | completed | error

-- New: agent_events (append-only log)
CREATE TABLE agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- New: sub_agent_deliverables
CREATE TABLE sub_agent_deliverables (
  session_id TEXT PRIMARY KEY,
  deliverable_type TEXT,
  deliverable_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 10. Relation to Audit Report Items

This design directly addresses or depends on several audit findings:

| Audit Item | Relation |
|------------|----------|
| **1.1** LocalStorage-only sessions | Must be fixed first. Sub-agent state cannot survive refresh without server-side persistence. |
| **1.7** IntentParser latency | Eliminates `IntentParser` for sub-agent routing. Secretary launches sub-agents via `tool_call`, not external routing. |
| **2.6** Generic agent event bus | Required infrastructure. Sub-agent events must flow through a standardized bus to reach frontend sub-windows. |
| **3.3** App.tsx God Component | `ChatContext` must manage session trees (not flat lists), and `ChatPanel` needs target-aware routing state. |
| **3.8** Duplicate tool logic | Sub-agents (Organize, Decision, etc.) should reuse `packages/agent/src/tools/`, not re-implement. |

---

## 11. Implementation Path

### Phase 1: Foundation
1. Build generic Agent Event Bus (audit 2.6)
2. Extend session storage to support session trees (child sessions)
3. Add `agent_events` table to SQLite

### Phase 2: Backend Sub-Agent Runtime
1. Refactor sub-agent implementations (Organize, Decision, etc.) to implement `InteractiveSubAgent` contract
2. Add `onUserInput` support to agent loop
3. Wire sub-agent events into event bus

### Phase 3: Frontend Sub-Window
1. Build `SubAgentWindow` component (expandable, event log, user input)
2. Modify `ChatView` to render session tree (main messages + sub-windows inline)
3. Add target indicator to `ChatPanel`

### Phase 4: Input Router
1. Implement `currentTarget` state in `ChatPanel`
2. Wire click-on-sub-window to switch target
3. Support `@mention` override
4. Auto-revert to Secretary on sub-agent completion

### Phase 5: Polish
1. Persist sub-agent events to SQLite
2. Restore sub-windows on page refresh
3. History card mode (completed sub-agents)

---

## 12. Open Questions (for future discussion)

1. **Sub-agent error recovery**: If Organize crashes mid-flight, does user retry from beginning or from last checkpoint?
2. **Secretary awareness**: Should Secretary see a summary of sub-agent events in real-time, or only the final deliverable?
3. **Long-running sub-agents**: If a sub-agent runs for minutes, should the user be able to navigate away and come back? (Requires stronger persistence.)
4. **Sub-agent tool access**: Should sub-agents have the same tool set as Secretary, or a restricted subset?
