# Cabinet 生产级架构改进 — 实施计划

> **Spec:** docs/superpowers/specs/2026-05-07-production-architecture-upgrade.md
> **日期:** 2026-05-07
> **总任务:** 15 tasks, 4 milestones (M1-M4)

---

## 里程碑概览

```
M1: P0 (2 tasks, 5-7天)     M2: P1 (3 tasks, 7-10天)
─────────────────────       ─────────────────────
Task 1: Token 预算           Task 3: 工具结果截断
Task 2: 熔断器               Task 4: 确定性 ACL
                             Task 5: ACL 集成

M3: P2 (2 tasks, 7-10天)     M4: P3 (3 tasks, 7-10天)
─────────────────────       ─────────────────────
Task 6: 文件 Memory           Task 8: LLM 对话摘要
Task 7: 配置层次化            Task 9: 工具并发分区
                              Task 10: 全量验证
```

---

## Task 1: Token 预算截断

**文件：**
- 新增: `src/cabinet/core/compact.py` (TokenBudget dataclass + MODEL_TOKEN_LIMITS)
- 修改: `src/cabinet/agents/llm_agent.py` (_build_messages, _trim_history)
- 修改: `src/cabinet/rooms/secretary/conversation.py` (ConversationStore max_tokens)
- 新增: `tests/unit/core/test_compact.py`

**步骤：**

- [ ] **Step 1: 创建 compact.py 中 TokenBudget**
  - 实现 `TokenBudget` dataclass: `model_max_tokens`, `reserve_ratio`, `max_input_tokens`
  - 实现 `estimate_tokens(text: str) -> int` (chars/4 快速估算)
  - 实现 `estimate_messages(messages: list[dict]) -> int`
  - 实现 `fit_messages(system_msgs, history, new_msg) -> list[dict]` (从历史头部逐条丢弃)
  - 定义 `MODEL_TOKEN_LIMITS: dict[str, int]` (覆盖 deepseek/openai/anthropic/ollama)
  - 验证: `python -c "from cabinet.core.compact import TokenBudget; print('OK')"`

- [ ] **Step 2: 编写 TokenBudget 单元测试**
  - `test_token_budget_estimation_cjk` — 中文文本估算
  - `test_token_budget_estimation_en` — 英文文本估算
  - `test_token_budget_fit_under_limit` — 无需截断
  - `test_token_budget_truncates_head` — 超出预算，丢弃旧消息
  - `test_token_budget_preserves_system` — system 消息永不被丢弃
  - `test_model_token_limits_has_deepseek` — 默认模型有配置
  - 运行: `pytest tests/unit/core/test_compact.py -v` (预期: 6 passed)

- [ ] **Step 3: 改造 LiteLLMAgent._build_messages**
  - `__init__` 新增可选参数 `max_context_tokens: int | None = None`
  - 从 `MODEL_TOKEN_LIMITS` 或参数获取 model_max
  - `_build_messages` 调用 `self._token_budget.fit_messages()`
  - `_trim_history` 改用 `fit_messages` (传空 new_msg)

- [ ] **Step 4: 改造 ConversationStore**
  - `ConversationStore.__init__` 新增 `max_tokens: int = 160_000` (替代 `max_turns=20`)
  - `get_history()` 内部用 token 预算过滤，不是硬编码 20 条

- [ ] **Step 5: 运行全量测试**
  - `pytest tests/unit/core/test_compact.py tests/unit/agents/ -v`
  - `pytest tests/unit/cli/ -v` (确保 ConversationStore 变更无回归)
  - 预期: 全部通过

- [ ] **Step 6: Commit**
  ```
  git add src/cabinet/core/compact.py src/cabinet/agents/llm_agent.py \
          src/cabinet/rooms/secretary/conversation.py tests/unit/core/test_compact.py
  git commit -m "feat(core): add token-budget-aware history trimming"
  ```

---

