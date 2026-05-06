from __future__ import annotations

import os
import tempfile

import aiosqlite
import pytest

from cabinet.core.backup import BackupManager
from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema


@pytest.fixture
async def backup_env():
    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = os.path.join(tmpdir, "data")
        db_dir = os.path.join(data_dir, "db")
        os.makedirs(db_dir)
        db_path = os.path.join(db_dir, "cabinet.db")

        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()

        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "INSERT INTO event_store (message_id, correlation_id, causation_id, sender, recipients, message_type, timestamp, status, payload) "
                "VALUES ('int-1', 'corr-1', 'caus-1', 'sender', '[]', 'integration', '2026-01-01T00:00:00', 'active', '{}')"
            )
            await db.commit()

        manager = BackupManager(data_dir)
        yield data_dir, manager


@pytest.mark.asyncio
async def test_backup_and_restore_roundtrip(backup_env):
    data_dir, manager = backup_env

    metadata = await manager.create_backup(label="integration")
    assert os.path.exists(metadata.backup_path)

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    async with aiosqlite.connect(db_path) as db:
        await db.execute("DELETE FROM event_store")
        await db.commit()

    await manager.restore_backup(metadata.backup_path)

    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute("SELECT COUNT(*) FROM event_store")
        count = (await cursor.fetchone())[0]
    assert count == 1
