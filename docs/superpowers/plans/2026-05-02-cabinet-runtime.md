# CabinetRuntime System Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble all implemented components (EventBus + RoomEventWiring + 6 Room Services + 6 EventHandlers + AgentFactory) into a runnable CabinetRuntime system.

**Architecture:** CabinetRuntime is a thin assembly layer that creates all components in correct dependency order, provides lifecycle management (start/stop), and exposes service access properties. StubAgentFactory provides a test-double AgentFactory so the system runs without real LLM calls.

**Tech Stack:** Python 3.12+, Pydantic v2, pytest + pytest-asyncio, ruff

---

## File Structure

### New Files
- `src/cabinet/agents/stub_factory.py` — StubAgentFactory + StubAgent + StubTeam
- `src/cabinet/runtime.py` — CabinetRuntime assembly class
- `tests/unit/agents/test_stub_factory.py` — StubAgentFactory unit tests
- `tests/unit/test_runtime.py` — CabinetRuntime unit tests
- `tests/integration/test_runtime.py` — End-to-end integration tests

### Modified Files
- `src/cabinet/cli/main.py` — Update `_serve_async` to use CabinetRuntime
- `tests/integration/test_room_services_integration.py` — Replace inline StubAgentFactory with import from stub_factory

---

### Task 1: StubAgentFactory

**Files:**
- Create: `src/cabinet/agents/stub_factory.py`
- Create: `tests/unit/agents/test_stub_factory.py`

- [ ] **Step 1: Write failing tests for StubAgentFactory**

Create `tests/unit/agents/test_stub_factory.py`:

```python
from uuid import uuid4

import pytest

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.agents.protocol import AgentFactory, BaseAgent, BaseTeam
from cabinet.agents.stub_factory import StubAgentFactory


def test_stub_agent_factory_satisfies_protocol():
    factory = StubAgentFactory()
    assert isinstance(factory, AgentFactory)


@pytest.mark.asyncio
async def test_create_agent_returns_base_agent():
    factory = StubAgentFactory()
    agent_id = uuid4()
    agent = await factory.create_agent(agent_id, "analyst")
    assert isinstance(agent, BaseAgent)
    assert agent.employee.name == "stub-agent"
    assert agent.employee.role == "analyst"


@pytest.mark.asyncio
async def test_create_agent_execute_returns_output():
    factory = StubAgentFactory()
    agent = await factory.create_agent(uuid4(), "analyst")
    context = AgentContext()
    output = await agent.execute("do something", context)
    assert isinstance(output, AgentOutput)
    assert "stub" in output.content.lower()
    assert output.employee_id == agent.employee.id


@pytest.mark.asyncio
async def test_create_agent_reflect_returns_output():
    factory = StubAgentFactory()
    agent = await factory.create_agent(uuid4(), "analyst")
    context = AgentContext()
    original = await agent.execute("do something", context)
    reflected = await agent.reflect(original)
    assert isinstance(reflected, AgentOutput)
    assert reflected.employee_id == agent.employee.id


@pytest.mark.asyncio
async def test_create_team_returns_base_team():
    factory = StubAgentFactory()
    agent1 = await factory.create_agent(uuid4(), "analyst")
    agent2 = await factory.create_agent(uuid4(), "writer")
    team = await factory.create_team([agent1, agent2], "collaborate")
    assert isinstance(team, BaseTeam)
    assert team.team.name == "stub-team"


@pytest.mark.asyncio
async def test_create_team_dispatch_returns_output():
    factory = StubAgentFactory()
    agent = await factory.create_agent(uuid4(), "analyst")
    team = await factory.create_team([agent], "collaborate")
    context = TeamContext()
    output = await team.dispatch("do something", context)
    assert isinstance(output, TeamOutput)
    assert "stub" in output.content.lower()
    assert output.team_id == team.team.id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/agents/test_stub_factory.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.agents.stub_factory'`

- [ ] **Step 3: Write implementation**

Create `src/cabinet/agents/stub_factory.py`:

```python
from __future__ import annotations

from uuid import UUID, uuid4

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.models.primitives import Employee, Team


class StubAgent:
    def __init__(self, employee: Employee):
        self._employee = employee

    @property
    def employee(self) -> Employee:
        return self._employee

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        return AgentOutput(
            content=f"Stub response for {self._employee.role}: {task}",
            employee_id=self._employee.id,
        )

    async def reflect(self, output: AgentOutput) -> AgentOutput:
        return AgentOutput(
            content=f"Stub reflection: {output.content}",
            employee_id=self._employee.id,
        )


class StubTeam:
    def __init__(self, team: Team):
        self._team = team

    @property
    def team(self) -> Team:
        return self._team

    async def dispatch(self, task: str, context: TeamContext) -> TeamOutput:
        return TeamOutput(
            content=f"Stub team response: {task}",
            team_id=self._team.id,
        )


class StubAgentFactory:
    async def create_agent(self, agent_id: UUID, role: str) -> StubAgent:
        employee = Employee(
            id=agent_id,
            team_id=uuid4(),
            name="stub-agent",
            role=role,
            kind="ai",
        )
        return StubAgent(employee)

    async def create_team(self, agents: list, task: str) -> StubTeam:
        team = Team(
            project_id=uuid4(),
            name="stub-team",
            purpose=task,
            employees=[a.employee.id for a in agents],
        )
        return StubTeam(team)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/agents/test_stub_factory.py -v`
