# Agent Capability Comparison — Market vs Cabinet

> Compiled 2026-06-24 for Cabinet V2.0 strategic planning.

---

## 1. Coding Agents — Agent Roles Comparison

### 1.1 Claude Code

| Agent / Role                       | Type                        | Model              | Tools                           | Purpose                                                  |
| ---------------------------------- | --------------------------- | ------------------ | ------------------------------- | -------------------------------------------------------- |
| **Explore**                        | Built-in subagent           | Haiku              | Read-only (no Write/Edit)       | Fast codebase search & analysis                          |
| **Plan**                           | Built-in subagent           | Inherits from main | Read-only                       | Codebase research for plan mode                          |
| **General-purpose**                | Built-in subagent           | Inherits from main | All tools                       | Complex multi-step tasks                                 |
| **statusline-setup**               | Built-in subagent           | Sonnet             | Specific                        | Configures statusline                                    |
| **claude-code-guide**              | Built-in subagent           | Haiku              | Specific                        | Answers feature questions                                |
| **Custom subagents**               | User/Project/Plugin-defined | Configurable       | Configurable allowlist/denylist | Specialized reusable roles                               |
| **Agent Teams (lead + teammates)** | Multi-session               | Configurable       | Full sessions                   | Parallel independent sessions with inter-agent messaging |
| **Agent SDK**                      | Programmatic                | Configurable       | Full control                    | Custom agents with full orchestration                    |

**Key patterns**: Hierarchical delegation (lead → subagent), automatic discovery via descriptions, model tier routing (Haiku for fast, Sonnet/Opus for complex), fork/background execution, persistent memory per subagent.

### 1.2 Cursor

| Agent / Role             | Type                     | Notes                                               |
| ------------------------ | ------------------------ | --------------------------------------------------- |
| **Agent Mode**           | Unified coding agent     | Full codebase awareness, tool use, multi-file edits |
| **Agent in Chat**        | Chat-embedded agent      | @-mention to invoke agent for specific tasks        |
| **Rules (.cursorrules)** | Behavioral configuration | Not agents, but configures agent behavior           |

**Key patterns**: Single unified agent with mode switching (ask vs edit), inline @-mentions for context injection. No explicit multi-agent or subagent system.

### 1.3 GitHub Copilot

| Agent / Role           | Type                    | Notes                                                |
| ---------------------- | ----------------------- | ---------------------------------------------------- |
| **Copilot Chat**       | Conversational agent    | Q&A, explain, fix, generate                          |
| **Agent Mode**         | Autonomous coding agent | Workspace-aware, multi-file edits, terminal commands |
| **Inline suggestions** | Completion agent        | Real-time code completion                            |
| **Copilot Extensions** | External tool agents    | MCP-like integration with external services          |
| **Code Review agent**  | Automated reviewer      | PR-level automated code review                       |

**Key patterns**: Graduated autonomy (inline → chat → agent), workspace-scoped, GitHub ecosystem integration.

### 1.4 Aider

| Agent / Role       | Type                     | Notes                                                                                 |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| **Code Mode**      | Single agent             | Makes file edits directly                                                             |
| **Ask Mode**       | Single agent (read-only) | Discusses code, never modifies                                                        |
| **Architect Mode** | Two-agent pattern        | **Architect** (plans changes) → **Editor** (applies edits); different models per role |
| **Help Mode**      | Single agent             | Answers questions about Aider itself                                                  |

**Key patterns**: The **Architect/Editor split** is Aider's signature — separate LLMs for reasoning vs execution. Model tier routing is explicit (e.g., o1 as architect, Sonnet as editor).

### 1.5 OpenCode

| Agent / Role | Type            | Notes                                                       |
| ------------ | --------------- | ----------------------------------------------------------- |
| **build**    | Default agent   | Full-access development agent                               |
| **plan**     | Read-only agent | Analysis & code exploration, no edits                       |
| **general**  | Subagent        | Complex searches & multi-step tasks, invoked via `@general` |

