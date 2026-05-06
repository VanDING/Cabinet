# Provider Registry & Setup-Provider 设计文档

> 日期: 2026-05-06
> 状态: Draft
> 范围: CLI 层 + Gateway 层

## 1. 背景与问题

Cabinet 当前 LLM 配置存在以下痛点:

1. **默认服务商不可达**: `DEFAULT_MODEL_LIST` 默认使用 `gpt-4o-mini` (OpenAI), 中国大陆用户无法直接访问
2. **配置流程繁琐**: 用户需要手动编辑 `models.json` + 运行 `set-api-key` 两步操作, 且需理解 LiteLLM 的 `provider/model` 前缀格式
3. **不支持中国服务商**: 未预设 DeepSeek、Qwen、GLM 等中国主流 LLM 服务商
4. **运行时不可变**: `LiteLLMRouterGateway` 初始化后无法动态增删模型, 每次配置变更需重启

## 2. 设计目标

- 新增 `cabinet setup-provider` 交互式命令, 用户只需选择服务商、模型、填写 API Key 即可完成配置
- 预设 5 个服务商 (DeepSeek, Qwen, GLM, OpenAI, Anthropic), 每个包含默认 base_url、推荐模型列表、环境变量名
- 默认服务商从 OpenAI 改为 DeepSeek
- Gateway 层支持运行时动态增删模型 (热更新)
- 升级 LiteLLM 到 >=1.81.1 以支持 `zai/` 前缀 (智谱 GLM)
- 向后兼容: 现有 `set-api-key`、手动编辑 `models.json` 仍可使用

## 3. 方案选择

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A: 预设注册表 + Gateway 热更新 | ProviderRegistry + setup-provider + add_model/remove_model | 体验最佳, 运行时可更新 | Gateway 需改, Router 重建有开销 |
| B: 预设注册表 + 文件重载 | 同上, 但 Gateway 通过 reload() 重载文件 | Gateway 改动小 | 文件监听复杂, 重载不可控 |
| C: 纯 CLI 增强 | 只改 CLI, 配置后需重启 | 改动最少 | 体验差, 不满足范围要求 |

**选定方案 A**: 完整覆盖 CLI + Gateway 层, 提供最佳用户体验。

## 4. Provider 预设注册表

新增 `src/cabinet/cli/providers.py`。

### 4.1 ProviderPreset 数据模型

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class ProviderPreset:
    id: str
    display_name: str
    litellm_prefix: str
    base_url: str | None
    api_key_env: str
    default_model: str
    models: tuple[str, ...]
    is_openai_compatible: bool
```

### 4.2 预设配置

| id | display_name | litellm_prefix | base_url | api_key_env | default_model | is_openai_compatible |
|---|---|---|---|---|---|---|
| `deepseek` | DeepSeek | `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | `deepseek-v4-flash` | False |
| `qwen` | 通义千问 (Qwen) | `openai` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` | `qwen3-plus` | True |
| `glm` | 智谱 GLM | `zai` | None | `ZAI_API_KEY` | `glm-4.5-flash` | False |
| `openai` | OpenAI | `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` | `gpt-4o-mini` | False |
| `anthropic` | Anthropic | `anthropic` | None | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | False |

### 4.3 PROVIDER_REGISTRY

```python
PROVIDER_REGISTRY: dict[str, ProviderPreset] = {
    "deepseek": ProviderPreset(
        id="deepseek",
        display_name="DeepSeek",
        litellm_prefix="deepseek",
        base_url="https://api.deepseek.com",
        api_key_env="DEEPSEEK_API_KEY",
        default_model="deepseek-v4-flash",
        models=("deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat"),
        is_openai_compatible=False,
    ),
    "qwen": ProviderPreset(
        id="qwen",
        display_name="通义千问 (Qwen)",
        litellm_prefix="openai",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key_env="DASHSCOPE_API_KEY",
        default_model="qwen3-plus",
        models=("qwen3-plus", "qwen3-max", "qwen-plus", "qwen-flash"),
        is_openai_compatible=True,
    ),
    "glm": ProviderPreset(
        id="glm",
        display_name="智谱 GLM",
        litellm_prefix="zai",
        base_url=None,
        api_key_env="ZAI_API_KEY",
        default_model="glm-4.5-flash",
        models=("glm-4.5-flash", "glm-4.7", "glm-4.5-air", "glm-4.5"),
        is_openai_compatible=False,
    ),
    "openai": ProviderPreset(
        id="openai",
        display_name="OpenAI",
        litellm_prefix="openai",
        base_url="https://api.openai.com/v1",
        api_key_env="OPENAI_API_KEY",
        default_model="gpt-4o-mini",
        models=("gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"),
        is_openai_compatible=False,
    ),
    "anthropic": ProviderPreset(
        id="anthropic",
        display_name="Anthropic",
        litellm_prefix="anthropic",
        base_url=None,
        api_key_env="ANTHROPIC_API_KEY",
        default_model="claude-sonnet-4-20250514",
        models=("claude-sonnet-4-20250514", "claude-haiku-4-5"),
        is_openai_compatible=False,
    ),
}
```

### 4.4 辅助函数

```python
def build_model_entry(preset: ProviderPreset, model_name: str, model_alias: str = "default") -> dict:
    entry = {
        "model_name": model_alias,
        "litellm_params": {
            "model": f"{preset.litellm_prefix}/{model_name}",
        },
    }
    if preset.base_url:
        entry["litellm_params"]["api_base"] = preset.base_url
    return entry
