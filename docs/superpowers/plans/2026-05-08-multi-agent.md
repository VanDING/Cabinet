# Multi-Agent Collaboration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build parallel agent execution with result synthesis, upgrade HandoffManager with auto-routing, and extend debate from 2-party to N-party with voting.

**Architecture:** Three new/changed modules — ParallelExecutor (fan-out/fan-in with asyncio.gather + LLM synthesis), HandoffManager.auto_route (capability-based discovery + routing strategies), NPartyDebate (multi-position parallel debate with moderator voting).

**Tech Stack:** Python 3.12+, asyncio.gather, existing CapabilityRegistry + MailboxRouter

---

### Task 1: ParallelExecutor — Fan-Out/Fan-In Execution

**Files:**
- Create: `src/cabinet/agents/parallel.py`
- Create: `tests/unit/agents/test_parallel.py`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/agents/test_parallel.py`:

```python
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from cabinet.agents.parallel import ParallelExecutor, AgentTask, SynthesizedResult


def make_mock_agent(role: str, response: str):
    agent = MagicMock()
    agent.execute = AsyncMock(return_value=MagicMock(content=response, status="success"))
    return agent


def test_parallel_executes_all_agents():
    agents = [
        make_mock_agent("strategist", "We should invest in R&D"),
        make_mock_agent("executor", "I can implement the plan"),
    ]
    tasks = [
        AgentTask(agent=agents[0], task="Analyze strategy", role_label="strategist"),
        AgentTask(agent=agents[1], task="Plan execution", role_label="executor"),
    ]

    mock_gateway = MagicMock()
    mock_gateway.complete = AsyncMock(return_value=MagicMock(content="Synthesized summary"))

    executor = ParallelExecutor(mock_gateway)

    async def run():
        result = await executor.execute_parallel(tasks)
        assert len(result.individual_results) == 2
        assert result.summary == "Synthesized summary"
        assert agents[0].execute.called
        assert agents[1].execute.called

    asyncio.run(run())


def test_parallel_handles_agent_failure():
    agent_ok = make_mock_agent("ok", "Success")
    agent_fail = MagicMock()
    agent_fail.execute = AsyncMock(side_effect=RuntimeError("Boom"))

    tasks = [
        AgentTask(agent=agent_ok, task="Task 1", role_label="ok"),
        AgentTask(agent=agent_fail, task="Task 2", role_label="fail"),
    ]

    mock_gateway = MagicMock()
    mock_gateway.complete = AsyncMock(return_value=MagicMock(content="Partial summary"))

    executor = ParallelExecutor(mock_gateway)

    async def run():
        result = await executor.execute_parallel(tasks)
        assert len(result.individual_results) == 2
        # Failed agent should have error status
        statuses = [r["status"] for r in result.individual_results]
        assert "error" in statuses

    asyncio.run(run())


def test_parallel_handles_empty_tasks():
    mock_gateway = MagicMock()
    executor = ParallelExecutor(mock_gateway)

    async def run():
        result = await executor.execute_parallel([])
        assert result.individual_results == []

    asyncio.run(run())


def test_agent_task_fields():
    agent = make_mock_agent("test", "")
    task = AgentTask(agent=agent, task="Do something", role_label="tester")
    assert task.role_label == "tester"
    assert task.task == "Do something"


def test_synthesized_result_fields():
    result = SynthesizedResult(
        summary="Consensus reached",
        individual_results=[{"role": "a", "content": "yes"}],
        disagreements=["minor disagreement on timeline"],
    )
    assert result.summary == "Consensus reached"
    assert len(result.disagreements) == 1
```

Run: `pytest tests/unit/agents/test_parallel.py -v`
Expected: FAIL

- [ ] **Step 2: Implement ParallelExecutor**

Create `src/cabinet/agents/parallel.py`:

```python
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass
class AgentTask:
    agent: object  # BaseAgent
    task: str
    role_label: str = ""


