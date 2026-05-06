# 生产加固 + 发布准备 收尾 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成生产加固和发布准备两份设计规格中剩余的 4 项缺口：AuditLogger 清理、AuditStore 查询增强、定时备份、E2E 验证。

**Architecture:** 严格顺序执行（Task 1 → 2 → 3 → 4），Task 2 依赖 Task 1 的清理结果，Task 3 独立，Task 4 在所有修改完成后执行验证。

**Tech Stack:** Python 3.12+, Pydantic v2, aiosqlite, asyncio, FastAPI, Typer, pytest + pytest-asyncio

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/cabinet/core/security.py` | 删除 AuditLogger 类 |
| 修改 | `tests/unit/core/test_security.py` | 删除 AuditLogger 测试 |
| 修改 | `src/cabinet/core/audit.py` | AuditEvent 增加 role 字段；AuditStore.query() 增加时间范围和 role 过滤 |
| 新建 | `src/cabinet/core/events/migrations/v007_audit_role.py` | audit_log 表增加 role 列 |
| 修改 | `src/cabinet/runtime.py` | 注册 v007 迁移 |
| 修改 | `src/cabinet/api/deps.py` | 审计日志记录时传入 role |
| 修改 | `tests/unit/core/test_audit.py` | 增加 role 和时间范围查询测试 |
| 修改 | `src/cabinet/core/backup.py` | 增加 ScheduledBackupManager |
| 修改 | `src/cabinet/cli/main.py` | 增加 backup schedule/unschedule 命令 |
| 修改 | `tests/unit/core/test_backup.py` | 增加 ScheduledBackupManager 测试 |

---

### Task 1: AuditLogger 清理

**Files:**
- Modify: `src/cabinet/core/security.py:115-141`
- Modify: `tests/unit/core/test_security.py:120-139`

- [ ] **Step 1: 删除 AuditLogger 类**

在 `src/cabinet/core/security.py` 中，删除 L115-141 的 `AuditLogger` 类，同时删除不再需要的 `import time` 和 `import warnings`。

将文件顶部的 imports 从：

```python
import base64
import logging
import os
import re
import time
import warnings
```

改为：

```python
import base64
import logging
import os
import re
```

删除整个 `AuditLogger` 类（L115-141）。

- [ ] **Step 2: 删除 AuditLogger 测试**

在 `tests/unit/core/test_security.py` 中，删除 L120-139 的两个测试函数：

- `test_audit_logger_records_event`
- `test_audit_logger_filters_by_action`

- [ ] **Step 3: 运行测试验证**

Run: `python -m pytest tests/unit/core/test_security.py -v`
Expected: 全部 PASS，无 AuditLogger 相关测试

- [ ] **Step 4: 全局搜索确认无残留引用**

Run: `grep -rn "AuditLogger" src/ tests/ --include="*.py"`
Expected: 无结果（仅在 docs/ 中可能有历史引用，无需处理）

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/security.py tests/unit/core/test_security.py
git commit -m "refactor: remove deprecated AuditLogger from security.py"
```

---

### Task 2: AuditStore 查询增强

**Files:**
- Modify: `src/cabinet/core/audit.py`
- Create: `src/cabinet/core/events/migrations/v007_audit_role.py`
- Modify: `src/cabinet/runtime.py`
- Modify: `src/cabinet/api/deps.py`
- Modify: `tests/unit/core/test_audit.py`

- [ ] **Step 1: 写失败测试 — AuditEvent role 字段**

在 `tests/unit/core/test_audit.py` 末尾添加：

```python
async def test_audit_event_role_field():
    from cabinet.core.audit import AuditEvent

    event = AuditEvent(
        action="auth.login",
        actor="captain",
        role="admin",
        resource_type="session",
        resource_id="s1",
    )
    assert event.role == "admin"

    event_no_role = AuditEvent(
        action="auth.login",
        actor="viewer",
        resource_type="session",
        resource_id="s2",
    )
    assert event_no_role.role == ""
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/core/test_audit.py::test_audit_event_role_field -v`
Expected: FAIL — `AuditEvent` 没有 `role` 字段

- [ ] **Step 3: 实现 — AuditEvent 增加 role 字段**

