from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.handoff import HandoffRequest, HandoffManager
from cabinet.agents.mailbox import AgentMailbox, MailboxRouter


@pytest.mark.asyncio
async def test_handoff_request_creation():
    req = HandoffRequest(
        from_agent_id=uuid4(), to_agent_id=uuid4(),
        task_description="Analyze financial data",
        context_snapshot={"decision_id": str(uuid4())},
        reason="expertise",
    )
    assert req.reason == "expertise"
    assert req.priority == "normal"


@pytest.mark.asyncio
async def test_handoff_request_with_priority():
    req = HandoffRequest(
        from_agent_id=uuid4(), to_agent_id=uuid4(),
        task_description="Urgent task", context_snapshot={},
        reason="escalation", priority="urgent",
    )
    assert req.priority == "urgent"


@pytest.mark.asyncio
async def test_handoff_manager_request_and_accept():
    router = MailboxRouter()
    from_id, to_id = uuid4(), uuid4()
    from_mb, to_mb = AgentMailbox(from_id), AgentMailbox(to_id)
    router.register(from_id, from_mb)
    router.register(to_id, to_mb)

    manager = HandoffManager(router)

    async def auto_accept():
        msg = await to_mb.receive(timeout=2.0)
        if msg and msg.msg_type == "handoff":
            from uuid import UUID
            req_id = UUID(msg.metadata.get("request_id"))
            await manager.accept_handoff(req_id, to_id)

    import asyncio
    task = asyncio.create_task(auto_accept())

    req = HandoffRequest(
        from_agent_id=from_id, to_agent_id=to_id,
        task_description="delegate analysis", context_snapshot={}, reason="delegation",
    )
    response = await manager.request_handoff(req)
    assert response.accepted is True
    await task


@pytest.mark.asyncio
async def test_handoff_manager_reject():
    router = MailboxRouter()
    from_id, to_id = uuid4(), uuid4()
    from_mb, to_mb = AgentMailbox(from_id), AgentMailbox(to_id)
    router.register(from_id, from_mb)
    router.register(to_id, to_mb)

    manager = HandoffManager(router)

    async def auto_reject():
        msg = await to_mb.receive(timeout=2.0)
        if msg and msg.msg_type == "handoff":
            from uuid import UUID
            req_id = UUID(msg.metadata.get("request_id"))
            await manager.reject_handoff(req_id, "Too busy")

    import asyncio
    task = asyncio.create_task(auto_reject())

    req = HandoffRequest(
        from_agent_id=from_id, to_agent_id=to_id,
        task_description="delegate", context_snapshot={}, reason="capacity",
    )
    response = await manager.request_handoff(req)
    assert response.accepted is False
    assert "Too busy" in response.message
    await task


@pytest.mark.asyncio
async def test_handoff_manager_get_pending():
    router = MailboxRouter()
    from_id, to_id, other_id = uuid4(), uuid4(), uuid4()
    for aid in [from_id, to_id, other_id]:
        router.register(aid, AgentMailbox(aid))

    manager = HandoffManager(router)
    req = HandoffRequest(
        from_agent_id=from_id, to_agent_id=to_id,
        task_description="task 1", context_snapshot={}, reason="expertise",
    )
    await manager.request_handoff(req, wait_for_response=False)

    pending = await manager.get_pending_handoffs(to_id)
    assert len(pending) == 1
    assert pending[0].task_description == "task 1"

    pending_other = await manager.get_pending_handoffs(other_id)
    assert len(pending_other) == 0
