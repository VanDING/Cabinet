from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.recovery import RecoveryConfig, RecoveryAction, AgentRecovery
from cabinet.agents.pool import AgentPool, AgentState
from cabinet.agents.mailbox import MailboxRouter
from cabinet.agents.stub_factory import StubAgentFactory


@pytest.fixture
def pool():
    router = MailboxRouter()
    factory = StubAgentFactory()
    return AgentPool(factory=factory, mailbox_router=router, max_per_role=3)


@pytest.mark.asyncio
async def test_record_failure(pool):
    recovery = AgentRecovery(pool)
    agent_id = uuid4()
    await recovery.record_failure(agent_id, "timeout", "Task took too long")
    records = await recovery.get_failures(agent_id)
    assert len(records) == 1
    assert records[0].error_type == "timeout"


@pytest.mark.asyncio
async def test_decide_retry_on_first_failure(pool):
    recovery = AgentRecovery(pool)
    agent_id = uuid4()
    await recovery.record_failure(agent_id, "timeout", "Task took too long")
    action = await recovery.decide_action(agent_id)
    assert action == RecoveryAction.RETRY


@pytest.mark.asyncio
async def test_decide_replace_after_max_retries(pool):
    recovery = AgentRecovery(pool, config=RecoveryConfig(max_retries=2))
    agent_id = uuid4()
    await recovery.record_failure(agent_id, "timeout", "fail 1")
    await recovery.record_failure(agent_id, "timeout", "fail 2")
    await recovery.record_failure(agent_id, "timeout", "fail 3")
    action = await recovery.decide_action(agent_id)
    assert action == RecoveryAction.REPLACE


@pytest.mark.asyncio
async def test_decide_escalate_on_critical(pool):
    recovery = AgentRecovery(pool)
    agent_id = uuid4()
    await recovery.record_failure(agent_id, "critical", "System failure")
    action = await recovery.decide_action(agent_id)
    assert action == RecoveryAction.ESCALATE


@pytest.mark.asyncio
async def test_execute_retry(pool):
    recovery = AgentRecovery(pool)
    agent = await pool.acquire("advisor")
    await pool.set_state(agent.agent_id, AgentState.ERROR)
    result = await recovery.execute_recovery(agent.agent_id, RecoveryAction.RETRY)
    assert result is True
    state = await pool.get_state(agent.agent_id)
    assert state == AgentState.IDLE


@pytest.mark.asyncio
async def test_execute_replace(pool):
    recovery = AgentRecovery(pool)
    agent = await pool.acquire("advisor")
    result = await recovery.execute_recovery(agent.agent_id, RecoveryAction.REPLACE, role="advisor")
    assert result is True


@pytest.mark.asyncio
async def test_get_failure_stats(pool):
    recovery = AgentRecovery(pool)
    a1, a2 = uuid4(), uuid4()
    await recovery.record_failure(a1, "timeout", "fail")
    await recovery.record_failure(a1, "timeout", "fail")
    await recovery.record_failure(a2, "error", "fail")
    stats = await recovery.get_stats()
    assert stats["total_failures"] == 3
    assert stats["by_type"]["timeout"] == 2
    assert stats["by_type"]["error"] == 1
