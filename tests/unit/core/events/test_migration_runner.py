from __future__ import annotations

import os
import tempfile

import aiosqlite
import pytest

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes


class _DummyV1:
    version = 1
    description = "create test table"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute("CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)")
        await db.execute("INSERT INTO test_table (name) VALUES ('hello')")

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP TABLE IF EXISTS test_table")


class _DummyV2:
    version = 2
    description = "add column"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute("ALTER TABLE test_table ADD COLUMN email TEXT DEFAULT ''")

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("CREATE TABLE test_table_backup AS SELECT id, name FROM test_table")
        await db.execute("DROP TABLE test_table")
        await db.execute("ALTER TABLE test_table_backup RENAME TO test_table")


@pytest.fixture
async def db_path():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield os.path.join(tmpdir, "test.db")


async def test_runner_applies_pending_migrations(db_path):
    runner = MigrationRunner(db_path, migrations=[_DummyV1(), _DummyV2()])
    await runner.initialize()
    await runner.run_pending()

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT name FROM pragma_table_info('test_table') ORDER BY cid")
        columns = [row["name"] for row in await cursor.fetchall()]
    assert "id" in columns
    assert "name" in columns
    assert "email" in columns

    version = await runner.current_version()
    assert version == 2
    await runner.close()


async def test_runner_skips_already_applied(db_path):
    runner = MigrationRunner(db_path, migrations=[_DummyV1(), _DummyV2()])
    await runner.initialize()
    await runner.run_pending()
    await runner.close()

    runner2 = MigrationRunner(db_path, migrations=[_DummyV1(), _DummyV2()])
    await runner2.initialize()
    await runner2.run_pending()

    version = await runner2.current_version()
    assert version == 2
    await runner2.close()


async def test_runner_rollback(db_path):
    runner = MigrationRunner(db_path, migrations=[_DummyV1(), _DummyV2()])
    await runner.initialize()
    await runner.run_pending()

    await runner.rollback_to(1)

    version = await runner.current_version()
    assert version == 1
    await runner.close()


async def test_v002_adds_indexes(db_path):
    runner = MigrationRunner(db_path, migrations=[V001InitialSchema(), V002AddIndexes()])
    await runner.initialize()
    await runner.run_pending()

    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
        )
        indexes = {row[0] for row in await cursor.fetchall()}
    assert "idx_event_correlation" in indexes
    assert "idx_event_causation" in indexes
    assert "idx_event_timestamp" in indexes
    assert "idx_event_sender" in indexes
    assert "idx_room_events_room_seq" in indexes
    assert "idx_memory_owner" in indexes
    assert "idx_memory_scope" in indexes

    version = await runner.current_version()
    assert version == 2
    await runner.close()


async def test_runner_wal_mode(db_path):
    runner = MigrationRunner(db_path, migrations=[_DummyV1()])
    await runner.initialize()

    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute("PRAGMA journal_mode")
        row = await cursor.fetchone()
    assert row[0] in ("wal", "WAL")
    await runner.close()


async def test_runner_current_version_empty(db_path):
    runner = MigrationRunner(db_path, migrations=[])
    await runner.initialize()
    version = await runner.current_version()
    assert version == 0
    await runner.close()


async def test_v001_creates_tables_on_fresh_db(db_path):
    runner = MigrationRunner(db_path, migrations=[V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()

    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        tables = {row[0] for row in await cursor.fetchall()}
    assert "event_store" in tables
    assert "room_events" in tables
    assert "memory" in tables
    assert "schema_version" in tables
    await runner.close()


async def test_v001_idempotent_on_existing_db(db_path):
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "CREATE TABLE event_store (message_id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL, "
            "causation_id TEXT NOT NULL, sender TEXT NOT NULL, recipients TEXT NOT NULL, "
            "message_type TEXT NOT NULL, timestamp TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', "
            "payload TEXT NOT NULL)"
        )
        await db.commit()

    runner = MigrationRunner(db_path, migrations=[V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()

    version = await runner.current_version()
    assert version == 1
    await runner.close()
