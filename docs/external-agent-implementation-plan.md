# Cabinet v3.2 外部 Agent 平台化 — 实施计划

> 基于 [external-agent-integration-v3.md](external-agent-integration-v3.md)
> 每项任务标注：**文件**、**改动类型**（新建/修改/删除）、**依赖**、**验收标准**

---

## Phase 1：基础设施对齐 + 内部简化（1-2 周）

**目标**：现有代码准备好接纳外部 Agent，内部组件清理完毕。

### 1.1 Agent 类型扩展

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|:---|
| 1.1.1 | 扩展 `AgentSource` 类型 | `packages/types/src/primitives.ts` | 修改 | 增加 `'external_a2a' \| 'external_cli'` |
| 1.1.2 | `AgentRole` 增加 `external?` 字段 | `packages/agent/src/agent-roles.ts` | 修改 | 见方案 §3.2，包含 `protocol`、`configSource`、`command`、`detectCommand` 等 |
| 1.1.3 | Agent 目录扫描扩展 | `apps/server/src/context.ts` | 修改 | 在现有 `~/.cabinet/agents/` 扫描中识别 `source: external_*` 的 agent.json |
| 1.1.4 | AgentRoleRepository 兼容新字段 | `packages/storage/src/repositories/agent-role-repo.ts` | 修改 | `upsert()` 存储 external 配置 JSON |
| 1.1.5 | IntentParser 路由感知外部 Agent | `packages/secretary/src/intent-parser.ts` | 修改 | 将外部 Agent 的 capabilities 注册为 Skill 到 SkillRegistry；`routeToAgent()` 的候选池包含 `external_*` 类型 Agent |

**验收**：编写一个测试用 `agent.json` 放入 `~/.cabinet/agents/test-agent/`，重启后 `AgentRoleRegistry.list()` 包含该 Agent，`type === 'external_cli'`。IntentParser 对匹配的 capability 返回该 Agent。

### 1.2 Context Slot 实现

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|:---|
| 1.2.1 | 定义 `ContextSlot` 接口 | `packages/types/src/primitives.ts` | 修改 | `{ project, memories, preferences, files, discoveries, previous_outputs, deliverable, security }` |
| 1.2.2 | Session 增加 `contextSlot` 字段 | `packages/secretary/src/session-manager.ts` | 修改 | `Session` 接口加 `contextSlot?: ContextSlot`，增加 `setContextSlot()` / `getContextSlot()` 方法 |
| 1.2.3 | Secretary 初始化 Slot | `apps/server/src/routes/secretary.ts` | 修改 | 在路由到外部 Agent 前，调用 `initializeContextSlot()` 收集记忆/项目/偏好 |

**验收**：单元测试——创建子 Session，设置 Slot，读取 Slot，字段完整。

### 1.3 Agent 节点统一化

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 1.3.1 | `WorkflowNodeType` 废弃 `external_agent` | `packages/types/src/primitives.ts` | 修改 | 只保留 `'agent'`，删除 `'external_agent'`（如果存在） |
| 1.3.2 | `AgentNodeDef` 增加 `agentId` 字段 | `packages/types/src/primitives.ts` | 修改 | Agent 节点通过 `agentId` 引用任意 Agent |
| 1.3.3 | WorkflowEngine Handler 适配统一节点 | `packages/workflow/src/engine.ts` | 修改 | `executeNode()` 中根据 `agentId` 查找 AgentRole，区分 internal vs external 走不同执行路径 |

**验收**：Workflow 定义中用 `type: 'agent', agentId: 'claude-code-v1'` 创建节点，引擎能正确识别为外部 Agent（当前走 stub 路径，完整实现在 Phase 2）。

