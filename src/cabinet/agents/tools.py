from __future__ import annotations

import logging
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

from cabinet.core.tools.registry import LocalToolRegistry

logger = logging.getLogger(__name__)

ToolSource = Literal["skill", "mcp", "builtin"]


class ToolDefinition(BaseModel):
    name: str
    description: str
    input_schema: dict = {"type": "object", "properties": {}}
    output_schema: dict | None = None
    handler: str | None = None
    source: ToolSource = "skill"

    def to_openai_schema(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            },
        }


class ToolRegistryAdapter:
    def __init__(self, tool_registry: LocalToolRegistry):
        self._registry = tool_registry

    def get_tool_definitions(self, skill_ids: list[UUID] | None = None) -> list[ToolDefinition]:
        skills = list(self._registry._skills.values())
        if skill_ids:
            skills = [s for s in skills if s.id in skill_ids]
        return [
            ToolDefinition(
                name=s.name, description=s.description,
                input_schema=s.input_schema or {"type": "object", "properties": {}},
                output_schema=s.output_schema, handler=str(s.id), source="skill",
            )
            for s in skills
        ]

    async def execute_tool(self, name: str, arguments: dict) -> Any:
        return await self._registry.execute(name, arguments)
