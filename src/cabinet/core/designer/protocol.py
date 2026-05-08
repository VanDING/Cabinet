from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Protocol, runtime_checkable
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class PipeSummary(BaseModel):
    name: str
    description: str
    kind: str
    assigned_to_node: str


class DesignRequest(BaseModel):
    description: str
    project_id: UUID | None = None
    preferred_templates: list[str] = []


class DesignSession(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    captain_id: str
    description: str
    matched_templates: list[UUID] = []
    draft_workflow: dict | None = None
    draft_pipes: list[dict] = []
    status: Literal["drafting", "awaiting_confirm", "confirmed", "rejected"] = "drafting"
    conversation_history: list[dict] = []
    created_at: datetime = Field(default_factory=_now)


class DesignPreview(BaseModel):
    session_id: UUID
    workflow_summary: str
    node_count: int
    pipes: list[PipeSummary]
    suggestions: list[str] = []


@runtime_checkable
class DesignerProtocol(Protocol):
    async def start_design(self, request: DesignRequest) -> DesignSession: ...
    async def refine_design(self, session_id: UUID, feedback: str) -> DesignSession: ...
    async def get_preview(self, session_id: UUID) -> DesignPreview: ...
    async def confirm_design(self, session_id: UUID) -> DesignSession: ...
    async def reject_design(self, session_id: UUID) -> DesignSession: ...
