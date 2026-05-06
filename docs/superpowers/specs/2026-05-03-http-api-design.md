# HTTP API 层设计

日期：2026-05-03

## 背景

Cabinet MVP 标准已全部达成（CLI 完整可用、6 室服务、事件驱动、LLM Agent、MCP/知识库/记忆集成）。但系统目前仅通过 CLI 访问，无 HTTP 接口，无法支持外部集成或 Web UI。

本设计新增 FastAPI 层，提供 REST API + WebSocket 流式对话 + 自动 OpenAPI 文档。

## 设计

### 1. 项目结构

```
src/cabinet/api/
├── __init__.py
├── app.py              # FastAPI 应用工厂
├── deps.py             # 依赖注入（获取 runtime/config 实例）
├── models.py           # Pydantic 请求/响应模型
├── routes/
│   ├── __init__.py
│   ├── chat.py         # /api/chat — 对话端点 + WebSocket
│   ├── employees.py    # /api/employees — 员工 CRUD
│   ├── skills.py       # /api/skills — 技能管理 + 执行
│   ├── knowledge.py    # /api/knowledge — 知识库索引 + 查询
│   ├── rooms.py        # /api/rooms/* — 跨室操作
│   └── config.py       # /api/config — 配置查询
```

### 2. 应用工厂

```python
# src/cabinet/api/app.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from cabinet.api.routes import chat, employees, skills, knowledge, rooms, config

def create_app(runtime: CabinetRuntime, config: CabinetConfig) -> FastAPI:
    app = FastAPI(
        title="Cabinet API",
        version="0.1.0",
        description="AI Collaboration Framework API",
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

    app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
    app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
    app.include_router(skills.router, prefix="/api/skills", tags=["Skills"])
    app.include_router(knowledge.router, prefix="/api/knowledge", tags=["Knowledge"])
    app.include_router(rooms.router, prefix="/api/rooms", tags=["Rooms"])
    app.include_router(config.router, prefix="/api/config", tags=["Config"])

    @app.on_event("startup")
    async def startup():
        await runtime.start()

    @app.on_event("shutdown")
    async def shutdown():
        await runtime.stop()

    return app
```

### 3. 依赖注入

```python
# src/cabinet/api/deps.py
from fastapi import Request
from cabinet.runtime import CabinetRuntime
from cabinet.cli.config import CabinetConfig

def get_runtime(request: Request) -> CabinetRuntime:
    return request.app.state.runtime

def get_config(request: Request) -> CabinetConfig:
    return request.app.state.config
```

### 4. API 端点

#### 4a. Chat 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/chat` | 发送消息，返回 Secretary 响应 |
| WebSocket | `/api/chat/ws` | 流式对话 |

POST /api/chat：
- 请求：`ChatRequest(message, captain_id)`
- 响应：`ChatResponse(response, captain_id)`
- 调用 `runtime.secretary.process_input()`

WebSocket /api/chat/ws：
- 接收文本消息，通过 `process_input_stream()` 流式返回
- 消息格式：`{"type": "chunk", "content": "..."}` 和 `{"type": "done"}`
- 支持 `/quit` 关闭连接

#### 4b. Employees 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/employees` | 列出所有员工 |
| POST | `/api/employees` | 添加员工 |
| GET | `/api/employees/{id}` | 获取员工详情 |
| POST | `/api/employees/{id}/skills/{skill_id}` | 挂载技能 |

- 创建时 `team_id` 自动生成为 `uuid5(NAMESPACE_DNS, f"team:{role}")`
- 响应模型：`EmployeeResponse(id, name, role, kind, skills)`

#### 4c. Skills 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/skills` | 列出已注册技能 |
| POST | `/api/skills/load` | 加载技能文件 |
| POST | `/api/skills/{name}/run` | 执行技能 |

- 加载：请求 `path` 字段指定技能文件路径
- 执行：请求 `SkillRunRequest(inputs)` ，响应 `SkillRunResponse(skill_name, output)`

#### 4d. Knowledge 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/knowledge/index` | 索引文档 |
| POST | `/api/knowledge/query` | 查询知识库 |

- 索引：请求 `KnowledgeIndexRequest(path)` ，支持文件和目录
- 查询：请求 `KnowledgeQueryRequest(question, top_k)` ，响应 `KnowledgeQueryResponse(results)`

#### 4e. Rooms 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/rooms/meeting` | 启动审议会话 |
| POST | `/api/rooms/decision` | 提交决策请求 |
| POST | `/api/rooms/task` | 提交执行任务 |
| POST | `/api/rooms/strategy` | 战略解码 |
| POST | `/api/rooms/review` | 启动复盘 |

