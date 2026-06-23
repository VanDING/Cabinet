# Cabinet V10 系统化清理与补全计划

> 基于 V9 迁移后全面审计结果，按系统依赖顺序逐层清理、逐层重建。
> 原则：先清理后重建，先底层后上层，先删除后连接。每一步做完再做下一步。

---

## 第一阶段：删除残留构建物

> 四个应删除的包（workflow / gateway / events / harness）源码已删，但 dist/、node_modules/、tsconfig.tsbuildinfo 残留。
> 彻底删除目录；同步清理 tsconfig.json、vitest.workspace.ts、tools/arch-lint.ts、pnpm-workspace.yaml 中的引用。

### 1.1 删除四个废弃包目录

```
rm -rf packages/workflow
rm -rf packages/gateway
rm -rf packages/events
rm -rf packages/harness
```

### 1.2 清理 tsconfig.json 引用

移除 `packages/events`, `packages/gateway`, `packages/workflow`, `packages/harness` 四个 path reference。

### 1.3 清理 vitest.workspace.ts 引用

移除四个废弃包的 workspace 路径。

### 1.4 清理 tools/arch-lint.ts 引用

移除 `@cabinet/events`, `@cabinet/gateway`, `@cabinet/workflow`, `@cabinet/harness` 的层级定义。

### 验证

```
pnpm typecheck   # 零错误
pnpm lint        # 零错误
```

---

## 第二阶段：修复残余代码引用

> 删除源码中指向已删除包的导入、评论引用和死参数。

### 2.1 修复 tests/bench/performance.test.ts

- 移除 `import { MemoryEventBus } from '@cabinet/events'`
- 替换为 `apps/server/src/context/event-bus.ts` 的 `EventBus`（或本地创建独立实例）
- 移除 `/api/secretary/chat` 测试（端点已不存在）或改为 Mastra agent API

### 2.2 修复 apps/desktop/src/types/agent-events.ts:2

```
// 原注释：Frontend-local mirror of AgentEvent from @cabinet/events
// 改为：Frontend-local mirror of AgentEvent type
```

### 2.3 修复 packages/storage/src/system-knowledge-base.ts:413

文档注释中 `@cabinet/harness` → 移除或改为 `Mastra Observability`

### 2.4 清理 apps/server/src/routes/agents.ts 的 A2A 死代码

- `/message` POST (行 258-302)：删除整个 "migrated to Mastra" 的假响应逻辑，改为直接返回 503 "Service migrated"
- `/message/stream` POST (行 304-357)：同上，删除无用 Stream 逻辑
- 移除无用的 `a2aTasks` Map（仅 A2A 流任务使用，该路径已死）

### 2.5 清理 apps/server/src/context/memory.ts 的 dead gateway 参数

`gateway: null` → 如果 MemoryFacade 构造函数允许省略该参数则移除；否则保留但加注释说明。

### 2.6 清理 apps/server/src/lsp/indexer.ts 的 dead gateway 引用

检查 `gateway` 参数的所有引用，若始终为 null 则移除该参数及相关死路径。

### 2.7 修复 apps/server/src/routes/external-agent.ts 的方法缺失

`/api/external/decisions` GET → 若前端确实需要 GET，添加 `externalAgentRouter.get('/decisions', ...)`。

### 2.8 移除 apps/server/src/routes/dashboard.ts 中对已废弃 capabilities 的常量引用

检查 `DAILY_BUDGET`, `WEEKLY_BUDGET`, `MONTHLY_BUDGET` 是否仍在 `@cabinet/types` 中导出，若已迁移到 Mastra CostGuard 则移除或用新常量替换。

### 验证

```
pnpm typecheck
pnpm lint
pnpm -r test  # 确保所有测试通过
```

---

## 第三阶段：消除双重系统 — 统一到 Mastra

> 当前 Mastra Memory / Cabinet Memory、Mastra Observability / Cabinet Telemetry 双重运行。
> 保留 Data 层（@cabinet/storage repos），移除冗余的初始化逻辑。

### 3.1 审查 Mastra Memory 与 Cabinet Memory 的职责边界

当前状态 (`apps/server/src/context/build-context.ts`)：

