from __future__ import annotations

import asyncio
from uuid import UUID

from cabinet.agents.context import SkillContext, SkillOutput
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.core.tools.protocol import ToolRegistry


class SkillExecutor:
    def __init__(self, registry: ToolRegistry, gateway: ModelGateway):
        self._registry = registry
        self._gateway = gateway

    async def run(self, skill_id: UUID, inputs: dict, context: SkillContext) -> SkillOutput:
        skill = await self._registry.get_skill(skill_id)
        if skill is None:
            raise ValueError(f"Skill not found: {skill_id}")

        if skill.prompt_template:
            prompt = skill.prompt_template.format(**inputs)
            response = await self._gateway.complete(
                messages=[{"role": "user", "content": prompt}],
                model=context.model,
                temperature=context.temperature,
            )
            return SkillOutput(content=response.content, skill_id=skill.id)
        else:
            registry_output = await self._registry.execute(skill.name, inputs)
            return SkillOutput(content=registry_output.content, skill_id=skill.id)

    def run_sync(self, skill_id: UUID, inputs: dict) -> SkillOutput:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(
                    asyncio.run,
                    self.run(skill_id, inputs, SkillContext()),
                )
                return future.result()
        return asyncio.run(self.run(skill_id, inputs, SkillContext()))