## Task 2: 熔断器 & 恢复机制

**文件：**
- 新增: `src/cabinet/core/resilience.py` (CircuitBreaker + retry_with_backoff + classify_error)
- 修改: `src/cabinet/agents/llm_agent.py` (_execute_with_tools 集成熔断)
- 新增: `tests/unit/core/test_resilience.py`

**步骤：**

- [ ] **Step 1: 创建 resilience.py**
  - 实现 `CircuitState` 枚举 (CLOSED, OPEN, HALF_OPEN)
  - 实现 `CircuitBreaker` dataclass:
    - `call(coro_factory, *args, **kwargs)` — 核心调用方法
    - `_should_reset()` — 超时后半开探测
  - 实现 `CircuitBreakerOpenError` 异常
  - 实现 `ErrorCategory` 枚举 (RATE_LIMIT, SERVER_ERROR, TIMEOUT, CONTEXT_OVERFLOW, FATAL)
  - 实现 `classify_error(error: Exception) -> ErrorCategory`
  - 实现 `retry_with_backoff(coro_factory, max_retries=3, base_delay=1.0)`
  - 实现 `recover_from_context_overflow(agent, messages, gateway)` (渐进丢弃 30%)
  - 验证: `python -c "from cabinet.core.resilience import CircuitBreaker; print('OK')"`

- [ ] **Step 2: 编写 resilience 单元测试**
  - `test_circuit_breaker_opens` — 3 次失败 → OPEN
  - `test_circuit_breaker_half_open` — OPEN 60s 后探测
  - `test_circuit_breaker_closes` — 探测成功 → CLOSED
  - `test_circuit_breaker_rejects_when_open` — OPEN 时拒绝调用
  - `test_retry_with_backoff_timing` — 指数退避延迟序列
  - `test_error_classification_rate_limit` — 429 正确分类
  - `test_error_classification_timeout` — timeout 正确分类
  - `test_recover_from_overflow_trims_history` — 渐进压缩
  - 运行: `pytest tests/unit/core/test_resilience.py -v` (预期: 8 passed)

- [ ] **Step 3: 集成到 LiteLLMAgent**
  - `__init__` 创建 `self._tool_breaker = CircuitBreaker(max_failures=3)`
  - `__init__` 创建 `self._api_breaker = CircuitBreaker(max_failures=5, reset_timeout=30.0)`
  - `_execute_with_tools`:
    - 外层: `self._api_breaker.call` 包裹 gateway 调用
    - 内层: `self._tool_breaker.call` 包裹单个工具执行
    - 熔断后返回 `status="error"` AgentOutput
  - 保留原有 `for _ in range(10)` 作为内层硬上限

- [ ] **Step 4: 运行全量测试**
  - `pytest tests/unit/core/test_resilience.py tests/unit/agents/ -v`
  - 预期: 全部通过，无 Agent 测试回归

- [ ] **Step 5: Commit**
  ```
  git add src/cabinet/core/resilience.py src/cabinet/agents/llm_agent.py \
          tests/unit/core/test_resilience.py
  git commit -m "feat(core): add circuit breaker, retry backoff, and context overflow recovery"
  ```

---

## Task 3: 工具结果大输出截断

**文件：**
- 修改: `src/cabinet/core/compact.py` (追加 compact_tool_result)
- 修改: `src/cabinet/agents/llm_agent.py` (_execute_tool_call)
- 修改: `tests/unit/core/test_compact.py` (追加测试)

**步骤：**

- [ ] **Step 1: 实现 compact_tool_result**
  - 在 compact.py 追加 `TOOL_RESULT_MAX_CHARS = 50_000`, `TOOL_PREVIEW_CHARS = 2_000`
  - 实现 `compact_tool_result(content, tool_name, cache_dir) -> tuple[str, str|None]`
  - 小结果原样返回；大结果写临时文件，返回 (preview + 路径)
  - Write/Edit/NotebookEdit 类工具返回摘要不写文件

