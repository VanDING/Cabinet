from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

TOOLSETS: dict[str, set[str]] = {
    "core": {
        "Read", "Glob", "Grep",
        "Write", "Edit",
        "TodoWrite",
    },
    "code_execution": {
        "Bash",
    },
    "search": {
        "WebSearch", "WebFetch",
    },
    "memory": {
        "Read", "Write",
    },
    "delegation": {
        "Agent", "SendMessage", "TaskCreate", "TaskGet", "TaskList",
    },
    "skills": {
        "Skill",
    },
    "terminal": {
        "Bash", "Read", "Write", "Edit", "Glob", "Grep",
    },
}

PLATFORM_DEFAULTS: dict[str, set[str]] = {
    "cli": {"core", "code_execution", "search", "memory", "delegation", "skills", "terminal"},
    "api": {"core", "code_execution", "search", "memory", "skills"},
    "telegram": {"core", "search", "memory", "skills"},
    "discord": {"core", "search", "memory", "skills"},
}

AGENT_ROLE_DEFAULTS: dict[str, set[str]] = {
    "secretary": {"core", "search", "memory", "skills", "delegation"},
    "explorer": {"core", "search"},
    "executor": {"core", "code_execution", "terminal", "skills"},
    "planner": {"core", "search", "memory"},
}


class ToolsetRegistry:
    def __init__(self, toolsets: dict[str, set[str]] | None = None):
        self._toolsets = dict(toolsets or TOOLSETS)
        self._active: set[str] = set()

    def activate(self, toolset_name: str) -> None:
        if toolset_name not in self._toolsets:
            logger.warning("Unknown toolset: %s", toolset_name)
            return
        self._active.add(toolset_name)
        logger.info("Toolset activated: %s (%d tools)", toolset_name, len(self._toolsets[toolset_name]))

    def deactivate(self, toolset_name: str) -> None:
        self._active.discard(toolset_name)
        logger.info("Toolset deactivated: %s", toolset_name)

    def active_tools(self) -> set[str]:
        tools: set[str] = set()
        for name in self._active:
            tools.update(self._toolsets.get(name, set()))
        return tools

    def activate_for_platform(self, platform: str) -> None:
        defaults = PLATFORM_DEFAULTS.get(platform, {"core"})
        for ts in defaults:
            self.activate(ts)

    def activate_for_role(self, role: str) -> None:
        defaults = AGENT_ROLE_DEFAULTS.get(role, {"core"})
        for ts in defaults:
            self.activate(ts)

    def reset(self) -> None:
        self._active.clear()
