# 端到端体验打通（第一批：CLI 可用性）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Cabinet 从"安装"到"实际可用"只需 3 步：init → config set-key → chat/serve

**Architecture:** 自底向上 — 先扩展配置模型，再增强 Gateway，再修复 CLI 命令，最后提取公共初始化逻辑

**Tech Stack:** Python 3.12+, Typer, Pydantic, LiteLLM, Rich

---

### Task 1: CabinetConfig 增加 api_keys 字段

**Files:**
- Modify: `src/cabinet/cli/config.py:17-22`
- Test: `tests/unit/cli/test_config.py`

- [ ] **Step 1: 写失败测试 — api_keys 字段**

在 `tests/unit/cli/test_config.py` 末尾追加：

```python
def test_cabinet_config_has_api_keys_field():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(organization=org, default_project=uuid.uuid4())
    assert config.api_keys == {}


def test_cabinet_config_with_api_keys():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        api_keys={"openai": "sk-test123", "groq": "gsk_test456"},
    )
    assert config.api_keys["openai"] == "sk-test123"
    assert config.api_keys["groq"] == "gsk_test456"


def test_cabinet_config_roundtrip_with_api_keys(tmp_path):
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        api_keys={"openai": "sk-test123"},
    )
    path = str(tmp_path / "config.json")
    save_config(config, path)
    loaded = load_config(path)
    assert loaded.api_keys["openai"] == "sk-test123"
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/cli/test_config.py::test_cabinet_config_has_api_keys_field -v`
Expected: FAIL — `CabinetConfig` 没有 `api_keys` 字段

- [ ] **Step 3: 实现 — CabinetConfig 增加 api_keys**

修改 `src/cabinet/cli/config.py`，在 `mcp_servers` 行后添加 `api_keys` 字段：

```python
class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    api_keys: dict[str, str] = {}
    created_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/cli/test_config.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/config.py tests/unit/cli/test_config.py
git commit -m "feat: add api_keys field to CabinetConfig"
```

---

### Task 2: LiteLLMRouterGateway 支持 api_keys 注入

**Files:**
- Modify: `src/cabinet/core/gateway/litellm_adapter.py:10-27`
- Test: `tests/unit/core/gateway/test_litellm_adapter.py`

- [ ] **Step 1: 写失败测试 — api_keys 注入到 litellm_params**

在 `tests/unit/core/gateway/test_litellm_adapter.py` 末尾追加：

```python
def test_gateway_injects_api_keys_into_model_list():
    model_list = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
        {"model_name": "fast", "litellm_params": {"model": "groq/llama3-70b-8192"}},
    ]
    api_keys = {"openai": "sk-test-openai", "groq": "gsk-test-groq"}
    gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=api_keys)
    injected = gateway._model_list
    assert injected[0]["litellm_params"]["api_key"] == "sk-test-openai"
    assert injected[1]["litellm_params"]["api_key"] == "gsk-test-groq"


def test_gateway_without_api_keys():
    model_list = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ]
    gateway = LiteLLMRouterGateway(model_list=model_list)
    assert "api_key" not in gateway._model_list[0]["litellm_params"]


def test_gateway_api_keys_does_not_override_existing():
    model_list = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini", "api_key": "existing-key"}},
    ]
    api_keys = {"openai": "new-key"}
    gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=api_keys)
    assert gateway._model_list[0]["litellm_params"]["api_key"] == "existing-key"
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/gateway/test_litellm_adapter.py::test_gateway_injects_api_keys_into_model_list -v`
Expected: FAIL — `LiteLLMRouterGateway.__init__()` 不接受 `api_keys` 参数

- [ ] **Step 3: 实现 — LiteLLMRouterGateway 增加 api_keys 参数**

修改 `src/cabinet/core/gateway/litellm_adapter.py`，替换整个 `__init__` 方法：

```python
    def __init__(
        self,
        model_list: list[dict],
        fallbacks: list[dict] | None = None,
        context_window_fallbacks: list[dict] | None = None,
        num_retries: int = 3,
        timeout: int = 30,
        api_keys: dict[str, str] | None = None,
    ):
        self._api_keys = api_keys or {}
        self._model_list = []
        for entry in model_list:
            entry_copy = {
                "model_name": entry["model_name"],
                "litellm_params": dict(entry["litellm_params"]),
            }
            model_id = entry_copy["litellm_params"]["model"]
            for provider, key in self._api_keys.items():
                if model_id.startswith(provider) or model_id.startswith(f"{provider}/"):
                    entry_copy["litellm_params"].setdefault("api_key", key)
            self._model_list.append(entry_copy)
        self._router = Router(
            model_list=self._model_list,
            fallbacks=fallbacks or [],
            context_window_fallbacks=context_window_fallbacks or [],
            num_retries=num_retries,
            timeout=timeout,
        )
        self._total_cost = 0.0
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/core/gateway/test_litellm_adapter.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/gateway/litellm_adapter.py tests/unit/core/gateway/test_litellm_adapter.py
git commit -m "feat: LiteLLMRouterGateway accepts and injects api_keys"
```

