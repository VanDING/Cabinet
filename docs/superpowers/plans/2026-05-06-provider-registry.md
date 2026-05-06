# Provider Registry & Setup-Provider 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 Provider 预设注册表和 `cabinet setup-provider` 交互式向导，让中国大陆用户只需选择服务商、模型、填写 API Key 即可完成 LLM 配置；Gateway 层支持运行时热更新。

**Architecture:** 在 CLI 层新增 `providers.py`（ProviderPreset 数据模型 + 5 个预设 + build_model_entry 辅助函数）和 `setup-provider` 交互式命令；在 Gateway 层为 `LiteLLMRouterGateway` 添加 `add_model` / `remove_model` / `replace_model` / `_rebuild_router` 方法；默认服务商从 OpenAI 改为 DeepSeek；升级 LiteLLM 到 >=1.81.1。

**Tech Stack:** Python 3.12, LiteLLM >=1.81.1, Typer, Rich, Pydantic, KeyVault (Fernet)

---

## Task 1: ProviderPreset 数据模型 + PROVIDER_REGISTRY + build_model_entry

**Files:**
- Create: `src/cabinet/cli/providers.py`
- Test: `tests/unit/cli/test_providers.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/cli/test_providers.py
from cabinet.cli.providers import (
    PROVIDER_REGISTRY,
    ProviderPreset,
    build_model_entry,
)


def test_provider_preset_is_frozen_dataclass():
    preset = ProviderPreset(
        id="test",
        display_name="Test",
        litellm_prefix="test",
        base_url=None,
        api_key_env="TEST_API_KEY",
        default_model="test-model",
        models=("test-model",),
        is_openai_compatible=False,
    )
    assert preset.id == "test"
    assert preset.models == ("test-model",)


def test_provider_registry_has_five_presets():
    assert len(PROVIDER_REGISTRY) == 5
    expected_ids = {"deepseek", "qwen", "glm", "openai", "anthropic"}
    assert set(PROVIDER_REGISTRY.keys()) == expected_ids


def test_deepseek_preset():
    p = PROVIDER_REGISTRY["deepseek"]
    assert p.litellm_prefix == "deepseek"
    assert p.base_url == "https://api.deepseek.com"
    assert p.api_key_env == "DEEPSEEK_API_KEY"
    assert p.default_model == "deepseek-v4-flash"
    assert p.is_openai_compatible is False


def test_qwen_preset():
    p = PROVIDER_REGISTRY["qwen"]
    assert p.litellm_prefix == "openai"
    assert p.base_url == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert p.api_key_env == "DASHSCOPE_API_KEY"
    assert p.is_openai_compatible is True


def test_glm_preset():
    p = PROVIDER_REGISTRY["glm"]
    assert p.litellm_prefix == "zai"
    assert p.base_url is None
    assert p.api_key_env == "ZAI_API_KEY"
    assert p.is_openai_compatible is False


def test_openai_preset():
    p = PROVIDER_REGISTRY["openai"]
    assert p.litellm_prefix == "openai"
    assert p.base_url == "https://api.openai.com/v1"
    assert p.api_key_env == "OPENAI_API_KEY"


def test_anthropic_preset():
    p = PROVIDER_REGISTRY["anthropic"]
    assert p.litellm_prefix == "anthropic"
    assert p.base_url is None
    assert p.api_key_env == "ANTHROPIC_API_KEY"


def test_build_model_entry_deepseek():
    entry = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-flash")
    assert entry == {
        "model_name": "default",
        "litellm_params": {
            "model": "deepseek/deepseek-v4-flash",
            "api_base": "https://api.deepseek.com",
        },
    }


def test_build_model_entry_qwen():
    entry = build_model_entry(PROVIDER_REGISTRY["qwen"], "qwen3-plus")
    assert entry["litellm_params"]["model"] == "openai/qwen3-plus"
    assert entry["litellm_params"]["api_base"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"


def test_build_model_entry_glm_no_api_base():
    entry = build_model_entry(PROVIDER_REGISTRY["glm"], "glm-4.5-flash")
    assert entry["litellm_params"]["model"] == "zai/glm-4.5-flash"
    assert "api_base" not in entry["litellm_params"]


def test_build_model_entry_custom_alias():
    entry = build_model_entry(
        PROVIDER_REGISTRY["deepseek"], "deepseek-v4-pro", model_alias="reasoning"
    )
    assert entry["model_name"] == "reasoning"
    assert entry["litellm_params"]["model"] == "deepseek/deepseek-v4-pro"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/cli/test_providers.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cabinet.cli.providers'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/cabinet/cli/providers.py
from __future__ import annotations

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

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/cli/test_providers.py -v`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/providers.py tests/unit/cli/test_providers.py
git commit -m "feat: add ProviderPreset registry with 5 presets and build_model_entry"
```

---

## Task 2: Gateway 热更新方法

**Files:**
- Modify: `src/cabinet/core/gateway/litellm_adapter.py`
- Modify: `tests/unit/core/gateway/test_litellm_adapter.py`

- [ ] **Step 1: Write the failing tests**

在 `tests/unit/core/gateway/test_litellm_adapter.py` 末尾追加：

```python
def test_add_model_updates_list_models():
    gateway = LiteLLMRouterGateway(model_list=[])
    gateway.add_model({
        "model_name": "default",
        "litellm_params": {"model": "deepseek/deepseek-v4-flash"},
    })
    models = gateway.list_models()
    assert len(models) == 1
    assert models[0].id == "default"
    assert models[0].provider == "deepseek"


