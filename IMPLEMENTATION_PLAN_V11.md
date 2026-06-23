# Cabinet V11 深度切换计划

> 基于四轮审查结论和用户反馈：全面切换到 Mastra，不保留 Cabinet 自有能力。
> 原则：Memory 全切 → Server 深度改造 → Agent 去投影 → Session 瘦身 → 补全缺口。

---

## 第一阶段：移除 Cabinet Memory 服务端集成

> 目标：切断服务器对 `@cabinet/memory` 的所有依赖，仅保留 Mastra Memory（已在 mastra/index.ts 配置）。

### 1.1 移除 build-context.ts 中的 memory 初始化

当前 `build-context.ts` 第 27、30、38 行调用了三个 Cabinet memory 初始化函数：

```
initCoreMemory(state)                → 创建 ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory
initMemoryFacade(state)             → 创建 ConsolidationService, MemoryFacade
initKnowledgeAndSubconscious(state) → 创建 KnowledgeGraph, MemoryDecayService
```

**操作**：

- 删除这三行调用
- 删除 `from './core-memory.js'`, `from './memory.js'`, `from './knowledge.js'` 导入

### 1.2 清理 context/types.ts 中 Memory 类型

`ServerContext` 接口（第 80-109 行）移除：

```
shortTerm: ShortTermMemory
longTerm: LongTermMemory
entity: EntityMemory
project: ProjectMemory
memoryFacade: MemoryFacade
knowledgeGraph: KnowledgeGraph
memoryDecay: MemoryDecayService
```

`BuildState` 接口移除 `knowledgeGraph?` 和 `memoryDecay?` 字段。

从 `@cabinet/memory` 的 import type 中移除对应符号。

### 1.3 清理 context/assembly.ts 中 memory 装配

移除对 `state.shortTerm!`, `state.longTerm!`, `state.entity!`, `state.project!`, `state.memoryFacade!`, `state.knowledgeGraph!`, `state.memoryDecay!` 的装配。

### 1.4 清理 context/build-state.ts 中 memory 类型

移除 `ConsolidationService`, `KnowledgeGraph`, `MemoryDecayService` 的 import。

### 1.5 清理 context/event-bus.ts

检查是否有 memory 依赖。`AgentEventBus` 的回调中使用了 `sessionManager.addMessage()`，这不依赖 `@cabinet/memory`。

### 验证

```
pnpm typecheck   # 预期大量错误，需要继续改造
```

---

## 第二阶段：改写 Mastra 工具层 — 切断对 Cabinet Memory 的依赖

> 当前 6 个 Mastra 工具（knowledge.ts 6个 + project.ts 5个 + status.ts 1个）依赖 `toolServices` 桥接到 Cabinet memory。

### 2.1 处理 knowledge.ts — 删除

Cabinet 知识图谱 Mastra 无等价物，用户明确不需要保留。

**操作**：

- 删除 `apps/server/src/mastra/tools/knowledge.ts`
- 从 `tools/index.ts` 移除 `import * as knowledge` 和 `...knowledge`

### 2.2 处理 project.ts — 改写为 Mastra Working Memory

当前 `project.ts` 的 5 个工具全部调用 `toolServices.memory`（即 `MemoryFacade`）。

**操作**：重写为使用 Mastra agent 的 Working Memory。Mastra agent 自动获得 `updateWorkingMemory` 工具，所以：

- 保留 `getProjectContext`、`updateProjectSummary`、`addMilestone`、`getPreferences`、`setPreferences` 工具名
- 实现改为读写 Mastra Working Memory（通过 `toolServices.workingMemory`）

但 Mastra Working Memory 的核心 API 是 `memory.updateWorkingMemory({ threadId, resourceId, workingMemory })`。工具在 agent 沙箱内运行时，可以访问 thread context。简化实现为基于内存缓存 + Mastra thread metadata 的方案。

**更简单的方案**：直接删除 project.ts 工具。Mastra 的 Working Memory 自带 `updateWorkingMemory` 工具。Cabinet 的 project 工具与 Mastra 的 `updateWorkingMemory` 功能重复。

**操作**：

- 删除 `apps/server/src/mastra/tools/project.ts`
- 从 `tools/index.ts` 移除 `...project`

### 2.3 处理 status.ts — 简化

`getSystemStatus`（第 12 行）调用了 `toolServices.memory.getProject('system')`。

**操作**：

- 移除该行，改为直接返回 Mastra Memory 基础状态（agent count + Mastra metadata）
- `getMemoryStats` 返回 Mastra Memory 配置摘要

### 2.4 清理 tool-context.ts

移除 `memory`, `shortTerm`, `longTerm`, `entity`, `knowledgeGraph` 的 getter（第 14-31 行）。

