from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class Permission(str, Enum):
    READ = "read"
    WRITE = "write"
    DELETE = "delete"
    ADMIN = "admin"


ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.ADMIN: {Permission.READ, Permission.WRITE, Permission.DELETE, Permission.ADMIN},
    Role.EDITOR: {Permission.READ, Permission.WRITE},
    Role.VIEWER: {Permission.READ},
}


def has_permission(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())


class ConfirmationRequired(Exception):
    """Raised when an ACL rule requires user confirmation (Decision.ASK)."""

    def __init__(self, message: str, rule: object = None):
        super().__init__(message)
        self.rule = rule


# ── deterministic ACL ──────────────────────────────────────


class Decision(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"
    ESCALATE = "escalate"


class PermissionRule:
    def __init__(
        self,
        role: str,
        resource: str,
        action: str,
        decision: Decision,
        reason: str = "",
        priority: int = 0,
    ):
        self.role = role
        self.resource = resource
        self.action = action
        self.decision = decision
        self.reason = reason
        self.priority = priority

    def __eq__(self, other):
        if not isinstance(other, PermissionRule):
            return NotImplemented
        return (
            self.role == other.role
            and self.resource == other.resource
            and self.action == other.action
            and self.decision == other.decision
            and self.priority == other.priority
        )

    def __hash__(self):
        return hash((self.role, self.resource, self.action, self.decision, self.priority))


class AccessControlList:
    def __init__(self, rules: list[PermissionRule] | None = None):
        self._rules: list[PermissionRule] = list(rules or DEFAULT_RULES)
        self._rules.sort(key=lambda r: r.priority, reverse=True)

    def add_rule(self, rule: PermissionRule) -> None:
        self._rules.append(rule)
        self._rules.sort(key=lambda r: r.priority, reverse=True)

    def check(self, role: str, resource: str, action: str) -> PermissionRule | None:
        for rule in self._rules:
            if (
                self._match(rule.role, role)
                and self._match(rule.resource, resource)
                and self._match(rule.action, action)
            ):
                return rule
        return None

    @staticmethod
    def _match(pattern: str, value: str) -> bool:
        if pattern == "*":
            return True
        if pattern.startswith("*") and pattern.endswith("*") and len(pattern) > 1:
            inner = pattern[1:-1]
            return inner in value
        if pattern.startswith("*") and value.endswith(pattern[1:]):
            return True
        if pattern.endswith("*") and value.startswith(pattern[:-1]):
            return True
        return pattern == value


DEFAULT_RULES = [
    PermissionRule("captain", "*", "*", Decision.ALLOW, "Captain has full access", 100),
    PermissionRule("admin", "*", "*", Decision.ALLOW, "Admin has full access", 90),
    PermissionRule(
        "editor", "tool:bash", "execute", Decision.ASK,
        "Bash execution requires confirmation", 50,
    ),
    PermissionRule(
        "editor", "tool:write", "execute", Decision.ASK,
        "File write requires confirmation", 50,
    ),
    PermissionRule(
        "editor", "room:*", "read", Decision.ALLOW,
        "Editors can read all rooms", 40,
    ),
    PermissionRule(
        "editor", "memory:*", "write", Decision.ALLOW,
        "Editors can write memory", 40,
    ),
    PermissionRule(
        "viewer", "*", "read", Decision.ALLOW,
        "Viewers can read everything", 30,
    ),
    PermissionRule(
        "viewer", "*", "write", Decision.DENY,
        "Viewers cannot write", 30,
    ),
    PermissionRule(
        "viewer", "*", "execute", Decision.DENY,
        "Viewers cannot execute", 30,
    ),
]
