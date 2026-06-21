# Decision L0-L3

Decisions are the boundary between AI execution and human judgment. Cabinet classifies every decision into one of four levels, each with a distinct handling protocol.

## The Four Levels

| Level  | Name         | Trigger                                                                            | Handling                                             |
| :----- | :----------- | :--------------------------------------------------------------------------------- | :--------------------------------------------------- |
| **L0** | Auto-Execute | Single tool call, reversible, cost < ¥0.01                                         | Silent execution, logged only                        |
| **L1** | Auto-Decide  | Current session scope, ≤3 options, cost ≤ ¥0.10                                    | Auto-select best option, record in session summary   |
| **L2** | Confirm      | Cross-session or external system, >3 options, value trade-off, cost > ¥0.10        | Generate decision card, push to Captain for approval |
| **L3** | Escalate     | Org-level config, security boundary, funds/permissions/data deletion, cost > ¥1.00 | Halt execution, notify Captain through all channels  |

> **Currency**: Budget and cost thresholds are tracked in **RMB** (¥), not USD.

## Classification Algorithm

The `LevelClassifier` extracts features from the decision request and applies rules in priority order:

```
1. Extract features:
   - Impact scope (single call / session / cross-session / org)
   - Side-effect reversibility
   - Option count
   - Estimated cost
   - Entity types involved

2. Match rules (highest priority first):
   - Involves funds, permissions, data deletion, or org config → L3
   - Cross-session impact OR >3 options OR value trade-off OR cost > ¥0.10 → L2
   - Session scope AND ≤3 options AND cost ≤ ¥0.10 → L1
   - Single call AND reversible AND cost < ¥0.01 → L0

3. Uncertain? → Upgrade one level (better safe than sorry)
```

## Decision State Machine

```
         ┌─────────────────────────────────────────┐
         │                                         │
    ┌────▼────┐   approve    ┌─────────┐  archive  ┌──────────┐
    │ PENDING │─────────────►│APPROVED │──────────►│ ARCHIVED │
    └────┬────┘              └────┬────┘           └──────────┘
         │                        │
         │ reject                 │
         ▼                        │
    ┌─────────┐  archive          │
    │REJECTED │───────────────────┘
    └────┬────┘                   │
         │                        │
         │ re-open (to PENDING)   │
         └────────────────────────┘
         │
         │ expire (after 72h default)
         ▼
    ┌─────────┐  re-open (to PENDING)
    │ EXPIRED │───────────────────────┐
    └────┬────┘                       │
         │                            │
         │ archive                    │
         └────────────────────────────┘
```

**Key invariants**:

- `ARCHIVED` is terminal — no further transitions
- `REJECTED` and `EXPIRED` can return to `PENDING` (enables decision chains and reconsideration)
- All transitions are logged in the audit trail

## Decision Types

| Type          | Description                             | Example                                       |
| :------------ | :-------------------------------------- | :-------------------------------------------- |
| **Strategic** | Directional, long-term impact           | Enter a new market, pivot tech stack          |
| **Action**    | Concrete execution plan                 | Hire a contractor, purchase equipment         |
| **Execution** | Tactical, reversible                    | Run a specific workflow, delete a draft       |
| **Anomaly**   | Unexpected situation requiring judgment | Budget spike detected, contradiction found    |
| **Evolution** | System self-improvement                 | Propose a new agent role, adjust safety rules |

## Decision Card

When a decision reaches L2 or L3, the system generates a **Decision Card** containing:

- **Title** and description
- **Type** and **Level** badges
- **Options** with impact analysis (risk, cost, time, reversibility, strategic fit)
- **Dimensional bars** for visual comparison
- **Audit timeline** — full history from creation to resolution

Captain can:

- **Approve** — select an option and optionally add reasoning
- **Reject** — with optional feedback
- **Request Analysis** — trigger background `DecisionAnalysisService` for deeper evaluation

## Decision Chains

Decisions can be linked via `parentId`. When a rejected or expired decision is superseded by a new one, the chain preserves the full history of reconsideration. This is useful for:

- Iterative strategy refinement
- Re-evaluating decisions after new information
- Building a decision journal for organizational learning

## API Endpoints

See the [Decisions API](../api/decisions) for programmatic access to decision creation, querying, approval, and audit trails.
