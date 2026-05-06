from __future__ import annotations

import pytest

from cabinet.agents.pool import AgentPool, AgentState, PooledAgent, PoolExhaustedError
from cabinet.agents.mailbox import AgentMailbox, MailboxRouter
from cabinet.agents.stub_factory import StubAgentFactory


@pytest.fixture
def pool():
    router = MailboxRouter()
    factory = StubAgentFactory()
    return AgentPool(factory=factory, mailbox_router=router, max_per_role=2)


@pytest.mark.asyncio
async def test_pool_acquire_creates_agent(pool):
    agent = await pool.acquire("advisor")
    assert isinstance(agent, PooledAgent)
    assert agent.state == AgentState.BUSY
    assert agent.employee.role == "advisor"


@pytest.mark.asyncio
async def test_pool_acquire_reuses_idle(pool):
    agent1 = await pool.acquire("advisor")
    await pool.release(agent1.agent_id)
    agent2 = await pool.acquire("advisor")
    assert agent2.agent_id == agent1.agent_id


@pytest.mark.asyncio
async def test_pool_release_sets_idle(pool):
    agent = await pool.acquire("advisor")
    assert agent.state == AgentState.BUSY
    await pool.release(agent.agent_id)
    state = await pool.get_state(agent.agent_id)
    assert state == AgentState.IDLE


@pytest.mark.asyncio
async def test_pool_list_by_role(pool):
    await pool.acquire("advisor")
    await pool.acquire("executor")
    advisors = await pool.list_by_role("advisor")
    assert len(advisors) == 1


@pytest.mark.asyncio
async def test_pool_list_idle(pool):
    agent = await pool.acquire("advisor")
    idle = await pool.list_idle()
    assert len(idle) == 0
    await pool.release(agent.agent_id)
    idle = await pool.list_idle()
    assert len(idle) == 1


@pytest.mark.asyncio
async def test_pool_max_per_role_exhausted(pool):
    await pool.acquire("advisor")
    await pool.acquire("advisor")
    with pytest.raises(PoolExhaustedError):
        await pool.acquire("advisor", timeout=0.2)


@pytest.mark.asyncio
async def test_pool_terminate(pool):
    agent = await pool.acquire("advisor")
    await pool.terminate(agent.agent_id)
    state = await pool.get_state(agent.agent_id)
    assert state == AgentState.TERMINATED


@pytest.mark.asyncio
async def test_pool_health_check(pool):
    await pool.acquire("advisor")
    health = await pool.health_check()
    assert health["total"] == 1
    assert health["by_state"]["busy"] == 1


@pytest.mark.asyncio
async def test_pool_get_mailbox(pool):
    agent = await pool.acquire("advisor")
    mb = pool.get_mailbox(agent.agent_id)
    assert isinstance(mb, AgentMailbox)
    assert mb.agent_id == agent.agent_id
