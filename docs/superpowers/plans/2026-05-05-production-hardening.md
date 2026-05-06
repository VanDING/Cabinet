# 生产加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Cabinet 建立数据库迁移系统、性能优化、备份恢复、安全审计与权限模型，使项目达到生产级可靠性。

**Architecture:** 严格分层递进 — L1 数据库迁移系统 → L2 性能优化+负载测试 → L3 备份恢复 → L4 安全审计+权限模型。每层完成后形成稳定基线，后续层不返工。

**Tech Stack:** Python 3.12+, aiosqlite, FTS5, Pydantic v2, FastAPI, Typer, cryptography

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/cabinet/core/events/migrations/__init__.py` | 迁移包入口，导出 Migration 协议和 MigrationRunner |
| Create | `src/cabinet/core/events/migrations/runner.py` | MigrationRunner 引擎 |
| Create | `src/cabinet/core/events/migrations/v001_initial_schema.py` | 初始 schema 迁移 |
| Create | `src/cabinet/core/events/migrations/v002_add_indexes.py` | 索引优化迁移 |
| Create | `src/cabinet/core/events/migrations/v003_memory_fts.py` | FTS5 全文搜索迁移 |
| Modify | `src/cabinet/core/events/sqlite_store.py` | 移除 initialize() 中的 CREATE TABLE，改用迁移 |
| Modify | `src/cabinet/core/events/sqlite_room_store.py` | 移除 initialize() 中的 CREATE TABLE，改用迁移；增加 LRU 缓存 |
| Modify | `src/cabinet/core/memory/sqlite_store.py` | 移除 initialize() 中的 CREATE TABLE，改用迁移；search 改用 FTS5 |
| Modify | `src/cabinet/core/audit.py` | 移除 initialize() 中的 CREATE TABLE，改用迁移；增加批量写入 |
| Modify | `src/cabinet/runtime.py` | start() 中调用 MigrationRunner |
| Modify | `src/cabinet/cli/main.py` | 添加 db 子命令和 backup 子命令 |
| Modify | `src/cabinet/cli/config.py` | 添加 api_tokens 字段和 auth_required 字段 |
| Modify | `src/cabinet/api/deps.py` | 认证强制执行 + RBAC |
| Modify | `src/cabinet/api/app.py` | 添加 SanitizationMiddleware |
| Modify | `src/cabinet/core/security.py` | Salt 随机化；废弃 AuditLogger |
| Modify | `src/cabinet/core/knowledge/local_kb.py` | ChromaDB 去重 |
| Create | `src/cabinet/core/backup.py` | BackupManager |
| Create | `src/cabinet/api/auth.py` | RBAC 权限模型 |
| Create | `tests/unit/core/events/test_migration_runner.py` | 迁移引擎测试 |
| Create | `tests/unit/core/test_backup.py` | 备份管理器测试 |
| Create | `tests/unit/api/test_auth.py` | RBAC 权限测试 |
| Create | `tests/load/bench_api.py` | API 负载测试 |
| Create | `tests/load/bench_sqlite.py` | SQLite 写入基准 |

---

## L1 数据库迁移系统

### Task 1: 创建 Migration 协议和 MigrationRunner

**Files:**
- Create: `src/cabinet/core/events/migrations/__init__.py`
- Create: `src/cabinet/core/events/migrations/runner.py`
- Create: `tests/unit/core/events/test_migration_runner.py`

- [ ] **Step 1: 写失败测试 — MigrationRunner 基本功能**

在 `tests/unit/core/events/test_migration_runner.py` 中：

```python
from __future__ import annotations

import os
import tempfile

import aiosqlite
import pytest

from cabinet.core.events.migrations import Migration, MigrationRunner


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


async def test_runner_skips_already_applied(db_path):
    runner = MigrationRunner(db_path, migrations=[_DummyV1(), _DummyV2()])
    await runner.initialize()
    await runner.run_pending()

    runner2 = MigrationRunner(db_path, migrations=[_DummyV1(), _DummyV2()])
    await runner2.initialize()
    await runner2.run_pending()

    version = await runner2.current_version()
    assert version == 2


async def test_runner_rollback(db_path):
    runner = MigrationRunner(db_path, migrations=[_DummyV1(), _DummyV2()])
    await runner.initialize()
    await runner.run_pending()

    await runner.rollback_to(1)

    version = await runner.current_version()
    assert version == 1


async def test_runner_wal_mode(db_path):
    runner = MigrationRunner(db_path, migrations=[_DummyV1()])
    await runner.initialize()

    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute("PRAGMA journal_mode")
        row = await cursor.fetchone()
    assert row[0] in ("wal", "WAL")


async def test_runner_current_version_empty(db_path):
    runner = MigrationRunner(db_path, migrations=[])
    await runner.initialize()
    version = await runner.current_version()
    assert version == 0
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/events/test_migration_runner.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `src/cabinet/core/events/migrations/__init__.py`**

```python
from __future__ import annotations

from cabinet.core.events.migrations.runner import Migration, MigrationRunner

__all__ = ["Migration", "MigrationRunner"]
```

- [ ] **Step 4: 创建 `src/cabinet/core/events/migrations/runner.py`**

```python
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

import aiosqlite

logger = logging.getLogger(__name__)


@runtime_checkable
class Migration(Protocol):
    version: int
    description: str

    async def up(self, db: aiosqlite.Connection) -> None: ...

    async def down(self, db: aiosqlite.Connection) -> None: ...


class MigrationRunner:
    def __init__(self, db_path: str, migrations: list[Migration] | None = None):
        self._db_path = db_path
        self._migrations = sorted(migrations or [], key=lambda m: m.version)
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL,
                description TEXT NOT NULL
            )
            """
        )
        await self._db.commit()

    async def current_version(self) -> int:
        cursor = await self._db.execute("SELECT MAX(version) FROM schema_version")
        row = await cursor.fetchone()
        return row[0] if row[0] is not None else 0

    async def run_pending(self) -> None:
        current = await self.current_version()
        pending = [m for m in self._migrations if m.version > current]
        if not pending:
            logger.info("No pending migrations (current version: %d)", current)
            return
        for migration in pending:
            logger.info("Applying migration v%03d: %s", migration.version, migration.description)
            await self._db.execute("BEGIN")
            try:
                await migration.up(self._db)
                await self._db.execute(
                    "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
                    (migration.version, datetime.now(timezone.utc).isoformat(), migration.description),
                )
                await self._db.commit()
                logger.info("Migration v%03d applied successfully", migration.version)
            except Exception:
                await self._db.rollback()
                logger.error("Migration v%03d failed, rolled back", migration.version)
                raise
        logger.info("All pending migrations applied (version: %d -> %d)", current, pending[-1].version)

    async def rollback_to(self, target_version: int) -> None:
        current = await self.current_version()
        if target_version >= current:
            logger.info("No rollback needed (current: %d, target: %d)", current, target_version)
            return
        to_rollback = [m for m in reversed(self._migrations) if target_version < m.version <= current]
        for migration in to_rollback:
            logger.info("Rolling back migration v%03d: %s", migration.version, migration.description)
            await self._db.execute("BEGIN")
            try:
                await migration.down(self._db)
                await self._db.execute(
                    "DELETE FROM schema_version WHERE version = ?",
                    (migration.version,),
                )
                await self._db.commit()
                logger.info("Migration v%03d rolled back", migration.version)
            except Exception:
                await self._db.rollback()
                logger.error("Rollback v%03d failed", migration.version)
                raise

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None
```

- [ ] **Step 5: 运行测试验证通过**