---

### Task 3: 新增 `cabinet config` 命令

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: 写失败测试 — config set-key/get-key/list-keys**

在 `tests/unit/cli/test_main.py` 末尾追加：

```python
def test_config_set_key():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "set-key", "openai", "sk-test123", "--data-dir", tmpdir])
        assert result.exit_code == 0
        from cabinet.cli.config import load_config
        config = load_config(os.path.join(tmpdir, "cabinet.json"))
        assert config.api_keys["openai"] == "sk-test123"


def test_config_get_key():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        runner.invoke(app, ["config", "set-key", "openai", "sk-test123", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "get-key", "openai", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "sk-test1***" in result.output


def test_config_list_keys():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        runner.invoke(app, ["config", "set-key", "openai", "sk-test123", "--data-dir", tmpdir])
        runner.invoke(app, ["config", "set-key", "groq", "gsk-test456", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "list-keys", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "openai" in result.output
        assert "groq" in result.output


def test_config_get_key_not_found():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "get-key", "anthropic", "--data-dir", tmpdir])
        assert result.exit_code != 0
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/cli/test_main.py::test_config_set_key -v`
Expected: FAIL — `config` 命令不存在

- [ ] **Step 3: 实现 — 新增 config 命令**

在 `src/cabinet/cli/main.py` 中，在 `chat` 命令之后、`_init_db` 之前，添加 `config` 命令：

```python
@app.command()
def config(
    action: str = typer.Argument(..., help="Action: set-key, get-key, list-keys"),
    key: str = typer.Argument(None, help="Provider name or key name"),
    value: str = typer.Argument(None, help="API key value (for set-key)"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    from cabinet.cli.config import load_config, save_config

    cfg = load_config(config_path)

    if action == "set-key":
        if key is None or value is None:
            console.print("[red]Error:[/red] Usage: cabinet config set-key <provider> <api-key>")
            raise typer.Exit(code=1)
        cfg.api_keys[key] = value
        save_config(cfg, config_path)
        console.print(f"[green]API key for '{key}' saved.[/green]")

    elif action == "get-key":
        if key is None:
            console.print("[red]Error:[/red] Usage: cabinet config get-key <provider>")
            raise typer.Exit(code=1)
        if key not in cfg.api_keys:
            console.print(f"[red]Error:[/red] No API key found for '{key}'")
            raise typer.Exit(code=1)
        masked = cfg.api_keys[key][:8] + "***" if len(cfg.api_keys[key]) > 8 else "***"
        console.print(f"{key}: {masked}")

    elif action == "list-keys":
        if not cfg.api_keys:
            console.print("No API keys configured.")
        else:
            for provider, api_key in cfg.api_keys.items():
                masked = api_key[:8] + "***" if len(api_key) > 8 else "***"
                console.print(f"  {provider}: {masked}")

    else:
        console.print(f"[red]Error:[/red] Unknown action '{action}'. Use: set-key, get-key, list-keys")
        raise typer.Exit(code=1)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "feat: add cabinet config command for API key management"
```

---

### Task 4: 模型配置可定制 — _load_model_list + init 生成 models.json

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: 写失败测试 — init 生成 models.json**

在 `tests/unit/cli/test_main.py` 末尾追加：

```python
def test_init_creates_models_json():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code == 0
        models_path = os.path.join(tmpdir, "models.json")
        assert os.path.exists(models_path)
        with open(models_path) as f:
            data = json.load(f)
        assert any(m["model_name"] == "default" for m in data)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/cli/test_main.py::test_init_creates_models_json -v`
Expected: FAIL — `models.json` 不存在

- [ ] **Step 3: 实现 — _load_model_list 函数 + init 生成 models.json**

在 `src/cabinet/cli/main.py` 中，在 `_init_db` 函数之前，添加 `_load_model_list` 函数：

```python
def _load_model_list(data_dir: str, config: object) -> list[dict]:
    import json as _json
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST

    model_config_file = os.path.join(data_dir, config.model_config_path)
    if os.path.exists(model_config_file):
        with open(model_config_file) as f:
            return _json.load(f)
    return DEFAULT_MODEL_LIST
```

修改 `init` 命令，在 `save_config(config, config_path)` 之后、`asyncio.run(_init_db(...))` 之前，添加：

```python
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST
    models_path = os.path.join(data_dir, "models.json")
    with open(models_path, "w") as f:
        import json as _json
        _json.dump(DEFAULT_MODEL_LIST, f, indent=2)
```

同时修改 `init` 命令的输出面板，在 `f"Data directory: {data_dir}"` 之后追加引导信息：

```python
    console.print(
        Panel(
            f"[bold green]Cabinet initialized![/bold green]\n\n"
            f"Organization: {name}\n"
            f"Captain ID: captain\n"
            f"Data directory: {data_dir}\n\n"
            f"[bold]Next steps:[/bold]\n"
            f"1. Configure API keys:  cabinet config set-key openai sk-xxx\n"
            f"2. Edit model list:     {os.path.join(data_dir, 'models.json')}\n"
            f"3. Start chatting:      cabinet chat",
            title="Cabinet Init",
        )
    )
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "feat: init generates models.json; add _load_model_list helper"
```

