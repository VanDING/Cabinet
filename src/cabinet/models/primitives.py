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


class MemoryScope(str, Enum):
    SHORT_TERM = "short_term"
    LONG_TERM = "long_term"
    ENTITY = "entity"


class Organization(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    name: str
    captain_id: str
    created_at: datetime = Field(default_factory=_now)
    projects: list[UUID] = []


class Project(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    organization_id: UUID
    name: str
    description: str
    status: str = "active"
    teams: list[UUID] = []
    workflows: list[UUID] = []
    decisions: list[UUID] = []
    created_at: datetime = Field(default_factory=_now)


class Team(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    name: str
    purpose: str
    employees: list[UUID] = []
    created_at: datetime = Field(default_factory=_now)


class Employee(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    team_id: UUID
    name: str
    role: str
    kind: str
    personality: str | None = None
    skills: list[UUID] = []
    permission_level: str = "L2"
    created_at: datetime = Field(default_factory=_now)

    # === V0.2.0 ===
    pipe_id: UUID | None = None
    persona_id: UUID | None = None
    pipe_params: dict = {}


class SkillDefinition(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    name: str
    description: str
    kind: str
    input_schema: dict
    output_schema: dict
    prompt_template: str | None = None
    requires_knowledge: list[UUID] = []
    requires_human_approval: bool = False
    sub_workflow: UUID | None = None


class Knowledge(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    name: str
    description: str
    source_paths: list[str] = []
    indexed_at: datetime | None = None


class MemoryItem(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    owner_id: UUID
    scope: MemoryScope
    content: str
    embedding: list[float] | None = None
    metadata: dict = {}
    created_at: datetime = Field(default_factory=_now)
    accessed_at: datetime | None = None