- [ ] **Step 2: 追加测试**
  - `test_compact_small_result` — < 50K 不截断
  - `test_compact_large_result` — > 50K 写文件+预览
  - `test_compact_write_tool_skips_cache` — Write 工具不缓存
  - 运行: `pytest tests/unit/core/test_compact.py -v` (预期: 9 passed, 含 Task 1 的 6 个)

- [ ] **Step 3: 集成到 _execute_tool_call**
  - 在返回结果前调用 `compact_tool_result()`
  - 结果字典增加 `truncated: bool` 字段

- [ ] **Step 4: Commit**
  ```
  git add src/cabinet/core/compact.py src/cabinet/agents/llm_agent.py \
          tests/unit/core/test_compact.py
  git commit -m "feat(core): add tool result compaction for large outputs"
  ```

---

## Task 4: 确定性 ACL 引擎

**文件：**
- 修改: `src/cabinet/core/auth.py` (追加 AccessControlList, PermissionRule, Decision)
- 新增: `tests/unit/core/test_acl.py`

**步骤：**

- [ ] **Step 1: 扩展 auth.py**
  - 新增 `Decision` 枚举 (ALLOW, DENY, ASK, ESCALATE)
  - 新增 `PermissionRule` dataclass (role, resource, action, decision, reason, priority)
  - 新增 `AccessControlList` 类:
    - `check(role, resource, action) -> PermissionRule | None`
    - `_match(pattern, value)` 支持 `*` 和前后缀通配符（如 `"tool:*"`, `"*bash*"`）
  - 定义 `DEFAULT_RULES` (6 条规则覆盖 captain/admin/editor/viewer 4 角色)
  - 保留原有 `Role`, `Permission`, `ROLE_PERMISSIONS`, `has_permission()` 不变 (API 层仍使用)

- [ ] **Step 2: 编写 ACL 测试**
  - `test_acl_exact_match` — captain → room:meeting → ALLOW
  - `test_acl_wildcard_resource` — editor → tool:bash → ASK
  - `test_acl_wildcard_all` — viewer → * → write → DENY
  - `test_acl_priority` — 高优先级规则覆盖低优先级
  - `test_acl_no_match_returns_none` — 无规则 → None (触发升级)
  - `test_acl_match_role_star` — `*` 角色通配
  - 运行: `pytest tests/unit/core/test_acl.py -v` (预期: 6 passed)

- [ ] **Step 3: Commit**
  ```
  git add src/cabinet/core/auth.py tests/unit/core/test_acl.py
  git commit -m "feat(core): add deterministic ACL with deny-first graduated trust"
  ```

---

## Task 5: ACL 集成到 Office/Decision Room

**文件：**
- 修改: `src/cabinet/rooms/office/service.py` (check_permission 集成 ACL)
- 修改: `src/cabinet/rooms/decision/service.py` (check_authorization 集成 ACL)
- 新增: `tests/unit/rooms/test_office_acl.py`

**步骤：**

- [ ] **Step 1: 改造 OfficeSchedulerService.check_permission**
  - `__init__` 新增可选参数 `acl: AccessControlList | None = None`
  - `check_permission()`:
    1. 先走 ACL 确定性检查
    2. ALLOW → return True
    3. DENY → 记录审计日志 → return False
    4. ASK → raise `ConfirmationRequired` (由 TUI/API 层处理)
    5. None (无规则) → 记录审计日志 → 升级到 LLM 回退

- [ ] **Step 2: 同样改造 DecisionRoomService.check_authorization**
  - 同上模式

- [ ] **Step 3: 编写集成测试**
  - `test_office_acl_allows_captain` — captain 直接通过
  - `test_office_acl_denies_viewer` — viewer 直接拒绝
  - `test_office_acl_asks_editor_bash` — editor 执行 bash 需要确认
  - `test_office_acl_fallback_to_llm` — 无规则时升级到 LLM
  - 运行: `pytest tests/unit/rooms/ -v` (预期: 新增 4 passed, 无回归)

