# Cabinet V2.0 — 全面优化实施方案

**基准**: [AUDIT_REPORT_V3.md](./AUDIT_REPORT_V3.md) (2026-06-12, HEAD `67c716a`)
**当前状态**: 多项任务已在后续 commits 中完成。详见各节标记。
**目标**: 从 A- (89/100) → A (93+/100)，彻底消除已知技术债务
**方法论**: 按架构关切分 4 条并行轨道，每条内部串行，轨道间独立

---

## 目录

1. [总体策略](#1-总体策略)
2. [轨道 A: 安全与边界加固](#2-轨道-a-安全与边界加固)
3. [轨道 B: 模块拆分与代码质量](#3-轨道-b-模块拆分与代码质量)
4. [轨道 C: 自适应系统激活](#4-轨道-c-自适应系统激活)
5. [轨道 D: 架构债务 Consolidation](#5-轨道-d-架构债务-consolidation)
6. [汇总: 工作量、依赖与里程碑](#6-汇总-工作量依赖与里程碑)

---

## 1. 总体策略

### 1.1 设计原则

本次优化不是渐进式修补。四条轨道覆盖系统的四个架构关切层，每条轨道内部按依赖顺序执行，轨道之间可并行推进。

```
轨道 A (安全边界)  ─┐
轨道 B (代码质量)  ─┼── 并行推进 ──→ 集成验证 ──→ A (93+)
轨道 C (自适应)    ─┤
轨道 D (整合)      ─┘
```

### 1.2 控制论目标映射

| 轨道        | 主要影响的原则                                              | 评分提升预期                        |
| ----------- | ----------------------------------------------------------- | ----------------------------------- |
| A: 安全边界 | 原则 5 (Structural Determinism), 原则 7 (Hard Ceiling)      | 安全边界: A- → A                    |
| B: 代码质量 | 原则 6 (VSM Recursive), 原则 2 (Variety)                    | 代码质量: A- → A, 系统体重: B+ → A- |
| C: 自适应   | 原则 1 (Process), 原则 4 (Closed-Loop), 原则 8 (Enablement) | 过程连续性: A- → A                  |
| D: 整合     | 原则 6 (VSM), 原则 3 (Dialogic)                             | 架构设计: A → A+                    |

### 1.3 验证标准

每个任务完成后必须通过五级验证:

- **L1 - 构建**: `pnpm build` 零错误
- **L2 - 类型**: `pnpm typecheck` 零错误
- **L3 - 架构**: `pnpm lint:arch` 通过
- **L4 - 测试**: 相关包的 `pnpm -F <package> test` 全部通过
- **L5 - 行数**: 拆分后的文件均 ≤500 行

---

## 2. 轨道 A: 安全与边界加固

> **控制论目标**: 消除 MCP 安全沙盒的架构绕过路径，修复 LevelClassifier 逻辑 bug，解决跨 Agent 数据共享的概念重复。
> **预计总工时**: 5-6 天

---

### A.1 MCP 安全沙盒 T0-T3 原生集成 ✅ **已完成**

**状态**: `mcp-manager.ts` 的 `callTool()` 已接收 `trustLevel` 参数，`resolveMcpDecision()` 内部直接执行 T0-T3 规则。T0 阻止所有非只读，T1 阻止 moderate+destructive，T2 阻止 destructive，T3 全部放行。审计日志已添加。

**涉及文件**:

- `apps/server/src/mcp/mcp-manager.ts` — 主要修改目标
- `packages/agent/src/safety.ts` — `resolveEffectiveCategory()` 逻辑
- `packages/types/src/boundaries.ts` — `DelegationTier` 类型

**实施方案**:

1. 在 `mcp-manager.ts` 的 `callTool()` 方法中直接接收 `trustLevel: TrustLevel` 参数
2. 根据 trust level 在 MCP manager 内部执行工具调用前的权限检查:
   - **T0 (CaptainReview)**: 所有工具需要审批。只允许 `read_only` 类别自动通过
   - **T1 (StrategicGuard)**: `read_only` + `light_write` 自动通过；`moderate` 需确认；`destructive` 阻止
   - **T2 (TrustedMode)**: 仅 `destructive` 类别阻止
   - **T3 (FullAutonomy)**: 全部通过，预算上限为唯一门槛
3. 将 `MCPSideEffectRisk` 映射内联到 MCP manager 内部，不再依赖外部 SafetyGuard
4. 添加 MCP 工具调用审计日志（记录 toolName、trustLevel、decision、timestamp）
5. 添加测试：验证每种 trust level 下 `callTool()` 对各类别工具的行为

**验证**:

- MCP manager 单元测试: T0-T3 每种级别 × 4 种工具类别的行为矩阵 (16 个 test case)
- 确认绕过路径已消除: 直接从 MCP manager 调用不可跳过 trust level 检查
- `pnpm typecheck` + `pnpm build` 通过

**预计**: 2-3 天

---

### A.2 LevelClassifier L0 守卫顺序修复 ✅ **已完成**

**状态**: L0 检查已移到 L1 之前，守卫顺序从最严格到最宽松排列。

**涉及文件**:

- `packages/decision/src/level-classifier.ts` (line 37-42)

**实施方案**:

将 L0 检查移到 L1 之前，使守卫从最严格到最宽松排列:

```typescript
// 修改后: L3 → L2 → L0 → L1 (default)
// L0 必须在 L1 之前检查，因为 L0 条件是 L1 的真子集

if (/* L3 conditions */) {
  level = DecisionLevel.L3;
} else if (/* L2 conditions */) {
  level = DecisionLevel.L2;
} else if (!input.isCrossSession && input.optionCount <= 2 && totalCost === 0) {
  // L0: 无副作用、无成本、单次调用、极少选项
  level = DecisionLevel.L0;
} else {
  // L1: 会话内低复杂度操作的默认级别
  level = DecisionLevel.L1;
}
```

**验证**:

- 单元测试: `{ optionCount: 2, totalCost: 0, isCrossSession: false }` → L0（不再是 L1）
- 验证 L3/L2/L1 分类不受影响
- `pnpm -F @cabinet/decision test` 通过

**预计**: 0.5 天

---

### A.3 ContextSlot ↔ Blackboard 概念统一

**问题**: `ContextSlot`（primitives.ts，用于 TaskQueueEntry 数据总线）和 `AgentBlackboard`（blackboard.ts，用于多 Agent 协作的 topic-based pub/sub）是两个并行、独立的数据共享机制。两者职责有重叠但无协调。

**涉及文件**:

- `packages/types/src/primitives.ts` — `ContextSlot` 接口 (line 300-324)
- `packages/agent/src/blackboard.ts` — `AgentBlackboard` class
- `packages/agent/src/blackboard-topic-router.ts` — EventBus 路由
- `packages/secretary/src/session-manager.ts` — ContextSlot 消费方
- `packages/agent/src/dispatcher.ts` — TaskQueueEntry.slot 消费方

**实施方案**:

以 Blackboard 为统一抽象，ContextSlot 降级为 Blackboard 的持久化快照格式:

1. 在 `AgentBlackboard` 中添加 `importFromContextSlot(slot: ContextSlot)` 方法:
   - `slot.project` → blackboard topic `project`
   - `slot.memories` → blackboard topic `memories`
   - `slot.preferences` → blackboard topic `preferences`
   - `slot.files` → blackboard topic `files`
   - `slot.discoveries` → blackboard topic `discoveries`
   - `slot.security` → blackboard topic `security`
2. 添加 `exportToContextSlot(): ContextSlot` 反向方法
3. ContextSlot 保留为持久化快照格式（写入 storage），Blackboard 作为运行时数据面
4. `ContextSlot.version` 映射到 Blackboard 的 per-topic 版本计数器
5. 文档化两者的职责边界: ContextSlot = 持久化/序列化, Blackboard = 运行时/实时

**验证**:

- Blackboard `importFromContextSlot()` / `exportToContextSlot()` 往返测试（导入 → 导出 → 数据一致）
- 现有 TaskQueueEntry 消费方不破坏
- `pnpm typecheck` + `pnpm build` 通过

**预计**: 2 天

---

## 3. 轨道 B: 模块拆分与代码质量

> **控制论目标**: 消除超大文件的认知负担，使 VSM 各层的模块边界清晰可辨。
> **预计总工时**: 10-12 天

---

### B.1 agent-loop.ts 拆分 (1,287 → ≤500 行)

**问题**: `agent-loop.ts` 是系统中最大的核心文件。`_execute()` 生成器 323 行闭包量大，难以隔离测试。`_assembleContext()`、`_wrapExecution()`、12 个 Observer 初始化全部混在一个 class 中。

**涉及文件**:

- `packages/agent/src/agent-loop.ts` (1,287 行) — 拆分源
- 新建文件:
  - `packages/agent/src/execution/execute-generator.ts` — `_execute()` 生成器
  - `packages/agent/src/execution/context-assembler.ts` — `_assembleContext()` 方法
  - `packages/agent/src/execution/observer-factory.ts` — Observer 初始化逻辑

**实施方案**:

1. **提取 `_execute()` 生成器** → `execution/execute-generator.ts`:
   - 纯函数签名: `createExecuteGenerator(config: ExecuteConfig): AsyncGenerator<AgentEvent>`
   - `ExecuteConfig` 包含所有依赖: observers, llmGateway, toolExecutor, safetyCheck, contextMonitor 等
   - 不持有 `this` 引用 — 所有状态通过 config 显式传入
   - agent-loop.ts 中 `_execute()` 变为一行委托: `return createExecuteGenerator(this.buildExecuteConfig())`

2. **提取 `_assembleContext()`** → `execution/context-assembler.ts`:
   - `assembleContext(params: AssembleParams): Promise<ContextResult>`
   - 包含: system prompt 构建、MCP resources/prompts 注入、skill 注入、blackboard 快照注入
   - 不再直接访问 `this.conversationHistory` — 通过参数传入

3. **提取 Observer 初始化** → `execution/observer-factory.ts`:
   - `createObserverPipeline(options: ObserverFactoryOptions): ObserverPipeline`
   - 根据 preset + 显式配置决定激活哪些 Observer
   - 返回组装好的 `ObserverPipeline` 实例

4. **AgentLoop 类瘦身**:
   - 保留: 公共 API (`run`, `runStreaming`, `continueWithUserInput`)、状态管理
   - 委托: 所有执行逻辑通过注入的 factory 函数 + ObserverPipeline
   - 简化 `_wrapExecution()` — 移除与 `_execute()` 重复的错误处理

**验证**:

- 拆分后 agent-loop.ts ≤ 500 行
- 三个新文件各 ≤ 400 行
- 现有 AgentLoop 测试全部通过
- `pnpm -F @cabinet/agent test` 通过

**预计**: 3 天

---

### B.2 tools/index.ts 拆分 (1,301 → 分散模块)

**问题**: `tools/index.ts` 是巨型 barrel，包含所有工具定义和工具执行逻辑。

**涉及文件**:

- `packages/agent/src/tools/index.ts` (1,301 行) — 拆分源
- 新建文件:
  - `packages/agent/src/tools/file-tools.ts` — 文件读写工具
  - `packages/agent/src/tools/search-tools.ts` — 搜索/grep/glob 工具
  - `packages/agent/src/tools/skill-tools.ts` — skill 相关工具
  - `packages/agent/src/tools/execution-tools.ts` — bash/command 工具
  - `packages/agent/src/tools/web-tools.ts` — web fetch/search 工具
  - `packages/agent/src/tools/memory-tools.ts` — memory 操作工具
  - `packages/agent/src/tools/tool-registry.ts` — 工具注册/查找/分类

**实施方案**:

1. 按功能域拆分为 6 个独立工具模块，每个 ≤ 300 行
2. `tool-registry.ts` 作为统一的工具注册入口，维护 `Map<string, ToolDefinition>`
3. `index.ts` 变为纯 re-export barrel（≤ 50 行）
4. 每个工具模块导出 `registerTools(registry: ToolRegistry): void` 函数

**验证**:

- 拆分后每个文件 ≤ 300 行
- `pnpm -F @cabinet/agent test` 通过（含 tools 测试）
- 工具注册/发现逻辑不变

**预计**: 2-3 天

---

### B.3 Server 超大文件拆分 (>1,000 行)

**问题**: `apps/server/src/` 下有 6 个 >1,000 行的文件，严重违反 CABINET.md 500 行上限。

| 文件                                    | 行数  | 拆分策略                                                                                 |
| --------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `context.ts`                            | 1,835 | 按功能域拆分: server-context.ts, agent-context.ts, session-context.ts, tool-context.ts   |
| `capabilities.ts`                       | 1,330 | 按 capability 类别拆分: tool-capabilities.ts, model-capabilities.ts, mcp-capabilities.ts |
| `routes/workflows.ts`                   | 1,277 | 按路由路径拆分: workflow-crud.ts, workflow-execution.ts, workflow-blueprint.ts           |
| `routes/secretary/tool-dependencies.ts` | 1,263 | 按依赖类别拆分: file-deps.ts, search-deps.ts, skill-deps.ts, external-deps.ts            |
| `secretary/agent-factory.ts`            | 1,067 | 按创建阶段拆分: agent-config.ts, agent-initialization.ts, agent-lifecycle.ts             |
| `routes/secretary/index.ts`             | 775   | 按路由组拆分: chat.ts, session.ts, agent-management.ts                                   |

**实施方案**:

每个文件独立拆分:

1. 识别文件内的独立功能域
2. 为每个功能域创建独立模块
3. 原文件变为薄路由注册 + re-export
4. 共享类型提取到 `apps/server/src/types/`

**验证**:

- 拆分后每个文件 ≤ 500 行
- `pnpm build` + `pnpm typecheck` 通过
- 服务端集成测试通过 (`pnpm test:e2e`)
- API 路由不变（URL 和响应格式不变）

**预计**: 4-5 天

---

### B.4 次级超大文件拆分 (500-800 行)

| 文件                                            | 行数 | 拆分策略                                                                               |
| ----------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| `packages/agent/src/daemon/agent-daemon.ts`     | 780  | task-executor.ts + heartbeat-monitor.ts + workspace-manager.ts (各自 ≤ 400 行)         |
| `packages/memory/src/long-term.ts`              | 709  | 在 D.3 中一并处理: store.ts + search.ts + embedding.ts + hnsw-index.ts (各自 ≤ 300 行) |
| `packages/agent/src/safety.ts`                  | 643  | content-safety.ts + tool-safety.ts + trust-gate.ts (各自 ≤ 300 行)                     |
| `apps/server/src/routes/dashboard.ts`           | 639  | dashboard-summary.ts + dashboard-cost.ts + dashboard-agents.ts (各自 ≤ 300 行)         |
| `apps/server/src/secretary/skill-middleware.ts` | 635  | skill-injection.ts + skill-extraction.ts + skill-validation.ts                         |
| `packages/agent/src/adapters/harness/a2a.ts`    | 584  | a2a-http.ts + a2a-ws.ts + a2a-types.ts                                                 |
| `packages/secretary/src/secretary-agent.ts`     | 506  | secretary-routing.ts + secretary-session.ts + secretary-lifecycle.ts                   |

**验证**: 每个文件 ≤ 500 行, `pnpm build` + `pnpm typecheck` + 包测试通过

**预计**: 3 天

---

## 4. 轨道 C: 自适应系统激活

> **控制论目标**: 将系统的 L4 自适应能力从"存在但默认关闭"变为"激活且可观测"。
> **预计总工时**: 5-6 天

---

### C.1 Observer Preset 重新设计 + 默认激活

**问题**: 12 个 Observer 中 7 个默认关闭（仅 `preset: 'full'` 激活）。系统的 L4 自适应能力存在但未激活。

**涉及文件**:

- `packages/agent/src/agent-loop.ts` — Observer 初始化逻辑
- `packages/agent/src/execution/observer-factory.ts` — B.1 中新建的文件

**实施方案**:

重新设计 preset 体系，缩小 standard 和 full 之间的巨大差距:

| Preset                  | 激活的 Observer                                                                                      | 适用场景               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------- |
| `minimal`               | SafetyCheck, ToolExecute                                                                             | 简单脚本、单一工具调用 |
| **`standard` (新默认)** | SafetyCheck, ToolExecute, ContextMonitor, Checkpoint, **ProcessIdentity (log_only)**, **Reflection** | 常规开发任务           |
| **`enhanced` (新增)**   | standard + **Judge**, **AutoReplan**, **Blackboard**                                                 | 复杂多步任务           |
| `full`                  | enhanced + ContentGuard, Handoff, StepEvent, **SelfConsistency**                                     | 安全关键/审计任务      |

关键变更:

- `ProcessIdentityObserver`: 从 `full` → `standard`, 模式 `log_only`（不干预，仅记录趋势）
- `ReflectionObserver`: 从 "非 minimal" → `standard`（常规反思）
- 新增 `enhanced` preset: 填补 standard 和 full 之间的巨大功能差距
- `JudgeObserver` + `AutoReplanObserver`: 从 `full` → `enhanced`
- `standard` 成为新的默认 preset

**验证**:

- 各 preset 下 Observer 数量验证 (minimal=2, standard=6, enhanced=9, full=12)
- `log_only` 模式下 PIS 不调用 LLM、不产生副作用
- `pnpm -F @cabinet/agent test` 通过

**预计**: 1 天

---

### C.2 SelfConsistencyEngine 重构为 Observer

**问题**: `SelfConsistencyEngine` 是独立对象而非 Observer，打破统一的 Observer Pipeline 抽象。

**涉及文件**:

- `packages/agent/src/reasoning/self-consistency.ts` — 重构源
- `packages/agent/src/observers/self-consistency.ts` — 新建

**实施方案**:

1. 创建 `SelfConsistencyObserver implements AgentObserver`:
   - `onAfterLLM(response)` — 对关键声明采样，调用模型反问 "Is this consistent with your prior statements?"
   - 如发现不一致，emit `consistency_warning` event
2. 删除原独立 `SelfConsistencyEngine` class
3. 在 observer-factory.ts 中注册（`full` preset）

**验证**:

- `SelfConsistencyObserver` 通过 Observer Pipeline 标准接口工作
- self-consistency 检查功能不变（直接移植逻辑）
- `pnpm -F @cabinet/agent test` 通过

**预计**: 1 天

---

### C.3 SubconsciousLoop ↔ AgentLoop 直接集成

**问题**: Phase 6.3 的 SubconsciousLoop 仅在 harness 层运行，与 AgentLoop 无直接耦合。高频 AgentLoop 和低频 SubconsciousLoop 独立运行，无协调。

**涉及文件**:

- `packages/harness/src/subconscious-loop.ts` — 已有实现
- `packages/agent/src/agent-loop.ts` — 集成点
- `packages/agent/src/observers/` — 新增 `SubconsciousInsightObserver`

**实施方案**:

1. AgentLoop 通过 EventBus 订阅 `'subconscious_insight'` 事件
2. 新增 `SubconsciousInsightObserver`:
   - 监听 EventBus 上的 `subconscious_insight` 事件
   - 在 LLM 调用前，将相关 insight 注入 system prompt（预算: ≤500 tokens）
   - 记录注入的 insight ID 以追踪影响
3. AgentLoop 构造函数接受可选的 `eventBus: EventBus` 参数

**验证**:

- SubconsciousLoop 产生的 insight 出现在 AgentLoop system prompt 中
- insight 注入 ≤ 500 token 预算
- 无 eventBus 时 AgentLoop 正常工作（向后兼容）
- `pnpm -F @cabinet/agent test` + `pnpm -F @cabinet/harness test` 通过

**预计**: 1-2 天

---

### C.4 内置 Skill 按需加载

**问题**: `built-in-skills.ts` 的 4 个大 prompt 模板 (484 行) 在每次 AgentLoop 的 `_assembleContext()` 中全部注入 system prompt，造成 token 浪费。

**涉及文件**:

- `packages/agent/src/built-in-skills.ts` — 模板定义
- `packages/agent/src/skill-registry.ts` — 加载逻辑
- `packages/agent/src/agent-loop.ts` (或 B.1 的 context-assembler.ts) — 注入点

**实施方案**:

利用 SkillRegistry 已有的 L1/L2/L3 渐进加载架构:

1. **L1 (discover)**: 内置 skill 始终在 `discover()` 中返回元数据（name, description ≤100 chars, kind, exposure）
2. **L2 (load)**: 仅在 AgentLoop 检测到任务需要该 skill 时调用 `load(name)` 获取完整 prompt 模板
3. 在 `_assembleContext()` 中:
   - 不再调用 `registry.getPromptSkills()` 全量注入
   - 改为从用户消息提取关键词 → 与 skill description 做简单匹配 → 仅 `load()` 匹配的 skill
4. 内置 skill 的 `promptTemplate` 保留完整内容供 L2 使用

**验证**:

- 常规对话（非 skill 相关）的 system prompt 不包含完整内置 skill 模板
- skill 触发关键词匹配时，对应 skill 模板正确注入
- `pnpm -F @cabinet/agent test` 通过

**预计**: 1 天

---

### C.5 AdaptiveContextMonitor 降低激活门槛

**问题**: AdaptiveContextMonitor 虽 `DEFAULT_ADAPTIVE_CONFIG.enabled: true`，但实际激活需同时传入 `metricsRepo` + `eventBus`。在典型构造路径中常被绕过。

**涉及文件**:

- `packages/agent/src/context-monitor-adaptive.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/execution/observer-factory.ts` (B.1 新建)

**实施方案**:

1. 新增 `ContextMonitorFactory.create(options): ContextMonitor`:
   - 当 `metricsRepo` 不可用: 使用静态阈值 (`explorationRate: 0`)，功能正常但不学习
   - 当 `metricsRepo` 可用: 自动启用自适应学习 (`explorationRate: 0.1`)
2. `eventBus` 不再作为硬性前提 — AdaptiveContextMonitor 可在无 eventBus 时静默运行
3. 消除调用方的决策负担 — 不再需要手动判断创建 adaptive vs static

**验证**:

- 无 `metricsRepo`: 使用静态阈值，ContextMonitor 功能正常
- 有 `metricsRepo`: 自适应学习激活，阈值从历史数据中学习
- `pnpm -F @cabinet/agent test` 通过

**预计**: 1 天

---

## 5. 轨道 D: 架构债务 Consolidation

> **控制论目标**: 消除 v2→v3 过程中遗留和引入的架构债务。
> **预计总工时**: 6-7 天

---

### D.1 `@cabinet/graph` 包删除 ✅ **已完成**

**问题**: `@cabinet/graph` (753 行) 仍存在，但 agent-loop.ts 已不使用。当前仅 3 个消费者，其中 1 个是 type-only。

**涉及文件**:

- `packages/graph/` — 删除目标
- `packages/agent/src/agent-node.ts` — 仅 import `END` (常量)
- `packages/agent/src/trace.ts` — 仅 type import `CompiledGraph`, `StreamEvent`
- `packages/workflow/src/engine.ts` — import `StateGraph`, `Annotation`
- `packages/agent/package.json` + `packages/workflow/package.json` — 依赖声明
- `pnpm-workspace.yaml` + `tools/arch-lint.ts` — 包注册

**实施方案**:

1. 将 `END` 常量内联到 `agent-node.ts`（一个字符串 `'__end__'`）
2. 将 `CompiledGraph` 和 `StreamEvent` 类型移至 `@cabinet/types`
3. 将 `StateGraph` + `Annotation` + `validation.ts` 移至 `packages/workflow/src/graph/`（唯一实际使用者）
4. 删除 `packages/graph/` 目录
5. 从 `pnpm-workspace.yaml` 和两个 `package.json` 移除依赖
6. 更新 `tools/arch-lint.ts` 中的 layer 定义

**实际执行**:

1. `END` 常量直接定义在 `packages/agent/src/agent-node.ts` 中（`'__END__'`）。
2. `StreamEvent` 类型本地化到 `packages/agent/src/trace.ts`，不再依赖 graph 包。
3. `packages/workflow/src/engine.ts` 删除 `StateGraph`/`Annotation` 双路径，改为单一邻接图遍历 + ifElse 分支解析。
4. 删除 `packages/graph/` 目录，并从 `packages/agent/package.json`、`packages/workflow/package.json`、根/包 tsconfig 引用中移除。

**验证**:

- `grep -r "@cabinet/graph" packages/ apps/` 仅返回注释（无实际 import）
- `pnpm build` + `pnpm typecheck` 全部通过
- `pnpm -F @cabinet/workflow test` + `pnpm -F @cabinet/agent test` 通过（仅保留 4 个预存 characterization 失败）

**预计**: 1 天

---

### D.2 CascadeBuffer ↔ Curator 管道统一 ✅

**问题**: 记忆系统仍有两条并行管道 — `CascadeBuffer.consolidateBasic()` (daily tier, 零 LLM) 和 `Curator` (register/working tier, LLM)。职责已分离但缺少统一调度入口。

**涉及文件**:

- `packages/memory/src/cascade-buffer.ts`
- `packages/memory/src/consolidation.ts`
- `packages/memory/src/memory-facade.ts`

**实施方案**:

在 `MemoryFacade.consolidateSession()` 中实现统一调度:

```
consolidateSession(sessionId):
  1. CascadeBuffer.consolidateBasic() → daily tier (快速, 零 LLM)
  2. 检查 daily tier 中是否有高价值条目需要升级
  3. 如有候选且 LLM gateway 可用 → Curator.curate(candidates) → register/working tier
  4. 返回 ConsolidationResult { daily: n, curated: m }
```

删除 `ConsolidationService` 中与 `Curator` 重复的 LLM 调用路径。

**实际执行**:

1. `CascadeBuffer` 增加 `getTopics()` 与公开 `defaultSummarizer()`，支持外部 summarizer。
2. `ConsolidationService` 新增 `ConsolidationServiceOptions.curatorSummarizer` 可选参数。
3. `autoSeal()` 与 `flushSession()` 统一通过 `sealWithCurator()` 进行 L1 摘要：提供 Curator summarizer 时走 LLM 摘要，否则走默认拼接摘要。
4. `MemoryFacade.consolidateSession()` 保持统一调度入口：先 `consolidateBasic()` 再可选 `consolidateWithLLM()`。
5. 新增单元测试验证 `curatorSummarizer` 在 flush 时被调用。

**验证**:

- 每日 consolidate 仍正常工作
- 高价值记忆从 daily → register/working 的升级路径可验证
- `pnpm -F @cabinet/memory test` 通过

**预计**: 1-2 天

---

### D.3 LTM.store() 进一步拆分 ✅

**问题**: `LongTermMemory.store()` 仍约 80 行。虽已委托 entity extraction → KG、contradiction → KG、LLM → 异步，但方法体仍偏大。

**涉及文件**:

- `packages/memory/src/long-term.ts` — store() 方法 (约 80 行)

**实施方案**:

提取内部步骤为独立私有方法:

1. `_validateAndNormalize(content, metadata)` → 规范化的 MemoryRow
2. `_persistToStorage(row)` → SQLite 写入 + 返回 id
3. `_updateKnowledgeGraph(row)` → entity extraction + contradiction detection + relation update
4. `_asyncPostProcess(row)` → LLM judge (fire-and-forget) + embedding generation + HNSW index update

重构后 `store()`: `validate → persist → updateKG → schedule async post-process → return id` (≤ 30 行)

**验证**:

- store() ≤ 30 行
- 四个新方法各 ≤ 30 行
- `pnpm -F @cabinet/memory test` 通过

**预计**: 1 天

---

### D.4 Workflow StateGraph 双路径简化 ✅ **已完成**

**问题**: `engine.ts` 的 `startRun()` 仍先尝试 StateGraph 编译 → 失败回退邻接图遍历。双路径增加维护成本。

**涉及文件**:

- `packages/workflow/src/engine.ts` (300 行)

**实施方案**:

1. 分析 StateGraph 编译失败的具体原因（检查 `compile()` 返回 `!ok` 的场景）
2. 在编译前预检测不支持的结构，直接选择正确路径
3. 目标: `startRun()` 无 try-catch fallback — 单一路径，预检测决定

**实际执行**:

1. 删除 `packages/workflow/src/engine.ts` 中的 `buildStateGraph()` 与 `@cabinet/graph` import。
2. `startRun()` 直接使用 `buildAdjacencyGraph()` + `executeNode()` 单一路径。
3. 新增 `resolveIfElseChildren()`：根据 `ifElse` 节点输出（`Condition evaluated: true/false` / `Matched branch`）结合 `edge.branch` 选择唯一子节点，避免两分支都执行。

**验证**:

- `startRun()` 中无 StateGraph 编译或 try-catch fallback 模式
- 现有 workflow 测试全部通过
- `pnpm -F @cabinet/workflow test` 通过

**预计**: 1 天

---

### D.5 ManagerExecutor 内联 ✅ **已完成**

**问题**: `manager-executor.ts` (233 行) 不公共导出但作为独立文件存在。仅被 `engine.ts` 和 `node-executor.ts` 内部使用。

**涉及文件**:

- `packages/workflow/src/manager-executor.ts` (233 行)
- `packages/workflow/src/engine.ts`
- `packages/workflow/src/node-executor.ts`

**实施方案**:

1. 将 `ManagerExecutor` 的核心逻辑内联到 `engine.ts`（作为私有方法）
2. 共享的 ManagerContext 类型已在 `manager-context.ts` (169 行) 中
3. 删除独立 `manager-executor.ts`

**验证**:

- `grep -r "ManagerExecutor" packages/` 仅 engine.ts 内部引用
- `pnpm -F @cabinet/workflow test` 通过

**预计**: 1 天

---

### D.6 WriteGate Embedding 慢通道成本/收益分析 ✅

**问题**: WriteGate 的 embedding 慢通道默认关闭，无数据支持激活决策。

**涉及文件**:

- `packages/memory/src/write-gate.ts`
- `packages/memory/src/consolidation.ts`

**实施方案**:

1. 在 ConsolidationService 中添加慢通道采样:
   - 每天随机采样 20 条 `transient_noise` 分类条目
   - 通过 embedding 慢通道重新分类
   - 记录 fast vs slow 分类差异率
2. 运行 1 周收集数据后分析:
   - slow path 的召回提升（fast=noise 但 slow=valuable 的比例）
   - embedding API 调用成本估算
   - 决策: 默认激活 / 保持 opt-in / 按 tier 选择性激活
3. 实现决策建议的配置变更

**验证**:

- WriteGateStats 完整记录 fast/slow 分类差异
- 采样分析结论可重现
- `pnpm -F @cabinet/memory test` 通过

**预计**: 1 天

---

### D.7 Dashboard 历史趋势 ✅

**问题**: Dashboard 当前无历史趋势聚合。

**涉及文件**:

- `apps/server/src/routes/dashboard.ts`
- `packages/ui/src/dashboard-summary.tsx`

**实施方案**:

1. 新增 `GET /dashboard/trends?days=7|30` endpoint:
   - 聚合每日: session 数、token 消耗、成本、工具调用成功率、错误数
   - 7 天移动平均
2. 前端新增 `TrendChart` 组件（复用 dashboard-summary.tsx 样式）
3. 利用已有数据: `cost_history` 表 + `step_events` 表 + `ObservabilityCollector`

**验证**:

- trends endpoint 返回正确的聚合数据
- 前端趋势图渲染正常
- `pnpm build` + `pnpm typecheck` 通过

**预计**: 1-2 天

---

### D.8 ToolPruner 指标驱动自适应调参 ✅

**问题**: Phase 6.1 添加了 `PrunerMetrics` 追踪，但剪枝参数 (targetSize, LLM refinement 触发阈值) 仍是静态的。

**涉及文件**:

- `packages/agent/src/tool-pruner.ts`

**实施方案**:

1. 从 `PrunerMetrics` 计算:
   - 平均剪枝后工具数 vs maxTools 的偏离
   - LLM refinement 的边际贡献（与纯 embedding 的差异）
   - 缓存命中率趋势
2. 基于指标自动调整:
   - 平均工具数持续 < maxTools/2: 增加 targetSize
   - LLM refinement 贡献 < 5%: 提高触发阈值，减少不必要的 LLM 调用
   - 缓存命中率 < 50%: 延长 cache TTL
3. 调整幅度受 `maxAdjustmentRate` 约束（防止剧烈波动）
4. 新增 `ToolPruner.autoTune(): PrunerAdjustment[]` 方法

**验证**:

- autoTune() 返回合理的调整建议
- 调整幅度不超过 maxAdjustmentRate
- `pnpm -F @cabinet/agent test` 通过

**预计**: 1 天

---

## 6. 汇总: 工作量、依赖与里程碑

### 6.1 总工时估算

| 轨道              | 任务数 | 预计工时     | 当前执行状态                                                                                                                                      |
| ----------------- | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A: 安全边界**   | 3      | 5-6 天       | A.1 ✅ (MCP T0-T3 已集成), A.2 ✅ (L0 已修复), A.3 ❌ (ContextSlot/Blackboard 统一未完成)                                                         |
| **B: 代码质量**   | 4      | 10-12 天     | 服务端文件拆分基本完成（context.ts、capabilities.ts、workflows.ts、tool-dependencies.ts、agent-daemon.ts 均已 ≤20 行）。剩余 desktop 前端文件超行 |
| **C: 自适应激活** | 5      | 5-6 天       | C.2 ✅ (SelfConsistencyObserver), C.3 ✅ (SubconsciousInsightObserver via EventBus), C.1/C.4/C.5 待验证                                           |
| **D: 架构整合**   | 8      | 6-7 天       | D.1 ✅, D.4 ✅, D.5 ✅ 已完成。D.2/D.3/D.6/D.7/D.8 需验证                                                                                         |
| **总计**          | **20** | **26-31 天** | 约 40-50% 已完成                                                                                                                                  |

### 6.2 轨道间依赖

```
轨道 A ──── 无依赖 ──── 可立即启动
轨道 B ──── 无依赖 ──── 可立即启动
轨道 C ──── 依赖 B.1 ── B.1 创建的 observer-factory.ts 是 C.1 的前提
轨道 D ──── 无依赖 ──── 可立即启动 (D.3 可与 B.4 的 long-term.ts 拆分合并执行)
```

**唯一跨轨道依赖**: B.1 → C.1（observer-factory.ts）。其余任务全部独立。

### 6.3 里程碑

| 里程碑                     | 完成标准                                    | 状态                            |
| -------------------------- | ------------------------------------------- | ------------------------------- |
| **M1: 安全边界闭环**       | A.1-A.3 完成                                | ⚠️ 部分完成（A.3 未完成）       |
| **M2: 核心模块拆分**       | B.1-B.2 完成, agent-loop.ts ≤ 500 行        | ✅ 基本完成                     |
| **M3: 自适应激活**         | C.1-C.5 完成, ≥5 个自适应 Observer 默认激活 | ⚠️ C.2/C.3 完成，其余待验证     |
| **M4: 全栈模块化**         | B.3-B.4 完成                                | ✅ 服务端完成                   |
| **M5: 架构 Consolidation** | D.1-D.8 完成                                | ⚠️ D.1/D.4/D.5 完成，其余待验证 |
| **M6: 最终验证**           | 全轨道回归                                  | ⏳                              |

### 6.4 评分提升预期

| 维度         | 当前        | 目标        | Δ        | 提升来源                                                                |
| ------------ | ----------- | ----------- | -------- | ----------------------------------------------------------------------- |
| 架构设计     | A           | A+          | +1       | D.1 (@cabinet/graph 删除), D.2 (管道统一)                               |
| 代码质量     | A-          | A           | +1       | B.1-B.4 (20+ 文件拆分至 ≤500 行)                                        |
| 过程连续性   | A-          | A           | +1       | C.1 (Observer 激活), C.3 (SubconsciousLoop 集成)                        |
| 记忆系统     | A           | A           | 0        | D.2-D.3 (管道统一 + store 拆分), D.6 (WriteGate 分析)                   |
| Variety 管理 | A-          | A           | +1       | D.8 (ToolPruner 自适应), C.5 (AdaptiveContextMonitor)                   |
| 安全边界     | A-          | A           | +1       | A.1 (MCP T0-T3), A.2 (L0 修复)                                          |
| 可观测性     | A-          | A           | +1       | D.7 (Dashboard 趋势), C.1 (Observer log_only 激活)                      |
| 生态开放性   | B+          | A-          | +1       | A.3 (ContextSlot/Blackboard 统一接口)                                   |
| 系统体重     | B+          | A-          | +1       | B (20+ 文件拆分), D.1 (@cabinet/graph 删除), D.5 (ManagerExecutor 合并) |
| 技能系统     | A-          | A           | +1       | C.4 (按需加载消除 token 浪费)                                           |
| **综合**     | **A- (89)** | **A (93+)** | **+4-5** |                                                                         |

### 6.5 风险与缓解

| 风险                                 | 概率 | 缓解措施                                                              |
| ------------------------------------ | ---- | --------------------------------------------------------------------- |
| B.1 agent-loop 拆分导致回归          | 中   | 现有 ~640 行 characterization 测试作为安全网；每个提取步骤独立 commit |
| A.1 MCP T0-T3 集成破坏现有 MCP 功能  | 中   | 先在 T3 (FullAutonomy) 部署 — 行为不变；逐级收紧至 T1/T0              |
| C.1 Observer 激活增加延迟/token 消耗 | 低   | log_only 模式不调用 LLM；inject 模式控制 token 预算 (≤500)            |
| 多轨道并行导致合并冲突               | 中   | 各轨道操作不同文件集；B.1+C.1 通过 observer-factory.ts 协调           |
| D.1 @cabinet/graph 删除破坏 workflow | 低   | 先完成消费者审计，逐文件迁移，每次迁移后验证                          |