请求模型：
- `MeetingRequest(topic, level)`
- `DecisionRequest(title, decision_type, options)`
- `TaskRequest(description, inputs)`
- `StrategyRequest(proposal)`
- `ReviewRequest(project_id, review_type)`

#### 4f. Config 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/config` | 获取当前配置（脱敏，隐藏 api_keys） |
| GET | `/api/config/models` | 获取模型列表 |

### 5. Pydantic 模型

```python
class ChatRequest(BaseModel):
    message: str
    captain_id: str = "captain"

class ChatResponse(BaseModel):
    response: str
    captain_id: str

class EmployeeCreate(BaseModel):
    name: str
    role: str
    personality: str = ""
    kind: str = "ai"

class EmployeeResponse(BaseModel):
    id: str
    name: str
    role: str
    kind: str
    skills: list[str]

class SkillRunRequest(BaseModel):
    inputs: dict[str, str] = {}

class SkillRunResponse(BaseModel):
    skill_name: str
    output: str

class KnowledgeIndexRequest(BaseModel):
    path: str

class KnowledgeQueryRequest(BaseModel):
    question: str
    top_k: int = 3

class KnowledgeQueryResponse(BaseModel):
    results: list[dict]

class MeetingRequest(BaseModel):
    topic: str
    level: str = "multi_party"

class DecisionRequest(BaseModel):
    title: str
    decision_type: str = "strategic"
    options: list[dict] = []

class TaskRequest(BaseModel):
    description: str
    inputs: dict[str, str] = {}

class StrategyRequest(BaseModel):
    proposal: str

class ReviewRequest(BaseModel):
    project_id: str | None = None
    review_type: str = "project"

class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
```

### 6. 错误处理

```python
@app.exception_handler(KeyError)
async def key_error_handler(request, exc):
    return JSONResponse(status_code=404, content={"error": "Not found", "detail": str(exc)})

@app.exception_handler(ValueError)
async def value_error_handler(request, exc):
    return JSONResponse(status_code=400, content={"error": "Bad request", "detail": str(exc)})

@app.exception_handler(Exception)
async def generic_error_handler(request, exc):
    return JSONResponse(status_code=500, content={"error": "Internal error", "detail": str(exc)})
```

### 7. serve 命令集成

修改 `cabinet serve` 使用 uvicorn 启动 FastAPI：

```python
@app.command()
def serve(
    host: str = typer.Option("0.0.0.0", "--host"),
    port: int = typer.Option(8000, "--port"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    import uvicorn
    from cabinet.api.app import create_app

    async def _create_and_serve():
        runtime, config = await _init_runtime(data_dir)
        api_app = create_app(runtime, config)
        uv_config = uvicorn.Config(api_app, host=host, port=port)
        server = uvicorn.Server(uv_config)
        await server.serve()

    asyncio.run(_create_and_serve())
```

### 8. 依赖管理

pyproject.toml 新增：
```toml
dependencies = [
    # ... existing ...
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "websockets>=12.0",
]
```

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/cabinet/api/__init__.py` | 新增 |
| `src/cabinet/api/app.py` | 新增 — FastAPI 应用工厂 |
| `src/cabinet/api/deps.py` | 新增 — 依赖注入 |
| `src/cabinet/api/models.py` | 新增 — 请求/响应模型 |
| `src/cabinet/api/routes/__init__.py` | 新增 |
| `src/cabinet/api/routes/chat.py` | 新增 — Chat REST + WebSocket |
| `src/cabinet/api/routes/employees.py` | 新增 — 员工 CRUD |
| `src/cabinet/api/routes/skills.py` | 新增 — 技能管理 + 执行 |
| `src/cabinet/api/routes/knowledge.py` | 新增 — 知识库操作 |
| `src/cabinet/api/routes/rooms.py` | 新增 — 跨室操作 |
| `src/cabinet/api/routes/config.py` | 新增 — 配置查询 |
| `src/cabinet/cli/main.py` | 修改 — serve 命令使用 uvicorn |
| `pyproject.toml` | 修改 — 新增 fastapi/uvicorn/websockets 依赖 |

## 测试策略

- 使用 FastAPI TestClient 进行端点测试
- 每个 route 模块对应一个测试文件
- WebSocket 测试使用 httpx/websockets 库
- 集成测试验证 API → Runtime → Room 全链路
