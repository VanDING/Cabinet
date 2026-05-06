from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
    DeliberationSession,
    MeetingLevel,
    Perspective,
)


@runtime_checkable
class MeetingRoom(Protocol):
    async def start_session(
        self, topic: str, level: MeetingLevel, participants: list[UUID]
    ) -> DeliberationSession: ...
    async def add_perspective(
        self, session_id: UUID, agent_id: UUID, content: str
    ) -> Perspective: ...
    async def cross_validate(self, session_id: UUID) -> ConvergenceResult: ...
    async def converge(self, session_id: UUID, max_rounds: int = 3) -> DeliberationResult: ...
    async def wake_expert(self, session_id: UUID, expert_id: UUID) -> None: ...
    async def close_session(self, session_id: UUID) -> DeliberationOutput: ...
