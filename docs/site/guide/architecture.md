# Architecture

Cabinet is organized into **4 strict layers**. Dependencies flow only upward — lower layers never depend on upper layers. This keeps the system predictable and makes individual modules replaceable.

## Layer Overview

| Layer              | Packages                                       | Purpose                                                                            |
| :----------------- | :--------------------------------------------- | :--------------------------------------------------------------------------------- |
| **Infrastructure** | `types`, `events`, `storage`                   | Type system, event bus, SQLite persistence                                         |
| **Agent Core**     | `gateway`, `agent`, `memory`, `agent-sdk`      | LLM gateway, agent loop with observer pipeline, 4-layer memory, external agent SDK |
| **Business**       | `decision`, `secretary`, `workflow`, `harness` | Core product capabilities                                                          |
| **Interface**      | `ui`, `server`, `desktop`, `cli`               | React components, REST API, Tauri app, CLI                                         |

```
┌────────────────────────────────────────────┐
│               Interface                     │
│  Desktop App / REST API (Hono) / CLI       │
├────────────────────────────────────────────┤
│             Business Logic                  │
│  Secretary / Decision / Workflow / Harness  │
├────────────────────────────────────────────┤
│              Agent Core                     │
│  LLM Gateway / AgentLoop / Memory / SDK     │
├────────────────────────────────────────────┤
│           Infrastructure                    │
│  Event Bus / SQLite / Shared Types          │
└────────────────────────────────────────────┘
```

## Key Design Principles

### 1. Interface First, Then Implementation

Every module starts with a TypeScript `interface`, followed by tests, then implementation. This ensures clear boundaries and makes mocking straightforward.

### 2. Zero External Runtime Dependencies for Core

The LLM gateway uses **Vercel AI SDK** (pure TypeScript) instead of Python-based alternatives like LiteLLM. This keeps the desktop bundle small and avoids cross-language debugging.

### 3. Event-Driven Decoupling

Modules at the same layer communicate through the **EventBus** (`@cabinet/events`), not direct imports. Events are immutable, append-only, and stored in SQLite with full causation chains.

### 4. Observer-Driven Agent Loop

The `AgentLoop` (`@cabinet/agent`) uses an async generator (`executeGenerator`) with a pluggable **ObserverPipeline**:

```
Context Assembly → LLM Call → Tool Execution → [repeat] → Final Response
                          ↑
                   ObserverPipeline
           (safety / reflection / checkpoints / PIS /
            content guard / blackboard / auto-replan / etc.)
```

The framework provides the execution skeleton; the LLM drives the logic. Each step is observable through 14 pluggable observers that can inspect, block, or inject into the execution without touching the core loop.

### 5. Capabilities-Gated Workflows

Workflow agents declare required capabilities (`files`, `web`, `shell`, `scheduler`, `knowledge`, `evaluation`) in their definition. The system injects only the requested dependencies, preventing accidental privilege escalation.

## Three Safety / Quality Gates

Cabinet uses three distinct validation layers, each with a clear, non-overlapping responsibility:

| Gate                    | Package                              | Trigger                       | Responsibility                                                                            |
| :---------------------- | :----------------------------------- | :---------------------------- | :---------------------------------------------------------------------------------------- |
| **Delegation Tier**     | `agent/safety.ts` + `mcp-manager.ts` | Before every tool call        | "Can we do this?" — T0 (CaptainReview) to T3 (FullAutonomy)                               |
| **Quality Gate**        | `harness/quality-gate.ts`            | After Agent output            | "Was this done well?" — H-E-I format check; retry if needed                               |
| **Blueprint Validator** | `workflow/blueprint-validator.ts`    | Workflow blueprint definition | "Can this pass to the next node?" — node connectivity, cycle detection, schema validation |

**In short**: Safety says _can_, Harness says _good_, Workflow says _compatible_.

## Desktop Application Structure

The desktop app (`apps/desktop`) is a React SPA running inside a Tauri shell.

**Navigation pages**:

| Page          | Route                                | Purpose                                                                                |
| :------------ | :----------------------------------- | :------------------------------------------------------------------------------------- |
| **Office**    | `/` or `/project/:id/office`         | Default workspace; dashboard, decision cards, welcome header, activity heatmap, kanban |
| **Factory**   | `/factory` or `/project/:id/factory` | Workflow canvas editor and execution monitor                                           |
| **Employees** | `/employees`                         | Agent/Employee management and configuration                                            |
| **Memory**    | `/memory`                            | Memory browser, knowledge graph, contradiction review                                  |
| **Workbench** | `/workbench`                         | Agent marketplace, install/scan, API keys, MCP servers, skills                         |
| **Settings**  | `/settings`                          | Delegation tier, themes, backups                                                       |