保留：`decision`, `eventBus`, `agentEventBus`, `agentRegistry`, `skillRegistry`, `sessionManager`, `taskScheduler`, `backupManager`, `logger`, `mcpManager`, `broadcast`。

### 2.5 更新 tools/index.ts

移除 `knowledge` 和 `project` 导入，只保留 `decision`, `agent`, `scheduler`, `status`。

### 验证

```
pnpm typecheck
```

---

## 第三阶段：改写 Memory API 路由

> `routes/memory.ts` 有 12 个端点，全部依赖 `@cabinet/memory`。重写为使用 Mastra Memory。

### 3.1 重写 GET /api/memory

旧行为：查询 STM/LTM/Entity/Project 四层 memory。

新行为：返回 Mastra thread 列表（通过 Mastra Memory 的线程管理 API）。

### 3.2 重写 DELETE /api/memory/:id

旧行为：删除 LTM/Entity/Project 条目。

新行为：删除 Mastra thread（通过 `memory.deleteThread()`）。

### 3.3 删除 POST /api/memory/consolidate

Mastra 的 consolidation 由 observer agent 自动执行。此端点无等价操作 → 删除。

### 3.4 删除 Knowledge Graph 端点

`/graph`, `/graph/entity/:id`, `/graph/entity/:id/relations`, `/graph/search` → 全部删除（无等价物）。

### 3.5 删除 CrossProjectMigrator 端点

`/scope`, `/migrate`, `/global`, `/patterns` → 全部删除（无等价物）。

### 3.6 删除 GET /api/memory/stats

或重写为返回 Mastra Memory 统计信息。

### 验证

```
pnpm typecheck
```

---

## 第四阶段：删除 @cabinet/memory 包

> 前三阶段完成后，`@cabinet/memory` 无任何外部消费者。可以安全删除。

### 4.1 删除包目录

```
rm -rf packages/memory
```

### 4.2 清理项目引用

从 `tsconfig.json` 移除 `{ "path": "packages/memory" }`。

从 `pnpm-workspace.yaml` 中... 不需要改，它使用通配符 `packages/*`。

### 4.3 移除 server 依赖

从 `apps/server/package.json` 移除 `"@cabinet/memory": "workspace:*"`。

### 验证

```
pnpm typecheck  # 零错误
pnpm lint       # 零错误
```

---

## 第五阶段：清理 @cabinet/agent — 移除投影器服务端依赖

> 用户：代码保留，先全面切换。

### 5.1 分析哪些是投影器相关

投影器相关（`packages/agent/src/projector/`）：

- 9 个适配器文件（aider, claude-code, cline, codex, gemini-cli, glm, kimi, opencode, qwen-code）
- `projector/index.ts` — 导出 `getProjector`

非投影器（保留）：

- `discovery/scanner.ts` + `scanner-recipe.ts` + `config-extractor.ts` — Agent 发现扫描
- `skill-loader.ts` + `skill-registry.ts` — 技能加载与注册
- `external-config.ts` — 外部配置
- `install/installer.ts` — Agent 安装器
- `agent-roles.ts` — 角色定义

### 5.2 检查服务器端谁导入了投影器

检查 `Scanner`, `RECIPES`, `getProjector` 的使用：

- `agents.ts:369` → 动态导入 `Scanner`, `RECIPES`
- `workbench/agents.ts:3` → `Scanner`, `RECIPES`, `getProjector`
- `install.ts:11` → `SkillLoader`, `Scanner`, `Installer`, `RECIPES`

`getProjector` 在 `workbench/agents.ts` 中使用。如果该路由移除对投影器的依赖 → 不影响 agent 发现和安装功能。

**操作**：保留 `@cabinet/agent` 代码原样不动，但修改 `workbench/agents.ts` 移除 `getProjector` 导入（如果不需要）。

### 5.3 评估投影器代码是否需要保留

结论：代码保留在 `packages/agent/src/projector/` 中，但不被服务端活动路径导入。未来如需重新启用，代码已在。

### 验证

```
pnpm typecheck
```

---

## 第六阶段：SessionManager 瘦身

> 目标：从 554 行减到 ~150 行。

### 6.1 移除的功能

| 功能                                            | 替代                                        | 操作                                                              |
| ----------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| 消息 CRUD（`addMessage`, `get().messages`）     | Mastra thread message storage               | 删除 `addMessage` 的消息部分，改为记录 metadata                   |
| 消息 token 估算、自动压缩                       | Mastra observationalMemory 自动压缩         | 删除 `estimateTokens`, `compressToolResult`, hard/soft limit 逻辑 |
| 磁盘持久化（`~/.cabinet/sessions/`）            | Mastra LibSQLStore                          | 删除 `persist`, `flush`, `scheduleFlush`, `restoreSessions`       |
| Routing state（`lastIntent`, `topicEmbedding`） | Mastra agent instructions 替代（V9 已裁决） | 删除                                                              |

