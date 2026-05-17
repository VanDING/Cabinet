# Core Concepts

Cabinet is a multi-agent AI collaboration framework structured like a government cabinet. The human "Captain" makes decisions; AI agents handle execution, deliberation, and memory.

## The Captain Model

**The Captain does one thing: decide.**

Cabinet is designed for "super individuals" — people who operate at the scale of a small company. The system orchestrates a team of AI agents, each with specialized roles, reporting to you as the decision-maker.

## System Architecture

```
Captain (Human)
    │
    ▼
Secretary ─── Intent Parser ─── Agent Dispatcher
    │               │                  │
    ├─ Decision Analyst          ──┐
    ├─ Meeting Chair             ──┤
    ├─ Workflow Designer         ──┤── Tool Execution
    ├─ Curator                   ──┤
    └─ Agent Creator             ──┘
         │
         ▼
    4-Layer Memory ── Events ── SQLite Storage
```

## Key Terms

| Term | Definition |
|---|---|
| **Captain** | The human decision-maker |
| **Secretary** | Natural language entry point that routes intent to specialist agents |
| **Decision** | A structured choice with options, classified L0-L3 by autonomy level |
| **Meeting** | Multi-agent debate with parallel reasoning and cross-validation |
| **Workflow** | Declarative pipeline of agent steps with human approval nodes |
| **Memory** | Four-layer persistence: short-term, long-term, entity, project |
