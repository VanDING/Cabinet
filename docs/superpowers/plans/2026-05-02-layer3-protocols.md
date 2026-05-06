# Layer 3 协议铺开实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全量铺开 Layer 3（工作空间与决策层）的 6 个协议接口、约 30 个数据模型、3 个 Harness 实现类，全部通过 TDD 流程。

**Architecture:** Room-centric 组织，每个室一个子模块（protocol.py + models.py），秘书 Agent 独立模块。Harness 在现有 core/harness/ 下新增实现文件。所有协议 runtime_checkable，所有模型 Pydantic v2。

**Tech Stack:** Python 3.12+, Pydantic v2, pytest, pytest-asyncio, ruff

---

## File Structure

```
src/cabinet/rooms/
├── __init__.py
├── meeting/
│   ├── __init__.py
│   ├── protocol.py       # MeetingRoom 协议
│   └── models.py         # MeetingLevel, DeliberationSession, Perspective, ConvergenceResult, DissentItem, DeliberationResult, DeliberationOutput
├── strategy/
│   ├── __init__.py
│   ├── protocol.py       # StrategyDecoder 协议
│   └── models.py         # ActionDomain, ActionBlueprint, BlueprintValidation, DecodeContext
├── decision/
│   ├── __init__.py
│   ├── protocol.py       # DecisionRoom 协议
│   └── models.py         # DecisionCard, DecisionDashboard, AuthorizationRule, AuthorizationVerdict
├── office/
│   ├── __init__.py
│   ├── protocol.py       # OfficeScheduler 协议
│   └── models.py         # PermissionLevel, Task, TaskStatus, WorkflowExecution, PermissionVerdict
├── summary/
│   ├── __init__.py
│   ├── protocol.py       # SummaryRoom 协议
│   └── models.py         # ReviewType, ReviewSession, Insight, DecisionTreeNode, DecisionTree, ImprovementSuggestion, AuthorizationAudit
└── secretary/
    ├── __init__.py
    ├── protocol.py       # SecretaryAgent 协议
    └── models.py         # SecretaryLevel, Greeting, InteractionContext, SecretaryResponse, PendingSummary, NotificationEvent, NotificationResult, FilterResult

src/cabinet/core/harness/
├── evaluator.py          # DefaultEvaluator 实现
├── verification_gate.py  # WorkflowVerificationGate 实现
└── escalation.py         # DefaultEscalationProtocol 实现

tests/unit/rooms/
├── __init__.py
├── meeting/
│   ├── __init__.py
│   ├── test_models.py
│   └── test_protocol.py
├── strategy/
│   ├── __init__.py
│   ├── test_models.py
│   └── test_protocol.py
├── decision/
│   ├── __init__.py
│   ├── test_models.py
│   └── test_protocol.py
├── office/
│   ├── __init__.py
│   ├── test_models.py
│   └── test_protocol.py
├── summary/
│   ├── __init__.py
│   ├── test_models.py
│   └── test_protocol.py
└── secretary/
    ├── __init__.py
    ├── test_models.py
    └── test_protocol.py

tests/unit/core/harness/
├── test_evaluator.py
├── test_verification_gate.py
└── test_escalation.py
```

---

### Task 1: 会议室模型（Meeting Room Models）

**Files:**
- Create: `src/cabinet/rooms/__init__.py`
- Create: `src/cabinet/rooms/meeting/__init__.py`
- Create: `src/cabinet/rooms/meeting/models.py`
- Create: `tests/unit/rooms/__init__.py`
- Create: `tests/unit/rooms/meeting/__init__.py`
- Create: `tests/unit/rooms/meeting/test_models.py`

- [ ] **Step 1: Create directory structure and __init__.py files**

Create empty `__init__.py` files for:
- `src/cabinet/rooms/__init__.py`
- `src/cabinet/rooms/meeting/__init__.py`
- `tests/unit/rooms/__init__.py`
- `tests/unit/rooms/meeting/__init__.py`

- [ ] **Step 2: Write the failing tests for meeting models**

```python
import uuid

from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
    DeliberationSession,
    DissentItem,
    MeetingLevel,
    Perspective,
)


def test_meeting_level_values():
    assert MeetingLevel.FREE_DRAFT == "free_draft"
    assert MeetingLevel.MULTI_PARTY == "multi_party"
    assert MeetingLevel.EXPERT_HEARING == "expert_hearing"


def test_deliberation_session_creation():
    proj_id = uuid.uuid4()
    participant = uuid.uuid4()
    session = DeliberationSession(
        project_id=proj_id,
        topic="Should we expand to new market?",
        level=MeetingLevel.MULTI_PARTY,
        participants=[participant],
    )
    assert session.topic == "Should we expand to new market?"
    assert session.level == MeetingLevel.MULTI_PARTY
    assert session.status == "open"
    assert session.round == 1
    assert session.experts == []


def test_perspective_creation():
    session_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    perspective = Perspective(
        session_id=session_id,
        agent_id=agent_id,
        content="I believe we should expand gradually",
        round=1,
    )
    assert perspective.content == "I believe we should expand gradually"
    assert perspective.round == 1


def test_dissent_item():
    agent_id = uuid.uuid4()
    dissent = DissentItem(
        agent_id=agent_id,
        content="I disagree with the timeline",
        reasoning="The proposed timeline doesn't account for regulatory approval",
    )
    assert dissent.agent_id == agent_id
    assert dissent.reasoning == "The proposed timeline doesn't account for regulatory approval"


def test_convergence_result():
    agent_id = uuid.uuid4()
    result = ConvergenceResult(
        consensus="Expand to new market with phased approach",
        dissent=[DissentItem(agent_id=agent_id, content="Timeline too aggressive", reasoning="Regulatory delays")],
        unresolved=["Budget allocation for Q3"],
    )
    assert result.consensus == "Expand to new market with phased approach"
    assert len(result.dissent) == 1
    assert len(result.unresolved) == 1


def test_deliberation_result():
    session_id = uuid.uuid4()
    convergence = ConvergenceResult(
        consensus="Agreed",
        dissent=[],
        unresolved=[],
    )
    result = DeliberationResult(
        session_id=session_id,
        proposal_text="Expand to European market in Q3",
        confidence=0.85,
        reasoning_summary="Strong market signals with manageable risk",
        convergence=convergence,
        rounds_used=2,
        rumination_detected=False,
    )
    assert result.confidence == 0.85
    assert result.rounds_used == 2
    assert result.rumination_detected is False


def test_deliberation_output():
    session_id = uuid.uuid4()
    convergence = ConvergenceResult(consensus="Go", dissent=[], unresolved=[])
    proposal = DeliberationResult(
        session_id=session_id,
        proposal_text="Test proposal",
        confidence=0.9,
        reasoning_summary="Test",
        convergence=convergence,
        rounds_used=1,
        rumination_detected=False,
    )
    output = DeliberationOutput(
        session_id=session_id,
        proposal=proposal,
    )
    assert output.session_id == session_id
    assert output.proposal.proposal_text == "Test proposal"
    assert output.event_payload is not None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/meeting/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms'`

- [ ] **Step 4: Implement meeting models**

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.models.events import DeliberationProposal


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class MeetingLevel(str, Enum):
    FREE_DRAFT = "free_draft"
    MULTI_PARTY = "multi_party"
    EXPERT_HEARING = "expert_hearing"


