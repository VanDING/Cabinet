# 生产加固设计

> 日期：2026-05-05
> 状态：Draft
> 方案：严格分层递进（数据库迁移 → 性能优化 → 备份恢复 → 安全审计+权限模型）

---

## L1 数据库迁移系统

### 1.1 问题

当前所有 SQLite 表使用 `CREATE TABLE IF NOT EXISTS` 创建，完全没有 schema 版本管理：
- 无法安全修改已有表结构（加列、改类型、删列）
- 无法回滚到之前的 schema
- 升级时可能静默丢失数据
- 多实例部署时 schema 不一致

### 1.2 自研轻量迁移框架

不引入 Alembic（项目只用 SQLite，Alembic 过重），自研轻量方案。

**SchemaVersion 表**：

```sql
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    description TEXT NOT NULL
);
```

**Migration 协议**：

```python
class Migration(Protocol):
    version: int
    description: str

    async def up(self, db: aiosqlite.Connection) -> None: ...
    async def down(self, db: aiosqlite.Connection) -> None: ...
```

**MigrationRunner**：

- 读取 `schema_version` 表获取当前版本
- 按版本号顺序执行未应用的迁移
- 每个迁移在事务内执行
- 支持 `up`（升级）和 `down`（回滚）

**迁移文件组织**：

```
src/cabinet/core/events/migrations/
    __init__.py
    v001_initial_schema.py
    v002_add_indexes.py
    v003_memory_fts.py
    ...
```

**CLI 命令**：

- `cabinet db migrate` — 执行所有待应用的迁移
- `cabinet db version` — 显示当前 schema 版本
- `cabinet db rollback <version>` — 回滚到指定版本

**启动时自动迁移**：`CabinetRuntime.start()` 时自动执行 `MigrationRunner.run_pending()`

### 1.3 初始迁移 (v001)

将现有 `CREATE TABLE IF NOT EXISTS` 语句正式化为 v001 迁移。对于已有数据库，v001 迁移检测表是否存在，若存在则跳过创建、仅写入版本记录。

### 1.4 WAL 模式

在 `MigrationRunner` 初始化时执行 `PRAGMA journal_mode=WAL`，提升并发读写性能。

---

## L2 性能优化 + 负载测试

### 2.1 问题

| 问题 | 严重程度 |
|------|---------|
| `memory` 表搜索使用 `LIKE '%query%'` 全表扫描 | 高 |
| `audit_log` 表无索引 | 中 |
| `event_store` 缺少 `correlation_id`/`causation_id`/`timestamp` 索引 | 中 |
| `room_events` 缺少 `(room_name, seq)` 复合索引 | 中 |
| 审计日志每次写入单独 commit | 低 |
| ChromaDB 知识库无法去重 | 中 |
| 内存缓存无上限控制 | 低 |

### 2.2 索引优化（v002 迁移）

```sql
-- event_store 补充索引
CREATE INDEX IF NOT EXISTS idx_event_correlation ON event_store(correlation_id);
CREATE INDEX IF NOT EXISTS idx_event_causation ON event_store(causation_id);
CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_store(timestamp);
CREATE INDEX IF NOT EXISTS idx_event_sender ON event_store(sender);

-- room_events 复合索引
CREATE INDEX IF NOT EXISTS idx_room_events_room_seq ON room_events(room_name, seq);

-- audit_log 索引
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);

-- memory 表索引
CREATE INDEX IF NOT EXISTS idx_memory_owner ON memory(owner_id);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope);
```

### 2.3 Memory 搜索优化（v003 迁移）

替换 `LIKE '%query%'` 为 SQLite FTS5 全文搜索：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    key, content, metadata,
    content='memory',
    content_rowid='rowid'
);

CREATE TRIGGER memory_ai AFTER INSERT ON memory BEGIN
    INSERT INTO memory_fts(rowid, key, content, metadata)
    VALUES (new.rowid, new.key, new.content, new.metadata);
END;

CREATE TRIGGER memory_ad AFTER DELETE ON memory BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, key, content, metadata)
    VALUES ('delete', old.rowid, old.key, old.content, old.metadata);
END;

CREATE TRIGGER memory_au AFTER UPDATE ON memory BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, key, content, metadata)
    VALUES ('delete', old.rowid, old.key, old.content, old.metadata);
    INSERT INTO memory_fts(rowid, key, content, metadata)
    VALUES (new.rowid, new.key, new.content, new.metadata);
