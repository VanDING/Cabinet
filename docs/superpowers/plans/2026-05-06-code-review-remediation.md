# Code Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 24 issues from code review across 3 phases: P0 critical bugs, P1 security hardening, P2 code quality/performance/testing.

**Architecture:** Layered progression — each phase is independently verified before the next begins. Phase 1 fixes critical runtime/security bugs. Phase 2 hardens security (depends on Phase 1's `hmac` introduction). Phase 3 refactors code, optimizes performance, and supplements tests (depends on Phase 2 for async patterns).

**Tech Stack:** Python 3.12+, pytest/pytest-asyncio, aiosqlite, FastAPI, Pydantic v2, ChromaDB, ruff

---

## File Structure

### Phase 1 — Files Created/Modified

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cabinet/core/backup.py` | Modify | Add `_validate_backup_path` + call it before VACUUM INTO |
| `src/cabinet/api/routes/chat.py` | Modify | Replace `!=` with `hmac.compare_digest`, add `_verify_ws_token` |
| `src/cabinet/core/workflow/safe_eval.py` | Modify | Block dunder attribute access |
| `src/cabinet/cli/main.py` | Modify | Fix `_init_agent_runtime` signature and await |
| `tests/unit/core/test_backup.py` | Modify | Add SQL injection test |
| `tests/unit/api/test_chat.py` | Modify | Add WebSocket auth tests |
| `tests/unit/core/workflow/test_safe_eval.py` | Modify | Add dunder escape tests |

### Phase 2 — Files Created/Modified

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cabinet/cli/main.py` | Modify | Hash API token on `set-token`, remove `os.environ.setdefault` |
| `src/cabinet/api/deps.py` | Modify | Handle plaintext + hashed token comparison |
| `src/cabinet/api/app.py` | Modify | Environment-aware exception handler |
| `src/cabinet/core/security.py` | Modify | Extended sanitize patterns |
| `src/cabinet/api/models.py` | Modify | Add `top_k` Field constraint |
| `src/cabinet/core/memory/vector_store.py` | Modify | Wrap ChromaDB calls with `asyncio.to_thread` |
| `src/cabinet/core/observability.py` | Modify | Replace global with `contextvars.ContextVar` |
| `tests/unit/core/test_security.py` | Modify | Add XSS bypass and protocol tests |
| `tests/unit/api/test_models.py` | Modify | Add top_k boundary test |
| `tests/unit/api/test_app.py` | Modify | Add exception handler test |
| `tests/unit/core/test_observability.py` | Modify | Add ContextVar isolation test |
| `tests/unit/core/memory/test_vector_store.py` | Modify | Add async wrapper test |

### Phase 3 — Files Created/Modified

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cabinet/core/events/migrations/loader.py` | Create | Single source of truth for migration list |
| `src/cabinet/cli/main.py` | Modify | Use `loader.py`, extract `_init_runtime` helpers |
| `src/cabinet/runtime.py` | Modify | Use `loader.py` |
| `src/cabinet/core/audit.py` | Modify | Column-name access + `row_factory` |
| `src/cabinet/rooms/secretary/service.py` | Modify | Extract `_build_context_prompt` |
| `src/cabinet/rooms/secretary/models.py` | Modify | Add `fallback` field |
| `src/cabinet/core/events/sqlite_store.py` | Modify | Buffered commit + recursive CTE |
| `src/cabinet/api/models.py` | Modify | Add Pydantic response models |
| `src/cabinet/api/routes/rooms.py` | Modify | Add `response_model=` to routes |
| `tests/integration/test_event_flow.py` | Create | End-to-end event bus flow |
| `tests/integration/test_websocket_chat.py` | Create | WebSocket chat with auth |
| `tests/integration/test_backup_restore.py` | Create | Backup creation and restoration |
| `tests/unit/core/test_security.py` | Modify | SQL injection + XSS + protocol tests |
| `tests/unit/core/workflow/test_safe_eval.py` | Modify | Dunder attribute + function call tests |
| `.env.example` | Create | Document all supported env vars |
| `src/cabinet/cli/commands/__init__.py` | Create | CLI subcommand registration |
| `src/cabinet/cli/commands/init_cmd.py` | Create | init command |
| `src/cabinet/cli/commands/serve_cmd.py` | Create | serve command |
| `src/cabinet/cli/commands/chat_cmd.py` | Create | chat command + TUI helpers |
| `src/cabinet/cli/commands/config_cmd.py` | Create | config commands |
| `src/cabinet/cli/commands/employee_cmd.py` | Create | employee commands |
| `src/cabinet/cli/commands/skill_cmd.py` | Create | skill commands |
| `src/cabinet/cli/commands/knowledge_cmd.py` | Create | knowledge commands |
| `src/cabinet/cli/commands/db_cmd.py` | Create | db migrate/rollback/version |
| `src/cabinet/cli/commands/backup_cmd.py` | Create | backup commands |
| `src/cabinet/cli/commands/workflow_cmd.py` | Create | workflow commands |
| `src/cabinet/cli/commands/agent_cmd.py` | Create | agent commands |

---

## Phase 1: P0 Critical Fixes

### Task 1: C-1 SQL Injection in BackupManager

**Files:**
- Modify: `src/cabinet/core/backup.py:1-64`
- Modify: `tests/unit/core/test_backup.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/core/test_backup.py`:

```python
async def test_create_backup_rejects_malicious_label(backup_env):
    data_dir, manager = backup_env
    with pytest.raises(ValueError, match="Invalid backup path"):
        await manager.create_backup(label="'; DROP TABLE event_store; --")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/test_backup.py::test_create_backup_rejects_malicious_label -v`
Expected: FAIL — no validation exists, VACUUM INTO executes with injected path

- [ ] **Step 3: Write minimal implementation**

Add to `src/cabinet/core/backup.py` after the imports:

```python
import re

def _validate_backup_path(path: str) -> None:
    if not re.match(r'^[a-zA-Z0-9_./\\-]+$', str(path)):
        raise ValueError(f"Invalid backup path: {path}")
```

Add call in `create_backup` method, before the VACUUM INTO line (after `backup_path` is computed on line 57):

```python
        _validate_backup_path(str(backup_path))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/test_backup.py::test_create_backup_rejects_malicious_label -v`
Expected: PASS

- [ ] **Step 5: Run full backup test suite**

Run: `python -m pytest tests/unit/core/test_backup.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/backup.py tests/unit/core/test_backup.py
git commit -m "fix(backup): validate backup path to prevent SQL injection in VACUUM INTO"
```

---

### Task 2: C-2 Timing Attack on WebSocket Token

**Files:**
- Modify: `src/cabinet/api/routes/chat.py:51-55`
- Modify: `tests/unit/api/test_chat.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/api/test_chat.py`:

```python
@pytest.mark.asyncio
async def test_websocket_rejects_invalid_token(app, mock_runtime):
    mock_config = app.state.config
    mock_config.api_token = "correct-token"
    mock_config.auth_required = True

    from starlette.testclient import TestClient

    client = TestClient(app)
    with pytest.raises(Exception):
        with client.websocket_connect("/api/chat/ws?token=wrong-token"):
            pass
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_chat.py::test_websocket_rejects_invalid_token -v`
Expected: FAIL or PASS (existing code already rejects, but via timing-vulnerable `!=`)

- [ ] **Step 3: Write minimal implementation**

In `src/cabinet/api/routes/chat.py`, add import at top:

```python
import hmac
```

Replace lines 51-55:

```python
    if config.api_token:
        token = websocket.query_params.get("token")
        if not hmac.compare_digest(token or "", config.api_token):
            await websocket.close(code=4001, reason="Unauthorized")
            return
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/api/test_chat.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/api/routes/chat.py tests/unit/api/test_chat.py
git commit -m "fix(chat): use hmac.compare_digest for WebSocket token check"
```

---

### Task 3: C-4 WebSocket Multi-Token + RBAC Support

**Files:**
- Modify: `src/cabinet/api/routes/chat.py:1-55`
- Modify: `tests/unit/api/test_chat.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/api/test_chat.py`:

```python
@pytest.mark.asyncio
async def test_websocket_accepts_rbac_token(app, mock_runtime):
    from cabinet.core.auth import Role
    from cabinet.cli.config import ApiTokenEntry

    mock_config = app.state.config
    mock_config.api_token = ""
    mock_config.auth_required = True
    mock_config.api_tokens = [
        ApiTokenEntry(
            token_hash=hashlib.sha256(b"rbac-token").hexdigest(),
            role=Role.VIEWER,
            label="test-viewer",
        )
    ]

    from cabinet.rooms.secretary.service import StreamingSecretaryResponse
    from starlette.testclient import TestClient

    async def fake_stream():
        yield "Hi"

    async def fake_finalize():
        pass

    mock_runtime.secretary.process_input_stream = MagicMock(
        return_value=StreamingSecretaryResponse(stream=fake_stream(), finalize=fake_finalize)
    )

    client = TestClient(app)
    with client.websocket_connect("/api/chat/ws?token=rbac-token&captain_id=test") as ws:
        ws.send_text("hello")
        data = ws.receive_json()
        assert data["type"] in ("chunk", "done")
```

Also add `import hashlib` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_chat.py::test_websocket_accepts_rbac_token -v`
Expected: FAIL — WebSocket only checks `config.api_token`, not `config.api_tokens`

- [ ] **Step 3: Write minimal implementation**

In `src/cabinet/api/routes/chat.py`, add imports:

```python
import hashlib
import hmac
```

Add the shared verification function before the `chat_ws` endpoint:

```python
def _verify_ws_token(token: str | None, config) -> tuple[str | None, str | None]:
    if token is None:
        return None, None
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

Replace the token check block in `chat_ws` (lines 51-55) with:

```python
    if config.api_token or config.api_tokens:
        token = websocket.query_params.get("token")
        role, label = _verify_ws_token(token, config)
        if role is None:
            await websocket.close(code=4001, reason="Unauthorized")
            return
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/api/test_chat.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/api/routes/chat.py tests/unit/api/test_chat.py
git commit -m "feat(chat): add multi-token RBAC support to WebSocket auth"
```

---

### Task 4: C-5 safe_eval getattr Sandbox Escape

**Files:**
- Modify: `src/cabinet/core/workflow/safe_eval.py:43-47`
- Modify: `tests/unit/core/workflow/test_safe_eval.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/core/workflow/test_safe_eval.py`:

```python
def test_safe_eval_blocks_dunder_class():
    result = safe_eval("context.__class__", {"context": {"x": 1}})
    assert result is None


def test_safe_eval_blocks_dunder_subclasses():
    result = safe_eval("context.__class__.__subclasses__", {"context": {"x": 1}})
    assert result is None


def test_safe_eval_blocks_underscore_attribute():
    result = safe_eval("obj._private", {"obj": {"_private": "secret"}})
    assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/workflow/test_safe_eval.py::test_safe_eval_blocks_dunder_class -v`
Expected: FAIL — `getattr` returns `dict.__class__` instead of `None`

- [ ] **Step 3: Write minimal implementation**

Replace the `ast.Attribute` handler in `src/cabinet/core/workflow/safe_eval.py` (lines 43-47):

```python
    if isinstance(node, ast.Attribute):
        value = _eval_node(node.value, context_data)
        if isinstance(value, dict):
            return value.get(node.attr)
        if node.attr.startswith('_'):
            return None
        return getattr(value, node.attr, None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/workflow/test_safe_eval.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/workflow/safe_eval.py tests/unit/core/workflow/test_safe_eval.py
git commit -m "fix(safe_eval): block dunder and underscore attribute access to prevent sandbox escape"
```

---

### Task 5: C-6 _init_agent_runtime Runtime Bug

**Files:**
- Modify: `src/cabinet/cli/main.py:1374-1387`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cli/test_main.py`:

```python
@pytest.mark.asyncio
async def test_init_agent_runtime_returns_none_without_config(tmp_path):
    from cabinet.cli.main import _init_agent_runtime
    result = await _init_agent_runtime(str(tmp_path))
    assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/cli/test_main.py::test_init_agent_runtime_returns_none_without_config -v`
Expected: FAIL — `_init_runtime` is called with wrong number of args

- [ ] **Step 3: Write minimal implementation**

Replace `_init_agent_runtime` in `src/cabinet/cli/main.py` (lines 1374-1387):

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

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/cli/test_main.py::test_init_agent_runtime_returns_none_without_config -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "fix(cli): fix _init_agent_runtime signature and add missing await"
```

---

### Task 6: Phase 1 Verification

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 2: Run ruff lint**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Commit verification state**

```bash
git add -A
git commit -m "chore: Phase 1 P0 critical fixes complete — all tests pass"
```

---

## Phase 2: P1 Security Hardening

### Task 7: M-16 API Token Plaintext Storage

**Files:**
- Modify: `src/cabinet/cli/main.py:373-379`
- Modify: `src/cabinet/api/deps.py:40-41`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/api/test_deps.py`:

```python
@pytest.mark.asyncio
async def test_get_current_user_handles_hashed_api_token():
    from unittest.mock import AsyncMock, MagicMock
    from cabinet.api.deps import get_current_user
    from fastapi.security import HTTPAuthorizationCredentials
    import hashlib

    mock_request = MagicMock()
    token_hash = hashlib.sha256(b"my-token").hexdigest()
    mock_request.app.state.config.api_token = f"sha256:{token_hash}"
    mock_request.app.state.config.api_tokens = []
    mock_request.app.state.config.auth_required = True
    mock_request.client = None

    mock_runtime = MagicMock()
    mock_runtime._audit_store = None
    mock_request.app.state.runtime = mock_runtime

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="my-token")
    result = await get_current_user(credentials, mock_request)
    assert result["role"] == "admin"
    assert result["token_label"] == "legacy"


@pytest.mark.asyncio
async def test_get_current_user_rejects_wrong_token_with_hashed_api_token():
    from unittest.mock import MagicMock
    from cabinet.api.deps import get_current_user
    from fastapi.security import HTTPAuthorizationCredentials
    import hashlib

    mock_request = MagicMock()
    token_hash = hashlib.sha256(b"correct-token").hexdigest()
    mock_request.app.state.config.api_token = f"sha256:{token_hash}"
    mock_request.app.state.config.api_tokens = []
    mock_request.app.state.config.auth_required = True
    mock_request.client = None

    mock_runtime = MagicMock()
    mock_runtime._audit_store = None
    mock_request.app.state.runtime = mock_runtime

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="wrong-token")
    with pytest.raises(Exception):
        await get_current_user(credentials, mock_request)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_deps.py::test_get_current_user_handles_hashed_api_token -v`
Expected: FAIL — `deps.py` compares plaintext, not hash

- [ ] **Step 3: Write minimal implementation**

In `src/cabinet/cli/main.py`, replace the `set-token` handler (lines 373-379):

```python
    elif action == "set-token":
        if key is None:
            console.print("[red]Error:[/red] Usage: cabinet config set-token <token>")
            raise typer.Exit(code=1)
        import hashlib as _hashlib
        token_hash = _hashlib.sha256(key.encode()).hexdigest()
        cfg.api_token = f"sha256:{token_hash}"
        save_config(cfg, config_path)
        console.print("[green]API token saved (hashed).[/green]")
```

In `src/cabinet/api/deps.py`, replace the legacy token check (lines 40-41):

```python
import hmac

    if config.api_token:
        stored = config.api_token
        if stored.startswith("sha256:"):
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            if hmac.compare_digest(f"sha256:{token_hash}", stored):
                user = {"role": "admin", "token_label": "legacy"}
            else:
                token_hash = hashlib.sha256(token.encode()).hexdigest()
                matched = None
                for entry in config.api_tokens:
                    if entry.token_hash == token_hash:
                        matched = entry
                        break
                if matched is None:
                    raise HTTPException(status_code=401, detail="Invalid API token")
                user = {"role": matched.role.value, "token_label": matched.label}
        else:
            if hmac.compare_digest(token, stored):
                user = {"role": "admin", "token_label": "legacy"}
            else:
                token_hash = hashlib.sha256(token.encode()).hexdigest()
                matched = None
                for entry in config.api_tokens:
                    if entry.token_hash == token_hash:
                        matched = entry
                        break
                if matched is None:
                    raise HTTPException(status_code=401, detail="Invalid API token")
                user = {"role": matched.role.value, "token_label": matched.label}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/api/test_deps.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/main.py src/cabinet/api/deps.py tests/unit/api/test_deps.py
git commit -m "fix(auth): store API token as SHA-256 hash, support both plaintext and hashed on read"
```

---

### Task 8: M-17 API Key in Environment Variables

**Files:**
- Modify: `src/cabinet/cli/main.py:484-486`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cli/test_main.py`:

```python
def test_init_runtime_does_not_set_env_vars(tmp_path):
    import os
    original_env = os.environ.copy()
    os.environ.pop("OPENAI_API_KEY", None)

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization
    from uuid import uuid4

    data_dir = str(tmp_path / "data")
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    config = CabinetConfig(
        organization=Organization(name="test", captain_id="cap"),
        default_project=uuid4(),
        api_keys={"openai": "sk-test-key-12345678"},
    )
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    import asyncio
    asyncio.run(_init_runtime(data_dir))

    assert "OPENAI_API_KEY" not in os.environ or os.environ.get("OPENAI_API_KEY") == original_env.get("OPENAI_API_KEY")
    os.environ.clear()
    os.environ.update(original_env)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/cli/test_main.py::test_init_runtime_does_not_set_env_vars -v`
Expected: FAIL — `os.environ.setdefault` sets the env var

- [ ] **Step 3: Write minimal implementation**

In `src/cabinet/cli/main.py`, remove the `os.environ.setdefault` line (line 486). The block from lines 476-486 becomes:

```python
    migrated = False
    for provider_id, key in config.api_keys.items():
        if key.startswith("vault:"):
            decrypted = vault.decrypt(key[6:])
        else:
            decrypted = key
            encrypted = vault.encrypt(key)
            config.api_keys[provider_id] = f"vault:{encrypted}"
            migrated = True
```

The `api_keys` dict already contains decrypted values which are passed to `LiteLLMRouterGateway(model_list=model_list, api_keys=config.api_keys)` on line 492 — that gateway injects keys per model entry, so env vars are not needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/cli/test_main.py::test_init_runtime_does_not_set_env_vars -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "fix(cli): remove os.environ.setdefault for API keys, pass directly to gateway"
```

---

### Task 9: M-9 Exception Handler Leaks Internal Info

**Files:**
- Modify: `src/cabinet/api/app.py:128-130`
- Modify: `tests/unit/api/test_app.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/api/test_app.py`:

```python
@pytest.mark.asyncio
async def test_generic_error_hides_detail_in_production(app, mock_runtime):
    import os

    mock_runtime.secretary.process_input = AsyncMock(side_effect=RuntimeError("db:///secret/path"))

    original_env = os.environ.get("CABINET_ENV")
    os.environ["CABINET_ENV"] = "production"
    try:
        from httpx import ASGITransport, AsyncClient

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/api/chat", json={"message": "hello"})
            assert response.status_code == 500
            data = response.json()
            assert "secret" not in data.get("detail", "")
            assert data["detail"] == "Internal server error"
    finally:
        if original_env is None:
            os.environ.pop("CABINET_ENV", None)
        else:
            os.environ["CABINET_ENV"] = original_env


@pytest.mark.asyncio
async def test_generic_error_shows_detail_in_development(app, mock_runtime):
    import os

    mock_runtime.secretary.process_input = AsyncMock(side_effect=RuntimeError("db:///secret/path"))

    original_env = os.environ.get("CABINET_ENV")
    os.environ["CABINET_ENV"] = "development"
    try:
        from httpx import ASGITransport, AsyncClient

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/api/chat", json={"message": "hello"})
            assert response.status_code == 500
            data = response.json()
            assert "secret" in data.get("detail", "")
    finally:
        if original_env is None:
            os.environ.pop("CABINET_ENV", None)
        else:
            os.environ["CABINET_ENV"] = original_env
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_app.py::test_generic_error_hides_detail_in_production -v`
Expected: FAIL — current handler always returns `str(exc)` in detail

- [ ] **Step 3: Write minimal implementation**

Replace the generic error handler in `src/cabinet/api/app.py` (lines 128-130):

```python
    @app.exception_handler(Exception)
    async def generic_error_handler(request, exc):
        import os as _os
        logger.exception("Unhandled exception")
        if _os.environ.get("CABINET_ENV") == "development":
            detail = str(exc)
        else:
            detail = "Internal server error"
        return JSONResponse(status_code=500, content={"error": "Internal error", "detail": detail})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/api/test_app.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/api/app.py tests/unit/api/test_app.py
git commit -m "fix(api): hide internal error details in production, show in development"
```

---

### Task 10: M-18 sanitize_input Incomplete Filtering

**Files:**
- Modify: `src/cabinet/core/security.py:99-110`
- Modify: `tests/unit/core/test_security.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/core/test_security.py`:

```python
def test_sanitize_input_removes_iframe_tags():
    from cabinet.core.security import sanitize_input
    result = sanitize_input('<iframe src="evil.com"></iframe>Hello')
    assert "<iframe" not in result
    assert "Hello" in result


def test_sanitize_input_removes_javascript_protocol():
    from cabinet.core.security import sanitize_input
    result = sanitize_input('<a href="javascript:alert(1)">click</a>')
    assert "javascript:" not in result


def test_sanitize_input_removes_data_protocol():
    from cabinet.core.security import sanitize_input
    result = sanitize_input('<a href="data:text/html,<script>alert(1)</script>">click</a>')
    assert "data:" not in result


def test_sanitize_input_removes_embed_tags():
    from cabinet.core.security import sanitize_input
    result = sanitize_input('<embed src="evil.swf">Hello')
    assert "<embed" not in result
    assert "Hello" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/test_security.py::test_sanitize_input_removes_iframe_tags -v`
Expected: FAIL — iframe tags not filtered

- [ ] **Step 3: Write minimal implementation**

Replace the pattern definitions in `src/cabinet/core/security.py` (lines 99-101):

```python
_SCRIPT_PATTERN = re.compile(r"<\s*script[^>]*>.*?<\s*/\s*script\s*>", re.IGNORECASE | re.DOTALL)
_DANGEROUS_TAGS = re.compile(
    r"<\s*/?(script|iframe|embed|object|applet|form|input|textarea|select|button)[^>]*>",
    re.IGNORECASE | re.DOTALL,
)
_DANGEROUS_PROTOCOLS = re.compile(r"(javascript|data|vbscript)\s*:", re.IGNORECASE)
_EVENT_PATTERN = re.compile(r"on\w+\s*=", re.IGNORECASE)
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
```

Replace the `sanitize_input` function (lines 104-110):

```python
def sanitize_input(text: str, max_length: int = 10000) -> str:
    text = _CONTROL_CHARS.sub("", text)
    text = _SCRIPT_PATTERN.sub("", text)
    text = _DANGEROUS_TAGS.sub("", text)
    text = _DANGEROUS_PROTOCOLS.sub("", text)
    text = _EVENT_PATTERN.sub("", text)
    if len(text) > max_length:
        text = text[:max_length]
    return text.strip()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/test_security.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/security.py tests/unit/core/test_security.py
git commit -m "fix(security): extend sanitize_input to filter iframe, embed, object, javascript/data protocols"
```

---

### Task 11: M-10 top_k No Upper Bound

**Files:**
- Modify: `src/cabinet/api/models.py:46`
- Modify: `tests/unit/api/test_models.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/api/test_models.py`:

```python
def test_knowledge_query_request_top_k_upper_bound():
    from cabinet.api.models import KnowledgeQueryRequest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        KnowledgeQueryRequest(question="test", top_k=100)

    valid = KnowledgeQueryRequest(question="test", top_k=50)
    assert valid.top_k == 50

    valid_min = KnowledgeQueryRequest(question="test", top_k=1)
    assert valid_min.top_k == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_models.py::test_knowledge_query_request_top_k_upper_bound -v`
Expected: FAIL — `top_k: int = 3` has no constraint

- [ ] **Step 3: Write minimal implementation**

In `src/cabinet/api/models.py`, replace line 46:

```python
    top_k: int = Field(3, ge=1, le=50)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/api/test_models.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/api/models.py tests/unit/api/test_models.py
git commit -m "fix(api): add upper bound constraint to top_k field (1-50)"
```

---

### Task 12: M-7 ChromaDB Sync Blocking Event Loop

**Files:**
- Modify: `src/cabinet/core/memory/vector_store.py`
- Modify: `tests/unit/core/memory/test_vector_store.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/core/memory/test_vector_store.py`:

```python
@pytest.mark.asyncio
async def test_store_uses_to_thread(store):
    import asyncio
    from unittest.mock import patch, MagicMock

    item = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.LONG_TERM,
        content="test content",
    )
    with patch("asyncio.to_thread", wraps=asyncio.to_thread) as mock_to_thread:
        await store.store("thread-test", item, MemoryScope.LONG_TERM)
        mock_to_thread.assert_called()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/memory/test_vector_store.py::test_store_uses_to_thread -v`
Expected: FAIL — ChromaDB calls are synchronous, not wrapped in `asyncio.to_thread`

- [ ] **Step 3: Write minimal implementation**

Add `import asyncio` at the top of `src/cabinet/core/memory/vector_store.py`.

Replace the `store` method:

```python
    async def store(self, key: str, value: MemoryItem, scope: MemoryScope) -> None:
        start = time.monotonic()
        await asyncio.to_thread(
            self._collection.upsert,
            ids=[key],
            documents=[value.content],
            metadatas=[{"scope": scope.value, "owner_id": str(value.owner_id), "key": key}],
        )
        if _OBSERVABILITY_ENABLED:
            VECTOR_OPERATION_LATENCY.labels(operation="store").observe(time.monotonic() - start)
```

Replace the `retrieve` method:

```python
    async def retrieve(self, key: str, scope: MemoryScope) -> MemoryItem | None:
        results = await asyncio.to_thread(
            self._collection.get, ids=[key], where={"scope": scope.value}
        )
        if not results["documents"]:
            return None
        metadata = results["metadatas"][0]
        return MemoryItem(
            owner_id=UUID(metadata["owner_id"]),
            scope=scope,
            content=results["documents"][0],
        )
```

Replace the `search` method:

```python
    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]:
        start = time.monotonic()
        count = await asyncio.to_thread(self._collection.count)
        if count == 0:
            return []
        results = await asyncio.to_thread(
            self._collection.query,
            query_texts=[query],
            n_results=min(limit, count),
            where={"scope": scope.value},
        )
        items = []
        for i, doc in enumerate(results["documents"][0]):
            metadata = results["metadatas"][0][i]
            items.append(
                MemoryItem(
                    owner_id=UUID(metadata["owner_id"]),
                    scope=scope,
                    content=doc,
                )
            )
        if _OBSERVABILITY_ENABLED:
            VECTOR_OPERATION_LATENCY.labels(operation="search").observe(time.monotonic() - start)
        return items
```

Replace the `delete` method:

```python
    async def delete(self, key: str, scope: MemoryScope) -> None:
        await asyncio.to_thread(
            self._collection.delete, ids=[key], where={"scope": scope.value}
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/memory/test_vector_store.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/memory/vector_store.py tests/unit/core/memory/test_vector_store.py
git commit -m "perf(vector_store): wrap ChromaDB calls with asyncio.to_thread to avoid blocking event loop"
```

---

### Task 13: M-12 Global Mutable State _cli_request_id

**Files:**
- Modify: `src/cabinet/core/observability.py:97-118`
- Modify: `tests/unit/core/test_observability.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/core/test_observability.py`:

```python
def test_cli_request_id_contextvar_isolation():
    import asyncio

    from cabinet.core.observability import set_cli_request_id, get_cli_request_id

    async def task_a():
        set_cli_request_id()
        id_a = get_cli_request_id()
        await asyncio.sleep(0.01)
        assert get_cli_request_id() == id_a
        return id_a

    async def task_b():
        set_cli_request_id()
        id_b = get_cli_request_id()
        await asyncio.sleep(0.01)
        assert get_cli_request_id() == id_b
        return id_b

    async def main():
        id_a, id_b = await asyncio.gather(task_a(), task_b())
        assert id_a != id_b

    asyncio.run(main())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/test_observability.py::test_cli_request_id_contextvar_isolation -v`
Expected: FAIL — global variable is shared across concurrent tasks

- [ ] **Step 3: Write minimal implementation**

In `src/cabinet/core/observability.py`, add import:

```python
import contextvars
```

Replace lines 108-118:

```python
_cli_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("cli_request_id", default="")


def set_cli_request_id() -> str:
    rid = str(_uuid.uuid4())[:8]
    _cli_request_id.set(rid)
    return rid


def get_cli_request_id() -> str:
    return _cli_request_id.get()
```

Update `TraceInjectingFilter.filter` (line 104):

```python
        if not hasattr(record, "request_id"):
            record.request_id = _cli_request_id.get("")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/test_observability.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/observability.py tests/unit/core/test_observability.py
git commit -m "fix(observability): replace global _cli_request_id with contextvars.ContextVar for async safety"
```

---

### Task 14: Phase 2 Verification

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 2: Run ruff lint**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Commit verification state**

```bash
git add -A
git commit -m "chore: Phase 2 P1 security hardening complete — all tests pass"
```

---

## Phase 3: P2 Code Quality / Performance / Testing

### Task 15: M-2 Migration List DRY

**Files:**
- Create: `src/cabinet/core/events/migrations/loader.py`
- Modify: `src/cabinet/cli/main.py` (lines 972-1012 and 1078-1118)
- Modify: `src/cabinet/runtime.py` (lines 191-225)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/events/test_migration_loader.py`:

```python
from cabinet.core.events.migrations.loader import load_all_migrations


def test_load_all_migrations_returns_list():
    migrations = load_all_migrations()
    assert isinstance(migrations, list)
    assert len(migrations) >= 1
    assert migrations[0].version == 1


def test_load_all_migrations_first_is_v001():
    from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
    migrations = load_all_migrations()
    assert isinstance(migrations[0], V001InitialSchema)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/events/test_migration_loader.py -v`
Expected: FAIL — `loader.py` does not exist

- [ ] **Step 3: Write minimal implementation**

Create `src/cabinet/core/events/migrations/loader.py`:

```python
from __future__ import annotations

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

Replace the migration list in `src/cabinet/cli/main.py` (two occurrences, around lines 972-1012 and 1078-1118). Each block becomes:

```python
    from cabinet.core.events.migrations.loader import load_all_migrations
    _migrations = load_all_migrations()
```

Replace the migration list in `src/cabinet/runtime.py` (around lines 191-225):

```python
            from cabinet.core.events.migrations.loader import load_all_migrations
            _migrations = load_all_migrations()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/events/test_migration_loader.py -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/events/migrations/loader.py src/cabinet/cli/main.py src/cabinet/runtime.py tests/unit/core/events/test_migration_loader.py
git commit -m "refactor(migrations): extract migration list into loader.py, DRY up 3 occurrences"
```

---

### Task 16: M-3 _init_runtime Too Long — Extract Helpers

**Files:**
- Modify: `src/cabinet/cli/main.py:454-540`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cli/test_main.py`:

```python
def test_load_and_decrypt_keys_returns_dict():
    from cabinet.cli.main import _load_and_decrypt_keys
    from cabinet.core.security import KeyVault

    vault = KeyVault()
    config_api_keys = {"openai": vault.encrypt("sk-test")}
    result = _load_and_decrypt_keys(config_api_keys, vault)
    assert isinstance(result, dict)
    assert result["openai"] == "sk-test"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/cli/test_main.py::test_load_and_decrypt_keys_returns_dict -v`
Expected: FAIL — function does not exist

- [ ] **Step 3: Write minimal implementation**

Add helper functions before `_init_runtime` in `src/cabinet/cli/main.py`:

```python
def _load_and_decrypt_keys(api_keys: dict, vault) -> dict[str, str]:
    decrypted_keys: dict[str, str] = {}
    for provider_id, key in api_keys.items():
        if key.startswith("vault:"):
            decrypted_keys[provider_id] = vault.decrypt(key[6:])
        else:
            decrypted_keys[provider_id] = key
    return decrypted_keys


def _create_gateway(model_list: list, api_keys: dict):
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    return LiteLLMRouterGateway(model_list=model_list, api_keys=api_keys)


def _create_memory_store(config, data_dir: str, db_path: str):
    if config.memory_type == "sqlite":
        from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
        return SQLiteMemoryStore(db_path=db_path)
    from cabinet.core.memory.vector_store import ChromaDBMemoryStore
    return ChromaDBMemoryStore(persist_dir=os.path.join(data_dir, "vectors"))


async def _create_mcp_connector(mcp_servers: list):
    from cabinet.core.tools.mcp_connector import MCPConnector
    connector = MCPConnector()
    for server_config in mcp_servers:
        await connector.connect_server(**server_config.model_dump())
    return connector
```

Refactor `_init_runtime` to use these helpers. The key section becomes:

```python
async def _init_runtime(data_dir: str):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.cli.config import load_config
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase
    from cabinet.core.tools.skill_store import SkillStore
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)

    decrypted_keys = _load_and_decrypt_keys(config.api_keys, vault)

    migrated = False
    for provider_id, key in config.api_keys.items():
        if not key.startswith("vault:"):
            config.api_keys[provider_id] = f"vault:{vault.encrypt(key)}"
            migrated = True
    if migrated:
        from cabinet.cli.config import save_config
        save_config(config, os.path.join(data_dir, "cabinet.json"))

    model_list = _load_model_list(data_dir, config)
    gateway = _create_gateway(model_list, config.api_keys)
    memory_store = _create_memory_store(config, data_dir, db_path)

    employee_store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
    await employee_store.initialize()

    agent_factory = LLMAgentFactory(gateway, memory_store=memory_store, employee_store=employee_store)

    knowledge_base = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))

    kwargs: dict = {
        "agent_factory": agent_factory,
        "db_path": db_path,
        "memory_store": memory_store,
        "gateway": gateway,
        "knowledge_base": knowledge_base,
        "employee_store": employee_store,
    }
    if config.mcp_servers:
        mcp_connector = await _create_mcp_connector(config.mcp_servers)
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)

    skill_store = SkillStore(skills_dir=os.path.join(data_dir, config.skills_dir))
    await skill_store.initialize(runtime.tool_registry)

    await runtime.start()
    return runtime, config
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "refactor(cli): extract _init_runtime helpers for readability"
```

---

### Task 17: M-4 AuditStore Fragile Column Mapping

**Files:**
- Modify: `src/cabinet/core/audit.py:33,147-158`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/core/test_audit.py`:

