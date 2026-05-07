from __future__ import annotations

from cabinet.core.auth import (
    DEFAULT_RULES,
    AccessControlList,
    Decision,
    PermissionRule,
)


def test_acl_exact_match():
    acl = AccessControlList(rules=[])
    acl.add_rule(PermissionRule(
        role="editor", resource="room:meeting", action="read",
        decision=Decision.ALLOW, priority=10,
    ))
    result = acl.check("editor", "room:meeting", "read")
    assert result is not None
    assert result.decision == Decision.ALLOW


def test_acl_wildcard_resource():
    acl = AccessControlList(rules=[
        PermissionRule("editor", "room:*", "read", Decision.ALLOW, priority=10),
    ])
    result = acl.check("editor", "room:strategy", "read")
    assert result is not None
    assert result.decision == Decision.ALLOW


def test_acl_wildcard_role():
    acl = AccessControlList(rules=[
        PermissionRule("*", "public:*", "read", Decision.ALLOW, priority=10),
    ])
    result = acl.check("viewer", "public:docs", "read")
    assert result is not None
    assert result.decision == Decision.ALLOW


def test_acl_wildcard_all():
    acl = AccessControlList(rules=[
        PermissionRule("viewer", "*", "write", Decision.DENY, priority=10),
    ])
    result = acl.check("viewer", "room:meeting", "write")
    assert result is not None
    assert result.decision == Decision.DENY


def test_acl_suffix_wildcard():
    acl = AccessControlList(rules=[
        PermissionRule("editor", "*bash*", "execute", Decision.ASK, priority=10),
    ])
    result = acl.check("editor", "tool:bash", "execute")
    assert result is not None
    assert result.decision == Decision.ASK


def test_acl_priority_higher_wins():
    acl = AccessControlList(rules=[
        PermissionRule("editor", "tool:*", "execute", Decision.ALLOW, priority=5),
        PermissionRule("editor", "tool:bash", "execute", Decision.DENY, priority=10),
    ])
    result = acl.check("editor", "tool:bash", "execute")
    assert result.decision == Decision.DENY


def test_acl_no_match_returns_none():
    acl = AccessControlList(rules=[
        PermissionRule("admin", "room:admin_only", "delete", Decision.ALLOW, priority=10),
    ])
    result = acl.check("editor", "room:public", "read")
    assert result is None


def test_acl_default_rules_captain_full_access():
    acl = AccessControlList()
    result = acl.check("captain", "room:meeting", "delete")
    assert result is not None
    assert result.decision == Decision.ALLOW


def test_acl_default_rules_viewer_denied_write():
    acl = AccessControlList()
    result = acl.check("viewer", "room:meeting", "write")
    assert result is not None
    assert result.decision == Decision.DENY


def test_acl_default_rules_viewer_denied_execute():
    acl = AccessControlList()
    result = acl.check("viewer", "tool:bash", "execute")
    assert result is not None
    assert result.decision == Decision.DENY


def test_acl_default_rules_editor_bash_ask():
    acl = AccessControlList()
    result = acl.check("editor", "tool:bash", "execute")
    assert result is not None
    assert result.decision == Decision.ASK


def test_acl_default_rules_editor_room_read():
    acl = AccessControlList()
    result = acl.check("editor", "room:strategy", "read")
    assert result is not None
    assert result.decision == Decision.ALLOW


def test_acl_add_rule_respects_priority_ordering():
    acl = AccessControlList(rules=[])
    acl.add_rule(PermissionRule("editor", "tool:*", "execute", Decision.DENY, priority=1))
    acl.add_rule(PermissionRule("editor", "tool:safe", "execute", Decision.ALLOW, priority=5))
    result = acl.check("editor", "tool:safe", "execute")
    assert result.decision == Decision.ALLOW


def test_acl_existing_api_unchanged():
    """original Role/Permission/has_permission still works"""
    from cabinet.core.auth import Permission, Role, has_permission
    assert has_permission(Role.ADMIN, Permission.ADMIN)
    assert has_permission(Role.EDITOR, Permission.READ)
    assert not has_permission(Role.VIEWER, Permission.WRITE)


def test_default_rules_has_entries():
    assert len(DEFAULT_RULES) == 9
    decisions = {r.decision for r in DEFAULT_RULES}
    assert Decision.ALLOW in decisions
    assert Decision.DENY in decisions
    assert Decision.ASK in decisions