END;
```

搜索改为 `SELECT ... FROM memory_fts WHERE memory_fts MATCH ?`，利用 FTS5 倒排索引。

**已有数据回填**：v003 迁移执行 `INSERT INTO memory_fts(rowid, key, content, metadata) SELECT rowid, key, content, metadata FROM memory;` 将现有数据同步到 FTS 索引。

### 2.4 审计日志批量写入

`AuditStore` 增加缓冲区，每 N 条或每 T 秒批量 flush：

```python
class AuditStore:
    def __init__(self, ..., buffer_size: int = 50, flush_interval: float = 5.0):
        self._buffer: list[AuditEvent] = []
        self._buffer_size = buffer_size
        self._flush_interval = flush_interval
```

### 2.5 ChromaDB 去重

知识库索引时使用内容哈希作为文档 ID，替代随机 UUID：

```python
doc_id = hashlib.sha256(content.encode()).hexdigest()[:16]
```

### 2.6 内存缓存上限

`SqliteRoomEventStore._cache` 增加 LRU 淘汰策略，默认上限 10,000 条。

### 2.7 负载测试基准

创建 `tests/load/` 目录，编写负载测试：

- API 端点吞吐量基准（Chat、Rooms、Employees）
- SQLite 写入吞吐量基准（事件、审计）
- ChromaDB 查询延迟基准
- 并发 WebSocket 连接测试

输出性能基线报告，作为后续优化的参照。

---

## L3 备份与恢复

### 3.1 问题

当前没有任何备份机制：
- SQLite 数据库文件在运行时被锁定，直接复制可能损坏
- ChromaDB 向量数据无备份
- 配置文件无备份
- 无定时备份能力
- 无灾难恢复流程

### 3.2 SQLite 在线备份

使用 SQLite 内置的 `VACUUM INTO` 创建一致性备份：

```python
class BackupManager:
    async def backup_sqlite(self, db_path: Path, backup_dir: Path) -> Path:
        backup_path = backup_dir / f"{db_path.stem}_{timestamp}.db"
        async with aiosqlite.connect(db_path) as db:
            await db.execute(f"VACUUM INTO '{backup_path}'")
        return backup_path
```

### 3.3 全量备份

`cabinet backup create` 命令执行全量备份：
- SQLite 数据库（`cabinet.db`、`audit.db`）→ VACUUM INTO
- ChromaDB 向量目录 → 文件复制（需先 flush）
- 配置文件（`cabinet.json`、`models.json`、`employees.json`）→ 文件复制
- 主密钥（`.master_key`）→ 文件复制
- 输出为 `.tar.gz` 归档，文件名含时间戳

### 3.4 恢复

`cabinet backup restore <archive>` 命令：
- 停止运行时（如果正在运行）
- 解压归档到数据目录
- 验证 schema 版本兼容性
- 重新启动

### 3.5 定时备份

`cabinet backup schedule --interval <hours>` 命令：
- 使用后台线程定期执行备份
- 保留最近 N 份备份（默认 10），自动清理旧备份
- 备份失败时告警（日志 + 可选 webhook）

### 3.6 备份元数据

每个备份归档包含 `backup_manifest.json`：

```json
{
    "version": "0.1.0",
    "schema_version": 2,
    "created_at": "2026-05-05T12:00:00Z",
    "databases": ["cabinet.db", "audit.db"],
    "files": ["cabinet.json", "models.json", ".master_key"],
    "checksums": {"cabinet.db": "sha256:abc123..."}
}
```

---

## L4 安全审计 + 权限模型

### 4.1 问题

| 问题 | 严重程度 |
|------|---------|
| `api_token` 明文存储 | 高 |
| 未配置 token 时认证完全跳过 | 高 |
| `sanitize_input` 未在 API 层使用 | 高 |
| 主密钥文件无权限保护 | 中 |
| Salt 确定性派生 | 中 |
| 无权限模型 | 中 |
| 两套审计系统并存 | 低 |

### 4.2 API Token 加密存储

将 `api_token` 纳入 KeyVault 管理，与 API Key 使用相同的加密机制：
- `cabinet set-api-token <token>` 命令加密存储
- 配置文件中存储为 `vault:$salt$ciphertext` 格式
- 运行时自动解密
- **向后兼容**：解密时检测格式，`vault:<ciphertext>`（旧格式，确定性 salt）和 `vault:$salt$ciphertext>`（新格式，随机 salt）均支持
- **自动迁移**：启动时检测旧格式 `vault:` 前缀（无 `$` 分隔符），自动用新格式重新加密

### 4.3 认证强制执行

修改 `get_current_user` 逻辑：
- 如果配置了 `api_token`，未认证请求返回 401
- 如果未配置 `api_token`，默认拒绝所有非健康检查请求，除非显式设置 `auth_required=false`
- 新增配置项 `auth_required: bool = True`，允许开发模式关闭认证

```python
async def get_current_user(credentials, request) -> str:
    if not config.api_token:
        if config.auth_required:
            raise HTTPException(401, "API token not configured. Set one with: cabinet set-api-token <token>")
        return "anonymous"
    if credentials.credentials != config.api_token:
        raise HTTPException(401)
    return "authenticated"