```python
async def test_audit_store_row_to_event_uses_column_names():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        event = AuditEvent(
            action="test.col_access",
            actor="tester",
            role="admin",
            resource_type="test",
            resource_id="r1",
            detail="column name test",
        )
        await store.log(event)
        await store.close()

        import aiosqlite
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM audit_log WHERE action = ?", ("test.col_access",))
            row = await cursor.fetchone()

        result = AuditStore(db_path)._row_to_event(row)
        assert result.action == "test.col_access"
        assert result.role == "admin"
        assert result.detail == "column name test"
    finally:
        os.unlink(db_path)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/test_audit.py::test_audit_store_row_to_event_uses_column_names -v`
Expected: May pass or fail depending on row_factory state — the existing index-based code is fragile

- [ ] **Step 3: Write minimal implementation**

In `src/cabinet/core/audit.py`, add `row_factory` in `initialize()` after `self._db = await aiosqlite.connect(self._db_path)` (line 37):

```python
            self._db.row_factory = aiosqlite.Row
```

Also add it after `self._db = self._conn_manager.connection` (line 35):

```python
            self._db.row_factory = aiosqlite.Row
```

Replace `_row_to_event` (lines 147-158):

```python
    def _row_to_event(self, row) -> AuditEvent:
        return AuditEvent(
            timestamp=datetime.fromisoformat(row["timestamp"]),
            action=row["action"],
            actor=row["actor"],
            role=row["role"],
            resource_type=row["resource_type"],
            resource_id=row["resource_id"],
            detail=row["detail"] or "",
            ip_address=row["ip_address"] or "",
            trace_id=row["trace_id"] or "",
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/test_audit.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/audit.py tests/unit/core/test_audit.py
git commit -m "refactor(audit): use column-name access instead of index-based mapping"
```

