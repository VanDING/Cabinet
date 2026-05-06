# Quality Fix & Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix known bugs, add security hardening (authentication, CORS, rate limiting), and complete test coverage for the HTTP API layer.

**Architecture:** Bug fixes target specific files with surgical changes. Security hardening adds Bearer Token auth via FastAPI dependency injection, configurable CORS origins, and slowapi rate limiting. Test coverage fills gaps in existing unit tests and adds a new integration test file.

**Tech Stack:** FastAPI, slowapi, httpx (AsyncClient + ASGITransport), pytest-asyncio, Pydantic

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/cabinet/api/app.py` | Lifespan, CORS config, rate limiter, auth exception handler |
| Modify | `src/cabinet/api/deps.py` | Add `get_current_user` auth dependency |
| Modify | `src/cabinet/api/routes/chat.py` | Fix WebSocket DI, add auth + rate limit |
| Modify | `src/cabinet/api/routes/employees.py` | Add auth + rate limit |
| Modify | `src/cabinet/api/routes/skills.py` | Add auth + rate limit |
| Modify | `src/cabinet/api/routes/knowledge.py` | Add auth + rate limit |
| Modify | `src/cabinet/api/routes/rooms.py` | Add auth + rate limit |
| Modify | `src/cabinet/api/routes/config.py` | Add auth + rate limit, mask api_token |
| Modify | `src/cabinet/api/models.py` | Fix ReviewRequest default |
| Modify | `src/cabinet/cli/config.py` | Add `api_token` and `cors_origins` fields |
| Modify | `src/cabinet/cli/main.py` | Remove `_serve_async`, add `set-token`/`get-token` commands |
| Modify | `src/cabinet/core/knowledge/local_kb.py` | Fix syntax error (already correct on disk) |
| Modify | `pyproject.toml` | Add `slowapi` dependency |
| Modify | `tests/unit/api/test_models.py` | Update ReviewRequest default test |
| Modify | `tests/unit/api/test_app.py` | Add lifespan, auth, CORS, rate limit tests |
| Modify | `tests/unit/api/test_chat.py` | Add WebSocket test, auth test |
| Modify | `tests/unit/api/test_employees.py` | Add get/mount/503 tests |
| Modify | `tests/unit/api/test_skills.py` | Add load/run tests |
| Modify | `tests/unit/api/test_knowledge.py` | Add index test, 503 test |
| Modify | `tests/unit/api/test_rooms.py` | Add task/strategy/review tests |
| Modify | `tests/unit/api/test_config.py` | Add auth failure, token masking tests |
| Create | `tests/integration/test_api_integration.py` | Full-chain integration tests |

---

### Task 1: Bug Fixes — Simple Surgical Changes

**Files:**
- Modify: `src/cabinet/api/models.py:75`
- Modify: `src/cabinet/cli/main.py:275-296`
- Modify: `src/cabinet/core/knowledge/local_kb.py:67`

- [ ] **Step 1: Fix ReviewRequest default in models.py**

Change `review_type` default from `"project"` to `"project_review"`:

```python
class ReviewRequest(BaseModel):
    project_id: str | None = None
    review_type: str = "project_review"
```

- [ ] **Step 2: Update the corresponding test in test_models.py**

Change the expected default in `test_review_request_defaults`:

```python
def test_review_request_defaults():
    req = ReviewRequest()
    assert req.project_id is None
    assert req.review_type == "project_review"
```

- [ ] **Step 3: Remove _serve_async dead code from main.py**

Delete lines 275-296 (the entire `_serve_async` function):

```python
# DELETE THIS ENTIRE FUNCTION:
async def _serve_async(data_dir: str) -> None:
    runtime, config = await _init_runtime(data_dir)
    ...
    await runtime.stop()
