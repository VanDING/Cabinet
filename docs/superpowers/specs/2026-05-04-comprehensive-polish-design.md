# 全面打磨 + 发布准备 — 设计规格

> 日期: 2026-05-04
> 状态: Draft
> 范围: 质量收尾 + CI/CD + Docker完善 + 文档 + 示例完善

## 背景

经过多轮迭代（基础层 → 集成层 → 增强层），Cabinet 项目已具备完整的六房间架构、事件溯源、LLM 网关、可观测性、安全、审计、CLI、REST API、Docker 部署等能力。但在发布前仍有关键问题、质量缺口和基础设施不足需要解决。

## 实施策略：分层递进

| 层级 | 内容 | 前置依赖 |
|------|------|----------|
| L1 质量收尾 | 4个关键问题 + 7个质量缺口 | 无 |
| L2 基础设施完善 | CI/CD增强 + Docker健康检查 + 资源限制 | L1 |
| L3 文档示例完善 | README补全 + Windows API示例 + e2e_config.json | L1 |

---

## L1 质量收尾

### 1.1 修复 CLI 命令冲突：`set-api-key` vs `config set-key`

**问题**: `set-api-key` 使用 KeyVault 加密存储，`config set-key` 明文存储。两者做同一件事但行为不同，用户困惑且安全功能形同虚设。

**方案**:
- `config set-key` 标记 `deprecated=True`，内部改为调用 KeyVault 加密逻辑
- 保留 `config set-key` 作为别名，执行时输出弃用警告指向 `set-api-key`
- `set-api-key` 成为唯一的安全入口
- 迁移逻辑：在 `_init_runtime` 启动时，扫描配置中的 API key，如果检测到明文存储（无 `vault:` 前缀），自动用 KeyVault 重新加密并替换原值，输出 `logger.info("migrated plaintext API key to vault encryption")`

**涉及文件**:
- `src/cabinet/cli/main.py` — 修改 `config set-key` 命令实现
- `tests/unit/cli/test_main.py` — 补充 `set-api-key` 测试 + `config set-key` 弃用测试

### 1.2 修复审计日志静默失败

**问题**: `deps.py` 中 `except Exception: pass` 吞掉审计失败；`runtime.py` 中 `db_path=None` 时审计静默失效。

**方案**:
- `deps.py`: 将 `except Exception: pass` 改为 `except Exception: logger.warning("audit log write failed", exc_info=True)`
- `runtime.py`: 当 `db_path=None` 时输出 `logger.info("audit disabled: no db_path configured")`
- 审计失败不中断请求，但留下日志痕迹

**涉及文件**:
- `src/cabinet/api/deps.py` — 修改异常处理
- `src/cabinet/runtime.py` — 添加审计禁用日志

### 1.3 修复 `test_serve_creates_memory_store` 测试失败

**问题**: 测试导入 `_serve_async` 不存在，实际代码使用内联 `_create_and_serve`。

**方案**:
- 重构 `serve` 命令，提取 `_init_runtime` 为模块级函数（已部分存在）
- 测试改为直接测试 `_init_runtime` 函数
- 补充 `set-api-key` 命令测试用例

**涉及文件**:
- `src/cabinet/cli/main.py` — 确认 `_init_runtime` 可独立调用
- `tests/unit/cli/test_main.py` — 重写测试

### 1.4 补充 `__init__.py` 公共 API 导出

**问题**: 所有子包 `__init__.py` 为空，用户无法简洁导入，公共 API 无显式定义。

**方案**: 为每个子包定义 `__all__`，导出核心公共类：

| 包 | 导出 |
|---|---|
| `cabinet` | `CabinetRuntime`, `CabinetConfig`, `__version__` |
| `cabinet.core` | `AuditStore`, `AuditEvent`, `KeyVault`, `sanitize_input`, `ObservabilityConfig` |
| `cabinet.core.memory` | `MemoryStore`, `SQLiteMemoryStore`, `ChromaDBMemoryStore`, `MemoryScope` |
| `cabinet.core.events` | `EventBus`, `SQLiteEventStore`, `Event` |
| `cabinet.core.gateway` | `LiteLLMRouterGateway` |
| `cabinet.core.knowledge` | `LocalKnowledgeBase` |
| `cabinet.core.tools` | `ToolRegistry`, `MCPConnector`, `SkillStore` |
| `cabinet.core.workflow` | `WorkflowEngine` |
| `cabinet.models` | `Decision`, `Organization`, `Project` |
| `cabinet.agents` | `LiteLLMAgent`, `AgentFactory`, `StubAgentFactory` |
| `cabinet.rooms` | 6个房间 Service 类 |

