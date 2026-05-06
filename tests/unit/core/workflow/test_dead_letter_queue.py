import pytest
import aiosqlite

from cabinet.core.workflow.dead_letter_queue import DeadLetterQueue


@pytest.fixture
async def db():
    import tempfile
    import os
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "test.db")
    conn = await aiosqlite.connect(db_path)
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS dead_letter_queue (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            source TEXT,
            payload TEXT NOT NULL,
            error TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_retry_at TEXT
        )
    """)
    await conn.commit()
    yield conn
    await conn.close()
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.mark.asyncio
async def test_enqueue_and_peek(db):
    dlq = DeadLetterQueue(db)
    entry_id = await dlq.enqueue(
        event_type="task.failure",
        source="office",
        payload={"task_id": "abc"},
        error="timeout",
    )
    assert entry_id is not None
    entries = await dlq.peek(limit=10)
    assert len(entries) == 1
    assert entries[0]["event_type"] == "task.failure"
    assert entries[0]["retry_count"] == 0


@pytest.mark.asyncio
async def test_retry_entry(db):
    dlq = DeadLetterQueue(db)
    entry_id = await dlq.enqueue(
        event_type="task.failure",
        source="office",
        payload={"task_id": "abc"},
        error="timeout",
    )
    updated = await dlq.retry(entry_id)
    assert updated is True
    entries = await dlq.peek(limit=10)
    assert entries[0]["retry_count"] == 1


@pytest.mark.asyncio
async def test_remove_entry(db):
    dlq = DeadLetterQueue(db)
    entry_id = await dlq.enqueue(
        event_type="task.failure",
        source="office",
        payload={"task_id": "abc"},
        error="timeout",
    )
    removed = await dlq.remove(entry_id)
    assert removed is True
    entries = await dlq.peek(limit=10)
    assert len(entries) == 0


@pytest.mark.asyncio
async def test_list_by_type(db):
    dlq = DeadLetterQueue(db)
    await dlq.enqueue(event_type="task.failure", source="office", payload={}, error="e1")
    await dlq.enqueue(event_type="task.failure", source="office", payload={}, error="e2")
    await dlq.enqueue(event_type="workflow.error", source="engine", payload={}, error="e3")
    failures = await dlq.list_by_type("task.failure")
    assert len(failures) == 2


@pytest.mark.asyncio
async def test_stats(db):
    dlq = DeadLetterQueue(db)
    await dlq.enqueue(event_type="task.failure", source="office", payload={}, error="e1")
    await dlq.enqueue(event_type="task.failure", source="office", payload={}, error="e2")
    stats = await dlq.stats()
    assert stats["total"] == 2
    assert "by_type" in stats


@pytest.mark.asyncio
async def test_dlq_close_closes_connection():
    import tempfile
    import os
    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        db = await aiosqlite.connect(db_path)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS dead_letter_queue (
                id TEXT PRIMARY KEY, event_type TEXT, source TEXT,
                payload TEXT, error TEXT, retry_count INTEGER DEFAULT 0,
                created_at TEXT, last_retry_at TEXT
            )
        """)
        await db.commit()
        dlq = DeadLetterQueue(db)
        await dlq.close()
        with pytest.raises(Exception):
            await db.execute("SELECT 1")
