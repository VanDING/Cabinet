from __future__ import annotations

from cabinet.core.harness.permissions import (
    PermissionEngine,
    PermissionMode,
    PermissionContext,
)


def _make_context(tool="bash", params=None, mode=PermissionMode.DEFAULT):
    return PermissionContext(
        tool_name=tool,
        tool_params=params or {},
        mode=mode,
        working_dir="/tmp/test",
    )


class TestPermissionModes:
    def test_bypass_skips_most_checks(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="bash", params={"command": "rm file"},
                            mode=PermissionMode.BYPASS)
        result = engine.check(ctx)
        assert result.allowed

    def test_plan_mode_blocks_write_tools(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Write", mode=PermissionMode.PLAN)
        result = engine.check(ctx)
        assert not result.allowed

    def test_plan_mode_allows_read_tools(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Read", mode=PermissionMode.PLAN)
        result = engine.check(ctx)
        assert result.allowed

    def test_dont_ask_mode_denies_when_ask_required(self):
        engine = PermissionEngine()
        engine.add_ask_rule("bash", "git push*")
        ctx = _make_context(tool="bash", params={"command": "git push origin main"},
                            mode=PermissionMode.DONT_ASK)
        result = engine.check(ctx)
        assert not result.allowed

    def test_default_mode_requires_input_for_write(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Write", mode=PermissionMode.DEFAULT)
        result = engine.check(ctx)
        assert result.needs_user_input


class TestToolDenyRules:
    def test_deny_rule_blocks_regardless_of_mode(self):
        engine = PermissionEngine()
        engine.add_deny_rule("bash", "rm -rf *")
        ctx = _make_context(tool="bash", params={"command": "rm -rf /"},
                            mode=PermissionMode.BYPASS)
        result = engine.check(ctx)
        assert not result.allowed
        assert "deny rule" in result.reason.lower()

    def test_sandbox_protected_paths_blocked_in_bypass(self):
        engine = PermissionEngine()
        ctx = _make_context(
            tool="Write",
            params={"file_path": "/home/user/.gitconfig"},
            mode=PermissionMode.BYPASS,
        )
        result = engine.check(ctx)
        assert not result.allowed


class TestAutoModeClassifier:
    def test_safe_read_tool_allowed_without_ask(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Read", mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert result.allowed

    def test_safe_search_tool_allowed_without_ask(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="Grep", mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert result.allowed

    def test_dangerous_bash_requires_ask_in_auto(self):
        engine = PermissionEngine()
        ctx = _make_context(tool="bash", params={"command": "sudo rm -rf /"},
                            mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert result.needs_user_input

    def test_circuit_open_blocks_in_auto_mode(self):
        engine = PermissionEngine()
        engine.denial_tracker.record_denial("bash", "rm")
        engine.denial_tracker.record_denial("bash", "rm")
        engine.denial_tracker.record_denial("bash", "rm")
        ctx = _make_context(tool="bash", params={"command": "ls"},
                            mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert not result.allowed


class TestPermissionRules:
    def test_always_allow_rule_overrides_auto_classifier(self):
        engine = PermissionEngine()
        engine.add_allow_rule("bash", "ls *")
        ctx = _make_context(tool="bash", params={"command": "ls -la"},
                            mode=PermissionMode.AUTO)
        result = engine.check(ctx)
        assert result.allowed

    def test_rule_pattern_matching(self):
        engine = PermissionEngine()
        engine.add_allow_rule("bash", "git status*")
        ctx = _make_context(tool="bash", params={"command": "git status"},
                            mode=PermissionMode.DEFAULT)
        result = engine.check(ctx)
        assert result.allowed