### 1.4 移除和简化

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 1.4.1 | 移除 Meeting Agent 引用 | `apps/server/src/context.ts` | 修改 | 删除 Meeting 相关的 handler 注册和路由 |
| 1.4.2 | 移除 Meeting 路由 | `apps/server/src/routes/meetings.ts` | 删除 | 整个文件可删除或在路由注册中注释 |
| 1.4.3 | Provider 分层简化 | `apps/server/src/context.ts` | 修改 | `PROVIDER_TIER_MAP` → `PROVIDER_DEFAULT_MODEL`，每个 provider 只保留一个默认模型 |
| 1.4.4 | 废弃 `ModelRouter` 引用 | `apps/server/src/context.ts` | 修改 | 如果存在独立使用，移除；如果被 AISDKAdapter 内部使用，标记 `@deprecated` |
| 1.4.5 | 废弃 AutoAdjuster 模型切换 | `packages/harness/src/auto-adjuster.ts` | 修改 | 移除模型切换逻辑，保留 budget 检查 |
| 1.4.6 | 废弃 ToolPruner | `apps/server/src/context.ts` | 修改 | 移除 `toolPruner` 的实例化和传入 AgentLoop 的引用 |
| 1.4.7 | 移除内部 Specialist Agent 角色定义 | `packages/agent/src/agent-roles.ts` | 修改 | 移除除 Secretary / Curator / Organize 之外的内置 Agent 角色（如各种 Specialist 角色定义和对应的 `AgentRoleType` 常量） |
| 1.4.8 | Context Slot + External Config 数据库迁移 | `packages/storage/src/` | 修改 | `sessions` 表增加 `context_slot TEXT`；`agent_roles` 表增加 `external_config TEXT` |

**验收**：
- 启动无 Meeting 相关报错
- Gateway 初始化只使用 `PROVIDER_DEFAULT_MODEL`
- `AutoAdjuster.runHealthCheck()` 不再尝试切换模型
- `AgentRoleRegistry.list()` 不包含已移除的 Specialist 角色
- 数据库表包含新列
- 现有测试全部通过（`pnpm test`）

### 1.5 安全组件扩展

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 1.5.1 | `ClassificationInput` 增加 `agentTrustLevel` | `packages/decision/src/level-classifier.ts` | 修改 | 可选字段，高信任度 Agent 可降一级 |
| 1.5.2 | `PolicyEngine` 增加 `external_agent_sandbox` mission | `packages/decision/src/policy-engine.ts` | 修改 | 默认受限：外部 Agent 的 L2 操作需审批 |
| 1.5.3 | `SafetyChecker` 增加外部操作类型感知 | `packages/agent/src/safety.ts` | 修改 | 区分命令执行 vs 文件读写 vs API 调用 |
| 1.5.4 | `BudgetGuard` + `CostTracker` 接收外部 Agent 消耗 | `packages/gateway/` + `apps/server/src/context.ts` | 修改 | TelemetryStore 中外部 Agent 的 token 消耗通过 `CostTracker.recordExternal()` 纳入预算检查 |

**验收**：单元测试——外部 Agent 的 L2 操作触发 `require_approval`，内部 Agent 同级别操作可能 `allow`。外部 Agent 上报 token 后 `BudgetGuard.canProceed()` 反映消耗。

---

## Phase 2：A2A + CLI Adapter 并行开发（2-3 周）

**目标**：两个 Agent（一个 A2A，一个 CLI）能完成完整任务闭环。

**Phase 2 的前置依赖**：Phase 1 全部完成。

### 2.1 Adapter 基础设施

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 2.1.1 | 创建 Adapter 类型定义 | `packages/agent/src/adapters/types.ts` | **新建** | `ExternalAgentAdapter` 接口、`ExternalTask`、`ExternalTaskResult`、`CliAgentConfig`、`A2AAgentConfig` |
| 2.1.2 | 创建 Adapter 索引 | `packages/agent/src/adapters/index.ts` | **新建** | 导出所有 adapter 类型和实现 |

### 2.2 CLI Adapter 实现

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 2.2.1 | 实现 CliAdapter | `packages/agent/src/adapters/cli-adapter.ts` | **新建** | 配置驱动的通用 CLI Adapter。`detect()` / `install()` / `dispatchTask()` |
| 2.2.2 | 实现 Prompt 渲染 | 同上 | 新建 | `renderPrompt(slot, task)` → 方案 §5.3.1 的模板 |
| 2.2.3 | 实现输出解析 | 同上 | 新建 | `parseOutput(stdout)` → 方案 §5.3.2 的分隔符协议 |
| 2.2.4 | 集成到 AgentRoleRegistry | `packages/agent/src/agent-roles.ts` | 修改 | `external_cli` 类型 Agent 自动创建 CliAdapter 实例 |
| 2.2.5 | CliAdapter 进程生命周期管理 | 同上 | 新建 | `dispatchTask()` 中设置 timeout 定时器，超时后 `proc.kill('SIGTERM')`；监听 `exit` 事件清理资源；stderr 捕获到日志（不解析但保留用于调试） |
| 2.2.6 | detect/install 调用时机 | `packages/agent/src/adapters/cli-adapter.ts` + `apps/server/src/context.ts` | 新建 | 启动时对所有 `external_cli` Agent 调用 `detect()` 更新 online/offline 状态；每 60s 定时检测维持状态；手动注册时先 `detect()`，未安装则提示执行 `install()` |

