# 端到端体验打通设计（第一批：CLI 可用性）

日期：2026-05-03

## 背景

Cabinet 的核心架构（6 室 + 事件驱动 + LLM Agent + MCP/知识库/记忆）已全部实现，但从用户视角看，从"安装"到"实际可用"之间有巨大鸿沟：

1. 没有任何 API Key 配置/验证机制
2. `cabinet serve` 是空壳（不启动 HTTP 服务，不连接 LLM）
3. 模型配置硬编码，不可定制
4. `chat` 与 `serve` 行为不一致（chat 用真实 LLM，serve 用 Stub）

本设计是端到端体验打通的第一批，聚焦于 CLI 可用性：API Key 管理、模型配置可定制、init 引导、serve 修复。HTTP API 层在第二批中实现。

## 设计

### 1. API Key 管理

#### 1a. CabinetConfig 增加 api_keys 字段

```python
class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    api_keys: dict[str, str] = {}
    created_at: datetime = Field(default_factory=_now)
```

#### 1b. 新增 `cabinet config` 命令

```
cabinet config set-key openai sk-xxx     # 设置 API Key
cabinet config get-key openai            # 获取 API Key（脱敏显示）
cabinet config list-keys                 # 列出所有已配置的 Key（脱敏显示）
```

脱敏规则：只显示 key 的前 8 位 + `***`，如 `sk-proj-***`

#### 1c. 启动时注入环境变量

在 `_chat_async` 和 `_serve_async` 中，加载 config 后将 `api_keys` 注入 `os.environ`：

```python
for provider, key in config.api_keys.items():
    env_var = f"{provider.upper()}_API_KEY"
    os.environ.setdefault(env_var, key)
```

使用 `setdefault` 而非直接赋值，避免覆盖用户已手动设置的环境变量。

#### 1d. 安全考虑

- `cabinet.json` 中 API Key 明文存储（与 MCP 服务器配置一致）
- `list-keys` 和 `get-key` 只显示脱敏后的值
- 未来可考虑加密存储，但当前保持简单

### 2. 模型配置可定制

#### 2a. 实现 model_config_path 加载

新增 `_load_model_list(data_dir, config)` 函数：

```python
def _load_model_list(data_dir: str, config: CabinetConfig) -> list[dict]:
    model_config_file = os.path.join(data_dir, config.model_config_path)
    if os.path.exists(model_config_file):
        with open(model_config_file) as f:
            return json.load(f)
    return DEFAULT_MODEL_LIST
```

在 `_chat_async` 和 `_serve_async` 中使用此函数替代硬编码的 `DEFAULT_MODEL_LIST`。

#### 2b. `cabinet init` 生成默认 models.json

在 `init` 命令中，创建 `data/models.json` 包含 `DEFAULT_MODEL_LIST`，用户可以随后编辑：

```python
from cabinet.core.gateway.config import DEFAULT_MODEL_LIST
models_path = os.path.join(data_dir, "models.json")
with open(models_path, "w") as f:
    json.dump(DEFAULT_MODEL_LIST, f, indent=2)
```

#### 2c. LiteLLMRouterGateway 传入 api_keys

修改 `LiteLLMRouterGateway` 构造器，接受可选 `api_keys` 参数：

```python
class LiteLLMRouterGateway:
    def __init__(self, model_list: list[dict], api_keys: dict[str, str] | None = None):
        self._api_keys = api_keys or {}
        # 为每个 model 注入 api_key
        for model in model_list:
            params = model.get("litellm_params", {})
            model_name = params.get("model", "")
            for provider, key in self._api_keys.items():
                if model_name.startswith(provider) or model_name.startswith(f"{provider}/"):
                    params.setdefault("api_key", key)
        self._router = Router(model_list=model_list)
```

### 3. init 命令增强

`cabinet init` 完成后，打印引导信息：

```
Cabinet initialized!

Next steps:
1. Configure API keys:  cabinet config set-key openai sk-xxx
2. Edit model list:     data/models.json
3. Start chatting:      cabinet chat
```

### 4. serve 命令修复

#### 4a. 使用真实 LLM

`_serve_async` 当前不创建 `LiteLLMRouterGateway` 和 `LLMAgentFactory`。修复后与 `_chat_async` 一致，创建真实 LLM 组件。

#### 4b. 提取公共初始化逻辑

`_chat_async` 和 `_serve_async` 有大量重复的初始化代码。提取为 `_init_runtime(data_dir)` 公共函数：

```python
async def _init_runtime(data_dir: str) -> tuple[CabinetRuntime, CabinetConfig]:
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
        mcp_connector = MCPConnector()
        for server_config in config.mcp_servers:
            await mcp_connector.connect_server(**server_config)
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)
    await runtime.start()
    return runtime, config
```

`_serve_async` 和 `_chat_async` 均调用 `_init_runtime`，然后各自添加特定逻辑。

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/cabinet/cli/config.py` | 增加 api_keys 字段 |
| `src/cabinet/cli/main.py` | 新增 config 命令；提取 _init_runtime；修复 _serve_async；增强 init 输出 |
| `src/cabinet/core/gateway/litellm_adapter.py` | 构造器增加 api_keys 参数，注入到 model_list |
| `src/cabinet/core/gateway/config.py` | 无改动（DEFAULT_MODEL_LIST 保持不变） |

## 测试策略

- CabinetConfig：验证 api_keys 字段序列化/反序列化
- config 命令：验证 set-key/get-key/list-keys 功能
- _load_model_list：验证从文件加载和 fallback 到默认
- LiteLLMRouterGateway：验证 api_keys 注入到 litellm_params
- _init_runtime：验证创建的 runtime 使用真实 LLM 组件
- serve 修复：验证 serve 模式下 agent_factory 不是 Stub

## 第二批预告

第一批完成后，第二批将实现：
- FastAPI 集成 — serve 命令启动 HTTP 服务
- REST API 端点 — /api/v1/chat, /api/v1/status 等
- WebSocket 支持 — 实时对话流
