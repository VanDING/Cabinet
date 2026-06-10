# Harness

Harness is Cabinet's **post-execution quality layer**. Unlike the Agent's `SafetyChecker` (which asks "can we do this?" before a tool runs), Harness asks **"was this done well?"** after the work is complete.

## Philosophy

AI systems generate output at high speed, but speed is not the same as quality. Harness sits between execution and delivery, ensuring that what reaches the Captain meets a baseline of rigor.

> **Safety says _can_. Harness says _good_. Workflow says _compatible_.**

## Components

### QualityGate

The central evaluator. Every significant agent output passes through the `QualityGate`, which checks for:

- **H-E-I format** — Hypothesis, Evidence, Impact structure
- **Logical completeness** — no unstated assumptions or missing steps
- **Risk assessment** — explicit acknowledgment of downsides
- **Factual grounding** — claims tied to verifiable sources

If quality is insufficient, the gate triggers a retry (up to 3 times). After 3 failures, the output is marked "low quality" but still delivered — Harness never blocks the pipeline, it only signals.

### Evaluator

An independent Agent that performs deep quality review on high-stakes outputs. Unlike the automated `QualityGate`, the `Evaluator` can:

- Verify claims against source files and documents
- Request additional analysis from specialist agents
- Produce structured pass/fail reports with actionable issues

### TeachBack

Before high-risk operations (deletion, financial transactions, permission changes), the system requires the AI to **teach back** its understanding of the goal. The Captain confirms or corrects before execution proceeds.

### ObservabilityCollector

Gathers session-level metrics:

- Token usage (input/output per model)
- Tool call success/failure rates
- Latency per operation
- Cost per call and aggregate per session/day/week/month

Metrics are stored in SQLite and exposed via `/api/observability` endpoints.

### AutoAdjuster

Monitors system performance and automatically tunes parameters:

- **Temperature** — lowered when precision matters, raised for creative tasks
- **Model selection** — upgraded for complex decisions, downgraded for routine tasks
- **Budget allocation** — shifted toward high-value workflows

The `applyAnalysisRecommendations(analysis: FailureAnalysis)` method accepts structured analysis from the `FailurePatternAnalyzer` and converts findings into `AdjustmentAction` objects — each with severity, Captain approval flag, and a description of the proposed change.

### FailurePatternAnalyzer (P1-7)

Analyzes historical tool execution data to identify systemic issues:

- **Data sources**: StepEventObserver's `step_events` table (preferred) or in-memory tool statistics (fallback)
- **Patterns detected**: failing tools ranked by error rate, error type distribution (timeout/permission/not_found/rate_limit/network), model-tier success rate correlation
- **Recommendations**: automatically generated suggestions — deprecate high-failure tools, increase timeout, check permissions, add retry logic

Integrated into the `SubconsciousLoop` (runs every 10 ticks) with results fed to `AutoAdjuster.applyAnalysisRecommendations()`.

### PreferenceLearner

Extracts patterns from Captain decisions to predict future preferences:

- Risk tolerance (conservative vs. aggressive)
- Decision style (data-heavy vs. intuition-driven)
- Attention patterns (which dimensions the Captain consistently weighs)

Learned preferences are stored in Entity Memory and inform future decision card generation.

### SubconsciousLoop

A background process that periodically reviews recent activity for hidden patterns:

- Contradictions between past and current decisions
- Emerging risks not flagged by active agents
- Opportunities for workflow optimization

Insights are surfaced as gentle nudges in the Dashboard, not interruptions.

### BrowserVerifier

For UI-dependent workflows, the `BrowserVerifier` performs visual regression checks:

- Screenshot comparison against baselines
- DOM structure validation
- Cross-browser consistency checks

### GarbageCollector

Identifies and cleans up orphaned data:

- Unreferenced decisions and workflows
- Expired sessions beyond retention limits
- Abandoned employee configurations

## Quality Feedback Loop

```
Agent Output
     │
     ▼
QualityGate ──► Pass ──► Deliver to Captain
     │
     ► Fail ──► Retry (up to 3)
     │
     ► 3x Fail ──► Mark "low quality" ──► Deliver + Notify
     │
     ► Consistent low quality ──► Escalation ──► Captain alert
```

## API Endpoints

- `POST /api/harness/evaluate` — manual quality evaluation
- `GET /api/observability/metrics` — system metrics
- `GET /api/observability/reports` — daily/weekly summaries
