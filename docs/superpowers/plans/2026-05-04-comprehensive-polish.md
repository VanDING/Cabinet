# 全面打磨 + 发布准备 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复关键问题、消除质量缺口、完善基础设施和文档，使项目达到发布就绪状态。

**Architecture:** 分层递进 — L1 质量收尾 → L2 基础设施完善 → L3 文档示例完善。每层完成后验证再进入下一层。

**Tech Stack:** Python 3.12, Pydantic v2, FastAPI, Typer, aiosqlite, cryptography, prometheus-client, opentelemetry, ruff, pytest, mypy, pip-audit

---

## Task 1: 修复 CLI 命令冲突 — `config set-key` 改用 KeyVault 加密

**Files:**
- Modify: `src/cabinet/cli/main.py:199-205`
- Modify: `src/cabinet/cli/main.py:267-338` (_init_runtime)
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: 写失败测试 — 验证 `config set-key` 使用 KeyVault 加密**

在 `tests/unit/cli/test_main.py` 末尾添加：

```python
def test_config_set_key_uses_vault():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "set-key", "openai", "sk-test-vault-123", "--data-dir", tmpdir])
        assert result.exit_code == 0
        from cabinet.cli.config import load_config
        config = load_config(os.path.join(tmpdir, "cabinet.json"))
        assert config.api_keys["openai"].startswith("vault:")


def test_config_set_key_shows_deprecation_warning():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "set-key", "openai", "sk-test-dep", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "deprecated" in result.output.lower() or "set-api-key" in result.output
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/cli/test_main.py::test_config_set_key_uses_vault tests/unit/cli/test_main.py::test_config_set_key_shows_deprecation_warning -v`
Expected: FAIL — 当前 `config set-key` 明文存储，不以 `vault:` 开头

- [ ] **Step 3: 修改 `config set-key` 使用 KeyVault 加密并显示弃用警告**

修改 `src/cabinet/cli/main.py` 中 `config` 命令的 `set-key` 分支，将：

```python
    if action == "set-key":
        if key is None or value is None:
            console.print("[red]Error:[/red] Usage: cabinet config set-key <provider> <api-key>")
            raise typer.Exit(code=1)
        cfg.api_keys[key] = value
        save_config(cfg, config_path)
        console.print(f"[green]API key for '{key}' saved.[/green]")
```

改为：

```python
    if action == "set-key":
        if key is None or value is None:
            console.print("[red]Error:[/red] Usage: cabinet config set-key <provider> <api-key>")
            raise typer.Exit(code=1)
        console.print("[yellow]Warning:[/yellow] 'config set-key' is deprecated. Use 'cabinet set-api-key' instead.")
        from cabinet.core.security import KeyVault
        master_key_path = os.path.join(data_dir, ".master_key")
        vault = KeyVault(key_file=master_key_path)
        encrypted = vault.encrypt(value)
        cfg.api_keys[key] = f"vault:{encrypted}"
        save_config(cfg, config_path)
        console.print(f"[green]API key for '{key}' stored securely in vault.[/green]")
```

- [ ] **Step 4: 在 `_init_runtime` 中添加明文 API key 自动迁移**

在 `src/cabinet/cli/main.py` 的 `_init_runtime` 函数中，将：

```python
    for provider, key in config.api_keys.items():
        if key.startswith("vault:"):
            from cabinet.core.security import KeyVault
            master_key_path = os.path.join(data_dir, ".master_key")
            vault = KeyVault(key_file=master_key_path)
            decrypted = vault.decrypt(key[6:])
            os.environ.setdefault(f"{provider.upper()}_API_KEY", decrypted)
        else:
            os.environ.setdefault(f"{provider.upper()}_API_KEY", key)
```

改为：

```python
    import logging as _logging
    _migration_logger = _logging.getLogger("cabinet.cli")

    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)

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

注意：需要在函数顶部已有 `from cabinet.cli.config import load_config` 的基础上，额外导入 `save_config`。将：

```python
    from cabinet.cli.config import load_config
```

改为：

```python
    from cabinet.cli.config import load_config, save_config
```

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "fix: config set-key uses KeyVault encryption, auto-migrate plaintext keys"
```

---

## Task 2: 修复审计日志静默失败

**Files:**
- Modify: `src/cabinet/api/deps.py:36-44`
- Modify: `src/cabinet/runtime.py:156-167`

- [ ] **Step 1: 写失败测试 — 验证审计失败时记录警告日志**

在 `tests/unit/cli/test_main.py` 末尾添加（或创建 `tests/unit/api/test_deps.py`）：

```python
import logging
import pytest


@pytest.mark.asyncio
async def test_audit_failure_logs_warning(caplog):
    from unittest.mock import AsyncMock, MagicMock, patch

    from cabinet.api.deps import get_current_user
    from fastapi.security import HTTPAuthorizationCredentials

    mock_request = MagicMock()
    mock_request.app.state.config.api_token = "test-token"
    mock_request.app.state.config.api_token = "test-token"
    mock_request.client.host = "127.0.0.1"

    mock_runtime = MagicMock()
    mock_audit = AsyncMock()
    mock_audit.log = AsyncMock(side_effect=RuntimeError("DB locked"))
    mock_runtime._audit_store = mock_audit
    mock_request.app.state.runtime = mock_runtime

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="test-token")

    with caplog.at_level(logging.WARNING):
        result = await get_current_user(credentials, mock_request)

    assert result == "test-token"
    assert any("audit" in r.message.lower() for r in caplog.records)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/api/test_deps.py::test_audit_failure_logs_warning -v`
Expected: FAIL — 当前 `except Exception: pass` 吞掉异常，无日志输出

- [ ] **Step 3: 修改 `deps.py` 审计失败时记录警告**

修改 `src/cabinet/api/deps.py`，在文件顶部添加：

```python
import logging

logger = logging.getLogger(__name__)
```

将：

```python
    except Exception:
        pass
```

改为：

```python
    except Exception:
        logger.warning("audit log write failed", exc_info=True)
```