```

## 5. cabinet setup-provider 交互式向导

### 5.1 命令签名

```python
@app.command("setup-provider")
def setup_provider(
    data_dir: str = typer.Option("data", "--data-dir"),
    provider: str = typer.Option(None, "--provider", help="服务商 ID, 跳过交互选择"),
    model: str = typer.Option(None, "--model", help="模型名, 跳过模型选择"),
    api_key: str = typer.Option(None, "--api-key", help="API Key, 跳过输入"),
):
```

### 5.2 交互流程

```
$ cabinet setup-provider

? 选择 LLM 服务商:
  > DeepSeek
    通义千问 (Qwen)
    智谱 GLM
    OpenAI
    Anthropic
    [自定义]

? 选择模型:
  > deepseek-v4-flash (推荐)
    deepseek-v4-pro
    deepseek-chat

? 输入 API Key: sk-xxxxxxxxxxxxxxxx

  服务商 DeepSeek 配置完成!
  模型: deepseek/deepseek-v4-flash
  API Key: sk-xxxx*** (已加密存储)

  你现在可以运行 cabinet chat 开始对话。
```

### 5.3 自动完成三件事

1. 将 API Key 加密写入 `cabinet.json` 的 `api_keys[provider_id]`
2. 将模型条目写入 `models.json` (替换或追加 `model_name` 对应条目)
3. 如果 Runtime 已启动, 调用 `gateway.replace_model()` 热更新

### 5.4 交互式 + 非交互式双模式

- 纯交互式: 首次配置, 逐步引导
- 非交互式: `--provider deepseek --model deepseek-v4-flash --api-key sk-xxx` 支持脚本化/CI
- 自定义服务商: 选择"自定义"时, 提示输入 litellm_prefix、base_url、model_name, 走 `openai/` 兼容模式

### 5.5 models.json 更新逻辑

```python
def _update_models_json(models_path: str, new_entry: dict, model_alias: str = "default"):
    model_list = _load_model_list(models_path)
    replaced = False
    for i, entry in enumerate(model_list):
        if entry.get("model_name") == model_alias:
            model_list[i] = new_entry
            replaced = True
            break
    if not replaced:
        model_list.append(new_entry)
    with open(models_path, "w") as f:
        json.dump(model_list, f, indent=2)
```

幂等性: 重复运行 `setup-provider` 会更新已有配置而非追加重复条目。

## 6. Gateway 层热更新

### 6.1 新增方法

在 `LiteLLMRouterGateway` 中添加:

```python
def add_model(self, entry: dict, api_key: str | None = None) -> None:
    """运行时添加模型条目, 重建 Router"""
    entry_copy = {
        "model_name": entry["model_name"],
        "litellm_params": dict(entry["litellm_params"]),
    }
    if api_key:
        entry_copy["litellm_params"].setdefault("api_key", api_key)
    self._model_list.append(entry_copy)
    self._rebuild_router()