---

### Task 5: 提取公共初始化逻辑 + 修复 serve

**Files:**
- Modify: `src/cabinet/cli/main.py:129-240`
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: 写失败测试 — serve 使用真实 LLM 组件**

在 `tests/unit/cli/test_main.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_serve_uses_real_agent_factory(tmp_path):
    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    data_dir = str(tmp_path / "data")
    os.makedirs(data_dir, exist_ok=True)
    org = Organization(name="test", captain_id="cap1")
    project = Project(organization_id=org.id, name="default", description="test")
    org.projects.append(project.id)
    config = CabinetConfig(organization=org, default_project=project.id)
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    from cabinet.cli.main import _init_runtime
    runtime, cfg = await _init_runtime(data_dir)
    from cabinet.agents.llm_factory import LLMAgentFactory
    assert isinstance(runtime._agent_factory, LLMAgentFactory)
    await runtime.stop()
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/cli/test_main.py::test_serve_uses_real_agent_factory -v`
Expected: FAIL — `_init_runtime` 不存在

- [ ] **Step 3: 实现 — _init_runtime 公共函数**

在 `src/cabinet/cli/main.py` 中，在 `_load_model_list` 函数之后、`_init_db` 函数之前，添加 `_init_runtime` 函数：

```python
async def _init_runtime(data_dir: str):
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.cli.config import load_config
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    for provider, key in config.api_keys.items():
        os.environ.setdefault(f"{provider.upper()}_API_KEY", key)

    model_list = _load_model_list(data_dir, config)
    gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=config.api_keys)

    memory_store = SQLiteMemoryStore(db_path=db_path)
    agent_factory = LLMAgentFactory(gateway, memory_store=memory_store)

    kwargs: dict = {
        "agent_factory": agent_factory,
        "db_path": db_path,
        "memory_store": memory_store,
        "gateway": gateway,
    }
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector

        mcp_connector = MCPConnector()
        for server_config in config.mcp_servers:
            await mcp_connector.connect_server(**server_config)
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)
    await runtime.start()
    return runtime, config
```

- [ ] **Step 4: 实现 — 重写 _serve_async 使用 _init_runtime**

替换 `_serve_async` 函数为：

```python
async def _serve_async(data_dir: str) -> None:
    runtime, config = await _init_runtime(data_dir)

    console.print(
        Panel(
            f"[bold green]Cabinet is serving[/bold green]\n\n"
            f"Organization: {config.organization.name}\n"
            f"Event Bus: active\n"
            f"Rooms: meeting, strategy, decision, office, summary, secretary\n\n"
            f"Press Ctrl+C to stop",
            title="Cabinet Serve",
        )
    )

    stop_event = asyncio.Event()
    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass
    finally:
        await runtime.stop()
```

- [ ] **Step 5: 实现 — 重写 _chat_async 使用 _init_runtime**

替换 `_chat_async` 函数为：

```python
async def _chat_async(data_dir: str) -> None:
    from cabinet.rooms.secretary.models import InteractionContext
    from rich.markdown import Markdown
    from rich.prompt import Prompt

    runtime, config = await _init_runtime(data_dir)

    try:
        greeting = await runtime.secretary.greet(captain_id=config.organization.captain_id)
        console.print(Panel(greeting.message, title="Secretary"))
        console.print()

        while True:
            try:
                user_input = Prompt.ask("[bold cyan]Captain[/bold cyan]")
            except (EOFError, KeyboardInterrupt):
                break

            if user_input.strip() == "/quit":
                break
            if user_input.strip() == "/status":
                summary = await runtime.secretary.summarize_pending(
                    captain_id=config.organization.captain_id
                )
                console.print(Markdown(summary.digest))
                console.print()
                continue
            if not user_input.strip():
                continue

            try:
                response = await runtime.secretary.process_input(
                    captain_input=user_input,
                    context=InteractionContext(
                        captain_id=config.organization.captain_id,
                        channel="terminal",
                    ),
                )
                console.print(Markdown(response.message))
                console.print()
            except Exception as e:
                console.print(f"[red]Error:[/red] {e}")
    finally:
        await runtime.stop()
```

- [ ] **Step 6: 运行测试验证通过**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "feat: extract _init_runtime; serve uses real LLM components"
```

---

### Task 6: 最终验证

**Files:** 无新文件

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest --tb=short -q`
Expected: 490+ passed, 0 failed

- [ ] **Step 2: 运行 ruff 检查**

Run: `python -m ruff check src/`
Expected: All checks passed!

- [ ] **Step 3: 运行 ruff format 检查**

Run: `python -m ruff format --check src/`
Expected: All files formatted

- [ ] **Step 4: 提交最终状态（如有格式修正）**

```bash
git add -A
git commit -m "chore: final verification for e2e CLI usability"
```