- `initMemoryFacade(state)` → 创建 Cabinet `MemoryFacade`（STM/LTM/KG/Decay/Consolidation）
- `initKnowledgeAndSubconscious(state)` → 创建 `KnowledgeGraph`、`MemoryDecayService`
- `mastra/index.ts` → 创建 Mastra `Memory`（LibSQL + Vector + observational + working + semantic）

**决策点**：Mastra Memory 的 `observationalMemory` 和 `semanticRecall` 提供了"从对话中提取模式和语义搜索"能力。Cabinet 的 `KnowledgeGraph` 提供了"实体关系建模和矛盾检测"能力（V9 确认为不可替代）。两者互补而非重复。

**操作**：

- 保留两者的并行初始化（职责不同）
- 在 `context/memory.ts` 中移除 `gateway: null` 参数（已在 2.5 中处理）
- 确保 Mastra Memory 的 `workingMemory.template` 能读取 Cabinet 的 `project` 上下文

### 3.2 清理旧的 TelemetryRepository

当前 (`apps/server/src/context/assembly.ts:59`)：

```typescript
const telemetryRepo = new TelemetryRepository(db);
```

**操作**：

- 从 `assembly.ts` 和 `context/types.ts` 中移除 `telemetryRepo` 的创建和类型声明
- 前端调用的 `/api/telemetry/trends` 改为读取 Mastra Storage 中的数据
- 保留 `packages/storage/src/repositories/telemetry-repo.ts`（Data 层无妨），但从服务上下文中解绑

### 3.3 统一 EventBus

当前有两个事件系统：

- `EventBus`（`apps/server/src/context/event-bus.ts`）→ Cabinet 本地实现
- Mastra Signals → 框架自带

**操作**：

- 保留 `EventBus` 作为 Cabinet 业务事件总线（decision/comments/project/skill 等）
- Mastra Signals 仅用于 Agent 内部事件
- 确保 `EventBus` 不再引用 `@cabinet/events`（已删除源）

### 验证

```
pnpm typecheck
pnpm build
```

---

## 第四阶段：重建 API 路由层 — 连接前后端

> 这是最关键的阶段。逐模块重建前后端之间的断裂连接。

### 4.1 核心对话端点 — `/api/secretary`

**现状**：前端调用 `/api/secretary/chat`，Mastra 自动生成 `/api/agents/secretary/*`。

**方案 A（推荐 — 最小改动）**：创建 `/api/secretary` 路由薄代理到 Mastra agent API。

```typescript
// apps/server/src/routes/secretary.ts（新建）
// 或在 index.ts 中直接代理

// POST /api/secretary/chat
//   → 调用 mastra.getAgent('secretary').generate()
//   → 返回 SSE stream

// POST /api/secretary/subagent/input
//   → 委托到 mastra agent 的 sub-agent 交互

// GET /api/secretary/context
//   → 从 Mastra thread 获取上下文

// POST /api/secretary/compact
//   → 调用 Mastra 的 context compression

// GET /api/secretary/sessions/:id/children
// POST /api/secretary/sessions/:id/close
//   → 查询 Mastra storage 中的 thread 数据
```

**需要调研**：Mastra `@mastra/hono` 的 `MastraServer` 已在 `main.ts` 中注册（`/api` 前缀），确认其自动生成的路由格式，决定是适配前端路径还是修改前端 API 调用地址。

**推荐最终路径**：修改前端 `ChatContext.tsx` 中的 API 调用地址，从 `/api/secretary/*` 改为 `/api/agents/secretary/*`（Mastra 原生路由），同时后端在 `index.ts` 中注册 fallback 路由映射旧路径到新路径，保持兼容。

### 4.2 工作流端点 — `/api/factory`

**现状**：前端调用 `/api/factory/*`（工作流编辑管理），Mastra 自动生成 `/api/workflows/*`（工作流执行）。

**操作**：

- 创建 `/api/factory` 路由器，代理到 Mastra workflow API
- 或修改前端 `FactoryPage.tsx`、`WorkflowsPage.tsx`、`ActiveWorkflowsModal.tsx` 的 API 调用地址

**具体端点**：

```
GET  /api/factory?projectId=     → GET  /api/workflows
POST /api/factory                 → POST /api/workflows
PUT  /api/factory/:id             → PUT  /api/workflows/:id
DELETE /api/factory/:id           → DELETE /api/workflows/:id
GET  /api/factory/:id/runs        → GET  /api/workflows/:id/runs
POST /api/factory/:id/run         → POST /api/workflows/:id/execute
```

