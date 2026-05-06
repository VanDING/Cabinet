# Code Review Fixes Design

> 基于 2026-05-07 全面代码审查的13项修复方案

## 分组策略

同文件修改合并处理，分为4个实施组：

### 组 A — 安全与认证（3项修复）

**A1: P0#1 — RBAC `require_permission` 应用到写路由**

文件：`api/deps.py`, `api/routes/*.py`（8个路由文件）

- 在 `require_permission` 函数中增加对 admin-only 的判断
- 在每个写操作路由上添加 `_perm: dict = Depends(require_permission("write"))`
- 读操作路由保持仅需 `get_current_user`（认证即可）
- DELETE 类操作使用 `require_permission("admin")`
- 路由权限对照：
  - `POST /api/employees` → write
  - `POST /api/employees/{id}/skills/{sid}` → write
  - `POST /api/skills/load`, `POST /api/skills/{name}/run` → write
  - `POST /api/knowledge/index` → write
  - `POST /api/rooms/*` → write
  - `POST /api/config/*` → admin
  - `POST /api/workflows/*` → write
  - `POST /api/agents/*` → write
  - `POST /api/chat` → read（读所有角色可用）

**A2: P0#2 — WebSocket 多 token RBAC**

文件：`api/routes/chat.py`

- 提取 `_verify_token` 函数到 `api/deps.py`，供 HTTP 和 WebSocket 共用
- `_verify_token(token, config)` 返回 `dict | None`（user dict 或 None）
- WebSocket 连接时统一调用 `_verify_token` 替代当前仅比对 `config.api_token`
- 无 token 且 `config.auth_required` 时断开连接

**A3: P2#10 — `EmployeeCreate.kind` 加枚举约束**

文件：`api/models.py`

- `kind: str = "ai"` → `kind: Literal["ai", "human"] = "ai"`

---

### 组 B — 架构修复（4项修复）

**B1: P1#3 — `HumanApprovalNode` 超时机制**

文件：`core/workflow/engine.py`, `models/workflows.py`

- `HumanApprovalNode` 新增字段：`timeout: int | None = None`（秒），`timeout_strategy: str = "escalate"`
- 在 `_execute_graph` 中 HumanApprovalNode 暂停时，记录暂停时间戳到 `pause_info`
- 在 `resume_workflow` 中检查是否超时：若超时，按 strategy 执行（escalate → 返回 escalated 标记；default → 返回默认输出；skip → 跳转到下一节点）
- 不在此迭代中为暂停的工作流添加自动超时唤醒机制（需要后台定时任务，超出本次修复范围）

**B2: P1#4 — `cascade()` 事件溯源纯度**

文件：`rooms/decision/service.py`

- 删除 `cascade()` 中的 `self._decisions[parent_id] = decision`（第381行）
- parent decision 的状态转换由 `_apply_event(DecisionCascaded)` 处理
- 在 `_apply_event` 中增加对 parent decision 的状态更新（将父决策标记为已级联处理）

**B3: P1#5 — 两套 Agent 编排系统定位明确**

文件：`DESIGN.md`

- 在 DESIGN.md 中添加 section："Agent 编排模式"
- 明确两条路径的关系：
  - **Room 编排**（主路径）：所有用户可见任务通过 Six-Room 模型流转
  - **AgentPool + Mailbox + Handoff**（辅助路径）：Agent 在执行过程中需要自主协作时使用（例如一个 Agent 发现需要另一个 Agent 的专业知识）
  - AgentPool 作为 Agent 实例的缓存层，减少重复 LLM Agent 创建
- 保留两套系统，但约束 Handoff 仅限于 Agent 间自主触发，不绕过 Room 调度

**B4: P2#6 — AgentPool 接入 Room Service**

文件：`runtime.py`, `rooms/*/service.py`（6个）, `agents/pool.py`

- `LLMAgentFactory` 增加 `pool: AgentPool | None` 参数
- `LLMAgentFactory.create_agent()` 在 pool 非 None 时优先通过 pool 获取空闲 Agent
- Room Service 通过 factory 间接使用 pool（而非直接依赖 pool），保持依赖方向正确
- 如果 pool 无可用的 Agent，回退到直接创建（当前行为）
- `AgentPool.acquire()` 完成后自动执行 task，release 由调用方负责
- 流式调用（`Secretary.process_input_stream`）不使用 pool，因为流式 Agent 的生命周期不同

---

### 组 C — 可观测性与类型（3项修复）

**C1: P2#7 — 审计日志覆盖关键操作**

文件：`rooms/*/service.py`, `core/audit.py`, `api/deps.py`

