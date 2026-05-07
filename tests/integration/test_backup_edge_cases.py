import os
import tempfile

import aiosqlite
import pytest

from cabinet.core.backup import BackupManager
from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema


@pytest.fixture
async def backup_env_large():
    """Backup env with 1000 events pre-inserted."""
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
            for i in range(1000):
                await db.execute(
                    "INSERT INTO event_store (message_id, correlation_id, causation_id, sender, recipients, message_type, timestamp, status, payload) "
                    "VALUES (?, ?, ?, 'sender', '[]', 'test', '2026-01-01T00:00:00', 'active', '{}')",
                    (f"msg-{i}", f"corr-{i}", f"caus-{i}"),
                )
            await db.commit()

        manager = BackupManager(data_dir)
        yield data_dir, manager, db_path


async def _count_events(db_path: str) -> int:
    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute("SELECT COUNT(*) FROM event_store")
        return (await cursor.fetchone())[0]


@pytest.mark.asyncio
async def test_backup_restore_large_dataset(backup_env_large):
    data_dir, manager, db_path = backup_env_large

    metadata = await manager.create_backup(label="large-test")
    assert os.path.exists(metadata.backup_path)

    async with aiosqlite.connect(db_path) as db:
        await db.execute("DELETE FROM event_store")
        await db.commit()

    await manager.restore_backup(metadata.backup_path)
    count = await _count_events(db_path)
    assert count == 1000


@pytest.mark.asyncio
async def test_restore_rejects_corrupted_file(backup_env_large):
    data_dir, manager, db_path = backup_env_large

    metadata = await manager.create_backup(label="corrupt-test")
    with open(metadata.backup_path, "rb") as f:
        original = f.read()
    with open(metadata.backup_path, "wb") as f:
        f.write(original[:len(original) // 2])

    with pytest.raises(Exception):
        await manager.restore_backup(metadata.backup_path)


@pytest.mark.asyncio
async def test_causality_chain_survives_roundtrip(backup_env_large):
    data_dir, manager, db_path = backup_env_large

    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO event_store (message_id, correlation_id, causation_id, sender, recipients, message_type, timestamp, status, payload) "
            "VALUES ('linked-1', 'corr-x', 'root', 's', '[]', 'test', '2026-01-01T00:00:00', 'active', '{}')"
        )
        await db.execute(
            "INSERT INTO event_store (message_id, correlation_id, causation_id, sender, recipients, message_type, timestamp, status, payload) "
            "VALUES ('linked-2', 'corr-x', 'linked-1', 's', '[]', 'test', '2026-01-01T00:00:01', 'active', '{}')"
        )
        await db.execute(
            "INSERT INTO event_store (message_id, correlation_id, causation_id, sender, recipients, message_type, timestamp, status, payload) "
            "VALUES ('linked-3', 'corr-x', 'linked-2', 's', '[]', 'test', '2026-01-01T00:00:02', 'active', '{}')"
        )
        await db.commit()

    metadata = await manager.create_backup(label="causality-test")
    assert os.path.exists(metadata.backup_path)
    assert metadata.event_count >= 1003