```

### 4.4 输入消毒中间件

创建 FastAPI 中间件，对所有 POST/PUT/PATCH 请求体自动调用 `sanitize_input`：

```python
class SanitizationMiddleware:
    async def __call__(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            body = await request.body()
            sanitized = sanitize_input(body.decode())
            request._body = sanitized.encode()
        return await call_next(request)
```

通过覆写 `request._body` 实现请求体替换，下游路由读取 `await request.body()` 时获取消毒后的内容。

### 4.5 RBAC 权限模型

引入简单但可扩展的角色模型：

```python
class Role(str, Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"

class Permission(str, Enum):
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"

ROLE_PERMISSIONS = {
    Role.ADMIN: {Permission.READ, Permission.WRITE, Permission.ADMIN},
    Role.OPERATOR: {Permission.READ, Permission.WRITE},
    Role.VIEWER: {Permission.READ},
}
```

- `cabinet set-api-token <token> --role admin` 指定角色
- 配置文件存储多个 token：`api_tokens: [{"token": "vault:...", "role": "admin"}, ...]`
- **向后兼容**：保留 `api_token` 单值字段读取，启动时自动迁移为 `api_tokens` 列表格式（角色默认 `admin`）
- 路由使用 `Depends(require_permission(Permission.WRITE))` 声明所需权限

### 4.6 主密钥文件保护

- 创建时设置文件权限为 `0600`（仅所有者可读写）
- Windows 上使用 `icacls` 设置 ACL
- 启动时检查权限，如果过于宽松则告警

### 4.7 Salt 随机化

修改 KeyVault 的 Salt 生成逻辑，使用 `os.urandom(16)` 生成真随机 Salt，并将 Salt 与密文一起存储：

```
vault:$salt$ciphertext
```

### 4.8 审计系统统一

- 废弃 `AuditLogger`（内存版），统一使用 `AuditStore`（SQLite 版）
- `AuditStore` 增加 `query()` 方法，支持按时间范围、动作类型、角色查询
- 审计事件增加 `role` 字段

---

## 任务总览

| 层级 | 任务 | 涉及文件 |
|------|------|---------|
| L1 | 1.1 SchemaVersion 表 + Migration 协议 + MigrationRunner | `src/cabinet/core/events/migrations/` (新) |
| L1 | 1.2 初始迁移 v001 | `src/cabinet/core/events/migrations/v001_initial_schema.py` (新) |
| L1 | 1.3 CLI db 命令 | `src/cabinet/cli/main.py` |
| L1 | 1.4 启动时自动迁移 | `src/cabinet/runtime.py` |
| L1 | 1.5 WAL 模式 | `src/cabinet/core/events/migrations/runner.py` (新) |
| L2 | 2.1 索引优化 v002 | `src/cabinet/core/events/migrations/v002_add_indexes.py` (新) |
| L2 | 2.2 FTS5 全文搜索 v003 | `src/cabinet/core/events/migrations/v003_memory_fts.py` (新) |
| L2 | 2.3 审计批量写入 | `src/cabinet/core/audit.py` |
| L2 | 2.4 ChromaDB 去重 | `src/cabinet/core/knowledge/local_kb.py` |
| L2 | 2.5 内存缓存 LRU | `src/cabinet/core/events/sqlite_room_store.py` |
| L2 | 2.6 负载测试 | `tests/load/` (新) |
| L3 | 3.1 BackupManager | `src/cabinet/core/backup.py` (新) |
| L3 | 3.2 CLI backup 命令 | `src/cabinet/cli/main.py` |
| L3 | 3.3 定时备份 | `src/cabinet/core/backup.py` |
| L3 | 3.4 备份元数据 | `src/cabinet/core/backup.py` |
| L4 | 4.1 API Token 加密 | `src/cabinet/cli/config.py`, `src/cabinet/cli/main.py` |
| L4 | 4.2 认证强制执行 | `src/cabinet/api/deps.py` |
| L4 | 4.3 输入消毒中间件 | `src/cabinet/api/app.py` |
| L4 | 4.4 RBAC 权限模型 | `src/cabinet/api/auth.py` (新), `src/cabinet/api/deps.py` |
| L4 | 4.5 主密钥文件保护 | `src/cabinet/cli/config.py` |
| L4 | 4.6 Salt 随机化 | `src/cabinet/core/security.py` |
| L4 | 4.7 审计系统统一 | `src/cabinet/core/security.py`, `src/cabinet/core/audit.py` |