---

### Task 18: M-15 Secretary Duplicate Context Building

**Files:**
- Modify: `src/cabinet/rooms/secretary/service.py:161-330`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/rooms/secretary/test_service.py`:

```python
@pytest.mark.asyncio
async def test_build_context_prompt_returns_string():
    from cabinet.rooms.secretary.service import SecretaryAgentService
    from unittest.mock import AsyncMock, MagicMock

    store = MagicMock()
    store.append = AsyncMock()
    publisher = MagicMock()
    publisher.publish = AsyncMock()
    factory = MagicMock()

    kb = AsyncMock()
    kb.query = AsyncMock(return_value=[])

    memory = AsyncMock()
    memory.search = AsyncMock(return_value=[])

    conversation = AsyncMock()
    conversation.get_history = AsyncMock(return_value=[])

    svc = SecretaryAgentService(
        store=store, publisher=publisher, agent_factory=factory,
        knowledge_base=kb, memory_store=memory, conversation_store=conversation,
    )

    result = await svc._build_context_prompt("captain1", "hello")
    assert isinstance(result, str)
    assert "hello" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py::test_build_context_prompt_returns_string -v`
Expected: FAIL — `_build_context_prompt` does not exist

- [ ] **Step 3: Write minimal implementation**

Add method to `SecretaryAgentService` in `src/cabinet/rooms/secretary/service.py`, before `process_input`:

```python
    async def _build_context_prompt(self, captain_id: str, input_text: str) -> str:
        knowledge_context = ""
        if self._knowledge_base is not None:
            chunks = await self._knowledge_base.query(input_text, top_k=3)
            knowledge_context = "\n".join(c.content for c in chunks)

        memory_context = ""
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope

            items = await self._memory_store.search(
                captain_id,
                MemoryScope.LONG_TERM,
                limit=3,
            )
            memory_context = "\n".join(item.content for item in items)

        conversation_history = ""
        if self._conversation_store is not None:
            history = await self._conversation_store.get_history(captain_id)
            if history:
                lines = []
                for msg in history:
                    role = msg["role"].capitalize()
                    lines.append(f"{role}: {msg['content']}")
                conversation_history = "\n".join(lines)

        prompt = f"Captain says: {input_text}\n\n"
        if conversation_history:
            prompt += f"Recent conversation:\n{conversation_history}\n\n"
        if knowledge_context:
            prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
        if memory_context:
            prompt += f"Captain's preferences and history:\n{memory_context}\n\n"
        prompt += (
            "Parse this instruction and respond appropriately. "
            "If it's a question, answer it. If it's a task, acknowledge and plan. "
            "If it's ambiguous, ask for clarification."
        )
        return prompt