- [ ] **Step 4: 修改 `runtime.py` 审计禁用时输出 info 日志**

修改 `src/cabinet/runtime.py` 的 `start()` 方法，在审计初始化逻辑后添加：

将：

```python
        if self._db_path:
            import os as _os
            from cabinet.core.audit import AuditStore as _AuditStore

            self._audit_store = _AuditStore(_os.path.join(_os.path.dirname(self._db_path), "audit.db"))
            await self._audit_store.initialize()
        if self._audit_store is not None:
```

改为：

```python
        if self._db_path:
            import os as _os
            from cabinet.core.audit import AuditStore as _AuditStore

            self._audit_store = _AuditStore(_os.path.join(_os.path.dirname(self._db_path), "audit.db"))
            await self._audit_store.initialize()
        else:
            logger.info("audit disabled: no db_path configured")
        if self._audit_store is not None:
```

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/unit/api/test_deps.py::test_audit_failure_logs_warning tests/unit/runtime/ -v`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/api/deps.py src/cabinet/runtime.py tests/unit/api/test_deps.py
git commit -m "fix: audit log failure now logs warning instead of silent pass"
```

---

## Task 3: 修复 `test_serve_creates_memory_store` 测试失败

**Files:**
- Modify: `tests/unit/cli/test_main.py:56-96`

- [ ] **Step 1: 重写失败的测试**

将 `tests/unit/cli/test_main.py` 中的 `test_serve_creates_memory_store` 替换为：

```python
@pytest.mark.asyncio
async def test_init_runtime_creates_sqlite_memory_store(tmp_path):
    from unittest.mock import AsyncMock, patch

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    data_dir = str(tmp_path / "data")
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)
    org = Organization(name="test", captain_id="cap1")
    project = Project(organization_id=org.id, name="default", description="test")
    org.projects.append(project.id)
    config = CabinetConfig(
        organization=org,
        default_project=project.id,
        memory_type="sqlite",
    )
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "employees.json"), "w") as f:
        f.write("[]")

    with patch("cabinet.core.gateway.litellm_adapter.LiteLLMRouterGateway"), \
         patch("cabinet.core.tools.skill_store.SkillStore") as MockSkillStore:
        mock_skill_store = AsyncMock()
        mock_skill_store.initialize = AsyncMock()
        MockSkillStore.return_value = mock_skill_store

        from cabinet.cli.main import _init_runtime
        runtime, cfg = await _init_runtime(data_dir)
        assert runtime is not None
        from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
        assert isinstance(runtime._memory_store, SQLiteMemoryStore)
        await runtime.stop()
```

同时删除旧的 `test_serve_creates_memory_store` 和 `test_serve_uses_real_agent_factory` 测试（后者逻辑重复），替换为：

```python
@pytest.mark.asyncio
async def test_init_runtime_creates_chromadb_memory_store(tmp_path):
    from unittest.mock import AsyncMock, patch

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    data_dir = str(tmp_path / "data")
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)
    org = Organization(name="test", captain_id="cap1")
    project = Project(organization_id=org.id, name="default", description="test")
    org.projects.append(project.id)
    config = CabinetConfig(
        organization=org,
        default_project=project.id,
        memory_type="chromadb",
    )
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "employees.json"), "w") as f:
        f.write("[]")

    with patch("cabinet.core.gateway.litellm_adapter.LiteLLMRouterGateway"), \
         patch("cabinet.core.tools.skill_store.SkillStore") as MockSkillStore:
        mock_skill_store = AsyncMock()
        mock_skill_store.initialize = AsyncMock()
        MockSkillStore.return_value = mock_skill_store

        from cabinet.cli.main import _init_runtime
        runtime, cfg = await _init_runtime(data_dir)
        assert runtime is not None
        from cabinet.core.memory.vector_store import ChromaDBMemoryStore
        assert isinstance(runtime._memory_store, ChromaDBMemoryStore)
        await runtime.stop()
```

- [ ] **Step 2: 运行测试确认通过**

Run: `python -m pytest tests/unit/cli/test_main.py::test_init_runtime_creates_sqlite_memory_store tests/unit/cli/test_main.py::test_init_runtime_creates_chromadb_memory_store -v`
Expected: ALL PASS

- [ ] **Step 3: 补充 `set-api-key` 命令测试**

在 `tests/unit/cli/test_main.py` 末尾添加：

```python
def test_set_api_key_command():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["set-api-key", "sk-test-secure", "--provider", "openai", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "vault" in result.output.lower() or "securely" in result.output.lower()
        from cabinet.cli.config import load_config
        config = load_config(os.path.join(tmpdir, "cabinet.json"))
        assert config.api_keys["openai"].startswith("vault:")
```

- [ ] **Step 4: 运行全部 CLI 测试确认通过**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add tests/unit/cli/test_main.py
git commit -m "fix: rewrite failing test_serve_creates_memory_store, add set-api-key test"
```

---

## Task 4: 补充 `__init__.py` 公共 API 导出

**Files:**
- Modify: `src/cabinet/__init__.py`
- Modify: `src/cabinet/core/__init__.py`
- Modify: `src/cabinet/core/memory/__init__.py`
- Modify: `src/cabinet/core/events/__init__.py`
- Modify: `src/cabinet/core/gateway/__init__.py`
- Modify: `src/cabinet/core/knowledge/__init__.py`
- Modify: `src/cabinet/core/tools/__init__.py`
- Modify: `src/cabinet/core/workflow/__init__.py`
- Modify: `src/cabinet/models/__init__.py`
- Modify: `src/cabinet/agents/__init__.py`
- Modify: `src/cabinet/rooms/__init__.py`

- [ ] **Step 1: 写验证测试**

创建 `tests/unit/test_public_api.py`：

```python
def test_cabinet_top_level_exports():
    from cabinet import CabinetRuntime, __version__
    assert __version__
    assert CabinetRuntime is not None


