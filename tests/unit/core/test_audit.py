from __future__ import annotations

import os
import tempfile


async def test_audit_store_initialize_and_log():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        event = AuditEvent(
            action="test.action",
            actor="test_user",
            resource_type="test_resource",
            resource_id="res-1",
        )
        await store.log(event)
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_store_query():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        await store.log(AuditEvent(action="auth.login", actor="user1", resource_type="token", resource_id="s1"))
        await store.log(AuditEvent(action="decision.approve", actor="user2", resource_type="decision", resource_id="d1"))
        results = await store.query(action="auth.login")
        assert len(results) == 1
        assert results[0].action == "auth.login"
        all_results = await store.query()
        assert len(all_results) == 2
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_event_defaults():
    from datetime import datetime

    from cabinet.core.audit import AuditEvent

    event = AuditEvent(
        action="api_key.rotate",
        actor="captain",
        resource_type="api_key",
        resource_id="openai",
    )
    assert event.detail == ""
    assert event.ip_address == ""
    assert event.trace_id == ""
    assert isinstance(event.timestamp, datetime)


async def test_audit_store_close_without_initialize():
    from cabinet.core.audit import AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_event_role_field():
    from cabinet.core.audit import AuditEvent

    event = AuditEvent(
        action="auth.login",
        actor="captain",
        role="admin",
        resource_type="session",
        resource_id="s1",
    )
    assert event.role == "admin"

    event_no_role = AuditEvent(
        action="auth.login",
        actor="viewer",
        resource_type="session",
        resource_id="s2",
    )
    assert event_no_role.role == ""


async def test_audit_store_query_by_role():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        await store.log(AuditEvent(action="auth.login", actor="user1", role="admin", resource_type="token", resource_id="s1"))
        await store.log(AuditEvent(action="auth.login", actor="user2", role="viewer", resource_type="token", resource_id="s2"))
        await store.log(AuditEvent(action="auth.login", actor="user3", role="admin", resource_type="token", resource_id="s3"))
        results = await store.query(role="admin")
        assert len(results) == 2
        for r in results:
            assert r.role == "admin"
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_store_query_by_time_range():
    from datetime import datetime, timedelta, timezone
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        now = datetime.now(timezone.utc)
        old_event = AuditEvent(
            action="data.access",
            actor="user1",
            resource_type="file",
            resource_id="f1",
            timestamp=now - timedelta(hours=48),
        )
        recent_event = AuditEvent(
            action="data.access",
            actor="user2",
            resource_type="file",
            resource_id="f2",
            timestamp=now - timedelta(hours=1),
        )
        await store.log(old_event)
        await store.log(recent_event)
        results = await store.query(start_time=now - timedelta(hours=24))
        assert len(results) == 1
        assert results[0].actor == "user2"
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_store_query_combined_filters():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        await store.log(AuditEvent(action="auth.login", actor="admin1", role="admin", resource_type="token", resource_id="s1"))
        await store.log(AuditEvent(action="auth.login", actor="viewer1", role="viewer", resource_type="token", resource_id="s2"))
        await store.log(AuditEvent(action="data.access", actor="admin2", role="admin", resource_type="file", resource_id="f1"))
        results = await store.query(action="auth.login", role="admin")
        assert len(results) == 1
        assert results[0].actor == "admin1"
        await store.close()
    finally:
        os.unlink(db_path)
