from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class ReasoningStrategy(str, Enum):
    AUTO = "auto"
    OFF = "off"
    ON = "on"


class Pipe(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    name: str
    description: str
    kind: str
    system_prompt: str
    tool_ids: list[str | UUID] = []
    reasoning: dict = {}
    input_schema: dict = {}
    output_schema: dict = {}
    metadata: dict = {}
    created_at: datetime = Field(default_factory=_now)


__all__ = ["Pipe", "ReasoningStrategy"]