**Key patterns**: Tab-switch between agents, `@mention` subagent invocation, read-only guardrails on plan agent.

### 1.6 Cline

| Agent / Role                  | Type                 | Notes                                                                 |
| ----------------------------- | -------------------- | --------------------------------------------------------------------- |
| **Plan Mode**                 | Behavioral mode      | Codebase exploration, asks clarifying questions                       |
| **Act Mode**                  | Behavioral mode      | Executes plans with human-in-the-loop approval                        |
| **Coordinator + Specialists** | Multi-agent team     | Coordinator breaks work into subtasks, delegates to specialists       |
| **Scheduled Agents**          | Recurring automation | Cron-based agents for PR summaries, dependency checks, health reports |
| **Messaging Connectors**      | Channel agents       | Telegram, Slack, Discord, Google Chat, WhatsApp, Linear               |
| **SDK Agent**                 | Programmatic         | `@cline/sdk` for custom agent building                                |

**Key patterns**: Plan/Act toggle (stateful between messages), Kanban for parallel multi-agent work, scheduled cron agents, messaging platform integration.

---

## 2. Workflow/Automation Agents

### 2.1 CrewAI

| Agent / Role                               | Type                      | Notes                                              |
| ------------------------------------------ | ------------------------- | -------------------------------------------------- |
| **Any role via `role`/`goal`/`backstory`** | Configurable agent        | No built-in archetypes; all agents defined by user |
| **Researcher** (example)                   | Typical user-defined role | Gathers & analyzes information                     |
| **Writer** (example)                       | Typical user-defined role | Creates content                                    |
| **Reporting Analyst** (example)            | Typical user-defined role | Produces reports                                   |
| **Crew (multi-agent team)**                | Orchestration container   | Sequential or hierarchical process                 |

**Agent attributes**: `allow_delegation`, `reasoning`, `memory`, `tools`, `max_iter`, `max_execution_time`, `respect_context_window`, `allow_code_execution`.

**Key patterns**: Role-based agents with crew orchestration, delegation between agents, hierarchical process mode (manager agent assigns tasks).

### 2.2 AutoGen

| Agent / Role              | Type                    | Notes                                                            |
| ------------------------- | ----------------------- | ---------------------------------------------------------------- |
| **AssistantAgent**        | General-purpose         | LLM-powered with tools                                           |
| **UserProxyAgent** (v0.2) | Human-in-the-loop proxy | Executes code, proxies user input                                |
| **RoundRobinGroupChat**   | Team pattern            | Sequential round-robin agent conversation                        |
| **SelectorGroupChat**     | Team pattern            | Centralized selector routes to correct agent                     |
| **Swarm**                 | Team pattern            | Tool-based handoffs between agents                               |
| **Magentic-One**          | Pre-built multi-agent   | Orchestrator + WebSurfer + FileSurfer + Coder + ComputerTerminal |
| **Custom Agents**         | Programmatic            | Full control via `autogen-core` events                           |

**Magentic-One specialized roles**: **Orchestrator** (lead, plans & dispatches), **WebSurfer** (browser agent), **FileSurfer** (file system agent), **Coder** (writes code), **ComputerTerminal** (executes shell commands).

**Key patterns**: Event-driven agent communication, multiple team topologies (round-robin, selector, swarm, graph), pre-built specialist agents in Magentic-One.

### 2.3 LangChain / LangGraph

| Pattern                | Notes                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| **create_agent**       | Minimal harness = model + tools + prompt + middleware                             |
| **Deep Agents**        | Batteries-included: context compression, virtual filesystem, subagent spawning    |
| **LangGraph**          | Low-level orchestration: state graphs, conditional edges, HITL, durable execution |
| **Tool-calling Agent** | Standard ReAct pattern                                                            |
| **Supervisor Agent**   | Routes to specialized sub-agents                                                  |
| **Hierarchical Agent** | Supervisor delegates to teams of workers                                          |