class DeliberationSession(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    topic: str
    level: MeetingLevel
    participants: list[UUID]
    experts: list[UUID] = []
    status: Literal["open", "validating", "converging", "closed"] = "open"
    round: int = 1
    created_at: datetime = Field(default_factory=_now)


class Perspective(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    session_id: UUID
    agent_id: UUID
    content: str
    round: int
    created_at: datetime = Field(default_factory=_now)


class DissentItem(BaseModel):
    agent_id: UUID
    content: str
    reasoning: str


class ConvergenceResult(BaseModel):
    consensus: str
    dissent: list[DissentItem]
    unresolved: list[str]


class DeliberationResult(BaseModel):
    session_id: UUID
    proposal_text: str
    confidence: float
    reasoning_summary: str
    convergence: ConvergenceResult
    rounds_used: int
    rumination_detected: bool


class DeliberationOutput(BaseModel):
    session_id: UUID
    proposal: DeliberationResult
    event_payload: DeliberationProposal = None

    def model_post_init(self, __context: object) -> None:
        if self.event_payload is None:
            self.event_payload = DeliberationProposal(
                proposal_text=self.proposal.proposal_text,
                confidence=self.proposal.confidence,
                reasoning_summary=self.proposal.reasoning_summary,
            )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/meeting/test_models.py -v`
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/ tests/unit/rooms/
git commit -m "feat: add meeting room models"
```

---

### Task 2: 会议室协议（Meeting Room Protocol）

**Files:**
- Create: `src/cabinet/rooms/meeting/protocol.py`
- Create: `tests/unit/rooms/meeting/test_protocol.py`

- [ ] **Step 1: Write the failing tests for meeting protocol**

```python
import uuid

import pytest

from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
    DeliberationSession,
    MeetingLevel,
)
from cabinet.rooms.meeting.protocol import MeetingRoom


def test_meeting_room_protocol_runtime_checkable():
    class MockMeetingRoom:
        async def start_session(self, topic, level, participants):
            return DeliberationSession(
                project_id=uuid.uuid4(),
                topic=topic,
                level=level,
                participants=participants,
            )

        async def add_perspective(self, session_id, agent_id, content):
            from cabinet.rooms.meeting.models import Perspective
            return Perspective(session_id=session_id, agent_id=agent_id, content=content, round=1)

        async def cross_validate(self, session_id):
            return ConvergenceResult(consensus="ok", dissent=[], unresolved=[])

        async def converge(self, session_id, max_rounds=3):
            return DeliberationResult(
                session_id=session_id,
                proposal_text="proposal",
                confidence=0.8,
                reasoning_summary="summary",
                convergence=ConvergenceResult(consensus="ok", dissent=[], unresolved=[]),
                rounds_used=1,
                rumination_detected=False,
            )

        async def wake_expert(self, session_id, expert_id):
            pass

        async def close_session(self, session_id):
            convergence = ConvergenceResult(consensus="ok", dissent=[], unresolved=[])
            proposal = DeliberationResult(
                session_id=session_id,
                proposal_text="final",
                confidence=0.9,
                reasoning_summary="done",
                convergence=convergence,
                rounds_used=2,
                rumination_detected=False,
            )
            return DeliberationOutput(session_id=session_id, proposal=proposal)

    mock = MockMeetingRoom()
    assert isinstance(mock, MeetingRoom)


@pytest.mark.asyncio
async def test_meeting_room_start_session_contract():
    class MockMeetingRoom:
        async def start_session(self, topic, level, participants):
            return DeliberationSession(
                project_id=uuid.uuid4(),
                topic=topic,
                level=level,
                participants=participants,
            )

        async def add_perspective(self, session_id, agent_id, content):
            from cabinet.rooms.meeting.models import Perspective
            return Perspective(session_id=session_id, agent_id=agent_id, content=content, round=1)

        async def cross_validate(self, session_id):
            return ConvergenceResult(consensus="ok", dissent=[], unresolved=[])

        async def converge(self, session_id, max_rounds=3):
            return DeliberationResult(
                session_id=session_id,
                proposal_text="proposal",
                confidence=0.8,
                reasoning_summary="summary",
                convergence=ConvergenceResult(consensus="ok", dissent=[], unresolved=[]),
                rounds_used=1,
                rumination_detected=False,
            )

        async def wake_expert(self, session_id, expert_id):
            pass

        async def close_session(self, session_id):
            convergence = ConvergenceResult(consensus="ok", dissent=[], unresolved=[])
            proposal = DeliberationResult(
                session_id=session_id,
                proposal_text="final",
                confidence=0.9,
                reasoning_summary="done",
                convergence=convergence,
                rounds_used=2,
                rumination_detected=False,
            )
            return DeliberationOutput(session_id=session_id, proposal=proposal)

    room = MockMeetingRoom()
    participant = uuid.uuid4()
    session = await room.start_session("Test topic", MeetingLevel.MULTI_PARTY, [participant])
    assert isinstance(session, DeliberationSession)
    assert session.topic == "Test topic"


@pytest.mark.asyncio
async def test_meeting_room_converge_contract():
    class MockMeetingRoom:
        async def start_session(self, topic, level, participants):
            return DeliberationSession(
                project_id=uuid.uuid4(),
                topic=topic,
                level=level,
                participants=participants,
            )

        async def add_perspective(self, session_id, agent_id, content):
            from cabinet.rooms.meeting.models import Perspective
            return Perspective(session_id=session_id, agent_id=agent_id, content=content, round=1)

        async def cross_validate(self, session_id):
            return ConvergenceResult(consensus="ok", dissent=[], unresolved=[])

        async def converge(self, session_id, max_rounds=3):
            return DeliberationResult(
                session_id=session_id,
                proposal_text="proposal",
                confidence=0.8,
                reasoning_summary="summary",
                convergence=ConvergenceResult(consensus="ok", dissent=[], unresolved=[]),
                rounds_used=max_rounds,
                rumination_detected=False,
            )

        async def wake_expert(self, session_id, expert_id):
            pass

        async def close_session(self, session_id):
            convergence = ConvergenceResult(consensus="ok", dissent=[], unresolved=[])
            proposal = DeliberationResult(
                session_id=session_id,
                proposal_text="final",
                confidence=0.9,
                reasoning_summary="done",
                convergence=convergence,
                rounds_used=2,
                rumination_detected=False,
            )
            return DeliberationOutput(session_id=session_id, proposal=proposal)

    room = MockMeetingRoom()
    session_id = uuid.uuid4()
    result = await room.converge(session_id, max_rounds=2)
    assert isinstance(result, DeliberationResult)
    assert result.rounds_used == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/meeting/test_protocol.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.meeting.protocol'`

- [ ] **Step 3: Implement meeting protocol**

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
    DeliberationSession,
    MeetingLevel,
    Perspective,
)


@runtime_checkable
class MeetingRoom(Protocol):
    async def start_session(self, topic: str, level: MeetingLevel,
                            participants: list[UUID]) -> DeliberationSession: ...
    async def add_perspective(self, session_id: UUID, agent_id: UUID,
                              content: str) -> Perspective: ...
    async def cross_validate(self, session_id: UUID) -> ConvergenceResult: ...
    async def converge(self, session_id: UUID,
                       max_rounds: int = 3) -> DeliberationResult: ...
    async def wake_expert(self, session_id: UUID, expert_id: UUID) -> None: ...
    async def close_session(self, session_id: UUID) -> DeliberationOutput: ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/meeting/test_protocol.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Run all meeting tests**

Run: `python -m pytest tests/unit/rooms/meeting/ -v`
Expected: All 10 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/meeting/protocol.py tests/unit/rooms/meeting/test_protocol.py
git commit -m "feat: add meeting room protocol"
```

---

### Task 3: 战略解码模型（Strategy Decoder Models）

**Files:**
- Create: `src/cabinet/rooms/strategy/__init__.py`
- Create: `src/cabinet/rooms/strategy/models.py`
- Create: `tests/unit/rooms/strategy/__init__.py`
- Create: `tests/unit/rooms/strategy/test_models.py`

- [ ] **Step 1: Create __init__.py files**

Create empty `__init__.py` files for:
- `src/cabinet/rooms/strategy/__init__.py`
- `tests/unit/rooms/strategy/__init__.py`

- [ ] **Step 2: Write the failing tests for strategy models**

```python
import uuid

from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    ActionDomain,
    BlueprintValidation,
    DecodeContext,
)


def test_action_domain_creation():
    domain = ActionDomain(
        name="Market Expansion",
        goal="Enter European market",
        constraints=["Budget under 50k", "No external hires"],
        success_criteria=["First sale completed", "Local partnership signed"],
        dependencies=["Legal Review"],
        risk_checkpoints=["Regulatory approval pending"],
    )
    assert domain.name == "Market Expansion"
    assert domain.goal == "Enter European market"
    assert len(domain.constraints) == 2
    assert len(domain.success_criteria) == 2
    assert domain.dependencies == ["Legal Review"]


def test_action_domain_defaults():
    domain = ActionDomain(name="Ops", goal="Improve efficiency")
    assert domain.constraints == []
    assert domain.success_criteria == []
    assert domain.dependencies == []
    assert domain.risk_checkpoints == []


def test_action_blueprint_creation():
    proj_id = uuid.uuid4()
    proposal_id = uuid.uuid4()
    domain = ActionDomain(name="Sales", goal="Increase revenue")
    blueprint = ActionBlueprint(
        project_id=proj_id,
        source_proposal_id=proposal_id,
        domains=[domain],
        execution_order=[["Sales"]],
        global_constraints=["No budget overrun"],
    )
    assert blueprint.project_id == proj_id
    assert len(blueprint.domains) == 1
    assert blueprint.execution_order == [["Sales"]]
    assert blueprint.global_constraints == ["No budget overrun"]


def test_action_blueprint_execution_order():
    proj_id = uuid.uuid4()
    proposal_id = uuid.uuid4()
    blueprint = ActionBlueprint(
        project_id=proj_id,
        source_proposal_id=proposal_id,
        domains=[],
        execution_order=[["Legal", "Finance"], ["Operations"]],
    )
    assert len(blueprint.execution_order) == 2
    assert len(blueprint.execution_order[0]) == 2
    assert blueprint.execution_order[1] == ["Operations"]


def test_blueprint_validation_valid():
    validation = BlueprintValidation(
        valid=True,
        domain_count_ok=True,
        dependencies_resolved=True,
        criteria_measurable=True,
    )
    assert validation.valid is True
    assert validation.issues == []
    assert validation.domain_count_ok is True


def test_blueprint_validation_invalid():
    validation = BlueprintValidation(
        valid=False,
        issues=["Too many domains", "Circular dependency detected"],
        domain_count_ok=False,
        dependencies_resolved=False,
        criteria_measurable=True,
    )
    assert validation.valid is False
    assert len(validation.issues) == 2
    assert validation.domain_count_ok is False


def test_decode_context():
    ctx = DecodeContext(
        project_id=uuid.uuid4(),
        captain_id="captain-1",
        existing_constraints=["Must comply with GDPR"],
    )
    assert ctx.captain_id == "captain-1"
    assert len(ctx.existing_constraints) == 1


def test_decode_context_defaults():
    ctx = DecodeContext(
        project_id=uuid.uuid4(),
        captain_id="captain-1",
    )
    assert ctx.existing_constraints == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/strategy/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.strategy'`

- [ ] **Step 4: Implement strategy models**

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class ActionDomain(BaseModel):
    name: str
    goal: str
    constraints: list[str] = []
    success_criteria: list[str] = []
    dependencies: list[str] = []
    risk_checkpoints: list[str] = []