- `AuditStore.log()` 增加便利方法 `log_sync(action, actor, resource_type, resource_id, **kwargs)` 用于非异步上下文
- 在以下操作添加审计日志：
  - `DecisionRoomService.approve()` / `reject()` / `delegate()` — 记录决策变更
  - `EmployeeStore.add()` — 员工创建（需要 audit_store 注入）
  - `employee.create_employee()` API handler 中调用 audit
  - `config.set-api-key` — 已在 CLI 中有日志，API 端点补充
- 审计日志中 trace_id 由 TraceInjectingFilter 自动注入

**C2: P2#8 — `agent_factory: object` 类型标注修正**

文件：`rooms/*/service.py`（6个）, `rooms/*/protocol.py`

- 所有 `agent_factory: object` → `agent_factory: AgentFactory`（从 `agents.protocol` 导入）
- `escalation_protocol: object` → 在 `harness/escalation.py` 中已有 `EscalationProtocol` Protocol
- `verification_gate: object` → `VerificationGate`（从 `harness/protocol.py` 导入）
- `workflow_engine: object` → 直接用 `WorkflowEngine` 类
- `handoff_manager: object` → 直接用 `HandoffManager` 类
- 如果引发循环导入，使用 `TYPE_CHECKING` + 字符串注解

**C3: P2#9 — `WORKFLOW_EXECUTION` Metrics 打点**

文件：`core/workflow/engine.py`

- `WorkflowEngine.run()` 入口记录 `start_time`
- 结束前（正常完成/暂停/取消/超时）记录 `WORKFLOW_EXECUTION.observe(duration)`
- 用 workflow.kind 作为标签

---

### 组 D — 清理与补全（3项修复）

**D1: P3#11 — 审计 `_row_to_event` 旧 schema 清理**

文件：`core/audit.py`

- 移除 `len(row) > 8` 检查，简化为直接按索引读取
- 当前 migration 已到 v007，所有部署的 audit_log 表都应包含完整列

**D2: P3#12 — KeyVault `_derive_key` 随机盐**

文件：`core/security.py`

- `_derive_key` 不再使用 `hashlib.sha256(material)` 作为确定性盐
- 改为：从 `os.urandom(16)` 生成随机盐，并将盐持久化到 key_file 旁（`key_file + ".salt"`）
- 如果 key_file 不存在且提供了 salt_file，则读取已持久化的盐
- `encrypt()` 方法保持现有逻辑不变（每次加密已带随机 salt）
- 影响：需要迁移旧 key file。在 `KeyVault.__init__` 中检测旧格式 key file（44字符直接可用的 Fernet key），将其转为新格式（添加 salt 文件）
- 向后兼容：如果 key_file 内容恰好是 44 字符 base64（Fernet.generate_key() 的输出），直接使用无需派生，不产生 salt

**D3: P3#13 — 补充边界测试**

文件：`tests/unit/core/workflow/test_engine.py`（新建或补充），`tests/unit/core/events/test_asyncio_bus_fault.py`（补充），`tests/unit/models/test_decisions.py`（补充）

- Workflow 空节点测试：传入 nodes=[] 的 Workflow，期望 ValueError
- LoopNode 0 次迭代测试：max_iterations=0，期望立即返回空结果
- HumanApprovalNode 无响应测试：验证超时行为
- EventBus 无 handler 发布测试：验证不报错、消息正确存储
- Decision 状态转换合法性测试：验证非法转换被拒绝

---

## 实施顺序

1. **组 D**（清理先行，测试加固）→ 约 30 分钟
2. **组 C**（可观测性 + 类型，影响面小）→ 约 40 分钟
3. **组 B**（架构修复，核心逻辑变更）→ 约 60 分钟
4. **组 A**（安全，最后加锁确保前面修改已稳定）→ 约 40 分钟

总计约 20 个文件修改，预估 2.5-3 小时。

## 验证检查清单

- [ ] `pytest tests/ -v` 全部通过
- [ ] `ruff check src/ tests/` 无新增错误
- [ ] `curl -X POST /api/employees` 带 viewer token → 403
- [ ] `curl -X POST /api/employees` 带 editor token → 201
- [ ] WebSocket `/api/chat/ws?token=<multi_token>` → 连接成功
- [ ] `curl -X POST /api/employees -d '{"name":"x","role":"y","kind":"alien"}'` → 422
- [ ] 工作流含 HumanApprovalNode + timeout=1 → 1秒后自动降级
- [ ] `http://localhost:9090/metrics` 包含 `cabinet_workflow_duration_seconds`
- [ ] `KeyVault._derive_key` 生成随机 salt 文件
- [ ] 决策批准后在 audit.db 中有对应审计记录
- [ ] `mypy src/cabinet/rooms/` 无 `object` 类型警告