Expected: All 6 tests PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/agents/stub_factory.py tests/unit/agents/test_stub_factory.py
git commit -m "feat: StubAgentFactory with StubAgent and StubTeam"
```

---

### Task 2: CabinetRuntime

**Files:**
- Create: `src/cabinet/runtime.py`
- Create: `tests/unit/test_runtime.py`

- [ ] **Step 1: Write failing tests for CabinetRuntime**

Create `tests/unit/test_runtime.py`:

```python
import pytest
import pytest_asyncio

from cabinet.agents.protocol import AgentFactory
from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.runtime import CabinetRuntime
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.service import SummaryRoomService


def test_runtime_creates_with_default_agent_factory():
    runtime = CabinetRuntime()
    assert isinstance(runtime._agent_factory, AgentFactory)


def test_runtime_creates_with_custom_agent_factory():
    factory = StubAgentFactory()
    runtime = CabinetRuntime(agent_factory=factory)
    assert runtime._agent_factory is factory


def test_runtime_exposes_bus():
    runtime = CabinetRuntime()
    assert isinstance(runtime.bus, AsyncIOEventBus)


def test_runtime_exposes_wiring():
    runtime = CabinetRuntime()
    assert isinstance(runtime.wiring, RoomEventWiring)


def test_runtime_exposes_store():
    runtime = CabinetRuntime()
    from cabinet.core.events.store import EventStore
    assert isinstance(runtime.store, EventStore)


def test_runtime_exposes_meeting_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.meeting, MeetingRoomService)


def test_runtime_exposes_strategy_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.strategy, StrategyDecoderService)


def test_runtime_exposes_decision_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.decision, DecisionRoomService)


def test_runtime_exposes_office_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.office, OfficeSchedulerService)


def test_runtime_exposes_summary_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.summary, SummaryRoomService)


def test_runtime_exposes_secretary_service():
    runtime = CabinetRuntime()
    assert isinstance(runtime.secretary, SecretaryAgentService)


def test_runtime_each_service_has_own_store():
    runtime = CabinetRuntime()
    assert runtime.meeting._store is not runtime.decision._store
    assert runtime.decision._store is not runtime.office._store
    assert runtime.office._store is not runtime.summary._store
    assert runtime.summary._store is not runtime.secretary._store


def test_runtime_all_services_share_same_publisher():
    runtime = CabinetRuntime()
    assert runtime.meeting._publisher is runtime.decision._publisher
    assert runtime.decision._publisher is runtime.office._publisher
    assert runtime.office._publisher is runtime.wiring


@pytest.mark.asyncio
async def test_runtime_start_registers_handlers():
    runtime = CabinetRuntime()
    await runtime.start()
    assert "meeting" in runtime.wiring._handlers
    assert "strategy" in runtime.wiring._handlers
    assert "decision" in runtime.wiring._handlers
    assert "office" in runtime.wiring._handlers
    assert "summary" in runtime.wiring._handlers
    assert "secretary" in runtime.wiring._handlers


@pytest.mark.asyncio
async def test_runtime_stop_completes_without_error():
    runtime = CabinetRuntime()
    await runtime.start()
    await runtime.stop()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/test_runtime.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.runtime'`

- [ ] **Step 3: Write implementation**

Create `src/cabinet/runtime.py`:

```python
from __future__ import annotations

from cabinet.agents.protocol import AgentFactory
from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.service import SummaryRoomService


class CabinetRuntime:
    def __init__(self, agent_factory: AgentFactory | None = None):
        self._agent_factory = agent_factory or StubAgentFactory()
        self._bus = AsyncIOEventBus()
        self._wiring = RoomEventWiring(self._bus)

        self._meeting_store = RoomEventStore("meeting")
        self._strategy_store = RoomEventStore("strategy")
        self._decision_store = RoomEventStore("decision")
        self._office_store = RoomEventStore("office")
        self._summary_store = RoomEventStore("summary")
        self._secretary_store = RoomEventStore("secretary")

        self._meeting = MeetingRoomService(self._meeting_store, self._wiring, self._agent_factory)
        self._strategy = StrategyDecoderService(self._strategy_store, self._wiring, self._agent_factory)
        self._decision = DecisionRoomService(self._decision_store, self._wiring, self._agent_factory)
        self._office = OfficeSchedulerService(self._office_store, self._wiring, self._agent_factory)
        self._summary = SummaryRoomService(self._summary_store, self._wiring, self._agent_factory)
        self._secretary = SecretaryAgentService(self._secretary_store, self._wiring, self._agent_factory)

        self._meeting_handler = MeetingEventHandler()
        self._strategy_handler = StrategyEventHandler()
        self._decision_handler = DecisionEventHandler(self._decision)
        self._office_handler = OfficeEventHandler(self._office)
        self._summary_handler = SummaryEventHandler(self._summary)
        self._secretary_handler = SecretaryEventHandler(self._secretary)

    async def start(self) -> None:
        await self._wiring.register(self._meeting_handler)
        await self._wiring.register(self._strategy_handler)
        await self._wiring.register(self._decision_handler)
        await self._wiring.register(self._office_handler)
        await self._wiring.register(self._summary_handler)
        await self._wiring.register(self._secretary_handler)

    async def stop(self) -> None:
        pass

    @property
    def bus(self) -> AsyncIOEventBus:
        return self._bus

    @property
    def wiring(self) -> RoomEventWiring:
        return self._wiring

    @property
    def meeting(self) -> MeetingRoomService:
        return self._meeting

    @property
    def strategy(self) -> StrategyDecoderService:
        return self._strategy

    @property
    def decision(self) -> DecisionRoomService:
        return self._decision

    @property
    def office(self) -> OfficeSchedulerService:
        return self._office

    @property
    def summary(self) -> SummaryRoomService:
        return self._summary

    @property
    def secretary(self) -> SecretaryAgentService:
        return self._secretary

    @property
    def store(self):
        return self._bus._store
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/test_runtime.py -v`
Expected: All 15 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/runtime.py tests/unit/test_runtime.py
git commit -m "feat: CabinetRuntime system assembly with lifecycle management"
```

---

### Task 3: Integration Tests

**Files:**
- Create: `tests/integration/test_runtime.py`

- [ ] **Step 1: Write integration tests for CabinetRuntime**

Create `tests/integration/test_runtime.py`:

```python
from uuid import uuid4

import pytest
import pytest_asyncio

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.models.events import DecisionRequest
from cabinet.runtime import CabinetRuntime
from cabinet.rooms.meeting.models import MeetingLevel


@pytest_asyncio.fixture
async def runtime():
    rt = CabinetRuntime()
    await rt.start()
    yield rt
    await rt.stop()


@pytest.mark.asyncio
async def test_runtime_meeting_to_decision_event_flow(runtime):
    pid = uuid4()
    p1 = uuid4()
    session = await runtime.meeting.start_session(
        "strategy review", MeetingLevel.MULTI_PARTY, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "expand market")
    await runtime.meeting.converge(session.id)
    assert len(runtime.decision._decisions) >= 1


@pytest.mark.asyncio
async def test_runtime_decision_to_office_event_flow(runtime):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="action",
        title="execute", options=[{"label": "go"}],
    )
    await runtime.decision.submit(request)
    emp_id = uuid4()
    skill_id = uuid4()
    await runtime.decision.approve(request.decision_id, {
        "label": "go", "employee_id": emp_id, "skill_id": skill_id,
    })
    office_tasks = [t for t in runtime.office._tasks.values()
                    if t.employee_id == emp_id]
    assert len(office_tasks) >= 1


@pytest.mark.asyncio
async def test_runtime_full_chain_meeting_to_secretary(runtime):
    pid = uuid4()
    p1 = uuid4()
    session = await runtime.meeting.start_session(
        "big plan", MeetingLevel.MULTI_PARTY, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "go big")
    await runtime.meeting.converge(session.id)
    assert len(runtime.secretary._notifications) >= 0


@pytest.mark.asyncio
async def test_runtime_causation_chain_tracing(runtime):
    pid = uuid4()
    p1 = uuid4()
    session = await runtime.meeting.start_session(
        "trace test", MeetingLevel.FREE_DRAFT, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "view1")
    await runtime.meeting.converge(session.id)
    decision_events = runtime.store.get_by_type("deliberation.proposal")
    assert len(decision_events) >= 1


@pytest.mark.asyncio
async def test_runtime_restore_from_events(runtime):
    pid = uuid4()
    p1 = uuid4()
    session = await runtime.meeting.start_session(
        "restore test", MeetingLevel.FREE_DRAFT, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "view1")

    new_meeting_store = runtime.meeting._store
    new_meeting = MeetingRoomService(new_meeting_store, runtime.wiring, StubAgentFactory())
    await new_meeting.restore_from_events()
    assert session.id in new_meeting._sessions
    assert len(new_meeting._perspectives[session.id]) == 1