```

- [ ] **Step 4: Verify local_kb.py syntax is correct**

The file on disk already has the correct `if hasattr(self._client, "_system"):` (no stray quote). Verify by reading the file. If the stray quote exists, fix it.

- [ ] **Step 5: Run tests to verify bug fixes**

Run: `python -m pytest tests/unit/api/test_models.py tests/unit/api/test_app.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/api/models.py src/cabinet/cli/main.py src/cabinet/core/knowledge/local_kb.py tests/unit/api/test_models.py
git commit -m "fix: ReviewRequest default, remove dead _serve_async, verify local_kb syntax"
```

---

### Task 2: Lifespan + WebSocket DI Fix + CabinetConfig Extension

**Files:**
- Modify: `src/cabinet/api/app.py`
- Modify: `src/cabinet/api/routes/chat.py`
- Modify: `src/cabinet/cli/config.py`

- [ ] **Step 1: Write failing test for lifespan in test_app.py**

Add a test that verifies the app uses lifespan (not on_event):

```python
@pytest.mark.asyncio
async def test_app_uses_lifespan(mock_runtime, mock_config):
    app = create_app(mock_runtime, mock_config)
    assert app.router.lifespan_context is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_app.py::test_app_uses_lifespan -v`
Expected: FAIL (current app uses on_event, not lifespan)

- [ ] **Step 3: Replace on_event with lifespan in app.py**

Rewrite `src/cabinet/api/app.py`:

```python
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime


def create_app(runtime: CabinetRuntime, config: CabinetConfig) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await runtime.start()
        yield
        await runtime.stop()

    app = FastAPI(
        title="Cabinet API",
        version="0.1.0",
        description="AI Collaboration Framework API",
        lifespan=lifespan,
    )
    app.state.runtime = runtime
    app.state.config = config

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from cabinet.api.routes import chat, config as config_routes, employees, knowledge, rooms, skills

    app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
    app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
    app.include_router(skills.router, prefix="/api/skills", tags=["Skills"])
    app.include_router(knowledge.router, prefix="/api/knowledge", tags=["Knowledge"])
    app.include_router(rooms.router, prefix="/api/rooms", tags=["Rooms"])
    app.include_router(config_routes.router, prefix="/api/config", tags=["Config"])

    @app.exception_handler(KeyError)
    async def key_error_handler(request, exc):
        return JSONResponse(status_code=404, content={"error": "Not found", "detail": str(exc)})

    @app.exception_handler(ValueError)
    async def value_error_handler(request, exc):
        return JSONResponse(status_code=400, content={"error": "Bad request", "detail": str(exc)})

    @app.exception_handler(Exception)
    async def generic_error_handler(request, exc):
        return JSONResponse(status_code=500, content={"error": "Internal error", "detail": str(exc)})

    return app
```

- [ ] **Step 4: Fix WebSocket DI in chat.py**

Rewrite `src/cabinet/api/routes/chat.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from cabinet.api.deps import get_runtime
from cabinet.api.models import ChatRequest, ChatResponse

if TYPE_CHECKING:
    from cabinet.runtime import CabinetRuntime

router = APIRouter()


@router.post("", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
):
    from cabinet.rooms.secretary.models import InteractionContext

    context = InteractionContext(captain_id=req.captain_id, channel="api")
    result = await runtime.secretary.process_input(req.message, context)
    return ChatResponse(response=result.message, captain_id=req.captain_id)


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    runtime = websocket.app.state.runtime
    captain_id = websocket.query_params.get("captain_id", "captain")

    try:
        while True:
            data = await websocket.receive_text()
            if data == "/quit":
                await websocket.close()
                break

            from cabinet.rooms.secretary.models import InteractionContext

            context = InteractionContext(captain_id=captain_id, channel="api")
            response = await runtime.secretary.process_input_stream(data, context)
            async for chunk in response.stream:
                await websocket.send_json({"type": "chunk", "content": chunk})
            await response.finalize()
            await websocket.send_json({"type": "done"})
    except WebSocketDisconnect:
        pass
```

- [ ] **Step 5: Add api_token and cors_origins to CabinetConfig**

Modify `src/cabinet/cli/config.py`:

```python
class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    api_keys: dict[str, str] = {}
    api_token: str = ""
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]
    employees_path: str = "data/employees.json"
    skills_dir: str = "data/skills"
    knowledge_dir: str = "data/knowledge"
    created_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 6: Run all existing API tests to verify nothing is broken**