### 6.2 保留的功能

| 功能                                                                                               | 原因                        |
| -------------------------------------------------------------------------------------------------- | --------------------------- |
| 会话 ID 管理（`create`, `get`, `close`, `list`, `remove`）                                         | 桌面端会话列表需要          |
| Task↔Session 映射（`associateTask`, `getSessionByTaskId`）                                         | 外部 agent 集成的核心       |
| 子会话树（`createChildSession`, `getChildSessions`, `updateStatus`, `addEvent`, `setDeliverable`） | 父子关系 UI 需要            |
| ContextSlot（`setContextSlot`, `getContextSlot`, `addDiscovery`, `addOutput`）                     | 外部 agent 数据总线         |
| 生命周期回调（`onSessionClose`, `onSessionCreate`, `onFirstUserMessage`, `onCompressionNeeded`）   | 用于 Curator 整合等下游逻辑 |
| TTL 清理（`cleanExpiredSessions`）                                                                 | GC 端点需要                 |

### 6.3 数据存储简化

不再写 JSON 文件。Session 元数据（id, title, projectId, parentId, status, agentType, createdAt, updatedAt）仅存内存。ContextSlot 保留在内存中（外部 agent 运行时上下文）。

### 6.4 更新服务器使用者

`secretary.ts` 中 `sessionManager.addMessage()` 调用 → 改为只记录统计，不存消息内容（Mastra 已存）。

`external-agent.ts` 中的 `getSessionByTaskId` 逻辑不变。

`harness.ts` 中 `sessionManager.list()` 不变。

### 验证

```
pnpm typecheck
pnpm lint
```

---

## 第七阶段：补全功能缺口

> 之前审查中的已知局限，现在逐个解决。

### 7.1 秘书聊天流式响应

`secretary.ts` 当前用 `generate()`（非流式）→ 改为 `stream()` 实现真正的 SSE 流式输出。

Mastra `agent.stream()` 返回 `MastraModelOutput`，其中 `textStream` 是 `AsyncIterable<string>`。需要遍历并转换为 Cabinet SSE 格式。

### 7.2 Workflow 异步回调

`factory.ts:80` 的 `execute()` 是同步 await 的 → Mastra workflow 支持 `execute()` 返回 runId + `onFinish` 回调。利用 `onFinish` 触发 `workflow_completed` 事件。

### 7.3 补全缺失的 WebSocket 事件

| 事件                   | 触发源                                             |
| ---------------------- | -------------------------------------------------- |
| `subconscious_insight` | Mastra observationalMemory 的 observer 回调        |
| `agent_updated`        | agents.ts agent 配置修改时（目前无修改端点，预留） |

### 7.4 同步 Desktop 前端适配 V11 改造后的 API

> 第三阶段将重写 `/api/memory` 系列端点（去掉 KG、迁移、stats 等功能，改为基于 Mastra thread 管理）。Desktop 需对此同步适配，不是清理"旧代码"，而是跟上后端改造节奏。

`MemoryPage.tsx`（调用 `/api/memory`, `/api/memory/consolidate` 等）→ 适配为基于 Mastra thread 列表和 thread 操作的新 API。

`GraphTab.tsx` / `GraphDetailPanel.tsx`（Knowledge Graph 可视化）→ 第三阶段删除后端 KG 端点后，前端对应功能移除。

`HarnessWidget.tsx` / `InsightsWidget.tsx` / `TelemetryWidget.tsx` → V10 已补全后端端点，无需改动。

### 验证

```
pnpm typecheck
pnpm lint
pnpm build
```

---

## 第八阶段：清理与最终验证

### 8.1 删除上下文空文件

如果 `core-memory.ts`, `memory.ts`, `knowledge.ts` 在 Phase 1 后变为空文件或无意义文件 → 删除。

### 8.2 清理 @cabinet/memory 残留

全量搜索 `@cabinet/memory` 残留引用，确保零引用。

### 8.3 最终验证

```
pnpm build       # 全量构建
pnpm typecheck   # 零错误
pnpm lint        # 零错误
pnpm lint:arch   # 零违规
pnpm -r test     # 除预存在的 DB 连接问题外全部通过
```

---

## 阶段概览

| 阶段     | 内容                     | 预计行数变动     |
| -------- | ------------------------ | ---------------- |
| 一       | 移除服务端 memory 初始化 | -150 / +10       |
| 二       | 改写 Mastra 工具层       | -200 / +30       |
| 三       | 改写 memory API 路由     | -300 / +50       |
| 四       | 删除 @cabinet/memory 包  | -3000            |
| 五       | 清理 agent 投影器依赖    | -20              |
| 六       | SessionManager 瘦身      | -400             |
| 七       | 补全功能缺口             | -100 / +150      |
| 八       | 清理与验证               | -50              |
| **合计** |                          | **-4200 / +240** |
