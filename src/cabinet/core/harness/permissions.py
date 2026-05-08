from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from fnmatch import fnmatch
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cabinet.core.harness.sandbox import FileSystemSandbox
    from cabinet.core.harness.denial_tracker import DenialTracker

logger = logging.getLogger(__name__)


class PermissionMode(str, Enum):
    DEFAULT = "default"
    PLAN = "plan"
    ACCEPT_EDITS = "accept_edits"
    AUTO = "auto"
    BYPASS = "bypass_permissions"
    DONT_ASK = "dont_ask"


@dataclass
class PermissionResult:
    allowed: bool
    needs_user_input: bool = False
    reason: str = ""


@dataclass
class ToolPermissionRule:
    tool_name: str
    pattern: str = "*"
    mode: str = "allow"


@dataclass
class PermissionContext:
    tool_name: str
    tool_params: dict = field(default_factory=dict)
    mode: PermissionMode = PermissionMode.DEFAULT
    working_dir: str = ""


SAFE_TOOLS: set[str] = {
    "Read", "Glob", "Grep", "TodoWrite", "SendMessage",
    "TaskCreate", "TaskUpdate",
}

WRITE_TOOLS: set[str] = {
    "Write", "Edit", "NotebookEdit", "Bash",
}

DANGEROUS_PATTERNS: list[str] = [
    "rm -rf *", "rm -r /*", "sudo *", "git push --force*",
    "git reset --hard*", "chmod 777*", "chown *", ":(){ :|:& };:*",
    "> /dev/sda*", "dd if=*", "mkfs.*", "format *",
    "docker rm*", "docker system prune*",
    "DROP TABLE*", "DELETE FROM*", "TRUNCATE*",
]


class PermissionEngine:
    def __init__(
        self,
        sandbox: FileSystemSandbox | None = None,
        denial_tracker: DenialTracker | None = None,
    ):
        from cabinet.core.harness.sandbox import FileSystemSandbox
        from cabinet.core.harness.denial_tracker import DenialTracker

        self._sandbox = sandbox or FileSystemSandbox()
        self._denial_tracker = denial_tracker or DenialTracker()
        self._deny_rules: list[ToolPermissionRule] = []
        self._ask_rules: list[ToolPermissionRule] = []
        self._allow_rules: list[ToolPermissionRule] = []

    def check(self, ctx: PermissionContext) -> PermissionResult:
        # Layer 1: Deny rules — immune to all modes
        for rule in self._deny_rules:
            if self._match_rule(rule, ctx):
                return PermissionResult(
                    allowed=False,
                    reason=f"Blocked by deny rule: {rule.tool_name}/{rule.pattern}",
                )

        # Layer 1b: Sandbox protected paths — immune to all modes
        if self._writes_to_protected_path(ctx):
            return PermissionResult(
                allowed=False,
                reason="Target path is protected by FileSystemSandbox",
            )

        # Layer 2: Mode filter
        if ctx.mode == PermissionMode.BYPASS:
            return PermissionResult(allowed=True, reason="Bypass mode")

        # Layer 3: DontAsk auto-deny for ask-requiring tools
        if ctx.mode == PermissionMode.DONT_ASK:
            for rule in self._ask_rules:
                if self._match_rule(rule, ctx):
                    return PermissionResult(
                        allowed=False,
                        reason=f"Ask-required in dont_ask mode: {rule.tool_name}",
                    )

        # Layer 3b: Plan mode blocks writes
        if ctx.mode == PermissionMode.PLAN:
            if ctx.tool_name in WRITE_TOOLS:
                return PermissionResult(
                    allowed=False,
                    reason=f"Write tool {ctx.tool_name} blocked in plan mode",
                )

        # Layer 4: Always-allow rules
        for rule in self._allow_rules:
            if self._match_rule(rule, ctx):
                return PermissionResult(
                    allowed=True,
                    reason=f"Allowed by rule: {rule.tool_name}/{rule.pattern}",
                )

        # Layer 5: AUTO mode classifier
        if ctx.mode == PermissionMode.AUTO:
            return self._auto_classify(ctx)

        # Layer 5b: AcceptEdits mode
        if ctx.mode == PermissionMode.ACCEPT_EDITS:
            if ctx.tool_name in SAFE_TOOLS or ctx.tool_name in {"Write", "Edit"}:
                return PermissionResult(allowed=True, reason="AcceptEdits mode")
            return self._auto_classify(ctx)

        # Layer 6: User interaction required
        if ctx.tool_name in WRITE_TOOLS:
            return PermissionResult(
                allowed=False,
                needs_user_input=True,
                reason=f"Write tool {ctx.tool_name} requires user confirmation",
            )

        return PermissionResult(allowed=True, reason="Read tool, default allow")

    def _auto_classify(self, ctx: PermissionContext) -> PermissionResult:
        if self._denial_tracker.is_circuit_open():
            return PermissionResult(
                allowed=False,
                reason="Circuit breaker open — too many denials",
            )

        if ctx.tool_name in SAFE_TOOLS:
            return PermissionResult(allowed=True, reason="Safe tool, auto allow")

        if ctx.tool_name == "Bash" or ctx.tool_name == "bash":
            command = str(ctx.tool_params.get("command", ""))
            for pattern in DANGEROUS_PATTERNS:
                if fnmatch(command, pattern):
                    return PermissionResult(
                        allowed=False,
                        needs_user_input=True,
                        reason=f"Potentially dangerous command matches '{pattern}'",
                    )

        if ctx.tool_name in WRITE_TOOLS:
            return PermissionResult(
                allowed=False,
                needs_user_input=True,
                reason=f"Write tool {ctx.tool_name} requires confirmation in auto mode",
            )

        return PermissionResult(allowed=True, reason="Auto classifier: allowed")

    def _writes_to_protected_path(self, ctx: PermissionContext) -> bool:
        if ctx.tool_name not in WRITE_TOOLS:
            return False
        file_path = ctx.tool_params.get("file_path", "")
        if file_path:
            return self._sandbox.is_protected(Path(file_path))
        return False

    def _match_rule(self, rule: ToolPermissionRule, ctx: PermissionContext) -> bool:
        if rule.tool_name != ctx.tool_name:
            return False
        if rule.pattern == "*":
            return True
        if ctx.tool_name in ("Bash", "bash"):
            command = str(ctx.tool_params.get("command", ""))
            return fnmatch(command, rule.pattern)
        return fnmatch(str(ctx.tool_params), rule.pattern)

    def add_deny_rule(self, tool: str, pattern: str = "*") -> None:
        self._deny_rules.append(ToolPermissionRule(tool_name=tool, pattern=pattern, mode="deny"))

    def add_ask_rule(self, tool: str, pattern: str = "*") -> None:
        self._ask_rules.append(ToolPermissionRule(tool_name=tool, pattern=pattern, mode="ask"))

    def add_allow_rule(self, tool: str, pattern: str = "*") -> None:
        self._allow_rules.append(ToolPermissionRule(tool_name=tool, pattern=pattern, mode="allow"))

    @property
    def denial_tracker(self):
        return self._denial_tracker

    @property
    def sandbox(self):
        return self._sandbox