def remove_model(self, model_name: str) -> bool:
    """运行时移除模型条目, 重建 Router。返回是否成功移除"""
    original_len = len(self._model_list)
    self._model_list = [
        e for e in self._model_list if e["model_name"] != model_name
    ]
    removed = len(self._model_list) < original_len
    if removed:
        self._rebuild_router()
    return removed

def replace_model(self, model_name: str, new_entry: dict, api_key: str | None = None) -> None:
    """替换指定 model_name 的条目, 不存在则追加"""
    entry_copy = {
        "model_name": new_entry["model_name"],
        "litellm_params": dict(new_entry["litellm_params"]),
    }
    if api_key:
        entry_copy["litellm_params"].setdefault("api_key", api_key)
    replaced = False
    for i, e in enumerate(self._model_list):
        if e["model_name"] == model_name:
            self._model_list[i] = entry_copy
            replaced = True
            break
    if not replaced:
        self._model_list.append(entry_copy)
    self._rebuild_router()

def _rebuild_router(self) -> None:
    """用当前 _model_list 重建 litellm.Router 实例"""
    self._router = Router(
        model_list=self._model_list,
        fallbacks=self._fallbacks,
        context_window_fallbacks=self._context_window_fallbacks,
        num_retries=self._num_retries,
        timeout=self._timeout,
    )
```

### 6.2 构造函数调整

在 `__init__` 中保存 fallbacks 等配置为实例属性, 供 `_rebuild_router` 使用:

```python
def __init__(self, ...):
    self._fallbacks = fallbacks or []
    self._context_window_fallbacks = context_window_fallbacks or []
    self._num_retries = num_retries
    self._timeout = timeout
    # ... 其余不变
```

### 6.3 设计要点

- **重建而非增量修改**: `litellm.Router` 没有原生 add_model API, 只能重建实例。重建开销在毫秒级
- **线程安全**: Python GIL 保证引用赋值原子性, 旧请求使用旧 Router, 新请求使用新 Router
- **list_models() 自动生效**: 遍历 `self._model_list`, 增删后无需额外操作

### 6.4 与 setup-provider 的联动

```python
if runtime and runtime.gateway:
    preset = PROVIDER_REGISTRY[provider_id]
    model_entry = build_model_entry(preset, selected_model)
    api_key_decrypted = vault.decrypt(stored_key)
    runtime.gateway.replace_model("default", model_entry, api_key=api_key_decrypted)
```

## 7. 默认服务商变更

### 7.1 DEFAULT_MODEL_LIST

```python
DEFAULT_MODEL_LIST = [
    {
        "model_name": "default",
        "litellm_params": {
            "model": "deepseek/deepseek-v4-flash",
            "api_base": "https://api.deepseek.com",
            "rpm": 60,
        },
    },
    {
        "model_name": "reasoning",
        "litellm_params": {
            "model": "deepseek/deepseek-v4-pro",
            "api_base": "https://api.deepseek.com",
            "rpm": 30,
        },
    },
    {
        "model_name": "local",
        "litellm_params": {
            "model": "ollama/llama3",
            "api_base": "http://localhost:11434",
        },
    },
]

DEFAULT_FALLBACKS = [{"default": ["local"]}]
DEFAULT_CONTEXT_WINDOW_FALLBACKS = [{"default": ["default"]}]
```

### 7.2 LiteLLM 依赖升级

```toml
# pyproject.toml
"litellm>=1.81.1"
```

### 7.3 cabinet init 提示更新

```python
console.print(
    Panel(
        f"[bold green]Cabinet initialized![/bold green]\n\n"
        f"Organization: {name}\n"
        f"Captain ID: captain\n"
        f"Data directory: {data_dir}\n\n"
        f"[bold]Next steps:[/bold]\n"
        f"1. Setup LLM provider:  cabinet setup-provider\n"
        f"2. Start chatting:      cabinet chat",
        title="Cabinet Init",
    )
)
```

### 7.4 _init_runtime API Key 解密逻辑更新

```python
for provider_id, encrypted_key in config.api_keys.items():
    decrypted = vault.decrypt(encrypted_key.removeprefix("vault:"))
    preset = PROVIDER_REGISTRY.get(provider_id)
    env_name = preset.api_key_env if preset else f"{provider_id.upper()}_API_KEY"
    os.environ.setdefault(env_name, decrypted)