Run: `python -m pytest tests/unit/api/ -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/api/app.py src/cabinet/api/routes/chat.py src/cabinet/cli/config.py tests/unit/api/test_app.py
git commit -m "fix: lifespan context manager, WebSocket DI, CabinetConfig api_token/cors_origins"
```

---

### Task 3: API Authentication — Bearer Token

**Files:**
- Modify: `src/cabinet/api/deps.py`
- Modify: `src/cabinet/api/routes/chat.py`
- Modify: `src/cabinet/api/routes/employees.py`
- Modify: `src/cabinet/api/routes/skills.py`
- Modify: `src/cabinet/api/routes/knowledge.py`
- Modify: `src/cabinet/api/routes/rooms.py`
- Modify: `src/cabinet/api/routes/config.py`
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: Write failing test for auth rejection**

Add to `tests/unit/api/test_config.py`:

```python
@pytest.mark.asyncio
async def test_config_requires_auth_when_token_set():
    from unittest.mock import AsyncMock

    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.gateway.list_models = MagicMock(return_value=[])

    config = CabinetConfig(
        organization=Organization(name="test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="secret-token",
    )
    app = create_app(runtime, config)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/config")
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_config_succeeds_with_valid_token():
    from unittest.mock import AsyncMock

    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.gateway.list_models = MagicMock(return_value=[])

    config = CabinetConfig(
        organization=Organization(name="test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="secret-token",
    )
    app = create_app(runtime, config)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/config",
            headers={"Authorization": "Bearer secret-token"},
        )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_config_rejects_wrong_token():
    from unittest.mock import AsyncMock

    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.gateway.list_models = MagicMock(return_value=[])

    config = CabinetConfig(
        organization=Organization(name="test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="secret-token",
    )
    app = create_app(runtime, config)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/config",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_config.py::test_config_requires_auth_when_token_set -v`
Expected: FAIL (no auth dependency yet)

- [ ] **Step 3: Implement auth dependency in deps.py**

Rewrite `src/cabinet/api/deps.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime

_security = HTTPBearer(auto_error=False)


def get_runtime(request: Request) -> CabinetRuntime:
    return request.app.state.runtime


def get_config(request: Request) -> CabinetConfig:
    return request.app.state.config


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(_security),
    request: Request = None,
) -> str | None:
    config: CabinetConfig = request.app.state.config
    if not config.api_token:
        return None
    if credentials is None or credentials.credentials != config.api_token:
        raise HTTPException(status_code=401, detail="Invalid or missing API token")
    return credentials.credentials
```

- [ ] **Step 4: Add auth dependency to all route files**

For each route file, add `Depends(get_current_user)` to every endpoint function. Import `get_current_user` from `cabinet.api.deps`.

**chat.py** — add to `chat()` endpoint:
```python
from cabinet.api.deps import get_current_user, get_runtime

@router.post("", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

**employees.py** — add to all 4 endpoints:
```python
from cabinet.api.deps import get_current_user, get_runtime

