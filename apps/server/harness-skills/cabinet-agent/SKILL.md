# Cabinet Agent Protocol

You are running as an external agent within the **Cabinet AI orchestration framework**. This document explains how Cabinet works and how to communicate with it effectively.

## What is Cabinet?

Cabinet is an AI orchestration layer that coordinates multiple AI agents (like you) to work together on complex software projects. Cabinet handles:

- **Task routing**: Dispatching work to the right agent based on capability
- **Context management**: Providing project context, memories, and file references
- **Result aggregation**: Collecting outputs from agents and routing them back to users
- **Lifecycle management**: Monitoring agent health, retrying failures, managing workspaces

## How Tasks Arrive

Tasks arrive in one of three ways:

1. **User request via Secretary** — A user asks Cabinet's Secretary agent to do something; Secretary routes it to you
2. **Workflow node** — A Cabinet Workflow includes an `agentGroup` or `externalAgent` node pointing to you
3. **Autopilot trigger** — A cron schedule or webhook fires and creates a task for you

Each task includes:
- `task_id`: Unique identifier for this task
- `input`: The actual work to do (string or structured object)
- `slot`: Context from Cabinet — project info, memories, file references, security settings
- `configuration`: Timeout, retry limits, working directory

## Output Protocol

### Discovery Marker (intermediate findings)

While working, report interesting findings using the discovery marker format:

```
===CABINET_DISCOVERY===
{"type": "bug_found", "summary": "Null pointer in auth.ts:42", "severity": "high"}
===END_DISCOVERY===
```

Valid discovery types: `bug_found`, `insight`, `decision_point`, `progress_update`, `question`, `warning`

### Deliverable Marker (final result)

When the task is complete, wrap your final deliverable:

```
===CABINET_DELIVERABLE===
<your final code, report, analysis, or result here>
===END_DELIVERABLE===
```

Cabinet will parse the content between these markers as your final output and route it back to the user or next workflow node.

## Context Slot

The `slot` object in each task contains Cabinet's understanding of the current context:

```json
{
  "project": {
    "name": "MyProject",
    "tech_stack": "TypeScript, React, Node.js",
    "goals": ["Build a dashboard", "Improve performance"]
  },
  "memories": ["User prefers functional components", "API uses JWT auth"],
  "files": ["src/App.tsx", "src/api/client.ts"],
  "security": {
    "level": "moderate",
    "maxRetries": 3
  },
  "preferences": {
    "riskTolerance": "moderate",
    "preferredDecisionStyle": "autonomous"
  }
}
```

Use this context to tailor your approach — it represents what Cabinet knows about the current project and user.

## Workspace

Cabinet provides an isolated workspace directory for each task. All file operations should happen within this workspace. The path is available in `configuration.working_directory`.

## Best Practices

1. **Read before writing** — Check existing files before creating or modifying
2. **Report progress** — Use discovery markers for significant findings or milestones
3. **Be specific** — Include file paths and line numbers in discoveries
4. **Handle errors** — If something fails, explain what went wrong and suggest next steps
5. **Respect constraints** — Honor the security level, timeout, and retry limits
6. **Clean up** — Don't leave temporary files in the workspace unless they're part of the deliverable

## Communication Flow

```
Cabinet Server                    You (External Agent)
     │                                    │
     ├─── Task dispatch ─────────────────>│
     │    (task_id, input, slot, config)   │
     │                                    │
     │<── Discovery markers ──────────────┤
     │    (intermediate findings)          │
     │                                    │
     │<── Deliverable marker ─────────────┤
     │    (final result)                   │
     │                                    │
     ├─── Task status update ────────────>│
     │    (completed / failed)             │
```

## Available Information

When a task is dispatched to you, the prompt includes:
- The task description
- Project context (name, tech stack, goals)
- Relevant memories from Cabinet's knowledge base
- Recently accessed files
- Security constraints and user preferences
- Working directory path

## Questions?

If a task is ambiguous or you need clarification, use a discovery marker with type `question`:

```
===CABINET_DISCOVERY===
{"type": "question", "summary": "Should I use React Context or Redux for state management? The task doesn't specify."}
===END_DISCOVERY===
```

Cabinet will route your question back to the user or the coordinating agent.
