# Cabinet 项目 — 全面功能实现审查报告

**审查日期**: 2026-06-02
**审查范围**: 全栈（packages/* × 15 + apps/server + apps/desktop + tests/* + CI/CD + 文档）
**代码规模**: ~50,000 行 TypeScript，~280 个源码文件，72 个测试文件
**审查方法**: 源码逐层审阅、依赖分析、测试执行、架构规范一致性检查

---

## 一、总体摘要

Cabinet 是一个架构愿景极为先进的 AI 多智能体协作框架，具备完整的控制论闭环设计（TAOR 循环、L0-L3 分级决策、T0-T3 委托层级、多层记忆系统）。**功能实现度约为 75%** —— 核心引擎与基础设施已可用，但业务编排层、测试体系、安全边界存在显著缺口，部分功能停留在"接口定义"或"最小可行实现"阶段。

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | 82/100 | 4 层依赖清晰，控制论闭环完整，但 God File 严重破坏可维护性 |
| 功能完整度 | 75/100 | 核心链路通（秘书 → Agent → 网关 → 记忆），但策略层、 harness、质量门大量未实现 |
| 工程实现质量 | 62/100 | 类型系统被 any/as 削弱，空 catch 块普遍，硬编码值多 |
| 测试覆盖 | 48/100 | 72 个测试文件但分布极不均衡；harness/secretary/core 路由严重缺测 |
| 安全合规 | 55/100 | 认证层未启用、命令注入防护分裂、硬编码盐值（已有修复计划） |
| 文档规范一致性 | 65/100 | README 详尽，但文档与代码严重不符（认证、CORS、环境变量） |
| **综合** | **65/100** | Alpha 级别可用，但距离生产发布需完成 P0-P1 修复及测试补全 |

---

## 二、架构依赖审视

项目采用 **pnpm workspace monorepo**，自顶向下 4 层架构：

```
Layer 4 (Interface):   ui, server, desktop, cli
Layer 3 (Business):    decision, secretary, meeting, workflow, harness, organize
Layer 2 (Agent Core):  gateway, agent, memory
Layer 1 (Infra):       types, events, storage, graph
```

### 依赖方向审查

✅ **下层不依赖上层**：`types`/`storage`/`events` 无上层引用；`graph` 仅依赖 `storage`；`gateway` 仅依赖 `storage`/`types`。

⚠️ **同层依赖合理但存在风险**：
- `organize` → `agent` → `events`/`graph`/`memory`/`storage`/`types`：链路过长，organize 的 blueprint deploy 间接触碰了几乎所有基础设施。
- `workflow` → `organize`（仅为了 re-export `validateBlueprint`），而 `organize` 又依赖 `agent` 和 `workflow` 概念，存在循环语义耦合。
- `secretary` → `agent`/`memory`/`decision`/`gateway`：秘书作为中央路由器，耦合了 Layer 2 和 Layer 3 的几乎所有核心包，这是架构设计允许的，但实现上未通过接口隔离。

⚠️ **`graph` 的定位模糊**：`graph` 属于执行引擎（LangGraph 风格），但 `CABINET.md` 未明确其层级。它目前处于 Layer 1 与 Layer 2 之间。

---

## 三、基础设施层（Layer 1）功能实现逐项审视

### 3.1 `@cabinet/types` — 共享类型定义

**功能实现度**: 90%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| 基础领域模型（Project, Employee, Skill, Workflow） | ✅ 完整 | 类型设计良好，const + type 模式模拟枚举 |
| 事件消息体系（MessageEnvelope, PayloadMap） | ✅ 完整 | 21 种消息类型， discriminated union 正确 |
| 决策状态机类型 | ✅ 完整 | `ALLOWED_TRANSITIONS` 显式定义，有 `isValidTransition` 守卫 |
| 边界与预算类型（DelegationTier, BudgetCap） | ✅ 完整 | T0-T3 四层委托，预算分层清晰 |
| Blueprint / AgentOutput 类型 | ⚠️ 完整但混合 | `WorkflowNodeDef`（新）与 `WorkflowStep`（废弃）共存，`WorkflowDefinition.steps` 仍引用旧类型 |
| 运行时校验 | ❌ 缺失 | 纯编译时类型，无 Zod/io-ts schema；外部输入无运行时验证 |

**关键问题**:
- `Project.createdAt: Date` 与 `Project.lastActivityAt: string` 类型不一致。
- `WorkflowStep` 已废弃但未从类型中移除，下游代码存在混合使用风险。

---

### 3.2 `@cabinet/storage` — 数据持久化层

**功能实现度**: 85%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| SQLite 连接管理（WAL, FK, busy_timeout） | ✅ 完整 | 单例模式，适合桌面应用，但阻碍并行测试 |
| 22 版 schema 迁移 | ✅ 完整 | 编号 001-022（存在 012-014 空缺），无 down 迁移，不可逆 |
| ~25 个领域 Repository | ✅ 完整 | 覆盖项目、决策、事件、工作流、审计、API Key、记忆等全部领域 |
| 备份/恢复/完整性校验 | ✅ 完整 | WAL checkpoint、rotation、restore、maintenance 均实现 |
| Pino 日志（ring buffer + redaction） | ✅ 完整 | namespace 单例，日志轮转通过 `pino-roll` 支持 |
| 系统知识库硬编码文档 | ✅ 完整 | 685 行中文 Markdown，覆盖整个系统架构说明，支持版本化同步 |
| MetricsCollector | ✅ 完整 | 内存 + 可选 SQLite 持久化 |

**关键问题**:
- **全局单例连接**：`createConnection`/`getConnection` 使用模块级状态，无法支持多数据库、并行测试隔离困难。
- **Repository 代码重复**：每个 repo 重复手动拼 SQL（`sets.push`, `values.push`），无基类或 query builder。
- **类型不安全**：大量 `row as Record<string, unknown>` 后手动字段 cast，无 generated types。
- **迁移编号空缺**：012-014 缺失，若曾在生产环境存在则会导致迁移状态混乱。

---

### 3.3 `@cabinet/events` — 事件总线

**功能实现度**: 80%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| EventBus 接口契约 | ✅ 完整 | `publish/subscribe/once/unsubscribe/replay/dispose` |
| MemoryEventBus（内存实现） | ✅ 完整 | 1000 事件 ring buffer，支持 DLQ |
| SqliteEventStore（持久化实现） | ✅ 完整 | 基于 EventLogRepository，支持因果链查询 |
| 因果链构建与验证 | ✅ 完整 | `buildCausationChain`、`validateCausation`（环检测、悬空引用检测） |
| DeadLetterQueue | ⚠️ 基本实现 | 有重试计数，但无指数退避、无延迟机制、重试失败后直接丢弃 |
| AgentEventBus（WebSocket + SQLite 双轨） | ⚠️ 基本实现 | 功能存在，但 `BroadcastFn`/`ParentNotificationFn` 注入使测试困难 |

**关键问题**:
- **无背压机制**：`await handler(envelope)` 顺序执行，慢订阅者阻塞快订阅者。
- **Replay 语义不一致**：`MemoryEventBus.replay` 按时间戳过滤；`SqliteEventStore.replay` 先按类型全量取再内存过滤时间戳。
- **DLQ 重试是 fire-and-forget**：失败后仅 increment counter，无进一步处理。

---

### 3.4 `@cabinet/graph` — 图执行引擎

**功能实现度**: 82%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| StateGraph 构建器 | ✅ 完整 | 支持节点、边、条件边、错误边、reducer |
| CompiledGraph 执行 | ✅ 完整 | `invoke`（同步）、`stream`（async generator）、`resume`（checkpoint 恢复） |
| Annotation / Reducer | ✅ 完整 | 支持 append、last-write-wins、custom dedup |
| Checkpoint 持久化 | ✅ 完整 | SQLite 存储，支持 linked-list（parentId）、GC、时间旅行 |
| 图验证（5-pass） | ✅ 完整 | 节点存在性、可达性、环检测、条件完整性、错误边 |

**关键问题**:
- **invoke/stream/resume 代码严重重复**：三个方法包含几乎相同的节点执行循环（retry、state merge、edge resolution、checkpoint），维护成本高。
- **文档与实现不符**：`system-knowledge-base.ts` 声称"6-round validation"，实际 `validation.ts` 只有 5 轮，缺少"state field compatibility check"。
- **条件边优先级未文档化**：`for...of` + `break` 导致先添加的条件边优先，后续边被静默忽略。
- **Type erasure**：`this.schema as unknown as StateSchema` 削弱了编译时类型安全。

---

## 四、Agent 核心层（Layer 2）功能实现逐项审视

### 4.1 `@cabinet/gateway` — LLM 网关

**功能实现度**: 78%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| 多 Provider 统一抽象 | ✅ 完整 | Anthropic、OpenAI、DeepSeek、Google、Qwen、Moonshot、Zhipu、Baichuan |
| Vercel AI SDK 适配 | ✅ 完整 | `generateText`、`streamText`、embedding、tool calling |
| ModelRouter（角色路由） | ✅ 完整 | `deep_think`/`fast_execute`/`default` 三角色 + fallback chain |
| FallbackChain（降级重试） | ⚠️ 实现但有 bug | 重试次数与模型链长度混为一谈（`i < models.length && i <= maxRetries`） |
| 成本追踪（RMB 计价） | ✅ 完整 | 按模型定价表，支持日/周/月聚合 |
| BudgetGuard（预算守护） | ⚠️ 基本实现 | 四级状态（ok/warning/critical/blocked），但模板字符串 bug：`¥{blocked.currentSpend}`（应为 `${}`） |
| 速率限制追踪 | ⚠️ 接口存在 | `RateLimitTracker` 类存在，但测试未覆盖，实际 header 解析逻辑未验证 |
| Anthropic cache control | ✅ 实现 | 仅用于 `streamText`，`generateText` 未使用 |

**关键问题**:
- **`generateText` 的 tool 参数转换不完整**：`convertTools()` 在 `generateText` 中未调用 `jsonSchemaToZod`，可能导致 provider 不兼容。
- **Google provider 动态加载**：`@ai-sdk/google` 作为可选依赖，但代码引用其环境变量，缺失时运行时报错。
- **硬编码模型列表**：`listModels()` 返回静态数组，包含已废弃模型注释。

---

### 4.2 `@cabinet/agent` — Agent 执行引擎

**功能实现度**: 72%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| AgentLoop（TAOR 循环 + checkpoint） | ✅ 完整 | StateGraph 驱动，支持流式、恢复、RAG 优化 |
| ToolExecutor（76+ 工具） | ✅ 数量多但质量参差 | 覆盖决策、记忆、项目、工作流、文件、Web、Shell、浏览器、MCP、Skill |
| SafetyChecker（T0-T3 委托层级） | ✅ 完整 | 四级安全：只读、轻写、中等、破坏性工具 gate |
| ContextBuilder（分层 prompt 组装） | ⚠️ 基本实现 | Tier 1-4 结构正确，但 `rulesSummary` 恒为空字符串（已移除磁盘遍历） |
| AgentDispatcher（pipeline/parallel/single） | ⚠️ 实现但缺测 | 三种 dispatch 模式存在，但无单元测试验证 |
| 内置角色注册表（5 角色） | ✅ 完整 | Secretary、MeetingChair、Curator、Reviewer、Organize |
| CheckpointManager | ✅ 完整 | SQLite 持久化，支持 session 级恢复 |
| StreamingCallback | ⚠️ 接口过宽 | 18 个可选方法，前端集成成本高 |
| SkillRegistry / SkillExtractor | ✅ 完整 | 支持 SKILL.md 解析、热重载 |

**关键问题**:
- **`tools/index.ts` 1200+ 行 God File**：76 个工具定义挤在一个文件，混合所有领域，难以维护。
- **工具参数验证不一致**：部分工具有 JSON Schema，部分直接 `Record<string, unknown>` + `?? 'default'` fallback，掩盖调用错误。
- **`agent-loop.ts` 1135 行**：`buildRunGraph` 使用闭包捕获可变状态（`counters`, `executedToolCalls`），控制流难以追踪和测试。
- **空 catch 块普遍**：checkpoint flush、insights injection、tool timeout 等处静默吞错。
- **`get_status` 硬编码 `toolsAvailable: 42`**：魔法数，随工具增减必然漂移。
- **`runStreaming` 未测试**：流式执行路径无单元测试覆盖。

---

### 4.3 `@cabinet/memory` — 多层记忆系统

**功能实现度**: 70%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| ShortTermMemory（LRU + TTL + SQLite） | ✅ 完整 | session-scoped KV，支持容量限制 |
| LongTermMemory（HNSW 语义 + BM25 文本） | ⚠️ 功能完整但依赖脆弱 | HNSW 通过 `hnswlib-node` 实现，但该 native 模块在 Windows/CI 常不可用，此时向量搜索完全静默禁用 |
| EntityMemory（Captain 偏好 + Employee 配置） | ✅ 完整 | 内存 + SQLite 双态 |
| ProjectMemory（目标、里程碑、决策） | ⚠️ 基本实现 | 硬编码空字段（`constraints: '[]'`, `risk_map: '{}'`） |
| KnowledgeGraph（实体/关系 + BFS） | ⚠️ 基本实现 | SQLite 存储存在，但矛盾检测仅为启发式关键词匹配，`llmJudge` 参数从未被调用 |
| ConsolidationService（短→长晋升） | ⚠️ 基本实现 | WriteGate 5-check 逻辑存在，但 `WriteGate`、`CascadeBuffer` 无独立测试 |
| MemoryDecayService（时序衰减） | ⚠️ 基本实现 | `validUntil` 过期、低置信度归档存在，但 `require()` 在 ESM 中使用，脆弱 |
| ProjectIsolatedMemory | ✅ 完整 | 所有记忆操作按 `projectId` 隔离 |

**关键问题**:
- **`require()` 在 ESM 中使用**：`long-term.ts` 用 `createRequire`，`memory-decay.ts` 直接 `require('./memory-decay.js')`，bundler 不兼容风险。
- **Race condition**：`incrementAccessCount` 异步 fire-and-forget，非原子读写。
- **`pruneExcess` 全表加载**：`findAll()` 加载整个长期记忆表到内存评分，大数据量时内存压力大。
- **`ShortTermMemory._store` 被外部直接访问**：`ConsolidationService` 直接读取私有 `_store`，破坏封装。

---

## 五、业务逻辑层（Layer 3）功能实现逐项审视

### 5.1 `@cabinet/decision` — 决策引擎

**功能实现度**: 68%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| 决策生命周期（create/approve/reject） | ✅ 完整 | 支持 L0-L3 四级分类，auto-approval 按委托层级 |
| LevelClassifier（级别分类器） | ✅ 完整 | 启发式规则覆盖资金/权限/删除/组织配置 → L3 |
| DecisionStateMachine（状态机） | ✅ 完整 | pending → approved/rejected/expired/archived，`isValidTransition` 显式校验 |
| AuditLogger（审计日志） | ⚠️ 接口存在 | SQLite 存储存在，但 `DecisionService` 未在测试中验证审计写入 |
| EscalationService（升级通知） | ⚠️ 基本实现 | 发布事件到 EventBus，但无消费者测试 |
| PolicyEngine（S5 策略仲裁） | ❌ 严重不完整 | `evaluateAdjustment` 仅 1 条规则；`arbitrate` 仅 1 个硬编码 mission check；`checkDecision` 只检查 L3 auto-approval。VSM 的 S5 愿景远未实现 |

**关键问题**:
- `PolicyEngine` 是最明显的"架构理想与代码现实"落差：设计了 S5 策略层概念，但实现几乎是 stub。
- `approve`/`reject` 抛原始 `Error` 而非领域异常。
- `isTerminal()` 仅视 `Archived` 为终态，`Expired`/`Rejected` 被排除，可能是有意设计但值得质疑。

---

### 5.2 `@cabinet/workflow` — 工作流引擎

**功能实现度**: 75%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| WorkflowEngine（节点执行） | ✅ 完整 | 支持 15+ 节点类型：agentGroup、llm、skill、tool、code、ifElse、loop、parallel、merge、approval、human 等 |
| StateGraph 编译路径 | ✅ 完整 | 通过 `@cabinet/graph` 编译执行 |
| 条件表达式求值器 | ✅ 完整 | 递归下降解析器，支持模板 `{{steps...}}`、逻辑运算、括号 |
| 蓝图验证（re-export） | ⚠️ 间接 | 实际实现全在 `@cabinet/organize`，`workflow` 仅 re-export |
| 持久化与恢复 | ⚠️ 部分测试 | `startRun`/`continueRun`/`getRun` 存在，但循环、并行、merge 节点无测试 |
| 人工审批暂停 | ✅ 测试覆盖 | human approval gate 测试通过 |

**关键问题**:
- **双执行路径风险**：`startRun` 优先编译 StateGraph，失败时静默回退到 legacy DFS `executeNode`。两个路径必须并行维护，bug 可能只出现在一条路径。
- **`ifElse` 路由极其脆弱**：`buildStateGraph` 通过检查输出字符串是否包含 `'Condition evaluated: true'` 来决定条件边目标。改输出格式即破坏工作流。
- **Loop 节点退出逻辑混乱**：edge traversal 与 child execution 混合，代码难以验证正确性。

---

### 5.3 `@cabinet/organize` — 组织与蓝图管理

**功能实现度**: 80%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| Blueprint 解析（JSON 提取） | ✅ 完整 | 支持 fenced/inline JSON、自然语言包裹、多 code block 容错 |
| Blueprint 验证 | ✅ 完整 | 检查 agent、step 引用、branch、auth rule、harness gate、circular dep |
| Blueprint 部署 | ✅ 完整 | 创建 agent → 创建工作流 → 运行工作流 → 发布事件 |
| LLM 辅助解析 | ⚠️ 硬编码模型 | `parseBlueprintWithLLM` 使用 `claude-haiku-4-5`，不可配置 |

**关键问题**:
- **部署无事务回滚**：agent 创建成功但 workflow 创建失败时，已创建 agent 不自动删除。
- **`BlueprintDeployer` 参数硬编码**：`temperature: 0.3`、`maxResponseTokens: 4000`、`contextBudget: 0.3` 无外部配置入口。
- **类型演化遗留**：`(step.type as string) === 'humanApproval'` 与 `step.type === 'approval'` 并存。

---

### 5.4 `@cabinet/meeting` — 会议协议

**功能实现度**: 65%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| 4 阶段协议（Chair/Advisor/Reviewer/Extraction） | ✅ 完整 | prompt builder + JSON parser 全部实现 |
| 合成报告格式化 | ⚠️ 未测试 | `generateSynthesis` 实现但无任何测试 |
| 少数派报告高亮 | ⚠️ 基本实现 | 阈值 `avgConfidence - 0.3` 武断且未测试 |

**关键问题**:
- **所有 parser 使用 fragile JSON 提取**：`content.match(/\{[\s\S]*\}/)` 对嵌套 JSON、多 JSON block、前置说明文本全部失效。
- **Reviewer prompt 要求使用工具**（`search_memory` 等），但本包纯 prompt 层，无工具基础设施，隐含契约未文档化。
- **`parseChairResponse` fallback 过于简化**：解析失败时返回单一通用视角，丢失用户指定的 advisor 列表。

---

### 5.5 `@cabinet/secretary` — 秘书与协调层

**功能实现度**: 68%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| SecretaryAgent（消息处理与路由） | ⚠️ 实现但零测试 | 506 行核心 orchestration 代码，无任何单元测试 |
| IntentParser（意图解析） | ⚠️ 实现但过重 | 1052 行 god class，混合 keyword/embedding/LLM/custom agent/session cache |
| SessionManager（会话管理） | ⚠️ 基本实现 | 内存 + 磁盘持久化，但 compression、hard-limit truncation、child session 无测试 |
| GreetingService | ✅ 简单可用 | 时间感知问候 + 统计摘要 |
| Streaming 消息处理 | ✅ 实现 | `handleMessageStreaming` 存在，但测试未覆盖 |
| Feedback 检测 | ⚠️ 硬编码 | 中英文信号词列表不可配置 |

**关键问题**:
- **`SecretaryAgent` 零测试是本项目的最大测试缺口**：506 行调度、合成、验证、反馈逻辑完全未经自动化验证。
- **IntentParser 是 1052 行 god class**：keyword 匹配（中英文混合）、embedding 相似度、LLM 分类、自定义 agent 注册、session 缓存、路由逻辑全部耦合。
- **Keyword 匹配脆弱**：大量使用 `lower.includes('...')`，极易产生 false positive。
- **会话路由缓存内存泄漏**：`sessionRoutingCache` 只增不减，长期运行后内存膨胀。
- **`verifyRoute` 硬编码模型 + 超时**：`claude-haiku-4-5`，3 秒 timeout。
- **空 catch 块**：embedding generation、persistence、session callbacks 等多处静默吞错。

---

### 5.6 `@cabinet/harness` — 质量与测试 harness

**功能实现度**: 45% ⚠️ **本项目功能缺口最大的包**

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| QualityGate（HEI 检查） | ✅ 简单实现 | 正则式 Hypothesis/Evidence/Impact 检查，有测试 |
| TeachBack（高风险操作确认） | ✅ 简单实现 | keyword overlap 验证，有测试 |
| Evaluator（LLM 评分） | ⚠️ 过于简单 | 单句 prompt + regex 解析 `Score: X/10`，无评分标准 |
| BrowserPool / BrowserVerifier | ⚠️ 实现但未测试 | Playwright 生命周期管理、E2E 页面验证，224+319 行零测试 |
| ObservabilityCollector | ⚠️ 大量 stub | 442 行代码，`subscribe()` 是空操作；健康报告框架存在但无验证 |
| ProgressTracker | ⚠️ 实现但有 bug | 原子写入逻辑 broken（`.tmp` 写入后未正确 rename） |
| AutoAdjuster | ⚠️ 基本实现 | 硬编码升级目标模型 `anthropic/claude-sonnet-4-6` |
| GarbageCollector | ⚠️ 基本实现 | 重复文件检测使用 `stat.size + content.slice(0,200)` 作为 hash，false positive 高 |
| PreferenceLearner | ⚠️ 基本实现 | 依赖 `EntityMemory` 接口，但未验证兼容性 |
| SubconsciousLoop | ⚠️ 基本实现 | 加载 1000 条记忆只为 shuffle 取 10 条，效率低；无闭环耦合到 AgentLoop |
| HarnessAnalyst | ⚠️ 基本实现 | LLM 驱动的每日健康摘要，无测试 |
| Escalation / QualityResponse | ⚠️ 基本实现 | 事件发布存在，无消费验证 |

**关键问题**:
- **仅 52 行测试覆盖 ~2,500 行代码**：13 个模块中只有 `QualityGate` 和 `TeachBack` 被测试，风险极高。
- **`BrowserPool.evaluate()` 使用 `eval()`**：`page.evaluate((s) => eval(s), script)` 存在安全漏洞。
- **ObservabilityCollector.subscribe() 为空 stub**：虽然订阅了事件，但处理体为空，仅通过注释说明"tracked via recordSession"。
- **职责严重混杂**：浏览器自动化、指标收集、垃圾回收、偏好学习、质量门控全部塞在一个包，应拆分为多个子包。

---

## 六、界面层（Layer 4）功能实现逐项审视

### 6.1 `apps/server` — 后端服务

**功能实现度**: 75%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| HTTP API（Hono, ~25 个路由模块） | ✅ 完整 | RESTful 设计，覆盖 agents/projects/decisions/workflows/memory/employees/settings 等全部领域 |
| WebSocket 实时事件 | ✅ 完整 | `/ws/events`，ping/pong，broadcast，客户端管理 |
| MCP 集成 | ✅ 完整 | `McpManager` 通过 stdio 连接外部 MCP server，动态注册工具 |
| 调度器（Cron） | ✅ 完整 | `node-cron` + `cron-parser`，支持 workflow trigger |
| 认证中间件 | ❌ **功能缺失** | `authMiddleware` 仅检查 Origin（localhost/Tauri），不验证任何 token/PIN |
| 速率限制 | ⚠️ 基本实现 | 内存 Map 实现，无上限，重启失效 |
| CORS | ⚠️ 配置有误 | `allowHeaders` 缺少 `Authorization`，与 README 声明的 Bearer 认证矛盾 |
| 配置加载 | ⚠️ 自定义解析器 | 手动按 `=` 分割，不支持引号、转义、注释后值，可能截断 API key |
| A2A 协议支持 | ✅ 实现 | `/.well-known/agent-card.json` + `/api/agents/:id/message/stream` |
| OpenAPI / Swagger | ✅ 实现 | 静态 spec + Swagger UI endpoint |

**关键问题**:
- **`context.ts` 2334 行 God Object**：初始化几乎所有子系统（DB、repos、memory、gateway、scheduler、backup、agent registry），单一文件承担整个服务的 DI 容器，测试极其困难。
- **`secretary.ts` 3708 行超级路由文件**：承担路由、文件操作、正则解析、向量计算、Agent 缓存、会议编排、Schema 定义等 20+ 职责，是本项目的单一最严重技术债务。
- **`workflows.ts` 1124 行**：混合引擎 setup、工具依赖构建、normalization、HTTP handler。
- **业务逻辑直接写在路由中**：无 Service 层，迫使测试必须走 HTTP 层或 mock 整个生态。
- **Empty catch 块**：`auditLogRepo.insert` 等多处非关键错误被静默吞掉。
- **Memory leak**：`toolExecutorCache` 使用 JSON key 但永不清理旧条目。

---

### 6.2 `apps/desktop` — 桌面应用

**功能实现度**: 80%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| Tauri v2 桌面壳（Rust） | ✅ 完整 | 窗口控制、server 进程 spawn、crash monitor、tray icon、自动重启 |
| React 19 + Vite 前端 | ✅ 完整 | 模块化页面、懒加载路由、context 体系 |
| Office Dashboard（widget 网格） | ✅ 完整 | `react-grid-layout`，16 种 widget，持久化到 localStorage |
| Factory（可视化工作流设计器） | ✅ 完整 | `@xyflow/react` DAG 编辑，undo/redo，15+ 节点类型，run history |
| Chat（流式对话） | ✅ 完整 | SSE 流式接收、sub-agent 监控、tool call 可视化、markdown 渲染、thinking block |
| 主题系统 | ✅ 完整 | 15 套主题（light/dark/cyberpunk/vaporwave/brutalism 等），CSS 变量 + Tailwind v4 |
| 项目管理 | ✅ 完整 | CRUD、本地文件夹导入（Tauri dialog）、WebSocket 实时同步 |
| 实时同步 | ✅ 完整 | WebSocket 客户端（reconnect、server-status 协调） |
| 文件查看器 | ✅ 实现 | 侧边文件预览 pane |

**关键问题**:
- **`ChatContext.tsx` 551 行 + `App.tsx` 583 行**：业务逻辑与 UI 状态严重混合，特别是 `ChatContext` 同时处理 HTTP 流式请求、SSE 解析、sub-agent 状态、UI 状态。
- **tsconfig 排除测试文件**：`src/__tests__` 和 `src/__mocks__` 被排除在类型检查外，测试代码无编译时保障。
- **UX 使用原生 dialog**：`window.prompt()` 命名项目、`confirm()` 删除确认，与精致桌面应用定位不符。
- **FactoryPage race condition**：`setTimeout(() => setSelectedId(id), 100)` 选择新建 workflow，时序脆弱。
- **硬编码 `localhost:3000`**：WebSocket 和 API 地址写死，不支持多实例或远程 server。
- **CSS class typo**：`hover:bg-accent:bg-accent` 无效 Tailwind 类。

---

### 6.3 `packages/cli` — 命令行工具

**功能实现度**: 50%

| 功能域 | 实现状态 | 质量评估 |
|--------|---------|---------|
| `cabinet start` | ⚠️ 硬编码路径 | 相对路径指向 `../../apps/server`，仅开发环境可用 |
| `cabinet init` | ✅ 可用 | 运行 DB 迁移 |
| `cabinet backup/restore/list-backups` | ✅ 可用 | 基于 `BackupManager` |
| `cabinet status/config` | ✅ 简单可用 | 显示系统状态和环境变量 |

**关键问题**:
- **零测试**：CLI 完全未测试。
- **路径硬编码**：`start` 命令假设 `dist/index.js` 与 `apps/server` 的相对位置不变，发布或移动后必坏。
- **无 server 停止命令**：只能启动，无法优雅停止。
- **版本获取脆弱**：`getVersion()` 读取相对路径 `../package.json`，失败时静默回退 `'2.0.0'`。

---

## 七、测试体系审视

### 7.1 测试分布统计

| 包/应用 | 源码文件数 | 测试文件数 | 测试行数估算 | 覆盖评估 |
|---------|-----------|-----------|-------------|---------|
| `packages/types` | 8 | 4 | ~200 | ⭐ 良好，类型契约测试完整 |
| `packages/storage` | ~35 | 6 | ~600 | ⭐ 良好，核心 repo + 备份 + 日志 + 知识库 |
| `packages/events` | 7 | 4 | ~400 | ⭐ 良好，contract test 模式优秀 |
| `packages/graph` | 5 | 5 | ~500 | ⭐ 良好，state graph + checkpoint + validation + stream/resume |
| `packages/gateway` | ~6 | 3 | ~400 | ⚠️ 中等，缺 stream/embedding/rate-limit 测试 |
| `packages/agent` | ~15 | 10 | ~1800 | ⭐ 良好，但缺 dispatcher、streaming、tool 文件分散测试 |
| `packages/memory` | ~10 | 2 | ~380 | ⚠️ 中等，缺 KnowledgeGraph、Decay、WriteGate、CascadeBuffer |
| `packages/decision` | ~6 | 1 | ~175 | ❌ 差，缺 PolicyEngine、Audit、Escalation、reject 流 |
| `packages/workflow` | 4 | 2 | ~285 | ⚠️ 中等，缺 loop/parallel/merge/sub-workflow |
| `packages/organize` | 4 | 3 | ~385 | ⭐ 良好，parser/validator/deployer 均覆盖 |
| `packages/meeting` | 3 | 1 | ~146 | ⚠️ 差，synthesis 零测试 |
| `packages/secretary` | 4 | 1 | ~151 | ❌ **极差**，SecretaryAgent 506 行零测试 |
| `packages/harness` | ~13 | 1 | ~52 | ❌ **极差**，13 个模块仅 2 个被测 |
| `packages/ui` | ~5 | 1 | ~80 | ⚠️ 简单组件渲染测试 |
| `packages/cli` | 1 | 0 | 0 | ❌ 未测试 |
| `apps/server` | ~30 | 8 | ~800 | ❌ 差，路由 handler 几乎未测，context.ts 零测试 |
| `apps/desktop` | ~40 | 13 | ~800 | ⚠️ 组件渲染 smoke test，缺 context/page/integration |
| `tests/e2e` | — | 3 | ~300 | ⚠️ 2/24 测试超时失败（security.test.ts） |
| `tests/bench` | — | 1 | ~100 | ⭐ 性能基准存在 |

### 7.2 测试执行结果

**2026-06-02 执行结果**（`pnpm -r test`）：

- 包级测试：大部分通过（agent, storage, events, graph, gateway, workflow, organize, memory, types, decision 均通过）。
- E2E 测试：`security.test.ts` 中 2 个用例超时失败：
  - `handles XSS in chat message safely`（5s timeout）
  - `handles oversized input gracefully`（5s timeout）
- 失败原因推测：server 端无输入截断/快速返回机制，大输入（12,000 字符）进入完整 LLM pipeline 导致响应极慢。

### 7.3 测试基础设施

| 能力 | 状态 | 说明 |
|------|------|------|
| Vitest 框架 | ✅ | 全局配置 + 各包独立配置 |
| `forks` pool（Windows native 兼容） | ✅ | storage/events 等包已配置 |
| Contract test 模式 | ✅ | `bus.contract.test.ts` 是值得推广的模式 |
| 覆盖率报告 | ❌ | 未配置 `@vitest/coverage-v8`，CI 不收集覆盖率 |
| 内存数据库测试工厂 | ❌ | 无 `createTestContext()`，每个测试各自 mock |
| Fake LLM 网关 | ❌ | 无预定义响应的 fake gateway，集成测试成本高 |

---

## 八、CI/CD 与工具链审视

### 8.1 GitHub Actions

| Workflow | 状态 | 评估 |
|----------|------|------|
| `CI` — lint / typecheck / test | ✅ 配置完整 | Node 24, pnpm 10, frozen lockfile |
| `CI` — browser-e2e | ⚠️ 条件触发 | 仅当 commit message 含 `[browser]` 或 `[e2e]` 时运行，日常不验证 |
| `Release` — changesets | ✅ 配置完整 | 自动版本升级 + publish |

**缺失**：
- 覆盖率门禁（未配置 coverage report）
- 模块行数检查（CABINET.md 声明 500 行上限，但 CI 不执行）
- 安全扫描（`npm audit` 仅在 lint job 中执行且 `|| true`）
- `no-explicit-any` 未作为 error（ESLint 中是 `warn`）

### 8.2 架构检查工具

`tools/arch-lint.ts` 存在，用于验证 4 层依赖规则。`pnpm lint:arch` 已配置并在 CI 中运行。**但缺少模块行数检查**，导致 CABINET.md 的"单个文件不超过 500 行"规范形同虚设。

### 8.3 构建工具链

| 工具 | 状态 | 评估 |
|------|------|------|
| TypeScript 5.9 + composite projects | ✅ | `tsc -b` 构建模式，project references 完整 |
| Vite 6（desktop） | ✅ | dev + build + preview |
| esbuild（server bundle） | ✅ | `esbuild.config.mjs` 存在 |
| Tauri 2.0 | ✅ | Rust + WebView，server-dist 打包进 resources |
| Prettier + ESLint | ✅ | 配置合理，`@typescript-eslint/no-explicit-any: warn` |
| Commitlint（conventional） | ✅ | 配置存在，但无 husky/lint-staged，依赖自觉 |

---

## 九、文档与规范一致性审视

### 9.1 文档资产

| 文档 | 完整性 | 与代码一致性 |
|------|--------|-------------|
| `README.md`（中英双语） | ⭐ 详尽 | ⚠️ **严重不符**：声明 Bearer token 认证，但代码完全不验证 |
| `CABINET.md`（操作手册） | ⭐ 详尽 | ⚠️ 行数上限规范未被工具/CI 执行 |
| `CYBERNETIC_AUDIT.md` | ⭐ 优秀 | ✅ 与架构设计高度一致，自评 6.6/10 合理 |
| `docs/design-project-init.md` | ⭐ 详细 | ⚠️ Phase 1-3 的设计方案，需确认是否已落地 |
| `docs/design-subagent-interaction.md` | ✅ 存在 | 未深入审阅 |
| `docs/signing-guide.md` | ✅ 存在 | 未深入审阅 |
| API 文档（OpenAPI/Swagger） | ⚠️ 静态 spec | 需验证与实际路由的同步性 |

### 9.2 规范执行缺口

| 规范 | 声明位置 | 实际状态 | 差距 |
|------|---------|---------|------|
| 4 层依赖方向 | `CABINET.md` | ✅ 基本遵守 | 微小模糊（graph 层级） |
| 单文件 ≤500 行 | `CABINET.md:58-60` | ❌ 15+ 文件超线，5 个超 1000 行 | 无 CI 门禁 |
| `no-explicit-any` | ESLint `warn` | ❌ 260 处 `any`，649 处 `as` | 仅 warn 非 error |
| 空 catch 块 | 审计报告提及 | ❌ 普遍存在于 agent/gateway/server | 无 lint 规则检测 |
| 运行时类型校验 | 设计意图 | ❌ 无 Zod/io-ts 使用 | types 包纯编译时 |

---

## 十、问题汇总与风险矩阵

### 10.1 按严重程度汇总

#### 🔴 P0 — 严重（阻塞发布）

| 编号 | 问题 | 位置 | 风险 | 修复工时 |
|------|------|------|------|---------|
| P0-1 | 认证中间件完全不验证 Token/PIN | `apps/server/src/middleware/auth.ts` | 本地任何进程可调用 execCommand、读写文件、访问记忆 | 4h |
| P0-2 | WebSocket 完全开放（仅 IP 检查） | `apps/server/src/ws/handler.ts` | 敏感事件泄漏（决策、记忆、API Key 使用记录） | 2h |
| P0-3 | `execCommand` 命令注入防护分裂 | `apps/server/src/routes/secretary.ts` vs `capabilities.ts` | 不同调用路径防护强度不同，可绕过 | 4h |
| P0-4 | 硬编码 scrypt 盐值 | `apps/server/src/auth-utils.ts` | 彩虹表攻击可批量破解 PIN（已有修复计划） | 2h |
| P0-5 | E2E 安全测试超时失败 | `tests/e2e/security.test.ts` | 大输入无快速拒绝机制，可能引发 DoS/资源耗尽 | 2h |

#### 🟠 P1 — 高优先级（严重影响可维护性/可靠性）

| 编号 | 问题 | 位置 | 风险 | 修复工时 |
|------|------|------|------|---------|
| P1-1 | `secretary.ts` 3708 行 God File | `apps/server/src/routes/secretary.ts` | 理解成本极高、修改冲突率高、无法有效测试 | 16h |
| P1-2 | `context.ts` 2334 行 God Object | `apps/server/src/context.ts` | 单点复杂度、初始化逻辑无法单元测试 | 8h |
| P1-3 | `tools/index.ts` 1226 行 God File | `packages/agent/src/tools/index.ts` | 维护困难，工具增减易引入 regression | 8h |
| P1-4 | `agent-loop.ts` 1135 行 + 闭包可变状态 | `packages/agent/src/agent-loop.ts` | 控制流难追踪，stream/resume/invoke 重复代码 | 8h |
| P1-5 | `SecretaryAgent` 506 行零测试 | `packages/secretary/src/secretary-agent.ts` | 核心调度逻辑完全未经自动化验证 | 8h |
| P1-6 | `harness` 包 13 模块仅 2 个被测 | `packages/harness/src/` | ~2,500 行质量/浏览器/指标/垃圾回收代码零保障 | 12h |
| P1-7 | FallbackChain 重试逻辑 bug | `packages/gateway/src/fallback.ts:35` | `maxRetries` 实际限制的是模型链索引而非重试次数 | 2h |
| P1-8 | `BrowserPool.evaluate()` 使用 `eval()` | `packages/harness/src/browser-pool.ts` | 若传入用户脚本则存在 RCE 风险 | 2h |

#### 🟡 P2 — 中等（影响质量与体验）

| 编号 | 问题 | 位置 | 风险 | 修复工时 |
|------|------|------|------|---------|
| P2-1 | PolicyEngine 严重不完整（S5 stub） | `packages/decision/src/policy-engine.ts` | VSM 策略仲裁愿景未落地，决策系统缺乏高阶仲裁 | 8h |
| P2-2 | `ifElse` 路由依赖输出字符串匹配 | `packages/workflow/src/engine.ts` | 改输出格式即破坏工作流，极度脆弱 | 2h |
| P2-3 | 所有 JSON parser 使用 fragile regex | `packages/meeting`, `packages/secretary` 等 | LLM 返回嵌套 JSON 或多 block 时解析失败 | 4h |
| P2-4 | CORS `allowHeaders` 缺少 `Authorization` | `apps/server/src/index.ts:55` | 浏览器预检阻止 Bearer token 请求 | 0.5h |
| P2-5 | 自定义 `.env` 解析器不支持引号/转义 | `apps/server/src/config.ts` | API key 可能被错误截断 | 1h |
| P2-6 | `hnswlib-node` native 依赖 Windows/CI 风险 | `packages/memory/src/long-term.ts` | 向量搜索在部分环境完全静默禁用 | 4h |
| P2-7 | `require()` 在 ESM 中使用 | `packages/memory/src/` | bundler/纯 ESM 环境不兼容 | 2h |
| P2-8 | 速率限制器内存 Map 无上限 | `apps/server/src/middleware/rate-limit.ts` | 公网部署时 IPv6 扫描可导致 OOM | 2h |
| P2-9 | `ProgressTracker` 原子写入逻辑 broken | `packages/harness/src/progress-tracker.ts` | `.tmp` 写入后未正确 rename，崩溃可能损坏文件 | 1h |
| P2-10 | BudgetGuard 模板字符串 bug | `packages/gateway/src/budget-guard.ts` | 日志输出 `¥{blocked.currentSpend}` 而非实际值 | 0.5h |

#### 🟢 P3 — 低（优化与债务）

| 编号 | 问题 | 位置 | 风险 | 修复工时 |
|------|------|------|------|---------|
| P3-1 | 260 处 `any`、649 处 `as` | 全项目 | 类型安全削弱，运行时风险增加 | 持续 |
| P3-2 | 空 catch 块普遍 | `agent`, `gateway`, `server` | 生产问题难以定位 | 持续 |
| P3-3 | 硬编码模型名/默认值分散 | `organize`, `secretary`, `harness` | 模型升级时需多处修改 | 4h |
| P3-4 | `get_status` 硬编码 `toolsAvailable: 42` | `packages/agent/src/tools/index.ts` | 数字必然漂移 | 0.5h |
| P3-5 | 模块行数规范无 CI 执行 | `CABINET.md` | 规范形同虚设 | 1h |
| P3-6 | CLI 路径硬编码，零测试 | `packages/cli/src/index.ts` | 发布/移动后不可用 | 4h |
| P3-7 | `ContextBuilder.rulesSummary` 恒为空 | `packages/agent/src/context-builder.ts` | 功能已移除但接口仍暴露 | 1h |

### 10.2 风险收敛建议

**立即执行（本周）**：
1. 修复 P0-1 ~ P0-4 安全项（已有 `cabinet-fix-plan.md` 详细方案）。
2. 修复 P2-4 CORS 和 P2-5 env 解析器。
3. 给 E2E 安全测试增加 timeout 或输入截断机制。

**短期（2-4 周）**：
1. 拆分 `secretary.ts` → `services/` + `utils/`（P1-1）。
2. 拆分 `context.ts` → `factories/`（P1-2）。
3. 按领域拆分 `tools/index.ts`（P1-3）。
4. 为 `SecretaryAgent` 和 `harness` 核心模块补测试（P1-5, P1-6）。

**中期（1-3 月）**：
1. 实现 `PolicyEngine` 完整 S5 仲裁（P2-1）。
2. 引入 Zod 运行时校验替代纯编译时类型（P3-1 相关）。
3. 建立 `createTestContext()` 测试工厂 + fake LLM gateway。
4. 模块行数检查纳入 CI 强制门禁。
5. 引入 `@vitest/coverage-v8` 并设定 60% 行覆盖率门槛。

---

## 十一、功能实现总体评分

| 模块 | 功能实现度 | 代码质量 | 测试覆盖 | 综合 |
|------|-----------|---------|---------|------|
| `@cabinet/types` | 90% | 85% | 85% | **87** |
| `@cabinet/storage` | 85% | 70% | 75% | **77** |
| `@cabinet/events` | 80% | 75% | 80% | **78** |
| `@cabinet/graph` | 82% | 68% | 82% | **77** |
| `@cabinet/gateway` | 78% | 65% | 60% | **68** |
| `@cabinet/agent` | 72% | 58% | 70% | **67** |
| `@cabinet/memory` | 70% | 60% | 55% | **62** |
| `@cabinet/decision` | 68% | 65% | 45% | **59** |
| `@cabinet/workflow` | 75% | 60% | 58% | **64** |
| `@cabinet/organize` | 80% | 70% | 78% | **76** |
| `@cabinet/meeting` | 65% | 60% | 50% | **58** |
| `@cabinet/secretary` | 68% | 55% | 25% | **49** ⚠️ |
| `@cabinet/harness` | 45% | 50% | 5% | **33** ⚠️ |
| `@cabinet/ui` | 75% | 70% | 40% | **62** |
| `@cabinet/cli` | 50% | 55% | 0% | **35** ⚠️ |
| `apps/server` | 75% | 55% | 35% | **55** |
| `apps/desktop` | 80% | 68% | 50% | **66** |

**项目综合评分：65/100**

> **结论**：Cabinet 的架构设计在 AI 协作框架中处于领先水平，控制论闭环（TAOR 循环、分层决策、多层记忆、委托安全）的功能骨架已经搭成。但工程实现存在显著的"理想与现实的落差"：
> - **最危险的缺口**：认证层未启用（P0）、harness 几乎零测试（P1-6）、secretary 核心零测试（P1-5）。
> - **最大的技术债务**：`secretary.ts` 3708 行、`context.ts` 2334 行、`tools/index.ts` 1226 行等 God File。
> - **最值得保留的优势**：4 层依赖架构清晰、`graph` 的 checkpoint/time-travel 实现扎实、`gateway` 的多 provider fallback 设计合理、events 的 contract test 模式可推广。
>
> 建议按 `cabinet-fix-plan.md` 的四阶段策略推进修复，优先完成 Phase 0 安全紧急修复，随后进入架构拆分与测试补全阶段。

---

*报告结束。*
