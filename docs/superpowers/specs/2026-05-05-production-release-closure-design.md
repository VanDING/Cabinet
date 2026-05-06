# 生产加固 + 发布准备 收尾设计

> 日期：2026-05-05
> 状态：Approved
> 前置：多智能体编排已完成，两份设计规格（生产加固、发布准备）中大部分功能已实现
> 范围：仅覆盖经验证仍缺失的 4 项缺口

---

## 背景

经过对项目代码的全面审查，生产加固和发布准备两份设计规格中描述的 37 项任务，已有 33 项在之前的迭代中完成实现。本设计仅覆盖剩余 4 项缺口。

### 已实现功能确认清单

| 功能 | 实现位置 | 状态 |
|------|----------|------|
| MigrationRunner + 6个迁移 + WAL模式 | `core/events/migrations/` | ✅ |
| 索引优化 (v002) + FTS5全文搜索 (v003) | `core/events/migrations/` | ✅ |
| 审计批量写入 (缓冲50条 + 5秒刷新) | `core/audit.py` | ✅ |
| ChromaDB去重 (SHA256内容哈希) | `core/knowledge/local_kb.py` | ✅ |
| LRU缓存 (max_cache_size=10000) | `core/events/sqlite_room_store.py` | ✅ |
| 负载测试基准 | `tests/load/` | ✅ |
| BackupManager (create/restore/list/delete) | `core/backup.py` | ✅ |
| API Token加密 + 多令牌模式 | `api/deps.py` | ✅ |
| 认证强制执行 (auth_required) | `api/deps.py` | ✅ |
| 输入消毒中间件 | `api/app.py` | ✅ |
| RBAC (admin/editor/viewer) | `core/auth.py` + `api/deps.py` | ✅ |
| 主密钥文件保护 (0o600) | `core/security.py` | ✅ |
| Salt随机化 (encrypt用os.urandom) | `core/security.py` | ✅ |
| Init命令提示 (set-api-key) | `cli/main.py` | ✅ |
| 版本号统一 (动态importlib) | `__init__.py` | ✅ |
| api_examples.py | `examples/` | ✅ |
| README Mermaid架构图 | `README.md` + `README_CN.md` | ✅ |
| 导入路径修复 (sys.path.insert) | `examples/e2e_workflow.py` + `tutorial.py` | ✅ |
| config set-key弃用标记 | `README.md` + `README_CN.md` | ✅ |
| pyproject.toml完善 | `pyproject.toml` | ✅ |
| LICENSE (MIT) | `LICENSE` | ✅ |
| CHANGELOG.md | `CHANGELOG.md` | ✅ |
| CONTRIBUTING.md | `CONTRIBUTING.md` | ✅ |
| 发布脚本 | `scripts/release.sh` | ✅ |
| API文档说明 (Swagger/ReDoc) | `README.md` + `README_CN.md` | ✅ |

---

## Task 1: AuditLogger 清理

### 问题

`security.py` 中的 `AuditLogger` 类已标记 `DeprecationWarning`，但仍残留在代码中。`AuditStore`（SQLite版）已完全替代其功能。

### 方案

1. 从 `src/cabinet/core/security.py` 删除 `AuditLogger` 类（L115-141）
2. 从 `tests/unit/core/test_security.py` 删除 `AuditLogger` 相关测试（L121-134）

### 影响分析

- `AuditLogger` 仅在 `security.py` 定义和 `test_security.py` 中引用
- 无其他生产代码导入或使用 `AuditLogger`
- 移除后不影响任何运行时行为

### 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/cabinet/core/security.py` |
| 修改 | `tests/unit/core/test_security.py` |

---

## Task 2: AuditStore 查询增强

### 问题

1. `AuditEvent` 缺少 `role` 字段，无法在审计日志中记录操作者角色
2. `AuditStore.query()` 仅支持 `action` 和 `actor` 过滤，缺少时间范围和角色过滤

### 方案

#### 2.1 AuditEvent 增加 role 字段

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

#### 2.2 数据库迁移 v007

```sql
ALTER TABLE audit_log ADD COLUMN role TEXT DEFAULT '';
```

迁移文件 `v007_audit_role.py`：
- `up()`: 添加 `role` 列
- `down()`: 重建表去掉 `role` 列（SQLite 不支持 DROP COLUMN in older versions，但 3.35+ 支持）