- [ ] **Step 4: Commit**
  ```
  git add src/cabinet/rooms/office/service.py src/cabinet/rooms/decision/service.py \
          tests/unit/rooms/test_office_acl.py
  git commit -m "feat(rooms): integrate deterministic ACL into Office and Decision rooms"
  ```

---

## Task 6: 文件型 Memory 后端

**文件：**
- 新增: `src/cabinet/core/memory/file_store.py` (FileMemoryItem + FileMemoryStore)
- 新增: `tests/unit/core/test_file_memory.py`
- 修改: `src/cabinet/cli/main.py` (_init_runtime 初始化 FileMemoryStore)

**步骤：**

- [ ] **Step 1: 创建 file_store.py**
  - 实现 `FileMemoryItem` dataclass (name, description, type, content, filepath)
  - 实现 `FileMemoryItem.from_file(path)` 解析 YAML frontmatter
  - 实现 `FileMemoryItem.to_markdown()` 序列化
  - 实现 `FileMemoryStore`:
    - `store(item) -> Path` 写文件 + 重建索引
    - `list_headers() -> list[dict]` 扫描所有 .md 文件的 frontmatter
    - `get(name, type) -> FileMemoryItem | None`
    - `delete(name, type)` 删除 + 重建索引
    - `_rebuild_index()` 生成 MEMORY.md
  - 目录结构: `{base_dir}/memory/{type}/{name}.md`
  - 验证: `python -c "from cabinet.core.memory.file_store import FileMemoryStore; print('OK')"`

- [ ] **Step 2: 编写测试**
  - `test_file_store_and_retrieve` — tmpdir 中完整往返
  - `test_file_list_headers` — 扫描多个文件头部
  - `test_file_frontmatter_parsing` — YAML 解析+回写
  - `test_file_delete_and_rebuild` — 删除后索引重建
  - `test_file_memory_index_created` — MEMORY.md 自动生成
  - 运行: `pytest tests/unit/core/test_file_memory.py -v` (预期: 5 passed)

- [ ] **Step 3: 集成到 runtime**
  - `main.py` 中 `_init_runtime` 创建 `FileMemoryStore`
  - 存入 `runtime` 属性 `file_memory` (或在 kwargs 中传递)
  - 不替代现有 `MemoryStore`，作为独立补充

- [ ] **Step 4: Commit**
  ```
  git add src/cabinet/core/memory/file_store.py src/cabinet/cli/main.py \
          tests/unit/core/test_file_memory.py
  git commit -m "feat(memory): add filesystem-first FileMemoryStore with YAML frontmatter"
  ```

---

## Task 7: 配置层次化

**文件：**
- 修改: `src/cabinet/cli/config.py` (load_config_hierarchical, _deep_merge)
- 修改: `tests/unit/cli/test_config.py` (追加层次化测试)
- 修改: `.gitignore` (追加 cabinet.local.json)

**步骤：**

- [ ] **Step 1: 实现层次化加载**
  - 实现 `_deep_merge(base, override)` 递归合并
  - 实现 `_default_config_dict()` 返回内置默认值
  - 实现 `load_config_hierarchical(data_dir)` 4 层叠加
  - 保留原有 `load_config()` 作为兼容（内部调用新函数）

- [ ] **Step 2: 更新 .gitignore**
  - 追加条目: `data/cabinet.local.json`

- [ ] **Step 3: 编写测试**
  - `test_load_config_default_only` — 无文件 → 默认值
  - `test_load_config_project_override` — 项目文件覆盖默认值
  - `test_load_config_local_override` — 本地文件覆盖项目
  - `test_load_config_deep_merge` — 嵌套字典递归合并
  - `test_load_config_original_still_works` — load_config() 向后兼容
  - 运行: `pytest tests/unit/cli/test_config.py -v` (预期: 原测试 + 5 passed)

