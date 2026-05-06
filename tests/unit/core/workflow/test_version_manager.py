import pytest
import aiosqlite
from uuid import uuid4

from cabinet.core.workflow.version_manager import VersionedWorkflowManager, CompatibilityChecker
from cabinet.core.workflow.version_store import WorkflowVersionStore


@pytest.fixture
async def db(tmp_path):
    db_path = str(tmp_path / "test.db")
    conn = await aiosqlite.connect(db_path)
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS workflow_versions (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            definition TEXT NOT NULL,
            checksum TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(workflow_id, version)
        )
    """)
    await conn.commit()
    yield conn
    await conn.close()


@pytest.mark.asyncio
async def test_register_new_version(db):
    store = WorkflowVersionStore(db)
    manager = VersionedWorkflowManager(store)
    workflow_id = uuid4()
    definition = '{"nodes": [{"kind": "trigger"}]}'
    version = await manager.register(workflow_id, definition)
    assert version == 1
    version2 = await manager.register(workflow_id, definition + " ")
    assert version2 == 2


@pytest.mark.asyncio
async def test_register_same_definition_no_new_version(db):
    store = WorkflowVersionStore(db)
    manager = VersionedWorkflowManager(store)
    workflow_id = uuid4()
    definition = '{"nodes": []}'
    v1 = await manager.register(workflow_id, definition)
    v2 = await manager.register(workflow_id, definition)
    assert v1 == v2


@pytest.mark.asyncio
async def test_get_definition(db):
    store = WorkflowVersionStore(db)
    manager = VersionedWorkflowManager(store)
    workflow_id = uuid4()
    definition = '{"nodes": []}'
    await manager.register(workflow_id, definition)
    result = await manager.get_definition(workflow_id, 1)
    assert result == definition


def test_compatibility_checker_breaking_change():
    checker = CompatibilityChecker()
    old_def = {"nodes": [{"kind": "trigger", "id": "a"}, {"kind": "skill", "id": "b"}]}
    new_def = {"nodes": [{"kind": "trigger", "id": "a"}]}
    result = checker.check(old_def, new_def)
    assert result["compatible"] is False
    assert len(result["breaking_changes"]) > 0


def test_compatibility_checker_compatible():
    checker = CompatibilityChecker()
    old_def = {"nodes": [{"kind": "trigger", "id": "a"}, {"kind": "skill", "id": "b"}]}
    new_def = {"nodes": [{"kind": "trigger", "id": "a"}, {"kind": "skill", "id": "b"}, {"kind": "end", "id": "c"}]}
    result = checker.check(old_def, new_def)
    assert result["compatible"] is True