### 4.3 守护进程端点 — `/api/daemon`

**现状**：数据层完整（`AgentDaemonRepository`、`AgentTaskQueueRepository`），WebSocket 连接管理完整（`DaemonConnectionManager`），唯独 HTTP API 路由缺失。

**操作**：

- 创建 `apps/server/src/routes/daemon.ts`
- 使用已有的 repository 查询数据
- 在 `apps/server/src/index.ts` 中注册路由

```typescript
GET  /api/daemon/status           → daemonRepo.getHeartbeats()
GET  /api/daemon/tasks            → taskQueueRepo.listAll()
GET  /api/daemon/ports            → daemonRepo.getPorts()
POST /api/daemon/tasks/:id/cancel → taskQueueRepo.cancel(id)
POST /api/daemon/ports/orphans/:port/kill → daemonRepo.killPort(port)
```

### 4.4 评估端点 — `/api/evaluations`

**操作**：

- 创建 `apps/server/src/routes/evaluations.ts`
- 集成 Mastra `@mastra/evals` 的 Scorer，读取已有的 `packages/storage/src/repositories/evaluation-result-repo.ts`
- 注册到 `index.ts`

```typescript
GET /api/evaluations         → evaluationResultRepo.findAll()
GET /api/evaluations/summary → evaluationResultRepo.getSummary()
```

### 4.5 进度端点 — `/api/progress`

**操作**：

- 创建 `apps/server/src/routes/progress.ts`
- 使用 `WorkflowRepository` 查询工作流运行状态来生成进度数据
- 注册到 `index.ts`

### 4.6 洞察端点 — `/api/insights`

**操作**：

- 使用 Mastra `ObservationalMemory` 的 observer 提取的洞察
- 或从 `MemoryFacade` 的 `harness_insight` 类型查询
- 注册到 `index.ts`

### 4.7 Harness 端点 — `/api/harness/overview`

**操作**：

- 创建该端点，聚合当前系统状态（agent 数、task 数、port 状态等）
- 或将此 UI 组件改为不依赖独立 API，直接使用 daemon + dashboard 的现有数据

### 4.8 遥测端点 — `/api/telemetry/trends`

**操作**：

- 改为查询 Mastra Storage 中的数据（通过 `@mastra/observability` 的 `MastraStorageExporter` 持久化的 traces）
- 或在 `dashboard.ts` 中扩展现有的 `/trends` 端点

### 4.9 维护端点 — `/api/gc/scan`

**操作**：

- 创建简单的 GC 端点（清理过期 session、过期 checkpoint 等）

### 验证

```
pnpm typecheck
pnpm build
pnpm --filter @cabinet/server test
# 启动服务器，用 curl 验证每个新端点
```

---

## 第五阶段：重建 WebSocket 事件

### 5.1 在对应路由中添加缺失的 broadcast 调用

| 事件                   | 应触发位置                                      |
| ---------------------- | ----------------------------------------------- |
| `workflow_started`     | Mastra workflow execute 步骤 / factory run 端点 |
| `workflow_completed`   | Mastra workflow complete 回调                   |
| `task_updated`         | scheduler.ts task execute 完成时                |
| `budget_alert`         | dashboard.ts cost-history 中当成本超过预算时    |
| `quality_alert`        | evaluations.ts 评分低于阈值时                   |
| `subconscious_insight` | Mastra observationalMemory observer 提取洞察时  |
| `memory_contradiction` | knowledge.ts detectContradictions 结果有矛盾时  |
| `agent_updated`        | agents.ts agent config 修改时                   |

### 验证

用 WebSocket 客户端连接，逐一触发事件确认前端收到。

---

## 第六阶段：削减保留的 packages

> 执行 V9 计划中未完成的 packages 削减。

### 6.1 削减 @cabinet/agent

当前 25+ 文件 → 目标 ~500 行（safety + projector + process-identity）。

**保留**：

- `src/projector/` — 9 个外部 agent 适配器（aider, claude-code, cline, codex, gemini-cli, glm, kimi, opencode, qwen-code）。这是 Cabinet 独有能力，V9 确认不可替代。
- `src/skill-loader.ts` — Skill 加载器
- `src/skill-registry.ts` — Skill 注册表
- `src/discovery/scanner.ts` + `scanner-recipe.ts` + `config-extractor.ts` — Agent 发现扫描
- `src/external-config.ts` — 外部 agent 配置
- `src/install/installer.ts` — Agent 安装器
- `src/agent-roles.ts` — Agent 角色定义
- `src/index.ts` — 精简的公共导出

