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


# ── tool concurrency partitioning ───────────────────────────

CONCURRENT_SAFE_TOOLS: set[str] = {
    "Read", "Grep", "Glob", "WebSearch", "WebFetch",
    "TodoRead", "TodoWrite",
}

EXCLUSIVE_TOOLS: set[str] = {
    "Bash", "Write", "Edit", "NotebookEdit",
}


def is_concurrency_safe(tool_name: str) -> bool:
    return tool_name in CONCURRENT_SAFE_TOOLS


def _get_tool_name(tc) -> str:
    if hasattr(tc, "function") and hasattr(tc.function, "name"):
        return tc.function.name
    if isinstance(tc, dict):
        return tc.get("function", {}).get("name", "")
    return ""


def partition_tool_calls(tool_calls: list) -> list[list]:
    if not tool_calls:
        return []

    partitions: list[list] = []
    current_batch: list = []

    for tc in tool_calls:
        name = _get_tool_name(tc)
        if name in EXCLUSIVE_TOOLS:
            if current_batch:
                partitions.append(current_batch)
                current_batch = []
            partitions.append([tc])
        else:
            current_batch.append(tc)

    if current_batch:
        partitions.append(current_batch)

    return partitions
