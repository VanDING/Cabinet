# Agent System

Cabinet's agent architecture is designed around a single principle: **the model drives, the framework executes**. The framework provides memory, tools, safety checks, and observability — but the LLM decides what to do next.

## The TAOR Loop

Every AI Employee runs inside an `AgentLoop` that follows this cycle:

```
1. Build Context
   └─ Load from 4-layer memory, inject system prompt, add recent messages
2. Call LLM
   └─ Route through ModelRouter (role → model → fallback chain)
3. Evaluate Response
   └─ No tool calls → return result to caller
   └─ Tool calls present → proceed to step 4
4. Safety Check
   └─ Cache rules → Auto mode → Whitelist → AI classifier
   └─ Blocked → return error, do not execute
5. Execute Tools
   └─ ToolExecutor runs approved calls, returns structured results
6. Feed Back
   └─ Append tool results to context → return to step 2
```

The loop continues until the model produces a final answer or hits a safety/timeout boundary.

## Agent Roles

Cabinet defines several built-in roles, each with a specialized system prompt and default model tier:

| Role | Purpose | Default Tier |
| :--- | :------ | :----------- |
| **secretary** | Front-door agent; intent parsing, routing, greeting | `default` |
| **meeting_chair** | Orchestrates multi-agent meetings | `deep_think` |
| **curator** | Memory consolidation, knowledge graph maintenance | `deep_think` |
| **organize** | Project organization, file indexing, structure analysis | `default` |
| **reviewer** | Output quality review, cross-validation | `deep_think` |

Roles are registered in `AgentRoleRegistry` (`@cabinet/agent`). Custom roles can be added at runtime via the `AgentCreator` flow.

## Intent Routing

When the Secretary receives input, it parses the intent and routes to the appropriate specialist:

```
User Input
    │
    ▼
IntentParser ──► Structured intent (decision_request, meeting_request, query, task)
    │
    ├─► Confidence ≥ 0.5 ──► dispatchToSpecialist(role)
    │
    └─► Confidence < 0.5 ──► Suggest creating/importing a specialist agent
```

The `IntentParser` can operate in two modes:
- **LLM mode** (default) — uses a lightweight model to classify intent
- **Keyword fallback** — rule-based matching when LLM is unavailable

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

- System prompt (role-specific + environment section)
- Entity memory (Captain preferences, employee configs)
- Project memory (goals, milestones, recent decisions)
- Short-term memory (current session messages)
- Relevant long-term memories (semantic search)

### ContextMonitor

Tracks token usage in real time and classifies the session into zones:

| Zone | Usage | Action |
| :--- | :---- | :----- |
| **Smart** | <50% | Normal operation |
| **Warning** | 50-75% | Begin summarizing older messages |
| **Critical** | 75-90% | Aggressive pruning; trigger consolidation |
| **Dumb** | >90% | Halt new tool calls; request user direction |

### Context Handoff

When routing between agents (e.g., Secretary → Meeting Chair), the `ContextHandoff` serializes the current state into a `HandoffState` and passes it to the target agent. This preserves continuity without leaking unrelated context.

## Tool System

Tools are the agent's hands. They are registered in a `ToolRegistry` and invoked by name.

### Built-in Tools

The `createCabinetTools` function registers system tools including:

- Memory read/write (`remember`, `recall`)
- Decision creation (`create_decision`)
- Workflow management (`create_workflow`, `run_workflow`)
- File operations (`read_file`, `write_file`, `list_directory`)
- Meeting operations (`start_meeting`)
- Project queries (`get_project_summary`)

### Skill Tools

Skills are loaded from `SKILL.md` files and converted into callable tools. The `SkillRegistry` indexes them by name and capability tags.

### MCP Tools

External capabilities via Model Context Protocol (MCP) servers are registered via `registerMCPTools`. These appear as ordinary tools to the agent but execute in external processes.

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
