# Agent System

Cabinet's agent architecture is designed around a single principle: **the model drives, the framework executes**. The framework provides memory, tools, safety checks, and observability — but the LLM decides what to do next.

## Graph Execution Engine

Every AI Employee runs inside an `AgentLoop` that compiles to a **StateGraph** — a directed graph with typed state, checkpoint persistence, and streaming events:

```
buildContext → callLLM → evaluate → safetyCheck → executeTools → feedback
                                                ↘ (blocked) → buildContext
```

Each node is a pure function `(state) => Partial<state>`. After every node, the graph auto-saves a checkpoint to SQLite, enabling **time travel** — resume execution from any historical checkpoint.

The `StateGraph` engine (`@cabinet/graph`) provides:
- **Compile-time validation** — 6-pass check (reachability, cycles, conditional completeness, state compatibility)
- **Streaming** — `stream(initialState)` emits per-node events for real-time UI updates
- **Time travel** — `getRunHistory(runId)` + `resume(runId, state)` for debugging and recovery
- **Conditional routing** — nodes can dynamically branch to different targets based on state

The graph engine also powers `WorkflowEngine` and multi-agent orchestration via `createAgentNodeFactory`.

## Agent Roles

Cabinet defines several built-in roles, each with a `modules: { identity, workflow? }` definition that the Prompt Assembler composes at runtime:

| Role | Purpose | Default Tier |
| :--- | :------ | :----------- |
| **secretary** | Front-door agent; intent parsing, routing, greeting | `default` |
| **meeting_chair** | Orchestrates multi-agent meetings | `fast_execution` |
| **curator** | Memory consolidation, knowledge graph maintenance | `fast_execution` |
| **organize** | Organization architect; workflow/agent/skill/MCP design | `deep_reasoning` |
| **reviewer** | Output quality review, cross-validation | `fast_execution` |

Roles are registered in `AgentRoleRegistry` (`@cabinet/agent`). Custom roles can be added at runtime via the `AgentCreator` flow or `register_agent` tool.

## Intent Routing

When the Secretary receives input, it classifies the intent and dispatches to the appropriate specialist. Routing uses the LLM's native classification rather than a separate `IntentParser` component:

```
User Input
    │
    ▼
Secretary (LLM-native intent classification)
    │
    ├─► Direct response (simple query, greeting)
    ├─► Decision needed → create_decision → DecisionService
    ├─► Meeting needed → start_meeting → MeetingChair
    ├─► Workflow needed → create_workflow → WorkflowEngine
    └─► Specialist needed → invoke_agent → target agent
```

For multi-agent workflows, `createAgentNodeFactory` wraps agents as graph nodes with structured `AgentHandoff` for inter-agent data transfer.

## Safety Architecture

Before any tool executes, it passes through a **4-tier safety check**:

### Tier 1: Cache Rules

Hard-coded deny/allow lists for known-safe and known-dangerous operations. Fastest path; no LLM cost.

### Tier 2: Auto Mode

If the system is in `T3 FullAutonomy` delegation tier and the tool is classified as low-risk, auto-approve.

### Tier 3: Whitelist

Check if the tool is in the Employee's `allowedTools` list. If not, block immediately.

### Tier 4: AI Classifier

For ambiguous cases, a lightweight LLM call classifies the operation risk. If uncertain, default to **deny** and escalate to Captain.

## Context Management

### ContextBuilder

Assembles the message list sent to the LLM by combining:

- **System prompt** — composed at runtime by `assemblePrompt()` from: shared rules (`[HARD]` constraints + guidelines) → role identity → auto-generated tool list (from `ToolExecutor.getToolDescriptors()`) → workflow instructions → dynamic context
- Entity memory (Captain preferences, employee configs)
- Project memory (goals, milestones, recent decisions)
- Short-term memory (current session messages)
- Relevant long-term memories (semantic search)

### Prompt Assembler

The `assemblePrompt()` function replaces static system prompt strings with modular composition. Its key benefits:
- **No tool list drift** — tools are enumerated from the live `ToolExecutor`, never hand-written
- **Constraint grading** — `[HARD]` rules separated from soft Guidelines
- **Shared rules deduplicated** — constraints common to all roles live in `SHARED_PROMPT` once, not repeated 5 times