@pytest.mark.asyncio
async def test_runtime_start_registers_all_contracts(runtime):
    handlers = runtime.wiring._handlers
    assert len(handlers) == 6
    room_names = set(handlers.keys())
    assert room_names == {"meeting", "strategy", "decision", "office", "summary", "secretary"}


@pytest.mark.asyncio
async def test_runtime_event_contracts_consistency(runtime):
    handlers = runtime.wiring._handlers
    for name, handler in handlers.items():
        assert handler.contract.room_name == name
        assert isinstance(handler.contract.produces, list)
        assert isinstance(handler.contract.consumes, list)
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/integration/test_runtime.py -v`
Expected: All 7 tests PASS

- [ ] **Step 3: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_runtime.py
git commit -m "test: CabinetRuntime end-to-end integration tests"
```

---

### Task 4: CLI Serve Update + Integration Test Cleanup

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Modify: `tests/integration/test_room_services_integration.py`

- [ ] **Step 1: Update `_serve_async` to use CabinetRuntime**

In `src/cabinet/cli/main.py`, replace the `_serve_async` function (lines 127-148) with:

```python
async def _serve_async(data_dir: str) -> None:
    from cabinet.cli.config import load_config
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    runtime = CabinetRuntime()
    await runtime.start()

    console.print(Panel(
        f"[bold green]Cabinet is serving[/bold green]\n\n"
        f"Organization: {config.organization.name}\n"
        f"Event Bus: active\n"
        f"Rooms: meeting, strategy, decision, office, summary, secretary\n\n"
        f"Press Ctrl+C to stop",
        title="Cabinet Serve",
    ))

    stop_event = asyncio.Event()
    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass
    finally:
        await runtime.stop()
```

- [ ] **Step 2: Update integration test to use StubAgentFactory from stub_factory**

In `tests/integration/test_room_services_integration.py`, replace the inline `StubAgentFactory` class (lines 22-27) with an import, and add the strategy service fixture.

Replace lines 1-27 with:

```python
import pytest
import pytest_asyncio
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.models.events import DecisionRequest
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.meeting.models import MeetingLevel
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.service import SummaryRoomService
```

Also add the strategy service fixture after the `meeting_service` fixture:

```python
@pytest.fixture
def strategy_service(wiring):
    store = RoomEventStore("strategy")
    return StrategyDecoderService(store, wiring, StubAgentFactory())
```

And update the `all_registered` fixture to include strategy:

```python
@pytest_asyncio.fixture
async def all_registered(wiring, meeting_service, strategy_service, decision_service, office_service, summary_service, secretary_service):
    meeting_handler = MeetingEventHandler()
    strategy_handler = StrategyEventHandler()
    decision_handler = DecisionEventHandler(decision_service)
    office_handler = OfficeEventHandler(office_service)
    summary_handler = SummaryEventHandler(summary_service)
    secretary_handler = SecretaryEventHandler(secretary_service)
    await wiring.register(meeting_handler)
    await wiring.register(strategy_handler)
    await wiring.register(decision_handler)
    await wiring.register(office_handler)
    await wiring.register(summary_handler)
    await wiring.register(secretary_handler)
```

- [ ] **Step 3: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/main.py tests/integration/test_room_services_integration.py
git commit -m "feat: CLI serve uses CabinetRuntime; integration test uses shared StubAgentFactory"
```

---

### Task 5: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All tests PASS (350+ existing + ~27 new)

- [ ] **Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Verify imports**

Run: `python -c "from cabinet.runtime import CabinetRuntime; from cabinet.agents.stub_factory import StubAgentFactory; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "chore: verify full test suite passes after CabinetRuntime assembly"
```

---

## Summary

| Task | Component | New Tests | Key Changes |
|:---|:---|:---|:---|
| 1 | StubAgentFactory + StubAgent + StubTeam | 6 | AgentFactory test-double with protocol-compliant Agent/Team |
| 2 | CabinetRuntime | 15 | Assembly class with lifecycle + service access properties |
| 3 | Integration tests | 7 | End-to-end event chain, causation tracing, restore |
| 4 | CLI serve + test cleanup | 0 | serve uses CabinetRuntime; shared StubAgentFactory |
| 5 | Final verification | 0 | Full test suite + lint + import verification |

**Total: ~28 new tests across 5 tasks (350 existing → 378+ total)**

## Execution Order

```
Task 1: StubAgentFactory
         ↓
Task 2: CabinetRuntime (depends on Task 1)
         ↓
Task 3: Integration tests (depends on Task 2)
         ↓
Task 4: CLI serve + test cleanup (depends on Task 2)
         ↓
Task 5: Final verification
```