@dataclass
class SynthesizedResult:
    summary: str
    individual_results: list[dict] = field(default_factory=list)
    consensus: str | None = None
    disagreements: list[str] = field(default_factory=list)


class ParallelExecutor:
    """Fan-out task to multiple agents concurrently, fan-in via LLM synthesis."""

    def __init__(self, synthesizer_gateway, model: str = "default"):
        self._gateway = synthesizer_gateway
        self._model = model

    async def execute_parallel(self, tasks: list[AgentTask]) -> SynthesizedResult:
        if not tasks:
            return SynthesizedResult(summary="", individual_results=[])

        async def _run(task: AgentTask) -> dict:
            try:
                output = await task.agent.execute(task.task, None)
                return {
                    "role": task.role_label,
                    "task": task.task,
                    "content": output.content if hasattr(output, 'content') else str(output),
                    "status": output.status if hasattr(output, 'status') else "success",
                }
            except Exception as e:
                return {
                    "role": task.role_label,
                    "task": task.task,
                    "content": str(e),
                    "status": "error",
                }

        raw = await asyncio.gather(*[_run(t) for t in tasks], return_exceptions=True)

        # Normalize any uncaught gather exceptions
        results = []
        for i, r in enumerate(raw):
            if isinstance(r, Exception):
                results.append({
                    "role": tasks[i].role_label,
                    "task": tasks[i].task,
                    "content": str(r),
                    "status": "error",
                })
            else:
                results.append(r)

        synthesis = await self._synthesize(results)
        synthesis.individual_results = results
        return synthesis

    async def _synthesize(self, results: list[dict]) -> SynthesizedResult:
        parts = []
        for r in results:
            parts.append(f"[{r['role']}] ({r['status']}): {r['content'][:300]}")

        response = await self._gateway.complete(
            messages=[{
                "role": "system",
                "content": "Synthesize the following agent outputs. Identify consensus points, note disagreements, and produce a unified summary. Be concise.",
            }, {
                "role": "user",
                "content": "Agent outputs:\n\n" + "\n\n".join(parts),
            }],
            model=self._model,
            temperature=0.3,
        )

        summary = response.content if hasattr(response, 'content') else str(response)
        disagreements = []
        if "disagree" in summary.lower() or "不同意" in summary:
            disagreements = ["Multiple viewpoints exist — see summary for details"]

        return SynthesizedResult(summary=summary, disagreements=disagreements)
```

- [ ] **Step 3: Run tests**

```bash
cd "e:/AI转型/项目实践/Cabinet/.worktrees/agent-multi"
pytest tests/unit/agents/test_parallel.py -v
```
Expected: 5 passed

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/agents/parallel.py tests/unit/agents/test_parallel.py
git commit -m "feat(agents): add ParallelExecutor for fan-out/fan-in agent execution"
```

---

### Task 2: HandoffManager — Auto-Route + Hooks

**Files:**
- Modify: `src/cabinet/agents/handoff.py`

- [ ] **Step 1: Read HandoffManager**

Read `src/cabinet/agents/handoff.py` fully.

- [ ] **Step 2: Append auto_route method and HandoffHooks**

Append to the `HandoffManager` class:

```python
    async def auto_route(
        self, task: str, from_agent_id: str,
        capability_registry,
        strategy: str = "least_loaded",
    ) -> object | None:
        """Auto-discover best target agent by capability and send handoff."""
        try:
            candidates = capability_registry.discover(query=task)
        except Exception:
            return None

        if not candidates:
            return None

        best = self._select_best(candidates, strategy)

        request = HandoffRequest(
            from_agent_id=from_agent_id,
            to_agent_id=best.get("agent_id", best.get("id", "")),
            task_description=task,
            context_snapshot={
                "task": task,
                "reason": best.get("match_reason", "auto-routed"),
                "strategy": strategy,
            },
            reason="expertise",
        )
        return await self.request_handoff(request)

    @staticmethod
    def _select_best(candidates: list, strategy: str) -> dict:
        """Select best candidate by routing strategy."""
        if not candidates:
            raise ValueError("No candidates")
        if strategy == "least_loaded":
            candidates = sorted(candidates, key=lambda c: c.get("current_load", 0) if isinstance(c, dict) else getattr(c, "load", 0))
        elif strategy == "highest_skill_match":
            candidates = sorted(candidates, key=lambda c: c.get("skill_count", 0) if isinstance(c, dict) else len(getattr(c, "skills", [])), reverse=True)
        return candidates[0]
```