### ContextMonitor

Tracks token usage in real time and classifies the session into zones:

| Zone | Usage | Action |
| :--- | :---- | :----- |
| **Smart** | <40% | Normal operation |
| **Warning** | 40-60% | Begin summarizing older messages |
| **Critical** | 60-80% | Aggressive pruning; trigger consolidation |
| **Dumb** | >80% | Halt new tool calls; request user direction |

### Context Handoff

When routing between agents (e.g., Secretary → Meeting Chair), the `ContextHandoff` serializes the current state into a `HandoffState` and passes it to the target agent. This preserves continuity without leaking unrelated context.

## Tool System

Tools are the agent's hands. They are registered in a `ToolRegistry` and invoked by name. The `ToolExecutor` auto-generates a tool list for the prompt at runtime via `getToolDescriptors()`, eliminating drift between what the prompt says and what the agent can actually call.

### Built-in Tools

The `createCabinetTools` function registers 50+ system tools across categories:

- **Memory** — `remember`, `recall`, `search_memory`, `write_memory`
- **Decisions** — `create_decision`, `query_decisions`, `get_decision`, `approve_decision`, `reject_decision`
- **Workflows** — `create_workflow`, `run_workflow`, `list_workflows`, `get_workflow`
- **Files** — `read_file`, `write_file`, `edit_file`, `list_directory`, `glob`, `grep`
- **Meetings** — `start_meeting`, `get_meeting_status`
- **Projects** — `get_project_context`, `update_project_summary`, `add_milestone`
- **Web** — `web_fetch`, `http_request`
- **Shell** — `execute_command`
- **System** — `query_system_knowledge`, `get_system_knowledge`, `get_status`
- **Scheduler** — `schedule_task`, `cancel_scheduled_task`
- **Skills** — `use_skill`, `update_skill`, `list_skills`
- **Agents** — `register_agent`, `update_agent`, `list_agents`
- **Evaluation** — `evaluate`

### Skill Tools

Skills are loaded from `SKILL.md` files and converted into callable tools. The `SkillRegistry` indexes them by name and capability tags.

### MCP Tools

External capabilities via Model Context Protocol (MCP) servers are registered via `registerMCPTools`. These appear as ordinary tools to the agent but execute in external processes.

### Built-in Skills

Four system skills provide guided design assistants, invoked via `use_skill__*` tools:

| Skill | Purpose |
| :---- | :------ |
| **workflowDesigner** | Guides workflow node selection and process design |
| **agentCreator** | Validates and guides custom agent configuration |
| **skillCreator** | Generates standard `SKILL.md` format definitions |
| **mcpBuilder** | Assists with MCP server development |

## Interactive Sub-Agents

The `InteractiveSubAgent` system enables multi-turn agent sessions with dedicated state and mid-flight user input:

- **Session isolation** — each sub-agent has its own message history and checkpoint
- **Event-driven synchronization** — state changes broadcast via `AgentEventBus` to parent agents and UI
- **Mid-flight input** — users can interject during long-running sub-agent tasks without losing context
- **Deliverable tracking** — sub-agents produce structured deliverables that feed back into the main conversation

Use cases include deep research sessions, iterative code generation, and multi-step workflow design where the Captain needs to course-correct along the way.

## Agent Dispatcher

The `AgentDispatcher` supports three execution modes:

- **Pipeline** — Sequential steps, output of step N feeds into step N+1
- **Parallel** — Multiple agents run simultaneously, results merged
- **Single** — One agent, one task (default)

The GAN (Generator-Adversarial-Network) pipeline has been removed in favor of simpler, more transparent patterns.

## Observability

Every agent run produces metrics:

- **Token usage** — input/output breakdown per model
- **Tool calls** — count, success/failure rate, latency
- **Cost** — tracked per call, aggregated per session/day/week/month
- **Quality score** — Harness evaluator rating (if enabled)

Metrics are exposed via the `/api/observability` endpoints and displayed in the Dashboard.
