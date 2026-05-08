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
    async def process_input(
        self, captain_input: str, context: InteractionContext
    ) -> SecretaryResponse: ...
    async def summarize_pending(self, captain_id: str) -> PendingSummary: ...
    async def notify(self, event: NotificationEvent) -> NotificationResult: ...
    async def filter_decision(self, decision: Decision) -> FilterResult: ...