**验收**：`new CliAdapter({ command: 'echo', args: [] }).dispatchTask(...)` → 返回结构化 `ExternalTaskResult`。超时配置生效（模拟长时间命令）→ 进程被 kill + 返回 `status: 'failed'`。

### 2.3 A2A Connector 实现

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 2.3.1 | 实现 A2AConnector | `packages/agent/src/adapters/a2a-connector.ts` | **新建** | HTTP 客户端：`discoverCapabilities()`、`dispatchTask()`、`cancelTask()`、`getTaskStatus()` |
| 2.3.2 | 实现能力发现 | 同上 | 新建 | `GET /.well-known/agent.json` → `AgentCapability[]` |
| 2.3.3 | 实现 WebSocket 客户端 | 同上 | 新建 | 连接 Cabinet WebSocket 端点，监听审批通知，发送状态同步 |

**验收**：启动一个模拟 A2A Agent（用一个简单 Express 服务实现 `/.well-known/agent.json` + `/a2a/tasks`），Cabinet 发现并成功分派任务。

### 2.4 外部 Agent HTTP API

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 2.4.1 | Slot 回写 API | `apps/server/src/routes/external-agent.ts` | **新建** | `POST /api/slot/:taskId/write`——Agent 回写 discoveries |
| 2.4.2 | Decision 推送 API | 同上 | 新建 | `POST /api/decisions`（扩展已有 `decisions.ts` 或在此新建，支持 `source.agent_id`） |
| 2.4.3 | Deliverable 提交 API | 同上 | 新建 | `POST /api/deliverables`（扩展已有 `deliverables.ts`） |
| 2.4.4 | 遥测上报 API | `apps/server/src/routes/telemetry.ts` | **新建** | `POST /api/telemetry/report`，写入 TelemetryStore |
| 2.4.5 | 注册路由 | `apps/server/src/context.ts` | 修改 | 挂载新路由 |
| 2.4.6 | 外部 Agent API 认证 | `apps/server/src/routes/external-agent.ts` | 新建 | 任务分派时生成一次性 `task_token`（HMAC，绑定 task_id + 有效期），Agent 在后续 API 调用中通过 `Authorization: Bearer <task_token>` 携带。也可在 Agent 注册时分配永久 `agent_api_key`。Cabinet 验证 token → 确认 Agent 身份 → 限制只能操作自己的 task/session |

**验收**：`curl -X POST /api/slot/task-001/write -H "Authorization: Bearer <valid_token>"` → 200 OK。无 token 或错误 token → 401 Unauthorized。Token 属于其他 task → 403 Forbidden。

### 2.5 TelemetryStore

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 2.5.1 | TelemetryRepository | `packages/storage/src/repositories/telemetry-repo.ts` | **新建** | `insert()`、`findByAgent()`、`findByTask()`、`getStats()` |
| 2.5.2 | 数据库迁移 | `packages/storage/src/` | 修改 | 新增 `agent_telemetry` 表：`task_id, agent_id, model, prompt_tokens, completion_tokens, ttft_ms, total_ms, tool_latency_json, steps, status, created_at` |
| 2.5.3 | TelemetryStore 注册到 ServerContext | `apps/server/src/context.ts` | 修改 | 实例化并加入 `ctx` |
| 2.5.4 | TelemetryStore → CostTracker 同步 | `apps/server/src/context.ts` | 修改 | 外部 Agent 遥测写入时，同步调用 `CostTracker.recordExternal()` 将 token 消耗纳入预算检查 |

**验收**：上报一条遥测 → 数据库可查询 → `getStats()` 返回正确的聚合数据 → `CostTracker.getDailyCost()` 包含外部 Agent 消耗。