在 `src/cabinet/core/audit.py` 的 `AuditEvent` 类中，在 `actor: str` 之后添加 `role: str = ""`：

```python
class AuditEvent(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    action: str
    actor: str
    role: str = ""
    resource_type: str
    resource_id: str
    detail: str = ""
    ip_address: str = ""
    trace_id: str = ""
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/test_audit.py::test_audit_event_role_field -v`
Expected: PASS

- [ ] **Step 5: 写失败测试 — query() 时间范围和 role 过滤**

在 `tests/unit/core/test_audit.py` 末尾添加：

```python
async def test_audit_store_query_by_role():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        await store.log(AuditEvent(action="auth.login", actor="user1", role="admin", resource_type="token", resource_id="s1"))
        await store.log(AuditEvent(action="auth.login", actor="user2", role="viewer", resource_type="token", resource_id="s2"))
        await store.log(AuditEvent(action="auth.login", actor="user3", role="admin", resource_type="token", resource_id="s3"))
        results = await store.query(role="admin")
        assert len(results) == 2
        for r in results:
            assert r.role == "admin"
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_store_query_by_time_range():
    from datetime import datetime, timedelta, timezone
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        now = datetime.now(timezone.utc)
        old_event = AuditEvent(
            action="data.access",
            actor="user1",
            resource_type="file",
            resource_id="f1",
            timestamp=now - timedelta(hours=48),
        )
        recent_event = AuditEvent(
            action="data.access",
            actor="user2",
            resource_type="file",
            resource_id="f2",
            timestamp=now - timedelta(hours=1),
        )
        await store.log(old_event)
        await store.log(recent_event)
        results = await store.query(start_time=now - timedelta(hours=24))
        assert len(results) == 1
        assert results[0].actor == "user2"
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_store_query_combined_filters():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        await store.log(AuditEvent(action="auth.login", actor="admin1", role="admin", resource_type="token", resource_id="s1"))
        await store.log(AuditEvent(action="auth.login", actor="viewer1", role="viewer", resource_type="token", resource_id="s2"))
        await store.log(AuditEvent(action="data.access", actor="admin2", role="admin", resource_type="file", resource_id="f1"))
        results = await store.query(action="auth.login", role="admin")
        assert len(results) == 1
        assert results[0].actor == "admin1"
        await store.close()
    finally:
        os.unlink(db_path)
```

- [ ] **Step 6: 运行测试确认失败**

Run: `python -m pytest tests/unit/core/test_audit.py::test_audit_store_query_by_role -v`
Expected: FAIL — `query()` 不接受 `role` 参数

- [ ] **Step 7: 实现 — AuditStore.query() 增强和 _flush_buffer 更新**

替换 `src/cabinet/core/audit.py` 中的 `query` 方法（L88-107）为：

```python
    async def query(
        self,
        action: str = "",
        actor: str = "",
        role: str = "",
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        limit: int = 100,
    ) -> list[AuditEvent]:
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
        if role:
            conditions.append("role = ?")
            params.append(role)
        if start_time:
            conditions.append("timestamp >= ?")
            params.append(start_time.isoformat())
        if end_time:
            conditions.append("timestamp <= ?")
            params.append(end_time.isoformat())
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        params.append(limit)
        cursor = await self._db.execute(
            f"SELECT timestamp, action, actor, role, resource_type, resource_id, detail, ip_address, trace_id FROM audit_log{where} ORDER BY id DESC LIMIT ?",
            params,
        )
        rows = await cursor.fetchall()
        return [self._row_to_event(row) for row in rows]
```

替换 `_flush_buffer` 方法（L58-78）为：

```python
    async def _flush_buffer(self) -> None:
        if not self._buffer or self._db is None:
            return
        events = self._buffer[:]
        self._buffer.clear()
        for event in events:
            await self._db.execute(
                "INSERT INTO audit_log (timestamp, action, actor, role, resource_type, resource_id, detail, ip_address, trace_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    event.timestamp.isoformat(),
                    event.action,
                    event.actor,
                    event.role,
                    event.resource_type,
                    event.resource_id,
                    event.detail,
                    event.ip_address,
                    event.trace_id,
                ),
            )
        await self._db.commit()
```

替换 `_row_to_event` 方法（L121-131）为：

