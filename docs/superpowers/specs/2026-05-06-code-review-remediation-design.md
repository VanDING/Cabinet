# Code Review Remediation Design

> Based on comprehensive code review, 2026-05-06

## Overview

Fix 24 issues identified in the full code review, organized in 3 phases by priority:
- Phase 1 (P0): 5 critical security/runtime bugs
- Phase 2 (P1): 7 security hardening items
- Phase 3 (P2): 12 code quality/performance/testing improvements

Strategy: layered progression (P0 -> P1 -> P2), each phase independently verified before proceeding.

## Phase 1: P0 Critical Fixes

### C-1. SQL Injection in BackupManager

**File**: `src/cabinet/core/backup.py:64`

**Problem**: `VACUUM INTO '{backup_path}'` uses string interpolation with user-controlled `label` parameter.

**Fix**: Add whitelist validation for backup path before executing VACUUM INTO.

```python
import re

def _validate_backup_path(path: str) -> None:
    if not re.match(r'^[a-zA-Z0-9_./\\-]+$', str(path)):
        raise ValueError(f"Invalid backup path: {path}")
```

Call `_validate_backup_path(backup_path)` before the VACUUM INTO statement.

**Test**: Attempt backup with malicious label containing `'`, `;`, `--`.

### C-2. Timing Attack on WebSocket Token

**File**: `src/cabinet/api/routes/chat.py:53`

**Problem**: `token != config.api_token` is vulnerable to timing attacks.

**Fix**: Replace with `hmac.compare_digest`.

```python
import hmac
if not hmac.compare_digest(token, config.api_token):
    await websocket.close(code=4001, reason="Unauthorized")
    return
```

**Test**: Verify WebSocket auth still works with correct token, rejects incorrect token.

### C-4. WebSocket Missing Multi-Token + RBAC Support

**File**: `src/cabinet/api/routes/chat.py:51-55`

**Problem**: WebSocket only checks legacy single `api_token`, ignoring the new `api_tokens` list with RBAC roles.

**Fix**: Extract a shared `_verify_ws_token(token, config)` function that:
1. Checks `config.api_token` with `hmac.compare_digest` (legacy)
2. Checks `config.api_tokens` by SHA-256 hashing the provided token and comparing against stored hashes
3. Returns `(role, token_label)` or raises auth failure

```python
def _verify_ws_token(token: str, config) -> tuple[str | None, str | None]:
    if config.api_token:
        stored = config.api_token
        if stored.startswith("sha256:"):
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            if hmac.compare_digest(f"sha256:{token_hash}", stored):
                return "admin", "legacy"
        else:
            if hmac.compare_digest(token, stored):
                return "admin", "legacy"
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    for entry in config.api_tokens:
        if hmac.compare_digest(token_hash, entry.token_hash):
            return entry.role.value, entry.label
    return None, None
```

**Test**: Test WebSocket with legacy token, new RBAC token, and invalid token.

### C-5. safe_eval getattr Sandbox Escape

**File**: `src/cabinet/core/workflow/safe_eval.py:47`

**Problem**: `getattr(value, node.attr, None)` allows accessing dunder attributes like `__class__`, `__subclasses__`.

**Fix**: Block access to attributes starting with underscore.

```python
if isinstance(node, ast.Attribute):
    value = _eval_node(node.value, context_data)
    if isinstance(value, dict):
        return value.get(node.attr)
    if node.attr.startswith('_'):
        return None
    return getattr(value, node.attr, None)
```

**Test**: Attempt `context.__class__`, `context.__class__.__subclasses__()` in workflow conditions.

### C-6. _init_agent_runtime Runtime Bug

**File**: `src/cabinet/cli/main.py:1382`

**Problem**: `_init_runtime(config, data_dir)` passes 2 args but function signature is `_init_runtime(data_dir: str)`. Also missing `await` and `runtime.start()`.

**Fix**:

```python
async def _init_agent_runtime(data_dir: str):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        return None
    try:
        runtime, _ = await _init_runtime(data_dir)
        return runtime
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        return None
```

**Test**: Run `cabinet agent pool-status` and verify it doesn't crash.

### Phase 1 Verification

- All existing tests pass
- 5 new targeted test cases added
- `ruff check src/ tests/` clean

---

## Phase 2: P1 Security Hardening

### M-16. API Token Plaintext Storage

**File**: `src/cabinet/cli/main.py:377`

**Problem**: `config set-token` stores API token in plaintext in `cabinet.json`.

**Fix**: Store SHA-256 hash instead (consistent with `set-api-token` command). For backward compatibility, detect plaintext tokens on load and auto-migrate.

```python
# In config set-token handler:
token_hash = hashlib.sha256(key.encode()).hexdigest()
cfg.api_token = f"sha256:{token_hash}"
```

In `deps.py:get_current_user`, handle both plaintext and hashed formats during comparison.

### M-17. API Key in Environment Variables

**File**: `src/cabinet/cli/main.py:486`

**Problem**: Decrypted API keys set to `os.environ` persist for entire process lifetime.

**Fix**: Pass api_keys directly to `LiteLLMRouterGateway(api_keys=decrypted_keys)` instead of setting `os.environ`. The gateway already supports the `api_keys` parameter and injects keys into `litellm_params` per model entry. Remove the `os.environ.setdefault(env_name, decrypted)` calls entirely.

### M-9. Exception Handler Leaks Internal Info

**File**: `src/cabinet/api/app.py:129-130`

**Problem**: `str(exc)` in generic error handler may expose database paths, connection strings, etc.

**Fix**: Check `CABINET_ENV` environment variable. In production, return generic message only.

```python
import os as _os

@app.exception_handler(Exception)
async def generic_error_handler(request, exc):
    logger.exception("Unhandled exception")
    if _os.environ.get("CABINET_ENV") == "development":
        detail = str(exc)
    else:
        detail = "Internal server error"
    return JSONResponse(status_code=500, content={"error": "Internal error", "detail": detail})
```

### M-18. sanitize_input Incomplete Filtering

**File**: `src/cabinet/core/security.py:99-110`

**Problem**: Only filters `<script>` and `on*=` events. Missing `<iframe>`, `<embed>`, `<object>`, `javascript:`, `data:` protocols, and HTML entity bypass.

**Fix**: Extend filter patterns:

```python
_DANGEROUS_TAGS = re.compile(
    r"<\s*/?(script|iframe|embed|object|applet|form|input|textarea|select|button)[^>]*>",
    re.IGNORECASE | re.DOTALL,
)
_DANGEROUS_PROTOCOLS = re.compile(
    r"(javascript|data|vbscript)\s*:",
    re.IGNORECASE,
)
```

Apply `_DANGEROUS_TAGS.sub("", text)` and `_DANGEROUS_PROTOCOLS.sub("", text)` in `sanitize_input`.

### M-10. top_k No Upper Bound

**File**: `src/cabinet/api/models.py:46`

**Fix**: Add Field constraint.

```python
top_k: int = Field(3, ge=1, le=50)
```

### M-7. ChromaDB Sync Blocking Event Loop

**File**: `src/cabinet/core/memory/vector_store.py`

**Fix**: Wrap all ChromaDB calls with `asyncio.to_thread()`.

```python
async def store(self, key: str, value: MemoryItem, scope: MemoryScope) -> None:
    start = time.monotonic()
    await asyncio.to_thread(
        self._collection.upsert,
        ids=[key],
        documents=[value.content],
        metadatas=[{"scope": scope.value, "owner_id": str(value.owner_id), "key": key}],
    )
```

Apply same pattern to `retrieve`, `search`, `delete`.

### M-12. Global Mutable State _cli_request_id

**File**: `src/cabinet/core/observability.py:108`

**Fix**: Replace with `contextvars.ContextVar`.

```python
import contextvars
_cli_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("cli_request_id", default="")
```