**Key patterns**: Middleware-based extensibility (guardrails, retries, routing), no preset agent roles — everything composed from primitives, LangGraph for deterministic + agentic hybrid workflows.

### 2.4 Microsoft Copilot Studio

| Agent / Role                  | Notes                                                 |
| ----------------------------- | ----------------------------------------------------- |
| **Custom agents**             | Visual builder, topic-based conversation design       |
| **Child agents**              | Nested agents for delegation (parent → child)         |
| **Agent flows**               | Natural language defined workflows                    |
| **MCP agents**                | Agents extended via Model Context Protocol            |
| **Voice agents**              | IVR-integrated conversation agents                    |
| **Knowledge-grounded agents** | Agents with SharePoint/file/website knowledge sources |

**Key patterns**: Low-code visual builder, parent-child agent hierarchy, enterprise connectors, Microsoft 365 ecosystem integration.

---

## 3. Multi-Agent System — Common Specialization Patterns

### Consolidated Archetype Taxonomy

| #   | Archetype                         | Description                                                        | Who Has It                                                                                                                               |
| --- | --------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Orchestrator / Dispatcher**     | Routes tasks to specialists, manages workflow, synthesizes results | Claude Code (lead agent), AutoGen (SelectorGroupChat, Swarm), CrewAI (hierarchical process), LangGraph (supervisor), Cline (coordinator) |
| 2   | **Planner / Architect**           | Researches, designs approach before execution                      | Claude Code (Plan subagent), Aider (Architect mode), Cline (Plan mode), OpenCode (plan agent)                                            |
| 3   | **Executor / Coder**              | Writes code, applies edits, modifies files                         | All coding agents (implicitly), Aider (Editor in architect mode), AutoGen (Coder in Magentic-One)                                        |
| 4   | **Explorer / Researcher**         | Searches codebase, gathers context, finds relevant files           | Claude Code (Explore subagent), AutoGen (WebSurfer, FileSurfer in Magentic-One), Cabinet (Researcher specialist)                         |
| 5   | **Reviewer / Critic**             | Reviews code, finds bugs, suggests improvements                    | Claude Code (custom subagents), GitHub Copilot (Code Review agent), CrewAI (user-defined reviewer role)                                  |
| 6   | **Tester**                        | Runs tests, validates output, checks regressions                   | User-defined in Claude Code/CrewAI, implicit in Cline (Plan/Act cycle)                                                                   |
| 7   | **Debugger**                      | Traces errors, isolates root causes                                | Claude Code (custom subagent), Cline (Act mode), user-defined in CrewAI                                                                  |
| 8   | **Documenter / Writer**           | Generates docs, reports, READMEs                                   | CrewAI (Writer role), Cabinet (Writer specialist), AutoGen (implicit)                                                                    |
| 9   | **Guard / Safety Checker**        | Validates outputs, blocks dangerous actions                        | Cabinet (SafetyCheckObserver, ContentGuardObserver — unique!), Claude Code (permissions/hooks)                                           |
| 10  | **Memory Curator**                | Summarizes sessions, consolidates knowledge                        | Cabinet (Curator role — unique!), Claude Code (auto-memory, agent memory), CrewAI (memory=True)                                          |
| 11  | **Front-door / Router**           | Entry point, intent parsing, triage                                | Cabinet (Secretary — unique as a named role!), Claude Code (implicit via description-based routing)                                      |
| 12  | **Organization Architect**        | Designs agent teams, workflows, quality gates                      | Cabinet (Organize — unique as a named role!), CrewAI (implicit via crew setup)                                                           |
| 13  | **Reflection / Self-improvement** | Critiques own output, triggers revision loop                       | Cabinet (ReflectionObserver), LangChain (middleware), Claude Code (implicit)                                                             |
| 14  | **Scheduled / Background Agent**  | Recurring automations, cron jobs                                   | Claude Code (Routines, scheduled tasks), Cline (scheduled agents)                                                                        |
| 15  | **Human-in-the-loop Proxy**       | Bridges AI decisions with human approval                           | AutoGen (UserProxyAgent v0.2), Cabinet (T0-T3 safety delegation), Cline (approval UI)                                                    |