**删除**：

- `src/execution/` — Agent 循环（Mastra 替代）
- `src/__tests__/` 中的 Agent 循环测试（已删除的代码的测试）
- 任何与 Mastra 功能重叠的工具定义

### 6.2 削减 @cabinet/memory

当前 19 文件 → 目标 ~400 行（KG + entity + contradiction）。

**保留**：

- `src/knowledge-graph.ts` — 知识图谱（V9 确认为不可替代）
- `src/entity.ts` / `src/entity-extractor.ts` — 实体管理
- `src/memory-facade.ts` — 统一门面（精简）
- `src/project.ts` / `src/project-isolation.ts` — 项目隔离
- `src/chunking.ts` / `src/vector-utils.ts` — 向量工具
- `src/index.ts` — 精简导出

**删除或合并**：

- `src/short-term.ts` / `src/long-term.ts` — 短期/长期记忆（Mastra Memory 替代）
- `src/cascade-buffer.ts` — 级联缓冲（Mastra 替代）
- `src/consolidation.ts` — 记忆巩固（Mastra observationalMemory 替代）
- `src/write-gate.ts` — 写入网关（Mastra 替代）
- `src/memory-decay.ts` — 记忆衰减（可保留或合并到 KG）
- `src/hybrid-retriever.ts` — 混合检索（Mastra semanticRecall 替代）
- `src/cross-project-migrator.ts` — 跨项目迁移（审查是否仍需要）

### 6.3 削减 @cabinet/secretary

当前 5 文件 → 目标 ~150 行（session manager + greeting）。

**保留**：

- `src/session-manager.ts` — 会话管理器（thread/resource 映射）
- `src/greeting.ts` — 问候语生成（纯前端功能，可从后端移出）
- `src/index.ts` — 精简导出

**删除**：

- `src/intent-parser.ts` — 意图解析（Mastra agent instructions 替代）
- `src/intent-pattern-matcher.ts` — 模式匹配（同上）
- 移除对 `@cabinet/agent` 的依赖（若不再需要）

### 验证

```
pnpm typecheck
pnpm lint
pnpm -r test
```

---

## 第七阶段：更新文档

### 7.1 README.md / README_CN.md

- 移除已删除包的描述（workflow, gateway, events, harness）
- 更新架构图反映 Mastra 主导的架构
- 更新 API 端点列表

### 7.2 docs/site/\*.md

- `docs/site/guide/architecture.md` — 重写架构描述
- `docs/site/guide/development.md` — 更新开发指引
- `docs/site/guide/contributing.md` — 更新贡献指引
- `docs/site/concepts/blackboard.md` — 移除 `@cabinet/events` 示例
- `docs/site/.vitepress/config.ts` — 移除 Harness 导航

### 7.3 清理旧的 Implementation Plans

保留 V9（当前状态参考）和 V10（本计划），删除 V4-V8。

---

## 第八阶段：最终验证

```
pnpm build              # 全量构建
pnpm typecheck          # 零错误
pnpm lint               # 零错误
pnpm -r test            # 所有测试通过

# 集成测试
# 1. 启动服务器
# 2. 验证所有 /api/secretary/* 端点
# 3. 验证所有 /api/factory/* 端点
# 4. 验证所有 /api/daemon/* 端点
# 5. 验证 WebSocket 事件
# 6. 桌面端连接测试

# 运行 benchmarks
pnpm test:e2e
```

---

## 阶段概览

| 阶段 | 内容                            | 预计行数变动  |
| ---- | ------------------------------- | ------------- |
| 一   | 删除残留构建物 + 清理配置引用   | -500 (删目录) |
| 二   | 修复残余代码引用 + 死代码清理   | -200 / +50    |
| 三   | 消除双重系统                    | -80 / +20     |
| 四   | 重建 API 路由层                 | +400          |
| 五   | 重建 WebSocket 事件             | +30           |
| 六   | 削减 agent / memory / secretary | -2500 / +100  |
| 七   | 更新文档                        | -300 / +300   |
| 八   | 最终验证                        | —             |
