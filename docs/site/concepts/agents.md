# Agent System

Cabinet's agent architecture is designed around a single principle: **the model drives, the framework executes**. The framework provides memory, tools, safety checks, and observability — but the LLM decides what to do next.

## Agent Loop

Every AI Employee runs inside an `AgentLoop` — an async generator that drives the LLM-tool interaction cycle:

```
Context Assembly → LLM Call → Tool Execution → Repeat → Final Response
```

The loop is driven by `executeGenerator()` (`packages/agent/src/execution/execute-generator.ts`), which:

1. **Assembles context** — builds system prompt from role modules, project context, skill context, blackboard snapshot, MCP resources
2. **Calls the LLM** — streams thinking, text, and tool calls via the LLM gateway
3. **Executes tools** — read-only tools run in parallel, write tools run sequentially, all passing through the safety pipeline
4. **Repeats** — up to `maxSteps` per session, with checkpoint persistence every N steps for crash recovery
5. **Streams events** — `text`, `thinking`, `tool_call`, `tool_result`, `usage`, `done` etc. for real-time UI updates

The `ObserverPipeline` extends every step of this lifecycle with pluggable observers (see below).

## Agent Roles

Cabinet defines built-in roles, each with a `modules: { identity, workflow? }` definition that the Prompt Assembler composes at runtime:

| Role          | Purpose                                                 | Default Tier     |
| :------------ | :------------------------------------------------------ | :--------------- |
| **secretary** | Front-door agent; intent parsing, routing, greeting     | `default`        |
| **curator**   | Memory consolidation, knowledge graph maintenance       | `fast_execution` |
| **organize**  | Organization architect; workflow/agent/skill/MCP design | `deep_reasoning` |

Roles are registered in `AgentRoleRegistry` (`@cabinet/agent`). Custom agents (CLI, A2A) are registered at runtime via the scanner, installer, or Workbench UI.

## Intent Routing

When the Secretary receives input, it classifies the intent through a **4-layer intent pipeline** before dispatching:

```
User Input
    │
    ├─ Layer 1: Keyword match (fast path)
    ├─ Layer 2: Regex patterns
    ├─ Layer 3: Embedding similarity
    └─ Layer 4: LLM classification
         │
         ▼
    Intent Decision
         │
         ├─► decision_request → Secretary (direct handling)
         ├─► organize_request → Organize Agent
         ├─► skill_request → Organize Agent
         ├─► invoke_skill → Secretary (skill execution)
         ├─► status_query → Secretary (direct answer)
         ├─► knowledge_query → Secretary (with memory search)
         └─► unknown → Secretary (direct handling)
```

For multi-agent workflows, the `AgentDispatcher` routes tasks in three modes: `single` (default), `pipeline` (sequential), or `parallel` (concurrent with synthesis).

## Safety Architecture

Before any tool executes, it passes through a **4-tier delegation model** (`SafetyChecker`):

| Tier   | Name           | Behavior                                                  |
| :----- | :------------- | :-------------------------------------------------------- |
| **T0** | CaptainReview  | All writes blocked. Only read-only tools auto-pass.       |
| **T1** | StrategicGuard | Cost + destructive tools blocked. Light writes allowed.   |
| **T2** | TrustedMode    | Only destructive tools blocked.                           |
| **T3** | FullAutonomy   | No tool-level blocking. Budget guard is the only ceiling. |

Tools are classified into categories (`read_only`, `light_write`, `moderate`, `cost`, `destructive`) by type prefix and MCP server annotations. The safety check is integrated into both the in-process `SafetyChecker` and the MCP manager (`mcp-manager.ts`), which enforces T0-T3 rules directly at the transport boundary.

## Context Management

### ContextBuilder

Assembles the message list sent to the LLM by combining:

- **System prompt** — composed at runtime by `assemblePrompt()` from: shared rules (`[HARD]` constraints + guidelines) → role identity (`modules.identity`) → auto-generated tool list → workflow instructions → dynamic context
- Entity memory (Captain preferences, employee configs)
- Project memory (goals, milestones, recent decisions)
- Short-term memory (current session messages)
- Relevant long-term memories (semantic search)
- **Blackboard snapshot** — cross-agent shared state injected under token budget
- **MCP resources/prompts** — external context via Model Context Protocol
- **Skill context** — active skill prompt templates (loaded on demand, not all at once)

### Prompt Assembler

The `assemblePrompt()` function replaces static system prompt strings with modular composition:

- **No tool list drift** — tools are enumerated from the live `ToolExecutor`, never hand-written
- **Constraint grading** — `[HARD]` rules separated from soft Guidelines
- **Shared rules deduplicated** — constraints common to all roles live in `SHARED_PROMPT` once

### ContextMonitor

Tracks token usage in real time and classifies the session into zones:

| Zone         | Usage  | Action                                      |
| :----------- | :----- | :------------------------------------------ |
| **Smart**    | <40%   | Normal operation                            |
| **Warning**  | 40-60% | Begin summarizing older messages            |
| **Critical** | 60-80% | Aggressive pruning; trigger consolidation   |
| **Dumb**     | >80%   | Halt new tool calls; request user direction |

An `AdaptiveContextMonitor` variant learns zone thresholds from historical metrics when available.

### Context Handoff

When routing between agents, the `ContextHandoff` serializes current state into a `HandoffState` and passes it to the target agent. This preserves continuity without leaking unrelated context.

## Tool System

Tools are registered in a `ToolExecutor` and invoked by name. The executor auto-generates a tool descriptor list for the prompt at runtime, eliminating drift between what the prompt advertises and what the agent can actually call.

### Built-in Tools

The system registers 50+ tools across categories:

- **Memory** — `remember`, `recall`, `search_memory`, `write_memory`
- **Decisions** — `create_decision`, `query_decisions`, `get_decision`, `approve_decision`, `reject_decision`
- **Workflows** — `create_workflow`, `run_workflow`, `list_workflows`, `get_workflow`
- **Files** — `read_file`, `write_file`, `edit_file`, `list_directory`, `glob`, `grep`
- **Projects** — `get_project_context`, `update_project_summary`, `add_milestone`
- **Web** — `web_fetch`, `http_request`
- **Shell** — `execute_command`
- **System** — `query_system_knowledge`, `get_system_knowledge`, `get_status`
- **Scheduler** — `schedule_task`, `cancel_scheduled_task`
- **Skills** — `use_skill`, `update_skill`, `list_skills`
- **Agents** — `register_agent`, `update_agent`, `list_agents`
- **Evaluation** — `evaluate`
- **Sub-agents** — `create_sub_agent`, `send_to_sub_agent`, `finalize_sub_agent`

### MCP Tools

External capabilities via Model Context Protocol (MCP) servers are registered dynamically. These appear as ordinary tools (`mcp__serverName__toolName`) but execute in external processes through stdio or SSE transport. MCP tools carry `sideEffectRisk` annotations that feed into the T0-T3 safety model.

### Skill Tools

Skills are loaded from `SKILL.md` files and indexed by `SkillRegistry`. They can be exposed as prompt templates (injected into system prompt) or callable tools (`use_skill__{name}`). Built-in skills (workflowDesigner, agentCreator, skillCreator, mcpBuilder) provide guided design assistants.

## External Agents

Cabinet supports integrating third-party AI coding agents as first-class employees:

- **Discovery** — the `Scanner` auto-detects installed CLI agents (claude-code, codex, opencode, aider, etc.) on system PATH using recipe-based detection
- **Installation** — the `Installer` provides platform-specific install methods (npm, pip, brew, winget, etc.) via the Workbench UI
- **Protocols** —
  - **ACP** (Agent Communication Protocol): JSON-RPC 2.0 over stdin/stdout for rich two-way interaction
  - **Headless CLI**: spawn subprocess, collect stdout as deliverable
  - **Terminal-only**: direct terminal passthrough without structured output parsing
- **Projection** — the `Projector` system pushes Cabinet's API keys, MCP configs, and skills into the external agent's native config files

External agents are routed by the `AgentDaemon` pull-mode task queue: tasks are enqueued in the database, claimed and executed by daemon workers, with heartbeat-based liveness tracking.

## Agent Dispatcher

The `AgentDispatcher` supports three execution modes:

- **Pipeline** — Sequential steps, output of step N feeds into step N+1
- **Parallel** — Multiple agents run simultaneously, results merged via `ResultSynthesizer` (majority/weighted/keep_all)
- **Single** — One agent, one task (default)

Dispatch routing uses rate-limit-aware concurrency (max 3 in parallel mode) and supports contradiction detection across parallel outputs.

## Observer Pipeline

The `ObserverPipeline` (`packages/agent/src/observer-pipeline.ts`) is the extensibility backbone of the AgentLoop. Each observer hooks into lifecycle events and can inspect or modify execution state without touching the core loop logic.