- [ ] **Step 4: Commit**
  ```
  git add src/cabinet/cli/config.py .gitignore tests/unit/cli/test_config.py
  git commit -m "feat(cli): add 4-layer hierarchical config loading (default→user→project→local)"
  ```

---

## Task 8: LLM 对话摘要压缩

**文件：**
- 修改: `src/cabinet/core/compact.py` (追加 SessionMemory, ContextCompactor, summarize_with_llm)
- 修改: `src/cabinet/agents/llm_agent.py` (_maybe_compact)
- 修改: `tests/unit/core/test_compact.py` (追加摘要测试)

**步骤：**

- [ ] **Step 1: 实现 SessionMemory**
  - `SessionMemory` dataclass (summary, key_decisions, pending_tasks, updated_at, token_count)
  - `is_fresh` 属性 (5 分钟过期)
  - `load(path)` / `save(path)` 使用 YAML 持久化

- [ ] **Step 2: 实现 ContextCompactor**
  - `summarize_with_llm(history, gateway)` — <analysis> + <summary> 提示词
  - `format_history(history)` — 格式化对话为摘要输入 (每条截断 500 chars)
  - `ContextCompactor.compact(history, budget)`:
    - Path A: 读取 SessionMemory → 新鲜则复用
    - Path B: LLM 摘要 → 保存 SessionMemory
    - 3 次连续失败 → 返回占位文本

- [ ] **Step 3: 集成到 LiteLLMAgent**
  - `__init__` 新增 `enable_compaction` 和 `session_dir` 参数
  - 新增 `_maybe_compact(messages)` 方法:
    - token 预算 < 85% 时触发
    - 返回 summary 注入为 system 消息

- [ ] **Step 4: 编写测试**
  - `test_summarize_extracts_summary_tag` — 正确提取 <summary>
  - `test_summarize_fallback_no_tags` — 无标签时返回截断文本
  - `test_session_memory_load_save` — 持久化往返
  - `test_session_memory_stale_check` — 过期检测
  - `test_compactor_circuit_breaker` — 3 次失败熔断
  - 运行: `pytest tests/unit/core/test_compact.py -v` (预期: 14 passed)

- [ ] **Step 5: Commit**
  ```
  git add src/cabinet/core/compact.py src/cabinet/agents/llm_agent.py \
          tests/unit/core/test_compact.py
  git commit -m "feat(core): add LLM-based dialogue summarization with session memory reuse"
  ```

---

## Task 9: 工具并发安全分区

**文件：**
- 修改: `src/cabinet/agents/tools.py` (追加 CONCURRENT_SAFE_TOOLS, EXCLUSIVE_TOOLS, partition_tool_calls)
- 修改: `src/cabinet/agents/llm_agent.py` (_execute_with_tools_partitioned)
- 修改: `tests/unit/agents/test_llm_agent.py` (追加分区测试)

**步骤：**

- [ ] **Step 1: 扩展 tools.py**
  - 定义 `CONCURRENT_SAFE_TOOLS: set[str]` (Read, Grep, Glob, WebSearch, WebFetch, TodoRead, TodoWrite)
  - 定义 `EXCLUSIVE_TOOLS: set[str]` (Bash, Write, Edit, NotebookEdit)
  - 实现 `is_concurrency_safe(tool_name) -> bool`
  - 实现 `partition_tool_calls(tool_calls) -> list[list]`:
    - 排他工具独占一个分区
    - 连续安全工具合并到一个分区
    - 例如: [Read, Grep, Bash, Glob] → [[Read, Grep], [Bash], [Glob]]

