from __future__ import annotations

import shutil
from pathlib import Path

from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.core.tools.skill_loader import SkillLoader
from cabinet.models.primitives import SkillDefinition


class SkillStore:
    def __init__(self, skills_dir: str = "data/skills"):
        self._skills_dir = skills_dir
        self._loader = SkillLoader()

    async def initialize(self, registry: LocalToolRegistry) -> None:
        skills_path = Path(self._skills_dir)
        if not skills_path.exists():
            skills_path.mkdir(parents=True, exist_ok=True)
            return
        for path in skills_path.glob("*.md"):
            skill = self._loader.parse_file(str(path))
            await registry.register(skill)

    async def load_skill(self, path: str, registry: LocalToolRegistry) -> SkillDefinition:
        skill = self._loader.parse_file(path)
        await registry.register(skill)
        dest = Path(self._skills_dir) / Path(path).name
        Path(self._skills_dir).mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, str(dest))
        return skill