Run: `python -m pytest tests/unit/core/events/test_migration_runner.py -v`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/events/migrations/ tests/unit/core/events/test_migration_runner.py
git commit -m "feat: add Migration protocol and MigrationRunner with WAL mode"
```

---

### Task 2: 创建 v001 初始 schema 迁移

**Files:**
- Create: `src/cabinet/core/events/migrations/v001_initial_schema.py`

- [ ] **Step 1: 创建 v001 迁移**

```python
from __future__ import annotations

import aiosqlite


class V001InitialSchema:
    version = 1
    description = "initial schema: event_store, room_events, memory, audit_log"

    async def up(self, db: aiosqlite.Connection) -> None:
        tables = await self._existing_tables(db)
        if "event_store" not in tables:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS event_store (
                    message_id TEXT PRIMARY KEY,
                    correlation_id TEXT NOT NULL,
                    causation_id TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    recipients TEXT NOT NULL,
                    message_type TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    payload TEXT NOT NULL
                )
                """
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_event_store_type ON event_store(message_type)"
            )
        if "room_events" not in tables:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS room_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    room_name TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    event_data TEXT NOT NULL
                )
                """
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_room_events_room ON room_events(room_name)"
            )
        if "memory" not in tables:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS memory (
                    key TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    accessed_at TEXT,
                    PRIMARY KEY (key, scope)
                )
                """
            )

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP TABLE IF EXISTS memory")
        await db.execute("DROP TABLE IF EXISTS room_events")
        await db.execute("DROP TABLE IF EXISTS event_store")

    async def _existing_tables(self, db: aiosqlite.Connection) -> set[str]:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        rows = await cursor.fetchall()
        return {row[0] for row in rows}
```

- [ ] **Step 2: 写测试 — v001 迁移对已有数据库兼容**

在 `tests/unit/core/events/test_migration_runner.py` 末尾添加：

```python
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema


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
```

- [ ] **Step 3: 运行测试**

Run: `python -m pytest tests/unit/core/events/test_migration_runner.py -v`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/events/migrations/v001_initial_schema.py tests/unit/core/events/test_migration_runner.py
git commit -m "feat: add v001 initial schema migration with idempotent detection"
```

---

### Task 3: 修改各 Store 的 initialize() 移除 CREATE TABLE

**Files:**
- Modify: `src/cabinet/core/events/sqlite_store.py:24-45`
- Modify: `src/cabinet/core/events/sqlite_room_store.py:28-44`
- Modify: `src/cabinet/core/memory/sqlite_store.py:28-44`
- Modify: `src/cabinet/core/audit.py:25-40`

- [ ] **Step 1: 修改 `sqlite_store.py` — 移除 CREATE TABLE**

将 `initialize()` 方法改为：

```python
    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.commit()
```

删除原来的 `CREATE TABLE IF NOT EXISTS event_store` 和 `CREATE INDEX` 语句。

- [ ] **Step 2: 修改 `sqlite_room_store.py` — 移除 CREATE TABLE**

将 `initialize()` 方法改为：

```python
    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.commit()
        await self._load_cache()
```

删除原来的 `CREATE TABLE IF NOT EXISTS room_events` 和 `CREATE INDEX` 语句。

- [ ] **Step 3: 修改 `sqlite_store.py`（memory）— 移除 CREATE TABLE**

将 `initialize()` 方法改为：

```python
    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.commit()
        logger.info("SQLiteMemoryStore initialized: db_path=%s", self._db_path)
```

删除原来的 `CREATE TABLE IF NOT EXISTS memory` 语句。

- [ ] **Step 4: 修改 `audit.py` — 移除 CREATE TABLE**

将 `initialize()` 方法改为：

```python
    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.commit()
```

删除原来的 `CREATE TABLE IF NOT EXISTS audit_log` 语句。

- [ ] **Step 5: 运行全量测试**

Run: `python -m pytest tests/ -q`
Expected: 全部 PASS（因为运行时 MigrationRunner 会先创建表）

注意：此步骤需要 Task 4 完成后才能通过。如果单独测试失败是预期的。

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/events/sqlite_store.py src/cabinet/core/events/sqlite_room_store.py src/cabinet/core/memory/sqlite_store.py src/cabinet/core/audit.py
git commit -m "refactor: remove CREATE TABLE from Store.initialize(), now handled by migrations"
```

---

### Task 4: 集成 MigrationRunner 到 CabinetRuntime + CLI

**Files:**
- Modify: `src/cabinet/runtime.py:157-190`
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 修改 `runtime.py` — start() 中调用 MigrationRunner**

在 `CabinetRuntime.start()` 方法中，在 `if self._db_path:` 块的开头添加迁移逻辑：

将 `start()` 方法中 `if self._db_path:` 块改为：

```python
        if self._db_path:
            import os as _os
            from cabinet.core.events.migrations import MigrationRunner
            from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema

            _migrations = [V001InitialSchema()]
            try:
                from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes
                _migrations.append(V002AddIndexes())
            except ImportError:
                pass
            try:
                from cabinet.core.events.migrations.v003_memory_fts import V003MemoryFts
                _migrations.append(V003MemoryFts())
            except ImportError:
                pass

            runner = MigrationRunner(self._db_path, _migrations)
            await runner.initialize()
            await runner.run_pending()
            await runner.close()

            from cabinet.core.audit import AuditStore as _AuditStore

            self._audit_store = _AuditStore(_os.path.join(_os.path.dirname(self._db_path), "audit.db"))
            await self._audit_store.initialize()

            await self._event_store.initialize()
            for store in self._room_stores:
                await store.initialize()
            await self._meeting.restore_from_events()
            await self._strategy.restore_from_events()
            await self._decision.restore_from_events()
            await self._office.restore_from_events()
            await self._summary.restore_from_events()
            await self._secretary.restore_from_events()
```

注意：`audit.db` 是独立数据库，也需要迁移。在 `AuditStore.initialize()` 被调用前，先对 `audit.db` 执行迁移：

```python
            audit_db_path = _os.path.join(_os.path.dirname(self._db_path), "audit.db")
            audit_runner = MigrationRunner(audit_db_path, [V001InitialSchema()])
            await audit_runner.initialize()
            await audit_runner.run_pending()
            await audit_runner.close()
```

但 v001 只创建主数据库的表。需要一个单独的 audit v001 迁移。为简化，在 `V001InitialSchema` 中同时处理 audit.db：

实际上，更简单的方案是让 `AuditStore.initialize()` 保留自己的 `CREATE TABLE`，因为 audit.db 是独立数据库，不与主数据库共享迁移。这样避免过度设计。

**最终方案**：`AuditStore.initialize()` 保留 `CREATE TABLE IF NOT EXISTS audit_log`，仅主数据库 `cabinet.db` 使用 MigrationRunner。这样 audit.db 的 schema 管理独立且简单。

所以 `runtime.py` 的修改仅涉及主数据库：

```python
        if self._db_path:
            import os as _os
            from cabinet.core.events.migrations import MigrationRunner
            from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema

            _migrations = [V001InitialSchema()]
            try:
                from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes
                _migrations.append(V002AddIndexes())
            except ImportError:
                pass
            try:
                from cabinet.core.events.migrations.v003_memory_fts import V003MemoryFts
                _migrations.append(V003MemoryFts())
            except ImportError:
                pass

            runner = MigrationRunner(self._db_path, _migrations)
            await runner.initialize()
            await runner.run_pending()
            await runner.close()

            from cabinet.core.audit import AuditStore as _AuditStore

            self._audit_store = _AuditStore(_os.path.join(_os.path.dirname(self._db_path), "audit.db"))
            await self._audit_store.initialize()
            await self._event_store.initialize()
            for store in self._room_stores:
                await store.initialize()
            await self._meeting.restore_from_events()
            await self._strategy.restore_from_events()
            await self._decision.restore_from_events()
            await self._office.restore_from_events()
            await self._summary.restore_from_events()
            await self._secretary.restore_from_events()
```

同时恢复 `audit.py` 的 `initialize()` 中的 `CREATE TABLE IF NOT EXISTS audit_log`（Task 3 中删除了，现在恢复）。

- [ ] **Step 2: 恢复 `audit.py` 的 CREATE TABLE**

将 `AuditStore.initialize()` 改回：

```python
    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                detail TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                trace_id TEXT DEFAULT ''
            )
        """)
        await self._db.commit()
