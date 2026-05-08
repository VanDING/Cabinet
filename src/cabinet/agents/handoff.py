from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
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
    def __init__(self, mailbox_router: MailboxRouter, hooks=None):
        self._router = mailbox_router
        self._hooks = hooks
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

    async def auto_route(
        self, task: str, from_agent_id: str,
        capability_registry,
        strategy: str = "least_loaded",
    ) -> object | None:
        """Auto-discover best target agent by capability and send handoff."""
        try:
            candidates = capability_registry.discover(query=task)
        except Exception:
            return None

        if not candidates:
            return None

        best = self._select_best(candidates, strategy)

        request = HandoffRequest(
            from_agent_id=from_agent_id,
            to_agent_id=best.get("agent_id", best.get("id", "")),
            task_description=task,
            context_snapshot={
                "task": task,
                "reason": best.get("match_reason", "auto-routed"),
                "strategy": strategy,
            },
            reason="expertise",
        )

        # Fire before_handoff hook if set
        if self._hooks and self._hooks.before_handoff:
            await self._hooks.before_handoff(request)

        return await self.request_handoff(request)

    @staticmethod
    def _select_best(candidates: list, strategy: str) -> dict:
        """Select best candidate by routing strategy."""
        if not candidates:
            raise ValueError("No candidates")
        if strategy == "least_loaded":
            candidates = sorted(
                candidates,
                key=lambda c: c.get("current_load", 0) if isinstance(c, dict) else getattr(c, "load", 0),
            )
        elif strategy == "highest_skill_match":
            candidates = sorted(
                candidates,
                key=lambda c: c.get("skill_count", 0) if isinstance(c, dict) else len(getattr(c, "skills", [])),
                reverse=True,
            )
        return candidates[0]


@dataclass
class HandoffHooks:
    """Lifecycle hooks for handoff operations."""
    before_handoff: Callable[..., Awaitable[None]] | None = None
    after_accept: Callable[..., Awaitable[None]] | None = None
    on_reject: Callable[..., Awaitable[None]] | None = None
    on_timeout: Callable[..., Awaitable[None]] | None = None