@router.get("", response_model=list[EmployeeResponse])
async def list_employees(
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("", response_model=EmployeeResponse)
async def create_employee(
    req: EmployeeCreate,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.get("/{employee_id}", response_model=EmployeeResponse)
async def get_employee(
    employee_id: str,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/{employee_id}/skills/{skill_id}")
async def mount_skill(
    employee_id: str,
    skill_id: str,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

**skills.py** — add to all 3 endpoints:
```python
from cabinet.api.deps import get_config, get_current_user, get_runtime

@router.get("")
async def list_skills(
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/load")
async def load_skill(
    path: str,
    runtime: CabinetRuntime = Depends(get_runtime),
    config: CabinetConfig = Depends(get_config),
    _user: str | None = Depends(get_current_user),
):

@router.post("/{name}/run", response_model=SkillRunResponse)
async def run_skill(
    name: str,
    req: SkillRunRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

**knowledge.py** — add to both endpoints:
```python
from cabinet.api.deps import get_current_user, get_runtime

@router.post("/index")
async def index_documents(
    req: KnowledgeIndexRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/query", response_model=KnowledgeQueryResponse)
async def query_knowledge(
    req: KnowledgeQueryRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

**rooms.py** — add to all 5 endpoints:
```python
from cabinet.api.deps import get_config, get_current_user, get_runtime

@router.post("/meeting")
async def create_meeting(
    req: MeetingRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/decision")
async def create_decision(
    req: DecisionRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/task")
async def create_task(
    req: TaskRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/strategy")
async def decode_strategy(
    req: StrategyRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/review")
async def start_review(
    req: ReviewRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    config: CabinetConfig = Depends(get_config),
    _user: str | None = Depends(get_current_user),
):
```

**config.py** — add to both endpoints:
```python
from cabinet.api.deps import get_config, get_current_user, get_runtime

@router.get("")
async def get_current_config(
    config: CabinetConfig = Depends(get_config),
    _user: str | None = Depends(get_current_user),
):

@router.get("/models")
async def get_models(
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

- [ ] **Step 5: Add WebSocket token validation in chat.py**

In the `chat_ws` function, add token validation via query parameter:

```python
@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    runtime = websocket.app.state.runtime
    config = websocket.app.state.config

    if config.api_token:
        token = websocket.query_params.get("token")
        if token != config.api_token:
            await websocket.close(code=4001, reason="Unauthorized")
            return

    captain_id = websocket.query_params.get("captain_id", "captain")

    try:
        while True:
            data = await websocket.receive_text()
            if data == "/quit":
                await websocket.close()
                break

            from cabinet.rooms.secretary.models import InteractionContext

            context = InteractionContext(captain_id=captain_id, channel="api")
            response = await runtime.secretary.process_input_stream(data, context)
            async for chunk in response.stream:
                await websocket.send_json({"type": "chunk", "content": chunk})
            await response.finalize()
            await websocket.send_json({"type": "done"})
    except WebSocketDisconnect:
        pass
```

- [ ] **Step 6: Add CLI commands for token management**

Add `set-token` and `get-token` actions to the `config` command in `src/cabinet/cli/main.py`. In the `config` function, add two new action branches:

```python
    elif action == "set-token":
        if key is None:
            console.print("[red]Error:[/red] Usage: cabinet config set-token <token>")
            raise typer.Exit(code=1)
        cfg.api_token = key
        save_config(cfg, config_path)
        console.print("[green]API token saved.[/green]")

    elif action == "get-token":
        if not cfg.api_token:
            console.print("[yellow]No API token configured.[/yellow]")
        else:
            masked = cfg.api_token[:8] + "***" if len(cfg.api_token) > 8 else "***"
            console.print(f"API token: {masked}")
```

- [ ] **Step 7: Update existing test fixtures to pass auth**

All existing test fixtures use `CabinetConfig` with default `api_token=""`, which means auth is disabled and existing tests continue to pass without modification. Verify:

Run: `python -m pytest tests/unit/api/ -v`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/cabinet/api/deps.py src/cabinet/api/routes/ src/cabinet/cli/main.py tests/unit/api/test_config.py
git commit -m "feat: Bearer Token API authentication with CLI token management"
```

---

### Task 4: CORS Tightening + Rate Limiting

**Files:**
- Modify: `pyproject.toml`
- Modify: `src/cabinet/api/app.py`

- [ ] **Step 1: Add slowapi dependency**

Add `slowapi>=0.1.9` to `pyproject.toml` dependencies:

```toml
dependencies = [
    "pydantic>=2.7",
    "litellm>=1.40",
    "aiosqlite>=0.20",
    "chromadb>=0.5",
    "mcp>=1.0",
    "typer>=0.12",
    "rich>=13.7",
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "websockets>=12.0",
    "slowapi>=0.1.9",
]
```

Run: `pip install slowapi`

- [ ] **Step 2: Write failing test for CORS origin restriction**

Add to `tests/unit/api/test_app.py`:

```python
@pytest.mark.asyncio
async def test_cors_restricts_unknown_origin(mock_runtime, mock_config):
    mock_config.cors_origins = ["http://localhost:3000"]
    app = create_app(mock_runtime, mock_config)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/openapi.json",
            headers={
                "Origin": "http://evil-site.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") is None


@pytest.mark.asyncio
async def test_cors_allows_configured_origin(mock_runtime, mock_config):
    mock_config.cors_origins = ["http://localhost:3000"]
    app = create_app(mock_runtime, mock_config)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/openapi.json",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_app.py::test_cors_restricts_unknown_origin -v`
Expected: FAIL (current CORS allows all origins)

- [ ] **Step 4: Update create_app to use config.cors_origins and add rate limiter**

Rewrite `src/cabinet/api/app.py`:

```python
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

if TYPE_CHECKING:
    from cabinet.cli.config import CabinetConfig
    from cabinet.runtime import CabinetRuntime

limiter = Limiter(key_func=get_remote_address)


def create_app(runtime: CabinetRuntime, config: CabinetConfig) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await runtime.start()
        yield
        await runtime.stop()

    app = FastAPI(
        title="Cabinet API",
        version="0.1.0",
        description="AI Collaboration Framework API",
        lifespan=lifespan,
    )
    app.state.runtime = runtime
    app.state.config = config
    app.state.limiter = limiter

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    from cabinet.api.routes import chat, config as config_routes, employees, knowledge, rooms, skills

    app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
    app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
    app.include_router(skills.router, prefix="/api/skills", tags=["Skills"])
    app.include_router(knowledge.router, prefix="/api/knowledge", tags=["Knowledge"])
    app.include_router(rooms.router, prefix="/api/rooms", tags=["Rooms"])
    app.include_router(config_routes.router, prefix="/api/config", tags=["Config"])

    @app.exception_handler(KeyError)
    async def key_error_handler(request, exc):
        return JSONResponse(status_code=404, content={"error": "Not found", "detail": str(exc)})

    @app.exception_handler(ValueError)
    async def value_error_handler(request, exc):
        return JSONResponse(status_code=400, content={"error": "Bad request", "detail": str(exc)})

    @app.exception_handler(Exception)
    async def generic_error_handler(request, exc):
        return JSONResponse(status_code=500, content={"error": "Internal error", "detail": str(exc)})

    return app
```

- [ ] **Step 5: Add rate limit decorators to route files**

Add `Request` parameter and `@limiter.limit()` decorator to each endpoint. The limiter is accessed from `request.app.state.limiter`.

**chat.py**:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("", response_model=ChatResponse)
@limiter.limit("10/minute")
async def chat(
    request: Request,
    req: ChatRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

**employees.py**:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.get("", response_model=list[EmployeeResponse])
@limiter.limit("30/minute")
async def list_employees(
    request: Request,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("", response_model=EmployeeResponse)
@limiter.limit("30/minute")
async def create_employee(
    request: Request,
    req: EmployeeCreate,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.get("/{employee_id}", response_model=EmployeeResponse)
@limiter.limit("30/minute")
async def get_employee(
    request: Request,
    employee_id: str,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/{employee_id}/skills/{skill_id}")
@limiter.limit("30/minute")
async def mount_skill(
    request: Request,
    employee_id: str,
    skill_id: str,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

**skills.py**:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.get("")
@limiter.limit("30/minute")
async def list_skills(
    request: Request,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/load")
@limiter.limit("30/minute")
async def load_skill(
    request: Request,
    path: str,
    runtime: CabinetRuntime = Depends(get_runtime),
    config: CabinetConfig = Depends(get_config),
    _user: str | None = Depends(get_current_user),
):

@router.post("/{name}/run", response_model=SkillRunResponse)
@limiter.limit("30/minute")
async def run_skill(
    request: Request,
    name: str,
    req: SkillRunRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

**knowledge.py**:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/index")
@limiter.limit("30/minute")
async def index_documents(
    request: Request,
    req: KnowledgeIndexRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/query", response_model=KnowledgeQueryResponse)
@limiter.limit("30/minute")
async def query_knowledge(
    request: Request,
    req: KnowledgeQueryRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

**rooms.py**:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/meeting")
@limiter.limit("30/minute")
async def create_meeting(
    request: Request,
    req: MeetingRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/decision")
@limiter.limit("30/minute")
async def create_decision(
    request: Request,
    req: DecisionRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/task")
@limiter.limit("30/minute")
async def create_task(
    request: Request,
    req: TaskRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/strategy")
@limiter.limit("30/minute")
async def decode_strategy(
    request: Request,
    req: StrategyRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):

@router.post("/review")
@limiter.limit("30/minute")
async def start_review(
    request: Request,
    req: ReviewRequest,
    runtime: CabinetRuntime = Depends(get_runtime),
    config: CabinetConfig = Depends(get_config),
    _user: str | None = Depends(get_current_user),
):
```

**config.py**:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.get("")
@limiter.limit("30/minute")
async def get_current_config(
    request: Request,
    config: CabinetConfig = Depends(get_config),
    _user: str | None = Depends(get_current_user),
):

@router.get("/models")
@limiter.limit("30/minute")
async def get_models(
    request: Request,
    runtime: CabinetRuntime = Depends(get_runtime),
    _user: str | None = Depends(get_current_user),
):
```

- [ ] **Step 6: Update existing CORS test to use configured origin**

Update `test_cors_headers` in `test_app.py`:

```python
@pytest.mark.asyncio
async def test_cors_headers(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/openapi.json",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
```

- [ ] **Step 7: Run all API tests**

Run: `python -m pytest tests/unit/api/ -v`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml src/cabinet/api/app.py src/cabinet/api/routes/ tests/unit/api/test_app.py
git commit -m "feat: CORS tightening with configurable origins, slowapi rate limiting"
```

---

### Task 5: Unit Test Coverage — Missing Endpoint Tests

**Files:**
- Modify: `tests/unit/api/test_employees.py`
- Modify: `tests/unit/api/test_skills.py`
- Modify: `tests/unit/api/test_knowledge.py`
- Modify: `tests/unit/api/test_rooms.py`
- Modify: `tests/unit/api/test_chat.py`

- [ ] **Step 1: Add missing employee tests**

Add to `tests/unit/api/test_employees.py`:

```python
@pytest.mark.asyncio
async def test_get_employee_found(app, mock_runtime):
    from uuid import uuid4

    emp = Employee(id=uuid4(), team_id=uuid4(), name="Advisor", role="advisor", kind="ai")
    mock_runtime.employee_store.get = AsyncMock(return_value=emp)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"/api/employees/{emp.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Advisor"


@pytest.mark.asyncio
async def test_get_employee_not_found(app, mock_runtime):
    mock_runtime.employee_store.get = AsyncMock(return_value=None)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/employees/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_mount_skill(app, mock_runtime):
    mock_runtime.employee_store.mount_skill = AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/employees/00000000-0000-0000-0000-000000000000/skills/00000000-0000-0000-0000-000000000001"
        )
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_employees_503_when_no_store(mock_config):
    from unittest.mock import AsyncMock

    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.employee_store = None

    app = create_app(runtime, mock_config)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/employees")
        assert response.status_code == 503
```

- [ ] **Step 2: Add missing skills tests**

Add to `tests/unit/api/test_skills.py`:

```python
from cabinet.models.primitives import SkillDefinition


@pytest.mark.asyncio
async def test_load_skill(app, mock_runtime, mock_config, tmp_path):
    skill_file = tmp_path / "test_skill.md"
    skill_file.write_text(
        "---\nname: test-skill\nkind: atomic\ndescription: A test skill\n---\n\n# Test Skill\n"
    )

    from cabinet.core.tools.skill_loader import SkillLoader

    loader = SkillLoader()
    skill = loader.parse_file(str(skill_file))
    mock_runtime.tool_registry.register = AsyncMock(return_value=skill)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/skills/load",
            params={"path": str(skill_file)},
        )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_run_skill_success(app, mock_runtime):
    from cabinet.core.tools.protocol import SkillOutput
    from uuid import uuid4

    mock_runtime.tool_registry.execute = AsyncMock(
        return_value=SkillOutput(content="skill result", skill_id=uuid4())
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/skills/test-skill/run",
            json={"inputs": {"key": "value"}},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["skill_name"] == "test-skill"
        assert data["output"] == "skill result"


@pytest.mark.asyncio
async def test_run_skill_not_found(app, mock_runtime):
    mock_runtime.tool_registry.execute = AsyncMock(side_effect=ValueError("Skill not found"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/skills/nonexistent/run",
            json={"inputs": {}},
        )
        assert response.status_code == 404
```

- [ ] **Step 3: Add missing knowledge tests**

Add to `tests/unit/api/test_knowledge.py`:

```python
from cabinet.core.knowledge.protocol import DocumentChunk


@pytest.mark.asyncio
async def test_index_documents_file(app, mock_runtime, tmp_path):
    test_file = tmp_path / "test.txt"
    test_file.write_text("Hello world")

    mock_runtime.knowledge_base.index = AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/knowledge/index",
            json={"path": str(test_file)},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["indexed"] == 1


@pytest.mark.asyncio
async def test_index_documents_empty_dir(app, mock_runtime, tmp_path):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/knowledge/index",
            json={"path": str(empty_dir)},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["indexed"] == 0


@pytest.mark.asyncio
async def test_knowledge_503_when_no_kb(mock_config):
    from unittest.mock import AsyncMock

    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.knowledge_base = None

    app = create_app(runtime, mock_config)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/knowledge/query",
            json={"question": "test"},
        )
        assert response.status_code == 503
```

- [ ] **Step 4: Add missing rooms tests**

Add to `tests/unit/api/test_rooms.py`:

```python
@pytest.mark.asyncio
async def test_task_endpoint(app, mock_runtime):
    from cabinet.rooms.office.models import Task

    task = Task(
        id=uuid4(),
        project_id=uuid4(),
        employee_id=uuid4(),
        skill_id=uuid4(),
        status="queued",
        inputs={"description": "build API"},
    )
    mock_runtime.office.submit_task = AsyncMock(return_value=task)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rooms/task",
            json={"description": "build API"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data


@pytest.mark.asyncio
async def test_strategy_endpoint(app, mock_runtime):
    from cabinet.rooms.strategy.models import ActionBlueprint, ActionDomain

    blueprint = ActionBlueprint(
        id=uuid4(),
        project_id=uuid4(),
        source_proposal_id=uuid4(),
        domains=[ActionDomain(name="growth", goal="Expand market share")],
        execution_order=[["growth"]],
    )
    mock_runtime.strategy.decode = AsyncMock(return_value=blueprint)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rooms/strategy",
            json={"proposal": "Expand market"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "blueprint_id" in data


@pytest.mark.asyncio
async def test_review_endpoint(app, mock_runtime, mock_config):
    from cabinet.rooms.summary.models import ReviewSession, ReviewType, Insight

    session = ReviewSession(id=uuid4(), project_id=uuid4(), review_type=ReviewType.PROJECT_REVIEW)
    mock_runtime.summary.start_review = AsyncMock(return_value=session)
    mock_runtime.summary.generate_insights = AsyncMock(
        return_value=[Insight(
            session_id=session.id,
            insight_type="observation",
            content="Insight 1",
            confidence=0.9,
            auto_applicable=False,
            requires_captain=False,
        )]
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rooms/review",
            json={"review_type": "project_review"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data
        assert len(data["insights"]) == 1
```

- [ ] **Step 5: Add WebSocket test to test_chat.py**

Add to `tests/unit/api/test_chat.py`:

```python
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_websocket_chat(app, mock_runtime):
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse

    async def fake_stream():
        yield "Hello"
        yield " Captain"

    async def fake_finalize():
        pass

    mock_runtime.secretary.process_input_stream = MagicMock(
        return_value=StreamingSecretaryResponse(stream=fake_stream(), finalize=fake_finalize)
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.websocket_connect("/api/chat/ws") as ws:
            await ws.send_text("hello")
            chunks = []
            while True:
                data = await ws.receive_json()
                if data.get("type") == "done":
                    break
                if data.get("type") == "chunk":
                    chunks.append(data["content"])
            assert len(chunks) == 2
```

- [ ] **Step 6: Run all API tests**

Run: `python -m pytest tests/unit/api/ -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add tests/unit/api/
git commit -m "test: complete API unit test coverage for all endpoints"
```

---

### Task 6: Integration Tests + Final Verification

**Files:**
- Create: `tests/integration/test_api_integration.py`

- [ ] **Step 1: Create integration test file**

Create `tests/integration/test_api_integration.py`:

```python
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from cabinet.api.app import create_app
from cabinet.cli.config import CabinetConfig
from cabinet.models.primitives import Employee, Organization
from cabinet.rooms.secretary.models import SecretaryLevel, SecretaryResponse


@pytest.fixture
async def api_client():
    from cabinet.agents.stub_factory import StubAgentFactory
    from cabinet.runtime import CabinetRuntime

    config = CabinetConfig(
        organization=Organization(name="test-org", captain_id="captain"),
        default_project=uuid4(),
        api_token="test-secret-token",
    )

    runtime = CabinetRuntime(agent_factory=StubAgentFactory())

    app = create_app(runtime, config)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, config


@pytest.mark.asyncio
async def test_auth_rejects_no_token(api_client):
    client, _ = api_client
    response = await client.get("/api/config")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_rejects_wrong_token(api_client):
    client, _ = api_client
    response = await client.get(
        "/api/config",
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_accepts_valid_token(api_client):
    client, config = api_client
    response = await client.get(
        "/api/config",
        headers={"Authorization": f"Bearer {config.api_token}"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_config_does_not_leak_secrets(api_client):
    client, config = api_client
    response = await client.get(
        "/api/config",
        headers={"Authorization": f"Bearer {config.api_token}"},
    )
    data = response.json()
    assert "api_keys" not in data
    assert "api_token" not in data


@pytest.mark.asyncio
async def test_chat_to_secretary_flow(api_client):
    client, config = api_client
    response = await client.post(
        "/api/chat",
        json={"message": "hello"},
        headers={"Authorization": f"Bearer {config.api_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "response" in data
    assert "captain_id" in data


@pytest.mark.asyncio
async def test_employee_crud_lifecycle(api_client):
    client, config = api_client
    headers = {"Authorization": f"Bearer {config.api_token}"}

    response = await client.post(
        "/api/employees",
        json={"name": "TestAgent", "role": "advisor"},
        headers=headers,
    )
    assert response.status_code == 200
    emp_data = response.json()
    emp_id = emp_data["id"]

    response = await client.get(f"/api/employees/{emp_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "TestAgent"

    response = await client.get("/api/employees", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


@pytest.mark.asyncio
async def test_knowledge_index_and_query(api_client, tmp_path):
    client, config = api_client
    headers = {"Authorization": f"Bearer {config.api_token}"}

    test_file = tmp_path / "doc.txt"
    test_file.write_text("Cabinet is an AI collaboration framework.")

    response = await client.post(
        "/api/knowledge/index",
        json={"path": str(test_file)},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["indexed"] == 1

    response = await client.post(
        "/api/knowledge/query",
        json={"question": "What is Cabinet?"},
        headers=headers,
    )
    assert response.status_code == 200
```

- [ ] **Step 2: Run integration tests**

Run: `python -m pytest tests/integration/test_api_integration.py -v`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 4: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add tests/integration/test_api_integration.py
git commit -m "test: add API integration tests for auth, CRUD, and knowledge flows"
```