```

- [ ] **Step 3: 添加 CLI `db` 子命令**

在 `src/cabinet/cli/main.py` 中添加：

```python
db_app = typer.Typer(name="db", help="Database management")
app.add_typer(db_app, name="db")


@db_app.command("migrate")
def db_migrate(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_db_migrate_async(data_dir))


async def _db_migrate_async(data_dir: str) -> None:
    from cabinet.core.events.migrations import MigrationRunner
    from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    _migrations = [V001InitialSchema()]
    try:
        from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes
        _migrations.append(V002AddIndexes())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v003_memory_fts import V003MemoryFts
        _migrations.append(V003MemoryFts())
    except ImportError:
        pass

    runner = MigrationRunner(db_path, _migrations)
    await runner.initialize()
    current = await runner.current_version()
    await runner.run_pending()
    new_version = await runner.current_version()
    await runner.close()

    if current == new_version:
        console.print(f"[green]Database is up to date (version {current}).[/green]")
    else:
        console.print(f"[green]Migrated from version {current} to {new_version}.[/green]")


@db_app.command("version")
def db_version(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_db_version_async(data_dir))


async def _db_version_async(data_dir: str) -> None:
    from cabinet.core.events.migrations import MigrationRunner

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    runner = MigrationRunner(db_path, [])
    await runner.initialize()
    version = await runner.current_version()
    await runner.close()
    console.print(f"Schema version: {version}")


@db_app.command("rollback")
def db_rollback(
    target_version: int = typer.Argument(..., help="Target schema version to rollback to"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_db_rollback_async(target_version, data_dir))


async def _db_rollback_async(target_version: int, data_dir: str) -> None:
    from cabinet.core.events.migrations import MigrationRunner
    from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    _migrations = [V001InitialSchema()]
    try:
        from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes
        _migrations.append(V002AddIndexes())
    except ImportError:
        pass
    try:
        from cabinet.core.events.migrations.v003_memory_fts import V003MemoryFts
        _migrations.append(V003MemoryFts())
    except ImportError:
        pass

    runner = MigrationRunner(db_path, _migrations)
    await runner.initialize()
    await runner.rollback_to(target_version)
    version = await runner.current_version()
    await runner.close()
    console.print(f"[green]Rolled back to schema version {version}.[/green]")
```

- [ ] **Step 4: 运行全量测试**

Run: `python -m pytest tests/ -q`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/runtime.py src/cabinet/core/audit.py src/cabinet/cli/main.py
git commit -m "feat: integrate MigrationRunner into CabinetRuntime.start() and add db CLI commands"
```

---

### Task 5: L1 最终验证

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest tests/ -q`
Expected: 全部 PASS

- [ ] **Step 2: 运行 lint**

Run: `ruff check src/ tests/`
Expected: `All checks passed!`

- [ ] **Step 3: 验证迁移功能**

Run: `python -c "import asyncio; from cabinet.core.events.migrations import MigrationRunner; from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema; import tempfile, os; d=tempfile.mkdtemp(); p=os.path.join(d,'t.db'); r=MigrationRunner(p,[V001InitialSchema()]); asyncio.run(r.initialize()); asyncio.run(r.run_pending()); v=asyncio.run(r.current_version()); asyncio.run(r.close()); print(f'Version: {v}'); assert v==1"`
Expected: `Version: 1`

---

## L2 性能优化 + 负载测试

### Task 6: 创建 v002 索引优化迁移

**Files:**
- Create: `src/cabinet/core/events/migrations/v002_add_indexes.py`

- [ ] **Step 1: 创建 v002 迁移**

```python
from __future__ import annotations

import aiosqlite


class V002AddIndexes:
    version = 2
    description = "add performance indexes to event_store, room_events, memory"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_correlation ON event_store(correlation_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_causation ON event_store(causation_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_store(timestamp)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_sender ON event_store(sender)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_room_events_room_seq ON room_events(room_name, seq)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_memory_owner ON memory(owner_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope)"
        )

    async def down(self, db: aiosqlite.Connection) -> None:
        for idx in [
            "idx_event_correlation",
            "idx_event_causation",
            "idx_event_timestamp",
            "idx_event_sender",
            "idx_room_events_room_seq",
            "idx_memory_owner",
            "idx_memory_scope",
        ]:
            await db.execute(f"DROP INDEX IF EXISTS {idx}")
```

- [ ] **Step 2: 写测试 — v002 索引创建**

在 `tests/unit/core/events/test_migration_runner.py` 末尾添加：

```python
from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes


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
```

- [ ] **Step 3: 运行测试**

Run: `python -m pytest tests/unit/core/events/test_migration_runner.py::test_v002_adds_indexes -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/events/migrations/v002_add_indexes.py tests/unit/core/events/test_migration_runner.py
git commit -m "feat: add v002 migration with performance indexes"
```

---

### Task 7: 创建 v003 FTS5 全文搜索迁移 + 修改 SQLiteMemoryStore

**Files:**
- Create: `src/cabinet/core/events/migrations/v003_memory_fts.py`
- Modify: `src/cabinet/core/memory/sqlite_store.py:85-105`

- [ ] **Step 1: 创建 v003 迁移**

```python
from __future__ import annotations

import aiosqlite


class V003MemoryFts:
    version = 3
    description = "add FTS5 full-text search for memory table"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                key, content, metadata,
                content='memory',
                content_rowid='rowid'
            )
            """
        )
        await db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
                INSERT INTO memory_fts(rowid, key, content, metadata)
                VALUES (new.rowid, new.key, new.content, new.metadata);
            END
            """
        )
        await db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
                INSERT INTO memory_fts(memory_fts, rowid, key, content, metadata)
                VALUES ('delete', old.rowid, old.key, old.content, old.metadata);
            END
            """
        )
        await db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
                INSERT INTO memory_fts(memory_fts, rowid, key, content, metadata)
                VALUES ('delete', old.rowid, old.key, old.content, old.metadata);
                INSERT INTO memory_fts(rowid, key, content, metadata)
                VALUES (new.rowid, new.key, new.content, new.metadata);
            END
            """
        )
        await db.execute(
            "INSERT INTO memory_fts(rowid, key, content, metadata) SELECT rowid, key, content, metadata FROM memory"
        )

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP TRIGGER IF EXISTS memory_au")
        await db.execute("DROP TRIGGER IF EXISTS memory_ad")
        await db.execute("DROP TRIGGER IF EXISTS memory_ai")
        await db.execute("DROP TABLE IF EXISTS memory_fts")