#### 2.3 AuditStore.query() 增强

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
```

- 新增 `role` 参数：`WHERE role = ?`
- 新增 `start_time` 参数：`WHERE timestamp >= ?`
- 新增 `end_time` 参数：`WHERE timestamp <= ?`

#### 2.4 审计日志记录时传入 role

`api/deps.py` 中 `get_current_user()` 记录审计日志时，从认证结果获取 role 并传入。

### 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/cabinet/core/audit.py` |
| 新建 | `src/cabinet/core/events/migrations/v007_audit_role.py` |
| 修改 | `src/cabinet/core/events/migrations/__init__.py` |
| 修改 | `src/cabinet/runtime.py` |
| 修改 | `src/cabinet/api/deps.py` |
| 新建 | `tests/unit/core/test_audit.py` |

---

## Task 3: 定时备份

### 问题

当前只有手动备份命令（`cabinet backup create`），缺少定时自动备份能力。生产环境需要定期备份以防止数据丢失。

### 方案

#### 3.1 ScheduledBackupManager

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
        while self._running:
            await asyncio.sleep(self._interval_hours * 3600)
            if not self._running:
                break
            try:
                await self._manager.create_backup(label="scheduled")
                await self._cleanup_old_backups()
            except Exception as e:
                logger.error("Scheduled backup failed: %s", e)

    async def _cleanup_old_backups(self) -> None:
        backups = await self._manager.list_backups()
        scheduled = [b for b in backups if "scheduled" in (b.label or "")]
        if len(scheduled) > self._max_backups:
            for b in scheduled[self._max_backups:]:
                try:
                    await self._manager.delete_backup(b.backup_path)
                except Exception as e:
                    logger.warning("Failed to delete old backup %s: %s", b.backup_path, e)
```

#### 3.2 CLI 命令

```bash
cabinet backup schedule --interval 24 --max-backups 10 --data-dir data
cabinet backup unschedule --data-dir data
```

`schedule` 命令启动一个长期运行的进程，定期执行备份。`unschedule` 命令目前无实际效果（因为没有持久化调度状态），仅作为接口预留。

#### 3.3 Runtime 集成

`CabinetRuntime` 可选地启动 `ScheduledBackupManager`：

```python
# runtime.py start() 中
if self._config.backup_interval_hours and self._config.backup_interval_hours > 0:
    self._scheduled_backup = ScheduledBackupManager(
        backup_manager=self._backup_manager,
        interval_hours=self._config.backup_interval_hours,
        max_backups=self._config.max_backups,
    )
    await self._scheduled_backup.start()
```

### 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/cabinet/core/backup.py` |
| 修改 | `src/cabinet/cli/main.py` |
| 修改 | `src/cabinet/runtime.py` |
| 新建 | `tests/unit/core/test_backup.py` |

---

## Task 4: E2E 验证

### 问题

项目尚未进行过完整的端到端验证，无法确认所有组件协同工作是否正常。

### 方案

#### 4.1 Stub 模式验证

```bash
python examples/e2e_workflow.py --data-dir data
```

验证完整工作流在 Stub 模式下可正常运行。

#### 4.2 API 服务器验证

```bash
cabinet serve --port 8000 --data-dir data
```

验证：
- `/health` 返回 200
- `/ready` 返回 200
- 基本 API 端点可访问

#### 4.3 修复验证中发现的问题

如果验证过程中发现任何 bug 或集成问题，立即修复。

### 涉及文件

| 操作 | 文件 |
|------|------|
| 验证 | `examples/e2e_workflow.py` |
| 验证 | `examples/api_examples.py` |
| 可能修改 | 视验证结果而定 |

---

## 任务总览

| # | 任务 | 优先级 | 复杂度 |
|---|------|--------|--------|
| 1 | AuditLogger 清理 | 中 | 低 |
| 2 | AuditStore 查询增强 | 高 | 中 |
| 3 | 定时备份 | 中 | 中 |
| 4 | E2E 验证 | 高 | 低 |

执行顺序：1 → 2 → 3 → 4（按依赖关系，2 依赖 1 的清理，3 独立，4 在所有修改完成后执行）