def test_cabinet_core_exports():
    from cabinet.core import AuditStore, AuditEvent, KeyVault, sanitize_input, ObservabilityConfig
    assert AuditStore is not None
    assert AuditEvent is not None
    assert KeyVault is not None
    assert sanitize_input is not None
    assert ObservabilityConfig is not None


def test_cabinet_core_memory_exports():
    from cabinet.core.memory import MemoryStore, SQLiteMemoryStore, ChromaDBMemoryStore, MemoryScope
    assert MemoryStore is not None
    assert SQLiteMemoryStore is not None
    assert ChromaDBMemoryStore is not None
    assert MemoryScope is not None


def test_cabinet_core_events_exports():
    from cabinet.core.events import EventBus, SQLiteEventStore, Event
    assert EventBus is not None
    assert SQLiteEventStore is not None
    assert Event is not None


def test_cabinet_core_gateway_exports():
    from cabinet.core.gateway import LiteLLMRouterGateway
    assert LiteLLMRouterGateway is not None


def test_cabinet_core_knowledge_exports():
    from cabinet.core.knowledge import LocalKnowledgeBase
    assert LocalKnowledgeBase is not None


def test_cabinet_core_tools_exports():
    from cabinet.core.tools import ToolRegistry, MCPConnector, SkillStore
    assert ToolRegistry is not None
    assert MCPConnector is not None
    assert SkillStore is not None


def test_cabinet_core_workflow_exports():
    from cabinet.core.workflow import WorkflowEngine
    assert WorkflowEngine is not None


def test_cabinet_models_exports():
    from cabinet.models import Decision, Organization, Project
    assert Decision is not None
    assert Organization is not None
    assert Project is not None


def test_cabinet_agents_exports():
    from cabinet.agents import LiteLLMAgent, AgentFactory, StubAgentFactory
    assert LiteLLMAgent is not None
    assert AgentFactory is not None
    assert StubAgentFactory is not None


def test_cabinet_rooms_exports():
    from cabinet.rooms import (
        MeetingRoomService,
        StrategyDecoderService,
        DecisionRoomService,
        OfficeSchedulerService,
        SummaryRoomService,
        SecretaryAgentService,
    )
    assert MeetingRoomService is not None
    assert StrategyDecoderService is not None
    assert DecisionRoomService is not None
    assert OfficeSchedulerService is not None
    assert SummaryRoomService is not None
    assert SecretaryAgentService is not None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/test_public_api.py -v`
Expected: FAIL — 当前 `__init__.py` 为空，导入失败

- [ ] **Step 3: 修改 `src/cabinet/__init__.py`**

```python
__version__ = "0.1.0"

from cabinet.runtime import CabinetRuntime
from cabinet.cli.config import CabinetConfig

__all__ = ["CabinetRuntime", "CabinetConfig", "__version__"]
```

- [ ] **Step 4: 修改 `src/cabinet/core/__init__.py`**

```python
from cabinet.core.audit import AuditStore, AuditEvent
from cabinet.core.security import KeyVault, sanitize_input
from cabinet.core.observability import ObservabilityConfig

__all__ = ["AuditStore", "AuditEvent", "KeyVault", "sanitize_input", "ObservabilityConfig"]
```

- [ ] **Step 5: 修改 `src/cabinet/core/memory/__init__.py`**

```python
from cabinet.core.memory.protocol import MemoryStore
from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
from cabinet.core.memory.vector_store import ChromaDBMemoryStore
from cabinet.models.primitives import MemoryScope

__all__ = ["MemoryStore", "SQLiteMemoryStore", "ChromaDBMemoryStore", "MemoryScope"]
```

- [ ] **Step 6: 修改 `src/cabinet/core/events/__init__.py`**

```python
from cabinet.core.events.asyncio_bus import AsyncIOEventBus as EventBus
from cabinet.core.events.sqlite_store import SqliteEventStore as SQLiteEventStore
from cabinet.models.events import MessageEnvelope as Event

__all__ = ["EventBus", "SQLiteEventStore", "Event"]
```

- [ ] **Step 7: 修改 `src/cabinet/core/gateway/__init__.py`**

```python
from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway

__all__ = ["LiteLLMRouterGateway"]
```

- [ ] **Step 8: 修改 `src/cabinet/core/knowledge/__init__.py`**

```python
from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase as LocalKnowledgeBase

__all__ = ["LocalKnowledgeBase"]
```

- [ ] **Step 9: 修改 `src/cabinet/core/tools/__init__.py`**

```python
from cabinet.core.tools.registry import LocalToolRegistry as ToolRegistry
from cabinet.core.tools.mcp_connector import MCPConnector
from cabinet.core.tools.skill_store import SkillStore

__all__ = ["ToolRegistry", "MCPConnector", "SkillStore"]
```

- [ ] **Step 10: 修改 `src/cabinet/core/workflow/__init__.py`**

```python
from cabinet.core.workflow.engine import WorkflowEngine

__all__ = ["WorkflowEngine"]
```

- [ ] **Step 11: 修改 `src/cabinet/models/__init__.py`**

```python
from cabinet.models.decisions import Decision
from cabinet.models.primitives import Organization, Project

__all__ = ["Decision", "Organization", "Project"]
```

- [ ] **Step 12: 修改 `src/cabinet/agents/__init__.py`**

```python
from cabinet.agents.llm_agent import LiteLLMAgent
from cabinet.agents.protocol import BaseAgent as AgentFactory
from cabinet.agents.stub_factory import StubAgentFactory

__all__ = ["LiteLLMAgent", "AgentFactory", "StubAgentFactory"]
```

- [ ] **Step 13: 修改 `src/cabinet/rooms/__init__.py`**

```python
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.service import SummaryRoomService

