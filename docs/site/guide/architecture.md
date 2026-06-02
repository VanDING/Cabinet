# Architecture

Cabinet is organized into **5 strict layers**. Dependencies flow only upward — lower layers never depend on upper layers. This keeps the system predictable and makes individual modules replaceable.

## Layer Overview

| Layer | Packages | Purpose |
| :---- | :------- | :------ |
| **Infrastructure** | `types`, `events`, `storage`, `graph` | Type system, event bus, SQLite persistence, graph execution engine |
| **Agent Core** | `gateway`, `agent`, `memory` | LLM gateway, graph-based agent loop, 4-layer memory |
| **Business** | `decision`, `secretary`, `meeting`, `workflow`, `harness`, `organize` | Core product capabilities |
| **Interface** | `ui`, `server`, `desktop`, `cli` | React components, REST API, Tauri app, CLI |

```
┌──────────────────────────────────────────────┐
│                    Interface                   │
│     Desktop App / REST API / CLI              │
├──────────────────────────────────────────────┤
│          Business Logic                        │
│  Secretary / Meeting / Decision / Workflow    │
│  + Harness + Organize                         │
├──────────────────────────────────────────────┤
│                Agent Core                      │
│       LLM Gateway / Agent Loop / Memory       │
├──────────────────────────────────────────────┤
│           Infrastructure                       │
│  Graph Engine / Event Bus / SQLite / Types    │
└──────────────────────────────────────────────┘
```

## Key Design Principles

### 1. Interface First, Then Implementation

Every module starts with a TypeScript `interface`, followed by tests, then implementation. This ensures clear boundaries and makes mocking straightforward.

### 2. Zero External Runtime Dependencies for Core

The LLM gateway uses **Vercel AI SDK** (pure TypeScript) instead of Python-based alternatives like LiteLLM. This keeps the desktop bundle small and avoids cross-language debugging.

### 3. Event-Driven Decoupling

Modules at the same layer communicate through the **EventBus** (`@cabinet/events`), not direct imports. Events are immutable, append-only, and stored in SQLite with full causation chains.

### 4. Graph-Driven Agent Loop

The `AgentLoop` (`@cabinet/agent`) compiles to a **StateGraph** (`@cabinet/graph`) with 6 nodes:

```
buildContext → callLLM → evaluate → safetyCheck → executeTools → feedback
```

The framework provides the execution skeleton; the LLM drives the logic. Each node auto-saves a checkpoint to SQLite, enabling **time travel** (resume from any historical state). Tool execution passes through a **4-tier safety check** before running.

### 5. Capabilities-Gated Workflows

Workflow agents declare required capabilities (`files`, `web`, `shell`, `scheduler`, `knowledge`, `evaluation`) in their definition. The system injects only the requested dependencies, preventing accidental privilege escalation.

## Three Safety / Quality Gates

Cabinet uses three distinct validation layers, each with a clear, non-overlapping responsibility:

| Gate | Package | Trigger | Responsibility |
| :--- | :------ | :------ | :------------- |
| **Safety Check** | `agent/safety.ts` | Before every tool call | "Can we do this?" — cache rules → auto mode → whitelist → AI classifier |
| **Quality Gate** | `harness/quality-gate.ts` | After Agent output | "Was this done well?" — H-E-I format check; retry if needed |
| **Blueprint Validator** | `workflow/blueprint-validator.ts` | Workflow blueprint definition | "Can this pass to the next node?" — node connectivity, cycle detection, schema validation |

**In short**: Safety says *can*, Harness says *good*, Workflow says *compatible*.

## Desktop Application Structure

The desktop app (`apps/desktop`) is a React SPA running inside a Tauri shell.

**Navigation pages** (defined in `Navigation` component):

| Page | Route | Purpose |
| :--- | :---- | :------ |
| **Office** | `/` or `/project/:id/office` | Default workspace; decision cards, project explorer, file viewer |
| **Factory** | `/factory` or `/project/:id/factory` | Workflow canvas editor and execution monitor |
| **Employees** | `/employees` | Agent/Employee management and configuration |
| **Memory** | `/memory` | Memory browser, knowledge graph, contradiction review |
| **Settings** | `/settings` | API keys, budget, delegation tier, themes, backups |

The chat panel is a persistent overlay accessible from any page via the sidebar or `Ctrl+N` shortcut.

## Backend API Structure

The server (`apps/server`) exposes a Hono-based REST API. Key route modules:

- `secretary.ts` — Chat streaming, intent routing, agent dispatch
- `decisions.ts` — Decision CRUD, approval, analysis
- `workflows.ts` — Workflow run orchestration with capability injection
- `meetings.ts` — Meeting report retrieval
- `projects.ts` — Project lifecycle
- `employees.ts` — Employee/Agent management
- `skills.ts` — Skill registry
- `settings.ts` — Budget, delegation, API keys
- `audit.ts` — Audit log queries
- `memory.ts` — Memory read/write endpoints
- `health.ts` — System health checks
- `observability.ts` — Metrics and reports

WebSocket real-time events broadcast state changes to connected desktop clients.

## Data Flow (Core Loop)

```
Captain Input
     │
     ▼
Secretary Agent (Intent Parsing)
     │
     ├─► Simple query → Direct answer
     │
     ├─► Decision needed → DecisionService (L0-L3 classification)
     │                           │
     │              L0/L1 ───────┘ (auto-execute)
     │              L2/L3 ───────┐ (surface to Captain)
     │                           ▼
     │                    Dashboard / Office (approve / reject / review)
     │                           │
     ├─► Meeting needed → MeetingService (cost estimate → parallel advisors → synthesis)
     │                           │
     └─► Workflow needed → WorkflowEngine (node execution → blueprint validation)
                                   │
                              Harness (quality gate)
                                   │
                              EventBus broadcast
                                   │
                              State receipt in chat stream
```

## Monorepo Package Boundaries

| Package | Exports | Consumers |
| :------ | :------ | :-------- |
| `@cabinet/types` | All primitives, enums, payload types | Every package |
| `@cabinet/events` | `EventBus`, `SqliteEventStore`, causation | `storage`, `server` |
| `@cabinet/storage` | Connection pool, repositories, migrations | `server` |
| `@cabinet/graph` | `StateGraph`, `CompiledGraph`, `Annotation`, `CheckpointStore`, validation | `agent`, `workflow`, `server` |
| `@cabinet/gateway` | `LLMGateway`, `ModelRouter`, `BudgetGuard` | `agent`, `server` |
| `@cabinet/agent` | `AgentLoop`, `SafetyChecker`, `ToolExecutor`, roles, `createAgentNodeFactory`, `assemblePrompt` | `server` |
| `@cabinet/memory` | 4-layer memory, consolidation, knowledge graph | `agent`, `server` |
| `@cabinet/secretary` | `SecretaryAgent`, `IntentParser`, `GreetingService` | `server` |
| `@cabinet/meeting` | Prompt builders, parsing utilities, synthesis | `server` |
| `@cabinet/decision` | `DecisionService`, level classifier, state machine | `server` |
| `@cabinet/workflow` | `WorkflowEngine`, `evaluateCondition`, blueprints | `server` |
| `@cabinet/harness` | Evaluator, quality gate, observability | `server` |
| `@cabinet/ui` | React components, hooks, themes | `desktop` |
| `@cabinet/organize` | Project organization helpers | `agent`, `server` |
| `@cabinet/cli` | Command-line tools | Standalone |