```

- [ ] **Step 2: 修改 `SQLiteMemoryStore.search()` — 使用 FTS5**

将 `src/cabinet/core/memory/sqlite_store.py` 中的 `search()` 方法改为：

```python
    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]:
        start = time.monotonic()
        try:
            cursor = await self._db.execute(
                """
                SELECT m.owner_id, m.content, m.metadata
                FROM memory_fts fts
                JOIN memory m ON fts.rowid = m.rowid
                WHERE memory_fts MATCH ? AND m.scope = ?
                LIMIT ?
                """,
                (query, scope.value, limit),
            )
            rows = await cursor.fetchall()
        except Exception:
            cursor = await self._db.execute(
                "SELECT owner_id, content, metadata FROM memory WHERE scope = ? AND content LIKE ? LIMIT ?",
                (scope.value, f"%{query}%", limit),
            )
            rows = await cursor.fetchall()
        results = [
            MemoryItem(
                owner_id=UUID(row[0]),
                scope=scope,
                content=row[1],
                metadata=json.loads(row[2]),
            )
            for row in rows
        ]
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store="sqlite_memory", operation="search").observe(
                time.monotonic() - start
            )
        return results
```

注意：FTS5 的 `MATCH` 查询需要特殊处理查询字符串（不能直接用原始用户输入，需要转义特殊字符）。添加一个辅助方法：

在 `SQLiteMemoryStore` 类中添加：

```python
    @staticmethod
    def _fts_escape(query: str) -> str:
        escaped = query.replace('"', '""')
        return f'"{escaped}"'
```

然后在 `search()` 中使用 `self._fts_escape(query)` 替代 `query`：

```python
                WHERE memory_fts MATCH ? AND m.scope = ?
                """,
                (self._fts_escape(query), scope.value, limit),
```

- [ ] **Step 3: 写测试 — FTS5 搜索**

在 `tests/unit/core/memory/test_sqlite_store.py` 末尾添加（如果文件不存在则创建）：

```python
from __future__ import annotations

import os
import tempfile

import pytest

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
from cabinet.core.events.migrations.v003_memory_fts import V003MemoryFts
from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
from cabinet.models.primitives import MemoryItem, MemoryScope
from uuid import uuid4


@pytest.fixture
async def memory_store():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        runner = MigrationRunner(db_path, [V001InitialSchema(), V003MemoryFts()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()

        store = SQLiteMemoryStore(db_path=db_path)
        await store.initialize()
        yield store
        await store.close()


async def test_fts_search(memory_store):
    owner_id = uuid4()
    item1 = MemoryItem(owner_id=owner_id, scope=MemoryScope.LONG_TERM, content="Python is a programming language")
    item2 = MemoryItem(owner_id=owner_id, scope=MemoryScope.LONG_TERM, content="Rust is a systems programming language")
    item3 = MemoryItem(owner_id=owner_id, scope=MemoryScope.LONG_TERM, content="The weather is nice today")

    await memory_store.store("key1", item1, MemoryScope.LONG_TERM)
    await memory_store.store("key2", item2, MemoryScope.LONG_TERM)
    await memory_store.store("key3", item3, MemoryScope.LONG_TERM)

    results = await memory_store.search("programming", MemoryScope.LONG_TERM, limit=5)
    assert len(results) >= 2
    contents = [r.content for r in results]
    assert any("Python" in c for c in contents)
    assert any("Rust" in c for c in contents)
```

- [ ] **Step 4: 运行测试**

Run: `python -m pytest tests/unit/core/memory/test_sqlite_store.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/events/migrations/v003_memory_fts.py src/cabinet/core/memory/sqlite_store.py tests/unit/core/memory/test_sqlite_store.py
git commit -m "feat: add v003 FTS5 migration and update SQLiteMemoryStore.search() to use FTS5"
```

---

### Task 8: 审计日志批量写入

**Files:**
- Modify: `src/cabinet/core/audit.py`

- [ ] **Step 1: 修改 `AuditStore` — 增加批量写入**

将 `src/cabinet/core/audit.py` 中的 `AuditStore` 类改为：

```python
class AuditStore:
    def __init__(self, db_path: str, buffer_size: int = 50, flush_interval: float = 5.0):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None
        self._buffer: list[AuditEvent] = []
        self._buffer_size = buffer_size
        self._flush_interval = flush_interval
        self._flush_task: asyncio.Task | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                detail TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                trace_id TEXT DEFAULT ''
            )
        """)
        await self._db.commit()
        self._flush_task = asyncio.create_task(self._periodic_flush())

    async def log(self, event: AuditEvent) -> None:
        if self._db is None:
            return
        span = trace.get_current_span()
        ctx = span.get_span_context()
        event.trace_id = format(ctx.trace_id, "032x") if ctx.is_valid else event.trace_id
        self._buffer.append(event)
        if len(self._buffer) >= self._buffer_size:
            await self._flush_buffer()

    async def _flush_buffer(self) -> None:
        if not self._buffer or self._db is None:
            return
        events = self._buffer[:]
        self._buffer.clear()
        for event in events:
            await self._db.execute(
                "INSERT INTO audit_log (timestamp, action, actor, resource_type, resource_id, detail, ip_address, trace_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    event.timestamp.isoformat(),
                    event.action,
                    event.actor,
                    event.resource_type,
                    event.resource_id,
                    event.detail,
                    event.ip_address,
                    event.trace_id,
                ),
            )
        await self._db.commit()

    async def _periodic_flush(self) -> None:
        try:
            while True:
                await asyncio.sleep(self._flush_interval)
                await self._flush_buffer()
        except asyncio.CancelledError:
            await self._flush_buffer()

    async def query(self, action: str = "", actor: str = "", limit: int = 100) -> list[AuditEvent]:
        await self._flush_buffer()
        if self._db is None:
            return []
        conditions = []
        params = []
        if action:
            conditions.append("action = ?")
            params.append(action)
        if actor:
            conditions.append("actor = ?")
            params.append(actor)
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        params.append(limit)
        cursor = await self._db.execute(
            f"SELECT timestamp, action, actor, resource_type, resource_id, detail, ip_address, trace_id FROM audit_log{where} ORDER BY id DESC LIMIT ?",
            params,
        )
        rows = await cursor.fetchall()
        return [self._row_to_event(row) for row in rows]

    async def close(self) -> None:
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        await self._flush_buffer()
        if self._db is not None:
            await self._db.close()
            self._db = None

    def _row_to_event(self, row) -> AuditEvent:
        return AuditEvent(
            timestamp=datetime.fromisoformat(row[0]),
            action=row[1],
            actor=row[2],
            resource_type=row[3],
            resource_id=row[4],
            detail=row[5] or "",
            ip_address=row[6] or "",
            trace_id=row[7] or "",
        )
```

在文件顶部添加 `import asyncio`。

- [ ] **Step 2: 运行审计相关测试**

Run: `python -m pytest tests/unit/core/test_audit.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/core/audit.py
git commit -m "feat: add buffered batch writes to AuditStore"
```

---

### Task 9: ChromaDB 去重 + 内存缓存 LRU

**Files:**
- Modify: `src/cabinet/core/knowledge/local_kb.py:42-53`
- Modify: `src/cabinet/core/events/sqlite_room_store.py:25`

- [ ] **Step 1: 修改 `local_kb.py` — 内容哈希去重**

将 `index()` 方法改为：

```python
    async def index(self, documents: list[dict]) -> None:
        ids = []
        contents = []
        metadatas = []
        for doc in documents:
            import hashlib
            content = doc["content"]
            doc_id = hashlib.sha256(content.encode()).hexdigest()[:16]
            ids.append(doc_id)
            contents.append(content)
            metadatas.append(
                {"source": doc.get("source", ""), "metadata": json.dumps(doc.get("metadata", {}))}
            )
        self._collection.upsert(
            ids=ids,
            documents=contents,
            metadatas=metadatas,
        )
        logger.info("Indexed %d documents", len(documents))