The chat panel is a persistent overlay accessible from any page via the sidebar or `Ctrl+N` shortcut.

## Backend API Structure

The server (`apps/server`) exposes a Hono-based REST API. Key route modules:

- `secretary/` — Chat streaming, intent routing, agent dispatch, sub-agent management
- `decisions/` — Decision CRUD, approval, analysis
- `workflows/` — Workflow run orchestration with capability injection
- `projects/` — Project lifecycle
- `employees/` — Employee/Agent management
- `skills/` — Skill registry
- `agents/` — Agent card, A2A task routing, discovery
- `workbench/` — Agent scanning, install, config projection, MCP binding
- `install/` — Agent installation via npm/pip/brew
- `tasks/` — Task queue management
- `memory/` — Memory read/write, knowledge graph, cross-project migration
- `settings/` — Delegation tier, themes, API keys
- `dashboard/` — Real-time stats, agent health, cost history, trends
- `evaluations/` — Harness evaluation reports
- `deliverables/` — Deliverable CRUD
- `external-agent/` — External agent (A2A) task and decision endpoints
- `health/` — System health checks
- `telemetry/` — Agent telemetry reporting and trends

WebSocket real-time events broadcast state changes to connected desktop clients.

## Data Flow (Core Loop)

```
Captain Input
     │
     ▼
Secretary Agent (4-layer Intent Parsing)
     │
     ├─► Direct answer → Secretary handles inline
     │
     ├─► Decision needed → DecisionService (L0-L3 classification)
     │                           │
     │              L0/L1 ───────┘ (auto-execute)
     │              L2/L3 ───────┐ (surface to Captain)
     │                           ▼
     │                    Dashboard / Office (approve / reject / review)
     │
     ├─► Workflow needed → WorkflowEngine (adjacency graph traversal)
     │                           │
     │                      Harness (quality gate)
     │
     └─► Specialist needed → AgentDispatcher
                                │
                          AgentLoop (observer pipeline)
                                │
                          EventBus broadcast
                                │
                          State receipt in chat stream
```

## Monorepo Package Boundaries

| Package              | Exports                                                                                                                                                                                                                            | Consumers           |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------ |
| `@cabinet/types`     | All primitives, enums, payload types, workbench types                                                                                                                                                                              | Every package       |
| `@cabinet/events`    | `EventBus`, `SqliteEventStore`, causation                                                                                                                                                                                          | `storage`, `server` |
| `@cabinet/storage`   | Connection pool, repositories, migrations, encryption                                                                                                                                                                              | `server`            |
| `@cabinet/gateway`   | `LLMGateway`, `ModelRouter`, `BudgetGuard`, `CostTracker`                                                                                                                                                                          | `agent`, `server`   |
| `@cabinet/agent`     | `AgentLoop`, `executeGenerator`, `ObserverPipeline`, `SafetyChecker`, `ToolExecutor`, roles, observers, `AgentDispatcher`, `AgentDaemon`, `CheckpointManager`, `ContextBuilder`, `Scanner`, `Installer`, `Projector`, ACP adapters | `server`            |
| `@cabinet/memory`    | 4-layer memory, consolidation, knowledge graph, `HybridRetriever`, `MemoryDecay`, `CrossProjectMigrator`                                                                                                                           | `agent`, `server`   |
| `@cabinet/agent-sdk` | `SlotClient`, `A2AHelper`, `createAgentCard`                                                                                                                                                                                       | External agents     |
| `@cabinet/secretary` | `SecretaryAgent`, `IntentParser` (4-layer), `GreetingService`, `SessionManager`                                                                                                                                                    | `server`            |
| `@cabinet/decision`  | `DecisionService`, level classifier (L0-L3), state machine, `PolicyEngine`                                                                                                                                                         | `server`            |
| `@cabinet/workflow`  | `WorkflowEngine`, `evaluateCondition`, blueprints, `NodeExecutor`                                                                                                                                                                  | `server`            |
| `@cabinet/harness`   | Evaluator, QualityGate, `ObservabilityCollector`, `AutoAdjuster`, `PreferenceLearner`, `SubconsciousLoop`, `FailureAnalyzer`, `TeachBack`                                                                                          | `server`            |
| `@cabinet/ui`        | React components, hooks, themes                                                                                                                                                                                                    | `desktop`           |
| `@cabinet/cli`       | Command-line tools (`cabinet start`)                                                                                                                                                                                               | Standalone          |