```python
    def _row_to_event(self, row) -> AuditEvent:
        return AuditEvent(
            timestamp=datetime.fromisoformat(row[0]),
            action=row[1],
            actor=row[2],
            role=row[3] if len(row) > 8 else "",
            resource_type=row[4] if len(row) > 8 else row[3],
            resource_id=row[5] if len(row) > 8 else row[4],
            detail=(row[6] or "") if len(row) > 8 else (row[5] or ""),
            ip_address=(row[7] or "") if len(row) > 8 else (row[6] or ""),
            trace_id=(row[8] or "") if len(row) > 8 else (row[7] or ""),
        )
```

同时更新 `initialize` 方法中的 CREATE TABLE 语句，添加 `role` 列：

```python
    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                role TEXT DEFAULT '',
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                detail TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                trace_id TEXT DEFAULT ''
            )
        """)
        await self._db.commit()
        self._flush_task = asyncio.create_task(self._periodic_flush())
```

- [ ] **Step 8: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/test_audit.py -v`
Expected: 全部 PASS

- [ ] **Step 9: 创建迁移 v007_audit_role.py**

创建 `src/cabinet/core/events/migrations/v007_audit_role.py`：

```python
from __future__ import annotations

import aiosqlite


class V007AuditRole:
    version = 7
    description = "add role column to audit_log"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute("ALTER TABLE audit_log ADD COLUMN role TEXT DEFAULT ''")

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute(
            "CREATE TABLE audit_log_backup AS SELECT id, timestamp, action, actor, resource_type, resource_id, detail, ip_address, trace_id FROM audit_log"
        )
        await db.execute("DROP TABLE audit_log")
        await db.execute(
            "ALTER TABLE audit_log_backup RENAME TO audit_log"
        )
```

- [ ] **Step 10: 在 runtime.py 中注册 v007 迁移**

在 `src/cabinet/runtime.py` 的 `start()` 方法中，在 v006 注册之后添加 v007 注册：

```python
            try:
                from cabinet.core.events.migrations.v006_agent_orchestration import V006AgentOrchestration
                _migrations.append(V006AgentOrchestration())
            except ImportError:
                pass
            try:
                from cabinet.core.events.migrations.v007_audit_role import V007AuditRole
                _migrations.append(V007AuditRole())
            except ImportError:
                pass
```

- [ ] **Step 11: 在 deps.py 审计日志中传入 role**

在 `src/cabinet/api/deps.py` 的 `get_current_user()` 函数中，修改审计日志记录（L53-63），添加 `role` 字段：

```python
    try:
        runtime = request.app.state.runtime
        if hasattr(runtime, "_audit_store") and runtime._audit_store is not None:
            from cabinet.core.audit import AuditEvent
            await runtime._audit_store.log(AuditEvent(
                action="auth.login",
                actor=user["token_label"],
                role=user["role"],
                resource_type="api_token",
                resource_id="session",
                ip_address=request.client.host if request.client else "",
            ))
    except Exception:
        _logger.warning("audit log write failed", exc_info=True)
