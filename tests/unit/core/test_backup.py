from __future__ import annotations

import asyncio
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
                "VALUES ('test-1', 'corr-1', 'caus-1', 'sender', '[]', 'test', '2026-01-01T00:00:00', 'active', '{}')"
            )
            await db.commit()

        manager = BackupManager(data_dir)
        yield data_dir, manager


async def test_create_backup(backup_env):
    data_dir, manager = backup_env
    metadata = await manager.create_backup(label="test")
    assert os.path.exists(metadata.backup_path)
    assert metadata.file_size > 0
    assert metadata.schema_version == 1


async def test_list_backups(backup_env):
    data_dir, manager = backup_env
    await manager.create_backup(label="first")
    await manager.create_backup(label="second")
    backups = await manager.list_backups()
    assert len(backups) == 2


async def test_restore_backup(backup_env):
    data_dir, manager = backup_env
    metadata = await manager.create_backup(label="restore_test")

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    async with aiosqlite.connect(db_path) as db:
        await db.execute("DELETE FROM event_store")
        await db.commit()

    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute("SELECT COUNT(*) FROM event_store")
        count = (await cursor.fetchone())[0]
    assert count == 0

    await manager.restore_backup(metadata.backup_path)

    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute("SELECT COUNT(*) FROM event_store")
        count = (await cursor.fetchone())[0]
    assert count == 1


async def test_delete_backup(backup_env):
    data_dir, manager = backup_env
    metadata = await manager.create_backup(label="delete_test")
    assert os.path.exists(metadata.backup_path)

    await manager.delete_backup(metadata.backup_path)
    assert not os.path.exists(metadata.backup_path)

    backups = await manager.list_backups()
    assert len(backups) == 0


async def test_scheduled_backup_manager_start_stop():
    from cabinet.core.backup import BackupManager, ScheduledBackupManager

    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = os.path.join(tmpdir, "data")
        db_dir = os.path.join(data_dir, "db")
        os.makedirs(db_dir)
        db_path = os.path.join(db_dir, "cabinet.db")

        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()

        manager = BackupManager(data_dir)
        scheduled = ScheduledBackupManager(manager, interval_hours=0.001, max_backups=3)
        await scheduled.start()
        assert scheduled.is_running

        await asyncio.sleep(0.1)
        await scheduled.stop()
        assert not scheduled.is_running


async def test_create_backup_rejects_malicious_label(backup_env):
    data_dir, manager = backup_env
    with pytest.raises(ValueError, match="Invalid backup path"):
        await manager.create_backup(label="'; DROP TABLE event_store; --")


async def test_scheduled_backup_cleanup_old():
    from cabinet.core.backup import BackupManager, ScheduledBackupManager

    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = os.path.join(tmpdir, "data")
        db_dir = os.path.join(data_dir, "db")
        os.makedirs(db_dir)
        db_path = os.path.join(db_dir, "cabinet.db")

        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()

        manager = BackupManager(data_dir)
        for i in range(5):
            await manager.create_backup(label=f"scheduled_{i}")

        scheduled = ScheduledBackupManager(manager, interval_hours=24, max_backups=3)
        await scheduled._cleanup_old_backups()

        backups = await manager.list_backups()
        scheduled_backups = [b for b in backups if "scheduled" in b.backup_path]
        assert len(scheduled_backups) <= 3