### 2.6 WebSocket 扩展

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 2.6.1 | Agent 事件通道 | `apps/server/src/ws/handler.ts` | 修改 | 新增 `agent_event` 消息类型，A2A Agent 连接后订阅其 `task_id` 相关事件 |
| 2.6.2 | 审批结果推送 | 同上 | 修改 | Captain 审批后 → WebSocket push 给 Agent（如果 Agent 在线），同时尝试 HTTP callback（回退） |

**验收**：Agent 通过 WebSocket 连接 Cabinet → Captain 审批 Decision → Agent 收到 `decision_result` 事件。

### 2.7 端到端集成

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 2.7.1 | Secretary → Adapter 调度 | `apps/server/src/routes/secretary.ts` | 修改 | IntentParser 路由到外部 Agent 时 → 创建子 Session → 初始化 Slot → 调用 `adapter.dispatchTask()` |
| 2.7.2 | 交付物注入父 Session | `apps/server/src/context.ts` | 修改 | `AgentEventBus` 的 `notifyParent` 回调——已有机制（[context.ts:2239-2254](apps/server/src/context.ts#L2239-L2254)），确认外部 Agent 路径可用 |
| 2.7.3 | Curator 消费 Slot | `apps/server/src/context.ts` | 修改 | 子 Session 关闭回调中，读取 `Slot.discoveries` → `LongTermMemory` |
| 2.7.4 | Secretary 多 Agent 结果合成 | `apps/server/src/routes/secretary.ts` | 修改 | 多个外部 Agent 并行调度完成后 → 收集各 Agent 的 `deliverable` + Slot 内容 → 调用 Secretary AgentLoop 执行 synthesis prompt → 合成统一回复返回给 Captain |

**验收**：Captain 在对话中说"帮我审查这段代码" → Secretary 路由到 Codex（A2A mock）→ 子 Session 创建 → 任务分派 → Agent 返回结果 → 交付物注入父 Session → Captain 看到结果。两个 Agent 并行 → Secretary 合成两个结果后返回统一回复。

### 2.8 Agent 管理面板 UI

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|:---|
| 2.8.1 | Agent 管理页面 | `apps/desktop/src/pages/AgentManagerPage.tsx` | **新建** | 列表展示已注册 Agent：名称、类型标签、online/offline/busy 状态、配置源、能力标签 |
| 2.8.2 | Agent 操作按钮 | 同上 | 新建 | [打开终端]（跳转 AgentShell）、[分配任务]（打开任务对话框）、[查看遥测]（跳转 RuntimeDashboard）、[配置]（编辑 Agent 配置）、[停用/启用] |

**验收**：Dashboard 侧边栏增加"Agent 管理"入口 → 点击进入 → 看到所有已注册 Agent 及其状态 → 点击配置可编辑 external 字段。

### 2.9 任务可靠性基础设施

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|:---|
| 2.9.1 | 任务幂等守卫 | `packages/agent/src/adapters/task-reliability.ts` | **新建** | `taskIdempotencyGuard(task_id)`——分派前检查 `task_id` 是否已存在，重复分派返回已有结果或恢复执行 |
| 2.9.2 | 审批回调重试 | 同上 | 新建 | `approvalCallbackWithRetry(callbackUrl, decision, maxRetries=3)`——指数退避通知 Agent 审批结果；Agent 回 ACK；未收到 ACK 则重试，3 次后标记 `stale` |
| 2.9.3 | 超时+崩溃状态机 | `packages/agent/src/adapters/task-reliability.ts` | 新建 | 任务状态转换：`running → error`（超时/崩溃）→ `awaiting_recovery`（断连但可恢复）→ `failed`（不可恢复）。状态变更通过 AgentEventBus 发布 |

**验收**：重复分派同一 `task_id` → 返回已有结果。审批回调模拟网络失败 → 重试 3 次后标记 stale → Captain 收到通知。

---

## Phase 3：终端集成 + Workflow 扩展（2-3 周）

**目标**：Captain 能在 Cabinet 内操作 CLI Agent，Workflow 支持外部 Agent 节点。

**Phase 3 的前置依赖**：Phase 2 全部完成。

### 3.1 嵌入式终端

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 3.1.1 | Tauri PTY 后端 | `apps/desktop/src-tauri/src/pty.rs` | **新建** | `portable-pty` 创建伪终端，spawn CLI Agent，双向 IPC |
| 3.1.2 | Tauri Command 注册 | `apps/desktop/src-tauri/src/main.rs` | 修改 | 注册 `pty_spawn`、`pty_write`、`pty_resize`、`pty_kill` 命令 |
| 3.1.3 | xterm.js 终端组件 | `apps/desktop/src/components/AgentShell.tsx` | **新建** | React 组件：`xterm.js` + `xterm-addon-fit`，与 PTY 通过 IPC 双向绑定 |
| 3.1.4 | 命令拦截集成 | 同上 | 新建 | **架构路径**：前端 AgentShell 在 PTY write 前检查输入 → 匹配高风险模式（`rm -rf`、`sudo`、`chmod 777` 等）→ 通过 IPC 调用 Tauri command `check_command_safety` → Rust 侧调用 `POST /api/decisions`（内部 HTTP 或直接调用 DecisionService）→ Captain 在 Dashboard 审批 → 审批结果通过 WebSocket 返回前端 → 批准后前端写入 PTY，拒绝则显示拦截提示 |
| 3.1.5 | Agent 选择器 | `apps/desktop/src/components/AgentShell.tsx` | 新建 | 下拉切换已注册的 CLI Agent（从 `AgentRoleRegistry` 读取） |
| 3.1.6 | 交付物提取 | 同上 | 新建 | 选中终端文本 → "提交为交付物"按钮 → `POST /api/deliverables` |
| 3.1.7 | Slot 写入 | 同上 | 新建 | 选中终端输出 → "写入 Slot"按钮 → `POST /api/slot/{task_id}/write` → 写入 `discoveries` 或 `previous_outputs`（供后续 Agent 消费） |

**验收**：打开 Agent Shell → 选择 Claude Code → 终端中出现 `claude` 交互界面 → 输入 prompt → 看到 Claude Code 输出 → 选中输出 → 提交为交付物 → Dashboard Deliverables Widget 出现新条目。

### 3.2 Workflow Agent 节点完整实现

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 3.2.1 | `WorkflowHandlers` 增加 `dispatchToExternalAgent` | `packages/workflow/src/engine.ts` | 修改 | 在 `WorkflowHandlers` 接口新增：`dispatchToExternalAgent?: (agentId: string, task: { runId, nodeId, input, previousOutputs, slot }) => Promise<{status, output?, decisionId?}>`。`executeNode()` 中 agent 分支根据 `AgentRole.type` 分发：`builtin/custom` → `createAgentLoop`；`external_*` → `dispatchToExternalAgent` |
| 3.2.2 | Slot 分叉/合并 | `packages/workflow/src/engine.ts` | 修改 | `WHEN` 并行节点：`forkSlot()` → 各分支独立 Slot → `mergeSlots()` 合并 |
| 3.2.3 | Agent 节点交付物自动流转 | `packages/workflow/src/engine.ts` | 修改 | 外部 Agent 完成后 → `DeliverableRepo.save()` → Slot 写入 → 下一节点 `previousOutputs` 可用 |

**验收**：创建 Workflow：`Start → Agent(claude-code) → Agent(cursor-review) → End`。执行后 claude-code 的输出自动成为 cursor-review 的上下文。

### 3.3 EL 表达式解析器（核心子集）

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 3.3.1 | 安装 PEG.js | `packages/workflow/package.json` | 修改 | `npm install pegjs`（或手写递归下降，视复杂度决定） |
| 3.3.2 | EL 语法定义 | `packages/workflow/src/el-grammar.pegjs` | **新建** | `THEN`、`WHEN`、`IF`/`ELIF`/`ELSE`、`SWITCH` 的 PEG 语法 |
| 3.3.3 | EL → StateGraph 编译器 | `packages/workflow/src/el-compiler.ts` | **新建** | 解析 EL 表达式 → 生成 `{ nodes, edges, entryNodeId }` → `StateGraph.compile()` |
| 3.3.4 | BlueprintParser 支持 EL | `packages/organize/src/blueprint-parser.ts` | 修改 | 解析 YAML 蓝图中的 `el:` 字段 → 调用 EL 编译器 |

**验收**：`THEN(agentA, WHEN(agentB, agentC), agentD)` → 编译为合法的 StateGraph → `startRun()` 正常执行。

**Phase 3 范围约束**：`FOR`/`WHILE` 循环和嵌套 chain 不在本阶段交付（移入 Phase 5）。

### 3.4 Runtime Dashboard + Activity Feed

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 3.4.1 | Activity Feed 组件 | `apps/desktop/src/components/ActivityFeed.tsx` | **新建** | 实时展示：任务完成、Discoveries 回写、Decision 推送、遥测摘要 |
| 3.4.2 | Runtime Dashboard | `apps/desktop/src/pages/RuntimeDashboard.tsx` | **新建** | 按 Agent 聚合：调用次数、成功率、TTFT 趋势、TPS、工具延迟分布 |
| 3.4.3 | WebSocket 订阅 | 同上 | 新建 | 订阅 `agent_event` → 实时更新 Dashboard 数据 |

**验收**：执行一个外部 Agent 任务 → Activity Feed 出现事件 → Runtime Dashboard 更新遥测图表。

---

## Phase 4：标准化 + 热加载 + 文档（1-2 周）

**目标**：第三方开发者可按文档创建兼容 Agent。

**Phase 4 的前置依赖**：Phase 3 全部完成。

### 4.1 Agent Manifest Schema

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 4.1.1 | JSON Schema 定义 | `packages/agent/src/adapters/agent-manifest.schema.json` | **新建** | Agent 声明的标准 JSON Schema（包含 A2A 和 CLI 两种模式的所有字段） |
| 4.1.2 | Manifest 验证器 | `packages/agent/src/adapters/manifest-validator.ts` | **新建** | `validateManifest(json)` → `{ ok, errors }` |

### 4.2 规则热加载

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 4.2.1 | 蓝图文件 watcher | `apps/server/src/watchers.ts` | 修改 | 已有 `startProjectWatcher`，扩展为监听蓝图文件变更 |
| 4.2.2 | 热加载流程 | `apps/server/src/context.ts` | 修改 | watcher 检测变更 → `BlueprintValidator.validate()` → 通过 → 更新 WorkflowEngine 中的已编译 Graph |

### 4.3 外部 Agent SDK

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 4.3.1 | SDK 包初始化 | `packages/agent-sdk/` | **新建** | `@cabinet/agent-sdk` npm 包，供第三方 Agent 开发者使用。包含 `package.json`、`tsconfig.json`、构建脚本 |
| 4.3.2 | SDK 类型导出 | `packages/agent-sdk/src/types.ts` | **新建** | 重新导出 `@cabinet/types` 中第三方开发者需要的类型：`ContextSlot`、`ExternalTask`、`ExternalTaskResult`、`AgentCapability`、`CliAgentConfig`、`AgentEvent`、`Decision` |
| 4.3.3 | A2A Helper | `packages/agent-sdk/src/a2a-helper.ts` | **新建** | 帮助外部 Agent 快速实现 `/.well-known/agent.json` + `/a2a/tasks` + WebSocket 连接 |
| 4.3.4 | Slot Client | `packages/agent-sdk/src/slot-client.ts` | **新建** | 封装 `POST /api/slot/:id/write`、读取 Slot、认证 token 管理的客户端库 |

### 4.4 文档

| # | 任务 | 文件 | 类型 | 说明 |
|:---|:---|:---|:---|
| 4.4.1 | 外部 Agent 开发者指南 | `docs/external-agent-guide.md` | **新建** | 如何创建兼容 Agent：A2A 方式、CLI 方式、Manifest 编写、分隔符协议 |
| 4.4.2 | API 参考 | `docs/external-agent-api.md` | **新建** | 所有 REST API 端点详述 |
| 4.4.3 | 蓝图 EL 语法参考 | `docs/blueprint-el-reference.md` | **新建** | EL 表达式完整语法文档 |

---

## Phase 5（后续）：EL 完整语法 + 循环

**前置依赖**：Phase 4 全部完成。

| # | 任务 | 文件 | 类型 | 预估 |
|:---|:---|:---|:---|:---|
| 5.1 | `FOR` 循环支持 | `packages/graph/src/state-graph.ts` + `packages/workflow/src/el-compiler.ts` | 修改 | 1 周 |
| 5.2 | `WHILE` 循环支持 | 同上 | 修改 | 3-4 天 |
| 5.3 | 嵌套 chain / subflow | `packages/workflow/src/engine.ts` | 修改 | 1 周 |
| 5.4 | 语法错误位置提示 | `packages/workflow/src/el-compiler.ts` | 修改 | 2-3 天 |
| 5.5 | IDE 补全（VSCode 扩展） | 新建 | 新建 | 可选，1-2 周 |

---

## 依赖关系总览

```
Phase 1 (基础设施 + 内部简化)
  │  1.1 Agent类型 │ 1.2 Slot │ 1.3 节点统一化 │ 1.4 移除简化 │ 1.5 安全扩展
  │  含: IntentParser路由、Specialist移除、DB迁移、BudgetGuard集成
  │
  └──→ Phase 2 (Adapter + API + UI + 可靠性)
         │  2.1 Adapter基础设施 │ 2.2 CLI Adapter │ 2.3 A2A Connector
         │  2.4 HTTP API + 认证 │ 2.5 TelemetryStore │ 2.6 WebSocket
         │  2.7 端到端集成 │ 2.8 Agent管理UI │ 2.9 任务可靠性
         │
         ├──→ Phase 3 (终端 + Workflow + EL Core + Dashboard)
         │      3.1 嵌入式终端(含命令拦截+Slot写入)
         │      3.2 Workflow Agent节点(含WorkflowHandlers扩展)
         │      3.3 EL核心子集 │ 3.4 Dashboard
         │      │
         │      └──→ Phase 4 (标准化 + 热加载 + SDK + 文档)
         │            4.1 Manifest Schema │ 4.2 热加载
         │            4.3 Agent SDK(含类型导出) │ 4.4 文档
         │            │
         │            └──→ Phase 5 (EL完整语法 + 循环)
         │
         └──→ Phase 3 中的终端部分可独立于 Workflow 部分开发
```

## 新增任务统计

| 阶段 | 原有任务数 | 新增任务数 | 总任务数 |
|:---|:---|:---|:---|
| Phase 1 | 16 | 4 (① ② ③ ⑭) | 20 |
| Phase 2 | 17 | 10 (④ ⑤ ⑥ ⑦ ⑧ ⑬ + 2.5.4 + 2.8.x2 + 2.9.x3) | 27 |
| Phase 3 | 13 | 2 (⑨ ⑪ + ⑩修正) | 15 |
| Phase 4 | 8 | 1 (⑫) | 9 |
| Phase 5 | 5 | 0 | 5 |
| **总计** | **59** | **17** | **76** |

## 关键风险

| 风险 | 等级 | 缓解 |
|:---|:---|:---|
| Claude Code CLI 行为变更导致分隔符协议失效 | 中 | `parseOutput` 有降级策略（无分隔符时返回完整 stdout） |
| A2A 协议规范更新与当前实现不兼容 | 低 | A2A Connector 与协议版本解耦，升级时仅改 HTTP 请求格式 |
| EL 解析器开发超期 | 中 | Phase 3 只做 THEN/WHEN/IF/SWITCH，复杂语法延后到 Phase 5 |
| Tauri PTY 在不同平台的兼容性问题 | 中 | Phase 3 先支持 macOS/Windows，Linux 后续适配 |
| 多外部 Agent 并发时的 Slot 合并冲突 | 低 | 分叉/合并策略（设计 §4.6）已覆盖，追加而非覆盖 |
| 外部 API 认证 token 泄露 | 中 | task_token 绑定 task_id + 有效期 + HMAC 签名，泄露后影响范围有限 |
| 命令拦截误杀正常输入 | 低 | 拦截规则基于可配置的模式列表，支持 Captain 临时 bypass |
| CLI 进程僵尸累积 | 低 | 定时清理 + `proc.kill` + exit 事件监听 + 超时强制 SIGKILL |

## 总时间线

| 阶段 | 时间 | 累计 | 任务数 |
|:---|:---|:---|:---|
| Phase 1 | 第 1-2 周 | 2 周 | 20 |
| Phase 2 | 第 3-5 周 | 5 周 | 27 |
| Phase 3 | 第 6-8 周 | 8 周 | 15 |
| Phase 4 | 第 9-10 周 | 10 周 | 9 |
| Phase 5 | 第 11-13 周 | 13 周 | 5 |

**总计：约 3 个月达到完整可用状态**（Phase 1-4，76 项任务），+3 周达到 EL 完整语法（Phase 5）。