---

## 4. Analysis: Table Stakes vs Differentiating

### Table Stakes (expected by users)

| Capability                               | Cabinet Status                                                |
| ---------------------------------------- | ------------------------------------------------------------- |
| Code-writing agent with tool use         | Has (Secretary via AgentLoop)                                 |
| Read-only analysis/plan mode             | Partial (no dedicated plan agent, Secretary does it)          |
| Multi-model support                      | Has (modelTier routing)                                       |
| File editing (read/write/edit/grep/glob) | Has (50+ internal tools)                                      |
| Git integration                          | Partial (no native git tools in tool list)                    |
| MCP support                              | Has (MCP manager + dynamic registration)                      |
| Custom instructions / project context    | Has (SHARED_PROMPT, identities, CLAUDE.md equivalent)         |
| Agent loop with multi-step execution     | Has (executeGenerator, maxSteps)                              |
| Sub-agent / delegation                   | Has (create_sub_agent, send_to_sub_agent, finalize_sub_agent) |
| Streaming output                         | Has (thinking, text, tool_call events)                        |

### Differentiating (Cabinet strengths)

| Capability                          | Notes                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| **Named agent roles**               | Secretary, Curator, Organize are explicit, named roles — no other product does this |
| **Intent routing pipeline**         | 4-layer pipeline (keyword → regex → embedding → LLM) for dispatch                   |
| **Safety delegation tiers (T0-T3)** | Granular tool-gating no other coding agent has                                      |
| **Observer Pipeline**               | Pluggable lifecycle hooks for safety, reflection, LLM-as-Judge, auto-replan         |
| **AgentDispatcher modes**           | Single, Pipeline, Parallel with result synthesis                                    |
| **External agent integration**      | Scanner/Installer/Projector for Claude Code, OpenCode, Aider, etc.                  |
| **Process Identity Score (PIS)**    | Drift detection unique to Cabinet                                                   |
| **Blackboard pattern**              | Cross-agent shared state via EventBus                                               |
| **SubconsciousLoop**                | Background LTM sampling + knowledge graph expansion                                 |
| **Skill system**                    | Loadable SKILL.md templates with built-in designers (workflow, agent, skill, MCP)   |
| **LLM-as-Judge**                    | Automated output scoring on 5 dimensions with pass/review/fail verdict              |
| **ReflectionObserver**              | Critique→revise closed loop for quality improvement                                 |

### Cabinet Gaps vs Market

| Gap                                               | Market Reference                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **No dedicated Plan agent**                       | Claude Code (Plan subagent), OpenCode (plan agent), Aider (ask mode), Cline (plan mode)       |
| **No dedicated Reviewer/QA agent**                | Claude Code (custom), Copilot (Code Review)                                                   |
| **No scheduled/background agents**                | Claude Code (Routines), Cline (scheduled agents)                                              |
| **No agent team messaging (lead↔teammate)**       | Claude Code (Agent Teams), Cline (multi-agent teams)                                          |
| **No messaging platform connectors**              | Cline (Slack, Telegram, Discord, etc.)                                                        |
| **No git-native tools**                           | Claude Code, Aider (auto-commit, PR creation)                                                 |
| **No Architect/Editor model split**               | Aider (different models for planning vs editing)                                              |
| **No visual agent builder**                       | CrewAI (AMP), Copilot Studio                                                                  |
| **Specialist agents are thin wrappers**           | Researcher/Analyst/Writer only differ by identity prompt, no tool restrictions or model tiers |
| **No web-browsing agent**                         | AutoGen (WebSurfer in Magentic-One)                                                           |
| **No human-in-the-loop UI** (beyond safety tiers) | Cline, Copilot Studio                                                                         |

