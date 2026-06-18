# Cabinet 全面架构与设计报告

> 生成日期：2026-06-12
> 范围：Cabinet v2.0 TypeScript 单体仓库——15 个包 + 2 个应用
> 目的：完整记录项目的设计哲学、架构决策、模块分解、关键实现细节和工程规范

---

## 目录

1. [项目定位与设计哲学](#一项目定位与设计哲学)
2. [架构全景](#二架构全景)
3. [Layer 1：基础设施层](#三layer-1基础设施层)
4. [Layer 2：Agent 核心层](#四layer-2agent-核心层)
5. [Layer 3：业务逻辑层](#五layer-3业务逻辑层)
6. [Layer 4：接口层](#六layer-4接口层)
7. [数据全景图](#七数据全景图)
8. [安全模型](#八安全模型)
9. [工程纪律与质量保障](#九工程纪律与质量保障)
10. [控制论设计框架](#十控制论设计框架)
11. [与同类项目的定位差异](#十一与同类项目的定位差异)
12. [当前成熟度与改进路线](#十二当前成熟度与改进路线)

---

## 一、项目定位与设计哲学

### 1.1 一句话定位

**Cabinet 是一个 AI 驱动的项目管理与自主执行平台。**

它不是 AI 编码助手，不是聊天机器人，不是 Agent 框架。它是一个**为超级个体（Super Individual / One-Person Company）设计的 AI 内阁系统**。

### 1.2 核心隐喻

```
船长（Captain）← 你
  ├── 秘书（Secretary） ← 唯一的自然语言入口，代表你协调整个内阁
  ├── 顾问团（Advisors）← 多 Agent 并行审议，提供不同视角
  ├── 决策室（Decision）← L0–L3 分级裁决，自动批准或升级
  ├── 工作流（Workflow）← 18 种节点类型，含人工节点与外部 Agent
  ├── 记忆（Memory）   ← 5 层流水线，跨会话持续学习
  └── 驾驭层（Harness）← 质量闸门、评估器、自动调参、可观测性
```

### 1.3 三条设计哲学

#### 哲学一：从终局设计——假设 AI 什么都能做

> "先假设 AI 什么都能做，再往回补上当下现实所需的脚手架。"

这是 Cabinet 最根本的设计先验。今天的 AI 产品设计常常是对技术局限的补偿——精心雕琢的 prompt、神经紧张的 token 预算。Cabinet 反其道而行：先设计理想系统，再针对当前 AI 的能力缺口添加辅助系统。

#### 哲学二：不盯过程，断其结果

> "AI 在执行层自主运转，只在需要决策的边界发出信号。过程的噪音被系统吸收。"

人类不需要看到 AI 的内部运作——多少次重试、多少轮推理循环。人类只需要看到交付的成果和关键的临界路口。这个原则决定了 Cabinet 的交互设计：Agent 过程不可见（默认），交付物 + 决策点是可见的。

#### 哲学三：船长决定，内阁执行

> "船长无所不能，但应只做一事。那一件事，就是决策。"

在 Cabinet 的世界观里：

- **船长（Captain）** 做方向性选择和价值判断——这是人类的专属领域
- **内阁（Cabinet）** 执行一切——信息收集、方案生成、分析对比、执行推进
- **人工节点（Human Node）** 是 AI 能力边界的补充——当 AI 无法完成时，把任务抽象为可配置的流程节点交给人类协作者
- **决策（Decision）** 是船长的专属权——任何需要价值判断的时刻都升级到船长

### 1.4 能力缺口驱动的脚手架系统

基于"从终局设计"的原则，所有辅助系统都针对当前 AI 的具体能力缺口：

| 能力缺口             | 解决方案                                   |
| -------------------- | ------------------------------------------ |
| AI 不擅长某类任务    | **Skill**——Markdown 定义的即插即用专项能力 |
| 多步骤工作缺乏协调   | **Workflow**——DAG 引擎 + 18 种节点类型     |
| 需要外部工具或数据   | **MCP**——stdio/SSE 连接外部服务器          |
| 需要调用另一个 AI    | **外部 Agent 节点**——CLI / A2A 协议        |
| 任务需要人来完成     | **人工节点**——可配置的人类协作者抽象       |
| 需要记忆跨会话的知识 | **Memory**——5 层流水线 + 向量检索          |
| 需要质量保证         | **Harness**——评估器 + 质量闸门 + 自动调参  |

---

## 二、架构全景

### 2.1 4 层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Layer 4: Interface                        │
│    ui (React 组件库)   server (Hono API)                     │
│    desktop (Tauri 2.0)   cli (命令行入口)                     │
│    依赖方向: → Layer 3, 2, 1                                 │
├─────────────────────────────────────────────────────────────┤
│                    Layer 3: Business                         │
│    decision (分级决策 L0-L3)   secretary (NL 入口+路由)       │
│    workflow (DAG 工作流引擎)   harness (质量+可观测性)         │
│    organize (空包，待移除)                                    │
│    依赖方向: → Layer 2, 1                                    │
├─────────────────────────────────────────────────────────────┤
│                    Layer 2: Agent Core                       │
│    gateway (多 Provider LLM 网关)   agent (AgentLoop+Observer)│
│    memory (5 层记忆流水线)   agent-sdk (外部 Agent SDK)       │
│    依赖方向: → Layer 1                                       │
├─────────────────────────────────────────────────────────────┤
│                    Layer 1: Infrastructure                   │
│    graph (StateGraph 引擎)   types (共享类型)                 │
│    events (事件总线+因果链)   storage (SQLite+AES-256)        │
└─────────────────────────────────────────────────────────────┘
```

**依赖规则（由 `lint:arch` 自动校验）：**

- Layer N 只能依赖 Layer N-1 及以下（同层可相互依赖）
- `@cabinet/types` 是所有层都可以依赖的例外——但它不能依赖任何其他包
- 违反规则的 import 会导致 lint:arch 失败并附带修复指令

### 2.2 包清单

| 层  | 包名                 | 代码规模                 | 职责                                      |
| --- | -------------------- | ------------------------ | ----------------------------------------- |
| L4  | `@cabinet/ui`        | React 组件库             | 共享 UI 组件                              |
| L4  | `@cabinet/server`    | Hono 应用                | REST + WebSocket API（32 个路由模块）     |
| L4  | `@cabinet/desktop`   | Tauri + React            | 三栏式战略指挥台                          |
| L4  | `@cabinet/cli`       | 入口                     | `cabinet start` 命令                      |
| L3  | `@cabinet/secretary` | 意图解析 + 会话管理      | 统一自然语言入口                          |
| L3  | `@cabinet/decision`  | 决策服务 + 策略引擎      | L0-L3 分级决策                            |
| L3  | `@cabinet/workflow`  | 工作流引擎               | 18 种节点类型的 DAG 执行                  |
| L3  | `@cabinet/harness`   | 质量 + 可观测性 + 自调参 | 闭环反馈系统                              |
| L2  | `@cabinet/agent`     | Agent 核心               | AgentLoop + ObserverPipeline + Dispatcher |
| L2  | `@cabinet/gateway`   | LLM 网关                 | 8 Provider + 路由 + Fallback + 预算       |
| L2  | `@cabinet/memory`    | 记忆系统                 | 5 层流水线 + 知识图谱                     |
| L2  | `@cabinet/agent-sdk` | 外部 Agent SDK           | SlotClient + A2A 辅助                     |
| L1  | `@cabinet/graph`     | StateGraph 引擎          | 自研 DAG 执行 + Checkpoint                |
| L1  | `@cabinet/types`     | 共享类型                 | 全项目基础依赖                            |
| L1  | `@cabinet/events`    | 事件总线                 | pub/sub + 因果链追踪                      |
| L1  | `@cabinet/storage`   | 持久化                   | SQLite + 25+ Repository + 20+ Migration   |

### 2.3 技术栈

| 类别         | 技术选型                                      | 约束说明                             |
| ------------ | --------------------------------------------- | ------------------------------------ |
| **运行时**   | Node.js (ES2022)                              | 不可替换                             |
| **前端**     | React 19 + Tailwind CSS 4.3                   | 不可替换                             |
| **构建**     | TypeScript 5.9+ (composite projects) + Vite 6 | 不可替换                             |
| **包管理**   | pnpm (workspace protocol)                     | 不可替换                             |
| **数据库**   | SQLite (better-sqlite3) + AES-256 加密        | 不可替换，通过 @cabinet/storage 访问 |
| **桌面壳**   | Tauri 2.0 (Rust + React)                      | 不可替换                             |
| **服务端**   | Hono (REST + WebSocket)                       | 不可替换                             |
| **LLM 网关** | Vercel AI SDK (多 provider)                   | 不可替换                             |
| **测试**     | Vitest                                        | 不可替换                             |

---

## 三、Layer 1：基础设施层

### 3.1 `@cabinet/types` — 共享类型

全局基础依赖。所有包都可以 import，但它不能依赖任何其他包。

**关键类型域：**

| 模块                   | 内容                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `primitives.ts`        | Project, Employee, WorkflowNodeDef (18 种节点类型), SkillDefinition, DaemonConfig                |
| `decisions.ts`         | Decision (L0-L3), DecisionStatus, DecisionType, DecisionStore 接口, ALLOWED_TRANSITIONS 状态机表 |
| `events.ts`            | MessageType (20 种事件类型), MessageEnvelope (discriminated union)                               |
| `boundaries.ts`        | DelegationTier (T0-T3), 预算常量, 超时常量                                                       |
| `blueprints.ts`        | Blueprint, BlueprintValidationResult, BlueprintAgent                                             |
| `agent-output.ts`      | AgentOutput, Finding, AgentDecision, PipelineStepContext                                         |
| `skills.ts`            | ParsedSkill (SKILL.md 字段)                                                                      |
| `blackboard.ts`        | MergeStrategy, BlackboardTopic, BlackboardEntry                                                  |
| `structured-output.ts` | StructuredOutput, DecisionProposalData, DeliverableData                                          |

**设计特点：**

- 零运行时依赖——纯类型定义
- 使用 `as const` 模式定义枚举（而非 TypeScript enum）
- `MessageEnvelope<T>` 是 discriminated union，保证类型安全的 payload 访问

### 3.2 `@cabinet/graph` — StateGraph 引擎

自研的 DAG 执行引擎，是工作流和 Agent 编排的运行时基础。

**核心概念：**

```
StateGraph<S>
  ├── Annotation → 定义状态字段 + reducer 函数
  ├── Node → 状态转换函数 (state: S) => Promise<Partial<S>>
  ├── Edge → 节点间的无条件和条件跳转
  ├── Compile → 编译为可执行图
  └── CheckpointStore → 状态检查点持久化
```

**关键类：**

| 类                | 职责                                           |
| ----------------- | ---------------------------------------------- |
| `StateGraph<S>`   | 图定义——添加节点、边、条件边                   |
| `Annotation`      | 状态字段声明——root reducer + per-field reducer |
| `CheckpointStore` | SQLite 持久化——保存/加载图执行状态             |
| `validateGraph()` | 图结构验证——检测孤立节点、循环依赖、缺失边     |

**状态更新模式：**

```typescript
// Annotation 可以为每个字段定义自定义 reducer
const State = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update], // append 语义
  }),
  title: Annotation<string | null>({
    reducer: (_, update) => update ?? null, // last-write-wins 语义
  }),
  artifacts: Annotation<string[]>({
    reducer: (current, update) => [...new Set([...current, ...update])], // 去重 merge
  }),
});
```

### 3.3 `@cabinet/events` — 事件总线

类型安全的 pub/sub 消息系统，带因果链追踪。

**核心接口：**

```typescript
interface EventBus {
  publish(envelope: MessageEnvelope): Promise<void>;
  subscribe(type: MessageType, handler: EventHandler): () => void;
  once(type: MessageType, handler: EventHandler): void;
  replay(from: Date, handler: EventHandler): Promise<void>;
  getCausationChain(messageId: string): Promise<MessageEnvelope[]>;
}
```

**关键特性：**

| 特性                | 说明                                                                            |
| ------------------- | ------------------------------------------------------------------------------- |
| **双后端**          | `MemoryEventBus`（内存环形缓冲区，测试用）+ `SqliteEventStore`（SQLite 持久化） |
| **因果链**          | 每条消息有 `correlationId`（追踪因果链）和 `causationId`（指向直接父消息）      |
| **死信队列**        | `DeadLetterQueue`——失败事件存储 + 重试支持 + SQLite 持久化                      |
| **重放**            | `replay()`——从指定时间点重放历史事件给新订阅者                                  |
| **Agent Event Bus** | 三轨（WebSocket 广播 + SQLite 持久化 + 父会话通知）的子代理事件系统             |

**20 种事件类型（MessageType）：**

```
UserPrompt, AssistantResponse, ToolCall, ToolResult,
SystemNotification, QualityAlert, BudgetAlert,
DecisionCreated, DecisionUpdated, DecisionResolved,
WorkflowStarted, WorkflowCompleted, WorkflowFailed,
DeliverableCreated, ProjectCreated, AgentCreated,
CostUpdated, BackgroundError, PISAlert, ToolVariety
```

### 3.4 `@cabinet/storage` — 持久化

**核心组件：**

| 组件                       | 职责                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `connection.ts`            | SQLite 单例（better-sqlite3, WAL 模式, 外键约束, busy timeout） |
| `paths.ts`                 | `~/.cabinet/` 目录结构（10 个子目录）                           |
| `backup.ts`                | BackupManager——完整性验证 + 恢复前快照 + 旋转清理 + VACUUM      |
| `logger.ts`                | Pino 结构化日志——10MB 旋转、5 文件保留、命名空间隔离            |
| `metrics.ts`               | MetricsCollector——内存 + DB 双写 + 定期刷新                     |
| `system-knowledge-base.ts` | 内置系统知识库（17 条中文架构描述）                             |

**Repository 层（25+ 个）：**

```
ProjectRepository, DecisionRepository, WorkflowRepository,
AuditLogRepository, EventLogRepository, MetricRepository,
SettingsRepository, ApiKeyRepository, ShortTermMemoryRepository,
LongTermMemoryRepository, EntityMemoryRepository, SkillRepository,
EmployeeRepository, AgentRoleRepository, ScheduledTaskRepository,
CostHistoryRepository, DocumentChunkRepository, CheckpointRepository,
SystemKnowledgeRepository, RouteFeedbackRepository,
AgentTaskQueueRepository, AgentDaemonRepository, SquadRepository,
AutopilotRepository, TelemetryRepository, DeliverableRepository,
SessionMetricsRepository
```

**迁移系统：**

20+ 个顺序迁移（`migrations/` 目录），覆盖从初始 schema 到最新的工作流 cron、子代理表、外部 Agent、Squad 路由等。迁移不可逆（不写 down 迁移）。

---

## 四、Layer 2：Agent 核心层

### 4.1 `@cabinet/agent` — Agent 核心

这是 Cabinet 的"引擎室"——Agent 生命周期管理的全部逻辑。

#### 4.1.1 AgentLoop：主执行引擎

```typescript
class AgentLoop {
  constructor(options: AgentLoopOptions); // 35+ 个配置参数
  run(userMessage: string, resumeState?: CheckpointState): Promise<AgentResult>;
  runStreaming(userMessage: string, callback: StreamingCallback): Promise<AgentResult>;
  resume(userMessage: string): Promise<AgentResult>;
  continueWithUserInput(input: string, callback: StreamingCallback): Promise<AgentResult>;
}
```

**执行循环（简化）：**

```
_execute(userMessage) → AsyncGenerator<AgentEvent>
  1. 组装上下文 (_assembleContext)
     → Checkpoint 恢复 → 会话历史合并 → ContextBuilder.build()
  2. Observer Pipeline 通知 (onStreamStart, onUserInput)
  3. 主循环 (while stepCount < maxSteps):
     a. Blackboard 更新注入（如果有待处理的更新）
     b. LLM 调用 (withRetry + cacheSystemPrompt)
     c. CostTracker 记录
     d. 无工具调用 → break（最终响应）
     e. 工具分类：只读 → Promise.all 并行；写入 → for 串行
     f. 每个工具：Observer 通知 (onToolCall → onToolResult)
     g. Observer 通知 (onStepEnd)
  4. Observer Pipeline 通知 (onStreamEnd)
  5. 会话报告 (AgentSessionSummary)
```

**AgentLoopOptions（关键参数）：**

| 参数                                                 | 类型                         | 说明                                 |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------ |
| `gateway`                                            | LLMGateway                   | LLM 调用接口                         |
| `toolExecutor`                                       | ToolExecutor                 | 工具注册与执行                       |
| `safetyChecker`                                      | SafetyChecker                | 安全审查                             |
| `checkpointManager`                                  | CheckpointManager            | 状态持久化和恢复                     |
| `memoryProvider`                                     | MemoryProvider               | 记忆访问                             |
| `sessionId` / `projectId` / `captainId`              | string                       | 会话/项目/用户标识                   |
| `model`                                              | string                       | 模型选择（默认 `claude-sonnet-4-6`） |
| `maxSteps`                                           | number                       | 最大工具调用步数（默认 50）          |
| `toolTimeoutMs`                                      | number                       | 单工具超时（默认 300,000 = 5 分钟）  |
| `trustLevel`                                         | 'T0' \| 'T1' \| 'T2' \| 'T3' | 信任级别影响错误容忍度和工具数量限制 |
| `contextBudget`                                      | number                       | 上下文窗口预算比例（0-1，默认 0.4）  |
| `thinkingBudget`                                     | number                       | Anthropic 思考预算                   |
| `reflection` / `judge` / `autoReplan` / `guardrails` | 配置对象                     | P0/P1 级功能开关                     |
| `blackboard`                                         | AgentBlackboard              | 跨 Agent 共享状态                    |

#### 4.1.2 Observer Pipeline：生命周期的"中间件"链

```typescript
interface AgentObserver {
  name: string;
  onStreamStart?(ctx: AgentExecutionContext): Promise<void> | void;
  onUserInput?(
    ctx: AgentExecutionContext,
    msg: string,
  ): Promise<{ blocked?: boolean; reason?: string } | void>;
  onChunk?(chunk: StreamChunk, ctx: AgentExecutionContext): Promise<void> | void;
  onToolCall?(
    call: { id; name; args },
    ctx: AgentExecutionContext,
  ): Promise<{ blocked: boolean; reason?: string } | void>;
  onToolResult?(
    call: { id; name; args },
    result: unknown,
    ctx: AgentExecutionContext,
  ): Promise<void> | void;
  onStepEnd?(ctx: AgentExecutionContext): Promise<{ handoff?: boolean } | void>;
  onSessionComplete?(summary: AgentSessionSummary): Promise<void> | void;
  onStreamEnd?(ctx: AgentExecutionContext): Promise<void> | void;
}

class ObserverPipeline {
  constructor(observers: AgentObserver[]);
  async notify(event: keyof AgentObserver, ...args: unknown[]): Promise<unknown[]>;
}
```

**注册的 Observer（按顺序）：**

| #   | Observer                  | 生命周期钩子                        | 职责                                                       |
| --- | ------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| 1   | `ContentGuardObserver`    | onUserInput                         | 检查用户输入和 LLM 输出的策略违规                          |
| 2   | `SafetyCheckObserver`     | onToolCall                          | 每次工具调用前按 DelegationTier 检查                       |
| 3   | `ToolExecuteObserver`     | onToolCall, onToolResult            | 追踪工具调用计数（成功/失败/阻止）和连续错误数             |
| 4   | `StepEventObserver`       | onToolCall, onToolResult, onStepEnd | 将每步事件记录到 SQLite                                    |
| 5   | `ContextMonitorObserver`  | onStepEnd                           | 估算 token 使用量，追踪区间（smart/warning/critical/dumb） |
| 6   | `HandoffObserver`         | onStepEnd                           | 上下文到达 critical/dumb 时生成交接文档                    |
| 7   | `ProcessIdentityObserver` | onStepEnd                           | 追踪 PIS（Process Identity Score）会话一致性               |
| 8   | `BlackboardObserver`      | onStepEnd                           | 将 Blackboard 发现同步到消息上下文                         |
| 9   | `ReflectionObserver`      | onStepEnd                           | Agent 输出前自我反思                                       |
| 10  | `JudgeObserver`           | onStepEnd                           | LLM-as-Judge 评估输出质量                                  |
| 11  | `AutoReplanObserver`      | onToolResult                        | 检测工具错误并触发 LLM 驱动的重规划                        |
| 12  | `CheckpointObserver`      | onStepEnd, onStreamEnd              | 每 checkpointInterval 步保存状态                           |

#### 4.1.3 AgentDispatcher：多 Agent 调度

```typescript
class AgentDispatcher {
  dispatch(options: DispatchOptions): Promise<DispatchResult>;

  // 三种模式:
  //   Single:    单个 AgentLoop（特定角色）
  //   Pipeline:  角色序列 output → input
  //   Parallel:  多角色并发 + ResultSynthesizer 合并
}
```

**ResultSynthesizer：**

并行模式下，每个 Agent 产生独立的 `AgentOutput`（含 findings、decisions、confidence 等）。Synthesizer 负责：

1. **Findings 去重**——按 `type:detail` key 去重
2. **严重性排序**——high → medium → low
3. **Confidence 平均**——聚合多 Agent 的置信度
4. **Open Questions 合并**——取并集去重
5. **Next Steps 合并**——取并集去重

#### 4.1.4 ContextBuilder：分层 Prompt 构建

```
ContextBuilder.build():
  Tier 1 (Static):
    角色指令——"You are a Cabinet AI assistant..."
    工具列表——可用工具的描述

  Tier 2 (Session-Stable, 60s TTL cache):
    项目上下文 (getProjectContext)
    Captain 偏好 (getEntityPreferences)
    项目规则 (.cabinet/rules/ —— always/auto/on-demand 三种模式)

  Tier 3 (Dynamic, Per-turn):
    RAG 长期记忆搜索结果 (60s TTL cache)
    最近背景洞察 (getRecentInsights)

  额外注入:
    ProjectSnapshot——项目目录结构快照
    Skill Context——一次性 Skill 上下文
    Blackboard Snapshot——跨 Agent 共享发现
    MCP Resources/Prompts——可用 MCP 资源的元数据
```

**Prompt 缓存策略：**

```typescript
// buildCachedSystemPrompt() 返回 Tier 1 + Tier 2
// 用于 Anthropic cache_control —— 会话内复用，仅在项目切换或规则变更时重建
buildCachedSystemPrompt(projectContext, preferences, rules, roleSystemPrompt): string
```

#### 4.1.5 关键子系统

**CheckpointManager：**

```typescript
class CheckpointManager {
  save(state: CheckpointState): void; // SQLite 持久化
  load(sessionId: string): CheckpointState | null;
  loadWithDegradation(sessionId: string): CheckpointState | null;
  //   4 级降级回退:
  //   L1: 完整恢复
  //   L2: 部分恢复（从损坏的 JSON 中提取最后 5 步）
  //   L3: 仅最后一条用户消息
  //   L4: 完全失败（返回 null）
  delete(sessionId: string): void;
}
```

**AgentBlackboard：**

跨 Agent 的实时共享数据面：

```typescript
class AgentBlackboard {
  publish(topic: string, payload: unknown, strategy: MergeStrategy): void;
  snapshot(): BlackboardSnapshot | null;
  subscribe(topic: string): void; // 通过 EventBus 订阅主题变更
}
```

**ProcessIdentityScore（PIS）：**

4 因子 Agent 一致性评分：

| 因子              | 权重 | 说明                         |
| ----------------- | ---- | ---------------------------- |
| Intent Alignment  | 30%  | Agent 输出与原始意图的对齐度 |
| Tool Coherence    | 25%  | 工具调用序列的连贯性         |
| Goal Progress     | 30%  | 任务目标的推进程度           |
| Context Stability | 15%  | 上下文窗口管理的稳定性       |

**ToolPruner：**

动态工具裁剪——每次 LLM 调用前，基于 embedding 语义相关性将工具集从 80+ 裁剪到 12-18 个。

```
Task Description → Embedding → Cosine Similarity 排序 → Top-N 工具
可选: LLM 二次筛选
```

#### 4.1.6 内置 Agent 角色

| 角色          | 类型      | 模型层级         | 工具数                | 上下文预算 |
| ------------- | --------- | ---------------- | --------------------- | ---------- |
| **Secretary** | 入口/通用 | `default`        | 55+                   | 0.5        |
| **Curator**   | 记忆管理  | `fast_execution` | 40+ (read-only focus) | 0.4        |
| **Organize**  | 架构设计  | `deep_reasoning` | 70+ (含部署工具)      | 0.5        |

每个角色有自己的：

- `modules.identity`——角色专属 system prompt
- `modules.workflow`——分步骤的工作流指引
- `allowedTools`——工具白名单
- `modelTier`——模型层级映射
- `maxSteps`——最大步数限制
- `contextBudget`——上下文预算
- `temperature`——LLM 温度参数

### 4.2 `@cabinet/gateway` — LLM 网关

**核心接口：**

```typescript
interface LLMGateway {
  generateText(options: LLMCallOptions): Promise<LLMResponse>;
  streamText(options: LLMStreamOptions): AsyncIterable<StreamChunk>;
  listModels(): Promise<string[]>;
  generateEmbeddings(options: EmbeddingOptions): Promise<EmbeddingResult>;
}
```

**Provider 支持（AISDKAdapter）：**

| Provider      | SDK 包                       | 模型示例                                             |
| ------------- | ---------------------------- | ---------------------------------------------------- |
| Anthropic     | `@ai-sdk/anthropic`          | claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5 |
| OpenAI        | `@ai-sdk/openai`             | gpt-4o, gpt-4o-mini                                  |
| Google        | `@ai-sdk/google`（动态导入） | gemini-2.0-flash, gemini-2.5-pro                     |
| DeepSeek      | `@ai-sdk/deepseek`           | deepseek-v4, deepseek-r1                             |
| Qwen          | `@ai-sdk/openai-compatible`  | qwen-turbo, qwen-plus, qwen-max                      |
| Moonshot/Kimi | `@ai-sdk/openai-compatible`  | moonshot-v1-8k/32k/128k                              |
| Zhipu/GLM     | `@ai-sdk/openai-compatible`  | glm-4-flash, glm-4-plus                              |
| Baichuan      | `@ai-sdk/openai-compatible`  | baichuan3-turbo                                      |

**ModelRouter（4 级角色路由）：**

| 角色           | 模型列表                             |
| -------------- | ------------------------------------ |
| `deep_think`   | [claude-opus-4-7, claude-sonnet-4-6] |
| `fast_execute` | [claude-haiku-4-5, gpt-4o-mini]      |
| `default`      | [claude-sonnet-4-6, gpt-4o]          |
| `reasoning`    | [claude-opus-4-8, o4-mini]           |

**关键子系统：**

| 子系统             | 职责                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `FallbackChain`    | 指数退避重试（1s/2s/4s，上限 30s）+ 模型降级链。`onFallback` 回调通知模型切换                |
| `CostTracker`      | 8 Provider × 23 模型的 RMB 定价表 + 缓存命中折扣（最高 50x）。日/周/月聚合                   |
| `BudgetGuard`      | 4 级预算状态：ok → warning（80%）→ critical（95%）→ blocked（100%）                          |
| `RateLimitTracker` | 解析 HTTP 响应头（`x-ratelimit-*` 和 `anthropic-ratelimit-*`）追踪每 Provider 的速率限制状态 |

### 4.3 `@cabinet/memory` — 记忆系统

**5 层流水线：**

```
ShortTermMemory (会话 KV, LRU + TTL 30min, maxSize=1000)
    │
    ▼
WriteGate (5 级分类)
    ├── working:    显式 remember 命令 → 始终加载
    ├── register:   行为变更、承诺、决策 → 按需加载
    ├── daily:      稳定事实 → 可能过期
    ├── transient_noise: 短文本无模式匹配 → 丢弃
    └── structured prefix: decision_/preference_/milestone_ → 始终保留
    │
    ▼
CascadeBuffer (L0 暂存, minCount=3 / maxAge=30min 自动封存)
    │
    ▼
LongTermMemory (SQLite + FTS5 + HNSW 向量索引)
    │ 500K 条上限，超限按 importance × confidence × recency_decay × access_boost 裁剪
    │ 搜索: HNSW cosine (≥0.15) + BM25 text (FTS5) → RRF 融合 (k=60)
    │
    ▼
KnowledgeGraph (实体关系图 + 矛盾检测)
    │ 实体: name, type, frequency, metadata
    │ 关系: from → to (relation, strength, metadata)
    │ 矛盾检测: 图结构 + 可选 LLM 语义 (24h cooldown per pair)
    │
    ▼
MemoryDecayService (生命周期)
    expire → archive → supersede → prune
```

**并行系统：**

| 系统                   | 存储                                       | 职责                                                |
| ---------------------- | ------------------------------------------ | --------------------------------------------------- |
| `EntityMemory`         | SQLite `entity_prefs` + `entity_employees` | Captain 偏好 + 员工配置                             |
| `ProjectMemory`        | SQLite `project_context`                   | 项目目标/里程碑/关键决策/摘要                       |
| `ConsolidationService` | 编排层                                     | WriteGate 评估 + CascadeBuffer 封存 + 可选 LLM 提取 |
| `HybridRetriever`      | 独立工具                                   | BM25 + Embedding RRF 融合的 RAG 检索器              |

**MemoryFacade（统一接口）：**

```typescript
class MemoryFacade implements MemoryProvider {
  // Short-term
  remember(sessionId, key, value, ttl?): void;
  recall(sessionId, key?): unknown;
  getSessionContext(sessionId): Message[];

  // Long-term
  search(query, options?): LongTermEntry[];
  storeMemory(content, metadata?, embedding?): Promise<string>;

  // Project
  getProject(projectId): ProjectContext | null;
  addProjectDecision(projectId, title, description): void;

  // Entity
  getPreferences(entityId): Record<string, unknown>;
  setPreferences(entityId, preferences): void;

  // Consolidation
  consolidateSession(sessionId, options?): Promise<void>;
}
```

### 4.4 `@cabinet/agent-sdk` — 外部 Agent SDK

为外部 Agent（CLI 工具、A2A 服务）提供与 Cabinet 交互的接口：

- `SlotClient`——读取/写入上下文槽（context slot）
- A2A 协议辅助——Agent 发现和任务分发
- HMAC 安全令牌——外部 Agent 端点认证

---

## 五、Layer 3：业务逻辑层

### 5.1 `@cabinet/secretary` — 秘书系统

**SecretaryAgent（统一入口）：**

```typescript
class SecretaryAgent {
  handleMessage(sessionId, message): Promise<{ intent; response; routeResult?; usage? }>;
  handleMessageStreaming(sessionId, message, callback): Promise<void>;
}
```

**IntentParser（4 层意图识别级联）：**

```
Layer 1: Pattern Matcher (关键词 + 正则)
  → 11 种意图类型，keyword/regex 匹配
  → 否定检测，话题 hashing
  → 高置信度 (>0.85) → 直接返回

Layer 2: Embedding Matcher (语义相似)
  → 与预计算的 intent 示例计算 cosineSimilarity
  → 相似度 >0.75 → 返回

Layer 3: LLM Router (大模型分类)
  → Few-shot 示例 + LLM 分类
  → 最慢但最准

Layer 4: Topic Continuity (话题连续性)
  → 嵌入相似度 >0.7 + 会话路由缓存 (5 分钟窗口)
  → 检测 follow-up 而不重新分类
```

**11 种意图类型：**

```
decision_request, meeting_request, status_query,
knowledge_query, review_request, organize_request,
skill_request, invoke_skill, mcp_request,
schedule_request, follow_up, unknown
```

**SessionManager：**

- 文件持久化（`~/.cabinet/sessions/`）
- Token 预算感知的消息压缩（soft cap 60%, hard cap 80%）
- 批量异步写入（500ms 去抖动）
- 配置化 max tokens（默认 200K）
- ContextSlot/Blackboard 同步

### 5.2 `@cabinet/decision` — 决策系统

**DecisionService：**

```typescript
class DecisionService {
  create(input: CreateDecisionInput): Decision;
  approve(decisionId: string, chosenOptionId?: string): Decision;
  reject(decisionId: string, reason?: string): Decision;
  escalate(decisionId: string): Decision;

  getAutoApproveMaxLevel(): DecisionLevel; // 基于当前 DelegationTier
  shouldAutoApprove(level: DecisionLevel): boolean;
}
```

**4 级决策模型：**

| Level  | 范围     | 示例                              | 审批               |
| ------ | -------- | --------------------------------- | ------------------ |
| **L0** | 自动执行 | 读取文件、格式化代码              | 自动批准           |
| **L1** | 低风险   | 重命名变量、添加注释              | T1 及以上自动批准  |
| **L2** | 中等风险 | 修改函数签名、重构模块            | T2 及以上自动批准  |
| **L3** | 高风险   | 删除文件、架构变更、外部 API 调用 | 总是升级到 Captain |

**DelegationTier 映射：**

| Tier | 名称            | 最大自动批准级别 |
| ---- | --------------- | ---------------- |
| T0   | Captain Review  | L0（几乎全手动） |
| T1   | Strategic Guard | L1               |
| T2   | Trusted Mode    | L2               |
| T3   | Full Autonomy   | L3（几乎全自动） |

**子组件：**

| 组件                   | 职责                                                          |
| ---------------------- | ------------------------------------------------------------- |
| `DecisionStateMachine` | 状态转换：Pending → Approved / Rejected / Expired → Archived  |
| `LevelClassifier`      | 按 scope/cost/permissions/cross-session 分类决策级别          |
| `PolicyEngine (S5)`    | 任务驱动仲裁——对照 autonomy/cost/quality/sandbox 策略检查决策 |
| `EscalationService`    | L3 决策发布升级事件到 EventBus                                |
| `AuditLogger`          | 审计日志——所有决策的创建/批准/拒绝都有不可变记录              |

### 5.3 `@cabinet/workflow` — 工作流引擎

**WorkflowEngine——18 种节点类型的 DAG 执行器：**

```
工作流定义 (nodes + edges)
    │
    ▼
StateGraph<S> 编译
    │
    ▼
WorkflowEngine.startRun() / continueRun()
    │
    ▼
节点执行 (WorkflowHandlers 回调)
```

**18 种节点类型：**

| 类别         | 节点类型                                                      | 说明                                                         |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| **流程控制** | `start`, `end`, `ifElse`, `loop`, `parallel`, `merge`, `pass` | DAG 标准节点                                                 |
| **容器**     | `agentGroup`                                                  | 带持久化 AgentLoop 的 Agent 组                               |
| **容器**     | `manager`                                                     | AI 驱动的协调节点（Plan→Dispatch→Review→Iterate→Synthesize） |
| **执行**     | `llm`                                                         | 简单 LLM 调用                                                |
| **执行**     | `skill`                                                       | 执行注册的 Skill                                             |
| **执行**     | `tool`                                                        | 调用单个工具                                                 |
| **执行**     | `code`                                                        | 沙箱化 Node.js 子进程（stdin JSON 上下文）                   |
| **执行**     | `workflow`                                                    | 嵌套子工作流                                                 |
| **AI**       | `intentClassify`                                              | LLM 意图分类                                                 |
| **AI**       | `knowledgeBase`                                               | 知识库检索                                                   |
| **人机交互** | `approval`                                                    | 创建 Decision 并暂停直到 Captain 审批                        |
| **人机交互** | `human`                                                       | 人工节点——提交任务给人类协作者                               |
| **外部**     | `externalAgent`                                               | 通过 A2A/CLI 分派给外部 Agent                                |

**WorkflowHandlers 回调接口：**

```typescript
interface WorkflowHandlers {
  createAgentLoop?: (role, runId, opts) => Promise<AgentLoopHandle>;
  skill?: (skillId, input) => Promise<unknown>;
  tool?: (toolId, params) => Promise<unknown>;
  runCode?: (code, input, timeout) => Promise<unknown>;
  runSubWorkflow?: (workflowId, input) => Promise<unknown>;
  humanApproval?: (node, run) => Promise<{ decisionId; status }>;
  humanTask?: (node, run) => Promise<{ taskId; status }>;
  intentClassify?: (node, input) => Promise<{ intent; confidence }>;
  knowledgeBase?: (node, input) => Promise<Array<{ content; score }>>;
  dispatchToExternalAgent?: (agentId, task) => Promise<{ status; output?; decisionId? }>;
}
```

**ConditionEvaluator：**

递归下降表达式解析器，支持：

- 模板引用（`{{steps.x.output}}`）
- 比较运算（`==`, `!=`, `>`, `<`, `>=`, `<=`）
- 逻辑运算（AND, OR, NOT）
- 括号分组

### 5.4 `@cabinet/harness` — 驾驭层

**闭环反馈系统：**

```
[Agents 执行任务]
    │
    ▼
[Evaluator + QualityGate] ──→ [HarnessEscalation] ──→ [QualityResponseService]
    │                              │                          │
    ▼                              ▼                          ▼
[ObservabilityCollector]   [EventBus QualityAlert]    [AutoAdjuster ← PolicyEngine]
    │                                                       │
    ▼                                                       ▼
[HarnessAnalyst] ──→ 长期记忆                     [模型/预算/温度调整]
    │
    ▼
[SubconsciousLoop] ──→ 随机记忆召回 ──→ 洞察
    │
    ▼
[FailurePatternAnalyzer] ──→ 建议
```

**关键组件：**

| 组件                     | 职责                                                              | 时间尺度                |
| ------------------------ | ----------------------------------------------------------------- | ----------------------- |
| `Evaluator`              | Claude Haiku 输出质量评分 (0-1)                                   | 实时（每个 Agent 输出） |
| `QualityGate`            | HEI (Hypothesis-Evidence-Impact) 结构检查                         | 实时                    |
| `HarnessEscalation`      | 连续 3 次低质量 → `QualityAlert` EventBus 事件                    | 实时                    |
| `QualityResponseService` | 连续 2 次告警 → 自动调参                                          | 反应式（30 分钟冷却）   |
| `AutoAdjuster`           | 7 种调整动作（模型/预算/温度/重试/评估频率/重整合/通知船长）      | 反应式                  |
| `ObservabilityCollector` | 会话指标追踪、日报、健康分析                                      | 持续                    |
| `HarnessAnalyst`         | 日常 LLM 元分析，存储为 `harness_insight`                         | 每日                    |
| `SubconsciousLoop`       | 随机记忆召回（60 天半衰期）。知识图谱扩展。relevance > 0.6 → 洞察 | 周期性                  |
| `FailurePatternAnalyzer` | 工具失败模式提取（DB + 内存双路径）                               | 每 10 ticks             |
| `PreferenceLearner`      | Captain 偏好学习                                                  | 持续                    |
| `TeachBack`              | 高风险操作的"回教"验证                                            | 按需                    |
| `ProgressTracker`        | 结构化任务跟踪 + 依赖解析 + JSON 持久化                           | 会话级                  |

---

## 六、Layer 4：接口层

### 6.1 `@cabinet/server` — Hono API 服务器

**中间件栈（按顺序）：**

1. **CORS** ——允许 localhost / 127.0.0.1 / tauri:// 协议
2. **Rate Limiter** ——100 req/min per IP（localhost 豁免）。10,000 条目 LRU 上限
3. **Auth Middleware** ——拒绝非 localhost/Tauri/file 协议的请求

**32 个路由模块：**

| 前缀                 | 路由模块            | 职责                                       |
| -------------------- | ------------------- | ------------------------------------------ |
| `/api/secretary`     | `secretary.ts`      | 聊天、会话、上下文、子代理交互             |
| `/api/decisions`     | `decisions.ts`      | CRUD + 批准/拒绝 + 审计跟踪                |
| `/api/factory`       | `workflows.ts`      | 工作流 CRUD + 运行 + 导出/导入             |
| `/api/projects`      | `projects.ts`       | 项目 CRUD + 归档/恢复 + 文件树 + 自动检测  |
| `/api/agents`        | `agents.ts`         | Agent 列表/导入/删除 + A2A 发现 + CLI 扫描 |
| `/api/skills`        | `skills.ts`         | Skill 注册表管理                           |
| `/api/memory`        | `memory.ts`         | 记忆内省                                   |
| `/api/employees`     | `employees.ts`      | 员工记录                                   |
| `/api/settings`      | `settings.ts`       | 预算、API 密钥、委托级别、MCP、Provider    |
| `/api/harness`       | `harness.ts`        | 驾驭层——自我进化反馈回路                   |
| `/api/daemon`        | `daemon.ts`         | Agent Daemon 状态、任务入队/列表/取消/重试 |
| `/api/autopilots`    | `autopilot.ts`      | Cron/Webhook/手动触发管理                  |
| `/api/squads`        | `squads.ts`         | Squad 和队员管理                           |
| `/api/observability` | `observability.ts`  | 可观测性数据                               |
| `/api/dashboard`     | `dashboard.ts`      | Dashboard 摘要统计                         |
| `/api/audit`         | `audit.ts`          | 审计日志                                   |
| `/api/backups`       | `backups.ts`        | 备份管理                                   |
| `/api/rules`         | `rules.ts`          | 规则管理                                   |
| `/api/progress`      | `progress.ts`       | 进度追踪                                   |
| `/api/files`         | `files.ts`          | 文件操作                                   |
| `/api/deliverables`  | `deliverables.ts`   | 交付物管理                                 |
| `/api/evaluations`   | `evaluations.ts`    | 评估结果                                   |
| `/api/insights`      | `insights.ts`       | 洞察                                       |
| `/api/telemetry`     | `telemetry.ts`      | 遥测数据                                   |
| `/api/external`      | `external-agent.ts` | 外部 Agent 上下文槽 + 决策/交付物提交      |
| `/api/slot`          | `external-agent.ts` | 外部 Agent 上下文槽读写                    |
| `/health`            | `health.ts`         | 健康检查 + 系统信息                        |
| `/webhooks`          | `autopilot.ts`      | Webhook 接收器                             |
| `/.well-known`       | `agents.ts`         | A2A Agent 发现卡片                         |

**WebSocket：**

两个 WebSocket 服务器：

- `/ws/events`——主事件通道（Dashboard、ActivityFeed、实时更新）
- `/ws`——Agent 通道（外部 Agent 连接、Daemon 任务推送）

**Daemon Context：**

后台 pull-mode 任务执行系统：

- `AgentDaemon`——3 秒轮询 + 3 并发任务 + 300s 超时
- `WSDaemonClient`——WebSocket 实时推送（回退到轮询）
- Squad 路由支持

### 6.2 `@cabinet/desktop` — Tauri 桌面应用

三栏式战略指挥台：

```
┌──────────────┬──────────────────────┬─────────────┐
│   Sidebar    │     Main Chat        │  Right Rail │
│  (projects,  │  (secretary chat,    │  (preview,  │
│   sessions,  │   message history,   │   console,  │
│   agents)    │   composer)          │   files)    │
└──────────────┴──────────────────────┴─────────────┘
```

**技术栈：** Tauri 2.0（Rust 后端）+ React 19 前端 + Tailwind CSS 4.3

### 6.3 `@cabinet/ui` — 共享组件库

跨 desktop 和 web 共用的 React 组件。

### 6.4 `@cabinet/cli` — CLI 入口

`cabinet start` 启动服务器和桌面应用。

---

## 七、数据全景图

### 7.1 核心数据流

```
用户消息
    │
    ▼
┌──────────────────────────────────────┐
│            SecretaryAgent             │
│  IntentParser → routeToAgent         │
│  → AgentLoop.run(userMessage)        │
└──────────────┬───────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────┐         ┌──────────┐
│Decision  │         │ Workflow │
│Service   │         │ Engine   │
│L0-L3     │         │ 18 nodes │
└────┬─────┘         └────┬─────┘
     │                    │
     └────────┬───────────┘
              │
              ▼
┌──────────────────────────────────────┐
│           Memory Pipeline             │
│  STM → WriteGate → CB → LTM → KG    │
└──────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────┐
│             Harness                   │
│  Evaluate → QualityGate → Adjust     │
└──────────────────────────────────────┘
```

### 7.2 关键实体

| 实体           | 存储                                          | 生命周期                               |
| -------------- | --------------------------------------------- | -------------------------------------- |
| Project        | SQLite `projects`                             | 创建 → 活跃 → 归档                     |
| Session        | 文件系统 `~/.cabinet/sessions/`               | 创建 → 活跃 → 归档                     |
| Decision       | SQLite `decisions`                            | Pending → Approved/Rejected → Archived |
| WorkflowRun    | SQLite `workflow_runs`                        | Pending → Running → Completed/Failed   |
| Employee       | SQLite `entity_employees`                     | 持久                                   |
| Skill          | 文件系统 `~/.cabinet/skills/` + SkillRegistry | 持久                                   |
| Agent          | SQLite `agent_roles`                          | 持久                                   |
| Memory (STM)   | SQLite `short_term` + 内存 LRU                | TTL 30min                              |
| Memory (LTM)   | SQLite `memory_embeddings` + FTS5 + HNSW      | 持久（500K 上限）                      |
| KnowledgeGraph | SQLite `memory_entities` + `memory_relations` | 持久                                   |
| Checkpoint     | SQLite `checkpoints`                          | 会话内                                 |
| StepEvent      | SQLite `step_events`                          | 持久                                   |
| AuditLog       | SQLite `audit_logs`                           | 不可变                                 |
| CostHistory    | SQLite `cost_history`                         | 日/周/月聚合                           |
| ApiKey         | 文件系统 `~/.cabinet/` + AES-256 加密         | 持久                                   |
| Metrics        | SQLite + 内存双写                             | 持续                                   |

---

## 八、安全模型

### 8.1 分层安全策略

```
Layer 1: 认证
  ├── origin-based (allow localhost/Tauri/file only)
  ├── Optional Bearer Token (API 访问)
  └── HMAC Task Token (外部 Agent)

Layer 2: 授权
  ├── DelegationTier (T0-T3)
  ├── SafetyChecker (工具分类: read_only/write/destructive)
  └── PolicyEngine S5 (任务驱动仲裁)

Layer 3: 输入验证
  ├── ContentGuardObserver (用户输入和 LLM 输出过滤)
  └── 危险命令黑名单 (rm -rf, dd, mkfs, chmod 777 等)

Layer 4: 数据保护
  ├── AES-256 加密 (API Keys + 敏感字段)
  ├── SQLite WAL 模式 + 外键约束
  └── BackupManager (完整性验证 + 恢复前快照)

Layer 5: 速率限制
  └── RateLimiter (100 req/min per IP, localhost 豁免)
```

### 8.2 已知安全差距（已在对标报告中识别）

| 差距                                         | 严重性  | 状态   |
| -------------------------------------------- | ------- | ------ |
| **无沙箱隔离**——shell 命令在宿主机直接执行   | P0 严重 | 待改进 |
| **无操作确认机制**——高风险操作前无强制确认   | P0 严重 | 待改进 |
| **无循环检测**——Agent 可能陷入重复 tool-call | P0 严重 | 待改进 |
| **无网络隔离**——执行命令时无网络限制         | P2 中等 | 待改进 |
| **无路径穿越防护**——文件操作无沙箱层统一拦截 | P2 中等 | 待改进 |

---

## 九、工程纪律与质量保障

### 9.1 代码规范

| 规则                             | 说明                                      |
| -------------------------------- | ----------------------------------------- |
| `strict: true`                   | TypeScript 全局严格模式                   |
| `noUncheckedIndexedAccess: true` | 所有索引访问需处理 undefined              |
| `verbatimModuleSyntax: true`     | import 类型时必须用 `import type`         |
| `tsc -b` (composite/build mode)  | 构建模式，不用 plain mode                 |
| 500 行上限/文件                  | 超过 800 行必须拆分新模块                 |
| 禁止直接 import `better-sqlite3` | 统一通过 `@cabinet/storage` 访问数据库    |
| 禁止前端直接调用 LLM API         | 必须通过 `@cabinet/gateway` → server 路由 |
| Layer 1/2 禁止 import React      | 基础设施和 Agent 核心层不依赖 UI          |

### 9.2 质量工具链

| 工具                | 用途                                  |
| ------------------- | ------------------------------------- |
| `pnpm test`         | Vitest 运行所有测试                   |
| `pnpm typecheck`    | tsc --noEmit 类型检查所有包           |
| `pnpm lint:arch`    | 验证 4 层依赖规则，所有错误带修复指令 |
| `pnpm build`        | tsc -b 构建所有包                     |
| `.husky/pre-push`   | Pre-push 钩子                         |
| CI (GitHub Actions) | push 和 PR 到 main 时自动运行         |

### 9.3 公开 API 约定

- 所有包使用 `@cabinet/` scope
- 每个包的入口: `dist/index.js`，类型: `dist/index.d.ts`
- 公共 API 通过 `index.ts` (barrel export) 暴露
- 内部模块不得被其他包直接 import
- 类型定义放在 `@cabinet/types`，不散落在各包中重复
- 新包创建后必须加入 `pnpm-workspace.yaml`

---

## 十、控制论设计框架

### 10.1 VSM（Viable System Model）映射

Cabinet 的设计显式使用了 Stafford Beer 的 **可行系统模型 (VSM)**，将自身映射为 5 个系统层：

| VSM 层                | Cabinet 映射                                                                 | 职责                                     |
| --------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| **S1 (Operations)**   | AgentLoop + ToolExecutor + Memory I/O                                        | 基础运营——执行任务、调用工具、读写记忆   |
| **S2 (Coordination)** | Workflow Engine + Meeting Protocol + Decision StateMachine                   | 协调——多步骤编排、Agent 间协作、冲突解决 |
| **S3 (Control)**      | Harness (QualityGate + Observability + AutoAdjuster)                         | 控制——质量保障、监控、自动调参           |
| **S4 (Intelligence)** | Curator + PreferenceLearner + KnowledgeGraph + SubconsciousLoop              | 智能——模式提取、学习、知识组织           |
| **S5 (Policy)**       | Decision L0-L3 + DelegationTier + SafetyChecker + PolicyEngine + BudgetGuard | 策略——授权边界、安全、预算、价值观       |

### 10.2 8 条控制原则

来自 `AUDIT_REPORT.md` (76KB)，当前评分 83/100，目标 88/100。每条原则按 VSM 层评估：

| #   | 原则         | 当前状态                            |
| --- | ------------ | ----------------------------------- |
| 1   | 递归可行系统 | ✅ S1-S5 递归映射                   |
| 2   | 闭环认知     | ✅ Observer Pipeline + Harness 反馈 |
| 3   | 多样性匹配   | ⚠️ ToolPruner 部分满足              |
| 4   | 结构性决定论 | ⚠️ 4 层架构提供基础                 |
| 5   | 对话式交互   | ✅ Secretary + Decision             |
| 6   | 自我参照     | ✅ SystemKnowledgeBase (17 条)      |
| 7   | 递推解耦     | ✅ 层间依赖单向                     |
| 8   | 稳态维持     | ⚠️ Harness AutoAdjuster             |

### 10.3 Process Identity Score (PIS)

4 因子 Agent 在长执行序列中的"身份一致性"评分。当 PIS 严重下降时触发 `PISAlert` EventBus 事件，通知 Captain。

---

## 十一、与同类项目的定位差异

### 11.1 差异化维度

| 维度         | Cabinet                                | 典型编码 Agent (Codex/Claude Code) | 典型 Agent 框架 (DeerFlow/LangGraph) | 典型个人助手 (Hermes) |
| ------------ | -------------------------------------- | ---------------------------------- | ------------------------------------ | --------------------- |
| **核心场景** | 项目管理 + 内阁决策                    | 编码                               | AI 应用开发                          | 个人助手              |
| **决策模型** | L0-L3 分级 + DelegationTier + AuditLog | 无                                 | 无                                   | 无                    |
| **工作流**   | 18 种节点 + AI/人工/外部 Agent         | 无/简单                            | 图编排                               | 无/简单               |
| **记忆**     | 5 层 + 知识图谱 + 衰减                 | 基础                               | 简单 JSON                            | 文件系统 + FTS5       |
| **多 Agent** | 内阁协作 + Dispatcher + Squad          | 基础委派                           | Subagent                             | 委派                  |
| **交互**     | 桌面 + Web（不盯过程）                 | TUI（终端）                        | API/Web                              | CLI/IM                |
| **治理**     | VSM 5 层控制论                         | 无                                 | 无                                   | 无                    |
| **成本**     | CostTracker + BudgetGuard              | Plan 限制                          | 无                                   | 无                    |

### 11.2 Cabinet 的独特卖点

1. **Decision 状态机**——AI 系统中最完整的决策治理模型（L0-L3 + DelegationTier + AuditLog + PolicyEngine）
2. **Workflow 引擎**——18 种节点类型覆盖从全自动到全人工的所有协作模式
3. **记忆流水线**——WriteGate + CascadeBuffer + 知识图谱 + 记忆衰减——比任何对标项目都更系统
4. **控制论框架**——VSM 5 层映射 + 8 条控制原则 + PIS 评分——系统级的自我认知
5. **成本控制**——CostTracker + BudgetGuard + RateLimitTracker + FallbackChain——RMB 级精度

---

## 十二、当前成熟度与改进路线

### 12.1 成熟度评估

| 子系统                    | 成熟度     | 说明                                                  |
| ------------------------- | ---------- | ----------------------------------------------------- |
| **Agent Loop + Observer** | ⭐⭐⭐⭐   | 12 个 Observer 覆盖主要关注点。手动执行循环有改进空间 |
| **LLM Gateway**           | ⭐⭐⭐⭐⭐ | 成本控制全面超越对标项目                              |
| **Memory**                | ⭐⭐⭐⭐⭐ | 5 层流水线 + 知识图谱，业界最完整的记忆系统之一       |
| **Decision**              | ⭐⭐⭐⭐⭐ | L0-L3 分级决策是 Cabinet 的独特优势                   |
| **Workflow**              | ⭐⭐⭐⭐   | 18 种节点类型 + DAG 引擎，但缺少 UI 蓝图编辑器        |
| **Secretary**             | ⭐⭐⭐⭐   | 4 层意图识别级联，但缺少 Agent 自主委派               |
| **Harness**               | ⭐⭐⭐⭐   | 闭环反馈完整，但 AutoAdjuster 的调整范围有限          |
| **Skill**                 | ⭐⭐⭐     | 三级渐进加载是优势，但缺少自主创建和生命周期管理      |
| **安全（沙箱）**          | ⭐⭐       | 无沙箱隔离——最大的安全差距                            |
| **安全（权限）**          | ⭐⭐⭐⭐   | DelegationTier + 工具分类，但缺少通配符规则           |
| **TUI/终端**              | ⭐         | 无 TUI——依赖桌面和 Web UI                             |
| **工程纪律**              | ⭐⭐⭐⭐   | lint:arch + 行数限制 + 控制论 + TypeScript strict     |

### 12.2 已知改进路线（来自 ADP 分析和对标报告）

**P0（安全紧急）：**

- 沙箱隔离执行
- Clarification 机制（操作确认）
- Loop Detection（循环检测）

**P1（架构增强 1-2 周）：**

- 上下文压缩升级（LLM 结构化摘要 + post-compact 附件）
- Agent 自主创建 Skill
- Agent 自主 spawn 子代理 + 超时/取消
- 通配符权限规则 + per-agent Ruleset
- 执行引擎独立化
- Plan Mode 支持

**P2（体验优化）：**

- Provider 插件化
- MCP 服务器模式
- 远程 Skill 加载 + Skill 搜索
- 会话 Fork 机制
- TUI 支持（长期）

---

> 报告结束。