**涉及文件**: 所有 `src/cabinet/**/__init__.py`

### 1.5 消除重复代码

**问题**: `e2e_workflow.py` / `tutorial.py` / `_init_runtime` 三处重复的 runtime 初始化逻辑。

**方案**:
- 创建 `examples/_shared.py`，提取 `setup_runtime()` 公共函数
- `e2e_workflow.py` 和 `tutorial.py` 改为 `from _shared import setup_runtime`
- CLI 的 `_init_runtime` 保留（参数处理不同），但内部复用共享的工厂逻辑

**涉及文件**:
- `examples/_shared.py` — 新建
- `examples/e2e_workflow.py` — 重构
- `examples/tutorial.py` — 重构

### 1.6 修复其他质量缺口

| # | 问题 | 修复 | 涉及文件 |
|---|------|------|----------|
| a | `AuditEvent.timestamp` 可变默认值 | 改为 `Field(default_factory=lambda: datetime.now(timezone.utc))` | `core/audit.py` |
| b | `KeyVault` 硬编码 salt | 将随机 salt 存储在加密文件头部 | `core/security.py` |
| c | `sanitize_input` 未使用 | 在 API 中间件中集成 | `api/app.py` |
| d | `ReviewType` 枚举不一致 | 统一为实际定义值，更新示例 | `examples/e2e_workflow.py` |
| e | `runtime.py` 硬编码版本号 | 从 `cabinet.__version__` 导入 | `runtime.py` |
| f | `CabinetConfig.memory_type` 无验证 | 改为 `Literal["chromadb", "sqlite"]` | `cli/config.py` |
| g | `ObservabilityConfig` 与 `ObservabilitySettings` 重复 | 合并为单一 `ObservabilityConfig`，删除 `ObservabilitySettings` | `core/observability.py`, `cli/config.py` |

---

## L2 基础设施完善

### 2.1 CI/CD 增强

**当前状态**: `ci.yml` 仅有 lint + test 两步。

**增强后流程**:
```
lint (ruff) → type-check (mypy) → test (pytest + cov) → security (pip-audit) → docker-build
```

| 步骤 | 命令 | 说明 |
|------|------|------|
| lint | `ruff check src/ tests/` | 已有 |
| type-check | `mypy src/cabinet/ --ignore-missing-imports` | 新增 |
| test | `pytest --cov=cabinet --cov-report=xml --cov-fail-under=60` | 增加覆盖率 |
| security | `pip-audit` | 新增 |
| docker-build | `docker build -t cabinet-test .` | 新增，验证构建 |

**多版本矩阵**: Python 3.12 + 3.13

**涉及文件**: `.github/workflows/ci.yml`

### 2.2 Dockerfile 健康检查

**方案**: 添加 `HEALTHCHECK` 指令，使用 Python（slim 镜像无 curl）：

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
```

**涉及文件**: `Dockerfile`

### 2.3 docker-compose 资源限制

**方案**:

```yaml
services:
  cabinet:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

**涉及文件**: `docker-compose.yml`

---

## L3 文档 + 示例完善

### 3.1 README 补全

**补充项**:

| 项目 | 内容 |
|------|------|
| 架构图 | Mermaid 六房间架构图 |
| Prometheus 端口 | 部署说明中补充 9090 端口 |
| `set-api-key` 命令 | CLI 参考中补充 |
| 审计功能 | 安全章节中补充 |
| `memory_type` 可选值 | 配置说明中补充 |

README.md 和 README_CN.md 同步更新。

**涉及文件**: `README.md`, `README_CN.md`

### 3.2 Windows API 示例

**方案**: 创建 `examples/api_examples.py`，使用 Python + `httpx` 实现与 `api_examples.sh` 相同的 API 调用流程。跨平台兼容，项目已有 `httpx` 作为 dev 依赖。

**涉及文件**: `examples/api_examples.py` — 新建

### 3.3 补充 `e2e_config.json`

**方案**: 创建 `examples/e2e_config.json`，包含预配置的演示用组织信息。`e2e_workflow.py` 和 `tutorial.py` 的 `setup_runtime` 优先读取此配置文件。

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

**涉及文件**: `examples/e2e_config.json` — 新建, `examples/_shared.py` — 更新

---

## 验证标准

| 层级 | 验证方式 |
|------|----------|
| L1 | 全部测试通过 + ruff 零错误 + 公共 API 可导入 |
| L2 | CI 流水线全绿 + Docker 构建成功 + 健康检查通过 |
| L3 | README 渲染正确 + api_examples.py 可执行 + e2e_config.json 可加载 |
