from __future__ import annotations

from crewai.tools import StructuredTool

from cabinet.agents.context import SkillContext, SkillOutput
from cabinet.models.primitives import SkillDefinition


class CrewAISkillAdapter:
    def __init__(self, definition: SkillDefinition, executor):
        self._definition = definition
        self._executor = executor

    @property
    def definition(self) -> SkillDefinition:
        return self._definition

    async def run(self, inputs: dict, context: SkillContext) -> SkillOutput:
        result = await self._executor.run(self._definition.id, inputs, context)
        return result

    def to_crewai_tool(self) -> StructuredTool:
        return StructuredTool.from_function(
            name=self._definition.name,
            description=self._definition.description,
            func=lambda **kwargs: self._executor.run_sync(self._definition.id, kwargs),
        )
