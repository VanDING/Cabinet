from __future__ import annotations

import os
import tempfile

import pytest


@pytest.mark.asyncio
async def test_shared_connection_manager_initialize():
    from cabinet.core.db.connection_manager import SharedConnectionManager

    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        mgr = SharedConnectionManager(db_path)
        await mgr.initialize()
        assert mgr._conn is not None
        await mgr.close()


@pytest.mark.asyncio
async def test_shared_connection_manager_write_and_read():
    from cabinet.core.db.connection_manager import SharedConnectionManager

    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        mgr = SharedConnectionManager(db_path)
        await mgr.initialize()
        await mgr.execute_write(
            "CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)"
        )
        await mgr.execute_write("INSERT INTO test (id, value) VALUES (?, ?)", (1, "hello"))
        rows = await mgr.execute_read("SELECT value FROM test WHERE id = ?", (1,))
        assert len(rows) == 1
        assert rows[0][0] == "hello"
        await mgr.close()


@pytest.mark.asyncio
async def test_shared_connection_manager_close():
    from cabinet.core.db.connection_manager import SharedConnectionManager

    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        mgr = SharedConnectionManager(db_path)
        await mgr.initialize()
        await mgr.close()
        assert mgr._conn is None


@pytest.mark.asyncio
async def test_shared_connection_manager_read_one():
    from cabinet.core.db.connection_manager import SharedConnectionManager

    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        mgr = SharedConnectionManager(db_path)
        await mgr.initialize()
        await mgr.execute_write(
            "CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)"
        )
        await mgr.execute_write("INSERT INTO test (id, value) VALUES (?, ?)", (1, "hello"))
        row = await mgr.execute_read_one("SELECT value FROM test WHERE id = ?", (1,))
        assert row is not None
        assert row[0] == "hello"
        await mgr.close()


@pytest.mark.asyncio
async def test_shared_connection_manager_not_initialized_raises():
    from cabinet.core.db.connection_manager import SharedConnectionManager

    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        mgr = SharedConnectionManager(db_path)
        with pytest.raises(RuntimeError, match="not initialized"):
            await mgr.execute_write("SELECT 1")
