from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

logger = logging.getLogger(__name__)


class SkillLifecycleHook(Protocol):
    async def on_skill_created(self, skill_name: str, source: str) -> None: ...
    async def on_skill_improved(self, skill_name: str, reason: str) -> None: ...
    async def on_skill_deprecated(self, skill_name: str, reason: str) -> None: ...


@dataclass
class SkillCurator:
    skills_dir: Path
    lifecycle_hooks: list[SkillLifecycleHook] = field(default_factory=list)
    _skills: dict[str, dict] = field(default_factory=dict)

    async def register_skill(self, name: str, source: str, metadata: dict | None = None) -> None:
        self._skills[name] = {
            "source": source,
            "metadata": metadata or {},
            "use_count": 0,
            "created_at": time.monotonic(),
        }
        for hook in self.lifecycle_hooks:
            await hook.on_skill_created(name, source)
        logger.info("Skill registered: %s (from %s)", name, source)

    async def record_use(self, name: str) -> None:
        if name in self._skills:
            self._skills[name]["use_count"] += 1

    async def review_and_improve(
        self, name: str, gateway=None
    ) -> str | None:
        if name not in self._skills:
            return None
        skill = self._skills[name]
        if skill["use_count"] < 3:
            return None
        improvement = f"Skill '{name}' used {skill['use_count']} times — consider version bump"
        for hook in self.lifecycle_hooks:
            await hook.on_skill_improved(name, improvement)
        return improvement

    def list_skills(self) -> list[str]:
        return sorted(self._skills.keys())

    def get_skill_info(self, name: str) -> dict | None:
        return self._skills.get(name)
