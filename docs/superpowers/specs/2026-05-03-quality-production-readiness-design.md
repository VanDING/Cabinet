# Quality Fix & Production Readiness Design

## Overview

Fix known bugs, add security hardening (authentication, CORS, rate limiting), and complete test coverage for the HTTP API layer.

## 1. Bug Fixes

### 1.1 WebSocket Dependency Injection

**File**: `src/cabinet/api/routes/chat.py`

**Problem**: `chat_ws` uses `Depends(get_runtime)` but FastAPI WebSocket endpoints do not support standard dependency injection. Runtime will be `None` or raise an error at runtime.

**Fix**: Access runtime directly from `websocket.app.state.runtime`:

```python
@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    runtime = websocket.app.state.runtime
    captain_id = websocket.query_params.get("captain_id", "captain")
    ...
```

### 1.2 local_kb.py Syntax Error

**File**: `src/cabinet/core/knowledge/local_kb.py`

**Problem**: `if hasattr(self._client", "_system"):` has a stray quote.

**Fix**: `if hasattr(self._client, "_system"):`

### 1.3 ReviewRequest Default Value Mismatch

**File**: `src/cabinet/api/models.py`

**Problem**: `ReviewRequest.review_type` defaults to `"project"` but the rooms route mapping only has `"project_review"`.

**Fix**: Change default to `"project_review"`.

### 1.4 Remove _serve_async Dead Code

**File**: `src/cabinet/cli/main.py`

**Problem**: `_serve_async` function is never called since `serve` now uses uvicorn directly.

**Fix**: Delete the function.

### 1.5 Replace @app.on_event with Lifespan

**File**: `src/cabinet/api/app.py`

**Problem**: FastAPI deprecated `on_event("startup"/"shutdown")` in favor of lifespan context managers.

**Fix**:

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime: CabinetRuntime = app.state.runtime
    await runtime.start()
    yield
    await runtime.stop()

def create_app(runtime: CabinetRuntime, config: CabinetConfig) -> FastAPI:
    app = FastAPI(
        title="Cabinet API",
        version="0.1.0",
        description="AI Collaboration Framework API",
        lifespan=lifespan,
    )
    ...
```

## 2. Security Hardening

### 2.1 API Authentication — Bearer Token

**New dependency**: `src/cabinet/api/deps.py` extended with `get_current_user`

**CabinetConfig extension**:

```python
class CabinetConfig(BaseModel):
    ...
    api_token: str = ""  # empty = auth disabled
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]
```

**Auth dependency**:

```python
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer(auto_error=False)

async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
    request: Request = None,
):
    config = request.app.state.config
    if not config.api_token:
        return None
    if credentials is None or credentials.credentials != config.api_token:
        raise HTTPException(status_code=401, detail="Invalid or missing API token")
    return credentials.credentials
```

**Route protection**: Add `Depends(get_current_user)` to all REST endpoints. WebSocket validates via `?token=xxx` query parameter.

**CLI commands**: `cabinet config set-token <token>` / `cabinet config get-token`

### 2.2 CORS Tightening

**File**: `src/cabinet/api/app.py`

Replace `allow_origins=["*"]` with `config.cors_origins`.

### 2.3 Rate Limiting

**New dependency**: `slowapi` added to pyproject.toml

```python
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)

# In create_app:
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# On routes:
@router.post("")
@limiter.limit("10/minute")
async def chat(request: Request, ...): ...
```

**Default limits**:
- Chat endpoints: 10/minute
- Other endpoints: 30/minute
- WebSocket: unlimited

## 3. Test Coverage

### 3.1 Missing Unit Tests

| Test File | Missing Tests |
|-----------|--------------|
| `test_employees.py` | `GET /{employee_id}` (404/200), `POST /{employee_id}/skills/{skill_id}`, 503 when store=None |
| `test_skills.py` | `POST /load`, `POST /{name}/run` (200/404) |
| `test_knowledge.py` | `POST /index` (file/dir/empty), 503 when knowledge_base=None |
| `test_rooms.py` | `POST /task`, `POST /strategy`, `POST /review` |
| `test_chat.py` | WebSocket `/ws` basic connection + message exchange |
| `test_app.py` | Lifespan startup/shutdown, auth middleware, rate limiting |
| `test_config.py` | Auth failure (401), api_token not leaked |

### 3.2 API Integration Tests

**New file**: `tests/integration/test_api_integration.py`

Using `httpx.AsyncClient` + FastAPI TestClient pattern:

```python
@pytest.fixture
async def api_client():
    runtime, config = await create_test_runtime()
    config.api_token = "test-token"
    app = create_app(runtime, config)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, {"Authorization": "Bearer test-token"}
```

**Covered flows**:
- Chat → Secretary full chain
- Employee CRUD lifecycle
- Knowledge index → query flow
- Auth rejection (no token / wrong token)
- Rate limit triggering