def test_add_model_with_api_key():
    gateway = LiteLLMRouterGateway(model_list=[])
    gateway.add_model(
        {"model_name": "default", "litellm_params": {"model": "deepseek/deepseek-v4-flash"}},
        api_key="sk-test-key",
    )
    assert gateway._model_list[0]["litellm_params"]["api_key"] == "sk-test-key"


def test_add_model_does_not_override_existing_api_key():
    gateway = LiteLLMRouterGateway(model_list=[])
    gateway.add_model(
        {
            "model_name": "default",
            "litellm_params": {"model": "deepseek/deepseek-v4-flash", "api_key": "existing"},
        },
        api_key="new-key",
    )
    assert gateway._model_list[0]["litellm_params"]["api_key"] == "existing"


def test_remove_model_success():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "deepseek/deepseek-v4-flash"}},
        {"model_name": "fast", "litellm_params": {"model": "groq/llama3-70b-8192"}},
    ])
    result = gateway.remove_model("default")
    assert result is True
    assert len(gateway.list_models()) == 1
    assert gateway.list_models()[0].id == "fast"


def test_remove_model_not_found():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "deepseek/deepseek-v4-flash"}},
    ])
    result = gateway.remove_model("nonexistent")
    assert result is False
    assert len(gateway.list_models()) == 1


def test_replace_model_updates_existing():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    gateway.replace_model("default", {
        "model_name": "default",
        "litellm_params": {"model": "deepseek/deepseek-v4-flash"},
    })
    models = gateway.list_models()
    assert len(models) == 1
    assert models[0].provider == "deepseek"


def test_replace_model_appends_if_not_found():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    gateway.replace_model("reasoning", {
        "model_name": "reasoning",
        "litellm_params": {"model": "deepseek/deepseek-v4-pro"},
    })
    models = gateway.list_models()
    assert len(models) == 2
    ids = [m.id for m in models]
    assert "default" in ids
    assert "reasoning" in ids