Append at module level (after the HandoffManager class):

```python
from dataclasses import dataclass
from collections.abc import Callable, Awaitable


@dataclass
class HandoffHooks:
    """Lifecycle hooks for handoff operations."""
    before_handoff: Callable[..., Awaitable[None]] | None = None
    after_accept: Callable[..., Awaitable[None]] | None = None
    on_reject: Callable[..., Awaitable[None]] | None = None
    on_timeout: Callable[..., Awaitable[None]] | None = None
```

Update the `__init__` of `HandoffManager` to accept optional hooks:

```python
    def __init__(self, router, hooks: HandoffHooks | None = None):
        self._router = router
        self._hooks = hooks
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/unit/agents/ -q --tb=line 2>&1 | tail -3
```

Expected: all pass, no regressions

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/agents/handoff.py
git commit -m "feat(agents): add auto_route and HandoffHooks to HandoffManager"
```

---

### Task 3: NPartyDebate — Multi-Position Parallel Debate

**Files:**
- Modify: `src/cabinet/agents/debate.py`
- Create: `tests/unit/agents/test_nparty_debate.py`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/agents/test_nparty_debate.py`:

```python
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from cabinet.agents.debate import NPartyDebate, DebatePosition


def make_mock_agent(stance: str, response: str):
    agent = MagicMock()
    agent.execute = AsyncMock(return_value=MagicMock(content=response, status="success"))
    return agent


def test_nparty_debate_runs_all_positions():
    agents = [
        make_mock_agent("pro", "We should adopt this change"),
        make_mock_agent("con", "This is too risky"),
        make_mock_agent("neutral_critic", "Consider the middle ground"),
    ]
    positions = [
        DebatePosition(agent=agents[i], stance=agents[i].execute.call_args if False else ["pro", "con", "neutral_critic"][i])
        for i in range(3)
    ]
    # Fix: assign stances properly
    positions[0] = DebatePosition(agent=agents[0], stance="pro")
    positions[1] = DebatePosition(agent=agents[1], stance="con")
    positions[2] = DebatePosition(agent=agents[2], stance="neutral_critic")

    mock_gateway = MagicMock()
    mock_gateway.complete = AsyncMock(return_value=MagicMock(content="Debate concluded: adopt with caution"))

    debate = NPartyDebate(positions, mock_gateway, max_rounds=1)

    async def run():
        result = await debate.run("Should we migrate the database?")
        assert result.consensus is not None
        assert len(result.statements) > 0

    asyncio.run(run())


def test_debate_position_fields():
    agent = make_mock_agent("pro", "")
    pos = DebatePosition(agent=agent, stance="pro")
    assert pos.stance == "pro"


def test_nparty_needs_at_least_2():
    mock_gateway = MagicMock()
    pos = [DebatePosition(agent=make_mock_agent("pro", ""), stance="pro")]
    try:
        NPartyDebate(pos, mock_gateway)
        assert False, "Should have raised"
    except ValueError:
        pass
```

Run: `pytest tests/unit/agents/test_nparty_debate.py -v`
Expected: FAIL

- [ ] **Step 2: Read existing debate.py**

Read `src/cabinet/agents/debate.py` fully.

- [ ] **Step 3: Append NPartyDebate and DebatePosition**

Append to debate.py:

