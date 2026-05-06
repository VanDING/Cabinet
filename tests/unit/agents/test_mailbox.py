from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.mailbox import AgentMessage, AgentMailbox, MailboxRouter


@pytest.mark.asyncio
async def test_agent_message_creation():
    sender = uuid4()
    recipient = uuid4()
    msg = AgentMessage(sender_id=sender, recipient_id=recipient, msg_type="notify", content="hello")
    assert msg.sender_id == sender
    assert msg.recipient_id == recipient
    assert msg.msg_type == "notify"
    assert msg.content == "hello"
    assert msg.reply_to is None
    assert msg.metadata == {}


@pytest.mark.asyncio
async def test_agent_message_with_reply_to():
    sender = uuid4()
    recipient = uuid4()
    original_id = uuid4()
    msg = AgentMessage(
        sender_id=sender, recipient_id=recipient, msg_type="response",
        content="reply", reply_to=original_id,
    )
    assert msg.reply_to == original_id


@pytest.mark.asyncio
async def test_mailbox_send_and_receive():
    router = MailboxRouter()
    agent_id = uuid4()
    other_id = uuid4()
    mailbox = AgentMailbox(agent_id)
    router.register(agent_id, mailbox)
    other_mailbox = AgentMailbox(other_id)
    router.register(other_id, other_mailbox)

    msg_id = await mailbox.send(other_id, "notify", "hello from agent")
    assert msg_id is not None

    received = await other_mailbox.receive(timeout=1.0)
    assert received is not None
    assert received.content == "hello from agent"
    assert received.sender_id == agent_id


@pytest.mark.asyncio
async def test_mailbox_receive_timeout():
    agent_id = uuid4()
    mailbox = AgentMailbox(agent_id)
    result = await mailbox.receive(timeout=0.1)
    assert result is None


@pytest.mark.asyncio
async def test_mailbox_broadcast():
    router = MailboxRouter()
    sender_id = uuid4()
    recipient_ids = [uuid4(), uuid4()]
    sender_mb = AgentMailbox(sender_id)
    router.register(sender_id, sender_mb)
    for rid in recipient_ids:
        router.register(rid, AgentMailbox(rid))

    await sender_mb.broadcast("notify", "announcement", recipient_ids)

    for rid in recipient_ids:
        mb = router.get_mailbox(rid)
        received = await mb.receive(timeout=1.0)
        assert received is not None
        assert received.content == "announcement"
        assert received.msg_type == "broadcast"


@pytest.mark.asyncio
async def test_mailbox_on_message_handler():
    agent_id = uuid4()
    mailbox = AgentMailbox(agent_id)
    received_messages = []

    def handler(msg: AgentMessage):
        received_messages.append(msg)

    mailbox.on_message("notify", handler)

    router = MailboxRouter()
    router.register(agent_id, mailbox)
    other_id = uuid4()
    other_mb = AgentMailbox(other_id)
    router.register(other_id, other_mb)

    await other_mb.send(agent_id, "notify", "test notification")
    import asyncio
    await asyncio.sleep(0.1)

    assert len(received_messages) == 1
    assert received_messages[0].content == "test notification"


@pytest.mark.asyncio
async def test_mailbox_router_unregister():
    router = MailboxRouter()
    agent_id = uuid4()
    mailbox = AgentMailbox(agent_id)
    router.register(agent_id, mailbox)
    assert router.get_mailbox(agent_id) is not None
    router.unregister(agent_id)
    assert router.get_mailbox(agent_id) is None


@pytest.mark.asyncio
async def test_mailbox_router_send_request():
    router = MailboxRouter()
    sender_id = uuid4()
    recipient_id = uuid4()
    sender_mb = AgentMailbox(sender_id)
    recipient_mb = AgentMailbox(recipient_id)
    router.register(sender_id, sender_mb)
    router.register(recipient_id, recipient_mb)

    async def auto_respond():
        msg = await recipient_mb.receive(timeout=2.0)
        if msg:
            await recipient_mb.send(sender_id, "response", f"re: {msg.content}", reply_to=msg.id)

    import asyncio
    task = asyncio.create_task(auto_respond())
    reply = await router.send_request(sender_id, recipient_id, "ping", timeout=2.0)
    assert reply is not None
    assert reply.content == "re: ping"
    assert reply.msg_type == "response"
    await task


@pytest.mark.asyncio
async def test_mailbox_router_send_request_timeout():
    router = MailboxRouter()
    sender_id = uuid4()
    recipient_id = uuid4()
    sender_mb = AgentMailbox(sender_id)
    recipient_mb = AgentMailbox(recipient_id)
    router.register(sender_id, sender_mb)
    router.register(recipient_id, recipient_mb)

    reply = await router.send_request(sender_id, recipient_id, "ping", timeout=0.2)
    assert reply is None
