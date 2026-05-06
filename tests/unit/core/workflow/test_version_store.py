import pytest
import aiosqlite
from uuid import uuid4

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
    await conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id
        ON workflow_versions(workflow_id)
    """)
    await conn.commit()
    yield conn
    await conn.close()


@pytest.mark.asyncio
async def test_save_and_load_version(db):
    store = WorkflowVersionStore(db)
    workflow_id = uuid4()
    version_id = await store.save(
        workflow_id=workflow_id,
        version=1,
        definition='{"nodes": []}',
        checksum="abc123",
    )
    assert version_id is not None
    versions = await store.list_versions(workflow_id)
    assert len(versions) == 1
    assert versions[0]["version"] == 1
    assert versions[0]["checksum"] == "abc123"


@pytest.mark.asyncio
async def test_load_specific_version(db):
    store = WorkflowVersionStore(db)
    workflow_id = uuid4()
    await store.save(workflow_id=workflow_id, version=1, definition='{"v": 1}', checksum="c1")
    await store.save(workflow_id=workflow_id, version=2, definition='{"v": 2}', checksum="c2")
    version = await store.get_version(workflow_id, 2)
    assert version is not None
    assert version["definition"] == '{"v": 2}'


@pytest.mark.asyncio
async def test_get_latest_version(db):
    store = WorkflowVersionStore(db)
    workflow_id = uuid4()
    await store.save(workflow_id=workflow_id, version=1, definition='{"v": 1}', checksum="c1")
    await store.save(workflow_id=workflow_id, version=2, definition='{"v": 2}', checksum="c2")
    latest = await store.get_latest(workflow_id)
    assert latest["version"] == 2


@pytest.mark.asyncio
async def test_checksum_matches(db):
    store = WorkflowVersionStore(db)
    workflow_id = uuid4()
    await store.save(workflow_id=workflow_id, version=1, definition='{"v": 1}', checksum="c1")
    assert await store.checksum_matches(workflow_id, "c1") is True
    assert await store.checksum_matches(workflow_id, "wrong") is False