### Lifecycle Hooks

```
onStreamStart → onUserInput → [ per-step: onToolCall → onToolResult → onStepEnd ] → onStreamEnd
```

### Registered Observers

| Observer                        | Hook(s)                      | Purpose                                                   | Preset        |
| :------------------------------ | :--------------------------- | :-------------------------------------------------------- | :------------ |
| **SafetyCheckObserver**         | `onToolCall`                 | Blocks dangerous tool calls via T0-T4 delegation tiers    | always active |
| **ToolExecuteObserver**         | `onToolCall`                 | Tracks tool execution metrics                             | always active |
| **ContextMonitorObserver**      | `onStepEnd`                  | Token usage tracking + zone classification                | standard+     |
| **HandoffObserver**             | `onStepEnd`                  | Context compaction when approaching window limit          | standard+     |
| **CheckpointObserver**          | `onStepEnd`, `onStreamEnd`   | State checkpoint persistence to SQLite                    | always active |
| **ReflectionObserver**          | `onStepEnd`                  | Output quality critique → revise loop via handoff         | standard      |
| **SubconsciousInsightObserver** | `onStreamStart`              | Injects background insights from harness SubconsciousLoop | standard+     |
| **ContentGuardObserver**        | `onUserInput`, `onStreamEnd` | Input injection detection + output content flagging       | config        |
| **BlackboardObserver**          | `onStepEnd`                  | Cross-agent shared state via EventBus                     | config        |
| **StepEventObserver**           | `onStepEnd`, `onToolCall`    | Per-step event recording to SQLite                        | config        |
| **ProcessIdentityObserver**     | `onStepEnd`                  | PIS drift detection (log_only or intervene)               | enhanced      |
| **JudgeObserver**               | `onStreamEnd`                | LLM-as-Judge automated scoring (sampled)                  | enhanced      |
| **AutoReplanObserver**          | `onToolResult`, `onStepEnd`  | Tool error pattern analysis → re-plan via handoff         | enhanced      |
| **SelfConsistencyObserver**     | lifecycle wrapper            | Exposes SelfConsistencyEngine for high-stakes sampling    | full          |

Preset levels: `minimal` → `standard` (default) → `enhanced` → `full`. Observers communicate via mutable `AgentExecutionContext` and return values (`blocked`, `handoff`). Errors in one observer never halt the pipeline.

## Content Guardrails (P0-2)

The `ContentGuardObserver` provides two-layer input/output safety filtering:

### Layer 1 — Regex Rules (zero latency)

- **Input**: 10 injection detection patterns (jailbreak, role-playing, system prompt extraction)
- **Output**: API key/token leakage, self-harm content, hate speech keywords

### Layer 2 — LLM Classifier (optional, configurable)

- Uses haiku for cost efficiency
- Triggered only when Layer 1 is uncertain

Blocked input returns `[BLOCKED]` and prevents LLM invocation entirely (zero token waste). Flagged output is marked with `[CONTENT FLAGGED]` prefix but still delivered — the framework never silently drops content.

## Reflection (P0-1)

The `ReflectionObserver` implements a critique→revise closed loop:

1. Agent produces a final answer (no tool calls in current step)
2. Observer invokes a lightweight LLM (haiku) to score output quality (0–100)
3. If score < threshold (default 70): critique is injected as a user message, loop continues via handoff
4. Agent sees the critique and revises its answer, potentially calling additional tools
5. Repeats up to `maxRounds` (default 2) or until quality threshold is met

## LLM-as-Judge (P0-3)

The `JudgeObserver` performs automated output quality evaluation after each agent session:

- **Scoring dimensions**: accuracy, completeness, helpfulness, safety, overall (0–100 each)
- **Verdict**: `pass` (≥70), `review` (50–69), `fail` (<50)
- **Cost controls**: sampled at `sampleRate` (default 10%), filtered by task type, forced haiku model

## Observability

Every agent run produces metrics:

- **Token usage** — input/output breakdown per model
- **Tool calls** — count, success/failure rate, latency
- **Cost** — tracked per call, aggregated per session/day/week/month
- **Quality score** — Harness evaluator rating + Judge verdict (if enabled)

Metrics are exposed via the `/api/observability` endpoints and displayed in the Dashboard. The background `SubconsciousLoop` (harness layer) periodically samples LTM, expands the knowledge graph, and publishes insights that agents can consume through `SubconsciousInsightObserver`.