Update `set_cli_request_id`, `get_cli_request_id`, and `TraceInjectingFilter.filter` accordingly.

### Phase 2 Verification

- All existing tests pass
- 7 new targeted tests (including security tests for XSS bypass, top_k boundary, exception info leak)
- `ruff check src/ tests/` clean

---

## Phase 3: P2 Code Quality / Performance / Testing

### 3A. Code Refactoring

#### M-1. CLI main.py Too Long (1464 lines)

Split into `cli/commands/` submodules:
- `cli/commands/__init__.py` — register all sub-apps
- `cli/commands/init_cmd.py` — init command
- `cli/commands/serve_cmd.py` — serve command
- `cli/commands/chat_cmd.py` — chat command + TUI helpers
- `cli/commands/config_cmd.py` — config commands
- `cli/commands/employee_cmd.py` — employee commands
- `cli/commands/skill_cmd.py` — skill commands
- `cli/commands/knowledge_cmd.py` — knowledge commands
- `cli/commands/db_cmd.py` — db migrate/rollback/version
- `cli/commands/backup_cmd.py` — backup commands
- `cli/commands/workflow_cmd.py` — workflow commands
- `cli/commands/agent_cmd.py` — agent commands

`cli/main.py` becomes ~50 lines: import and register all command modules.

#### M-2. Migration List Repeated 3 Times

Create `src/cabinet/core/events/migrations/loader.py`:

```python
import importlib

MIGRATION_MODULES = [
    "v001_initial_schema",
    "v002_add_indexes",
    "v003_memory_fts",
    "v004_workflow_executions",
    "v005_workflow_versions",
    "v006_agent_orchestration",
    "v007_audit_role",
]

def load_all_migrations() -> list:
    from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
    migrations = [V001InitialSchema()]
    for module_name in MIGRATION_MODULES[1:]:
        try:
            mod = importlib.import_module(f"cabinet.core.events.migrations.{module_name}")
            migrations.append(mod.MIGRATION)
        except ImportError:
            pass
    return migrations
```

Replace all 3 occurrences with `load_all_migrations()`.

#### M-3. _init_runtime Too Long (86 lines)

Extract helper functions:
- `_load_and_decrypt_keys(config, vault, data_dir) -> dict[str, str]`
- `_create_gateway(model_list, api_keys) -> LiteLLMRouterGateway`
- `_create_memory_store(config, data_dir) -> MemoryStore`
- `_create_mcp_connector(mcp_servers) -> MCPConnector | None`

#### M-4. AuditStore Fragile Column Mapping

Replace index-based access with column-name access:

```python
def _row_to_event(self, row) -> AuditEvent:
    return AuditEvent(
        timestamp=datetime.fromisoformat(row["timestamp"]),
        action=row["action"],
        actor=row["actor"],
        role=row["role"],
        resource_type=row["resource_type"],
        resource_id=row["resource_id"],
        detail=row["detail"],
        ip_address=row["ip_address"],
        trace_id=row["trace_id"],
    )
```

Set `self._db.row_factory = aiosqlite.Row` in `initialize()`.

#### M-15. Secretary Duplicate Context Building

Extract `_build_context_prompt(captain_id, input_text)` method that:
1. Queries knowledge base
2. Queries memory store
3. Loads conversation history
4. Assembles the full prompt

Use in both `process_input` and `process_input_stream`.

### 3B. Performance Optimization

#### M-13. Event Store Commit on Every Append

Add buffered commit to `SqliteEventStore`:

```python
class SqliteEventStore:
    def __init__(self, ..., buffer_size: int = 20, flush_interval: float = 2.0):
        self._buffer: list[MessageEnvelope] = []
        self._buffer_size = buffer_size
        self._flush_interval = flush_interval
        self._flush_task: asyncio.Task | None = None

    async def append(self, envelope: MessageEnvelope) -> None:
        self._buffer.append(envelope)
        if len(self._buffer) >= self._buffer_size:
            await self._flush_buffer()

    async def _flush_buffer(self) -> None:
        if not self._buffer:
            return
        events = self._buffer[:]
        self._buffer.clear()
        for envelope in events:
            await self._db.execute(...)  # existing insert logic
        await self._db.commit()

    async def close(self) -> None:
        await self._flush_buffer()
        if self._flush_task:
            self._flush_task.cancel()
        await self._db.close()
```