class ActionBlueprint(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    source_proposal_id: UUID
    domains: list[ActionDomain]
    execution_order: list[list[str]]
    global_constraints: list[str] = []
    created_at: datetime = Field(default_factory=_now)


class BlueprintValidation(BaseModel):
    valid: bool
    issues: list[str] = []
    domain_count_ok: bool
    dependencies_resolved: bool
    criteria_measurable: bool


class DecodeContext(BaseModel):
    project_id: UUID
    captain_id: str
    existing_constraints: list[str] = []
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/strategy/test_models.py -v`
Expected: All 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/strategy/ tests/unit/rooms/strategy/
git commit -m "feat: add strategy decoder models"
```

---

### Task 4: 战略解码协议（Strategy Decoder Protocol）

**Files:**
- Create: `src/cabinet/rooms/strategy/protocol.py`
- Create: `tests/unit/rooms/strategy/test_protocol.py`

- [ ] **Step 1: Write the failing tests for strategy protocol**

```python
import uuid

import pytest

from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
)
from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    ActionDomain,
    BlueprintValidation,
    DecodeContext,
)
from cabinet.rooms.strategy.protocol import StrategyDecoder


def test_strategy_decoder_protocol_runtime_checkable():
    class MockDecoder:
        async def decode(self, proposal, context):
            return ActionBlueprint(
                project_id=context.project_id,
                source_proposal_id=proposal.session_id,
                domains=[ActionDomain(name="Test", goal="Test goal")],
                execution_order=[["Test"]],
            )

        async def validate_blueprint(self, blueprint):
            return BlueprintValidation(
                valid=True,
                domain_count_ok=True,
                dependencies_resolved=True,
                criteria_measurable=True,
            )

    mock = MockDecoder()
    assert isinstance(mock, StrategyDecoder)


@pytest.mark.asyncio
async def test_strategy_decoder_decode_contract():
    class MockDecoder:
        async def decode(self, proposal, context):
            return ActionBlueprint(
                project_id=context.project_id,
                source_proposal_id=proposal.session_id,
                domains=[ActionDomain(name="Sales", goal="Increase revenue")],
                execution_order=[["Sales"]],
            )

        async def validate_blueprint(self, blueprint):
            return BlueprintValidation(
                valid=True,
                domain_count_ok=True,
                dependencies_resolved=True,
                criteria_measurable=True,
            )

    decoder = MockDecoder()
    session_id = uuid.uuid4()
    convergence = ConvergenceResult(consensus="Go", dissent=[], unresolved=[])
    proposal = DeliberationResult(
        session_id=session_id,
        proposal_text="Expand market",
        confidence=0.8,
        reasoning_summary="Strong signals",
        convergence=convergence,
        rounds_used=1,
        rumination_detected=False,
    )
    output = DeliberationOutput(session_id=session_id, proposal=proposal)
    ctx = DecodeContext(project_id=uuid.uuid4(), captain_id="captain-1")
    blueprint = await decoder.decode(output, ctx)
    assert isinstance(blueprint, ActionBlueprint)
    assert len(blueprint.domains) == 1


@pytest.mark.asyncio
async def test_strategy_decoder_validate_contract():
    class MockDecoder:
        async def decode(self, proposal, context):
            return ActionBlueprint(
                project_id=context.project_id,
                source_proposal_id=proposal.session_id,
                domains=[],
                execution_order=[],
            )

        async def validate_blueprint(self, blueprint):
            return BlueprintValidation(
                valid=len(blueprint.domains) <= 5,
                domain_count_ok=len(blueprint.domains) <= 5,
                dependencies_resolved=True,
                criteria_measurable=True,
                issues=[] if len(blueprint.domains) <= 5 else ["Too many domains"],
            )

    decoder = MockDecoder()
    proj_id = uuid.uuid4()
    blueprint = ActionBlueprint(
        project_id=proj_id,
        source_proposal_id=uuid.uuid4(),
        domains=[ActionDomain(name=f"D{i}", goal=f"G{i}") for i in range(6)],
        execution_order=[],
    )
    validation = await decoder.validate_blueprint(blueprint)
    assert isinstance(validation, BlueprintValidation)
    assert validation.valid is False
    assert validation.domain_count_ok is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/strategy/test_protocol.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.strategy.protocol'`

- [ ] **Step 3: Implement strategy protocol**

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable

from cabinet.rooms.meeting.models import DeliberationOutput
from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    BlueprintValidation,
    DecodeContext,
)


@runtime_checkable
class StrategyDecoder(Protocol):
    async def decode(self, proposal: DeliberationOutput,
                     context: DecodeContext) -> ActionBlueprint: ...
    async def validate_blueprint(self, blueprint: ActionBlueprint) -> BlueprintValidation: ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/strategy/test_protocol.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Run all strategy tests**

Run: `python -m pytest tests/unit/rooms/strategy/ -v`
Expected: All 11 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/strategy/protocol.py tests/unit/rooms/strategy/test_protocol.py
git commit -m "feat: add strategy decoder protocol"
```

---

### Task 5: 决策室模型（Decision Room Models）

**Files:**
- Create: `src/cabinet/rooms/decision/__init__.py`
- Create: `src/cabinet/rooms/decision/models.py`
- Create: `tests/unit/rooms/decision/__init__.py`
- Create: `tests/unit/rooms/decision/test_models.py`

- [ ] **Step 1: Create __init__.py files**

Create empty `__init__.py` files for:
- `src/cabinet/rooms/decision/__init__.py`
- `tests/unit/rooms/decision/__init__.py`

- [ ] **Step 2: Write the failing tests for decision models**

```python
import uuid

from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.decision.models import (
    AuthorizationRule,
    AuthorizationVerdict,
    DecisionCard,
    DecisionDashboard,
)


def test_decision_card_creation():
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Market Expansion",
        description="Should we expand to Europe?",
        captain_id="captain-1",
        urgency="yellow",
    )
    card = DecisionCard(
        decision=decision,
        urgency_color="yellow",
        summary="Strategic decision on market expansion",
        options_summary=["Expand now", "Wait for Q3", "Skip Europe"],
        source_room="meeting",
        created_ago="2 hours ago",
    )
    assert card.urgency_color == "yellow"
    assert card.source_room == "meeting"
    assert len(card.options_summary) == 3


def test_decision_dashboard():
    proj_id = uuid.uuid4()
    dashboard = DecisionDashboard(
        project_id=proj_id,
        red_cards=[],
        yellow_cards=[],
        blue_cards=[],
        white_cards=[],
        total_pending=0,
    )
    assert dashboard.total_pending == 0
    assert dashboard.red_cards == []


def test_decision_dashboard_with_cards():
    proj_id = uuid.uuid4()
    decision = Decision(
        project_id=proj_id,
        decision_type=DecisionType.ANOMALY,
        title="API Down",
        description="External API is down",
        captain_id="captain-1",
        urgency="red",
    )
    card = DecisionCard(
        decision=decision,
        urgency_color="red",
        summary="API outage detected",
        options_summary=["Retry", "Switch provider"],
        source_room="office",
        created_ago="5 min ago",
    )
    dashboard = DecisionDashboard(
        project_id=proj_id,
        red_cards=[card],
        yellow_cards=[],
        blue_cards=[],
        white_cards=[],
        total_pending=1,
    )
    assert len(dashboard.red_cards) == 1
    assert dashboard.total_pending == 1


def test_authorization_rule_auto_approve():
    rule = AuthorizationRule(
        captain_id="captain-1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
        conditions=[],
    )
    assert rule.auto_approve is True
    assert rule.budget_threshold is None
    assert rule.notify_only is False


def test_authorization_rule_with_conditions():
    rule = AuthorizationRule(
        captain_id="captain-1",
        decision_type=DecisionType.ACTION,
        auto_approve=False,
        conditions=["budget_exceeded", "external_commitment"],
        budget_threshold=10000.0,
        notify_only=True,
    )
    assert rule.auto_approve is False
    assert rule.budget_threshold == 10000.0
    assert rule.notify_only is True
    assert len(rule.conditions) == 2


def test_authorization_verdict_auto_process():
    verdict = AuthorizationVerdict(
        auto_process=True,
        requires_captain=False,
        reason="Within authorized budget",
        matched_rule=uuid.uuid4(),
    )
    assert verdict.auto_process is True
    assert verdict.requires_captain is False
    assert verdict.matched_rule is not None


def test_authorization_verdict_requires_captain():
    verdict = AuthorizationVerdict(
        auto_process=False,
        requires_captain=True,
        reason="High-risk operation",
    )
    assert verdict.auto_process is False
    assert verdict.requires_captain is True
    assert verdict.matched_rule is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/decision/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.decision'`

- [ ] **Step 4: Implement decision models**

```python
from __future__ import annotations

import uuid
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.models.decisions import Decision, DecisionType


def _uuid() -> UUID:
    return uuid.uuid4()


class DecisionCard(BaseModel):
    decision: Decision
    urgency_color: Literal["red", "yellow", "blue", "white"]
    summary: str
    options_summary: list[str]
    source_room: str
    created_ago: str


class DecisionDashboard(BaseModel):
    project_id: UUID
    red_cards: list[DecisionCard]
    yellow_cards: list[DecisionCard]
    blue_cards: list[DecisionCard]
    white_cards: list[DecisionCard]
    total_pending: int


class AuthorizationRule(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    captain_id: str
    decision_type: DecisionType
    auto_approve: bool = False
    conditions: list[str] = []
    budget_threshold: float | None = None
    notify_only: bool = False


class AuthorizationVerdict(BaseModel):
    auto_process: bool
    requires_captain: bool
    reason: str
    matched_rule: UUID | None = None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/decision/test_models.py -v`
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/decision/ tests/unit/rooms/decision/
git commit -m "feat: add decision room models"
```

---

### Task 6: 决策室协议（Decision Room Protocol）

**Files:**
- Create: `src/cabinet/rooms/decision/protocol.py`
- Create: `tests/unit/rooms/decision/test_protocol.py`

- [ ] **Step 1: Write the failing tests for decision protocol**

```python
import uuid

import pytest

from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.decision.models import (
    AuthorizationRule,
    AuthorizationVerdict,
    DecisionCard,
    DecisionDashboard,
)
from cabinet.rooms.decision.protocol import DecisionRoom


def _make_decision(**kwargs):
    defaults = dict(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Test Decision",
        description="Test",
        captain_id="captain-1",
    )
    defaults.update(kwargs)
    return Decision(**defaults)


def test_decision_room_protocol_runtime_checkable():
    class MockDecisionRoom:
        async def submit(self, request):
            return _make_decision(title=request.title)

        async def approve(self, decision_id, option):
            return _make_decision(status="approved")

        async def reject(self, decision_id, reason):
            return _make_decision(status="rejected")

        async def delegate(self, decision_id, delegate_to):
            return _make_decision(status="delegated")

        async def get_dashboard(self, project_id):
            return DecisionDashboard(
                project_id=project_id,
                red_cards=[], yellow_cards=[], blue_cards=[], white_cards=[],
                total_pending=0,
            )

        async def set_authorization(self, rule):
            pass

        async def check_authorization(self, decision):
            return AuthorizationVerdict(
                auto_process=False, requires_captain=True, reason="Strategic decision"
            )

        async def cascade(self, decision):
            return []

    mock = MockDecisionRoom()
    assert isinstance(mock, DecisionRoom)


