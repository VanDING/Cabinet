from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.debate import DebateConfig, DebateProtocol, DebateResult
from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.agents.mailbox import MailboxRouter


class MockDebater:
    def __init__(self, agent_id, responses=None):
        self._agent_id = agent_id
        self._responses = responses or ["I support this proposal"]
        self._call_index = 0

    @property
    def employee(self):
        from cabinet.models.primitives import Employee
        return Employee(id=self._agent_id, team_id=uuid4(), name="mock", role="debater", kind="ai")

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        content = self._responses[self._call_index % len(self._responses)]
        self._call_index += 1
        return AgentOutput(content=content, employee_id=self._agent_id)


@pytest.mark.asyncio
async def test_debate_basic():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockDebater(p1, responses=["Pro: This is beneficial"]),
        p2: MockDebater(p2, responses=["Con: This has risks"]),
    }
    protocol = DebateProtocol(agents=agents, mailbox_router=router)
    config = DebateConfig(pro_position=p1, con_position=p2, max_rounds=1)
    result = await protocol.run_debate("Should we adopt AI?", config)
    assert isinstance(result, DebateResult)
    assert result.topic == "Should we adopt AI?"
    assert len(result.positions) == 2


@pytest.mark.asyncio
async def test_debate_consensus_reached():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockDebater(p1, responses=["Pro with reservations", "I agree with the compromise"]),
        p2: MockDebater(p2, responses=["Con but willing to compromise", "I accept the compromise"]),
    }
    protocol = DebateProtocol(agents=agents, mailbox_router=router)
    config = DebateConfig(pro_position=p1, con_position=p2, max_rounds=3, consensus_threshold=0.7)
    result = await protocol.run_debate("Topic", config)
    assert result.consensus_reached is True


@pytest.mark.asyncio
async def test_debate_no_consensus():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockDebater(p1, responses=["I strongly support this"]),
        p2: MockDebater(p2, responses=["I strongly oppose this"]),
    }
    protocol = DebateProtocol(agents=agents, mailbox_router=router)
    config = DebateConfig(pro_position=p1, con_position=p2, max_rounds=2, consensus_threshold=0.9)
    result = await protocol.run_debate("Topic", config)
    assert result.consensus_reached is False


@pytest.mark.asyncio
async def test_debate_positions():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockDebater(p1, responses=["Pro argument"]),
        p2: MockDebater(p2, responses=["Con argument"]),
    }
    protocol = DebateProtocol(agents=agents, mailbox_router=router)
    config = DebateConfig(pro_position=p1, con_position=p2, max_rounds=1)
    result = await protocol.run_debate("Topic", config)
    pro_positions = [p for p in result.positions if p.stance == "pro"]
    con_positions = [p for p in result.positions if p.stance == "con"]
    assert len(pro_positions) >= 1
    assert len(con_positions) >= 1