```python
@dataclass
class DebatePosition:
    agent: object  # BaseAgent
    stance: str    # "pro", "con", "neutral_critic", "synthesizer"


class NPartyDebate:
    """Multi-position debate: all positions open in parallel, then rebuttal rounds."""

    def __init__(self, positions: list[DebatePosition], moderator_gateway,
                 max_rounds: int = 3):
        if len(positions) < 2:
            raise ValueError(f"Need at least 2 positions, got {len(positions)}")
        self._positions = positions
        self._gateway = moderator_gateway
        self._max_rounds = max_rounds

    async def run(self, topic: str) -> DebateResult:
        from cabinet.agents.parallel import ParallelExecutor, AgentTask

        # Phase 1: All positions open in parallel
        opening_tasks = [
            AgentTask(
                agent=p.agent,
                task=f"State your {p.stance} position on: {topic}",
                role_label=p.stance,
            )
            for p in self._positions
        ]
        executor = ParallelExecutor(self._gateway)
        openings = await executor.execute_parallel(opening_tasks)
        all_statements = list(openings.individual_results)

        # Phase 2: Sequential rebuttal rounds
        for round_num in range(self._max_rounds):
            for pos in self._positions:
                others = [
                    s for s in all_statements
                    if s.get("role") != pos.stance
                ]
                others_text = "\n".join(
                    f"[{s.get('role')}]: {s.get('content', '')[:300]}"
                    for s in others[-6:]
                )
                critique_task = (
                    f"Topic: {topic}\n"
                    f"Your stance: {pos.stance}\n"
                    f"Other positions:\n{others_text}\n\n"
                    f"Provide your rebuttal or refinement."
                )
                try:
                    output = await pos.agent.execute(critique_task, None)
                    all_statements.append({
                        "role": pos.stance,
                        "content": output.content if hasattr(output, 'content') else str(output),
                        "round": round_num + 1,
                    })
                except Exception as e:
                    all_statements.append({
                        "role": pos.stance,
                        "content": str(e),
                        "round": round_num + 1,
                    })

        # Phase 3: Moderator synthesis
        joined = "\n".join(
            f"[{s.get('role')}]: {s.get('content', '')[:300]}"
            for s in all_statements[-12:]
        )
        response = await self._gateway.complete(
            messages=[{
                "role": "system",
                "content": "You are a debate moderator. Summarize, identify consensus and disagreements, provide a final recommendation.",
            }, {
                "role": "user",
                "content": f"Topic: {topic}\n\nDebate:\n{joined}",
            }],
            model="default",
            temperature=0.3,
        )

        final_text = response.content if hasattr(response, 'content') else str(response)
        has_consensus = any(word in final_text.lower() for word in
                           ["consensus", "agreement", "agree", "共识", "一致"])

        return DebateResult(
            statements=all_statements,
            consensus=has_consensus,
            final_verdict=final_text,
        )
```

Add the `@dataclass` import at the top if not already present.

- [ ] **Step 4: Run tests**

```bash
pytest tests/unit/agents/test_nparty_debate.py tests/unit/agents/test_parallel.py -v
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/debate.py tests/unit/agents/test_nparty_debate.py
git commit -m "feat(agents): add NPartyDebate with multi-position parallel debate"
```

---

### Task 4: Full Integration Verification

- [ ] **Step 1: Run full test suite**

```bash
pytest tests/ -q --tb=line 2>&1 | tail -3
```

- [ ] **Step 2: Verify imports**

```bash
python -c "
from cabinet.agents.parallel import ParallelExecutor, AgentTask, SynthesizedResult
from cabinet.agents.debate import NPartyDebate, DebatePosition
from cabinet.agents.handoff import HandoffManager, HandoffHooks
print('All imports OK')
"
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: full integration verification for multi-agent collaboration"
```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| Task 1 | Create parallel.py | 5 |
| Task 2 | Modify handoff.py | — |
| Task 3 | Modify debate.py + test | 3 |
| Task 4 | Verification | — |
| **Total** | 1 new + 2 modified | 8 new |
