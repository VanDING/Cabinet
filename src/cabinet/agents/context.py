from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class AgentContext(BaseModel):
    model: str = "default"
    temperature: float = 0.7
    max_tokens: int | None = None


class AgentOutput(BaseModel):
    content: str
    employee_id: UUID
    status: str = "completed"
    structured_data: dict | None = None
    artifacts: list[dict] = []
    token_usage: dict | None = None
    duration_ms: float | None = None


class SkillContext(BaseModel):
    model: str = "default"
    temperature: float = 0.7


class SkillOutput(BaseModel):
    content: str
    skill_id: UUID


class TeamContext(BaseModel):
    model: str = "default"


class TeamOutput(BaseModel):
    content: str
    team_id: UUID
