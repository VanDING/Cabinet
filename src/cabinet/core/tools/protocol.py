from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from pydantic import BaseModel

from cabinet.models.primitives import SkillDefinition


class SkillOutput(BaseModel):
    content: str
    skill_id: UUID


@runtime_checkable
class ToolRegistry(Protocol):
    async def register(self, skill: SkillDefinition) -> None: ...
    async def execute(self, skill_name: str, inputs: dict) -> SkillOutput: ...
    async def list_skills(self) -> list[SkillDefinition]: ...
    async def get_skill(self, skill_id: UUID) -> SkillDefinition | None: ...