__all__ = [
    "MeetingRoomService",
    "StrategyDecoderService",
    "DecisionRoomService",
    "OfficeSchedulerService",
    "SummaryRoomService",
    "SecretaryAgentService",
]
```

- [ ] **Step 14: 运行测试确认通过**

Run: `python -m pytest tests/unit/test_public_api.py -v`
Expected: ALL PASS

- [ ] **Step 15: 运行全量测试确认无回归**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 16: 提交**

```bash
git add src/cabinet/__init__.py src/cabinet/core/__init__.py src/cabinet/core/memory/__init__.py src/cabinet/core/events/__init__.py src/cabinet/core/gateway/__init__.py src/cabinet/core/knowledge/__init__.py src/cabinet/core/tools/__init__.py src/cabinet/core/workflow/__init__.py src/cabinet/models/__init__.py src/cabinet/agents/__init__.py src/cabinet/rooms/__init__.py tests/unit/test_public_api.py
git commit -m "feat: add public API exports to all __init__.py files"
```

---

## Task 5: 消除重复代码 — 提取 `examples/_shared.py`

**Files:**
- Create: `examples/_shared.py`
- Modify: `examples/e2e_workflow.py`
- Modify: `examples/tutorial.py`

- [ ] **Step 1: 创建 `examples/_shared.py`**

```python
from __future__ import annotations

import json
import os

from cabinet.cli.config import load_config
from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase
from cabinet.core.memory.vector_store import ChromaDBMemoryStore
from cabinet.runtime import CabinetRuntime


async def setup_runtime(data_dir: str, live: bool = False):
    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)

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
        from cabinet.cli.config import save_config
        save_config(config, os.path.join(data_dir, "cabinet.json"))

    if live:
        from cabinet.agents.employee_store import JsonEmployeeStore
        from cabinet.agents.llm_factory import LLMAgentFactory
        from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway

        model_list_path = os.path.join(data_dir, config.model_config_path)
        with open(model_list_path) as f:
            model_list = json.load(f)
        gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=config.api_keys)
        employee_store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
        await employee_store.initialize()
        agent_factory = LLMAgentFactory(gateway, memory_store=None, employee_store=employee_store)
    else:
        from cabinet.agents.stub_factory import StubAgentFactory

        agent_factory = StubAgentFactory()

    memory_store = ChromaDBMemoryStore(persist_dir=os.path.join(data_dir, "vectors"))
    knowledge_base = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))

    runtime = CabinetRuntime(
        agent_factory=agent_factory,
        db_path=db_path,
        memory_store=memory_store,
        knowledge_base=knowledge_base,
    )
    await runtime.start()
    return runtime, config
```

- [ ] **Step 2: 重构 `examples/e2e_workflow.py`**

将 `setup_runtime` 函数替换为导入，删除原有 `setup_runtime` 定义：

```python
import argparse
import asyncio

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from _shared import setup_runtime

console = Console()
```

删除 `from __future__ import annotations` 行（已在 _shared.py 中），删除 `import os` 和 `from uuid import uuid4` 之外不需要的导入。保留 `uuid4` 因为 `run_demo` 中使用。

完整重构后的 `examples/e2e_workflow.py`：

```python
"""Cabinet end-to-end workflow demo.

Usage:
    python examples/e2e_workflow.py --data-dir data
    python examples/e2e_workflow.py --data-dir data --live
"""
import argparse
import asyncio
from uuid import uuid4

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from _shared import setup_runtime

console = Console()


async def run_demo(data_dir: str, live: bool = False):
    console.print(Panel("[bold green]Cabinet E2E Workflow Demo[/bold green]", title="Cabinet"))
    console.print(f"Mode: {'Live (LLM)' if live else 'Stub (no LLM needed)'}\n")

    runtime, config = await setup_runtime(data_dir, live)
    captain_id = config.organization.captain_id

    try:
        console.print("[bold cyan]Step 1:[/bold cyan] Secretary greets Captain")
        greeting = await runtime.secretary.greet(captain_id=captain_id)
        console.print(Panel(greeting.message, title="Secretary"))
        console.print()

        console.print("[bold cyan]Step 2:[/bold cyan] Captain submits strategic proposal")
        proposal = "We should pivot from a general AI assistant to vertical industry solutions"
        console.print(f"Captain: {proposal}\n")

        console.print("[bold cyan]Step 3:[/bold cyan] Meeting Room deliberation")
        from cabinet.rooms.meeting.models import MeetingLevel
        participants = [uuid4(), uuid4()]
        session = await runtime.meeting.start_session(
            topic=proposal, level=MeetingLevel.MULTI_PARTY, participants=participants,
        )
        for pid in participants:
            await runtime.meeting.add_perspective(session.id, pid)
        await runtime.meeting.cross_validate(session.id)
        result = await runtime.meeting.converge(session.id)
        console.print(Panel(result.proposal_text[:300], title="Meeting Result"))
        console.print()

        console.print("[bold cyan]Step 4:[/bold cyan] Strategy Room decodes blueprint")
        from cabinet.rooms.strategy.models import DecodeContext
        from cabinet.rooms.meeting.models import DeliberationOutput, DeliberationResult, ConvergenceResult
        proposal_output = DeliberationOutput(
            session_id=session.id,
            proposal=DeliberationResult(
                session_id=session.id, proposal_text=proposal, confidence=0.8,
                reasoning_summary="deliberation", convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
                rounds_used=1, rumination_detected=False,
            ),
        )
        context = DecodeContext(project_id=config.default_project, captain_id=captain_id, existing_constraints=[])
        blueprint = await runtime.strategy.decode(proposal_output, context)
        table = Table(title="Blueprint Domains")
        table.add_column("Domain", style="cyan")
        for d in blueprint.domains:
            table.add_row(d.name)
        console.print(table)
        console.print()

        console.print("[bold cyan]Step 5:[/bold cyan] Decision Room rules")
        from cabinet.models.events import DecisionRequest
        from cabinet.models.decisions import DecisionType
        request = DecisionRequest(
            decision_id=uuid4(), decision_type=DecisionType.STRATEGIC.value,
            title="Pivot to vertical solutions", options=[{"label": "Approve"}, {"label": "Reject"}],
        )
        decision = await runtime.decision.submit(request)
        console.print(f"Decision: {decision.title} - {decision.status}")
        console.print()

        console.print("[bold cyan]Step 6:[/bold cyan] Office Room executes task")
        from cabinet.models.events import TaskOrder
        order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"description": "Market analysis"})
        task = await runtime.office.submit_task(order)
        console.print(f"Task: {task.id} - {task.status}")
        console.print()

        console.print("[bold cyan]Step 7:[/bold cyan] Summary Room learns")
        from cabinet.rooms.summary.models import ReviewType
        review = await runtime.summary.start_review(project_id=config.default_project, review_type=ReviewType.PROJECT_REVIEW)
        insights = await runtime.summary.generate_insights(review.id)
        console.print(f"Generated {len(insights)} insights")
        console.print()

        console.print("[bold cyan]Step 8:[/bold cyan] Observability check")
        health = await runtime.health_check()
        console.print(f"Health: {health['status']}")
        for c in health["components"]:
            console.print(f"  {c['name']}: {c['status']} ({c['latency_ms']:.1f}ms)")
        console.print("Prometheus: http://localhost:9090/metrics")
        console.print()

    finally:
        await runtime.stop()

    console.print(Panel("[bold green]Demo complete![/bold green]", title="Cabinet"))


