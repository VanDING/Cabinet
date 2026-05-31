# Core Concepts

Cabinet is built around a small set of powerful primitives. Understanding these concepts is essential for using the system effectively.

## The Captain

You are the **Captain** — the sole human decision-maker in the system. Cabinet's entire design is oriented toward minimizing the decisions you must make, while ensuring you retain full authority over the ones that matter.

The system does not ask "Should I do this?" for every action. Instead, it classifies decisions into four levels ([L0-L3](./decisions)) and only surfaces the ones that cross your configured threshold.

## Organization & Project

| Primitive | Description |
| :-------- | :---------- |
| **Organization** | Your "one-person company" instance. Top-level namespace. |
| **Project** | A container around a specific business goal. All work — decisions, meetings, workflows, memory — is scoped to a project. |

Projects have a `rootPath` that points to a folder on disk. This enables file-system-aware operations: reading code, writing output, indexing documents.

## Employee

An **Employee** is a configurable unit of work. It has two forms:

- **AI Employee** — An `AgentLoop` with a system prompt, model configuration, and allowed tools
- **Human Employee** — A placeholder for human collaborators, with expected turnaround time and escalation rules

Employees belong to a project and have a `permissionLevel`: `read`, `write`, or `admin`.

## Skill

A **Skill** is an atomic capability unit defined by a `SKILL.md` file. It specifies:

- Name, description, and version
- Input/output schemas
- Prompt template or tool implementation
- Dependencies on other skills

Skills move through a lifecycle: `draft` → `active` → `deprecated`. The `SkillRegistry` allows runtime discovery and invocation.

## Workflow

A **Workflow** is a directed graph of nodes executed by the `WorkflowEngine`. Nodes can be:

- **Flow control**: `start`, `end`, `ifElse`, `loop`, `parallel`, `merge`, `pass`
- **Execution**: `llm`, `skill`, `tool`, `code`, `workflow` (nested)
- **AI**: `intentClassify`, `knowledgeBase`
- **Human-in-the-loop**: `approval`, `human`
- **Container**: `agentGroup`

Workflows declare required **capabilities** (`files`, `web`, `shell`, `scheduler`, `knowledge`, `evaluation`). The system injects only the requested dependencies, creating a sandbox for each run.

## Decision

A **Decision** is an immutable record of a choice point. It carries:

- Type (`strategic`, `action`, `execution`, `anomaly`, `evolution`)
- Level (`L0`, `L1`, `L2`, `L3`)
- Status (`pending`, `approved`, `rejected`, `expired`, `archived`)
- Options with impact analysis
- Full audit trail

Decisions are the bridge between AI execution and human judgment. See [Decision L0-L3](./decisions) for the full classification system.

## Memory

Cabinet uses a **4-layer memory system** that separates hot data from cold knowledge:

| Layer | Purpose | Storage |
| :---- | :------ | :------ |
| **Short-term** | Current session context | In-memory + SQLite |
| **Long-term** | Cross-session semantic retrieval | SQLite + HNSW (hnswlib-node) |
| **Entity** | Captain preferences, employee configs | SQLite |
| **Project** | Project goals, milestones, key decisions | SQLite |

A background **ConsolidationService** periodically migrates information from short-term to long-term, removes duplicates, and extracts structured knowledge into the **KnowledgeGraph**.

## Agent System

Cabinet's agents follow a **TAOR** loop: **T**hink (build context) → **A**ct (call LLM) → **O**bserve (execute tools) → **R**epeat.

The framework is model-driven: the LLM decides what to do next; the framework provides execution, safety checks, and memory. See [Agent System](./agents) for roles, routing, and safety architecture.

## Meeting

A **Meeting** is a structured multi-agent deliberation with a four-phase protocol:

1. **Chair** — receives the topic, parses intent, selects advisors, constructs a structured Brief
2. **Advisor** — advisors perform parallel reasoning on their domain based on the Brief
3. **Reviewer** — independent quality review of all Advisor outputs for logic, evidence, and risks
4. **Extraction** — consensus, minority report, and unresolved分歧 are extracted into a final deliverable

A **cost estimate** is produced before phase 2; if it exceeds the threshold, Captain confirmation is required.

Meetings are not chat rooms. They are bounded, cost-transparent reasoning sessions.