```

- [ ] **Step 2: 修改 `sqlite_room_store.py` — LRU 缓存上限**

在 `SqliteRoomEventStore.__init__()` 中添加 `max_cache_size` 参数：

```python
class SqliteRoomEventStore:
    def __init__(self, room_name: str, db_path: str = "data/db/cabinet.db", max_cache_size: int = 10000):
        self._room_name = room_name
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None
        self._cache: list[BaseModel] = []
        self._persisted_count: int = 0
        self._max_cache_size = max_cache_size
```

在 `append()` 方法中添加 LRU 淘汰：

```python
    def append(self, event: BaseModel) -> None:
        self._cache.append(event)
        if len(self._cache) > self._max_cache_size:
            self._cache = self._cache[-self._max_cache_size:]
            self._persisted_count = max(0, self._persisted_count - 1)
```

- [ ] **Step 3: 运行相关测试**

Run: `python -m pytest tests/unit/core/knowledge/ tests/unit/core/events/ -q`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/knowledge/local_kb.py src/cabinet/core/events/sqlite_room_store.py
git commit -m "feat: add content-hash dedup for ChromaDB and LRU cache limit for room events"
```

---

### Task 10: 负载测试基准

**Files:**
- Create: `tests/load/bench_api.py`
- Create: `tests/load/bench_sqlite.py`

- [ ] **Step 1: 创建 `tests/load/bench_sqlite.py`**

```python
"""SQLite write throughput benchmark."""
from __future__ import annotations

import asyncio
import os
import tempfile
import time

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
from cabinet.core.events.sqlite_store import SqliteEventStore
from cabinet.models.events import MessageEnvelope
from uuid import uuid4


async def bench_event_store_append(count: int = 1000) -> float:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "bench.db")
        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()

        store = SqliteEventStore(db_path)
        await store.initialize()

        start = time.monotonic()
        for i in range(count):
            envelope = MessageEnvelope(
                message_id=uuid4(),
                correlation_id=uuid4(),
                causation_id=uuid4(),
                sender="bench",
                recipients=["test"],
                message_type="bench.event",
                payload={"index": i},
            )
            await store.append(envelope)
        elapsed = time.monotonic() - start

        await store.close()
        return elapsed


async def main():
    count = 1000
    elapsed = await bench_event_store_append(count)
    rate = count / elapsed
    print(f"Event store append: {count} events in {elapsed:.2f}s ({rate:.0f} events/s)")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: 创建 `tests/load/bench_api.py`**

```python
"""API endpoint throughput benchmark."""
from __future__ import annotations

import asyncio
import time

import httpx


BASE_URL = "http://localhost:8000"


async def bench_health(n: int = 100) -> float:
    async with httpx.AsyncClient() as client:
        start = time.monotonic()
        for _ in range(n):
            await client.get(f"{BASE_URL}/health")
        return time.monotonic() - start


async def bench_chat(n: int = 50) -> float:
    async with httpx.AsyncClient() as client:
        start = time.monotonic()
        for _ in range(n):
            await client.post(
                f"{BASE_URL}/api/chat",
                json={"message": "Hello", "captain_id": "captain"},
            )
        return time.monotonic() - start


async def main():
    print("=== Cabinet API Load Benchmark ===\n")

    elapsed = await bench_health(100)
    print(f"GET /health: 100 requests in {elapsed:.2f}s ({100/elapsed:.0f} req/s)")

    try:
        elapsed = await bench_chat(50)
        print(f"POST /api/chat: 50 requests in {elapsed:.2f}s ({50/elapsed:.0f} req/s)")
    except Exception as e:
        print(f"POST /api/chat: skipped ({e})")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: 运行 SQLite 基准**

Run: `python tests/load/bench_sqlite.py`
Expected: 输出吞吐量数字（无报错）

- [ ] **Step 4: Commit**

```bash
git add tests/load/
git commit -m "feat: add SQLite and API load benchmark scripts"
```

---

### Task 11: L2 最终验证

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest tests/ -q`
Expected: 全部 PASS

- [ ] **Step 2: 运行 lint**

Run: `ruff check src/ tests/`
Expected: `All checks passed!`

---

## L3 备份与恢复

### Task 12: 创建 BackupManager

**Files:**
- Create: `src/cabinet/core/backup.py`
- Create: `tests/unit/core/test_backup.py`

- [ ] **Step 1: 写失败测试 — BackupManager**

在 `tests/unit/core/test_backup.py` 中：

```python
from __future__ import annotations

import asyncio
import json
import os
import tempfile

import pytest

from cabinet.core.backup import BackupManager


@pytest.fixture
async def setup_data():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_dir = os.path.join(tmpdir, "db")
        os.makedirs(db_dir)

        import aiosqlite
        db_path = os.path.join(db_dir, "cabinet.db")
        async with aiosqlite.connect(db_path) as db:
            await db.execute("CREATE TABLE test (id INTEGER, name TEXT)")
            await db.execute("INSERT INTO test VALUES (1, 'hello')")
            await db.commit()

        config_path = os.path.join(tmpdir, "cabinet.json")
        with open(config_path, "w") as f:
            json.dump({"org": "test"}, f)

        yield tmpdir


async def test_backup_creates_archive(setup_data):
    manager = BackupManager(data_dir=setup_data)
    archive_path = await manager.create_backup()
    assert os.path.exists(archive_path)
    assert archive_path.endswith(".tar.gz")


async def test_backup_contains_manifest(setup_data):
    manager = BackupManager(data_dir=setup_data)
    archive_path = await manager.create_backup()

    import tarfile
    with tarfile.open(archive_path, "r:gz") as tar:
        names = tar.getnames()
    assert any("backup_manifest.json" in n for n in names)


async def test_restore_from_backup(setup_data):
    manager = BackupManager(data_dir=setup_data)
    archive_path = await manager.create_backup()

    restore_dir = tempfile.mkdtemp()
    await manager.restore_backup(archive_path, restore_dir)

    config_path = os.path.join(restore_dir, "cabinet.json")
    assert os.path.exists(config_path)
    with open(config_path) as f:
        data = json.load(f)
    assert data["org"] == "test"


async def test_cleanup_old_backups(setup_data):
    manager = BackupManager(data_dir=setup_data, max_backups=2)
    archives = []
    for _ in range(4):
        path = await manager.create_backup()
        archives.append(path)
        await asyncio.sleep(0.1)

    remaining = [a for a in archives if os.path.exists(a)]
    assert len(remaining) <= 2
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/test_backup.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `src/cabinet/core/backup.py`**

