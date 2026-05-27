# Decision Management

## L0-L3 Classification

Every decision is classified into one of four autonomy levels:

| Level  | Name     | Behavior                                                | Example               |
| ------ | -------- | ------------------------------------------------------- | --------------------- |
| **L0** | Auto     | Approved immediately                                    | File rename           |
| **L1** | Suggest  | Auto-approved within session, few options               | Choose model for task |
| **L2** | Review   | Requires Captain confirmation, cross-session impact     | Enter new market      |
| **L3** | Escalate | Must be approved — involves funds, permissions, or data | Delete project        |

## Decision Types

| Type        | Purpose                                   |
| ----------- | ----------------------------------------- |
| `strategic` | Long-term directional decisions           |
| `action`    | Concrete operational decisions            |
| `execution` | Implementation-level decisions            |
| `anomaly`   | Decisions triggered by detected anomalies |
| `evolution` | System self-improvement decisions         |

## State Machine

```
pending ──► approved
  │
  └──────► rejected
  │
  └──────► expired
  │
  └──────► archived
```

Terminal states: `approved`, `rejected`, `expired`, `archived`. Once in a terminal state, a decision cannot be re-opened.

## Audit Trail

Every decision lifecycle event is recorded:

- Creation (who, when, what options)
- Approval (who, when, chosen option)
- Rejection (who, when, reason)
- Expiry (automatic after configurable period)

The audit trail is queryable via `/api/decisions/:id/audit`.
