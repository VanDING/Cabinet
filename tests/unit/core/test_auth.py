from __future__ import annotations

from cabinet.core.auth import Permission, Role, has_permission


def test_admin_has_all_permissions():
    for perm in Permission:
        assert has_permission(Role.ADMIN, perm)


def test_editor_has_read_write():
    assert has_permission(Role.EDITOR, Permission.READ)
    assert has_permission(Role.EDITOR, Permission.WRITE)
    assert not has_permission(Role.EDITOR, Permission.DELETE)
    assert not has_permission(Role.EDITOR, Permission.ADMIN)


def test_viewer_has_read_only():
    assert has_permission(Role.VIEWER, Permission.READ)
    assert not has_permission(Role.VIEWER, Permission.WRITE)
    assert not has_permission(Role.VIEWER, Permission.DELETE)
    assert not has_permission(Role.VIEWER, Permission.ADMIN)
