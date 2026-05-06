from __future__ import annotations

import asyncio
import logging
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from cabinet.agents.mailbox import AgentMessage, MailboxRouter

logger = logging.getLogger(__name__)

HandoffReason = Literal["expertise", "capacity", "escalation", "delegation"]
HandoffPriority = Literal["low", "normal", "high", "urgent"]


class HandoffRequest(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    from_agent_id: UUID
    to_agent_id: UUID
    task_description: str
    context_snapshot: dict
    reason: HandoffReason
    priority: HandoffPriority = "normal"
    deadline: str | None = None


class HandoffResponse(BaseModel):
    request_id: UUID
    accepted: bool
    message: str = ""
    estimated_completion: str | None = None


class HandoffManager:
    def __init__(self, mailbox_router: MailboxRouter):
        self._router = mailbox_router
        self._pending: dict[UUID, HandoffRequest] = {}
        self._resolved: dict[UUID, HandoffResponse] = {}
        self._waiters: dict[UUID, asyncio.Future[HandoffResponse]] = {}

    async def request_handoff(
        self, request: HandoffRequest, wait_for_response: bool = True
    ) -> HandoffResponse | None:
        self._pending[request.id] = request

        msg = AgentMessage(
            sender_id=request.from_agent_id,
            recipient_id=request.to_agent_id,
            msg_type="handoff",
            content=request.task_description,
            metadata={
                "request_id": str(request.id),
                "reason": request.reason,
                "priority": request.priority,
                "context_snapshot": request.context_snapshot,
            },
        )
        await self._router.route(msg)

        if not wait_for_response:
            return None

        if request.id in self._resolved:
            return self._resolved.pop(request.id)

        loop = asyncio.get_event_loop()
        future: asyncio.Future[HandoffResponse] = loop.create_future()
        self._waiters[request.id] = future

        try:
            return await asyncio.wait_for(future, timeout=30.0)
        except asyncio.TimeoutError:
            self._waiters.pop(request.id, None)
            return HandoffResponse(request_id=request.id, accepted=False, message="Handoff timed out")

    async def accept_handoff(self, request_id: UUID, agent_id: UUID) -> None:
        request = self._pending.pop(request_id, None)
        if request is None:
            return
        response = HandoffResponse(request_id=request_id, accepted=True, message="Accepted")
        self._resolved[request_id] = response
        waiter = self._waiters.pop(request_id, None)
        if waiter and not waiter.done():
            waiter.set_result(response)

        reply = AgentMessage(
            sender_id=agent_id,
            recipient_id=request.from_agent_id,
            msg_type="response",
            content=f"Handoff accepted: {request.task_description}",
            metadata={"request_id": str(request_id), "accepted": "true"},
            reply_to=request_id,
        )
        await self._router.route(reply)

    async def reject_handoff(self, request_id: UUID, reason: str) -> None:
        request = self._pending.pop(request_id, None)
        if request is None:
            return
        response = HandoffResponse(request_id=request_id, accepted=False, message=reason)
        self._resolved[request_id] = response
        waiter = self._waiters.pop(request_id, None)
        if waiter and not waiter.done():
            waiter.set_result(response)

    async def get_pending_handoffs(self, agent_id: UUID) -> list[HandoffRequest]:
        return [req for req in self._pending.values() if req.to_agent_id == agent_id]