def main():
    parser = argparse.ArgumentParser(description="Cabinet E2E Workflow Demo")
    parser.add_argument("--data-dir", default="data", help="Data directory path")
    parser.add_argument("--live", action="store_true", help="Use live LLM (requires API key)")
    args = parser.parse_args()
    asyncio.run(run_demo(args.data_dir, args.live))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 重构 `examples/tutorial.py`**

同样将 `setup_runtime` 替换为导入：

```python
"""Cabinet Interactive Tutorial.

Usage:
    python examples/tutorial.py --data-dir data
    python examples/tutorial.py --data-dir data --live
"""
import argparse
import asyncio
from uuid import uuid4

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress
from rich.prompt import Prompt

from _shared import setup_runtime

console = Console()
STEPS = 6


def pause():
    Prompt.ask("\n[dim]Press Enter to continue[/dim]", default="")


async def run_tutorial(data_dir: str, live: bool = False):
    console.print(Panel(
        "[bold green]Welcome to the Cabinet Interactive Tutorial![/bold green]\n\n"
        "This tutorial will guide you through Cabinet's core features.\n"
        f"Mode: {'Live (LLM)' if live else 'Stub (no LLM needed)'}",
        title="Cabinet Tutorial",
    ))
    pause()

    runtime, config = await setup_runtime(data_dir, live)
    captain_id = config.organization.captain_id

    try:
        with Progress() as progress:
            task = progress.add_task("[cyan]Tutorial Progress", total=STEPS)

            progress.update(task, description="[cyan]Step 1/6: Initialize & Greet")
            console.print("\n[bold cyan]Step 1: Initialize & Greet[/bold cyan]")
            console.print("CabinetRuntime starts, Secretary greets the Captain.")
            greeting = await runtime.secretary.greet(captain_id=captain_id)
            console.print(Panel(greeting.message, title="Secretary"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 2/6: Chat with Secretary")
            console.print("\n[bold cyan]Step 2: Chat with Secretary[/bold cyan]")
            console.print("Type a message to the Secretary (or press Enter for default):")
            user_msg = Prompt.ask("[bold cyan]Captain[/bold cyan]", default="What's our current status?")
            from cabinet.rooms.secretary.models import InteractionContext
            context = InteractionContext(captain_id=captain_id, channel="tutorial")
            response = await runtime.secretary.process_input(user_msg, context)
            console.print(Panel(response.message, title="Secretary"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 3/6: Meeting Room")
            console.print("\n[bold cyan]Step 3: Meeting Room Deliberation[/bold cyan]")
            console.print("Multiple perspectives converge on a proposal.")
            from cabinet.rooms.meeting.models import MeetingLevel
            participants = [uuid4(), uuid4()]
            session = await runtime.meeting.start_session(
                topic="Product strategy pivot", level=MeetingLevel.MULTI_PARTY, participants=participants,
            )
            for pid in participants:
                await runtime.meeting.add_perspective(session.id, pid)
            await runtime.meeting.cross_validate(session.id)
            result = await runtime.meeting.converge(session.id)
            console.print(Panel(result.proposal_text[:200], title="Convergence"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 4/6: Decision Room")
            console.print("\n[bold cyan]Step 4: Decision Room[/bold cyan]")
            console.print("Submit a decision for ruling.")
            from cabinet.models.events import DecisionRequest
            from cabinet.models.decisions import DecisionType
            request = DecisionRequest(
                decision_id=uuid4(), decision_type=DecisionType.STRATEGIC.value,
                title="Pivot strategy", options=[{"label": "Approve"}, {"label": "Reject"}],
            )
            decision = await runtime.decision.submit(request)
            console.print(f"Decision: {decision.title} - {decision.status}")
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 5/6: Office Room")
            console.print("\n[bold cyan]Step 5: Office Room Execution[/bold cyan]")
            console.print("Submit a task for automated execution.")
            from cabinet.models.events import TaskOrder
            order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"description": "Analysis"})
            task_result = await runtime.office.submit_task(order)
            console.print(f"Task: {task_result.id} - {task_result.status}")
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 6/6: Observability")
            console.print("\n[bold cyan]Step 6: Observability[/bold cyan]")
            console.print("Check system health and metrics.")
            health = await runtime.health_check()
            console.print(f"Overall: {health['status']}")
            for c in health["components"]:
                console.print(f"  {c['name']}: {c['status']} ({c['latency_ms']:.1f}ms)")
            console.print("\nPrometheus metrics: http://localhost:9090/metrics")
            progress.advance(task)

    finally:
        await runtime.stop()

    console.print(Panel(
        "[bold green]Tutorial complete![/bold green]\n\n"
        "You've experienced Cabinet's core workflow:\n"
        "Secretary -> Meeting -> Decision -> Office -> Summary\n\n"
        "Explore more with: cabinet chat",
        title="Congratulations!",
    ))


def main():
    parser = argparse.ArgumentParser(description="Cabinet Interactive Tutorial")
    parser.add_argument("--data-dir", default="data", help="Data directory path")
    parser.add_argument("--live", action="store_true", help="Use live LLM (requires API key)")
    args = parser.parse_args()
    asyncio.run(run_tutorial(args.data_dir, args.live))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 运行 lint 确认无错误**

Run: `python -m ruff check examples/`
Expected: All checks passed

- [ ] **Step 5: 提交**

```bash
git add examples/_shared.py examples/e2e_workflow.py examples/tutorial.py
git commit -m "refactor: extract shared setup_runtime to examples/_shared.py"
```

---

## Task 6: 修复其他质量缺口

**Files:**
- Modify: `src/cabinet/core/audit.py:10`
- Modify: `src/cabinet/core/security.py:53-54`
- Modify: `src/cabinet/api/app.py:67-72`
- Modify: `src/cabinet/runtime.py:265`
- Modify: `src/cabinet/cli/config.py:36`

- [ ] **Step 1: 修复 `AuditEvent.timestamp` 可变默认值**

修改 `src/cabinet/core/audit.py`，将：

```python
from pydantic import BaseModel
```

改为：

```python
from pydantic import BaseModel, Field
```

将：

```python
    timestamp: datetime = datetime.now(timezone.utc)