```

Replace the context-building sections in `process_input` (lines 168-208) with:

```python
        prompt = await self._build_context_prompt(context.captain_id, captain_input)
```

Replace the context-building sections in `process_input_stream` (lines 249-288) with:

```python
        prompt = await self._build_context_prompt(context.captain_id, captain_input)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/rooms/secretary/service.py tests/unit/rooms/secretary/test_service.py
git commit -m "refactor(secretary): extract _build_context_prompt to deduplicate context building"
```

---

### Task 19: M-13 Event Store Buffered Commit

**Files:**
- Modify: `src/cabinet/core/events/sqlite_store.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/core/events/test_sqlite_event_store.py`:

```python
@pytest.mark.asyncio
async def test_buffered_commit_flushes_on_close(tmp_path):
    from cabinet.core.events.migrations import MigrationRunner
    from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema

    db_path = str(tmp_path / "buf.db")
    runner = MigrationRunner(db_path, [V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()
    await runner.close()

    store = SqliteEventStore(db_path, buffer_size=5)
    await store.initialize()

    env = MessageEnvelope(
        sender="test", recipients=["test"], message_type="test.buffer", payload={"v": 1}
    )
    await store.append(env)
    await store.close()

    store2 = SqliteEventStore(db_path)
    await store2.initialize()
    result = await store2.get(env.message_id)
    await store2.close()
    assert result is not None
    assert result.payload == {"v": 1}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/events/test_sqlite_event_store.py::test_buffered_commit_flushes_on_close -v`
Expected: May pass — existing code commits on every append. The test verifies the new buffered behavior still persists.

- [ ] **Step 3: Write minimal implementation**

Replace `SqliteEventStore` in `src/cabinet/core/events/sqlite_store.py`:

```python
class SqliteEventStore:
    def __init__(self, db_path: str = "data/db/cabinet.db", conn_manager: object | None = None,
                 buffer_size: int = 20, flush_interval: float = 2.0):
        self._db_path = db_path
        self._conn_manager = conn_manager
        self._db: aiosqlite.Connection | None = None
        self._buffer: list[MessageEnvelope] = []
        self._buffer_size = buffer_size
        self._flush_interval = flush_interval
        self._flush_task: asyncio.Task | None = None

    async def initialize(self) -> None:
        if self._conn_manager is not None:
            self._db = self._conn_manager.connection
        else:
            self._db = await aiosqlite.connect(self._db_path)
            self._db.row_factory = aiosqlite.Row
            await self._db.commit()
        self._flush_task = asyncio.create_task(self._periodic_flush())

    async def append(self, envelope: MessageEnvelope) -> None:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        self._buffer.append(envelope)
        if len(self._buffer) >= self._buffer_size:
            await self._flush_buffer()
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store="event_store", operation="append").observe(
                _time.monotonic() - start
            )

    async def _flush_buffer(self) -> None:
        if not self._buffer or self._db is None:
            return
        events = self._buffer[:]
        self._buffer.clear()
        for envelope in events:
            await self._db.execute(
                """
                INSERT OR REPLACE INTO event_store
                (message_id, correlation_id, causation_id, sender, recipients,
                 message_type, timestamp, status, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(envelope.message_id),
                    str(envelope.correlation_id),
                    str(envelope.causation_id),
                    envelope.sender,
                    json.dumps(envelope.recipients),
                    envelope.message_type,
                    envelope.timestamp.isoformat(),
                    envelope.status,
                    json.dumps(envelope.payload),
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

    async def get(self, message_id: UUID) -> MessageEnvelope | None:
        await self._flush_buffer()
        cursor = await self._db.execute(
            "SELECT * FROM event_store WHERE message_id = ?",
            (str(message_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return self._row_to_envelope(row)

    async def get_by_type(self, message_type: str) -> list[MessageEnvelope]:
        await self._flush_buffer()
        cursor = await self._db.execute(
            "SELECT * FROM event_store WHERE message_type = ?",
            (message_type,),
        )
        rows = await cursor.fetchall()
        return [self._row_to_envelope(row) for row in rows]

    async def get_causation_chain(self, message_id: UUID) -> list[MessageEnvelope]:
        await self._flush_buffer()
        chain = []
        current_id = str(message_id)
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            cursor = await self._db.execute(
                "SELECT * FROM event_store WHERE message_id = ?",
                (current_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                break
            chain.append(self._row_to_envelope(row))
            causation = row["causation_id"]
            current_id = causation if causation != row["message_id"] else None
        chain.reverse()
        return chain

    async def close(self) -> None:
        await self._flush_buffer()
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
        if self._conn_manager is None and self._db:
            await self._db.close()
        self._db = None

    def _row_to_envelope(self, row: aiosqlite.Row) -> MessageEnvelope:
        return MessageEnvelope(
            message_id=UUID(row["message_id"]),
            correlation_id=UUID(row["correlation_id"]),
            causation_id=UUID(row["causation_id"]),
            sender=row["sender"],
            recipients=json.loads(row["recipients"]),
            message_type=row["message_type"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            status=row["status"],
            payload=json.loads(row["payload"]),
        )
```

Add `import asyncio` at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/events/test_sqlite_event_store.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/events/sqlite_store.py tests/unit/core/events/test_sqlite_event_store.py
git commit -m "perf(event_store): add buffered commit to reduce disk I/O on every append"
```

---

### Task 20: M-14 Causation Chain N+1 Query

**Files:**
- Modify: `src/cabinet/core/events/sqlite_store.py` (get_causation_chain method)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/core/events/test_sqlite_event_store.py`:

```python
@pytest.mark.asyncio
async def test_causation_chain_uses_recursive_cte(store):
    env1 = MessageEnvelope(
        sender="room:meeting", recipients=["room:decision"],
        message_type="deliberation.proposal", payload={"proposal": "a"},
    )
    await store.append(env1)
    env2 = MessageEnvelope(
        sender="room:decision", recipients=["room:office"],
        message_type="task.order", payload={"task": "research"},
        causation_id=env1.message_id,
    )
    await store.append(env2)
    env3 = MessageEnvelope(
        sender="room:office", recipients=["room:summary"],
        message_type="task.complete", payload={"result": "done"},
        causation_id=env2.message_id,
    )
    await store.append(env3)

    chain = await store.get_causation_chain(env3.message_id)
    assert len(chain) == 3
    assert chain[0].message_id == env1.message_id
    assert chain[1].message_id == env2.message_id
    assert chain[2].message_id == env3.message_id
```

- [ ] **Step 2: Run test to verify it passes (existing code should still work)**

Run: `python -m pytest tests/unit/core/events/test_sqlite_event_store.py::test_causation_chain_uses_recursive_cte -v`
Expected: PASS — existing while-loop implementation handles this case

- [ ] **Step 3: Replace with recursive CTE**

Replace `get_causation_chain` in `src/cabinet/core/events/sqlite_store.py`:

```python
    async def get_causation_chain(self, message_id: UUID) -> list[MessageEnvelope]:
        await self._flush_buffer()
        cursor = await self._db.execute(
            """
            WITH RECURSIVE chain AS (
                SELECT * FROM event_store WHERE message_id = ?
                UNION ALL
                SELECT e.* FROM event_store e
                INNER JOIN chain c ON e.message_id = c.causation_id
                WHERE e.message_id != c.message_id
            )
            SELECT * FROM chain ORDER BY timestamp ASC
            """,
            (str(message_id),),
        )
        rows = await cursor.fetchall()
        return [self._row_to_envelope(row) for row in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/events/test_sqlite_event_store.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/events/sqlite_store.py tests/unit/core/events/test_sqlite_event_store.py
git commit -m "perf(event_store): replace N+1 causation chain query with recursive CTE"
```

---

### Task 21: M-19 API Routes Return Bare dict

**Files:**
- Modify: `src/cabinet/api/models.py`
- Modify: `src/cabinet/api/routes/rooms.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/api/test_rooms.py`:

```python
def test_meeting_response_model_has_expected_fields():
    from cabinet.api.models import MeetingResponse
    m = MeetingResponse(session_id="abc", topic="test", proposal="prop", confidence=0.9)
    assert m.session_id == "abc"
    assert m.confidence == 0.9


def test_decision_response_model_has_expected_fields():
    from cabinet.api.models import DecisionResponse
    d = DecisionResponse(decision_id="d1", title="t", status="pending")
    assert d.decision_id == "d1"


def test_task_response_model_has_expected_fields():
    from cabinet.api.models import TaskResponse
    t = TaskResponse(task_id="t1", status="running")
    assert t.task_id == "t1"


def test_strategy_response_model_has_expected_fields():
    from cabinet.api.models import StrategyResponse
    s = StrategyResponse(blueprint_id="b1", domains=["tech"])
    assert s.domains == ["tech"]


def test_review_response_model_has_expected_fields():
    from cabinet.api.models import ReviewResponse
    r = ReviewResponse(session_id="s1", insights=["i1"])
    assert r.insights == ["i1"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_rooms.py -v`
Expected: FAIL — response models do not exist

- [ ] **Step 3: Write minimal implementation**

Add to `src/cabinet/api/models.py`:

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

In `src/cabinet/api/routes/rooms.py`, add imports:

```python
from cabinet.api.models import (
    DecisionRequest,
    MeetingRequest,
    MeetingResponse,
    DecisionResponse,
    TaskResponse,
    StrategyResponse,
    ReviewResponse,
    ReviewRequest,
    StrategyRequest,
    TaskRequest,
)
```

Add `response_model=` to each route decorator:

```python
@router.post("/meeting", response_model=MeetingResponse)
```

```python
@router.post("/decision", response_model=DecisionResponse)
```

```python
@router.post("/task", response_model=TaskResponse)
```

```python
@router.post("/strategy", response_model=StrategyResponse)
```

```python
@router.post("/review", response_model=ReviewResponse)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/api/test_rooms.py tests/unit/api/test_models.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/api/models.py src/cabinet/api/routes/rooms.py tests/unit/api/test_rooms.py
git commit -m "feat(api): add Pydantic response models to room routes"
```

---

### Task 22: M-11 Secretary Fallback Without Status Feedback

**Files:**
- Modify: `src/cabinet/rooms/secretary/models.py`
- Modify: `src/cabinet/rooms/secretary/service.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/rooms/secretary/test_models.py`:

```python
def test_greeting_has_fallback_field():
    from cabinet.rooms.secretary.models import Greeting
    g = Greeting(captain_id="cap1", message="Hello", auto_processed_summary="", today_highlights=[])
    assert g.fallback is False

    g_fb = Greeting(captain_id="cap1", message="Welcome back", auto_processed_summary="", today_highlights=[], fallback=True)
    assert g_fb.fallback is True


def test_secretary_response_has_fallback_field():
    from cabinet.rooms.secretary.models import SecretaryResponse, SecretaryLevel
    r = SecretaryResponse(message="Hi", level=SecretaryLevel.L1)
    assert r.fallback is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/secretary/test_models.py::test_greeting_has_fallback_field -v`
Expected: FAIL — `fallback` field does not exist

- [ ] **Step 3: Write minimal implementation**

In `src/cabinet/rooms/secretary/models.py`, add `fallback` field to `Greeting`:

```python
class Greeting(BaseModel):
    captain_id: str
    message: str
    auto_processed_summary: str
    today_highlights: list[str]
    fallback: bool = False
```

Add `fallback` field to `SecretaryResponse`:

```python
class SecretaryResponse(BaseModel):
    message: str
    level: SecretaryLevel
    decision_cards: list[DecisionCard] = []
    actions_taken: list[str] = []
    requires_captain: bool = False
    fallback: bool = False
```

In `src/cabinet/rooms/secretary/service.py`, update the `greet` method's except block (around line 150):

```python
        except Exception as exc:
            logger.exception("LLM call failed in secretary greet: %s", exc)
            greeting_text = f"Welcome back, Captain {captain_id}. How can I assist you today?"
```

And the return (around line 154):

```python
        return Greeting(
            captain_id=captain_id,
            message=greeting_text,
            auto_processed_summary="",
            today_highlights=[],
            fallback=True if "Welcome back" in greeting_text else False,
        )
```

Update `process_input` except block (around line 212):

```python
        except Exception as exc:
            logger.exception("LLM call failed in secretary process_input: %s", exc)
            response_text = "I encountered an error processing your request. Please try again."
            fallback = True
```

And the return:

```python
        return SecretaryResponse(message=response_text, level=SecretaryLevel.L1, fallback=fallback)
```

Add `fallback = False` before the try block in `process_input`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/rooms/secretary/test_models.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/rooms/secretary/models.py src/cabinet/rooms/secretary/service.py tests/unit/rooms/secretary/test_models.py
git commit -m "feat(secretary): add fallback field to Greeting and SecretaryResponse models"
```

---

### Task 23: M-20 + M-21 Integration and Security Tests

**Files:**
- Create: `tests/integration/test_event_flow.py`
- Create: `tests/integration/test_websocket_chat.py`
- Create: `tests/integration/test_backup_restore.py`
- Modify: `tests/unit/core/test_security.py`
- Modify: `tests/unit/core/workflow/test_safe_eval.py`

- [ ] **Step 1: Write integration test — event flow**

Create `tests/integration/test_event_flow.py`:

```python
from __future__ import annotations

import asyncio
import os
import tempfile

import pytest

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema


@pytest.fixture
async def db_env():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()
        yield db_path


@pytest.mark.asyncio
async def test_event_store_append_and_retrieve_flow(db_env):
    from cabinet.core.events.sqlite_store import SqliteEventStore
    from cabinet.models.events import MessageEnvelope

    store = SqliteEventStore(db_env)
    await store.initialize()

    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "expand market"},
    )
    await store.append(env)

    await store._flush_buffer()
    result = await store.get(env.message_id)
    assert result is not None
    assert result.payload["proposal_text"] == "expand market"
    await store.close()


@pytest.mark.asyncio
async def test_event_causation_chain_flow(db_env):
    from cabinet.core.events.sqlite_store import SqliteEventStore
    from cabinet.models.events import MessageEnvelope

    store = SqliteEventStore(db_env)
    await store.initialize()

    env1 = MessageEnvelope(
        sender="room:meeting", recipients=["room:decision"],
        message_type="deliberation.proposal", payload={"p": 1},
    )
    await store.append(env1)

    env2 = MessageEnvelope(
        sender="room:decision", recipients=["room:office"],
        message_type="decision.response", payload={"d": 1},
        causation_id=env1.message_id,
    )
    await store.append(env2)

    await store._flush_buffer()
    chain = await store.get_causation_chain(env2.message_id)
    assert len(chain) == 2
    await store.close()
```

- [ ] **Step 2: Write integration test — WebSocket chat**

Create `tests/integration/test_websocket_chat.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from cabinet.rooms.secretary.models import SecretaryLevel, SecretaryResponse
from cabinet.rooms.secretary.service import StreamingSecretaryResponse


@pytest.mark.asyncio
async def test_websocket_chat_with_auth():
    from cabinet.api.app import create_app
    from cabinet.core.auth import Role
    from cabinet.cli.config import ApiTokenEntry

    mock_runtime = MagicMock()
    mock_runtime.start = AsyncMock()
    mock_runtime.stop = AsyncMock()

    async def fake_stream():
        yield "Hello"

    async def fake_finalize():
        pass

    mock_runtime.secretary = AsyncMock()
    mock_runtime.secretary.process_input_stream = MagicMock(
        return_value=StreamingSecretaryResponse(stream=fake_stream(), finalize=fake_finalize)
    )

    mock_config = MagicMock()
    mock_config.cors_origins = ["*"]
    mock_config.api_token = "test-token"
    mock_config.api_tokens = []
    mock_config.auth_required = True

    app = create_app(mock_runtime, mock_config)

    from starlette.testclient import TestClient
    client = TestClient(app)
    with client.websocket_connect("/api/chat/ws?token=test-token") as ws:
        ws.send_text("hello")
        chunks = []
        while True:
            data = ws.receive_json()
            if data.get("type") == "done":
                break
            if data.get("type") == "chunk":
                chunks.append(data["content"])
        assert len(chunks) >= 1
```

- [ ] **Step 3: Write integration test — backup restore**

Create `tests/integration/test_backup_restore.py`:

```python
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
```

- [ ] **Step 4: Write security tests**

Add to `tests/unit/core/test_security.py`:

```python
def test_sanitize_input_blocks_sql_injection_in_backup_label():
    from cabinet.core.security import sanitize_input
    result = sanitize_input("'; DROP TABLE users; --")
    assert "DROP" not in result or ";" not in result


def test_sanitize_input_removes_object_tags():
    from cabinet.core.security import sanitize_input
    result = sanitize_input('<object data="evil.swf">Hello')
    assert "<object" not in result


def test_sanitize_input_removes_vbscript_protocol():
    from cabinet.core.security import sanitize_input
    result = sanitize_input('<a href="vbscript:msgbox">click</a>')
    assert "vbscript:" not in result
```

Add to `tests/unit/core/workflow/test_safe_eval.py`:

```python
def test_safe_eval_blocks_class_subclasses_chain():
    result = safe_eval("context.__class__.__subclasses__()", {"context": {"x": 1}})
    assert result is None


def test_safe_eval_blocks_private_attr_on_object():
    class Obj:
        _secret = "hidden"
        name = "visible"
    result = safe_eval("obj._secret", {"obj": Obj()})
    assert result is None


def test_safe_eval_allows_normal_attr():
    class Obj:
        name = "visible"
    result = safe_eval("obj.name", {"obj": Obj()})
    assert result == "visible"
```

- [ ] **Step 5: Run all new tests**

Run: `python -m pytest tests/integration/test_event_flow.py tests/integration/test_websocket_chat.py tests/integration/test_backup_restore.py tests/unit/core/test_security.py tests/unit/core/workflow/test_safe_eval.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add tests/integration/test_event_flow.py tests/integration/test_websocket_chat.py tests/integration/test_backup_restore.py tests/unit/core/test_security.py tests/unit/core/workflow/test_safe_eval.py
git commit -m "test: add integration tests and security test supplements"
```

---

### Task 24: M-22 .env.example

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create .env.example**

Create `.env.example`:

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

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add .env.example with all supported environment variables"
```

---

### Task 25: M-1 CLI main.py Refactor (Largest Task — Do Last)

**Files:**
- Create: `src/cabinet/cli/commands/__init__.py`
- Create: `src/cabinet/cli/commands/init_cmd.py`
- Create: `src/cabinet/cli/commands/serve_cmd.py`
- Create: `src/cabinet/cli/commands/chat_cmd.py`
- Create: `src/cabinet/cli/commands/config_cmd.py`
- Create: `src/cabinet/cli/commands/employee_cmd.py`
- Create: `src/cabinet/cli/commands/skill_cmd.py`
- Create: `src/cabinet/cli/commands/knowledge_cmd.py`
- Create: `src/cabinet/cli/commands/db_cmd.py`
- Create: `src/cabinet/cli/commands/backup_cmd.py`
- Create: `src/cabinet/cli/commands/workflow_cmd.py`
- Create: `src/cabinet/cli/commands/agent_cmd.py`
- Modify: `src/cabinet/cli/main.py`

> **Note:** This is the largest refactoring task. It should be done last because all other changes to `main.py` (M-2, M-3, M-16, M-17, C-6) must be complete first to avoid merge conflicts.

- [ ] **Step 1: Create the commands package**

Create `src/cabinet/cli/commands/__init__.py`:

```python
from cabinet.cli.commands.init_cmd import register as register_init
from cabinet.cli.commands.serve_cmd import register as register_serve
from cabinet.cli.commands.chat_cmd import register as register_chat
from cabinet.cli.commands.config_cmd import register as register_config
from cabinet.cli.commands.employee_cmd import register as register_employee
from cabinet.cli.commands.skill_cmd import register as register_skill
from cabinet.cli.commands.knowledge_cmd import register as register_knowledge
from cabinet.cli.commands.db_cmd import register as register_db
from cabinet.cli.commands.backup_cmd import register as register_backup
from cabinet.cli.commands.workflow_cmd import register as register_workflow
from cabinet.cli.commands.agent_cmd import register as register_agent


def register_all(app):
    register_init(app)
    register_serve(app)
    register_chat(app)
    register_config(app)
    register_employee(app)
    register_skill(app)
    register_knowledge(app)
    register_db(app)
    register_backup(app)
    register_workflow(app)
    register_agent(app)
```

- [ ] **Step 2: Extract each command module**

For each command module, extract the corresponding command function(s) from `main.py` into a dedicated file. Each module exports a `register(app)` function that adds its commands to the Typer app.

Example pattern for `src/cabinet/cli/commands/init_cmd.py`:

```python
from __future__ import annotations

import os
from uuid import uuid4

import typer
from rich.console import Console

from cabinet import __version__
from cabinet.models.primitives import Organization

console = Console()


def register(app):
    @app.command()
    def init(
        name: str = typer.Option("My Organization", "--name", "-n", help="Organization name"),
        data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
    ):
        from cabinet.cli.config import CabinetConfig, save_config

        os.makedirs(data_dir, exist_ok=True)
        db_dir = os.path.join(data_dir, "db")
        os.makedirs(db_dir, exist_ok=True)

        config = CabinetConfig(
            organization=Organization(name=name, captain_id="captain"),
            default_project=uuid4(),
        )
        config_path = os.path.join(data_dir, "cabinet.json")
        save_config(config, config_path)
        console.print(f"[green]Cabinet initialized:[/green] {name}")
        console.print(f"  Data directory: {data_dir}")
        console.print(f"  Config: {config_path}")
```

Follow the same pattern for all other command modules, extracting the corresponding code from `main.py`.

- [ ] **Step 3: Slim down main.py**

Replace `src/cabinet/cli/main.py` with:

```python
from __future__ import annotations

import typer
from rich.console import Console

from cabinet import __version__

app = typer.Typer(name="cabinet", help="Cabinet - AI Collaboration Framework")
console = Console()


@app.callback()
def main():
    from cabinet.core.observability import set_cli_request_id
    set_cli_request_id()


@app.command()
def version():
    console.print(f"Cabinet v{__version__}")


from cabinet.cli.commands import register_all
register_all(app)


if __name__ == "__main__":
    app()
```

- [ ] **Step 4: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 5: Run ruff lint**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/cli/commands/ src/cabinet/cli/main.py
git commit -m "refactor(cli): split main.py into command submodules"
```

---

### Task 26: Phase 3 Verification

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 2: Run ruff lint**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Verify all CLI commands still work**

Run: `python -m cabinet version`
Expected: Prints version string

Run: `python -m cabinet --help`
Expected: Lists all commands

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 3 P2 code quality/performance/testing complete — all tests pass"
```