The `close()` method must flush any remaining buffered events before closing the database connection.

#### M-14. Causation Chain N+1 Query

Replace while-loop with recursive CTE:

```sql
WITH RECURSIVE chain AS (
    SELECT * FROM event_store WHERE message_id = ?
    UNION ALL
    SELECT e.* FROM event_store e
    INNER JOIN chain c ON e.message_id = c.causation_id
    WHERE e.message_id != c.message_id
)
SELECT * FROM chain ORDER BY timestamp ASC
```

### 3C. API Improvement

#### M-19. API Routes Return Bare dict

Define Pydantic response models for all room routes:

```python
class MeetingResponse(BaseModel):
    session_id: str
    topic: str
    proposal: str
    confidence: float

class DecisionResponse(BaseModel):
    decision_id: str
    title: str
    status: str

class TaskResponse(BaseModel):
    task_id: str
    status: str

class StrategyResponse(BaseModel):
    blueprint_id: str
    domains: list[str]

class ReviewResponse(BaseModel):
    session_id: str
    insights: list[str]
```

Add `response_model=` to each route decorator.

### 3D. Test Supplements

#### M-20. Integration Tests

Add to `tests/integration/`:
- `test_event_flow.py` — end-to-end event bus flow (meeting -> strategy -> decision -> office)
- `test_websocket_chat.py` — WebSocket chat stream with auth
- `test_backup_restore.py` — backup creation and restoration

#### M-21. Security Tests

Add to existing test files:
- `tests/unit/core/test_security.py` — SQL injection in backup path, XSS filter bypass attempts, dangerous protocol filtering
- `tests/unit/core/workflow/test_safe_eval.py` — dunder attribute access, `__class__` chain, function call attempts

### 3E. Documentation and Configuration

#### M-22. .env.example

Create `.env.example` with all supported environment variables:

```
# Cabinet Configuration
CABINET_DATA_DIR=data
CABINET_LOG_LEVEL=INFO
CABINET_LOG_FORMAT=json
CABINET_ENV=development

# LLM Provider Keys (set via `cabinet setup-provider` instead)
LITELLM_API_KEYS_OPENAI=
LITELLM_API_KEYS_ANTHROPIC=

# Observability
CABINET_OBSERVABILITY_ENABLED=true
CABINET_OTLP_ENDPOINT=
CABINET_PROMETHEUS_PORT=9090
```

#### M-11. Secretary Fallback Without Status Feedback

Add `fallback: bool = False` to `Greeting` and `SecretaryResponse` models. Set to `True` when LLM call fails and fallback text is used.

### Phase 3 Verification

- All tests pass (unit + integration)
- Test coverage >= 75%
- `ruff check src/ tests/` clean
- All CLI commands functional

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Phase 1 fixes break existing behavior | Run full test suite after each fix |
| ChromaDB async wrapper changes behavior | Verify vector store tests still pass |
| CLI refactoring (M-1) is large | Do it last in Phase 3, after all other fixes |
| Event store buffering changes persistence semantics | Flush buffer on close, add periodic flush task |
| API token hashing breaks existing deployments | Auto-detect plaintext tokens on load and migrate |

## Dependencies Between Phases

- Phase 2 depends on Phase 1 (C-2 fix introduces hmac, which Phase 2 M-16 also uses)
- Phase 3 M-1 (CLI refactor) should be done after M-2, M-3 (extracted functions become part of new modules)
- Phase 3 M-13 (event store buffering) should be done after Phase 2 M-7 (ChromaDB async) to avoid merge conflicts in async patterns