```

## 8. 向后兼容与迁移

| 场景 | 处理方式 |
|------|---------|
| 旧 `api_keys["openai"]` | `PROVIDER_REGISTRY["openai"]` 存在, 正常映射 |
| 旧 `models.json` 中 `gpt-4o-mini` | 无前缀模型仍被 LiteLLM 识别为 OpenAI |
| 旧 `set-api-key` 命令 | 保留, 标记为 deprecated, 引导使用 `setup-provider` |
| 旧 `config set-key/get-key/list-keys` | 保留, 同上 |
| 手动编辑 `models.json` | 完全兼容, `setup-provider` 读写同一格式 |

不做强制迁移。用户已有的 `models.json` 和 `api_keys` 继续有效。

## 9. 错误处理

### 9.1 setup-provider 错误场景

| 场景 | 处理 |
|------|------|
| 未初始化 (无 cabinet.json) | 提示运行 `cabinet init`, Exit(1) |
| API Key 为空 | 提示重新输入, 不存储空值 |
| 无效的 provider ID | 列出可用 ID, Exit(1) |
| models.json 写入失败 | 回滚 api_keys 变更, 报错 |
| LiteLLM 版本过低 (< 1.81.1) | 在使用 `zai/` 前缀时给出警告 |

### 9.2 Gateway 热更新错误场景

| 场景 | 处理 |
|------|------|
| `_rebuild_router` 失败 | 捕获异常, 保留旧 Router, 日志记录 |
| `add_model` 传入无效条目 | 校验必填字段, 否则 ValueError |
| `remove_model` 移除正在使用的模型 | 允许移除, 日志警告 |

## 10. 测试策略

### 10.1 测试文件

| 测试文件 | 覆盖内容 |
|---------|---------|
| `tests/unit/cli/test_providers.py` | ProviderPreset 数据模型, PROVIDER_REGISTRY 完整性, build_model_entry() |
| `tests/unit/cli/test_setup_provider.py` | setup-provider 交互逻辑, models.json 更新, api_keys 加密, 幂等性 |
| `tests/unit/core/gateway/test_litellm_adapter.py` | add_model / remove_model / replace_model, _rebuild_router, list_models |

### 10.2 关键测试用例

- build_model_entry 对各预设生成正确格式 (DeepSeek/Qwen/GLM/OpenAI/Anthropic)
- Qwen 条目包含 api_base, GLM 条目不包含 api_base
- Gateway add_model 后 list_models 反映变更
- Gateway remove_model 返回正确布尔值
- Gateway replace_model 的 upsert 行为
- _update_models_json 幂等性 (相同 alias 不重复追加)
- setup-provider 非交互模式完整流程
- 向后兼容: 旧格式 models.json + 旧 api_keys 正常加载

## 11. 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/cabinet/cli/providers.py` | 新增 | ProviderPreset + PROVIDER_REGISTRY + build_model_entry |
| `src/cabinet/cli/main.py` | 修改 | 新增 setup-provider 命令, 更新 init 提示, 更新 _init_runtime |
| `src/cabinet/core/gateway/config.py` | 修改 | DEFAULT_MODEL_LIST 改为 DeepSeek |
| `src/cabinet/core/gateway/litellm_adapter.py` | 修改 | 新增 add_model / remove_model / replace_model / _rebuild_router |
| `pyproject.toml` | 修改 | litellm>=1.81.1 |
| `tests/unit/cli/test_providers.py` | 新增 | Provider 注册表测试 |
| `tests/unit/cli/test_setup_provider.py` | 新增 | setup-provider 命令测试 |
| `tests/unit/core/gateway/test_litellm_adapter.py` | 修改 | 新增热更新测试 |
