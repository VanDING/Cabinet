from __future__ import annotations

import asyncio
import logging
from typing import Callable, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

MsgType = Literal["request", "response", "notify", "handoff", "broadcast"]


class AgentMessage(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    sender_id: UUID
    recipient_id: UUID
    msg_type: MsgType
    content: str
    metadata: dict = {}
    reply_to: UUID | None = None
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class AgentMailbox:
    def __init__(self, agent_id: UUID):
        self._agent_id = agent_id
        self._queue: asyncio.Queue[AgentMessage] = asyncio.Queue()
        self._subscribers: dict[str, list[Callable]] = {}
        self._router: MailboxRouter | None = None

    @property
    def agent_id(self) -> UUID:
        return self._agent_id

    def _set_router(self, router: MailboxRouter) -> None:
        self._router = router

    async def send(
        self, recipient_id: UUID, msg_type: MsgType, content: str,
        reply_to: UUID | None = None, **metadata
    ) -> UUID:
        msg = AgentMessage(
            sender_id=self._agent_id,
            recipient_id=recipient_id,
            msg_type=msg_type,
            content=content,
            metadata=metadata,
            reply_to=reply_to,
        )
        if self._router is not None:
            await self._router.route(msg)
        return msg.id

    async def receive(self, timeout: float = 30.0) -> AgentMessage | None:
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    async def broadcast(
        self, msg_type: MsgType, content: str, agent_ids: list[UUID]
    ) -> None:
        for aid in agent_ids:
            msg = AgentMessage(
                sender_id=self._agent_id,
                recipient_id=aid,
                msg_type="broadcast",
                content=content,
            )
            if self._router is not None:
                await self._router.route(msg)

    def on_message(self, msg_type: str, handler: Callable) -> None:
        if msg_type not in self._subscribers:
            self._subscribers[msg_type] = []
        self._subscribers[msg_type].append(handler)

    async def _deliver(self, message: AgentMessage) -> None:
        await self._queue.put(message)
        handlers = self._subscribers.get(message.msg_type, [])
        for handler in handlers:
            try:
                handler(message)
            except Exception:
                logger.exception("Handler error for msg_type=%s", message.msg_type)


class MailboxRouter:
    def __init__(self):
        self._mailboxes: dict[UUID, AgentMailbox] = {}

    def register(self, agent_id: UUID, mailbox: AgentMailbox) -> None:
        self._mailboxes[agent_id] = mailbox
        mailbox._set_router(self)

    def unregister(self, agent_id: UUID) -> None:
        mb = self._mailboxes.pop(agent_id, None)
        if mb is not None:
            mb._set_router(None)

    def get_mailbox(self, agent_id: UUID) -> AgentMailbox | None:
        return self._mailboxes.get(agent_id)

    async def route(self, message: AgentMessage) -> None:
        recipient = self._mailboxes.get(message.recipient_id)
        if recipient is None:
            logger.warning("No mailbox for recipient %s", message.recipient_id)
            return
        await recipient._deliver(message)

    async def send_request(
        self,
        sender_id: UUID,
        recipient_id: UUID,
        content: str,
        timeout: float = 30.0,
    ) -> AgentMessage | None:
        msg = AgentMessage(
            sender_id=sender_id,
            recipient_id=recipient_id,
            msg_type="request",
            content=content,
        )
        await self.route(msg)
        sender_mb = self._mailboxes.get(sender_id)
        if sender_mb is None:
            return None
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                return None
            candidate = await sender_mb.receive(timeout=min(remaining, 0.5))
            if candidate is not None:
                if candidate.msg_type == "response" and candidate.reply_to == msg.id:
                    return candidate
                await sender_mb._queue.put(candidate)
                await asyncio.sleep(0.05)