---

## 5. Most Relevant Archetypes for Cabinet

For a **desktop AI framework aimed at software engineering teams**, these archetypes matter most:

### Priority 1 — Can't live without

| Archetype               | Market Precedent        | Cabinet Status                           |
| ----------------------- | ----------------------- | ---------------------------------------- |
| **Coder / Executor**    | Every product           | Has (Secretary via AgentLoop)            |
| **Planner**             | CC/OpenCode/Aider/Cline | **Gap** — needs dedicated Plan agent     |
| **Reviewer**            | CC/Copilot/Cline        | **Gap** — needs dedicated Reviewer agent |
| **Router / Dispatcher** | CC/AutoGen/LangGraph    | Has (Secretary + intent pipeline)        |
| **Safety Guard**        | CC (permissions)        | Has (ObserverPipeline T0-T3)             |

### Priority 2 — Team productivity multiplier

| Archetype                                  | Market Precedent                                   | Cabinet Status                               |
| ------------------------------------------ | -------------------------------------------------- | -------------------------------------------- |
| **Orchestrator** (multi-agent coordinator) | CC Agent Teams, AutoGen Magentic-One, Cline Kanban | Partial (AgentDispatcher, no team messaging) |
| **Debugger**                               | CC custom subagents                                | Can be done via Secretary, no dedicated role |
| **Reflection / Self-improvement**          | LC middleware, CC implicit                         | Has (ReflectionObserver)                     |
| **Memory Curator**                         | CC (auto-memory), CrewAI (memory)                  | Has (Curator) — a differentiator             |
| **Organization Architect**                 | CrewAI (crew setup), CC (implicit)                 | Has (Organize) — a differentiator            |

### Priority 3 — Nice to have

| Archetype                | Market Precedent               | Cabinet Status                                       |
| ------------------------ | ------------------------------ | ---------------------------------------------------- |
| **Tester**               | CC custom, Cline               | **Gap**                                              |
| **Documenter**           | CrewAI (Writer)                | Has (Writer specialist) — thin                       |
| **Scheduled Agent**      | CC Routines, Cline             | **Gap**                                              |
| **External Agent Proxy** | CC (MCP), Copilot (extensions) | Has (Scanner/Installer/Projector) — a differentiator |
| **Human-in-the-loop**    | AutoGen (UserProxy), Cline     | Partial (safety tiers only)                          |

---

## 6. Recommendations

### Immediate actions

1. **Flesh out specialist agents** — Give Researcher, Writer, Analyst tool subsets, model tiers, and context budgets (like Secretary/Curator/Organize have), not just identity prompts.
2. **Add a dedicated Plan agent** — Read-only agent for code exploration and design before execution. Follows OpenCode `plan` / Claude Code `Explore` pattern.
3. **Add a dedicated Reviewer agent** — Code review, bug finding, test quality assessment. A key gap vs market.
4. **Add git-native tools** — Table stakes that Cabinet currently lacks.

### Medium-term

5. **Agent team messaging** — Enable lead↔teammate direct communication (not just task delegation). Adopt Claude Code Agent Teams pattern.
6. **Architect/Editor model split** — Allow routing reasoning-heavy planning to one model and execution to a cheaper/faster model, like Aider.
7. **Scheduled agent support** — Cron-based recurring tasks for PR summaries, dependency checks, nightly reports.

### Differentiators to protect and double-down on

- Named agent roles (Secretary, Curator, Organize) — unique in market
- Safety delegation tiers (T0-T3) — unique in market
- ObserverPipeline — unique extensibility model
- External agent integration (Scanner/Installer/Projector) — unique capability
- Process Identity Score (PIS) drift detection — unique in market
