from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.models.decisions import Decision
from cabinet.rooms.secretary.models import (
    ConflictAlert,
    DailyBrief,
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    PipeCalibration,
    PipeTemplate,
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

    # === V0.2.0 ===
    async def recommend_templates(self, description: str) -> list[PipeTemplate]: ...
    async def calibrate_pipe(self, pipe_id: UUID, history: list[dict]) -> PipeCalibration: ...
    async def generate_daily_brief(self, captain_id: str) -> DailyBrief: ...
    async def detect_cross_project_conflicts(self, captain_id: str) -> list[ConflictAlert]: ...