def test_replace_model_with_api_key():
    gateway = LiteLLMRouterGateway(model_list=[])
    gateway.replace_model(
        "default",
        {"model_name": "default", "litellm_params": {"model": "deepseek/deepseek-v4-flash"}},
        api_key="sk-test",
    )
    assert gateway._model_list[0]["litellm_params"]["api_key"] == "sk-test"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/gateway/test_litellm_adapter.py::test_add_model_updates_list_models -v`
Expected: FAIL with `AttributeError: 'LiteLLMRouterGateway' object has no attribute 'add_model'`

- [ ] **Step 3: Write minimal implementation**

修改 `src/cabinet/core/gateway/litellm_adapter.py`：

1. 在 `__init__` 中保存 fallbacks 等配置为实例属性：

```python
class LiteLLMRouterGateway:
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
        self._fallbacks = fallbacks or []
        self._context_window_fallbacks = context_window_fallbacks or []
        self._num_retries = num_retries
        self._timeout = timeout
        self._model_list = []
        for entry in model_list:
            entry_copy = {
                "model_name": entry["model_name"],
                "litellm_params": dict(entry["litellm_params"]),
            }
            model_id = entry_copy["litellm_params"]["model"]
            provider = model_id.split("/")[0]
            if provider == model_id:
                provider = "openai"
            if provider in self._api_keys:
                entry_copy["litellm_params"].setdefault("api_key", self._api_keys[provider])
            self._model_list.append(entry_copy)
        self._router = Router(
            model_list=self._model_list,
            fallbacks=self._fallbacks,
            context_window_fallbacks=self._context_window_fallbacks,
            num_retries=self._num_retries,
            timeout=self._timeout,
        )
        self._total_cost = 0.0