```python
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

from cabinet import __version__

logger = logging.getLogger(__name__)


class BackupManager:
    def __init__(self, data_dir: str, max_backups: int = 10):
        self._data_dir = data_dir
        self._max_backups = max_backups
        self._backup_dir = os.path.join(data_dir, "backups")
        os.makedirs(self._backup_dir, exist_ok=True)

    async def create_backup(self) -> str:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        archive_name = f"cabinet_backup_{timestamp}.tar.gz"
        archive_path = os.path.join(self._backup_dir, archive_name)

        manifest = {
            "version": __version__,
            "schema_version": await self._get_schema_version(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "databases": [],
            "files": [],
            "checksums": {},
        }

        with tempfile.TemporaryDirectory() as staging:
            db_dir = os.path.join(self._data_dir, "db")
            if os.path.isdir(db_dir):
                for db_file in os.listdir(db_dir):
                    if db_file.endswith(".db"):
                        src = os.path.join(db_dir, db_file)
                        dst = os.path.join(staging, "db", db_file)
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        await self._backup_sqlite(src, dst)
                        manifest["databases"].append(f"db/{db_file}")
                        manifest["checksums"][f"db/{db_file}"] = self._file_checksum(dst)

            for fname in ["cabinet.json", "models.json", "employees.json", ".master_key"]:
                src = os.path.join(self._data_dir, fname)
                if os.path.exists(src):
                    dst = os.path.join(staging, fname)
                    with open(src, "rb") as sf, open(dst, "wb") as df:
                        df.write(sf.read())
                    manifest["files"].append(fname)
                    manifest["checksums"][fname] = self._file_checksum(dst)

            vectors_dir = os.path.join(self._data_dir, "vectors")
            if os.path.isdir(vectors_dir):
                dst_dir = os.path.join(staging, "vectors")
                self._copy_tree(vectors_dir, dst_dir)

            manifest_path = os.path.join(staging, "backup_manifest.json")
            with open(manifest_path, "w") as f:
                json.dump(manifest, f, indent=2)

            with tarfile.open(archive_path, "w:gz") as tar:
                tar.add(staging, arcname="")

        logger.info("Backup created: %s", archive_path)
        self._cleanup_old_backups()
        return archive_path

    async def restore_backup(self, archive_path: str, target_dir: str) -> None:
        os.makedirs(target_dir, exist_ok=True)

        with tarfile.open(archive_path, "r:gz") as tar:
            tar.extractall(target_dir)

        manifest_path = os.path.join(target_dir, "backup_manifest.json")
        if os.path.exists(manifest_path):
            with open(manifest_path) as f:
                manifest = json.load(f)
            logger.info("Restored backup from %s (version: %s, schema: %s)",
                        manifest.get("created_at", "unknown"),
                        manifest.get("version", "unknown"),
                        manifest.get("schema_version", "unknown"))
        else:
            logger.warning("No manifest found in backup archive")

    async def _backup_sqlite(self, src_path: str, dst_path: str) -> None:
        try:
            async with aiosqlite.connect(src_path) as db:
                await db.execute(f"VACUUM INTO '{dst_path}'")
        except Exception:
            import shutil
            shutil.copy2(src_path, dst_path)

    async def _get_schema_version(self) -> int:
        db_path = os.path.join(self._data_dir, "db", "cabinet.db")
        if not os.path.exists(db_path):
            return 0
        try:
            async with aiosqlite.connect(db_path) as db:
                cursor = await db.execute(
                    "SELECT MAX(version) FROM schema_version"
                )
                row = await cursor.fetchone()
                return row[0] if row[0] is not None else 0
        except Exception:
            return 0

    @staticmethod
    def _file_checksum(path: str) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return f"sha256:{h.hexdigest()[:16]}"

    @staticmethod
    def _copy_tree(src: str, dst: str) -> None:
        import shutil
        shutil.copytree(src, dst, dirs_exist_ok=True)

    def _cleanup_old_backups(self) -> None:
        backups = sorted(
            [f for f in os.listdir(self._backup_dir) if f.endswith(".tar.gz")],
        )
        while len(backups) > self._max_backups:
            old = os.path.join(self._backup_dir, backups.pop(0))
            os.remove(old)
            logger.info("Removed old backup: %s", old)
```

- [ ] **Step 4: 运行测试**

Run: `python -m pytest tests/unit/core/test_backup.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/backup.py tests/unit/core/test_backup.py
git commit -m "feat: add BackupManager with VACUUM INTO, manifest, and auto-cleanup"
```

---

### Task 13: 添加 CLI backup 子命令

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 添加 backup 子命令**

在 `src/cabinet/cli/main.py` 中添加：

```python
backup_app = typer.Typer(name="backup", help="Backup and restore")
app.add_typer(backup_app, name="backup")


@backup_app.command("create")
def backup_create(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    archive = asyncio.run(_backup_create_async(data_dir))
    console.print(f"[green]Backup created:[/green] {archive}")


async def _backup_create_async(data_dir: str) -> str:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir=data_dir)
    return await manager.create_backup()


@backup_app.command("restore")
def backup_restore(
    archive: str = typer.Argument(..., help="Path to backup archive"),
    data_dir: str = typer.Option("data", "--data-dir", help="Target data directory"),
):
    asyncio.run(_backup_restore_async(archive, data_dir))
    console.print(f"[green]Backup restored to:[/green] {data_dir}")


async def _backup_restore_async(archive: str, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir=data_dir)
    await manager.restore_backup(archive, data_dir)
```

- [ ] **Step 2: 运行测试**

Run: `python -m pytest tests/ -q`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat: add cabinet backup create/restore CLI commands"
```

---

### Task 13b: 定时备份

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Modify: `src/cabinet/core/backup.py`

- [ ] **Step 1: 在 `BackupManager` 中添加定时备份方法**

在 `src/cabinet/core/backup.py` 的 `BackupManager` 类中添加：

```python
    async def schedule_backups(self, interval_hours: float = 24.0) -> None:
        logger.info("Scheduled backups every %.1f hours", interval_hours)
        while True:
            await asyncio.sleep(interval_hours * 3600)
            try:
                archive = await self.create_backup()
                logger.info("Scheduled backup created: %s", archive)
            except Exception:
                logger.error("Scheduled backup failed", exc_info=True)
