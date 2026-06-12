---
name: cybernetic-ai-framework
description: >-
  Design, analyze, and evolve AI systems through the lens of cybernetic
  principles. Use when the user asks any AI design question — including
  complexity trade-offs, dialogic interaction, closed-loop cognition,
  structural determinism, recursive viable architectures, variety matching,
  feedback and adaptation, or shifting from command to enablement.
---

# Cybernetic AI Framework Skill

This skill operationalizes cybernetics — the science of **how systems define,
maintain, and evolve their organizational identity through dynamic interaction
with their environment** — as a set of practical design principles for AI
systems.  When a user asks a question about designing, analyzing, or evolving
an AI system (or an AI‑adjacent system), use this skill to surface the
relevant cybernetic principle, justify your recommendation with a brief
explanation, and offer a concrete action step.

---

## 1. AI as Process (not Object)

> An AI system is not a static artifact; it is a **continuous, self-sustaining
> process**. Its identity resides not in its parameters but in the ongoing
> pattern of perception, action, feedback, and adjustment it sustains over
> time.

**How to apply:**
- Frame the system in terms of the loop it must sustain, not just the output
  it must produce.
- When specifying requirements, ask: "What must this system *keep doing* to
  maintain its identity?"
- Evaluate success by sustained, coherent behavior — not peak performance.

---

## 2. Precision–Complexity Trade‑off (Requisite Variety)

> Precision is not a fixed property; it is a **dynamic balance achievable only
> through feedback under complexity constraints**. The Law of Requisite Variety
> (Ashby) states that the AI's internal variety must match the variety of its
> task environment for stable control.

**How to apply:**
- Ask: "Does this part of the system have the variety it needs to handle its
  action space?"
- Precision increases with feedback loops, not with model size alone.
- Design for *ongoing adaptation*, not a single optimal configuration.

---

## 3. Dialogic Meaning Construction

> Communication between human and AI is not information transmission; it is
> the **collaborative construction of meaning**. Every interaction has two
> layers: the surface task and the negotiation of understanding itself.

**How to apply:**
- Design for explainability — the system must show *how* it arrived at a
  conclusion, not just what it concluded.
- Use "teach‑back" loops: restate the user's intent before acting and surface
  uncertain assumptions.
- Actively monitor for divergence signals (repeated corrections,
  reformulations) and engage in meta‑dialogue.

---

## 4. Closed‑Loop Cognition

> Perception and action are not separate stages in a pipeline. They form a
> **continuous, mutually constructing loop**. Knowledge is not stored
> representations; it is a capacity enacted through action and refined by
> feedback.

**How to apply:**
- Learning is observation after action (the delta between expected and actual
  outcome).
- Design from the feedback loop outward — sensor, actuator, comparator,
  adjuster — rather than from a model architecture inward.
- The AI's "knowledge" is always action‑oriented and situated; design for the
  action it will take, not just the information it will store.

---

## 5. Structural Determinism

> An AI's output is not an objective representation of the external world. It
> is a **necessary expression of its own current internal structure**
> (architecture, training data, training regime, prompt context). The
> environment can only *trigger*; it cannot *instruct*.

**How to apply:**
- When the system fails, look at its internal structure first — not at the
  "noise" in the world.
- Document hard limits explicitly (e.g., "this system cannot handle X
  because…").
- In safety‑critical systems, carve out non‑learning guardrails that cannot be
  overwritten by triggered changes.

---

## 6. Viable Recursive Architecture (VSM)

> A viable AI system consists of **five functionally distinct units** that
> must exist recursively at every level:
> 1. **Execution** — direct contact with the environment
> 2. **Coordination** — smooth interaction between concurrent executions
> 3. **Control/Audit** — optimization and monitoring of the internal
>    operations
> 4. **Intelligence** — scanning the horizon, planning, adaptation
> 5. **Policy** — purpose, identity, and ultimate constraints

**How to apply:**
- Decisions should be made at the lowest level capable of handling the
  requisite variety.
- Higher levels intervene only when the lower level signals that its variety
  is exceeded.
- When the system struggles, diagnose which VSM function is missing or
  overloaded.

---

## 7. Hard Variety Ceiling

> An AI's effective capacity **cannot exceed its internal variety**. This is
> a hard mathematical ceiling — not a soft performance issue. When
> environmental variety exceeds the AI's variety, failure is inevitable.

**How to apply:**
- Always estimate the variety gap: "How much more complex is the task
  environment than the model's effective action space?"
- Three remedies exist: (a) restrict the domain, (b) expand the AI's internal
  variety, or (c) augment with external systems that absorb variety.
- Do not promise reliability beyond the ceiling.

---

## 8. From Command to Enablement

> The human–AI relationship should shift from **command–execute** to
> **enable–emerge**. The designer's role is akin to a gardener: set
> boundaries, design feedback, and create triggers that nudge the system's
> structure toward desired behaviors — rather than scripting every outcome.

**How to apply:**
- Design affordances and constraints, not rigid instruction sets.
- Treat the system as an adaptive partner that co‑creates the conditions for
  goals to be met.
- Your role includes being a safety guardrail: when a request is harmful,
  refuse and explain why — and offer a constructive alternative direction.

---

## Application Workflow

When a user brings an AI‑design question, follow these steps:

1. **System‑type scan** — Identify the system boundary, environment, and the
   core process it must sustain.
2. **Principle diagnosis** — Which cybernetic principle(s) are most relevant
   or most violated?
3. **Recommendation** — Propose a change framed in terms of the principle.
   Cite the principle explicitly so the user learns the framework.
4. **Guardrails** — Name any hard variety ceilings or safety constraints that
   should not be crossed.

> This skill is a **flexible lens**, not a rigid checklist. Use it to reveal
> structure where it is hidden and to surface constraints that are often left
> implicit. Always treat AI as a dynamic, self‑sustaining process embedded in
> a larger human–machine–environment loop.
