# Cabinet AI 系统 — 全面架构审计报告

**审计日期**: 2026-06-07
**审计框架**: Cybernetic AI Framework (8 Principles) + 系统工程评估
**系统版本**: Cabinet v2.0-alpha
**基准 commit**: `b03116c`
**审计范围**: 全栈 (17 packages + 2 apps + desktop)

---

## 目录

1. [系统规模概览](#1-系统规模概览)
2. [核心子系统逐个分析](#2-核心子系统逐个分析)
   - 2.1 Agent 循环 (AgentLoop)
   - 2.2 CLI Adapter
   - 2.3 Workflow 引擎
   - 2.4 多 Agent 协作
   - 2.5 Skill 的实现与管理
   - 2.6 MCP 的实现与管理
   - 2.7 Context Slot
   - 2.8 Dashboard
   - 2.9 记忆系统 (Memory System)
3. [控制论框架系统评估](#3-控制论框架系统评估)
4. [系统过重分析 — 哪些功能不应存在](#4-系统过重分析--哪些功能不应存在)
5. [系统演进方向建议](#5-系统演进方向建议)
6. [总体评级与优先级矩阵](#6-总体评级与优先级矩阵)
7. [系统性全面优化方案](#7-系统性全面优化方案)

---

## 1. 系统规模概览

| 维度               | 数据                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 总 TypeScript 文件 | ~3,370 个 (packages: 590, apps: 2,780)                                                                                                                                         |
| 包数量             | 17 个                                                                                                                                                                          |
| 应用数量           | 2 个 (server, desktop) + 1 个 CLI 入口                                                                                                                                         |
| agent 包代码量     | **19,505 行** (72 个源文件) — 最大单包                                                                                                                                         |
| desktop UI 组件    | 131 个 .tsx 文件                                                                                                                                                               |
| 4 层架构           | Layer 1: types/storage/graph/events → Layer 2: agent/gateway/memory/agent-sdk → Layer 3: decision/secretary/workflow/harness/organize/meeting → Layer 4: ui/server/desktop/cli |
| 关键技术栈         | TypeScript 5.9+ (strict), React 19, Hono, Tauri 2.0, SQLite (better-sqlite3), Vercel AI SDK 6, LangGraph-style StateGraph                                                      |

### 各包代码量 (按行数排序)

| 包            | 行数   | 层级 | 定位                                                     |
| ------------- | ------ | ---- | -------------------------------------------------------- |
| **agent**     | 19,505 | L2   | 核心引擎 — AgentLoop/Dispatcher/Skill/Memory/Rules/Tools |
| **storage**   | 8,588  | L1   | 持久化 — 27+ 个 Repository + DB 迁移                     |
| **workflow**  | 3,447  | L3   | 工作流引擎 — YAML/EL 蓝图 + Manager/Pipeline             |
| **harness**   | 3,188  | L3   | 观测与自适应 — Observability/AutoAdjuster/GC/Browser     |
| **memory**    | 3,244  | L2   | 记忆系统 — STM/LTM/Embedding/Consolidation/KG            |
| **secretary** | 2,934  | L3   | 会话管理 + IntentParser + 路由                           |
| **types**     | 2,371  | L1   | 共享类型 + 工具定义                                      |
| **gateway**   | 1,815  | L2   | LLM Gateway — AI SDK + ModelRouter + Cost/Budget         |
| **graph**     | 1,455  | L1   | LangGraph-style StateGraph + Checkpoint                  |
| **events**    | 1,263  | L1   | 事件总线 + EventStore + DeadLetter                       |
| **decision**  | 1,068  | L3   | 决策服务 — StateMachine + Escalation + Policy            |
| **organize**  | 931    | L3   | 组织(交互式子代理)                                       |
| **agent-sdk** | 806    | L2   | 外部 Agent SDK (A2A/Slot)                                |
| **meeting**   | 699    | L3   | 会议机制                                                 |
| **ui**        | 506    | L4   | 共享 UI 组件 (DashboardSummary 等)                       |
| **cli**       | 419    | L4   | CLI 入口 (cabinet 命令)                                  |

---

## 2. 核心子系统逐个分析

### 2.1 AgentLoop — Agent 循环

**位置**: [packages/agent/src/agent-loop.ts](packages/agent/src/agent-loop.ts) (1,137 行)

#### 架构设计

AgentLoop 是整个系统的"心脏"。它基于 LangGraph-style `StateGraph` 实现了一个带有显式状态管理的闭环：

```
buildContext → contextCheck → llm → safetyCheck → tools → llm → ... → (END)
                   ↑            ↑        ↑          ↑
                   └─ compress ─┘        └─ safety ─┘
```

**7 个 Graph 节点**:

1. `buildContext` — 组装 system prompt + 注入 project snapshot + skill context
2. `contextCheck` — 评估当前 token 利用率，分类为 smart/warning/critical/dumb
3. `compressContext` — 当进入 critical/dumb zone 时触发 ContextHandoff，保持过程连续性
4. `llm` — 调用 LLM Gateway（带重试），累积 token/usage 统计
5. `safetyCheck` — 工具调用前安全审查 (T0-T3 信任级别，渐进放开)
6. `tools` — 执行工具调用（只读组并行，写入串行），每 5 步异步写 checkpoint

**双模式运行**:

- `run()`: 基于 StateGraph 的标准模式，支持 checkpoint 恢复 + context 监控
- `runStreaming()`: 基于 AI SDK streamText 的流式模式，支持实时 thinking/tool_call 回调但不支持 checkpoint

#### 设计评价: **强 (A-)**

**✅ 做对了的**:

- 过程连续性：checkpoint 每 5 步持久化 + crash 恢复时注入 `crashed` 标记，明确承认"中断是常态"
- 状态图架构使用 `Annotation` reducer 模式定义状态转换，每次状态更新可追溯
- 双向 context 管理：既有 ContextMonitor（观测）又有 ContextHandoff（主动压缩），而非被动溢出
- Safety 分层：在 LLM 输出和工具执行之间插入 safetyCheck 节点，T0-T3 信任级别提供渐进式放开
- 工具并行化：只读工具组（`READ_TOOL_NAMES`, 25+ 工具）并行执行，写入串行——在安全与效率间找到平衡
- 3 级结构化输出提取：```json fence → 裸 JSON → 任意 fence，容忍 LLM 格式变异
- Observability hooks：`onSessionComplete` 回调提供完整会话总结（zones/errors/tools/tokens）

**⚠️ 潜在问题**:

- **Graph 编译耦合在 run() 内部**: 每次 `run()` 调用都重新 `buildRunGraph()` + `compile()`——对于短会话（1-3 步）这是浪费
- **闭包地狱**: `buildRunGraph` 中大量使用 `self = this` + 捕获可变计数器对象——使单元测试几乎不可能
- **checkpoint 只在 tool 节点写入**: 如果 agent 在 `llm` 节点崩溃（API 超时），最近的 progress 完全丢失
- **streaming 和 non-streaming 是两条完全独立的代码路径**: `run()` (~300 行) 和 `runStreaming()` (~200 行) 几乎没有共享逻辑——这是最大的维护负担
- **conversationHistory 的语义不清**: 它同时被 run() 和 runStreaming() 使用，但只有 streaming 路径正确维护

**控制论视角**: AgentLoop 是系统中最符合 **原则 1 (AI as Process)** 和 **原则 4 (Closed-Loop Cognition)** 的组件。但双路径问题表明"精确控制"（run）和"实时响应"（runStreaming）的 trade-off 还没被优雅地解决。

---

### 2.2 CLI Adapter

**位置**: [packages/agent/src/adapters/cli-adapter.ts](packages/agent/src/adapters/cli-adapter.ts) (106 行)

#### 架构设计

CLI Adapter 是一个 **Facade**，将外部 CLI 工具（Claude Code、Codex、OpenCode 等）包装成统一的 `ExternalAgentAdapter` 接口。核心是 `HarnessRuntimeFactory`：

```
CLI command → HarnessRuntimeFactory.detectFromCommand()
  → ClaudeCodeRuntime / CodexRuntime / OpenCodeRuntime / GenericCliRuntime
  → ExternalAgentAdapter 统一接口
```

#### 设计评价: **合理但有冗余 (B+)**

**✅ 做对了的**:

- Facade 模式干净地解耦了 harness 检测和具体实现
- 自动检测机制使外部 agent 配置人性化（不需要手动指定 harness 类型）
- 向后兼容——旧代码直接创建 `CliAdapter` 仍然工作

**⚠️ 潜在问题**:

- **5 个 HarnessRuntime 实现**: ClaudeCode (35 行) + Codex (31 行) + OpenCode (35 行) + A2A (36 行) + Generic (30 行)——每个都是独立子进程管理，但本质上是 start/stop/dispatchTask/healthCheck 的变体；应该用泛型基类消除重复
- **Generic CLI 其实才是真正的基类**: GenericCliRuntime 是 spawn + stdio 管理——其他 harness 应该继承它，而非并行实现
- **外部 agent 生命周期管理薄弱**: 子进程退出后没有自动重启；`externalAgentDetectTimer` 每 60s poll 一次是脆弱的
- **A2A 和 CLI 是两种完全不同的通信范式**却通过同一接口统一——A2A 是 HTTP REST，CLI 是子进程 stdio——统一可能过度抽象

---

### 2.3 Workflow 引擎

**位置**: [packages/workflow/src/](packages/workflow/src/) (3,447 行)

#### 架构设计

Workflow 引擎实现了 **Manager-Executor 模式**：

```
Manager Plan (LLM-driven) → Dispatch to Children → Review → Iterate → Synthesize
```

加上 Pipeline/Parallel 模式（在 Dispatcher 中），以及蓝图编译（YAML/EL 表达式）。

#### 设计评价: **架构正确但过度工程化 (B)**

**✅ 做对了的**:

- Manager 的 Plan-Dispatch-Review-Synthesize 循环是对经典控制论闭环的正确实现
- 多种工作流定义方式（YAML 蓝图 + 代码 API）
- Squad 集成——manager 可通过 SquadRouter 进行团队级委派

**⚠️ 潜在问题**:

- **3 层冗余的工作流执行路径**:
  1. `ManagerExecutor.run()` — Plan-Dispatch-Review 循环
  2. `Dispatcher.runPipeline()` / `runParallel()` / `runSingle()` — AgentLoop 直接委派
  3. `WorkflowEngine` (server routes) — 蓝图编译执行
     这三种方式有大量功能重叠——Pipeline/Parallel 可以被 ManagerExecutor 的 Plan 阶段覆盖
- **EL (Expression Language) 是危险的复杂度炸弹**: 引入自定义 DSL 用于工作流定义——所有配套工具链从零构建，调试极难
- **ManagerContext 的依赖注入过于复杂**: `createManagerContext(deps)` 创建了 10+ 个方法的对象——全是闭包包装，无法单元测试
- **蓝图和 StateGraph 关系不清**: YAML/EL/代码三种定义方式最终都编译成 StateGraph——为何不在 API 层面统一？

---

### 2.4 多 Agent 协作

**位置**: [agent/src/dispatcher.ts](packages/agent/src/dispatcher.ts) (387 行), [agent/src/agent-roles.ts](packages/agent/src/agent-roles.ts), [secretary/src/](packages/secretary/src/), [agent/src/daemon/](packages/agent/src/daemon/)

#### 架构设计

多 Agent 协作有 **4 个层次**:

```
Level 1: AgentDispatcher — Pipeline/Parallel/Single 模式
Level 2: AgentRoleRegistry — 角色注册 + modelTier routing + contextBudget
Level 3: Secretary — IntentParser → Agent 路由 + SessionManager
Level 4: Daemon — pull-mode 任务队列 + 外部 Agent (CLI/A2A)
```

#### 设计评价: **核心合理但有架构断层 (B+)**

**✅ 做对了的**:

- AgentRole 的 modelTier 系统实现了一致性 vs 成本的动态平衡——每个角色有独立 model/contextBudget/temperature
- AgentHandoff + ContextHandoff 双重 handoff 机制——前者在 agent 间传递任务，后者在 agent 内保持连续性
- Daemon 的 pull-mode 任务队列为长时间运行的 agent 提供异步执行路径
- Secretary 的 IntentParser 使用 embedding 匹配将用户意图路由到最合适的 agent

**⚠️ 潜在问题**:

- **Dispatcher 中的 3 种模式本质上是 1 种**: Pipeline 是顺序运行 AgentLoop；Parallel 是并发运行；Single 是 Pipeline 长度为 1——都可被统一
- **ResultSynthesizer 太简单**: Parallel 模式的合成仅去重 + 排序 + 置信度平均——不处理矛盾发现（两个 agent 得出相反结论）
- **Agent 间通信只有 handoff 一种模式**: 没有实时 agent-agent 通信（无 blackboard、无事件订阅）——所有信息传递必须序列化
- **Squad 系统与 Dispatcher 功能重叠**: Squad leader 在 squad 内部路由任务——这与 Dispatcher + ManagerExecutor 高度相似
- **外部 Agent (CLI/A2A) 与内部 Agent (AgentLoop) 的生命周期不对称**: 内部 agent 瞬时创建，外部 agent 持久运行——这个差异没有被妥善处理

---

### 2.5 Skill 的实现与管理

**位置**: [agent/src/skill-loader.ts](packages/agent/src/skill-loader.ts) (183 行), [agent/src/skill-registry.ts](packages/agent/src/skill-registry.ts) (258 行), [agent/src/skill-extractor.ts](packages/agent/src/skill-extractor.ts) (115 行)

#### 架构设计

Skill 系统采用 **3 层累进加载 (Progressive Disclosure)**:

- **L1 (总是加载)**: `SkillMetadata` — name/description/kind/version (~50 tokens/skill)
- **L2 (按需加载)**: `SkillEntry` — 完整 prompt template + schema
- **L3 (深度加载)**: scripts/ + references/ 目录（真正需要时才读文件）

```
SKILL.md (YAML frontmatter + Markdown body)
  → SkillRegistry.register()
  → SkillRegistry.getToolDefinitions() — 每个 active skill 映射为一个工具
  → AgentLoop 通过 use_skill__{name} 工具触发
  → SkillRegistry.executeSkill() — 组装 L1+L2+L3 上下文 + 模板变量替换
```

额外机制:

- `SkillExtractor` — 从成功的 agent session 自动提取技能
- `startSkillWatcher` — 文件系统热重载
- DB 持久化 (`SkillRepository`)

#### 设计评价: **优秀但自动提取是过度设计 (A-)**

**✅ 做对了的**:

- L1/L2/L3 分层完美解决 context budget 问题——每个 skill 在 L1 只消耗 ~50 tokens
- YAML frontmatter 兼容 Anthropic SKILL.md 标准——降低 skill 作者的认知成本
- `$ARGUMENTS` / `$N` / `{{key}}` 模板变量替换实用且简洁
- 双向 skill 导入/导出通过 `importSkillFromMarkdown` / `exportSkillToMarkdown`
- 使用统计 (`usageCounts`) 可为 skill 优先级排序和推荐提供数据基础

**⚠️ 潜在问题**:

- **SkillExtractor 触发阈值过高**: 需要 toolCalls >= 5 + totalSteps >= 10 + success——只对长任务有效；许多有用的短 skill（如标准化的 git commit 流程）永远不会被提取
- **自动提取的 skill 质量不可控**: Haiku 从一次执行 trace 中提取步骤 → 泛化能力极低 → 很可能是"这次特定任务"的步骤，而非可重用 workflow
- **SkillRegistry 内存单例的并发问题**: `sharedRegistry` 被 DB 加载 + 文件扫描 + hot-reload 三方同时修改——没有锁保护
- **Skill 作为工具 (`use_skill__{name}`) 的语义混淆**: Skill 本质是 prompt 注入（告诉 LLM "按这个步骤做"），但被暴露为工具——LLM 不理解 "使用 skill" 和 "调用工具" 的本质区别

---

### 2.6 MCP 的实现与管理

**位置**: [apps/server/src/mcp/mcp-manager.ts](apps/server/src/mcp/mcp-manager.ts) (172 行)

#### 架构设计

MCP Manager 是一个轻量级的 MCP 客户端管理器：

```
~/.cabinet/mcp/*.json (配置文件) + DB settings
  → MCPManager.initialize(configs)
  → 每个 enabled server: Client.connect(StdioClientTransport)
  → 发现 tools: client.listTools()
  → 注册为 mcp__{toolName} 格式的工具
  → MCP 工具在 AgentLoop 中作为标准 tool 暴露给 LLM
```

#### 设计评价: **简洁有效但边界薄弱 (B+)**

**✅ 做对了的**:

- 代码简洁——172 行完成核心功能（connect/disconnect/discover/call）
- 支持配置热更新 (`updateConfigs`)——添加/删除服务器无需重启
- 工具命名空间隔离——`mcp__` 前缀防止与内置工具冲突

**⚠️ 潜在问题**:

- **只支持 stdio transport**: MCP 协议支持 stdio 和 SSE/HTTP 两种 transport，但当前只实现 stdio——限制了可连接的 MCP 服务器类型（无法连接远程 MCP 服务）
- **没有 MCP resources/prompts 支持**: 当前只发现 `tools`，忽略了 `resources`（文件内容/数据库查询结果）和 `prompts`（预设对话模板）
- **工具发现是一次性的**: 连接时 `listTools()` 后不再动态更新——如果 MCP 服务器在运行时添加了新工具，Cabinet 感知不到
- **没有 MCP 工具的安全沙盒**: 所有 MCP 工具的 `inputSchema` 被直接透明传给 LLM——没有副作用评估或安全分类
- **错误恢复太简单**: `connectServer` 失败时只 log warning——没有重试策略、指数退避、或降级到 mock

---

### 2.7 Context Slot

**位置**: 定义在 `types/src/primitives.ts` 的 `ContextSlot` 接口，由 `secretary/src/session-manager.ts` 的 `Session` 对象持有

#### 架构设计

Context Slot 是附加在每个 Session 上的共享数据总线，当前包含：

- `discoveries` — agent 在工具执行中发现的信息列表
- `handoff` — agent 间传递的结构化交接文档
- `routingState` — 意图路由的 embedding + 路由决策

生命周期：Session 创建 → Slot 初始化 → Agent 写入 discoveries → 用户交互继续 → Session 关闭 → Curator 消费 discoveries 写入 LTM

#### 设计评价: **概念正确但实现过于简单 (B-)**

**✅ 做对了的**:

- 概念清晰——每个 session 附着一个 slot 用于跨 agent 共享数据
- Curator 的消费机制确保 discoveries 不会丢失——session 关闭时自动提取

**⚠️ 潜在问题**:

- **只是 Session 对象上的可选字段**: 没有类型安全保证——任何代码可读写任意字段——缺乏 schema 验证
- **Slot 生命周期与 Session 完全绑定**: 长 session（持续数天的工作流）中 slot 数据会膨胀——没有 GC 或压缩机制
- **没有 slot 版本控制或冲突解决**: 两个 agent 同时写入同一字段 → 后者静默覆盖前者
- **"Context Slot" 名不副实**: 它实际上是 "session-shared data bus"，而 "context slot" 通常指 LLM context window 中的预留位置——概念混淆
- **Slot 与 Memory 系统的边界模糊**: discoveries 被 Curator 写入 LTM 后，原始数据应被清理还是保留？当前没有清除逻辑——可能导致重复

---

### 2.8 Dashboard

**位置**: [apps/server/src/routes/dashboard.ts](apps/server/src/routes/dashboard.ts) (173 行), [packages/ui/src/dashboard-summary.tsx](packages/ui/src/dashboard-summary.tsx) (111 行), [apps/desktop/src/hooks/useDashboardStats.ts](apps/desktop/src/hooks/useDashboardStats.ts)

#### 架构设计

Dashboard 提供 2 个 API 端点:

- `/dashboard/summary` — 4 个计量卡片 (Pending Decisions / Today Cost / Active Projects / Workflows) + Recent Events + Budget Status
- `/dashboard/cost-history` — 成本历史 + 预算对比 (daily/weekly/monthly)

前端使用 `CountUp` 动画 + `react-grid-layout` 可拖拽布局。

#### 设计评价: **功能基本但有 MVP 局限 (B)**

**✅ 做对了的**:

- 核心指标选择正确——decisions/cost/projects/workflows 是最需要监控的 4 个维度
- Budget 集成——dashboard 是用户感知预算状态的唯一切入点
- 优雅降级——每个数据源失败时独立 try/catch，不会因一个 repo 故障导致整个页面崩溃

**⚠️ 潜在问题**:

- **数据实时计算**: pendingDecisions 每次 count(\*) 全表——数据量大时性能堪忧
- **Recent Events 是不完整的静态映射**: `EVENT_LABELS` 只覆盖部分消息类型，未覆盖的直接显示原始字符串
- **前后端是两套不同的 DashboardStats 类型**: UI 包和 hooks 各有独立的 `DashboardStats` 接口——字段不同，重复定义
- **缺少 Agent 健康状态**: Dashboard 展示项目和工作流但不展示 agent 状态——哪些 online、哪些运行中、外部 agent 连接状态
- **缺少实时更新**: WebSocket 推送的 budget_alert / agent_status_change 没有被 dashboard 前端消费

---

### 2.9 记忆系统 (Memory System)

**位置**: [packages/memory/src/](packages/memory/src/) (3,244 行, 14 个模块)

#### 架构设计

记忆系统是 Cabinet 的"持久化知识基础设施"，由 **6 个核心组件** 构成一个完整的记忆生命周期管道：

```
ShortTermMemory (LRU cache + SQLite, TTL 30min)
    │
    ▼
WriteGate (5-check 分层评估)
    │
    ├─ register/working tier ──→ LongTermMemory (SQLite + HNSW vector index)
    │                                  │
    ├─ daily tier ──→ CascadeBuffer     │
    │    │              (L0 staging)     ▼
    │    ▼              seal→L1 summary KnowledgeGraph (entity extraction + contradiction)
    │   LongTermMemory                        │
    │                                          ▼
    └─ transient noise → dropped       MemoryDecayService (expire/archive/supersede lifecycle)
```

**六大子系统详析**:

**① ShortTermMemory** ([short-term.ts](packages/memory/src/short-term.ts), 186 行)

- LRU 驱逐策略（maxSize=1000）+ SQLite 持久化
- TTL 默认 30 分钟，过期自动删除并通知 `onExpire` 回调
- 双存储（内存 cache + SQLite），读取时 cache miss 触发 DB 回填
- `getAll(sessionId)` 合并内存 + DB 数据
- 暴露 `_store` (内部 Map) 给 ConsolidationService 做底层操作——封装泄漏

**② LongTermMemory** ([long-term.ts](packages/memory/src/long-term.ts), 553 行) — 系统中最复杂的单组件

- SQLite + HNSW (hnswlib-node) 向量索引双存储
- **混合搜索**: RRF (Reciprocal Rank Fusion, k=60) 融合语义搜索 (HNSW cosine) 和文本搜索 (FTS5 BM25)
- 检索分数 = RRF score × decayScore (importance × confidence × recencyDecay × accessBoost)
- `store()` 时自动提取实体 → KnowledgeGraph、自动检测矛盾 → auto-supersede (confidence>0.8) / 通知回调 (0.5-0.8)
- 容量管理: MAX=500,000 条，超限时优先删 expired/archived，然后按 retrieval score 删最低分
- HNSW 索引用 label↔id 双向 map 维护（hnswlib-node v3 只接受 number labels）
- 索引持久化到 `~/.cabinet/memory.hnsw.index` + `.meta.json`
- `close()` 手动保存索引

**③ WriteGate** ([write-gate.ts](packages/memory/src/write-gate.ts), 106 行)

- 5 层 regex 启发式分层，灵感来自 total-recall 的分层记忆架构：
  | 优先级 | 层级 | 触发条件 |
  |--------|------|---------|
  | Tier 3 (working) | `explicit_remember` | 用户显式说 "记住这个" |
  | Tier 2 (register) | `behavior_changing` | 偏好/风格/习惯/语言 |
  | Tier 2 (register) | `commitment` | deadline/deliverable/milestone/todo |
  | Tier 2 (register) | `decision` | decided/approved/rejected + 推理 |
  | Tier 1 (daily) | `stable_fact` | 包含日期/数字/实体 |
  | Tier 1 (daily) | `length_fallback` | 长度 > 50 字符 |
  | 拒绝 | `transient_noise` | 不满足任何条件 |

- 支持结构化 key 快速通道: `decision_*` / `preference_*` / `milestone_*` 直接进入 register 层
- **完全基于 regex 和规则**，无 LLM 参与——保证低延迟和低成本

**④ CascadeBuffer** ([cascade-buffer.ts](packages/memory/src/cascade-buffer.ts), 115 行)

- L0 内存 staging 区，按 `sessionId:topic` 分组
- `shouldSeal()` 阈值: minCount ≥ 3, maxAge ≥ 30min
- `seal()` 将原始条目压缩为纯文本拼接摘要（可注入 LLM summarizer）
- `sealAll()` 在 session 关闭时强制 flush
- 重启恢复: cascade 元数据持久化在短时记忆的 `__cascade_meta__` key 中，重启后从短时记忆恢复 buffer
- 默认 summarizer 只是简单拼接——没有去重或重要性排序

**⑤ KnowledgeGraph** ([knowledge-graph.ts](packages/memory/src/knowledge-graph.ts), 322 行)

- SQLite 实体-关系图 (`memory_entities` + `memory_relations`)
- 自动实体提取: 正则匹配英文大写短语 + CJK 词语（2+ 字符）→ `addEntity()`
- BFS 遍历 `findRelated()`: 在 D 跳内找到与目标实体相连的所有实体
- 矛盾检测 `detectContradictions()`:
  1. 从新记忆中提取候选实体名
  2. 查找直接的 `contradicts` 关系
  3. 进一步查找间接矛盾（related entities 的矛盾方）
  4. 按 confidence 降序返回
- 矛盾解决 `resolveContradiction()`: 标记 superseded / merged 关系
- 可选 LLM 裁判 (`llmJudge` 参数): 用于语义级矛盾判断——但当前代码中从未被注入

**⑥ MemoryDecayService** ([memory-decay.ts](packages/memory/src/memory-decay.ts), 91 行)

- 3 条衰减规则:
  1. `validUntil < now` → status = 'expired'
  2. `confidence < 0.3 && accessCount < 3 && age > 30 days` → status = 'archived'
  3. `importance < 0.2 && age > 90 days` → status = 'archived'
- 检索分数公式: **score = importance × confidence × e^(-ageDays/30) × (1 + ln(1 + accessCount))**
  - 半衰期 30 天，访问次数对数加成
- 每 1 小时运行一次 (`memoryMaintenanceTimer`)
- 每周日凌晨 3 AM 重建 HNSW 索引

**辅助组件**:

- **EntityMemory** ([entity.ts](packages/memory/src/entity.ts), 133 行): Captain 偏好 + Employee 配置的简单 cache-through
- **ProjectMemory** ([project.ts](packages/memory/src/project.ts), 124 行): 项目目标/里程碑/决策/摘要，cache-through + auto-init
- **ProjectIsolatedMemory** ([project-isolation.ts](packages/memory/src/project-isolation.ts), 75 行): 项目级 key 前缀隔离 + 搜索结果过滤
- **ConsolidationService** ([consolidation.ts](packages/memory/src/consolidation.ts), 284 行): WriteGate→CascadeBuffer 管道的编排器，`consolidateBasic()` (轻量) 和 `consolidateWithLLM()` (Curator Agent)
- **MemoryOrchestrator** ([orchestrator.ts](packages/memory/src/orchestrator.ts), 23 行): 纯接口定义——系统中 **从未被实现**，仅为概念约定

**与 Agent 层的集成**:

```
ContextBuilder (agent)
  → MemoryProvider 接口 (5 个方法)
    → createStandardMemoryProvider() (server/agent-factory.ts, 165 行)
      → SessionManager.get() + ShortTermMemory.getAll() → getShortTerm()
      → ProjectMemory.get() + ProjectRepository.findById() → getProjectContext()
      → EntityMemory.getPreferences() → getEntityPreferences()
      → LongTermMemory.search() (+ Gateway.generateEmbeddings()) → searchLongTerm()
      → LongTermMemory.search() filtered by insight types → getRecentInsights()
```

Curator 后台任务（consolidation/brief/pattern extraction）直接通过 `ToolDependencies` 访问 ShortTerm/LongTerm/Entity/Project——不走 MemoryProvider 接口。

#### 设计评价: **架构雄⼼卓越但存在实现断层 (B+)**

**✅ 做对了的 — 核心设计强项**:

- **分层记忆架构**: ShortTerm (30min TTL) → WriteGate (5 层分类) → CascadeBuffer (L0 staging) → LongTerm (永久) —— 这个管道设计是 total-recall 论文理念的正确工程化
- **混合搜索 RRF**: 语义 (HNSW cosine) + 文本 (FTS5 BM25) 的 RRF 融合是当前信息检索的最佳实践，考虑了衰减分数——比纯向量搜索或纯文本搜索都更鲁棒
- **WriteGate 的 regex 快速通道**: 用纯规则做快速分层，不依赖 LLM——保证低延迟（<1ms per entry）和零 API 成本
- **矛盾检测的置信度分级**: >0.8 自动 supersede、0.5-0.8 通知 Captain、<0.5 保留——这个三级响应很好地平衡了自动化和人工 oversight
- **CascadeBuffer 的重启恢复**: 通过 `__cascade_meta__` 在短时记忆中保存 cascade 状态，重启后能从短时记忆恢复 buffer——考虑了过程连续性
- **检索分数的衰减公式**: `importance × confidence × e^(-age/30) × ln(1+accessCount)` —— 这是一个经典的 Ebbinghaus 遗忘曲线变体，用重要性（主观价值）、置信度（可靠性）、时间衰减、访问次数（复习效应）四个维度评估记忆价值

**⚠️ 潜在问题 — 架构断层**:

- **WriteGate 的正则脆弱性**: 所有 5 层分类完全依赖 regex 模式——中文 "记住这个" 能匹配，但日文 "これを覚えて"、法文 "souviens-toi de ça" 不能——多语言覆盖极不完整。`isDecisionWithReasoning` 要求 "decided/决定/决定" 等关键词同时出现推理词——纯事实陈述型决策会被漏掉
- **CascadeBuffer 的默认 summarizer 过于简陋**: `defaultSummarizer()` 只是 `[sourceKey]: content` 的简单拼接——没有去重、没有重要性排序、没有冲突标记——生成的摘要质量远低于 LLM summarizer。但 LLM summarizer 从未被注入（`consolidateBasic()` 在 server 层已被 Curator 的 LLM consolidation 替代）
- **KnowledgeGraph 的实体提取极不可靠**: 正则 `[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*` 匹配英文大写短语——会将 "The System Is Complex" 中的 "The"、"System"、"Is"、"Complex" 全部分别提取为实体；也会匹配大量噪声（如日志中的错误码、变量名）。**没有 NER 模型、没有 TF-IDF 过滤、没有停用词表**——这导致 KnowledgeGraph 充满噪声实体
- **KnowledgeGraph 的矛盾检测完全基于图结构**: `detectContradictions()` 只查找 `contradicts` 关系边——但 "矛盾" 关系必须由外部代码显式创建（`addContradiction()`）——LLM 裁判参数 `llmJudge` 在接口中定义了但从未被注入。这意味着**矛盾检测在当前实现中基本不工作**
- **MemoryOrchestrator 是空壳**: 接口定义了 23 行但从未被任何类实现——这是"设计蓝图"而非"功能代码"
- **LongTermMemory.store() 做了太多事**: 单次 `store()` 调用做了 ①实体提取→KnowledgeGraph ②矛盾检测→auto-supersede ③SQLite 写入 ④HNSW 索引更新 ⑤容量检查——**这是典型的 God Method**，任何一个步骤失败（如 HNSW 索引 OOM）都会影响核心的 "存储记忆" 功能
- **HNSW 索引的脆弱性**: `hnswlib-node` 是可选依赖（`try/catch`）——如果 native addon 不可用，整个语义搜索静默降级为空结果。没有 fallback 方案（如 brute-force cosine on SQLite rows）
- **ShortTermMemory.\_store 封装泄漏**: 暴露内部 Map 给 ConsolidationService 做底层操作——违反了封装原则，ConsolidationService 可以通过 `_store` 绕过 TTL 检查和 LRU 驱逐逻辑

**🔴 控制论视角 — 记忆系统违背的原则**:

- **原则 7 (Hard Variety Ceiling) 违反**: KnowledgeGraph 的实体提取是纯正则的——它能提取的实体类型 variety (<10 种模式) 远小于实际环境中用户可能讨论的实体 variety（数百种）。这导致大量有意义的实体被遗漏，同时大量噪声被收录
- **原则 4 (Closed-Loop Cognition) 部分满足**: 记忆系统有 feedback loop（store→decay→search→accessCount increment→higher future score），但这个闭环是单向的——记忆的 "使用频率" 会影响未来的检索权重，但 "记忆被证明是错的" 不会自动纠正（必须外部显式调用 `addContradiction()` 或 `updateMemory()`）
- **原则 2 (Precision–Complexity Trade-off) 偏向 complexity**: 6 层管道（STM→WriteGate→CascadeBuffer→LTM→KnowledgeGraph→Decay）在处理不重要的 transient noise 时走了过多路径——简单的 "这是噪音，丢弃" 需要经过 regex 检查→daily 分类→cascadeBuffer staging→seal→LTM→decay→archive——整个过程可能需要 30+ 分钟才能确定 "这条记忆没价值"

**🔴 与系统其他部分的集成问题**:

- **MemoryProvider 接口与底层能力不匹配**: `MemoryProvider` 只定义了 5 个方法（getShortTerm/getProjectContext/getEntityPreferences/searchLongTerm/getRecentInsights）——但底层有 cascade buffer、write gate、contradiction detection、decay scoring 等丰富功能——这些能力在 Agent 上下文中完全不可见
- **STM 的 "记忆" 和 Session 的 "消息" 是两个独立系统**: ShortTermMemory 存的是 key-value（如 `session_brief`、`__cascade_meta__`），SessionManager 存的是对话消息——两者通过 `createStandardMemoryProvider.getShortTerm()` 被强行拼接在一起（对话消息 + KV 条目）——语义错位
- **Curator 走两套不同的记忆接口**: Curator consolidation 走 `ToolDependencies` (直接访问 shortTerm/longTerm/entity/project)，而 Agent 走 `MemoryProvider` 接口——两套接口的方法签名、返回格式、缓存策略都不同——这意味着对同一份记忆数据有两种不同的理解和访问方式

#### 功能冗余评估

| 组件                  | 必要性        | 判断                                                                                                                                                                |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ShortTermMemory       | 🟢 核心       | 提供会话级记忆缓存，Agent 必需                                                                                                                                      |
| LongTermMemory        | 🟢 核心       | 语义搜索+持久化，Agent 必需                                                                                                                                         |
| WriteGate             | 🟢 有价值     | 过滤噪音，但 regex 需要增强                                                                                                                                         |
| CascadeBuffer         | 🟡 未充分使用 | 概念好但 L0→L1 管道未闭环，基本被 Curator LLM consolidation 绕过                                                                                                    |
| KnowledgeGraph        | 🟡 过早       | 实体提取质量太低导致图不可用；矛盾检测因缺乏 LLM judge 基本不工作                                                                                                   |
| MemoryDecayService    | 🟢 核心       | 防止无限膨胀，Ebbinghaus 公式合理                                                                                                                                   |
| EntityMemory          | 🟢 核心       | Captain 偏好 + Employee 配置                                                                                                                                        |
| ProjectMemory         | 🟢 核心       | 项目级上下文持久化                                                                                                                                                  |
| ProjectIsolatedMemory | 🟡 可选       | 简单的 key 前缀 + filter 包装——可以在调用层处理而不需独立类                                                                                                         |
| MemoryOrchestrator    | 🔴 删除       | 空接口，从未实现——纯占位代码                                                                                                                                        |
| ConsolidationService  | 🟡 被绕过     | `consolidateBasic()` 在 context.ts 中每 30 分钟调用一次，但 Curator 系统实际用的是 `runCuratorConsolidation()`——后者走 AgentLoop 而不是 ConsolidationService 的管道 |

---

## 3. 控制论框架系统评估

### 3.1 八原则整体符合度

| #   | 原则                              | 符合度       | 关键证据                                                                                                      |
| --- | --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| 1   | **AI as Process**                 | **A-** (88%) | Checkpoint + ContextHandoff + conversationHistory 构成强过程连续性。SubconsciousLoop 因与主循环缺乏耦合扣分。 |
| 2   | **Precision–Complexity**          | **B+** (78%) | ContextMonitor 优雅。但阈值是静态的（40/60/80），模型路由无反馈学习。Tool variety 可能超过模型选择能力。      |
| 3   | **Dialogic Meaning**              | **B** (72%)  | TeachBack 存在但使用有限。多 Agent handoff 支持较好。但缺少对"用户反复纠正同一问题"模式的检测。               |
| 4   | **Closed-Loop Cognition**         | **A-** (85%) | AgentLoop StateGraph 完美实现 act→observe→adjust。AutoAdjuster 形成全局闭环。但 Curator 与主循环耦合弱。      |
| 5   | **Structural Determinism**        | **B+** (80%) | T0-T3 + DelegationTier 显式定义能力边界。PolicyEngine 提供硬约束。但外部 agent 边界定义不足。                 |
| 6   | **Viable Recursive Architecture** | **B+** (78%) | S1-S5 五层模型完整。但 S5 过于薄弱——无法有效仲裁。                                                            |
| 7   | **Hard Variety Ceiling**          | **B** (70%)  | ToolPruner + contextBudget 控制了两个 variety 维度。但缺乏定量度量——系统不知自己是否在逼近天花板。            |
| 8   | **From Command to Enablement**    | **B** (68%)  | Autopilot + Decision 框架体现 enablement 思维。但主动建议能力极弱——大多被动执行。                             |

### 3.2 Viable System Model (VSM) 映射

Cabinet 的架构可映射到 Stafford Beer 的 VSM 五层：

```
S5 (Policy):      PolicyEngine (~200 行) — 二元 yes/no 判断，不足
S4 (Intelligence): HarnessAnalyst + SubconsciousLoop + Curator Pattern Extraction
S3 (Control):     Curator + ObservabilityCollector + AutoAdjuster + BudgetGuard
S2 (Coordination): Dispatcher + AgentRoleRegistry + Secretary (IntentParser)
S1 (Execution):   AgentLoop + ToolExecutor + MCPManager + External Agents
```

**关键发现**: **S5 是最薄弱的层**。PolicyEngine 目前只是一个 yes/no gate，没有对 S3 和 S4 之间的冲突进行实质性仲裁。例如：

- S3 (AutoAdjuster) 建议 "切换到更便宜的模型节省成本"
- S4 (HarnessAnalyst) 建议 "当前任务需要更高精度模型"
- S5 应该根据 mission profile 权衡——但目前做不到

### 3.3 Variety 分析

**系统内部 Variety**:

- AgentLoop 可区分状态: ~10 (4 zones × 4 trust levels)
- Tool 选择空间: 50+ 内置 + 动态 MCP + 动态 Skill = ~100+
- Agent 类型: 15+ 内置角色 + 动态外部 agent

**环境 Variety**:

- 用户意图: 开放的 NL 空间
- 项目类型: 任意代码库
- 外部 MCP 工具: 不可预测

**Variety Gap**: 系统的 tool 暴露量 (~100) vs LLM 单轮可靠 tool selection 量 (~10-15) 之间存在显著 gap。`ToolPruner` 是对此的补救，但它基于关键词匹配而非语义理解。

---

## 4. 系统过重分析 — 哪些功能不应存在

### 4.1 明确过度设计的功能

#### 🔴 **Meeting 包 (699 行)** — 建议删除或大幅简化

实现了多 Agent 会议机制（发言、辩论、投票）。在当前 LLM 能力下几乎不可靠：

- LLM "辩论"受限于同模型生成 → echo chamber 风险
- "投票"本质是用更高 token 成本做决定——不如让更强 agent 直接判断
- 序列化/反序列化开销远超实际价值

**建议**: 删除，用 Dispatcher Parallel + handoff review 替代。

#### 🔴 **EL (Expression Language) 蓝图编译** — 建议移除

自定义 DSL 用于工作流定义。YAML 已足够表达工作流结构；引入新 DSL 意味着所有工具链从零构建、用户学习新语言、调试极难。

**建议**: 删除 EL 支持，统一用 YAML + TypeScript API。

#### 🟡 **SubconsciousLoop (harness)** — 概念好但实现过早

Bio-inspired 后台过程——随机采样 LTM 生成洞察。但生成的洞察没有反馈闭环——只是 SystemNotification 通知。与 AgentLoop 完全解耦——"潜意识"不"影响意识"。

**建议**: 保留概念但暂不激活。等 Curator + Consolidation 成熟后再以更结构化方式接入。

#### 🟡 **GarbageCollector (harness)** — 定位尴尬

扫描文件系统寻找死代码。是静态分析工具，非 AI 能力。当前 dryRun 模式——从不产生 actionable 输出。

**建议**: 如有明确需求，移到独立工具/plugin；否则删除。

#### 🟡 **BrowserPool / BrowserVerifier (harness)** — 基础设施而非业务逻辑

管理 Playwright 浏览器实例池——用于验证前端变更。属于测试/QA 工具链，不应嵌入 AI agent 框架核心。当前未被业务路径使用。

**建议**: 如果有明确需求，移到 `tests/` 或独立包。

### 4.2 功能冗余

#### 🟡 **Organize 包 (931 行)** vs **Workflow ManagerExecutor**

`OrganizeInteractiveAgent` 的规划→审查→部署循环与 Workflow ManagerExecutor 的 Plan-Dispatch-Review 高度重叠。

**建议**: 评估合并到 Workflow Manager 节点中。

#### 🟡 **agent-sdk 包 (806 行)** — 对外承诺过早

提供外部 Agent SDK (`SlotClient`, `A2AHelper`)。系统刚 alpha，外部生态未建成——现在就发布 SDK 是过早承诺：

- 内部接口快速变化中
- SDK API 表面在未来 6 个月内可能巨变
- 向后兼容维护拖慢核心迭代

**建议**: 保持 `private: true`，不发布到 npm。

#### 🟡 **MemoryOrchestrator (23 行空接口)** — 纯占位代码

`packages/memory/src/orchestrator.ts` 定义了 `MemoryOrchestrator` 接口（write/read/delete/consolidate），但**从未被任何类实现**。它是一份"设计蓝图"而非功能代码——在代码库中只增加了概念噪音。

**建议**: 删除。当需要统一的记忆编排层时再重新设计，届时将有实际的用例驱动接口设计。

#### 🟡 **ConsolidationService 与 Curator 系统的双管道竞争**

`ConsolidationService.consolidateBasic()` (WriteGate→CascadeBuffer→LTM 管道) 在 `context.ts` 中每 30 分钟被调用一次，但 Curator 系统实际用的是 `runCuratorConsolidation()`——后者走 AgentLoop + LLM consolidation。两套管道并行运行，对同一批 STM 数据做不同方式的 consolidation——可能产生重复记忆条目或冲突状态。

**建议**: 二选一。推荐保留 Curator LLM consolidation（质量更高），移除 ConsolidationService 的自动定时 consolidation（质量低且产生重复），或将 ConsolidationService 降级为 Curator 的内部工具（仅做预过滤，不做独立 consolidation）。

### 4.3 不必要的依赖

审查 server 依赖是否被实际使用：

- `xlsx` / `mammoth` / `pdf-parse` — 文件解析库，未见实际使用路径
- `adm-zip` — ZIP 处理，桌面端已有 `jszip`
- `nodemailer` — 邮件发送，未见邮件通知功能
- `node-notifier` — 系统通知，Tauri 桌面已有原生通知

**建议**: 移除未使用的依赖，减少安全面。

---

## 5. 系统演进方向建议

### 5.1 短期 (1-2 个月): 质量加固

| 优先级 | 任务                                                        | 原因                                            |
| ------ | ----------------------------------------------------------- | ----------------------------------------------- |
| **P0** | 统一 `run()` 和 `runStreaming()` 的共享逻辑                 | 当前双路径是最大维护负担和 bug 源               |
| **P0** | 强化 S5 PolicyEngine                                        | 当前 Policy 无法有效仲裁 S3 vs S4               |
| **P1** | 添加 Tool variety 度量                                      | 追踪暴露工具数 vs 使用工具数 → variety gap 指标 |
| **P1** | 修复 Session 级并发安全                                     | SkillRegistry/SessionManager 竞态条件           |
| **P1** | 移除 EL 蓝图支持                                            | 减少概念负担                                    |
| **P2** | 删除或独立化 meeting 包                                     | Dispatcher Parallel 替代                        |
| **P2** | **记忆: 统一 Curator 和 ConsolidationService 管道**         | 消除双 consolidation 竞争——二选一               |
| **P2** | **记忆: 删除 MemoryOrchestrator 空接口 + \_store 封装修复** | 消除死代码和封装泄漏                            |
| **P2** | **记忆: HNSW fallback — brute-force cosine on SQLite**      | hnswlib-node 不可用时的降级方案                 |

### 5.2 中期 (3-6 个月): 自适应深化

| 优先级 | 任务                                               | 原因                                       |
| ------ | -------------------------------------------------- | ------------------------------------------ |
| **P1** | 自适应 ContextMonitor 阈值                         | 基于历史数据按模型/任务类型学习最优阈值    |
| **P1** | 模型路由反馈学习                                   | 记录 fallback 成功率，动态调优路由         |
| **P1** | S5 Policy 从二元判断到数值权衡                     | 根据 mission profile 加权决策              |
| **P1** | **记忆: KnowledgeGraph 实体提取升级为轻量 NER**    | 替换纯正则——用 compromise.js 或 small BERT |
| **P1** | **记忆: WriteGate 多语言 regex 覆盖增强**          | 覆盖中日英法西德六大语言的记忆触发词       |
| **P2** | Context Slot → 正式 Shared Data Bus                | schema 验证 + 版本控制 + 冲突解决          |
| **P2** | Agent-Agent 实时事件通信                           | 非仅 handoff 文档                          |
| **P2** | **记忆: CascadeBuffer LLM summarizer 注入 + 去重** | 让 L0→L1 管道实现其设计意图                |
| **P3** | Dashboard 实时化                                   | WebSocket 推送 agent/工作流/预算状态       |

### 5.3 长期 (6-12 个月): 生态与自治

| 优先级 | 任务                                    | 原因                                                    |
| ------ | --------------------------------------- | ------------------------------------------------------- |
| **P1** | MCP resource/prompt 支持                | 发挥 MCP 协议全部能力                                   |
| **P1** | 外部 Agent 发现协议                     | 让 agent-sdk 成为真正的生态工具                         |
| **P1** | **记忆: LLM-powered 矛盾检测实际启⽤**  | 注入 llmJudge 到 KnowledgeGraph — 让矛盾检测真正工作    |
| **P2** | ProcessIdentityScore                    | 量化长时间运行工作流的 coherence                        |
| **P2** | 主动建议引擎                            | 系统应主动提议而非被动执行                              |
| **P3** | 跨项目知识迁移                          | Curator 从多项目学习通用模式                            |
| **P3** | **记忆: Ebbinghaus 衰减参数自适应学习** | 不同用户/领域的半衰期不同——从 30 天默认值学习个性化参数 |

---

## 6. 总体评级与优先级矩阵

### 系统成熟度评级

| 维度             | 评级   | 说明                                                                                                                                                                                |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **架构设计**     | **A-** | 优秀的 4 层分离 + VSM 五层映射，但 S5 薄弱                                                                                                                                          |
| **代码质量**     | **B+** | agent 核心逻辑清晰，但 closure-heavy 削弱可测试性                                                                                                                                   |
| **过程连续性**   | **A-** | Checkpoint + Handoff 双重机制，但 recovery 路径单一                                                                                                                                 |
| **记忆系统**     | **B+** | 分层架构雄心卓越（STM→WriteGate→CascadeBuffer→LTM+KG+Decay），但实现断层多: KnowledgeGraph 实体提取不可靠、矛盾检测未闭环、CascadeBuffer 被 Curator 绕过、MemoryOrchestrator 是空壳 |
| **Variety 管理** | **B**  | ContextMonitor + ToolPruner 两个管理维度，但缺乏定量度量                                                                                                                            |
| **安全边界**     | **B+** | T0-T3 + DelegationTier 清晰，但 MCP 工具安全薄弱                                                                                                                                    |
| **可观测性**     | **B+** | ObservabilityCollector + SessionMetrics，但 Dashboard 展示不足                                                                                                                      |
| **生态开放性**   | **B**  | HarnessRuntime + MCP + agent-sdk 三扩展点，agent-sdk 过早                                                                                                                           |
| **系统体重**     | **C+** | 存在 8-10 个可删除/简化的功能模块（含记忆系统的 MemoryOrchestrator、双 consolidation 管道）                                                                                         |

### 核心问题 Top 5

1. **S5 (Policy) 层薄弱** — 无法在自动化（S3）和适应性（S4）之间做出实质性权衡。这是整个 VSM 架构中最关键的缺陷。
2. **功能膨胀** — Meeting/EL/Organize/agent-sdk/MemoryOrchestrator/GarbageCollector/BrowserPool/双 consolidation 管道在 alpha 阶段引入了不必要的复杂度，拖慢了核心迭代速度。
3. **双路径维护负担** — `run()` vs `runStreaming()` 的代码重复是技术债务的主要来源，应该在架构层面统一。
4. **记忆系统实现断层** — 架构设计优秀（6 层管道 + Ebbinghaus 衰减 + RRF 混合搜索），但 WriteGate 的多语言脆弱性、KnowledgeGraph 的实体提取不可靠、矛盾检测从未启用 LLM judge、CascadeBuffer 被 Curator 绕过——导致设计意图和实际效果之间存在显著 gap。
5. **两套记忆接口分歧** — Curator 走 `ToolDependencies` 直接访问底层记忆，Agent 走 `MemoryProvider` 接口间接访问——两套方法签名、返回格式、缓存策略都不同，对同一份数据有两种不同的"理解"方式。

### 综合评分: **B+** (81/100)

Cabinet 是一个**设计理念先进但实现上有冗余**的 AI Agent 操作系统。核心循环（AgentLoop）、上下文管理（ContextMonitor/Handoff）、安全边界（SafetyChecker）、和记忆系统架构（STM→LTM 管道 + Ebbinghaus 衰减 + RRF 混合搜索）做出了卓越的工程决策。控制论基础坚实——特别是过程连续性机制和闭环认知架构在同类系统中处于领先。

**记忆系统的困境是全局困境的缩影**: 架构设计具有前瞻性（total-recall 风格的分层记忆 + 矛盾检测 + 知识图谱），但实现细节（纯正则实体提取、双 consolidation 竞争、空接口占位、封装泄漏）揭示了 alpha 阶段普遍存在的 "架构雄心 > 工程成熟度" 问题。

如果能在接下来 1-2 个月内完成短期优先级的加固工作（特别是统一双 consolidation 管道和升级 KnowledgeGraph 实体提取），Cabinet 将成为在架构完整性上达到 L4（自适应）级别的系统——这在当前开源生态中是少有的成就。

---

## 7. 系统性全面优化方案

> **原则**: 不是修补孤立问题，而是从架构层面消除冗余、统一模式、补强薄弱层。优化是**分层推进**的——每一阶段的产出是下一阶段的基础，不可跳跃。
>
> **⚠️ 重要声明**: 经实际代码验证后，初版方案存在数据和判断错误（见下方各子项标注）。本版已全部修正。

---

### 第〇阶段 (前置): 预研与基线建立 (预计 1.5 周)

**为什么需要**: 上一版方案存在多处数据误读——CLI Runtime 行数低估了 5-10 倍、AgentLoop 统一被误判为"包装器"而非"能力补全"、CascadeBuffer 删除的风险未评估。在动代码之前必须先建立基线。

#### 0.1 静态分析基线

| 任务                                                                                   | 产出                                      |
| -------------------------------------------------------------------------------------- | ----------------------------------------- |
| 精确统计每个待重构模块的行数和依赖图                                                   | `depgraph.json` — 基于 `madge` 或手写脚本 |
| 确认 GarbageCollector / BrowserPool / 文件解析器（xlsx/mammoth/pdf-parse）的真实引用链 | 删除/降级决策的依据                       |
| 确认 meet 包是否被任何业务路径 import                                                  | grep `@cabinet/meeting` 全项目            |

#### 0.2 动态基线

| 任务                                                                                   | 产出                             |
| -------------------------------------------------------------------------------------- | -------------------------------- |
| `consolidateBasic()` 30 分钟周期中 daily-tier 进入 CascadeBuffer 的实际条目数和频率    | CascadeBuffer 删除决策的成本依据 |
| `adjustmentNotifyCallback` 在 T0/T1 模式下被调用的频率（确认 PolicyEngine 介入的范围） | S5 改造的准确 scope              |
| Dispatcher 的 `runPipeline`/`runParallel`/`runSingle` 实际调用分布（哪条路径占比最高） | 统一工作的优先级                 |

#### 0.3 测试基线

| 任务                                                                           | 产出                   |
| ------------------------------------------------------------------------------ | ---------------------- |
| 为 AgentLoop `run()` vs `runStreaming()` 建立**输出一致性表征测试**            | 重构的回归安全网       |
| 为 Dispatcher 三种模式建立**端到端表征测试**                                   | 拓扑统一后的回归安全网 |
| 为 Workflow 引擎建立**蓝图→执行→输出**的端到端测试（覆盖 YAML 和 EL 两种输入） | EL 删除的安全前提      |

**基线验证的硬门槛**: 完成 0.2（CascadeBuffer 成本测算）之前，不得做出 "CascadeBuffer 删除 vs 保留" 的最终决策。完成 0.3（AgentLoop 表征测试）之前，不得开始 AgentLoop 统一。

---

### 第一阶段: 大一统 — 消除分支冗余 (预计 4-5 周)

> ⚠️ 初版工期低估。第〇阶段的产出会影响每个子项的实际工作量。

#### 1.1 CLI Harness: 提取公共基类 (预计 1 周)

**修正**: 初版声称 CLI Runtime "各 30-36 行"——**严重误读**。实际代码量：

| 文件             | 实际行数     |
| ---------------- | ------------ |
| `claude-code.ts` | 439 行       |
| `codex.ts`       | 353 行       |
| `opencode.ts`    | 342 行       |
| `generic.ts`     | 313 行       |
| `a2a.ts`         | 570 行       |
| `factory.ts`     | 133 行       |
| **合计**         | **2,150 行** |

每个 Runtime 都有完整的 spawn/stdio 管理、超时处理、错误恢复、deliverable 解析逻辑。**不是"30 行配置差异"，而是普遍 300+ 行的独立子进程引擎**。

**修正后的方案**:

```
GenericCliRuntime (313 行, 保持现有代码)
    │
    ├── 这是当前的 fallback runtime，已经是所有 CLI runtime 的隐式基类。
    │   问题在于其他 runtime 没有继承它——它们从头实现了自己的子进程管理。
    │
    ├── 重构: 将 GenericCliRuntime 提升为显式基类
    │   - start/stop/healthCheck → 保持不变（当前实现已正确）
    │   - dispatchTask → 保持通用逻辑（spawn + stdio + marker parsing）
    │   - 提取注入点:
    │     ├── buildPrompt(task)    → 子类覆盖（特化 prompt 格式）
    │     ├── buildArgs(task)      → 子类覆盖（特化 CLI 参数）
    │     ├── parseDeliverable(raw) → 子类覆盖（解析 markdown/json/stream 输出）
    │     └── injectSkill()        → 子类覆盖（特化 skill 注入语法）
    │
    ├── ClaudeCodeRuntime extends GenericCliRuntime (~100 行, 从 439 行减少)
    │   - buildArgs: --output-format stream-json --verbose --permission-mode ...
    │   - parseDeliverable: 解析 stream-json 块
    │   - injectSkill: Claude Code SKILL.md 语法
    │
    ├── CodexRuntime extends GenericCliRuntime (~80 行, 从 353 行减少)
    │   - buildArgs: --json ...
    │   - parseDeliverable: 解析 JSON chunk stream
    │
    ├── OpenCodeRuntime extends GenericCliRuntime (~80 行, 从 342 行减少)
    │
    └── A2AHarnessRuntime — 独立 (570 行 → ~400 行)
        - HTTP REST, 非子进程 → 不继承 GenericCliRuntime
        - 但共享 HarnessRuntime 接口 + ExternalAgentAdapter
```

**关键修正**: 这不是"5→1 基类 + 3 个 15 行子类"，而是"313 行基类 + 3 个 80-100 行子类 + 1 个独立 HTTP Runtime"。总行数从 2,150 → ~1,500，主要节省来自消除重复的子进程管理代码（3 个 Runtime 各自实现了 spawn/stdio/timeout/error-handling）。

**为什么放第一阶段第一位**: CLI Runtime 的重构不依赖其他任何模块——它是独立的适配器层。放第一个可以在最短时间内验证重构模式。

---

#### 1.2 AgentLoop: 合并 `run()` 和 `runStreaming()` (预计 2-3 周)

**修正**: 初版将此描述为"将 run() 包装为 runStreaming() 的同步调用"——**错误**。

**关键事实**:

- `run()` 拥有 `runStreaming()` 完全不具备的三大能力：StateGraph 编译、Checkpoint 持久化（每 5 步）、ContextMonitor（Smart/Dumb Zone 检测 + Handoff 触发）
- `runStreaming()` 的注释（agent-loop.ts:869）明确写道: "Does NOT support checkpoint resumption or context monitoring (use run() for those)"
- 统一不是代码包装——**是向 streaming 路径补全这三项缺失能力**

**修正后的方案**:

```
新架构: 统一的 AgentEngine (替换 AgentLoop 类)

AgentEngine.run(input, options):
    │
    ├─ ContextAssembly (复用当前 ContextBuilder)
    │
    ├─ [Unified Execution Loop]  ← 唯一执行路径
    │   │
    │   ├─ LLM 交互: AI SDK streamText  ← 始终流式
    │   │   - non-streaming 调用方: 在 done 回调中收集全文 → 一次返回
    │   │   - streaming 调用方: 每个 chunk 通过 callback 实时推送
    │   │
    │   ├─ Observer Pipeline (中间件链):
    │   │   1. ContextMonitorObserver   ← 新增: 每步评估 zone
    │   │   2. HandoffObserver          ← 新增: critical/dumb → 中断 + handoff + 重启
    │   │   3. SafetyCheckObserver      ← 从 run() 的 safetyCheck 节点迁移
    │   │   4. ToolExecuteObserver      ← 从 run() 的 tools 节点迁移
    │   │   5. CheckpointObserver       ← 新增: 每 5 步异步写 checkpoint
    │   │
    │   └─ 所有 Observer 共享 onChunk / onToolCall / onToolResult 回调
    │
    └─ 结果: AgentResult + SessionSummary (与当前 run() 的 onSessionComplete 对齐)
```

**不再是删除 StateGraph**: StateGraph 的 `Annotation` reducer 模式保留——它让状态变更可追溯。但**不再每次 run() 都重新编译 graph**——Observer 是预编译的管道。

**为什么这里是能力补全而非代码迁移**: 要在 streaming 路径中加入 checkpoint 和 context monitoring，需要解决几个新问题：

1. Streaming 中 ContextMonitor 何时评估 token 利用率？→ 每个 `tool_result` chunk 后评估一次
2. Streaming 中 Handoff 如何中断？→ 在 AI SDK 的 `onChunk` 中检测 zone crossing，调用 `stream.abort()` → 重启 stream（带 handoff 注入）
3. Streaming 中 Checkpoint 的"每 5 步"如何计数？→ Observer 内部维护 step counter，与 streaming 的解耦

**预期收益**:

- agent-loop.ts 从 1,137 行 → ~900 行（不是初版声称的 700 行——Observer 基础设施本身需要代码）
- `buildRunGraph()` 被 `ObserverPipeline` 替代（~200 行 → ~100 行）
- `run()` 和 `runStreaming()` 的接口仍保留（向后兼容），但内部走同一路径
- 所有 agent 自动获得 streaming + checkpoint + context monitoring 全套能力

---

#### 1.3 Dispatcher: 统一 DispatchGraph (预计 1 周)

**修正**: 初版声称 Dispatcher 的 pipeline 模式和 WorkflowEngine 有重叠——**错误**。

**关键事实**:

- Grep 验证: `runPipeline` / `runParallel` 在 workflow 包中 **零引用**
- Dispatcher 纯粹在 `@cabinet/agent` 内部使用，只被 `secretary/chat.ts` 和 `secretary/tool-dependencies.ts` 调用
- Dispatcher 和 WorkflowEngine 没有任何交叉——它们是两个独立层次的调度

**修正后的方案**:

```
当前问题不是 Dispatcher 和 Workflow 有重叠——而是 Dispatcher 内部有 3 个构建 AgentLoop 的重复路径。

新架构: DispatchNode (轻量 StateGraph)

dispatch(options):
    │
    ├─ 内部将角色列表编译为 StateGraph:
    │   ├─ single:   [AgentNode(role)] → END
    │   ├─ pipeline: [AgentNode(r1)] → [AgentNode(r2)] → ... → END
    │   └─ parallel: fork([AgentNode(r1), AgentNode(r2), ...]) → SynthesizeNode → END
    │
    └─ 统一 execute(graph) —— AgentNode 是唯一创建 AgentLoop 的地方

不做的事:
  ✗ 不把 Dispatcher 的 pipeline 移到 Workflow 层 —— 这错误地改变了 @cabinet/agent 的 API 边界
  ✓ Dispatcher 保持为 Agent 层的调度器，Workflow 保持为跨 Agent 的工作流引擎
```

**预期收益**:

- dispatcher.ts 从 387 行 → ~220 行
- `runSingle`/`runPipeline`/`runParallel` 三个方法统一为一个 `executeGraph()`
- Parallel 的并发控制从手动 batch 改为 graph 层自动调度

---

#### 1.4 Workflow: 合并执行路径 + 建设 YAML 解析器 (预计 1.5-2 周)

**修正**: 初版同时提出"合并 3 条路径"和"删除 EL"——**顺序错误**。

**关键事实**:

- EL 编译器 (`el-compiler.ts`) 是 **534 行**的完整实现（含 Tokenizer + Parser），不是 "~200 行 DSL"
- EL 的 `compileEL()` 在 server 热加载路径中被调用 (`context.ts:1405-1407`): 蓝图文件变更时，`.el` 文件通过 `compileEL()` 编译验证
- YAML "验证器" (`blueprint-validator.ts`) 只是从 `@cabinet/organize` re-export —— **workflow 包没有自己的 YAML 解析器**
- ManagerExecutor 只在 `engine.ts` 中被 import —— 它已经是 WorkflowEngine 的内部实现（虽然 export 声明为 public）

**修正后的方案**:

```
Step A (先建): 实现 workflow 包自己的 YAML 解析器
    ├─ 安装 js-yaml (当前仅在 server 层动态 import)
    ├─ 实现 parseBlueprint(yamlStr) → Blueprint
    └─ 在 blueprint-watcher 中对接 YAML 热加载 → 替换 EL 热加载路径

Step B (再删): 删除 EL 编译器和热加载路径
    ├─ 删除 el-compiler.ts (534 行)
    ├─ 从 index.ts 移除 parseEL/compileEL 导出
    ├─ 从 context.ts 移除 .el 文件的热加载分支
    └─ 从 package.json 移除 EL 相关依赖

Step C (合并): 统一 ManagerExecutor → WorkflowEngine
    ├─ ManagerExecutor 的 Plan-Dispatch-Review-Synthesize 作为 ManagerNode 内部实现
    ├─ 删除 ManagerExecutor 的 public export（从 index.ts 移除）
    └─ engine.ts 不再 import ManagerExecutor，直接在内部使用

不做的事:
  ✗ 不把 Dispatcher.runPipeline 移到 Workflow 层 —— Dispatcher 是 Agent 调度，Workflow 是跨 Agent 编排
  ✓ Dispatcher 始终在 @cabinet/agent 内，WorkflowEngine 通过组合使用它
```

**预期收益**:

- 用户可见的工作流定义方式: YAML + TypeScript API（二选一→一）
- 删除 534 行 EL 编译器
- ManagerExecutor 不再是公共 API——消除 "Workflow 有两个入口" 的歧义

---

#### 1.5 记忆系统: 合并双管道 (预计 1 周 — 取决于第〇阶段成本测算)

**修正**: 初版声称 CascadeBuffer "可被 Curator LLM 替代"——**未评估成本**。

**关键事实**:

- `consolidateBasic()` (WriteGate→CascadeBuffer→LTM) 每 30 分钟运行一次，**零 LLM 调用**——纯规则驱动
- `runCuratorConsolidation()` (AgentLoop→LLM) 仅在 session 关闭或每 4 小时 nudge 时触发，**每次都走 LLM**
- CascadeBuffer 处理的是 WriteGate 分类为 "daily" 的条目——这些是**中低价值**的信息，不适合每次都用 LLM 处理
- 如果删除 CascadeBuffer，daily 条目只有两条路：①丢弃（信息丢失）②走 LLM consolidation（成本增加）

**修正后的方案**:

```
在第〇阶段先完成 CascadeBuffer 成本测算:

问: 30 分钟周期中, 有多少 daily 条目进入 CascadeBuffer?
    ├─ 如果很少 (< 50/天) → 升级为 register tier (直接 LTM) 或走 Curator LLM
    └─ 如果很多 (> 200/天) → CascadeBuffer 必须保留或优化（零 LLM 成本是优势）

Scenario A: CascadeBuffer 保留
    ├─ 修复 CascodeBuffer 的默认 summarizer → 加入去重和重要性排序
    ├─ 将 ConsolidationService 的定时 consolidateBasic() 和 Curator 的 LLM consolidation
    │   做职责分离:
    │   ├─ consolidateBasic() → 只处理 daily tier (轻量, 零 LLM)
    │   └─ Curator → 只处理 register/working tier (深度, LLM)
    └─ 两条管道不再竞争——处理不同的 tier

Scenario B: CascadeBuffer 删除 (仅在低成本条件下)
    ├─ WriteGate 的 daily tier 移除 → 所有 daily 条目升级为 register
    ├─ Curator LLM consolidation 统一处理所有 register+ 条目
    └─ 注意: 这会增加 Curator 的 LLM 调用频率和总成本
```

**无论选 A 还是 B，以下内容不变**:

- 删除 `MemoryOrchestrator` 空接口（23 行）——从未实现
- 修复 `ShortTermMemory._store` 封装泄漏——ConsolidationService 改用公共 API
- 新增 `ConsolidationMetrics` 日志——记录每条 consolidation 管道的条目数、耗时、成本——作为后续优化的数据基础

---

### 第二阶段: 削冗 — 删除/降级/外移 (预计 2 周)

#### 2.1 完全删除

| 删除项                 | 实际行数 | 前置条件                 | 理由                            |
| ---------------------- | -------- | ------------------------ | ------------------------------- |
| **meeting 包**         | 699 行   | 确认无业务路径依赖       | 多 Agent 会议——LLM "辩论"不可靠 |
| **EL 编译器**          | 534 行   | 1.4 的 YAML 解析器已建成 | 自定义 DSL——YAML 已足够         |
| **MemoryOrchestrator** | 23 行    | 无                       | 空接口——从未实现                |
| **GarbageCollector**   | ~150 行  | 确认无业务路径依赖       | 静态分析工具——非 AI 框架核心    |

**CascadeBuffer (115 行) —— 删除决策待定**。取决于第〇阶段成本测算。如果保留，优化其 summarizer（加入去重 + 重要性排序）。

**总计删除**: ~1,406 行（含 EL 534 行），CascadeBuffer 待定。

#### 2.2 降级为内部实现

| 模块                     | 当前状态                  | 降级后                                     |
| ------------------------ | ------------------------- | ------------------------------------------ |
| **Organize 包** (931 行) | 独立包                    | 合并入 Workflow 的 ManagerNode——对外不可见 |
| **agent-sdk**            | 已发布到 npm              | 改 `private: true`，发布前需要 API 冻结    |
| **BrowserPool/Verifier** | @cabinet/harness 公共导出 | 确认业务路径引用后，移到 `tests/e2e/`      |

#### 2.3 依赖清理

| 当前依赖        | 动作                     | 验证方法           |
| --------------- | ------------------------ | ------------------ |
| `xlsx`          | 移除                     | grep 确认无 import |
| `mammoth`       | 移除                     | grep 确认无 import |
| `pdf-parse`     | 移除                     | grep 确认无 import |
| `adm-zip`       | 移除（桌面端用 jszip）   | 确认 server 无引用 |
| `nodemailer`    | 移除                     | grep 确认无 import |
| `node-notifier` | 移除（Tauri 有原生通知） | 确认 server 无引用 |

---

### 第三阶段: 补强 — 修复薄弱层 (预计 3-4 周)

#### 3.1 S5 PolicyEngine: 从二元判断到加权仲裁

**修正**: 初版声称 "adjustmentNotifyCallback 总是返回 true"——**部分正确但缺失关键上下文**。

**关键事实**:

- `adjustmentNotifyCallback` **仅在 T0/T1 模式下被调用**（`needsApproval = tier === 'T0' || tier === 'T1'`）
- T2/T3 模式下，AutoAdjuster **直接执行调整**——完全绕过 callback
- 这意味着 S5 当前只在 T0/T1 有存在感——T2/T3 是 S3 (AutoAdjuster) 的"自治区"，Policy 完全缺席

**修正后的方案**:

```
新 PolicyEngine 需要介入两个通道:

通道 A: T0/T1 的 approval 回调（已有, 需要提质）
    ├─ 当前: adjustmentNotifyCallback → 总是 return true
    └─ 改造: PolicyEngine.arbitrate(action, missionProfile)
              → 如果 action 符合 policy → approve
              → 如果 borderline → 附带解释 approve（Captain 可见）
              → 如果违反 policy → reject + 给 Captain 发通知

通道 B: T2/T3 的自动执行（新增, PolicyEngine 完全缺席）
    ├─ 当前: AutoAdjuster 直接执行, PolicyEngine 不参与
    └─ 新增: 在执行前调 PolicyEngine.validate(action, missionProfile)
              → 如果高置信度违反 → block + 记录 AuditLog
              → 如果 borderline → 执行但 flag 给 Captain review
              → 如果符合 → 放行

此外:
  - MissionProfile 作为 EntityMemory 中 Captain preferences 的子集
  - 从 PreferenceLearner 的决策历史中自动推断 riskTolerance/costSensitivity
    （而非要求 Captain 手动配置）
```

---

#### 3.2 KnowledgeGraph: 正则实体提取 → 轻量 NER

**修正**: 初版方案方向正确。补充:

- **compromise.js 的实际能力**: 英文 NER 支持人名/组织/地点/日期/数字，准确率约 85%+。不覆盖中文。
- **中文方案修正**: jieba 分词不是 Node.js 原生，需要 nodejieba（有 native 依赖）。替代方案：使用 `@anthropic-ai/tokenizer` 的词表做中文 token 边界检测（中文词通常在 token 边界上对齐），或直接用 Haiku 做批量实体提取（每 store 批次一次，而非每条 memory 一次）

**修正后的 Phase 1**: compromise.js (英文) + token-boundary heuristics (中文/日文/韩文) → 而非 jieba

---

#### 3.3-3.5 其余补强项: 方向不变

WriteGate 双通道、矛盾检测 LLM Judge 注入、MemoryFacade 统一接口——初版方向正确，细节在第〇阶段基线数据出来后再细化。

---

### 第四阶段: 升级 — 代际提升 (预计 4-6 周)

方向不变: ContextMonitor 自适应阈值 / Agent Blackboard / ProcessIdentityScore / MCP 完整协议。

**新增**: 在这一阶段前，必须完成第三阶段的所有补强——第四阶段的 Agent Blackboard 依赖 MemoryFacade 统一接口完成；ProcessIdentityScore 依赖 ContextMonitor 自适应阈值完成。

---

### 优化路线图总览 (修正版)

```
Week 0-1.5 │ 第〇阶段: 预研与基线
           │ ├─ 0.1 静态分析 (依赖图 + 引用链)
           │ ├─ 0.2 动态基线 (CascadeBuffer 成本 + Policy 调用频率)
           │ └─ 0.3 测试基线 (AgentLoop + Dispatcher + Workflow 表征测试)
           │
Week 2-7   │ 第一阶段: 大一统 (5 周)
           │ ├─ 1.1 CLI Harness 基类提取 (1 周) — 2,150 → ~1,500 行
           │ ├─ 1.2 AgentLoop 统一 + Observer Pipeline (2-3 周) — 能力补全, 非简单包装
           │ ├─ 1.3 Dispatcher DispatchGraph 统一 (1 周) — 3 方法 → 1 executeGraph
           │ ├─ 1.4 Workflow YAML 解析器 + 删 EL + 合并入口 (1.5-2 周)
           │ └─ 1.5 记忆双管道 (1 周 — 取决于 0.2 产出)
           │
Week 8-9   │ 第二阶段: 削冗 (2 周)
           │ ├─ 删除 meeting / EL / MemoryOrchestrator / GC
           │ ├─ 降级 organize / agent-sdk / BrowserPool
           │ └─ 清理未使用依赖 (xlsx/mammoth/pdf-parse/adm-zip/nodemailer)
           │
Week 10-13 │ 第三阶段: 补强 (3-4 周)
           │ ├─ S5 PolicyEngine 加权仲裁 (T0-T3 全覆盖)
           │ ├─ KnowledgeGraph 轻量 NER
           │ ├─ WriteGate 双通道 (regex + embedding)
           │ ├─ 矛盾检测 LLM Judge 注入
           │ └─ MemoryFacade 统一接口
           │
Week 14-19 │ 第四阶段: 升级 (4-6 周)
           │ ├─ ContextMonitor 自适应阈值
           │ ├─ Agent Blackboard 实时通信
           │ ├─ ProcessIdentityScore
           │ └─ MCP 完整协议支持
           │
           ▼
         L4 自适应 AI Agent 操作系统
```

### 包结构变化对比 (修正版)

```
优化前 (17 packages):                  优化后 (13 ± 1 packages):

Layer 4: ui, server, desktop, cli      Layer 4: ui, server, desktop, cli
Layer 3: decision, secretary,          Layer 3: decision, secretary,
         workflow, harness,                     workflow, harness
         organize, meeting   ←─ 合并/删除        (organize 合并入 workflow)
Layer 2: agent, gateway,               Layer 2: agent, gateway,
         memory, agent-sdk                      memory
                                      ←─ agent-sdk → private
Layer 1: types, storage,               Layer 1: types, storage,
         graph, events                          graph, events

删除: meeting, EL (534 行), MemoryOrchestrator, GarbageCollector
降级: organize → workflow 内部, agent-sdk → private, BrowserPool → tests/
待定: CascadeBuffer (取决于成本测算)
```

### 工作量校准表

| 模块                  | 初版估算             | 修正版估算                          | 原因                                                            |
| --------------------- | -------------------- | ----------------------------------- | --------------------------------------------------------------- |
| CLI Harness 统一      | "各 30-36 行" → 轻松 | 2,150 行, 1 周                      | 实际是 5 个完整子进程引擎                                       |
| AgentLoop 统一        | "包装器" → 几天      | 能力补全, 2-3 周                    | 向 streaming 路径新增 checkpoint + context monitoring + handoff |
| Workflow 合并 + 删 EL | 同时做 → 1-2 周      | 先建 YAML 解析器, 再删 EL, 1.5-2 周 | 534 行 EL 是热加载依赖, 不能先删                                |
| CascadeBuffer 删除    | 直接删               | 待定 → 0.2 成本测算后决策           | 零 LLM 成本的 daily 汇总删除有成本风险                          |
| 预研                  | 不存在               | 1.5 周                              | 被验证为必要——没有基线就无法判断影响                            |
| 测试                  | 不存在               | 融入每个阶段                        | 表征测试是重构的安全网                                          |
| **总工期**            | **16 周**            | **18-20 周**                        | +12.5-25%                                                       |
