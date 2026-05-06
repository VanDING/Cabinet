from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.dialogue import DialogueConfig, DialogueOrchestrator, DialogueResult
from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.agents.mailbox import MailboxRouter


class MockAgent:
    def __init__(self, employee_id, responses=None):
        self._employee_id = employee_id
        self._responses = responses or ["I agree"]
        self._call_index = 0

    @property
    def employee(self):
        from cabinet.models.primitives import Employee
        return Employee(id=self._employee_id, team_id=uuid4(), name="mock", role="advisor", kind="ai")

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        content = self._responses[self._call_index % len(self._responses)]
        self._call_index += 1
        return AgentOutput(content=content, employee_id=self._employee_id)


@pytest.mark.asyncio
async def test_dialogue_round_robin():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["First perspective"]),
        p2: MockAgent(p2, responses=["Second perspective"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(participants=[p1, p2], mode="round_robin", max_rounds=1)
    result = await orchestrator.start_dialogue(config, "Test topic", {})
    assert isinstance(result, DialogueResult)
    assert len(result.turns) == 2
    assert result.total_rounds == 1


@pytest.mark.asyncio
async def test_dialogue_multiple_rounds():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["A1", "A2"]),
        p2: MockAgent(p2, responses=["B1", "B2"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(participants=[p1, p2], mode="round_robin", max_rounds=2)
    result = await orchestrator.start_dialogue(config, "Topic", {})
    assert result.total_rounds == 2
    assert len(result.turns) == 4


@pytest.mark.asyncio
async def test_dialogue_convergence():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["I agree with the proposal"]),
        p2: MockAgent(p2, responses=["I also agree with the proposal"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(
        participants=[p1, p2], mode="round_robin", max_rounds=3,
        convergence_check="consensus",
    )
    result = await orchestrator.start_dialogue(config, "Topic", {})
    assert result.converged is True


@pytest.mark.asyncio
async def test_dialogue_no_convergence():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["I strongly oppose this"]),
        p2: MockAgent(p2, responses=["I strongly support this"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(
        participants=[p1, p2], mode="round_robin", max_rounds=2,
        convergence_check="consensus",
    )
    result = await orchestrator.start_dialogue(config, "Topic", {})
    assert result.converged is False


@pytest.mark.asyncio
async def test_dialogue_turn_order():
    router = MailboxRouter()
    p1, p2, p3 = uuid4(), uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["P1"]),
        p2: MockAgent(p2, responses=["P2"]),
        p3: MockAgent(p3, responses=["P3"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(participants=[p1, p2, p3], mode="round_robin", max_rounds=1)
    result = await orchestrator.start_dialogue(config, "Topic", {})
    assert result.turns[0].agent_id == p1
    assert result.turns[1].agent_id == p2
    assert result.turns[2].agent_id == p3
