from __future__ import annotations

from cabinet.core.tools.toolsets import TOOLSETS, ToolsetRegistry


class TestToolsetDefinitions:
    def test_core_toolset_exists(self):
        assert "core" in TOOLSETS
        assert "Read" in TOOLSETS["core"]
        assert "Write" in TOOLSETS["core"]

    def test_search_toolset_exists(self):
        assert "search" in TOOLSETS
        assert "WebSearch" in TOOLSETS["search"] or "Glob" in TOOLSETS["search"]

    def test_each_toolset_is_set(self):
        for name in TOOLSETS:
            assert isinstance(TOOLSETS[name], set)


class TestToolsetRegistry:
    def test_activate_toolset_makes_tools_available(self):
        reg = ToolsetRegistry()
        reg.activate("core")
        assert "Read" in reg.active_tools()

    def test_deactivate_toolset_removes_tools(self):
        reg = ToolsetRegistry()
        reg.activate("core")
        reg.deactivate("core")
        assert "Read" not in reg.active_tools()

    def test_multiple_toolsets_union(self):
        reg = ToolsetRegistry()
        reg.activate("core")
        reg.activate("code_execution")
        active = reg.active_tools()
        assert "Read" in active
        assert "Bash" in active

    def test_platform_default_toolset(self):
        reg = ToolsetRegistry()
        reg.activate_for_platform("telegram")
        active = reg.active_tools()
        assert len(active) > 0

    def test_role_default_toolset(self):
        reg = ToolsetRegistry()
        reg.activate_for_role("explorer")
        active = reg.active_tools()
        assert len(active) > 0

    def test_reset_clears_all(self):
        reg = ToolsetRegistry()
        reg.activate("core")
        reg.activate("search")
        reg.reset()
        assert len(reg.active_tools()) == 0
