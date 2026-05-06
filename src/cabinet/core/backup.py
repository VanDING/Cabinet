from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite


def _validate_backup_path(path: str) -> None:
    if not re.match(r'^[a-zA-Z0-9_./\\:\-]+$', str(path)):
        raise ValueError(f"Invalid backup path: {path}")

logger = logging.getLogger(__name__)


class BackupMetadata:
    def __init__(
        self,
        backup_path: str,
        original_path: str,
        created_at: str,
        file_size: int,
        schema_version: int = 0,
    ):
        self.backup_path = backup_path
        self.original_path = original_path
        self.created_at = created_at
        self.file_size = file_size
        self.schema_version = schema_version

    def to_dict(self) -> dict:
        return {
            "backup_path": self.backup_path,
            "original_path": self.original_path,
            "created_at": self.created_at,
            "file_size": self.file_size,
            "schema_version": self.schema_version,
        }

    @classmethod
    def from_dict(cls, data: dict) -> BackupMetadata:
        return cls(**data)


class BackupManager:
    def __init__(self, data_dir: str, backup_dir: str | None = None):
        self._data_dir = Path(data_dir)
        self._backup_dir = Path(backup_dir) if backup_dir else self._data_dir / "backups"
        self._metadata_path = self._backup_dir / "backup_metadata.json"

    async def create_backup(self, label: str = "") -> BackupMetadata:
        self._backup_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_name = f"cabinet_{timestamp}"
        if label:
            backup_name += f"_{label}"
        backup_path = self._backup_dir / f"{backup_name}.db"
        _validate_backup_path(str(backup_path))

        db_path = self._data_dir / "db" / "cabinet.db"
        if not db_path.exists():
            raise FileNotFoundError(f"Database not found: {db_path}")

        async with aiosqlite.connect(str(db_path)) as db:
            await db.execute(f"VACUUM INTO '{backup_path}'")

        schema_version = await self._get_schema_version(str(backup_path))
        file_size = backup_path.stat().st_size

        metadata = BackupMetadata(
            backup_path=str(backup_path),
            original_path=str(db_path),
            created_at=datetime.now(timezone.utc).isoformat(),
            file_size=file_size,
            schema_version=schema_version,
        )
        self._save_metadata(metadata)
        logger.info("Backup created: %s (%d bytes, schema v%d)", backup_path, file_size, schema_version)
        return metadata

    async def restore_backup(self, backup_path: str) -> None:
        db_path = self._data_dir / "db" / "cabinet.db"
        if not Path(backup_path).exists():
            raise FileNotFoundError(f"Backup not found: {backup_path}")

        db_path.parent.mkdir(parents=True, exist_ok=True)
        if db_path.exists():
            pre_backup = self._data_dir / "db" / f"cabinet_pre_restore_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.db"
            shutil.copy2(str(db_path), str(pre_backup))
            logger.info("Pre-restore backup saved: %s", pre_backup)

        shutil.copy2(backup_path, str(db_path))
        logger.info("Restored database from: %s", backup_path)

    async def list_backups(self) -> list[BackupMetadata]:
        if not self._metadata_path.exists():
            return []
        with open(self._metadata_path) as f:
            data = json.load(f)
        return [BackupMetadata.from_dict(m) for m in data.get("backups", [])]

    async def delete_backup(self, backup_path: str) -> None:
        path = Path(backup_path)
        if path.exists():
            path.unlink()
        metadata_list = await self.list_backups()
        metadata_list = [m for m in metadata_list if m.backup_path != backup_path]
        self._write_all_metadata(metadata_list)
        logger.info("Deleted backup: %s", backup_path)

    def _save_metadata(self, metadata: BackupMetadata) -> None:
        existing = []
        if self._metadata_path.exists():
            with open(self._metadata_path) as f:
                data = json.load(f)
            existing = data.get("backups", [])
        existing.append(metadata.to_dict())
        with open(self._metadata_path, "w") as f:
            json.dump({"backups": existing}, f, indent=2)

    def _write_all_metadata(self, metadata_list: list[BackupMetadata]) -> None:
        self._backup_dir.mkdir(parents=True, exist_ok=True)
        with open(self._metadata_path, "w") as f:
            json.dump({"backups": [m.to_dict() for m in metadata_list]}, f, indent=2)

    async def _get_schema_version(self, db_path: str) -> int:
        try:
            async with aiosqlite.connect(db_path) as db:
                cursor = await db.execute("SELECT MAX(version) FROM schema_version")
                row = await cursor.fetchone()
                return row[0] if row[0] is not None else 0
        except Exception:
            return 0


class ScheduledBackupManager:
    def __init__(
        self,
        backup_manager: BackupManager,
        interval_hours: float = 24.0,
        max_backups: int = 10,
    ):
        self._manager = backup_manager
        self._interval_hours = interval_hours
        self._max_backups = max_backups
        self._task: asyncio.Task | None = None
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run_loop(self) -> None:
        try:
            while self._running:
                await asyncio.sleep(self._interval_hours * 3600)
                if not self._running:
                    break
                try:
                    await self._manager.create_backup(label="scheduled")
                    await self._cleanup_old_backups()
                    logger.info("Scheduled backup completed")
                except Exception as e:
                    logger.error("Scheduled backup failed: %s", e)
        except asyncio.CancelledError:
            pass

    async def _cleanup_old_backups(self) -> None:
        backups = await self._manager.list_backups()
        scheduled = [b for b in backups if "scheduled" in (b.backup_path or "")]
        if len(scheduled) > self._max_backups:
            for b in scheduled[self._max_backups:]:
                try:
                    await self._manager.delete_backup(b.backup_path)
                except Exception as e:
                    logger.warning("Failed to delete old backup %s: %s", b.backup_path, e)