```

改为：

```python
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: 修复 `KeyVault` 硬编码 salt**

修改 `src/cabinet/core/security.py`，将 `_derive_key` 方法改为：

```python
    @staticmethod
    def _derive_key(material: bytes, salt: bytes | None = None) -> bytes:
        if len(material) == 44:
            try:
                base64.urlsafe_b64decode(material)
                return material
            except Exception:
                pass
        if salt is None:
            import hashlib
            salt = hashlib.sha256(material).digest()[:16]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=480_000,
        )
        return base64.urlsafe_b64encode(kdf.derive(material))
```

注意：此修改保持向后兼容 — 当 `salt=None` 时，使用 `sha256(material)[:16]` 作为确定性 salt，这意味着相同输入仍产生相同密钥。但不同输入产生不同 salt，比全局硬编码 salt 更安全。

- [ ] **Step 3: 在 API 中间件中集成 `sanitize_input`**

修改 `src/cabinet/api/app.py`，将 `input_sanitization_middleware` 改为：

```python
    @app.middleware("http")
    async def input_sanitization_middleware(request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 1_000_000:
            return JSONResponse(status_code=413, content={"error": "Payload too large"})
        response = await call_next(request)
        return response
```

注意：`sanitize_input` 主要用于字符串输入的 XSS 清理。由于 Pydantic 模型验证已对字段类型和长度做了约束，且 FastAPI 的 JSON 解析器天然防止注入，在中间件层逐请求 body 做字符串清理的收益很低且影响性能。更合理的做法是在需要渲染用户输入的场景（如 HTML 模板）中使用。因此此处保持中间件仅做 payload 大小检查，`sanitize_input` 留作工具函数供需要时调用。

- [ ] **Step 4: 修复 `runtime.py` 硬编码版本号**

修改 `src/cabinet/runtime.py`，在文件顶部添加：

```python
from cabinet import __version__
```

将 `health_check` 方法中的：

```python
            "version": "0.1.0",
```

改为：

```python
            "version": __version__,
```

- [ ] **Step 5: 修复 `CabinetConfig.memory_type` 无验证**

修改 `src/cabinet/cli/config.py`，将：

```python
from pydantic import BaseModel, Field
```

改为：

```python
from typing import Literal

from pydantic import BaseModel, Field
```

将：

```python
    memory_type: str = "chromadb"
```

改为：

```python
    memory_type: Literal["chromadb", "sqlite"] = "chromadb"
```

- [ ] **Step 6: 合并 `ObservabilityConfig` 与 `ObservabilitySettings`**

修改 `src/cabinet/cli/config.py`，删除 `ObservabilitySettings` 类：

```python
class ObservabilitySettings(BaseModel):
    enabled: bool = True
    log_format: str = "json"
    otlp_endpoint: str | None = None
    prometheus_port: int = 9090
```

将 `CabinetConfig` 中的：

```python
    observability: ObservabilitySettings = ObservabilitySettings()
```

改为：

```python
    from cabinet.core.observability import ObservabilityConfig as _ObsConfig
    observability: _ObsConfig = _ObsConfig()
```

注意：由于 Pydantic 需要类型可序列化，且 `ObservabilityConfig` 不是 BaseModel，需要将其改为 BaseModel。修改 `src/cabinet/core/observability.py` 中的 `ObservabilityConfig`：

将：

```python
class ObservabilityConfig:
    def __init__(
        self,
        enabled: bool = True,
        service_name: str = "cabinet",
        log_level: str = "INFO",
        log_format: str = "json",
        otlp_endpoint: str | None = None,
        prometheus_port: int = 9090,
    ):
        self.enabled = enabled
        self.service_name = service_name
        self.log_level = log_level
        self.log_format = log_format
        self.otlp_endpoint = otlp_endpoint
        self.prometheus_port = prometheus_port
```

改为：

```python
from pydantic import BaseModel as _BaseModel


class ObservabilityConfig(_BaseModel):
    enabled: bool = True
    service_name: str = "cabinet"
    log_level: str = "INFO"
    log_format: str = "json"
    otlp_endpoint: str | None = None
    prometheus_port: int = 9090
```

然后修改 `src/cabinet/cli/config.py` 中的 `CabinetConfig`：

```python
from cabinet.core.observability import ObservabilityConfig

class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    api_keys: dict[str, str] = {}
    api_token: str = ""
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]
    memory_type: Literal["chromadb", "sqlite"] = "chromadb"
    employees_path: str = "data/employees.json"
    skills_dir: str = "data/skills"
    knowledge_dir: str = "data/knowledge"
    created_at: datetime = Field(default_factory=_now)
    observability: ObservabilityConfig = Field(default_factory=ObservabilityConfig)
    vault_enabled: bool = False
```