@pytest.mark.asyncio
async def test_decision_room_submit_contract():
    class MockDecisionRoom:
        async def submit(self, request):
            return _make_decision(title=request.title, decision_type=DecisionType(request.decision_type))

        async def approve(self, decision_id, option):
            return _make_decision()

        async def reject(self, decision_id, reason):
            return _make_decision()

        async def delegate(self, decision_id, delegate_to):
            return _make_decision()

        async def get_dashboard(self, project_id):
            return DecisionDashboard(project_id=project_id, red_cards=[], yellow_cards=[], blue_cards=[], white_cards=[], total_pending=0)

        async def set_authorization(self, rule):
            pass

        async def check_authorization(self, decision):
            return AuthorizationVerdict(auto_process=False, requires_captain=True, reason="test")

        async def cascade(self, decision):
            return []

    from cabinet.models.events import DecisionRequest
    room = MockDecisionRoom()
    request = DecisionRequest(
        decision_id=uuid.uuid4(),
        decision_type="strategic",
        title="Should we expand?",
    )
    decision = await room.submit(request)
    assert isinstance(decision, Decision)
    assert decision.title == "Should we expand?"


@pytest.mark.asyncio
async def test_decision_room_cascade_contract():
    class MockDecisionRoom:
        async def submit(self, request):
            return _make_decision()

        async def approve(self, decision_id, option):
            return _make_decision()

        async def reject(self, decision_id, reason):
            return _make_decision()

        async def delegate(self, decision_id, delegate_to):
            return _make_decision()

        async def get_dashboard(self, project_id):
            return DecisionDashboard(project_id=project_id, red_cards=[], yellow_cards=[], blue_cards=[], white_cards=[], total_pending=0)

        async def set_authorization(self, rule):
            pass

        async def check_authorization(self, decision):
            return AuthorizationVerdict(auto_process=False, requires_captain=True, reason="test")

        async def cascade(self, decision):
            if decision.decision_type == DecisionType.STRATEGIC:
                return [_make_decision(decision_type=DecisionType.ACTION, title="Action from strategy")]
            return []

    room = MockDecisionRoom()
    strategic = _make_decision(decision_type=DecisionType.STRATEGIC)
    cascaded = await room.cascade(strategic)
    assert len(cascaded) == 1
    assert cascaded[0].decision_type == DecisionType.ACTION
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/decision/test_protocol.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.decision.protocol'`

- [ ] **Step 3: Implement decision protocol**

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.models.decisions import Decision
from cabinet.models.events import DecisionRequest
from cabinet.rooms.decision.models import (
    AuthorizationRule,
    AuthorizationVerdict,
    DecisionDashboard,
)


@runtime_checkable
class DecisionRoom(Protocol):
    async def submit(self, request: DecisionRequest) -> Decision: ...
    async def approve(self, decision_id: UUID, option: dict) -> Decision: ...
    async def reject(self, decision_id: UUID, reason: str) -> Decision: ...
    async def delegate(self, decision_id: UUID, delegate_to: str) -> Decision: ...
    async def get_dashboard(self, project_id: UUID) -> DecisionDashboard: ...
    async def set_authorization(self, rule: AuthorizationRule) -> None: ...
    async def check_authorization(self, decision: Decision) -> AuthorizationVerdict: ...
    async def cascade(self, decision: Decision) -> list[Decision]: ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/decision/test_protocol.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Run all decision tests**

Run: `python -m pytest tests/unit/rooms/decision/ -v`
Expected: All 10 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/decision/protocol.py tests/unit/rooms/decision/test_protocol.py
git commit -m "feat: add decision room protocol"
```

---

### Task 7: 办公室模型（Office Models）

**Files:**
- Create: `src/cabinet/rooms/office/__init__.py`
- Create: `src/cabinet/rooms/office/models.py`
- Create: `tests/unit/rooms/office/__init__.py`
- Create: `tests/unit/rooms/office/test_models.py`

- [ ] **Step 1: Create __init__.py files**

Create empty `__init__.py` files for:
- `src/cabinet/rooms/office/__init__.py`
- `tests/unit/rooms/office/__init__.py`

- [ ] **Step 2: Write the failing tests for office models**

```python
import uuid

from cabinet.core.harness.models import GateResult
from cabinet.rooms.office.models import (
    PermissionLevel,
    PermissionVerdict,
    Task,
    TaskStatus,
    WorkflowExecution,
)


def test_permission_level_values():
    assert PermissionLevel.L0 == "L0"
    assert PermissionLevel.L1 == "L1"
    assert PermissionLevel.L2 == "L2"
    assert PermissionLevel.L3 == "L3"


def test_task_creation():
    proj_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    skill_id = uuid.uuid4()
    task = Task(
        project_id=proj_id,
        employee_id=emp_id,
        skill_id=skill_id,
        inputs={"text": "hello"},
    )
    assert task.status == "queued"
    assert task.progress == 0.0
    assert task.result is None
    assert task.retry_count == 0
    assert task.started_at is None


def test_task_completed():
    proj_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    skill_id = uuid.uuid4()
    task = Task(
        project_id=proj_id,
        employee_id=emp_id,
        skill_id=skill_id,
        status="completed",
        progress=1.0,
        result={"output": "done"},
    )
    assert task.status == "completed"
    assert task.progress == 1.0
    assert task.result == {"output": "done"}


def test_task_failed():
    proj_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    skill_id = uuid.uuid4()
    task = Task(
        project_id=proj_id,
        employee_id=emp_id,
        skill_id=skill_id,
        status="failed",
        error="Connection timeout",
        retry_count=2,
    )
    assert task.status == "failed"
    assert task.error == "Connection timeout"
    assert task.retry_count == 2


def test_task_status():
    task_id = uuid.uuid4()
    status = TaskStatus(
        task_id=task_id,
        status="running",
        progress=0.5,
        message="Processing step 3 of 6",
    )
    assert status.progress == 0.5
    assert status.message == "Processing step 3 of 6"


def test_workflow_execution():
    proj_id = uuid.uuid4()
    wf_id = uuid.uuid4()
    node_id = uuid.uuid4()
    execution = WorkflowExecution(
        workflow_id=wf_id,
        project_id=proj_id,
        status="running",
        current_node_id=node_id,
        completed_nodes=[],
    )
    assert execution.status == "running"
    assert execution.current_node_id == node_id
    assert execution.results == {}
    assert execution.gate_results == {}


def test_workflow_execution_with_results():
    proj_id = uuid.uuid4()
    wf_id = uuid.uuid4()
    node_a = uuid.uuid4()
    node_b = uuid.uuid4()
    gate = GateResult(passed=True)
    execution = WorkflowExecution(
        workflow_id=wf_id,
        project_id=proj_id,
        status="completed",
        completed_nodes=[node_a, node_b],
        results={str(node_a): {"output": "a"}, str(node_b): {"output": "b"}},
        gate_results={str(node_b): gate},
    )
    assert execution.status == "completed"
    assert len(execution.completed_nodes) == 2
    assert execution.gate_results[str(node_b)].passed is True


def test_permission_verdict_allowed():
    verdict = PermissionVerdict(
        allowed=True,
        level=PermissionLevel.L3,
        requires_approval=False,
    )
    assert verdict.allowed is True
    assert verdict.level == PermissionLevel.L3
    assert verdict.reason is None


def test_permission_verdict_denied():
    verdict = PermissionVerdict(
        allowed=False,
        level=PermissionLevel.L0,
        reason="Operation requires Captain",
        requires_approval=False,
    )
    assert verdict.allowed is False
    assert verdict.level == PermissionLevel.L0
    assert verdict.requires_approval is False
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/office/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.office'`

