from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from cabinet.core.tools.protocol import SkillOutput
from cabinet.models.primitives import SkillDefinition

if TYPE_CHECKING:
    from cabinet.agents.skill_executor import SkillExecutor
    from cabinet.core.tools.mcp_connector import MCPConnector
    from cabinet.core.tools.toolsets import ToolsetRegistry


class LocalToolRegistry:
    def __init__(self):
        self._skills: dict[str, SkillDefinition] = {}
        self._skills_by_id: dict[UUID, SkillDefinition] = {}
        self._executor: SkillExecutor | None = None
        self._mcp_connector: MCPConnector | None = None
        self._mcp_skill_names: set[str] = set()
        self._toolset_registry: "ToolsetRegistry | None" = None

    def set_executor(self, executor: SkillExecutor) -> None:
        self._executor = executor

    def set_mcp_connector(self, connector: MCPConnector) -> None:
        self._mcp_connector = connector

    def set_toolset_registry(self, registry: "ToolsetRegistry") -> None:
        self._toolset_registry = registry

    async def register(self, skill: SkillDefinition) -> None:
        self._skills[skill.name] = skill
        self._skills_by_id[skill.id] = skill

    async def execute(self, skill_name: str, inputs: dict) -> SkillOutput:
        skill = self._skills.get(skill_name)
        if skill is None:
            raise ValueError(f"Skill not found: {skill_name}")

        if skill_name in self._mcp_skill_names and self._mcp_connector is not None:
            result = await self._mcp_connector.call_tool(skill_name, inputs)
            return SkillOutput(content=result.get("content", ""), skill_id=skill.id)

        if skill.prompt_template and self._executor is not None:
            from cabinet.agents.context import SkillContext

            result = await self._executor.run(skill.id, inputs, SkillContext())
            return SkillOutput(content=result.content, skill_id=skill.id)

        return SkillOutput(content=f"Executed {skill_name}", skill_id=skill.id)

    async def list_skills(self) -> list[SkillDefinition]:
        return list(self._skills.values())

    async def list_active_skills(self) -> list:
        if self._toolset_registry is None:
            return list(self._skills.values())
        active_names = self._toolset_registry.active_tools()
        return [
            s for name, s in self._skills.items()
            if name in active_names
        ]

    async def get_skill(self, skill_id: UUID) -> SkillDefinition | None:
        return self._skills_by_id.get(skill_id)