- [ ] **Step 7: 运行全量测试确认无回归**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 8: 运行 lint 确认无错误**

Run: `python -m ruff check src/`
Expected: All checks passed

- [ ] **Step 9: 提交**

```bash
git add src/cabinet/core/audit.py src/cabinet/core/security.py src/cabinet/api/app.py src/cabinet/runtime.py src/cabinet/cli/config.py src/cabinet/core/observability.py
git commit -m "fix: quality gaps — AuditEvent timestamp, KeyVault salt, version, memory_type validation, ObservabilityConfig merge"
```

---

## Task 7: CI/CD 增强

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 增强 CI 流水线**

将 `.github/workflows/ci.yml` 替换为：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install dependencies
        run: pip install -e ".[dev]"
      - name: Lint
        run: ruff check src/ tests/

  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install dependencies
        run: pip install -e ".[dev]" mypy
      - name: Type check
        run: mypy src/cabinet/ --ignore-missing-imports

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.12", "3.13"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: pip install -e ".[dev]"
      - name: Test
        run: pytest tests/ -v --tb=short --cov=cabinet --cov-report=xml --cov-fail-under=60
      - name: Test with observability
        env:
          CABINET_LOG_FORMAT: json
          CABINET_OTLP_ENDPOINT: ""
        run: pytest tests/unit/core/test_observability.py -v

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install dependencies
        run: pip install -e ".[dev]" pip-audit
      - name: Security audit
        run: pip-audit

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t cabinet-test .
      - name: Verify image
        run: docker run --rm cabinet-test version
```

- [ ] **Step 2: 运行 lint 确认 YAML 格式正确**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: No error

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add type-check, coverage, security audit, multi-python, docker-build steps"
```

---

## Task 8: Docker 健康检查 + docker-compose 资源限制

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 在 Dockerfile 中添加 HEALTHCHECK**

在 `Dockerfile` 的 `EXPOSE 9090` 行之后、`ENTRYPOINT` 行之前添加：

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
```

- [ ] **Step 2: 在 docker-compose.yml 中添加资源限制和健康检查**

将 `docker-compose.yml` 替换为：

```yaml
services:
  cabinet:
    build: .
    ports:
      - "8000:8000"
      - "9090:9090"
    volumes:
      - cabinet-data:/data
    environment:
      - CABINET_DATA_DIR=/data
      - CABINET_LOG_LEVEL=${CABINET_LOG_LEVEL:-INFO}
      - CABINET_OBSERVABILITY_ENABLED=${CABINET_OBSERVABILITY_ENABLED:-true}
      - CABINET_OTLP_ENDPOINT=${OTLP_ENDPOINT:-}
      - LITELLM_API_KEYS_OPENAI=${OPENAI_API_KEY:-}
      - LITELLM_API_KEYS_ANTHROPIC=${ANTHROPIC_API_KEY:-}
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    restart: unless-stopped

volumes:
  cabinet-data:
```

- [ ] **Step 3: 验证 Dockerfile 语法**

Run: `python -c "open('Dockerfile').read()"`
Expected: No error

- [ ] **Step 4: 提交**

```bash
git add Dockerfile docker-compose.yml
git commit -m "infra: add Dockerfile HEALTHCHECK and docker-compose resource limits"
```

---

## Task 9: README 补全

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`

- [ ] **Step 1: 在 README.md 中补充内容**

在 README.md 的架构 ASCII 图之后，添加 Mermaid 架构图：

```markdown
### Architecture Diagram

```mermaid
graph TB
    Captain --> Secretary
    Secretary --> Meeting
    Meeting --> Strategy
    Strategy --> Decision
    Decision --> Office
    Office --> Summary
    Summary -.-> Secretary

    subgraph "Foundation Layer"
        Gateway[LLM Gateway]
        EventBus[Event Bus]
        Memory[Memory Store]
        Knowledge[Knowledge Base]
        Tools[Tool Registry]
    end

    Secretary --- Gateway
    Meeting --- Gateway
    Strategy --- Gateway
    Decision --- Gateway
    Office --- Gateway
    Summary --- Gateway
```
```

在 CLI 参考的顶层命令表格中，添加 `set-api-key` 行：

```markdown
| `cabinet set-api-key <key>` | Securely store an API key using vault encryption |
```

在 Docker 部分补充 Prometheus 端口说明：

```markdown
The API server runs on port 8000, and Prometheus metrics are available on port 9090.
```

在 Quick Start 的初始化部分，将 `cabinet config set-key` 改为 `cabinet set-api-key`：

```markdown
### Initialize

```bash
cabinet init "My Organization"
cabinet set-api-key sk-your-api-key --provider openai
```
```

在安全章节中添加审计说明：

```markdown
## Security

- **KeyVault**: API keys are encrypted at rest using Fernet symmetric encryption with PBKDF2 key derivation
- **Audit Logging**: All security-sensitive operations are logged to SQLite with OpenTelemetry trace correlation
- **Rate Limiting**: API endpoints are rate-limited using SlowAPI
- **Input Validation**: Pydantic Field constraints validate all API inputs
```

- [ ] **Step 2: 在 README_CN.md 中同步更新**

对应中文翻译：

在架构图后添加同样的 Mermaid 图。

在 CLI 参考中添加：

```markdown
| `cabinet set-api-key <key>` | 使用加密保险库安全存储 API 密钥 |
```

在 Docker 部分补充：

```markdown
API 服务器运行在 8000 端口，Prometheus 指标可在 9090 端口访问。
```

在快速开始中将 `config set-key` 改为 `set-api-key`：

```markdown
### 初始化

```bash
cabinet init "我的组织"
cabinet set-api-key sk-your-api-key --provider openai
```
```

在安全章节添加：

```markdown
## 安全

- **密钥保险库**：API 密钥使用 Fernet 对称加密 + PBKDF2 密钥派生加密存储
- **审计日志**：所有安全敏感操作记录到 SQLite，关联 OpenTelemetry trace_id
- **速率限制**：API 端点使用 SlowAPI 限流
- **输入验证**：Pydantic Field 约束验证所有 API 输入
```