- [ ] **Step 4: Implement office models**

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.core.harness.models import GateResult


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class PermissionLevel(str, Enum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


class Task(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    employee_id: UUID
    skill_id: UUID
    inputs: dict = {}
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = "queued"
    progress: float = 0.0
    result: dict | None = None
    error: str | None = None
    retry_count: int = 0
    created_at: datetime = Field(default_factory=_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None


class TaskStatus(BaseModel):
    task_id: UUID
    status: str
    progress: float
    message: str | None = None


class WorkflowExecution(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    workflow_id: UUID
    project_id: UUID
    status: Literal["running", "completed", "failed", "paused"] = "running"
    current_node_id: UUID | None = None
    completed_nodes: list[UUID] = []
    results: dict[str, dict] = {}
    gate_results: dict[str, GateResult] = {}
    created_at: datetime = Field(default_factory=_now)


class PermissionVerdict(BaseModel):
    allowed: bool
    level: PermissionLevel
    reason: str | None = None
    requires_approval: bool = False
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/office/test_models.py -v`
Expected: All 9 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/office/ tests/unit/rooms/office/
git commit -m "feat: add office models"
```

---

### Task 8: 办公室协议（Office Protocol）

**Files:**
- Create: `src/cabinet/rooms/office/protocol.py`
- Create: `tests/unit/rooms/office/test_protocol.py`

- [ ] **Step 1: Write the failing tests for office protocol**

```python
import uuid

import pytest

from cabinet.models.events import TaskOrder
from cabinet.rooms.office.models import (
    PermissionLevel,
    PermissionVerdict,
    Task,
    TaskStatus,
    WorkflowExecution,
)
from cabinet.rooms.office.protocol import OfficeScheduler


def test_office_scheduler_protocol_runtime_checkable():
    class MockOffice:
        async def submit_task(self, order):
            return Task(
                project_id=uuid.uuid4(),
                employee_id=order.employee_id,
                skill_id=order.skill_id,
                inputs=order.inputs,
            )

        async def cancel_task(self, task_id):
            pass

        async def get_task_status(self, task_id):
            return TaskStatus(task_id=task_id, status="running", progress=0.5)

        async def list_active_tasks(self, project_id):
            return []

        async def execute_workflow(self, workflow_id, inputs):
            return WorkflowExecution(workflow_id=workflow_id, project_id=uuid.uuid4())

        async def check_permission(self, employee_id, action):
            return PermissionVerdict(allowed=True, level=PermissionLevel.L3)

    mock = MockOffice()
    assert isinstance(mock, OfficeScheduler)


@pytest.mark.asyncio
async def test_office_submit_task_contract():
    class MockOffice:
        async def submit_task(self, order):
            return Task(
                project_id=uuid.uuid4(),
                employee_id=order.employee_id,
                skill_id=order.skill_id,
                inputs=order.inputs,
            )

        async def cancel_task(self, task_id):
            pass

        async def get_task_status(self, task_id):
            return TaskStatus(task_id=task_id, status="queued", progress=0.0)

        async def list_active_tasks(self, project_id):
            return []

        async def execute_workflow(self, workflow_id, inputs):
            return WorkflowExecution(workflow_id=workflow_id, project_id=uuid.uuid4())

        async def check_permission(self, employee_id, action):
            return PermissionVerdict(allowed=True, level=PermissionLevel.L3)

    office = MockOffice()
    order = TaskOrder(employee_id=uuid.uuid4(), skill_id=uuid.uuid4(), inputs={"key": "value"})
    task = await office.submit_task(order)
    assert isinstance(task, Task)
    assert task.status == "queued"


@pytest.mark.asyncio
async def test_office_check_permission_contract():
    class MockOffice:
        async def submit_task(self, order):
            return Task(project_id=uuid.uuid4(), employee_id=order.employee_id, skill_id=order.skill_id)

        async def cancel_task(self, task_id):
            pass

        async def get_task_status(self, task_id):
            return TaskStatus(task_id=task_id, status="queued", progress=0.0)

        async def list_active_tasks(self, project_id):
            return []

        async def execute_workflow(self, workflow_id, inputs):
            return WorkflowExecution(workflow_id=workflow_id, project_id=uuid.uuid4())

        async def check_permission(self, employee_id, action):
            if action == "send_email":
                return PermissionVerdict(allowed=True, level=PermissionLevel.L2, requires_approval=False)
            return PermissionVerdict(allowed=False, level=PermissionLevel.L0, reason="Forbidden")

    office = MockOffice()
    verdict = await office.check_permission(uuid.uuid4(), "send_email")
    assert isinstance(verdict, PermissionVerdict)
    assert verdict.allowed is True
    assert verdict.level == PermissionLevel.L2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/office/test_protocol.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.office.protocol'`

- [ ] **Step 3: Implement office protocol**

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.models.events import TaskOrder
from cabinet.rooms.office.models import (
    PermissionVerdict,
    Task,
    TaskStatus,
    WorkflowExecution,
)


@runtime_checkable
class OfficeScheduler(Protocol):
    async def submit_task(self, order: TaskOrder) -> Task: ...
    async def cancel_task(self, task_id: UUID) -> None: ...
    async def get_task_status(self, task_id: UUID) -> TaskStatus: ...
    async def list_active_tasks(self, project_id: UUID) -> list[Task]: ...
    async def execute_workflow(self, workflow_id: UUID,
                              inputs: dict) -> WorkflowExecution: ...
    async def check_permission(self, employee_id: UUID,
                               action: str) -> PermissionVerdict: ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/office/test_protocol.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Run all office tests**

Run: `python -m pytest tests/unit/rooms/office/ -v`
Expected: All 12 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/office/protocol.py tests/unit/rooms/office/test_protocol.py
git commit -m "feat: add office scheduler protocol"
```

---

### Task 9: 总结室模型（Summary Room Models）

**Files:**
- Create: `src/cabinet/rooms/summary/__init__.py`
- Create: `src/cabinet/rooms/summary/models.py`
- Create: `tests/unit/rooms/summary/__init__.py`
- Create: `tests/unit/rooms/summary/test_models.py`

- [ ] **Step 1: Create __init__.py files**

Create empty `__init__.py` files for:
- `src/cabinet/rooms/summary/__init__.py`
- `tests/unit/rooms/summary/__init__.py`

- [ ] **Step 2: Write the failing tests for summary models**

```python
import uuid

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    DecisionTreeNode,
    ImprovementSuggestion,
    Insight,
    ReviewSession,
    ReviewType,
)


def test_review_type_values():
    assert ReviewType.PROJECT_REVIEW == "project_review"
    assert ReviewType.ORG_OPTIMIZATION == "org_optimization"
    assert ReviewType.CAPTAIN_INSIGHT == "captain_insight"


def test_review_session_creation():
    proj_id = uuid.uuid4()
    session = ReviewSession(
        project_id=proj_id,
        review_type=ReviewType.PROJECT_REVIEW,
    )
    assert session.status == "in_progress"
    assert session.completed_at is None


def test_review_session_completed():
    from datetime import datetime, timezone
    proj_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    session = ReviewSession(
        project_id=proj_id,
        review_type=ReviewType.ORG_OPTIMIZATION,
        status="completed",
        completed_at=now,
    )
    assert session.status == "completed"
    assert session.completed_at is not None


def test_insight_auto_applicable():
    session_id = uuid.uuid4()
    insight = Insight(
        session_id=session_id,
        insight_type="prompt_optimization",
        content="Improve the resume parsing prompt",
        confidence=0.85,
        auto_applicable=True,
        requires_captain=False,
    )
    assert insight.auto_applicable is True
    assert insight.requires_captain is False


def test_insight_requires_captain():
    session_id = uuid.uuid4()
    insight = Insight(
        session_id=session_id,
        insight_type="skill_suggestion",
        content="Consider adding email drafting skill",
        confidence=0.7,
        auto_applicable=False,
        requires_captain=True,
    )
    assert insight.auto_applicable is False
    assert insight.requires_captain is True


def test_decision_tree_node_root():
    node = DecisionTreeNode(
        node_type="root",
        label="Project Start",
    )
    assert node.node_type == "root"
    assert node.decision_id is None
    assert node.outcome is None
    assert node.children == []


def test_decision_tree_node_decision():
    decision_id = uuid.uuid4()
    child_id = uuid.uuid4()
    node = DecisionTreeNode(
        node_type="decision",
        label="Market Expansion",
        decision_id=decision_id,
        outcome="approved",
        children=[child_id],
    )
    assert node.outcome == "approved"
    assert len(node.children) == 1


def test_decision_tree():
    proj_id = uuid.uuid4()
    root = DecisionTreeNode(node_type="root", label="Start")
    child = DecisionTreeNode(node_type="decision", label="Decide", children=[])
    root.children.append(child.id)
    tree = DecisionTree(
        project_id=proj_id,
        root_node_id=root.id,
        nodes={root.id: root, child.id: child},
    )
    assert tree.root_node_id == root.id
    assert len(tree.nodes) == 2


def test_improvement_suggestion():
    session_id = uuid.uuid4()
    suggestion = ImprovementSuggestion(
        session_id=session_id,
        category="workflow",
        description="Parallelize resume screening steps",
        impact="high",
        effort="medium",
        auto_applicable=False,
    )
    assert suggestion.category == "workflow"
    assert suggestion.impact == "high"
    assert suggestion.auto_applicable is False


def test_authorization_audit():
    audit = AuthorizationAudit(
        captain_id="captain-1",
        period="2026-05",
        total_decisions=45,
        manually_approved=30,
        could_auto_process=12,
        suggestion="Consider adjusting authorization rules for execution decisions",
    )
    assert audit.total_decisions == 45
    assert audit.manually_approved == 30
    assert audit.could_auto_process == 12
    assert audit.suggestion is not None


def test_authorization_audit_no_suggestion():
    audit = AuthorizationAudit(
        captain_id="captain-1",
        period="2026-05",
        total_decisions=10,
        manually_approved=2,
        could_auto_process=0,
    )
    assert audit.suggestion is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/summary/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.summary'`

- [ ] **Step 4: Implement summary models**

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class ReviewType(str, Enum):
    PROJECT_REVIEW = "project_review"
    ORG_OPTIMIZATION = "org_optimization"
    CAPTAIN_INSIGHT = "captain_insight"


class ReviewSession(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    review_type: ReviewType
    status: Literal["in_progress", "completed"] = "in_progress"
    created_at: datetime = Field(default_factory=_now)
    completed_at: datetime | None = None


class Insight(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    session_id: UUID
    insight_type: str
    content: str
    confidence: float
    auto_applicable: bool
    requires_captain: bool


class DecisionTreeNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    node_type: Literal["root", "branch", "decision", "execution", "anomaly", "external"]
    label: str
    decision_id: UUID | None = None
    outcome: Literal["approved", "rejected", "completed", "failed"] | None = None
    children: list[UUID] = []
    metadata: dict = {}


class DecisionTree(BaseModel):
    project_id: UUID
    root_node_id: UUID
    nodes: dict[UUID, DecisionTreeNode]


class ImprovementSuggestion(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    session_id: UUID
    category: Literal["skill", "workflow", "authorization", "knowledge"]
    description: str
    impact: Literal["low", "medium", "high"]
    effort: Literal["low", "medium", "high"]
    auto_applicable: bool


class AuthorizationAudit(BaseModel):
    captain_id: str
    period: str
    total_decisions: int
    manually_approved: int
    could_auto_process: int
    suggestion: str | None = None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/summary/test_models.py -v`
Expected: All 11 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/summary/ tests/unit/rooms/summary/
git commit -m "feat: add summary room models"
```

---

### Task 10: 总结室协议（Summary Room Protocol）

**Files:**
- Create: `src/cabinet/rooms/summary/protocol.py`
- Create: `tests/unit/rooms/summary/test_protocol.py`

- [ ] **Step 1: Write the failing tests for summary protocol**

```python
import uuid

import pytest

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    DecisionTreeNode,
    ImprovementSuggestion,
    Insight,
    ReviewSession,
    ReviewType,
)
from cabinet.rooms.summary.protocol import SummaryRoom


def test_summary_room_protocol_runtime_checkable():
    class MockSummaryRoom:
        async def start_review(self, project_id, review_type):
            return ReviewSession(project_id=project_id, review_type=review_type)

        async def generate_insights(self, session_id):
            return []

        async def build_decision_tree(self, project_id):
            root = DecisionTreeNode(node_type="root", label="Start")
            return DecisionTree(project_id=project_id, root_node_id=root.id, nodes={root.id: root})

        async def suggest_improvements(self, session_id):
            return []

        async def audit_authorization_usage(self, captain_id):
            return AuthorizationAudit(
                captain_id=captain_id,
                period="2026-05",
                total_decisions=0,
                manually_approved=0,
                could_auto_process=0,
            )

    mock = MockSummaryRoom()
    assert isinstance(mock, SummaryRoom)


@pytest.mark.asyncio
async def test_summary_room_start_review_contract():
    class MockSummaryRoom:
        async def start_review(self, project_id, review_type):
            return ReviewSession(project_id=project_id, review_type=review_type)

        async def generate_insights(self, session_id):
            return []

        async def build_decision_tree(self, project_id):
            root = DecisionTreeNode(node_type="root", label="Start")
            return DecisionTree(project_id=project_id, root_node_id=root.id, nodes={root.id: root})

        async def suggest_improvements(self, session_id):
            return []

        async def audit_authorization_usage(self, captain_id):
            return AuthorizationAudit(captain_id=captain_id, period="2026-05", total_decisions=0, manually_approved=0, could_auto_process=0)

    room = MockSummaryRoom()
    proj_id = uuid.uuid4()
    session = await room.start_review(proj_id, ReviewType.PROJECT_REVIEW)
    assert isinstance(session, ReviewSession)
    assert session.review_type == ReviewType.PROJECT_REVIEW


@pytest.mark.asyncio
async def test_summary_room_generate_insights_contract():
    class MockSummaryRoom:
        async def start_review(self, project_id, review_type):
            return ReviewSession(project_id=project_id, review_type=review_type)

        async def generate_insights(self, session_id):
            return [
                Insight(
                    session_id=session_id,
                    insight_type="prompt_optimization",
                    content="Improve prompt",
                    confidence=0.8,
                    auto_applicable=True,
                    requires_captain=False,
                )
            ]

        async def build_decision_tree(self, project_id):
            root = DecisionTreeNode(node_type="root", label="Start")
            return DecisionTree(project_id=project_id, root_node_id=root.id, nodes={root.id: root})

        async def suggest_improvements(self, session_id):
            return []

        async def audit_authorization_usage(self, captain_id):
            return AuthorizationAudit(captain_id=captain_id, period="2026-05", total_decisions=0, manually_approved=0, could_auto_process=0)

    room = MockSummaryRoom()
    session_id = uuid.uuid4()
    insights = await room.generate_insights(session_id)
    assert len(insights) == 1
    assert insights[0].auto_applicable is True


@pytest.mark.asyncio
async def test_summary_room_audit_contract():
    class MockSummaryRoom:
        async def start_review(self, project_id, review_type):
            return ReviewSession(project_id=project_id, review_type=review_type)

        async def generate_insights(self, session_id):
            return []

        async def build_decision_tree(self, project_id):
            root = DecisionTreeNode(node_type="root", label="Start")
            return DecisionTree(project_id=project_id, root_node_id=root.id, nodes={root.id: root})

        async def suggest_improvements(self, session_id):
            return []

        async def audit_authorization_usage(self, captain_id):
            return AuthorizationAudit(
                captain_id=captain_id,
                period="2026-05",
                total_decisions=50,
                manually_approved=35,
                could_auto_process=15,
                suggestion="Consider adjusting authorization rules",
            )

    room = MockSummaryRoom()
    audit = await room.audit_authorization_usage("captain-1")
    assert isinstance(audit, AuthorizationAudit)
    assert audit.could_auto_process == 15
    assert audit.suggestion is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/summary/test_protocol.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.summary.protocol'`

- [ ] **Step 3: Implement summary protocol**

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    ImprovementSuggestion,
    Insight,
    ReviewSession,
    ReviewType,
)


@runtime_checkable
class SummaryRoom(Protocol):
    async def start_review(self, project_id: UUID,
                           review_type: ReviewType) -> ReviewSession: ...
    async def generate_insights(self, session_id: UUID) -> list[Insight]: ...
    async def build_decision_tree(self, project_id: UUID) -> DecisionTree: ...
    async def suggest_improvements(self, session_id: UUID) -> list[ImprovementSuggestion]: ...
    async def audit_authorization_usage(self, captain_id: str) -> AuthorizationAudit: ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/summary/test_protocol.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Run all summary tests**

Run: `python -m pytest tests/unit/rooms/summary/ -v`
Expected: All 15 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/summary/protocol.py tests/unit/rooms/summary/test_protocol.py
git commit -m "feat: add summary room protocol"
```

---

### Task 11: 秘书Agent模型（Secretary Models）

**Files:**
- Create: `src/cabinet/rooms/secretary/__init__.py`
- Create: `src/cabinet/rooms/secretary/models.py`
- Create: `tests/unit/rooms/secretary/__init__.py`
- Create: `tests/unit/rooms/secretary/test_models.py`

- [ ] **Step 1: Create __init__.py files**

Create empty `__init__.py` files for:
- `src/cabinet/rooms/secretary/__init__.py`
- `tests/unit/rooms/secretary/__init__.py`

- [ ] **Step 2: Write the failing tests for secretary models**

```python
import uuid

from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.decision.models import DecisionCard
from cabinet.rooms.secretary.models import (
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    SecretaryLevel,
    SecretaryResponse,
)


def test_secretary_level_values():
    assert SecretaryLevel.L1 == "L1"
    assert SecretaryLevel.L2 == "L2"
    assert SecretaryLevel.L3 == "L3"
    assert SecretaryLevel.L4 == "L4"


def test_greeting_creation():
    greeting = Greeting(
        captain_id="captain-1",
        message="Good morning, Captain!",
        auto_processed_summary="3 tasks auto-completed overnight",
        today_highlights=["Review market proposal", "API monitoring alert"],
    )
    assert greeting.captain_id == "captain-1"
    assert greeting.message == "Good morning, Captain!"
    assert len(greeting.today_highlights) == 2


def test_interaction_context():
    ctx = InteractionContext(
        captain_id="captain-1",
        time_of_day="morning",
    )
    assert ctx.project_id is None
    assert ctx.active_decisions == 0
    assert ctx.recent_interactions == []


def test_interaction_context_with_project():
    proj_id = uuid.uuid4()
    ctx = InteractionContext(
        captain_id="captain-1",
        project_id=proj_id,
        active_decisions=5,
        time_of_day="afternoon",
        recent_interactions=["Approved market expansion"],
    )
    assert ctx.project_id == proj_id
    assert ctx.active_decisions == 5


def test_secretary_response_l1():
    response = SecretaryResponse(
        message="I've created a decision card for your review.",
        level=SecretaryLevel.L1,
        requires_captain=True,
    )
    assert response.level == SecretaryLevel.L1
    assert response.decision_cards == []
    assert response.actions_taken == []


def test_secretary_response_with_cards():
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Expand?",
        description="Market expansion",
        captain_id="captain-1",
    )
    card = DecisionCard(
        decision=decision,
        urgency_color="yellow",
        summary="Strategic decision needed",
        options_summary=["Yes", "No"],
        source_room="meeting",
        created_ago="1 hour ago",
    )
    response = SecretaryResponse(
        message="You have a strategic decision pending.",
        level=SecretaryLevel.L2,
        decision_cards=[card],
        actions_taken=["Sorted decisions by urgency"],
    )
    assert len(response.decision_cards) == 1
    assert len(response.actions_taken) == 1


def test_pending_summary():
    summary = PendingSummary(
        captain_id="captain-1",
        urgent_count=2,
        strategic_count=3,
        execution_count=5,
        evolution_count=1,
        digest="2 urgent items need your attention. 5 execution tasks are auto-processing.",
    )
    assert summary.urgent_count == 2
    assert summary.strategic_count == 3
    assert "2 urgent" in summary.digest


def test_notification_event_info():
    event = NotificationEvent(
        event_type="task_completed",
        severity="info",
        source="office",
        content="Resume screening completed for 15 candidates",
    )
    assert event.severity == "info"
    assert event.related_decision_id is None


def test_notification_event_critical():
    decision_id = uuid.uuid4()
    event = NotificationEvent(
        event_type="anomaly",
        severity="critical",
        source="office",
        content="Payment gateway connection lost",
        related_decision_id=decision_id,
    )
    assert event.severity == "critical"
    assert event.related_decision_id == decision_id


def test_notification_result():
    result = NotificationResult(
        delivered=True,
        channel="dashboard",
        captain_should_see=True,
    )
    assert result.delivered is True
    assert result.captain_should_see is True


def test_filter_result_present():
    result = FilterResult(
        should_present=True,
        reason="Strategic decision requires Captain approval",
    )
    assert result.should_present is True
    assert result.urgency_override is None
    assert result.auto_action is None


def test_filter_result_auto_action():
    result = FilterResult(
        should_present=False,
        auto_action="Auto-approved: routine execution within budget",
        reason="Matches authorization rule for execution decisions",
    )
    assert result.should_present is False
    assert result.auto_action is not None


def test_filter_result_urgency_override():
    result = FilterResult(
        should_present=True,
        urgency_override="red",
        reason="Anomaly escalated to critical",
    )
    assert result.urgency_override == "red"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/secretary/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.secretary'`

- [ ] **Step 4: Implement secretary models**

```python
from __future__ import annotations

from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from cabinet.rooms.decision.models import DecisionCard


class SecretaryLevel(str, Enum):
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"
    L4 = "L4"


class Greeting(BaseModel):
    captain_id: str
    message: str
    auto_processed_summary: str
    today_highlights: list[str]


class InteractionContext(BaseModel):
    captain_id: str
    project_id: UUID | None = None
    active_decisions: int = 0
    time_of_day: str = "morning"
    recent_interactions: list[str] = []


class SecretaryResponse(BaseModel):
    message: str
    level: SecretaryLevel
    decision_cards: list[DecisionCard] = []
    actions_taken: list[str] = []
    requires_captain: bool = False


class PendingSummary(BaseModel):
    captain_id: str
    urgent_count: int
    strategic_count: int
    execution_count: int
    evolution_count: int
    digest: str


class NotificationEvent(BaseModel):
    event_type: str
    severity: Literal["info", "warning", "critical"]
    source: str
    content: str
    related_decision_id: UUID | None = None


class NotificationResult(BaseModel):
    delivered: bool
    channel: str
    captain_should_see: bool


class FilterResult(BaseModel):
    should_present: bool
    urgency_override: Literal["red", "yellow", "blue", "white"] | None = None
    auto_action: str | None = None
    reason: str
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/secretary/test_models.py -v`
Expected: All 13 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/secretary/ tests/unit/rooms/secretary/
git commit -m "feat: add secretary agent models"
```

---

### Task 12: 秘书Agent协议（Secretary Protocol）

**Files:**
- Create: `src/cabinet/rooms/secretary/protocol.py`
- Create: `tests/unit/rooms/secretary/test_protocol.py`

- [ ] **Step 1: Write the failing tests for secretary protocol**

```python
import uuid

import pytest

from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.secretary.models import (
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    SecretaryLevel,
    SecretaryResponse,
)
from cabinet.rooms.secretary.protocol import SecretaryAgent


def test_secretary_agent_protocol_runtime_checkable():
    class MockSecretary:
        async def greet(self, captain_id):
            return Greeting(
                captain_id=captain_id,
                message="Good morning!",
                auto_processed_summary="Nothing auto-processed",
                today_highlights=[],
            )

        async def process_input(self, captain_input, context):
            return SecretaryResponse(
                message="Understood",
                level=SecretaryLevel.L1,
            )

        async def summarize_pending(self, captain_id):
            return PendingSummary(
                captain_id=captain_id,
                urgent_count=0,
                strategic_count=0,
                execution_count=0,
                evolution_count=0,
                digest="All clear",
            )

        async def notify(self, event):
            return NotificationResult(delivered=True, channel="dashboard", captain_should_see=True)

        async def filter_decision(self, decision):
            return FilterResult(should_present=True, reason="Requires Captain")

    mock = MockSecretary()
    assert isinstance(mock, SecretaryAgent)


@pytest.mark.asyncio
async def test_secretary_greet_contract():
    class MockSecretary:
        async def greet(self, captain_id):
            return Greeting(
                captain_id=captain_id,
                message="Good morning, Captain!",
                auto_processed_summary="2 tasks completed",
                today_highlights=["Review proposal"],
            )

        async def process_input(self, captain_input, context):
            return SecretaryResponse(message="ok", level=SecretaryLevel.L1)

        async def summarize_pending(self, captain_id):
            return PendingSummary(captain_id=captain_id, urgent_count=0, strategic_count=0, execution_count=0, evolution_count=0, digest="Clear")

        async def notify(self, event):
            return NotificationResult(delivered=True, channel="dashboard", captain_should_see=True)

        async def filter_decision(self, decision):
            return FilterResult(should_present=True, reason="test")

    secretary = MockSecretary()
    greeting = await secretary.greet("captain-1")
    assert isinstance(greeting, Greeting)
    assert greeting.captain_id == "captain-1"


@pytest.mark.asyncio
async def test_secretary_process_input_contract():
    class MockSecretary:
        async def greet(self, captain_id):
            return Greeting(captain_id=captain_id, message="Hi", auto_processed_summary="", today_highlights=[])

        async def process_input(self, captain_input, context):
            return SecretaryResponse(
                message=f"Processing: {captain_input}",
                level=SecretaryLevel.L1,
                requires_captain=True,
            )

        async def summarize_pending(self, captain_id):
            return PendingSummary(captain_id=captain_id, urgent_count=0, strategic_count=0, execution_count=0, evolution_count=0, digest="Clear")

        async def notify(self, event):
            return NotificationResult(delivered=True, channel="dashboard", captain_should_see=True)

        async def filter_decision(self, decision):
            return FilterResult(should_present=True, reason="test")

    secretary = MockSecretary()
    ctx = InteractionContext(captain_id="captain-1")
    response = await secretary.process_input("Should we expand?", ctx)
    assert isinstance(response, SecretaryResponse)
    assert response.requires_captain is True


@pytest.mark.asyncio
async def test_secretary_filter_decision_contract():
    class MockSecretary:
        async def greet(self, captain_id):
            return Greeting(captain_id=captain_id, message="Hi", auto_processed_summary="", today_highlights=[])

        async def process_input(self, captain_input, context):
            return SecretaryResponse(message="ok", level=SecretaryLevel.L1)

        async def summarize_pending(self, captain_id):
            return PendingSummary(captain_id=captain_id, urgent_count=0, strategic_count=0, execution_count=0, evolution_count=0, digest="Clear")

        async def notify(self, event):
            return NotificationResult(delivered=True, channel="dashboard", captain_should_see=True)

        async def filter_decision(self, decision):
            if decision.decision_type == DecisionType.STRATEGIC:
                return FilterResult(should_present=True, reason="Strategic requires Captain")
            return FilterResult(should_present=False, auto_action="Auto-approved", reason="Within authorization")

    secretary = MockSecretary()
    strategic = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Expand?",
        description="Market expansion",
        captain_id="captain-1",
    )
    result = await secretary.filter_decision(strategic)
    assert result.should_present is True

    execution = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Send email",
        description="Routine email",
        captain_id="captain-1",
    )
    result2 = await secretary.filter_decision(execution)
    assert result2.should_present is False
    assert result2.auto_action is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/secretary/test_protocol.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.rooms.secretary.protocol'`

- [ ] **Step 3: Implement secretary protocol**

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable

from cabinet.models.decisions import Decision
from cabinet.rooms.secretary.models import (
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    SecretaryResponse,
)


@runtime_checkable
class SecretaryAgent(Protocol):
    async def greet(self, captain_id: str) -> Greeting: ...
    async def process_input(self, captain_input: str,
                            context: InteractionContext) -> SecretaryResponse: ...
    async def summarize_pending(self, captain_id: str) -> PendingSummary: ...
    async def notify(self, event: NotificationEvent) -> NotificationResult: ...
    async def filter_decision(self, decision: Decision) -> FilterResult: ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/secretary/test_protocol.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Run all secretary tests**

Run: `python -m pytest tests/unit/rooms/secretary/ -v`
Expected: All 17 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/rooms/secretary/protocol.py tests/unit/rooms/secretary/test_protocol.py
git commit -m "feat: add secretary agent protocol"
```

---

### Task 13: Harness — DefaultEvaluator

**Files:**
- Create: `src/cabinet/core/harness/evaluator.py`
- Create: `tests/unit/core/harness/test_evaluator.py`

- [ ] **Step 1: Write the failing tests for DefaultEvaluator**

```python
import uuid

import pytest

from cabinet.agents.context import AgentOutput
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.core.harness.evaluator import DefaultEvaluator
from cabinet.core.harness.models import EvaluationResult


def test_default_evaluator_satisfies_protocol():
    from cabinet.core.harness.protocol import Evaluator
    evaluator = DefaultEvaluator(gateway=None)
    assert isinstance(evaluator, Evaluator)


@pytest.mark.asyncio
async def test_default_evaluator_evaluate_passes():
    from unittest.mock import AsyncMock

    gateway = AsyncMock(spec=ModelGateway)
    gateway.complete = AsyncMock()
    gateway.complete.return_value = type("Resp", (), {"content": '{"passed": true, "score": 0.9, "issues": [], "suggestions": []}'})()

    evaluator = DefaultEvaluator(gateway=gateway)
    output = AgentOutput(content="Quality output", employee_id=uuid.uuid4())
    result = await evaluator.evaluate(output, ["accuracy", "completeness"])
    assert isinstance(result, EvaluationResult)
    assert result.passed is True
    assert result.score == 0.9


@pytest.mark.asyncio
async def test_default_evaluator_evaluate_fails():
    from unittest.mock import AsyncMock

    gateway = AsyncMock(spec=ModelGateway)
    gateway.complete = AsyncMock()
    gateway.complete.return_value = type("Resp", (), {"content": '{"passed": false, "score": 0.3, "issues": ["Missing key data"], "suggestions": ["Add supporting evidence"]}'})()

    evaluator = DefaultEvaluator(gateway=gateway)
    output = AgentOutput(content="Incomplete output", employee_id=uuid.uuid4())
    result = await evaluator.evaluate(output, ["accuracy"])
    assert result.passed is False
    assert len(result.issues) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/core/harness/test_evaluator.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.core.harness.evaluator'`

- [ ] **Step 3: Implement DefaultEvaluator**

```python
from __future__ import annotations

import json
from typing import TYPE_CHECKING

from cabinet.agents.context import AgentOutput
from cabinet.core.harness.models import EvaluationResult

if TYPE_CHECKING:
    from cabinet.core.gateway.protocol import ModelGateway


class DefaultEvaluator:
    def __init__(self, gateway: ModelGateway | None = None):
        self._gateway = gateway

    async def evaluate(self, output: AgentOutput, criteria: list[str]) -> EvaluationResult:
        if self._gateway is None:
            return EvaluationResult(
                passed=True,
                score=1.0,
                issues=[],
                suggestions=[],
            )

        criteria_text = ", ".join(criteria)
        prompt = (
            f"Evaluate the following output against these criteria: {criteria_text}.\n"
            f"Output: {output.content}\n\n"
            f'Respond with JSON: {{"passed": bool, "score": float, "issues": [str], "suggestions": [str]}}'
        )
        response = await self._gateway.complete(
            messages=[{"role": "user", "content": prompt}],
            model="default",
        )
        try:
            data = json.loads(response.content)
            return EvaluationResult(
                passed=data.get("passed", False),
                score=data.get("score", 0.0),
                issues=data.get("issues", []),
                suggestions=data.get("suggestions", []),
            )
        except (json.JSONDecodeError, KeyError):
            return EvaluationResult(
                passed=False,
                score=0.0,
                issues=["Failed to parse evaluation response"],
                suggestions=[],
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/core/harness/test_evaluator.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/harness/evaluator.py tests/unit/core/harness/test_evaluator.py
git commit -m "feat: add DefaultEvaluator implementation"
```

---

### Task 14: Harness — WorkflowVerificationGate

**Files:**
- Create: `src/cabinet/core/harness/verification_gate.py`
- Create: `tests/unit/core/harness/test_verification_gate.py`

- [ ] **Step 1: Write the failing tests for WorkflowVerificationGate**

```python
import uuid

import pytest

from cabinet.core.harness.models import EvaluationResult, GateResult
from cabinet.core.harness.protocol import Evaluator
from cabinet.core.harness.verification_gate import WorkflowVerificationGate


def test_workflow_verification_gate_satisfies_protocol():
    from cabinet.core.harness.protocol import VerificationGate
    gate = WorkflowVerificationGate(evaluator=None)
    assert isinstance(gate, VerificationGate)


@pytest.mark.asyncio
async def test_verification_gate_passes():
    gate = WorkflowVerificationGate(evaluator=None)
    result = await gate.check(uuid.uuid4(), {"output": "test"})
    assert isinstance(result, GateResult)
    assert result.passed is True


@pytest.mark.asyncio
async def test_verification_gate_with_evaluator_passes():
    class MockEvaluator:
        async def evaluate(self, output, criteria):
            return EvaluationResult(passed=True, score=0.95)

    gate = WorkflowVerificationGate(evaluator=MockEvaluator())
    result = await gate.check(uuid.uuid4(), {"output": "good output", "criteria": ["quality"]})
    assert result.passed is True


@pytest.mark.asyncio
async def test_verification_gate_with_evaluator_fails():
    class MockEvaluator:
        async def evaluate(self, output, criteria):
            return EvaluationResult(passed=False, score=0.3, issues=["Quality below threshold"])

    gate = WorkflowVerificationGate(evaluator=MockEvaluator())
    result = await gate.check(uuid.uuid4(), {"output": "poor output", "criteria": ["quality"]})
    assert result.passed is False
    assert result.retry_allowed is True
    assert result.reason is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/core/harness/test_verification_gate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.core.harness.verification_gate'`

- [ ] **Step 3: Implement WorkflowVerificationGate**

```python
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING
from uuid import UUID

from cabinet.agents.context import AgentOutput
from cabinet.core.harness.models import GateResult

if TYPE_CHECKING:
    from cabinet.core.harness.protocol import Evaluator


class WorkflowVerificationGate:
    def __init__(self, evaluator: Evaluator | None = None):
        self._evaluator = evaluator

    async def check(self, node_id: UUID, context: dict) -> GateResult:
        if self._evaluator is None:
            return GateResult(passed=True)

        output_text = context.get("output", "")
        criteria = context.get("criteria", [])
        if not criteria:
            return GateResult(passed=True)

        output = AgentOutput(content=output_text, employee_id=context.get("employee_id", uuid.uuid4()))
        result = await self._evaluator.evaluate(output, criteria)

        if result.passed:
            return GateResult(passed=True)

        reason = "; ".join(result.issues) if result.issues else "Quality check failed"
        return GateResult(
            passed=False,
            reason=reason,
            retry_allowed=True,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/core/harness/test_verification_gate.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/harness/verification_gate.py tests/unit/core/harness/test_verification_gate.py
git commit -m "feat: add WorkflowVerificationGate implementation"
```

---

### Task 15: Harness — DefaultEscalationProtocol

**Files:**
- Create: `src/cabinet/core/harness/escalation.py`
- Create: `tests/unit/core/harness/test_escalation.py`

- [ ] **Step 1: Write the failing tests for DefaultEscalationProtocol**

```python
import uuid

import pytest

from cabinet.core.harness.escalation import DefaultEscalationProtocol
from cabinet.core.harness.models import EscalationVerdict
from cabinet.models.decisions import Decision, DecisionStatus, DecisionType
from cabinet.rooms.decision.models import AuthorizationRule


def test_default_escalation_satisfies_protocol():
    from cabinet.core.harness.protocol import EscalationProtocol
    protocol = DefaultEscalationProtocol(rules=[])
    assert isinstance(protocol, EscalationProtocol)


@pytest.mark.asyncio
async def test_escalation_strategic_always_escalates():
    protocol = DefaultEscalationProtocol(rules=[])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Market direction",
        description="Which market to enter",
        captain_id="captain-1",
    )
    verdict = await protocol.should_escalate(decision)
    assert verdict.escalate is True
    assert "strategic" in verdict.reason.lower()


@pytest.mark.asyncio
async def test_escalation_anomaly_escalates():
    protocol = DefaultEscalationProtocol(rules=[])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="System failure",
        description="Critical system failure",
        captain_id="captain-1",
        urgency="red",
    )
    verdict = await protocol.should_escalate(decision)
    assert verdict.escalate is True


@pytest.mark.asyncio
async def test_escalation_execution_with_auto_approve_rule():
    rule = AuthorizationRule(
        captain_id="captain-1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
    )
    protocol = DefaultEscalationProtocol(rules=[rule])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Send email",
        description="Routine email",
        captain_id="captain-1",
    )
    verdict = await protocol.should_escalate(decision)
    assert verdict.escalate is False
    assert verdict.auto_action is not None


@pytest.mark.asyncio
async def test_escalation_execution_no_rule():
    protocol = DefaultEscalationProtocol(rules=[])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Approve budget",
        description="Budget approval",
        captain_id="captain-1",
    )
    verdict = await protocol.should_escalate(decision)
    assert verdict.escalate is True


@pytest.mark.asyncio
async def test_escalation_auto_handle():
    rule = AuthorizationRule(
        captain_id="captain-1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
    )
    protocol = DefaultEscalationProtocol(rules=[rule])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Auto task",
        description="Routine",
        captain_id="captain-1",
    )
    result = await protocol.auto_handle(decision)
    assert result.id == decision.id
    assert result.status == DecisionStatus.APPROVED
```

Note: The last test uses `DecisionStatus.APPROVED`. Check that this status exists in `cabinet.models.decisions`. It does — `DecisionStatus.APPROVED = "approved"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/core/harness/test_escalation.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.core.harness.escalation'`

- [ ] **Step 3: Implement DefaultEscalationProtocol**

```python
from __future__ import annotations

from cabinet.core.harness.models import EscalationVerdict
from cabinet.models.decisions import Decision, DecisionStatus, DecisionType
from cabinet.rooms.decision.models import AuthorizationRule


class DefaultEscalationProtocol:
    def __init__(self, rules: list[AuthorizationRule]):
        self._rules = rules

    async def should_escalate(self, decision: Decision) -> EscalationVerdict:
        if decision.decision_type == DecisionType.STRATEGIC:
            return EscalationVerdict(
                escalate=True,
                reason="Strategic decisions always require Captain",
            )

        if decision.decision_type == DecisionType.ANOMALY:
            return EscalationVerdict(
                escalate=True,
                reason="Anomaly decisions require Captain attention",
            )

        matched_rule = self._find_rule(decision)
        if matched_rule is not None:
            if matched_rule.auto_approve:
                return EscalationVerdict(
                    escalate=False,
                    reason="Matches auto-approve authorization rule",
                    auto_action="auto_approve",
                )
            if matched_rule.notify_only:
                return EscalationVerdict(
                    escalate=False,
                    reason="Matches notify-only rule, Captain notified after execution",
                    auto_action="notify_after",
                )

        if decision.decision_type == DecisionType.EVOLUTION:
            return EscalationVerdict(
                escalate=False,
                reason="Evolution decisions can be auto-handled with notification",
                auto_action="notify_after",
            )

        return EscalationVerdict(
            escalate=True,
            reason=f"No matching authorization rule for {decision.decision_type.value} decision",
        )

    async def auto_handle(self, decision: Decision) -> Decision:
        return decision.model_copy(update={"status": DecisionStatus.APPROVED})

    def _find_rule(self, decision: Decision) -> AuthorizationRule | None:
        for rule in self._rules:
            if rule.decision_type == decision.decision_type and rule.captain_id == decision.captain_id:
                return rule
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/core/harness/test_escalation.py -v`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/harness/escalation.py tests/unit/core/harness/test_escalation.py
git commit -m "feat: add DefaultEscalationProtocol implementation"
```

---

### Task 16: 最终验证

- [ ] **Step 1: Run all tests**

Run: `python -m pytest tests/ -v`
Expected: All tests pass (111 existing + new Layer 3 tests)

- [ ] **Step 2: Run lint check**

Run: `ruff check src/ tests/`
Expected: 0 errors

- [ ] **Step 3: Verify protocol imports work**

Run: `python -c "from cabinet.rooms.meeting.protocol import MeetingRoom; from cabinet.rooms.strategy.protocol import StrategyDecoder; from cabinet.rooms.decision.protocol import DecisionRoom; from cabinet.rooms.office.protocol import OfficeScheduler; from cabinet.rooms.summary.protocol import SummaryRoom; from cabinet.rooms.secretary.protocol import SecretaryAgent; print('All 6 protocols imported successfully')"`
Expected: `All 6 protocols imported successfully`

- [ ] **Step 4: Verify Harness implementations satisfy protocols**

Run: `python -c "from cabinet.core.harness.evaluator import DefaultEvaluator; from cabinet.core.harness.verification_gate import WorkflowVerificationGate; from cabinet.core.harness.escalation import DefaultEscalationProtocol; from cabinet.core.harness.protocol import Evaluator, VerificationGate, EscalationProtocol; assert isinstance(DefaultEvaluator(None), Evaluator); assert isinstance(WorkflowVerificationGate(None), VerificationGate); assert isinstance(DefaultEscalationProtocol([]), EscalationProtocol); print('All 3 Harness implementations verified')"`
Expected: `All 3 Harness implementations verified`

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: final verification and cleanup for Layer 3 protocols"
```