- [ ] **Step 2: 编写分区测试**
  - `test_partition_mixed_tools` — [Read, Grep, Bash, Glob] → 3 分区
  - `test_partition_all_safe` — 全安全 → 1 分区
  - `test_partition_all_exclusive` — 全排他 → 各自独立
  - `test_partition_empty` — 空列表
  - `test_is_concurrency_safe_read` — Read 是安全的
  - `test_is_concurrency_safe_bash` — Bash 不是安全的
  - 运行: `pytest tests/unit/agents/test_llm_agent.py::test_partition* -v` (预期: 6 passed)

- [ ] **Step 3: 集成到 LiteLLMAgent**
  - 新增 `_execute_with_tools_partitioned()` 方法
  - 排他分区串行，安全分区 `asyncio.gather()` 并行
  - `return_exceptions=True` 确保单个工具失败不影响同分区其他工具
  - 保留原有串行方法作为回退 (feature flag 控制)

- [ ] **Step 4: Commit**
  ```
  git add src/cabinet/agents/tools.py src/cabinet/agents/llm_agent.py \
          tests/unit/agents/test_llm_agent.py
  git commit -m "feat(agents): add concurrent/partitioned tool execution with safety classification"
  ```

---

## Task 10: 全量集成验证

**文件：** 无生产代码变更

**步骤：**

- [ ] **Step 1: 运行全量测试**
  ```
  pytest tests/ -q --tb=line
  ```
  预期: ~1050 passed, 0 failures

- [ ] **Step 2: 运行 lint**
  ```
  python -m ruff check src/cabinet/core/ tests/unit/core/
  python -m ruff check src/cabinet/agents/ tests/unit/agents/
  python -m ruff check src/cabinet/cli/ tests/unit/cli/
  python -m ruff check src/cabinet/rooms/ tests/unit/rooms/
  ```
  预期: All checks passed

- [ ] **Step 3: 验证所有新模块导入**
  ```
  python -c "
  from cabinet.core.compact import TokenBudget, compact_tool_result, SessionMemory, ContextCompactor
  from cabinet.core.resilience import CircuitBreaker, retry_with_backoff, classify_error
  from cabinet.core.memory.file_store import FileMemoryStore, FileMemoryItem
  from cabinet.core.auth import AccessControlList, PermissionRule, Decision
  print('All imports OK')
  "
  ```
  预期: All imports OK

- [ ] **Step 4: 验证 LiteLLMAgent 向后兼容**
  - 使用默认参数创建 Agent → 行为不变
  - 原有测试全部通过 (test_llm_agent)

- [ ] **Step 5: Commit**
  ```
  git add -A
  git commit -m "chore: full integration verification for production architecture upgrade"
  ```

---

## 文件变更汇总

```
新增 (8):
  src/cabinet/core/compact.py
  src/cabinet/core/resilience.py
  src/cabinet/core/memory/file_store.py
  tests/unit/core/test_compact.py
  tests/unit/core/test_resilience.py
  tests/unit/core/test_acl.py
  tests/unit/core/test_file_memory.py
  tests/unit/rooms/test_office_acl.py

修改 (12):
  src/cabinet/core/auth.py
  src/cabinet/agents/llm_agent.py
  src/cabinet/agents/tools.py
  src/cabinet/cli/config.py
  src/cabinet/cli/main.py
  src/cabinet/rooms/secretary/conversation.py
  src/cabinet/rooms/office/service.py
  src/cabinet/rooms/decision/service.py
  tests/unit/agents/test_llm_agent.py
  tests/unit/cli/test_config.py
  tests/unit/core/test_compact.py (追加)
  .gitignore

预计: +1200 行生产代码, +700 行测试代码
```

---

## 执行约束

- 每个 Task 一个 commit，格式: `feat(module): ...` 或 `chore: ...`
- 实施前阅读相关源文件
- 使用 git worktree 隔离工作
- P0 完成后创建 M1 标签，P1 完成后 M2，类推
- 每个 Task 的 Step 3-4（集成+全量测试）为强制检查点