```

2. 在 `list_models` 方法之后、`total_cost` 属性之前，添加热更新方法：

```python
    def add_model(self, entry: dict, api_key: str | None = None) -> None:
        entry_copy = {
            "model_name": entry["model_name"],
            "litellm_params": dict(entry["litellm_params"]),
        }
        if api_key:
            entry_copy["litellm_params"].setdefault("api_key", api_key)
        self._model_list.append(entry_copy)
        self._rebuild_router()

    def remove_model(self, model_name: str) -> bool:
        original_len = len(self._model_list)
        self._model_list = [
            e for e in self._model_list if e["model_name"] != model_name
        ]
        removed = len(self._model_list) < original_len
        if removed:
            self._rebuild_router()
        return removed

    def replace_model(self, model_name: str, new_entry: dict, api_key: str | None = None) -> None:
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
        self._router = Router(
            model_list=self._model_list,
            fallbacks=self._fallbacks,
            context_window_fallbacks=self._context_window_fallbacks,
            num_retries=self._num_retries,
            timeout=self._timeout,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/gateway/test_litellm_adapter.py -v`
Expected: All tests PASS (including existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/gateway/litellm_adapter.py tests/unit/core/gateway/test_litellm_adapter.py
git commit -m "feat: add add_model/remove_model/replace_model to LiteLLMRouterGateway"
```

---

## Task 3: DEFAULT_MODEL_LIST 改为 DeepSeek + LiteLLM 升级

**Files:**
- Modify: `src/cabinet/core/gateway/config.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: Update DEFAULT_MODEL_LIST**

修改 `src/cabinet/core/gateway/config.py`，替换整个文件内容：

```python
from __future__ import annotations


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

- [ ] **Step 2: Upgrade LiteLLM dependency**

修改 `pyproject.toml` 第 26 行：

```toml
# 旧: "litellm>=1.40",
# 新:
"litellm>=1.81.1",
```

- [ ] **Step 3: Run existing gateway tests to verify no breakage**

Run: `python -m pytest tests/unit/core/gateway/ -v`
Expected: All tests PASS (model names in tests use `gpt-4o-mini` which are hardcoded, not from DEFAULT_MODEL_LIST)

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/gateway/config.py pyproject.toml
git commit -m "feat: switch default provider to DeepSeek, upgrade litellm>=1.81.1"
```

---

## Task 4: _init_runtime API Key 映射更新

**Files:**
- Modify: `src/cabinet/cli/main.py:292-303`

- [ ] **Step 1: Update _init_runtime API Key decryption logic**

在 `src/cabinet/cli/main.py` 中，替换 `_init_runtime` 函数内的 API Key 解密循环（约第 292-303 行）：

旧代码：
```python
    migrated = False
    for provider, key in config.api_keys.items():
        if key.startswith("vault:"):
            decrypted = vault.decrypt(key[6:])
            os.environ.setdefault(f"{provider.upper()}_API_KEY", decrypted)
        else:
            os.environ.setdefault(f"{provider.upper()}_API_KEY", key)
            encrypted = vault.encrypt(key)
            config.api_keys[provider] = f"vault:{encrypted}"
            migrated = True
    if migrated:
        save_config(config, os.path.join(data_dir, "cabinet.json"))
        _migration_logger.info("migrated plaintext API key(s) to vault encryption")
```

新代码：
```python
    from cabinet.cli.providers import PROVIDER_REGISTRY

    migrated = False
    for provider_id, key in config.api_keys.items():
        if key.startswith("vault:"):
            decrypted = vault.decrypt(key[6:])
        else:
            decrypted = key
            encrypted = vault.encrypt(key)
            config.api_keys[provider_id] = f"vault:{encrypted}"
            migrated = True
        preset = PROVIDER_REGISTRY.get(provider_id)
        env_name = preset.api_key_env if preset else f"{provider_id.upper()}_API_KEY"
        os.environ.setdefault(env_name, decrypted)
    if migrated:
        save_config(config, os.path.join(data_dir, "cabinet.json"))
        _migration_logger.info("migrated plaintext API key(s) to vault encryption")
```

关键变更：
- 使用 `PROVIDER_REGISTRY` 查找正确的环境变量名（如 `deepseek` → `DEEPSEEK_API_KEY`，`qwen` → `DASHSCOPE_API_KEY`）
- 未在注册表中的 provider_id 仍回退到 `{ID.upper()}_API_KEY` 格式
- 向后兼容：旧的 `api_keys["openai"]` 仍映射到 `OPENAI_API_KEY`

- [ ] **Step 2: Run CLI config tests to verify no breakage**

Run: `python -m pytest tests/unit/cli/test_config.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat: use PROVIDER_REGISTRY for API key env mapping in _init_runtime"
```

---

## Task 5: cabinet init 提示更新

**Files:**
- Modify: `src/cabinet/cli/main.py:64-76`

- [ ] **Step 1: Update init command prompt**

在 `src/cabinet/cli/main.py` 中，替换 `init` 命令的 `console.print(Panel(...))` 部分（约第 64-76 行）：

旧代码：
```python
    console.print(
        Panel(
            f"[bold green]Cabinet initialized![/bold green]\n\n"
            f"Organization: {name}\n"
            f"Captain ID: captain\n"
            f"Data directory: {data_dir}\n\n"
            f"[bold]Next steps:[/bold]\n"
            f"1. Configure API keys:  cabinet set-api-key sk-xxx --provider openai\n"
            f"2. Edit model list:     {os.path.join(data_dir, 'models.json')}\n"
            f"3. Start chatting:      cabinet chat",
            title="Cabinet Init",
        )
    )
```

新代码：
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

- [ ] **Step 2: Verify init command still works**

Run: `python -m cabinet init TestOrg --data-dir /tmp/test-init-verify 2>&1 || true`
Expected: 输出包含 "Setup LLM provider: cabinet setup-provider"，不再包含 "set-api-key"

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat: update init prompt to guide users to setup-provider"
```

---

## Task 6: cabinet setup-provider 交互式命令

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Test: `tests/unit/cli/test_setup_provider.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/unit/cli/test_setup_provider.py
import json
import os

import pytest

from cabinet.cli.config import CabinetConfig, load_config, save_config
from cabinet.cli.providers import PROVIDER_REGISTRY, build_model_entry
from cabinet.models.primitives import Organization


def test_update_models_json_replaces_existing_alias(tmp_path):
    from cabinet.cli.main import _update_models_json

    models_path = str(tmp_path / "models.json")
    initial = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
        {"model_name": "fast", "litellm_params": {"model": "groq/llama3-70b-8192"}},
    ]
    with open(models_path, "w") as f:
        json.dump(initial, f)

    new_entry = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-flash")
    _update_models_json(models_path, new_entry, model_alias="default")

    with open(models_path) as f:
        result = json.load(f)
    assert len(result) == 2
    assert result[0]["litellm_params"]["model"] == "deepseek/deepseek-v4-flash"
    assert result[1]["model_name"] == "fast"


def test_update_models_json_appends_new_alias(tmp_path):
    from cabinet.cli.main import _update_models_json

    models_path = str(tmp_path / "models.json")
    initial = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ]
    with open(models_path, "w") as f:
        json.dump(initial, f)

    new_entry = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-pro", model_alias="reasoning")
    _update_models_json(models_path, new_entry, model_alias="reasoning")

    with open(models_path) as f:
        result = json.load(f)
    assert len(result) == 2
    assert result[1]["model_name"] == "reasoning"


def test_update_models_json_idempotent(tmp_path):
    from cabinet.cli.main import _update_models_json

    models_path = str(tmp_path / "models.json")
    initial = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ]
    with open(models_path, "w") as f:
        json.dump(initial, f)

    entry1 = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-flash")
    _update_models_json(models_path, entry1, model_alias="default")

    entry2 = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-flash")
    _update_models_json(models_path, entry2, model_alias="default")

    with open(models_path) as f:
        result = json.load(f)
    assert len(result) == 1
    assert result[0]["litellm_params"]["model"] == "deepseek/deepseek-v4-flash"


def test_setup_provider_non_interactive_deepseek(tmp_path):
    from typer.testing import CliRunner
    from cabinet.cli.main import app

    runner = CliRunner()

    data_dir = str(tmp_path / "data")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "vectors"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "knowledge"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)

    org = Organization(name="TestOrg", captain_id="captain")
    from uuid import uuid4
    config = CabinetConfig(organization=org, default_project=uuid4())
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "models.json"), "w") as f:
        json.dump([], f)

    result = runner.invoke(app, [
        "setup-provider",
        "--provider", "deepseek",
        "--model", "deepseek-v4-flash",
        "--api-key", "sk-test-deepseek-key",
        "--data-dir", data_dir,
    ])

    assert result.exit_code == 0, f"Output: {result.output}"
    assert "DeepSeek" in result.output

    loaded = load_config(os.path.join(data_dir, "cabinet.json"))
    assert "deepseek" in loaded.api_keys
    assert loaded.api_keys["deepseek"].startswith("vault:")

    with open(os.path.join(data_dir, "models.json")) as f:
        models = json.load(f)
    assert any(m["litellm_params"]["model"] == "deepseek/deepseek-v4-flash" for m in models)


def test_setup_provider_non_interactive_qwen(tmp_path):
    from typer.testing import CliRunner
    from cabinet.cli.main import app

    runner = CliRunner()

    data_dir = str(tmp_path / "data")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "vectors"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "knowledge"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)

    org = Organization(name="TestOrg", captain_id="captain")
    from uuid import uuid4
    config = CabinetConfig(organization=org, default_project=uuid4())
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "models.json"), "w") as f:
        json.dump([], f)

    result = runner.invoke(app, [
        "setup-provider",
        "--provider", "qwen",
        "--model", "qwen3-plus",
        "--api-key", "sk-test-dashscope-key",
        "--data-dir", data_dir,
    ])

    assert result.exit_code == 0, f"Output: {result.output}"

    with open(os.path.join(data_dir, "models.json")) as f:
        models = json.load(f)
    assert any(m["litellm_params"]["model"] == "openai/qwen3-plus" for m in models)
    assert any("dashscope.aliyuncs.com" in m["litellm_params"].get("api_base", "") for m in models)


def test_setup_provider_invalid_provider(tmp_path):
    from typer.testing import CliRunner
    from cabinet.cli.main import app

    runner = CliRunner()

    data_dir = str(tmp_path / "data")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "vectors"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "knowledge"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)

    org = Organization(name="TestOrg", captain_id="captain")
    from uuid import uuid4
    config = CabinetConfig(organization=org, default_project=uuid4())
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "models.json"), "w") as f:
        json.dump([], f)

    result = runner.invoke(app, [
        "setup-provider",
        "--provider", "nonexistent",
        "--model", "some-model",
        "--api-key", "sk-test",
        "--data-dir", data_dir,
    ])

    assert result.exit_code != 0


def test_setup_provider_not_initialized(tmp_path):
    from typer.testing import CliRunner
    from cabinet.cli.main import app

    runner = CliRunner()
    data_dir = str(tmp_path / "nonexistent")

    result = runner.invoke(app, [
        "setup-provider",
        "--provider", "deepseek",
        "--model", "deepseek-v4-flash",
        "--api-key", "sk-test",
        "--data-dir", data_dir,
    ])

    assert result.exit_code != 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/cli/test_setup_provider.py -v`
Expected: FAIL with `ImportError: cannot import name '_update_models_json' from 'cabinet.cli.main'`

- [ ] **Step 3: Write minimal implementation**

在 `src/cabinet/cli/main.py` 中：

1. 添加 `_update_models_json` 辅助函数（在 `_load_model_list` 函数之后）：

```python
def _update_models_json(models_path: str, new_entry: dict, model_alias: str = "default"):
    import json as _json

    if os.path.exists(models_path):
        with open(models_path) as f:
            model_list = _json.load(f)
    else:
        model_list = []
    replaced = False
    for i, entry in enumerate(model_list):
        if entry.get("model_name") == model_alias:
            model_list[i] = new_entry
            replaced = True
            break
    if not replaced:
        model_list.append(new_entry)
    with open(models_path, "w") as f:
        _json.dump(model_list, f, indent=2)
```

2. 添加 `setup-provider` 命令（在 `set_api_key` 命令之后）：

```python
@app.command("setup-provider")
def setup_provider(
    provider: str = typer.Option(None, "--provider", help="服务商 ID (deepseek/qwen/glm/openai/anthropic)"),
    model: str = typer.Option(None, "--model", help="模型名称"),
    api_key: str = typer.Option(None, "--api-key", help="API Key"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    from cabinet.cli.providers import PROVIDER_REGISTRY, build_model_entry

    if provider is None:
        console.print("[bold]选择 LLM 服务商:[/bold]")
        provider_ids = list(PROVIDER_REGISTRY.keys())
        for i, pid in enumerate(provider_ids, 1):
            preset = PROVIDER_REGISTRY[pid]
            console.print(f"  {i}. {preset.display_name}")
        console.print(f"  {len(provider_ids) + 1}. 自定义 (OpenAI 兼容)")
        choice = typer.prompt("输入编号", type=int)
        if choice < 1 or choice > len(provider_ids) + 1:
            console.print("[red]Error:[/red] 无效选择")
            raise typer.Exit(code=1)
        if choice <= len(provider_ids):
            provider = provider_ids[choice - 1]
        else:
            provider = "_custom"

    if provider == "_custom":
        litellm_prefix = typer.prompt("LiteLLM 前缀 (通常为 openai)", default="openai")
        custom_base_url = typer.prompt("API Base URL")
        custom_model = typer.prompt("模型名称")
        if api_key is None:
            api_key = typer.prompt("API Key", hide_input=True)
        if not api_key:
            console.print("[red]Error:[/red] API Key 不能为空")
            raise typer.Exit(code=1)

        from cabinet.core.security import KeyVault
        master_key_path = os.path.join(data_dir, ".master_key")
        vault = KeyVault(key_file=master_key_path)
        encrypted = vault.encrypt(api_key)

        from cabinet.cli.config import load_config, save_config
        cfg = load_config(config_path)
        cfg.api_keys["custom"] = f"vault:{encrypted}"
        save_config(cfg, config_path)

        custom_entry = {
            "model_name": "default",
            "litellm_params": {
                "model": f"{litellm_prefix}/{custom_model}",
                "api_base": custom_base_url,
            },
        }
        models_path = os.path.join(data_dir, "models.json")
        _update_models_json(models_path, custom_entry, model_alias="default")

        console.print(f"\n  [green]自定义服务商配置完成![/green]")
        console.print(f"  模型: {litellm_prefix}/{custom_model}")
        console.print(f"  API Key: {api_key[:8]}*** (已加密存储)")
        console.print(f"\n  你现在可以运行 [bold]cabinet chat[/bold] 开始对话。")
        return

    preset = PROVIDER_REGISTRY.get(provider)
    if preset is None:
        console.print(f"[red]Error:[/red] 未知服务商 '{provider}'。可用: {', '.join(PROVIDER_REGISTRY.keys())}")
        raise typer.Exit(code=1)

    if model is None:
        console.print(f"\n[bold]选择模型 ({preset.display_name}):[/bold]")
        for i, m in enumerate(preset.models, 1):
            suffix = " (推荐)" if m == preset.default_model else ""
            console.print(f"  {i}. {m}{suffix}")
        console.print(f"  {len(preset.models) + 1}. 手动输入模型名")
        choice = typer.prompt("输入编号", type=int)
        if choice < 1 or choice > len(preset.models) + 1:
            console.print("[red]Error:[/red] 无效选择")
            raise typer.Exit(code=1)
        if choice <= len(preset.models):
            model = preset.models[choice - 1]
        else:
            model = typer.prompt("输入模型名称")

    if api_key is None:
        api_key = typer.prompt("API Key", hide_input=True)
    if not api_key:
        console.print("[red]Error:[/red] API Key 不能为空")
        raise typer.Exit(code=1)

    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)
    encrypted = vault.encrypt(api_key)

    from cabinet.cli.config import load_config, save_config
    cfg = load_config(config_path)
    cfg.api_keys[provider] = f"vault:{encrypted}"
    save_config(cfg, config_path)

    model_entry = build_model_entry(preset, model)
    models_path = os.path.join(data_dir, "models.json")
    _update_models_json(models_path, model_entry, model_alias="default")

    console.print(f"\n  [green]{preset.display_name} 配置完成![/green]")
    console.print(f"  模型: {model_entry['litellm_params']['model']}")
    console.print(f"  API Key: {api_key[:8]}*** (已加密存储)")
    console.print(f"\n  你现在可以运行 [bold]cabinet chat[/bold] 开始对话。")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/cli/test_setup_provider.py -v`
Expected: All 7 tests PASS

- [ ] **Step 5: Run full CLI test suite**

Run: `python -m pytest tests/unit/cli/ -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_setup_provider.py
git commit -m "feat: add cabinet setup-provider interactive command"
```

---

## Task 7: set-api-key 命令添加 deprecated 提示

**Files:**
- Modify: `src/cabinet/cli/main.py:111-129`

- [ ] **Step 1: Add deprecation warning to set-api-key**

在 `src/cabinet/cli/main.py` 中，修改 `set_api_key` 命令，在加密存储之前添加 deprecated 提示：

旧代码（约第 111-129 行）：
```python
@app.command()
def set_api_key(
    key: str = typer.Argument(..., help="API key to store"),
    provider: str = typer.Option("openai", "--provider", help="Provider name"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)
    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)
    encrypted = vault.encrypt(key)
    from cabinet.cli.config import load_config, save_config
    cfg = load_config(config_path)
    cfg.api_keys[provider] = f"vault:{encrypted}"
    save_config(cfg, config_path)
    console.print(f"[green]API key for '{provider}' stored securely in vault.[/green]")
```

新代码：
```python
@app.command()
def set_api_key(
    key: str = typer.Argument(..., help="API key to store"),
    provider: str = typer.Option("openai", "--provider", help="Provider name"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    console.print("[yellow]Warning:[/yellow] 'set-api-key' is deprecated. Use 'cabinet setup-provider' instead.")
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)
    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)
    encrypted = vault.encrypt(key)
    from cabinet.cli.config import load_config, save_config
    cfg = load_config(config_path)
    cfg.api_keys[provider] = f"vault:{encrypted}"
    save_config(cfg, config_path)
    console.print(f"[green]API key for '{provider}' stored securely in vault.[/green]")
```

- [ ] **Step 2: Commit**

```bash
git add src/cabinet/cli/main.py
git commit -m "chore: add deprecation warning to set-api-key command"
```

---

## Task 8: 集成验证

**Files:** 无新增/修改

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 2: Run linter**

Run: `python -m ruff check src/cabinet/cli/providers.py src/cabinet/cli/main.py src/cabinet/core/gateway/litellm_adapter.py src/cabinet/core/gateway/config.py`
Expected: No errors

- [ ] **Step 3: Verify setup-provider non-interactive mode end-to-end**

```bash
# 初始化
python -m cabinet init TestOrg --data-dir /tmp/e2e-test

# 配置 DeepSeek
python -m cabinet setup-provider --provider deepseek --model deepseek-v4-flash --api-key sk-test-fake --data-dir /tmp/e2e-test

# 验证 models.json
cat /tmp/e2e-test/models.json
# 应包含 deepseek/deepseek-v4-flash 条目

# 验证 cabinet.json
cat /tmp/e2e-test/cabinet.json
# 应包含 api_keys.deepseek 以 vault: 开头
```

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address integration test findings"
```