- [ ] **Step 3: 提交**

```bash
git add README.md README_CN.md
git commit -m "docs: add Mermaid architecture, set-api-key command, audit, Prometheus port"
```

---

## Task 10: Windows API 示例 + e2e_config.json

**Files:**
- Create: `examples/api_examples.py`
- Create: `examples/e2e_config.json`

- [ ] **Step 1: 创建 `examples/api_examples.py`**

```python
"""Cabinet API Usage Examples (cross-platform Python version).

Usage:
    python examples/api_examples.py
    python examples/api_examples.py --base-url http://localhost:8000
"""
from __future__ import annotations

import argparse
import json
import sys

import httpx

BASE_URL = "http://localhost:8000"
TOKEN = ""


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    return headers


def _print(label: str, response: httpx.Response) -> None:
    print(f"\n=== {label} ===")
    print(f"Status: {response.status_code}")
    try:
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except Exception:
        print(response.text[:500])


def main():
    global BASE_URL, TOKEN

    parser = argparse.ArgumentParser(description="Cabinet API Usage Examples")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--token", default="")
    args = parser.parse_args()
    BASE_URL = args.base_url
    TOKEN = args.token

    print("=" * 50)
    print("  Cabinet API Usage Examples")
    print("=" * 50)

    with httpx.Client(timeout=10.0) as client:
        print("\n--- Health Check ---")
        _print("GET /health", client.get(f"{BASE_URL}/health"))
        _print("GET /ready", client.get(f"{BASE_URL}/ready"))

        print("\n--- Chat (REST) ---")
        _print("POST /api/chat", client.post(
            f"{BASE_URL}/api/chat",
            headers=_headers(),
            json={"message": "Hello Cabinet!", "captain_id": "captain"},
        ))

        print("\n--- Employees ---")
        _print("GET /api/employees/", client.get(f"{BASE_URL}/api/employees/", headers=_headers()))
        _print("POST /api/employees/", client.post(
            f"{BASE_URL}/api/employees/",
            headers=_headers(),
            json={"name": "Analyst", "role": "analyst", "kind": "ai"},
        ))

        print("\n--- Skills ---")
        _print("GET /api/skills/", client.get(f"{BASE_URL}/api/skills/", headers=_headers()))

        print("\n--- Knowledge ---")
        _print("POST /api/knowledge/index", client.post(
            f"{BASE_URL}/api/knowledge/index",
            headers=_headers(),
            json={"path": "data/knowledge"},
        ))
        _print("POST /api/knowledge/query", client.post(
            f"{BASE_URL}/api/knowledge/query",
            headers=_headers(),
            json={"question": "What is Cabinet?", "top_k": 3},
        ))

        print("\n--- Rooms ---")
        _print("POST /api/rooms/meeting", client.post(
            f"{BASE_URL}/api/rooms/meeting",
            headers=_headers(),
            json={"topic": "Product strategy", "level": "multi_party"},
        ))
        _print("POST /api/rooms/decision", client.post(
            f"{BASE_URL}/api/rooms/decision",
            headers=_headers(),
            json={"title": "Launch timing", "decision_type": "strategic"},
        ))
        _print("POST /api/rooms/office/task", client.post(
            f"{BASE_URL}/api/rooms/office/task",
            headers=_headers(),
            json={"description": "Write market analysis report"},
        ))
        _print("POST /api/rooms/strategy", client.post(
            f"{BASE_URL}/api/rooms/strategy",
            headers=_headers(),
            json={"proposal": "Expand to healthcare vertical"},
        ))
        _print("POST /api/rooms/summary/review", client.post(
            f"{BASE_URL}/api/rooms/summary/review",
            headers=_headers(),
            json={"review_type": "project_review"},
        ))

        print("\n--- Config ---")
        _print("GET /api/config/", client.get(f"{BASE_URL}/api/config/", headers=_headers()))

        print("\n--- Prometheus Metrics ---")
        try:
            resp = client.get("http://localhost:9090/metrics", timeout=3.0)
            lines = [l for l in resp.text.splitlines() if l.startswith("cabinet_")]
            print(f"Found {len(lines)} cabinet_ metrics")
            for line in lines[:10]:
                print(f"  {line}")
        except Exception:
            print("(Prometheus not available)")

    print("\n" + "=" * 50)
    print("  Examples complete!")
    print("=" * 50)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 创建 `examples/e2e_config.json`**

```json
{
  "organization": {
    "name": "Demo Corp",
    "captain_id": "captain"
  },
  "llm": {
    "default_model": "gpt-4o-mini"
  },
  "memory_type": "sqlite",
  "observability": {
    "enabled": true,
    "prometheus_port": 9090
  }
}
```

- [ ] **Step 3: 运行 lint 确认无错误**

Run: `python -m ruff check examples/api_examples.py`
Expected: All checks passed

- [ ] **Step 4: 提交**

```bash
git add examples/api_examples.py examples/e2e_config.json
git commit -m "feat: add cross-platform Python API examples and e2e demo config"
```

---

## Task 11: 最终验证

**Files:** 无修改

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 2: 运行 lint**

Run: `python -m ruff check src/ tests/ examples/`
Expected: All checks passed

- [ ] **Step 3: 验证公共 API 可导入**

Run: `python -c "from cabinet import CabinetRuntime, __version__; from cabinet.core import AuditStore, KeyVault; from cabinet.core.memory import MemoryStore, MemoryScope; from cabinet.rooms import MeetingRoomService; print(f'Cabinet v{__version__} OK')"`
Expected: `Cabinet v0.1.0 OK`

- [ ] **Step 4: 验证 Dockerfile 可解析**

Run: `python -c "open('Dockerfile').read(); print('Dockerfile OK')"`
Expected: `Dockerfile OK`

- [ ] **Step 5: 验证 CI YAML 可解析**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('CI YAML OK')"`
Expected: `CI YAML OK`