```

- [ ] **Step 2: 添加 `backup schedule` CLI 命令**

在 `src/cabinet/cli/main.py` 中添加：

```python
@backup_app.command("schedule")
def backup_schedule(
    interval: float = typer.Option(24.0, "--interval", help="Backup interval in hours"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    console.print(f"[cyan]Starting scheduled backups every {interval} hours. Press Ctrl+C to stop.[/cyan]")
    asyncio.run(_backup_schedule_async(data_dir, interval))


async def _backup_schedule_async(data_dir: str, interval: float) -> None:
    from cabinet.core.backup import BackupManager

    manager = BackupManager(data_dir=data_dir)
    await manager.schedule_backups(interval)
```

- [ ] **Step 3: 运行测试**

Run: `python -m pytest tests/unit/core/test_backup.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/backup.py src/cabinet/cli/main.py
git commit -m "feat: add scheduled backup support with cabinet backup schedule command"
```

---

### Task 14: L3 最终验证

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest tests/ -q`
Expected: 全部 PASS

- [ ] **Step 2: 运行 lint**

Run: `ruff check src/ tests/`
Expected: `All checks passed!`

---

## L4 安全审计 + 权限模型

### Task 15: Salt 随机化 + Vault 格式向后兼容

**Files:**
- Modify: `src/cabinet/core/security.py:43-66`

- [ ] **Step 1: 修改 KeyVault — Salt 随机化 + 新格式**

将 `src/cabinet/core/security.py` 中的 `KeyVault` 类改为：

```python
class KeyVault:
    def __init__(
        self,
        enabled: bool = True,
        encryption_key: bytes | None = None,
        key_file: str | None = None,
    ):
        self._enabled = enabled
        if not enabled:
            self._fernet = None
            return
        if encryption_key is not None:
            derived = self._derive_key(encryption_key)
        elif key_file and os.path.exists(key_file):
            with open(key_file, "rb") as f:
                derived = f.read()
            if len(derived) != 44:
                derived = self._derive_key(derived)
        else:
            derived = Fernet.generate_key()
            if key_file:
                os.makedirs(os.path.dirname(key_file) or ".", exist_ok=True)
                with open(key_file, "wb") as f:
                    f.write(derived)
                self._set_file_permissions(key_file)
        self._fernet = Fernet(derived)

    @staticmethod
    def _derive_key(material: bytes, salt: bytes | None = None) -> bytes:
        if len(material) == 44:
            try:
                base64.urlsafe_b64decode(material)
                return material
            except Exception:
                pass
        if salt is None:
            salt = os.urandom(16)
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=480_000,
        )
        return base64.urlsafe_b64encode(kdf.derive(material))

    def encrypt(self, plaintext: str) -> str:
        if not self._enabled:
            return plaintext
        salt = os.urandom(16)
        ciphertext = self._fernet.encrypt(plaintext.encode()).decode()
        salt_b64 = base64.urlsafe_b64encode(salt).decode()
        return f"{salt_b64}${ciphertext}"

    def decrypt(self, ciphertext: str) -> str:
        if not self._enabled:
            return ciphertext
        if "$" in ciphertext:
            _, ct = ciphertext.split("$", 1)
        else:
            ct = ciphertext
        return self._fernet.decrypt(ct.encode()).decode()

    @staticmethod
    def mask_secret(secret: str) -> str:
        if len(secret) <= 4:
            return "****"
        return secret[:3] + "*" * (len(secret) - 3)

    @staticmethod
    def _set_file_permissions(path: str) -> None:
        try:
            os.chmod(path, 0o600)
        except Exception:
            logger.warning("Could not set file permissions on %s", path)

    @staticmethod
    def is_vault_format(value: str) -> bool:
        return value.startswith("vault:")

    @staticmethod
    def is_new_vault_format(value: str) -> bool:
        inner = value[6:]
        return "$" in inner
```

- [ ] **Step 2: 修改 `_init_runtime()` — 自动迁移旧 vault 格式**

在 `src/cabinet/cli/main.py` 的 `_init_runtime()` 函数中，将 API key 解密逻辑改为：

```python
    migrated = False
    for provider, key in config.api_keys.items():
        if key.startswith("vault:"):
            inner = key[6:]
            decrypted = vault.decrypt(inner)
            os.environ.setdefault(f"{provider.upper()}_API_KEY", decrypted)
            if not vault.is_new_vault_format(key):
                encrypted = vault.encrypt("")
                new_inner = vault.encrypt(decrypted)
                config.api_keys[provider] = f"vault:{new_inner}"
                migrated = True
        else:
            os.environ.setdefault(f"{provider.upper()}_API_KEY", key)
            encrypted = vault.encrypt(key)
            config.api_keys[provider] = f"vault:{encrypted}"
            migrated = True
    if migrated:
        save_config(config, os.path.join(data_dir, "cabinet.json"))
        _migration_logger.info("migrated API key(s) to new vault format")
```

- [ ] **Step 3: 运行安全相关测试**

Run: `python -m pytest tests/unit/core/test_security.py tests/unit/cli/ -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/security.py src/cabinet/cli/main.py
git commit -m "feat: randomize KeyVault salt, add new vault format with backward compatibility"
```

---

### Task 16: RBAC 权限模型 + 认证强制执行

**Files:**
- Create: `src/cabinet/api/auth.py`
- Modify: `src/cabinet/api/deps.py`
- Modify: `src/cabinet/cli/config.py`
- Create: `tests/unit/api/test_auth.py`

- [ ] **Step 1: 创建 `src/cabinet/api/auth.py`**

```python
from __future__ import annotations

from enum import Enum

from fastapi import Depends, HTTPException

from cabinet.api.deps import get_current_user


class Role(str, Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


class Permission(str, Enum):
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"


ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.ADMIN: {Permission.READ, Permission.WRITE, Permission.ADMIN},
    Role.OPERATOR: {Permission.READ, Permission.WRITE},
    Role.VIEWER: {Permission.READ},
}


def require_permission(permission: Permission):
    async def _check(user_info=Depends(get_current_user)) -> str:
        role_name = user_info.get("role", "viewer") if isinstance(user_info, dict) else "viewer"
        role = Role(role_name)
        if permission not in ROLE_PERMISSIONS.get(role, set()):
            raise HTTPException(status_code=403, detail=f"Permission denied: {permission.value} required")
        return user_info if isinstance(user_info, dict) else user_info
    return _check
```

- [ ] **Step 2: 修改 `src/cabinet/cli/config.py` — 添加 api_tokens 和 auth_required**

将 `CabinetConfig` 类改为：

```python
class ApiTokenEntry(BaseModel):
    token: str
    role: str = "admin"


class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    api_keys: dict[str, str] = {}
    api_token: str = ""
    api_tokens: list[ApiTokenEntry] = []
    auth_required: bool = True
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]
    memory_type: Literal["chromadb", "sqlite"] = "chromadb"
    employees_path: str = "data/employees.json"
    skills_dir: str = "data/skills"
    knowledge_dir: str = "data/knowledge"
    created_at: datetime = Field(default_factory=_now)
    observability: ObservabilityConfig = Field(default_factory=ObservabilityConfig)
    vault_enabled: bool = False

    def get_effective_tokens(self) -> list[ApiTokenEntry]:
        if self.api_tokens:
            return self.api_tokens
        if self.api_token:
            return [ApiTokenEntry(token=self.api_token, role="admin")]
        return []
```

- [ ] **Step 3: 修改 `src/cabinet/api/deps.py` — 认证强制执行 + RBAC**

将 `deps.py` 改为：

```python
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime

_security = HTTPBearer(auto_error=False)
_logger = logging.getLogger(__name__)


def get_runtime(request: Request) -> CabinetRuntime:
    return request.app.state.runtime


def get_config(request: Request) -> CabinetConfig:
    return request.app.state.config


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(_security),
    request: Request = None,
) -> dict:
    config: CabinetConfig = request.app.state.config
    tokens = config.get_effective_tokens()

    if not tokens:
        if config.auth_required:
            raise HTTPException(
                status_code=401,
                detail="API token not configured. Set one with: cabinet set-api-token <token>",
            )
        return {"user": "anonymous", "role": "admin"}

    if credentials is None:
        raise HTTPException(status_code=401, detail="Invalid or missing API token")

    for entry in tokens:
        if credentials.credentials == entry.token:
            try:
                runtime = request.app.state.runtime
                if hasattr(runtime, "_audit_store") and runtime._audit_store is not None:
                    from cabinet.core.audit import AuditEvent

                    await runtime._audit_store.log(AuditEvent(
                        action="auth.login",
                        actor=credentials.credentials[:8] + "***",
                        resource_type="api_token",
                        resource_id="session",
                        ip_address=request.client.host if request.client else "",
                    ))
            except Exception:
                _logger.warning("audit log write failed", exc_info=True)
            return {"user": credentials.credentials[:8] + "***", "role": entry.role}

    raise HTTPException(status_code=401, detail="Invalid or missing API token")
```

- [ ] **Step 4: 写测试 — RBAC + 认证强制执行**

在 `tests/unit/api/test_auth.py` 中：

```python
from __future__ import annotations

import pytest

from cabinet.api.auth import Permission, Role, ROLE_PERMISSIONS, require_permission


def test_admin_has_all_permissions():
    assert ROLE_PERMISSIONS[Role.ADMIN] == {Permission.READ, Permission.WRITE, Permission.ADMIN}


def test_operator_has_read_write():
    assert ROLE_PERMISSIONS[Role.OPERATOR] == {Permission.READ, Permission.WRITE}


def test_viewer_has_read_only():
    assert ROLE_PERMISSIONS[Role.VIEWER] == {Permission.READ}


def test_require_permission_returns_dependency():
    dep = require_permission(Permission.WRITE)
    assert callable(dep)
```

- [ ] **Step 5: 运行测试**

Run: `python -m pytest tests/unit/api/test_auth.py tests/unit/api/test_deps.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/api/auth.py src/cabinet/api/deps.py src/cabinet/cli/config.py tests/unit/api/test_auth.py
git commit -m "feat: add RBAC permission model, enforce auth, and support multi-token config"
```

---

### Task 17: API Token 加密 + set-api-token CLI 命令

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 添加 `set-api-token` CLI 命令**

在 `src/cabinet/cli/main.py` 中添加：

```python
@app.command()
def set_api_token(
    token: str = typer.Argument(..., help="API authentication token"),
    role: str = typer.Option("admin", "--role", help="Token role: admin, operator, viewer"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    from cabinet.core.security import KeyVault
    from cabinet.cli.config import load_config, save_config, ApiTokenEntry

    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)
    encrypted = vault.encrypt(token)

    cfg = load_config(config_path)
    cfg.api_tokens.append(ApiTokenEntry(token=f"vault:{encrypted}", role=role))
    save_config(cfg, config_path)
    console.print(f"[green]API token added with role '{role}'.[/green]")
```

- [ ] **Step 2: 修改 `config set-token` 命令 — 也加密存储**

将 `config` 命令中的 `set-token` 分支改为：

```python
    elif action == "set-token":
        if key is None:
            console.print("[red]Error:[/red] Usage: cabinet config set-token <token>")
            raise typer.Exit(code=1)
        from cabinet.core.security import KeyVault
        master_key_path = os.path.join(data_dir, ".master_key")
        vault = KeyVault(key_file=master_key_path)
        encrypted = vault.encrypt(key)
        cfg.api_token = f"vault:{encrypted}"
        save_config(cfg, config_path)
        console.print("[green]API token saved (encrypted).[/green]")
```

- [ ] **Step 3: 修改 `_init_runtime()` — 解密 api_token**

在 `_init_runtime()` 中，在 API key 解密之后添加 api_token 解密：

```python
    if cfg.api_token and cfg.api_token.startswith("vault:"):
        inner = cfg.api_token[6:]
        cfg.api_token = vault.decrypt(inner)
```

注意：这里不能直接修改 `config` 对象的 `api_token` 然后保存（会泄露明文），而是在内存中解密用于认证，不持久化。

- [ ] **Step 4: 运行测试**

Run: `python -m pytest tests/unit/cli/ -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat: add set-api-token CLI command with encrypted storage and role support"
```

---

### Task 18: 输入消毒中间件

**Files:**
- Modify: `src/cabinet/api/app.py:68-73`

- [ ] **Step 1: 修改 `input_sanitization_middleware` — 调用 sanitize_input**

将 `src/cabinet/api/app.py` 中的 `input_sanitization_middleware` 改为：

```python
    @app.middleware("http")
    async def input_sanitization_middleware(request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 1_000_000:
            return JSONResponse(status_code=413, content={"error": "Payload too large"})
        if request.method in ("POST", "PUT", "PATCH"):
            from cabinet.core.security import sanitize_input
            body = await request.body()
            if body:
                sanitized = sanitize_input(body.decode("utf-8", errors="replace"))
                request._body = sanitized.encode("utf-8")
        return await call_next(request)
```

- [ ] **Step 2: 运行 API 测试**

Run: `python -m pytest tests/unit/api/ -q`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/api/app.py
git commit -m "feat: apply sanitize_input in API middleware for POST/PUT/PATCH requests"
```

---

### Task 19: 废弃 AuditLogger + 审计系统统一

**Files:**
- Modify: `src/cabinet/core/security.py:93-112`

- [ ] **Step 1: 废弃 `AuditLogger`**

将 `src/cabinet/core/security.py` 中的 `AuditLogger` 类标记为废弃：

```python
class AuditLogger:
    def __init__(self, max_events: int = 10000):
        import warnings
        warnings.warn(
            "AuditLogger is deprecated. Use cabinet.core.audit.AuditStore instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        self._events: list[dict] = []
        self._max_events = max_events

    def log(self, action: str, actor: str = "", resource: str = "", detail: str = "") -> None:
        event = {
            "timestamp": time.time(),
            "action": action,
            "actor": actor,
            "resource": resource,
            "detail": detail,
        }
        self._events.append(event)
        if len(self._events) > self._max_events:
            self._events = self._events[-self._max_events:]
        logger.info("audit: action=%s actor=%s resource=%s", action, actor, resource)

    def get_events(self, action: str | None = None) -> list[dict]:
        if action is None:
            return list(self._events)
        return [e for e in self._events if e["action"] == action]
```

- [ ] **Step 2: 检查 AuditLogger 的使用**

Run: `grep -rn "AuditLogger" src/cabinet/ --include="*.py"`
Expected: 仅在 `security.py` 中定义，其他地方不使用（或使用时触发 DeprecationWarning）

如果发现其他文件使用了 `AuditLogger`，将其改为使用 `AuditStore`。

- [ ] **Step 3: 运行全量测试**

Run: `python -m pytest tests/ -q`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/security.py
git commit -m "deprecation: mark AuditLogger as deprecated in favor of AuditStore"
```

---

### Task 20: 主密钥文件权限保护

**Files:**
- Modify: `src/cabinet/core/security.py`

- [ ] **Step 1: 添加启动时权限检查**

在 `KeyVault.__init__()` 中，读取密钥文件后添加权限检查：

在 `self._fernet = Fernet(derived)` 之后添加：

```python
        if key_file and os.path.exists(key_file):
            self._check_file_permissions(key_file)
```

添加方法：

```python
    @staticmethod
    def _check_file_permissions(path: str) -> None:
        try:
            mode = os.stat(path).st_mode & 0o777
            if mode & 0o077:
                logger.warning(
                    "Key file %s has overly permissive permissions (%o). "
                    "Recommended: 0600 (owner read/write only).",
                    path, mode,
                )
        except Exception:
            pass
```

- [ ] **Step 2: 运行测试**

Run: `python -m pytest tests/unit/core/test_security.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/core/security.py
git commit -m "feat: add key file permission check and warning for KeyVault"
```

---

### Task 21: L4 最终验证

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest tests/ -q`
Expected: 全部 PASS

- [ ] **Step 2: 运行 lint**

Run: `ruff check src/ tests/`
Expected: `All checks passed!`

- [ ] **Step 3: 验证 RBAC 权限**

Run: `python -c "from cabinet.api.auth import Role, Permission, ROLE_PERMISSIONS; assert Permission.ADMIN in ROLE_PERMISSIONS[Role.ADMIN]; assert Permission.WRITE not in ROLE_PERMISSIONS[Role.VIEWER]; print('RBAC OK')"`
Expected: `RBAC OK`

- [ ] **Step 4: 验证备份恢复**

Run: `python -c "import asyncio; from cabinet.core.backup import BackupManager; import tempfile, os; d=tempfile.mkdtemp(); m=BackupManager(d); p=asyncio.run(m.create_backup()); print(f'Backup: {p}'); assert os.path.exists(p); print('Backup OK')"`
Expected: `Backup OK`

- [ ] **Step 5: 验证迁移系统**

Run: `python -c "import asyncio; from cabinet.core.events.migrations import MigrationRunner; from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema; from cabinet.core.events.migrations.v002_add_indexes import V002AddIndexes; import tempfile, os; d=tempfile.mkdtemp(); p=os.path.join(d,'t.db'); r=MigrationRunner(p,[V001InitialSchema(),V002AddIndexes()]); asyncio.run(r.initialize()); asyncio.run(r.run_pending()); v=asyncio.run(r.current_version()); asyncio.run(r.close()); assert v==2; print(f'Migration v{v} OK')"`
Expected: `Migration v2 OK`

- [ ] **Step 6: 确认所有文件已提交**

Run: `git status`
Expected: `nothing to commit, working tree clean`