```

- [ ] **Step 12: 运行全部审计相关测试**

Run: `python -m pytest tests/unit/core/test_audit.py tests/unit/core/test_security.py -v`
Expected: 全部 PASS

- [ ] **Step 13: Commit**

```bash
git add src/cabinet/core/audit.py src/cabinet/core/events/migrations/v007_audit_role.py src/cabinet/runtime.py src/cabinet/api/deps.py tests/unit/core/test_audit.py
git commit -m "feat: add role field and time-range query to AuditStore, add v007 migration"
```

---

### Task 3: 定时备份

**Files:**
- Modify: `src/cabinet/core/backup.py`
- Modify: `src/cabinet/cli/main.py`
- Modify: `tests/unit/core/test_backup.py`

- [ ] **Step 1: 写失败测试 — ScheduledBackupManager 基本功能**

在 `tests/unit/core/test_backup.py` 末尾添加：

```python
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
        scheduled_backups = [b for b in backups if "scheduled" in (b.label or b.backup_path)]
        assert len(scheduled_backups) <= 3
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/core/test_backup.py::test_scheduled_backup_manager_start_stop -v`
Expected: FAIL — `ScheduledBackupManager` 不存在

- [ ] **Step 3: 实现 — ScheduledBackupManager**

在 `src/cabinet/core/backup.py` 末尾添加：

```python
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
```

同时在文件顶部添加 `import asyncio`（如果尚未存在）。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/test_backup.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 添加 CLI backup schedule 命令**

在 `src/cabinet/cli/main.py` 的 `backup_app` 部分（L1024-1037 之后），添加 `schedule` 和 `unschedule` 子命令：

```python
@backup_app.command("schedule")
def backup_schedule(
    interval: float = typer.Option(24, "--interval", help="Backup interval in hours"),
    max_backups: int = typer.Option(10, "--max-backups", help="Maximum scheduled backups to keep"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_backup_schedule_async(interval, max_backups, data_dir))


async def _backup_schedule_async(interval: float, max_backups: int, data_dir: str) -> None:
    from cabinet.core.backup import BackupManager, ScheduledBackupManager

    manager = BackupManager(data_dir)
    scheduled = ScheduledBackupManager(manager, interval_hours=interval, max_backups=max_backups)
    console.print(f"[green]Starting scheduled backup[/green] (every {interval}h, max {max_backups} backups)")
    console.print("[dim]Press Ctrl+C to stop[/dim]")
    await scheduled.start()
    try:
        import signal
        event = asyncio.Event()
        signal.signal(signal.SIGINT, lambda *_: event.set())
        signal.signal(signal.SIGTERM, lambda *_: event.set())
        await event.wait()
    except (KeyboardInterrupt, RuntimeError):
        pass
    finally:
        await scheduled.stop()
    console.print("[green]Scheduled backup stopped[/green]")


@backup_app.command("unschedule")
def backup_unschedule(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    console.print("[yellow]Scheduled backup is not running in this process.[/yellow]")
    console.print("[dim]To stop a running schedule, use Ctrl+C in the terminal running 'cabinet backup schedule'[/dim]")
```

- [ ] **Step 6: 运行全部备份相关测试**

Run: `python -m pytest tests/unit/core/test_backup.py -v`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/core/backup.py src/cabinet/cli/main.py tests/unit/core/test_backup.py
git commit -m "feat: add ScheduledBackupManager with CLI schedule/unschedule commands"
```

---

### Task 4: E2E 验证

**Files:**
- Verify: `examples/e2e_workflow.py`
- Verify: `examples/api_examples.py`
- May modify: 视验证结果而定

- [ ] **Step 1: 运行 lint 检查**

Run: `python -m ruff check src/ tests/`
Expected: 无错误

- [ ] **Step 2: 运行全部单元测试**

Run: `python -m pytest tests/unit/ -v --tb=short`
Expected: 全部 PASS

- [ ] **Step 3: 运行 E2E 工作流（Stub 模式）**

Run: `python examples/e2e_workflow.py --data-dir data`
Expected: 完整工作流在 Stub 模式下正常运行，无报错

- [ ] **Step 4: 验证数据库迁移**

Run: `python -m cabinet db version --data-dir data`
Expected: 显示当前 schema 版本为 7

- [ ] **Step 5: 验证备份功能**

Run: `python -m cabinet backup create --label "e2e_test" --data-dir data`
Expected: 备份创建成功

Run: `python -m cabinet backup list --data-dir data`
Expected: 显示刚创建的备份

- [ ] **Step 6: 修复验证中发现的问题**

如果上述任何步骤失败，根据错误信息修复代码，然后重新运行失败的步骤。

- [ ] **Step 7: 最终全量测试**

Run: `python -m pytest tests/ -v --tb=short`
Expected: 全部 PASS

- [ ] **Step 8: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: resolve issues found during E2E verification"
```

如果没有需要修复的问题，跳过此步骤。

---

## Checkpoint

完成全部 4 个 Task 后，确认：

- [ ] `grep -rn "AuditLogger" src/ tests/ --include="*.py"` 无结果
- [ ] `python -m pytest tests/unit/core/test_audit.py tests/unit/core/test_security.py tests/unit/core/test_backup.py -v` 全部 PASS
- [ ] `python -m ruff check src/ tests/` 无错误
- [ ] `python examples/e2e_workflow.py --data-dir data` 运行成功
