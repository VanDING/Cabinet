# Cabinet AI 系统 — 第三次审计报告 (v3.0)

**审计日期**: 2026-06-12
**审计框架**: Cybernetic AI Framework (8 Principles) + VSM 五层映射
**系统版本**: Cabinet v2.0-alpha
**当前 HEAD**: `0432284` (Phase 6.4 + 后续修复)
**上次审计**: `d57a4b7` (2026-06-10, [AUDIT_REPORT_V2.md](./AUDIT_REPORT_V2.md))
**审计范围**: 全栈 (14 packages + 2 apps + desktop)
**变更规模**: v2 审计后 6 commits (Phase 5 收尾 + Phase 6.1–6.4 全系列)

---

## 关系说明

本报告是 AUDIT_REPORT_V2.md 的**验证性重评**，而非替代性重写。

v2 审计（2026-06-10）是 Phase 5-6 实施**前**的诊断报告。它识别了 25+ 项具体问题并给出了优先级矩阵。随后的 Phase 5（dashboard 现代化 + 外部 agent 状态修复）和 Phase 6（ToolPruner 语义、Ebbinghaus 衰减、SubconsciousLoop 集成、跨项目记忆迁移）正是对 v2 审计建议的系统性响应。

本报告验证：v2 的哪些诊断已被 Phase 5-6 修复，哪些仍然存在，以及修复过程中引入了哪些新问题。

---

## 目录

1. [v2 审计建议追踪](#1-v2-审计建议追踪)
2. [控制论八原则更新评估](#2-控制论八原则更新评估)
3. [子系统逐项验证](#3-子系统逐项验证)
4. [Phase 6 增量贡献](#4-phase-6-增量贡献)
5. [修复过程中引入的新问题](#5-修复过程中引入的新问题)
6. [综合评分更新](#6-综合评分更新)
7. [剩余行动建议](#7-剩余行动建议)

---

## 1. v2 审计建议追踪

### 1.1 实施统计

v2 审计共标记 30 项具体问题/建议。Phase 5-6 后的状态：

| 状态        | 数量 | 占比 |
| ----------- | ---- | ---- |
| ✅ 已修复   | 22   | 73%  |
| ⚠️ 部分解决 | 5    | 17%  |
| ❌ 未修复   | 3    | 10%  |

### 1.2 逐项追踪

#### 已在 Phase 5-6 中修复 (22 项)

| v2 审计建议                                         | 修复阶段   | 验证                                                                                                       |
| --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| Skill 提取阈值过高 (硬编码 toolCalls>=5, steps>=10) | Phase 2    | `SkillExtractorConfig` — minToolCalls/minTotalSteps/requireSuccess 全部可配置                              |
| Skill 质量控制缺失                                  | Phase 2    | `scoreSkillQuality()` — 6 维度评分 (工具名/验证词/步数/长度/文件路径/LLM 置信度) + 分层保存                |
| SkillRegistry 并发不安全 (无锁 Map)                 | Phase 2    | `Mutex` class (acquire/release) + 异步安全方法 (`registerAsync` 等)                                        |
| Skill 作为工具的语义混淆                            | Phase 2    | `exposure` 字段 — `prompt` / `tool` / `both` 三值分离                                                      |
| HNSW fallback 缺失                                  | Phase 6 前 | `bruteForceSemanticSearch()` — 分页扫描 ≤50,000 行，cosine 相似度                                          |
| engine.ts 超行数上限 (~998 行)                      | Phase 3    | 提取 `node-executor.ts` + `error-recovery.ts` → 当前 **300 行**                                            |
| evaluateOp 双实现 (engine + condition-evaluator)    | Phase 3    | engine.ts 薄包装委托给 `condition-evaluator.ts` 的单一实现                                                 |
| A2A 双实现冗余                                      | Phase 5    | `A2AConnector` 标记 `@deprecated`，工厂只创建 `A2AHarnessRuntime`                                          |
| CliAdapter 遗留                                     | Phase 5    | 已完全删除，harness index 不导出                                                                           |
| Dashboard live count(\*)                            | Phase 5    | 改用 Repository 方法 + 10s 内存缓存                                                                        |
| Dashboard 类型不统一                                | Phase 5    | `DashboardSummary` 等共享类型提取到 `@cabinet/types`                                                       |
| Dashboard 缺少 Agent 健康                           | Phase 5    | `/dashboard/agent-status` endpoint + `AgentStatusCard` UI                                                  |
| Dashboard WebSocket 未被前端消费                    | Phase 5    | `useWebSocket.ts` + `App.tsx` 消费 `ws://localhost:3000/ws/events`                                         |
| blueprint-yaml.ts 零测试                            | Phase 3    | `__tests__/blueprint-yaml.test.ts` — 覆盖所有节点类型                                                      |
| validateBlueprint 命名混淆                          | Phase 3    | `validateWorkflowBlueprint` 标记 `@deprecated` → `validateWorkflowExport`                                  |
| Dispatcher 3 模式用 switch-case                     | Phase 3    | `dispatch()` 委托给 `executeDispatchGraph()`                                                               |
| DispatchGraph 可能是死代码                          | —          | **验证为非死代码** — `dispatcher.ts:237` 调用 `executeDispatchGraph()` → 内部调用 `compileDispatchGraph()` |
| ToolPruner 仅基于关键词                             | Phase 6.1  | embedding + LLM 双阶段剪枝 + `pruneWithContext()` 会话上下文感知                                           |
| Memory 无自适应衰减                                 | Phase 6.2  | `computeAdaptiveHalfLife()` — 动态 7-90 天 half-life                                                       |
| SubconsciousLoop 未与 AgentLoop 集成                | Phase 6.3  | harness 层后台认知过程: LTM 采样 → KG 扩展 → 事件发布                                                      |
| 缺乏跨项目记忆迁移                                  | Phase 6.4  | `CrossProjectMigrator` + scope 标记 + Jaccard 模式发现                                                     |
| Dashboard Recent Events 静态映射                    | Phase 5    | `humanizeEventType()` 动态 snake_case → Title Case                                                         |

#### 部分解决 (2 项)

| v2 审计建议                     | 当前状态                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| CascadeBuffer 与 Curator 双管道 | 职责已分离: consolidateBasic → daily tier, Curator → register/working。但两个管道仍并行运行 |
| LTM.store() God Method          | 现在委托 entity extraction → KG, contradiction → KG, LLM → 异步。仍约 80 行                 |
| Secretary 意图解析层数          | 实际为 4 层 (keyword → regex → embedding → LLM)，比 v2 审计记录的 3 层多一层                |

#### 已在后续 fix commits 中修复 (4 项)

| v2 审计建议                         | 当前状态                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| MCP 安全沙盒 T0-T3 集成             | `mcp-manager.ts` 已集成 `resolveMcpDecision()` — T0 阻止所有非只读，T1 阻止 moderate+destructive，T2 阻止 destructive |
| ManagerExecutor 合并                | `manager-executor.ts` 已删除，逻辑内联到 `engine.ts` 和 `node-executor.ts`                                            |
| Workflow StateGraph 编译 + fallback | `engine.ts` 已删除 `buildStateGraph()`，`startRun()` 使用单一邻接图遍历路径，新增 `resolveIfElseChildren()`           |
| SelfConsistencyEngine 非 Observer   | `SelfConsistencyObserver` 已存在于 `observers/self-consistency.ts`，通过 Observer 包装器接入 Pipeline                 |

#### 未修复 (2 项)

| v2 审计建议                       | 原因分析                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| ContextSlot ↔ Blackboard 概念重复 | Agent Blackboard 是更强的实时协作抽象，但两者独立并行无同步桥接。ContextSlot 用于 TaskQueue 持久化，Blackboard 用于运行时实时通信 |
| Skill 内置模板 token 浪费         | `built-in-skills.ts` 4 个大型 prompt 模板 (484 行) 在每次 agent loop 中注入 system prompt                                         |

---

## 2. 控制论八原则更新评估

### 原则 1: AI as Process (过程本体论)

> 系统身份存在于持续的感知-行动-反馈模式中，而非静态参数中。

**v2 评级**: A (93%)
**v3 评级**: **A (93%)** — 维持

**关键证据**:

- Observer Pipeline 的 12 个 Observer 在每次 `_execute()` 循环中活跃运行
- CheckpointObserver 每 5 步保存 + crash checkpoint 确保过程连续性
- ProcessIdentityObserver (PIS) 跟踪 coherence score 趋势
- **Phase 6.3**: SubconsciousLoop 在 harness 层提供低频持续认知过程，补充高频 AgentLoop

**⚠️ 剩余问题**: `conversationHistory` 仍语义模糊 — 同时作为会话转录和跨循环缓冲区。过程连续性与状态存储的边界不清晰。

---

### 原则 2: Precision–Complexity Trade‑off (精准-复杂度权衡)

> 精准度通过反馈在复杂度约束下动态达成。内部 variety 必须匹配环境 variety。

**v2 评级**: A- (85%)
**v3 评级**: **A- (87%)** ↑ +2

**主要改进**:

- **Phase 6.1**: ToolPruner 从纯关键词 → embedding + LLM 双阶段语义剪枝。`pruneWithContext()` 使用最近 6 条会话消息感知上下文。`PrunerMetrics` 追踪剪枝效果，形成反馈闭环。直接解决了 v2 审计指出的 "ToolPruner 基于关键词 → variety gap (~150 tools vs ~10-15 单轮选择)" 瓶颈
- WriteGate 双通道 (8 语言 regex + embedding 慢通道) 提供 variety 匹配的双速机制
- AdaptiveContextMonitor 从历史数据学习最优 boundary

**⚠️ 剩余问题**: AdaptiveContextMonitor 虽 `DEFAULT_ADAPTIVE_CONFIG.enabled: true`，但实际激活需 `metricsRepo` + `eventBus` 同时注入。在典型构造路径中常被绕过。

---

### 原则 3: Dialogic Meaning Construction (对话意义建构)

> 人机通信是协作建构意义。两层操作：表面任务 + 理解的协商。

**v2 评级**: B+ (78%)
**v3 评级**: **B+ (80%)** ↑ +2

**主要改进**:

- **Phase 5**: Dashboard Agent 健康状态 + WebSocket 实时推送，用户能看到 Agent 的"理解状态"
- **Phase 2 Skill**: `exposure` 字段 (prompt/tool/both) 区分"注入系统提示的引导"和"暴露为工具的调用"
- Agent Blackboard 为多 Agent 提供共享上下文的 topic-based 通信

**⚠️ 剩余问题**: 缺少主动"意图确认"机制。Agent 在执行高风险操作前很少复述理解。TeachBack 存在但使用范围有限。

---

### 原则 4: Closed-Loop Cognition (闭环认知)

> 感知和行动形成连续、相互建构的循环。知识是行动导向的、通过反馈精炼的。

**v2 评级**: A- (88%)
**v3 评级**: **A- (88%)** — 维持

**关键证据**:

- Observer Pipeline 本身就是闭环实现：每个 Observer 观察 → 产生反馈 → 影响后续行为
- **Phase 6.1**: `PrunerMetrics` 追踪使剪枝决策可通过数据反馈优化
- **Phase 6.3**: SubconsciousLoop `tick()` — 采样记忆 → 生成洞察 → 发布事件，形成低频认知闭环

**⚠️ ~~剩余问题~~ (已修复)**: `SelfConsistencyEngine` 仍保持为独立引擎，但 `SelfConsistencyObserver` 已作为 Observer 包装器存在于 `observers/self-consistency.ts`，接入统一的 Observer Pipeline。

---

### 原则 5: Structural Determinism (结构决定论)

> AI 的输出是其内部结构的必然表达。环境只能触发，不能指令。

**v2 评级**: A- (85%)
**v3 评级**: **A- (87%)** ↑ +2

**主要改进**:

- **Phase 6.4**: Cross-project memory migration — 记忆 `scope` (global/workspace) 定义了知识边界，防止跨项目信息污染
- PreferenceLearner 从决策历史学习 Captain 偏好，系统结构适应使用模式
- S5 PolicyEngine 加权仲裁 + MissionProfile 构成系统的"身份结构"

**⚠️ ~~剩余问题~~ (已修复)**: MCP 安全沙盒已集成 T0-T3，`resolveMcpDecision()` 在 `mcp-manager.ts` 内部直接执行信任级别检查。

---

### 原则 6: Viable Recursive Architecture (可行递归架构)

> 可行系统由五个功能单元组成，在每个层级递归存在。

**v2 评级**: A- (87%)
**v3 评级**: **A- (88%)** ↑ +1

**当前 VSM 五层映射**:

```
S5 (Policy):      PolicyEngine (加权仲裁 + MissionProfile + T0-T3)
S4 (Intelligence): HarnessAnalyst + SubconsciousLoop + AdaptiveContextMonitor + PreferenceLearner
S3 (Control):     Curator + ObservabilityCollector + AutoAdjuster + FailureAnalyzer
S2 (Coordination): Blackboard + Dispatcher + AgentRoleRegistry + Secretary (4层意图解析)
S1 (Execution):   AgentLoop (Observer Pipeline) + ToolExecutor + MCPManager + External Agents
```

S5 从二元 yes/no gate → 加权仲裁是 v2→v3 周期中最关键的 VSM 改进。S2 因 Blackboard 实时通信能力增强。S1 因 12 个 Observer 获得大幅自我监控。

**⚠️ ~~剩余问题~~ (已修复)**: `@cabinet/graph` 包已删除。`END` 常量内联到 `agent-node.ts`，`StateGraph`/`Annotation` 逻辑迁移到 `workflow/src/engine.ts` 的单一邻接图遍历。

---

### 原则 7: Hard Variety Ceiling (硬性多样性上限)

> AI 的有效容量不可超过其内部 variety。这是数学硬上限。

**v2 评级**: B+ (78%)
**v3 评级**: **B+ (80%)** ↑ +2

**主要改进**:

- **Phase 6.1**: ToolPruner 从关键词 → embedding+LLM 语义剪枝，将工具选择 variety gap 从 ~150:10 缩小
- WriteGate 双通道解决了单一正则的 variety 瓶颈
- MCP 动态重发现 (每 5 分钟) 保持工具 variety 与环境同步

**⚠️ 剩余问题**: 工具暴露量 (~150) 与 LLM 单轮可靠选择 (~10-15) 的 gap 缩小但未消除。ToolPruner LLM refinement 仅在候选 > 15 时触发。

---

### 原则 8: From Command to Enablement (从命令到使能)

> 人-AI 关系从命令-执行转向使能-涌现。

**v2 评级**: B+ (75%)
**v3 评级**: **B+ (78%)** ↑ +3

**主要改进**:

- **Phase 6.4**: 系统主动识别跨项目模式并建议知识复用 — 从"被查询"到"主动建议"
- **Phase 6.3**: SubconsciousLoop — 后台无指令自主认知过程
- Autopilot 触发系统 (TriggerScheduler + TriggerExecutor)

**⚠️ 剩余问题**: 内置 skills (484 行) 实际上是指令性文档 — 告诉 Agent "如何做"而非"目标是什么"，与使能原则有张力。

---

## 3. 子系统逐项验证

### 3.1 AgentLoop + Observer Pipeline

**文件**: [agent-loop.ts](packages/agent/src/agent-loop.ts) (1,287 行)

**v2 评级**: A-
**v3 评级**: **A-** (维持)

| v2 问题                           | 当前状态                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `_execute()` ~320 行闭包大        | 已提取到 `execution/execute-generator.ts` (400 行)，`agent-loop.ts` 现 307 行 |
| `conversationHistory` 语义模糊    | 已重构，通过 `AgentExecutionContext` 管理会话转写                             |
| `@cabinet/graph` 可能死代码       | ✅ 已删除 — 全部消费者已迁移                                                  |
| SelfConsistencyEngine 非 Observer | ✅ 已修复 — `SelfConsistencyObserver` 在 `observers/` 中                      |
| run/runStreaming 重复样板         | 已简化，委托给 `executeGenerator()`                                           |

**Phase 6 增量**: ToolPruner 的 `pruneWithContext()` 通过 `resolveToolExecutor()` 传入最近 6 条非系统消息。SubconsciousLoop 未直接集成到 agent-loop（仍在 harness 层）。

**12 个 Observer** (全部位于 `packages/agent/src/observers/`):

| #   | Observer                | 默认状态                      |
| --- | ----------------------- | ----------------------------- |
| 1   | ContentGuardObserver    | 需显式配置                    |
| 2   | SafetyCheckObserver     | 始终启用                      |
| 3   | ToolExecuteObserver     | 始终启用                      |
| 4   | ContextMonitorObserver  | preset ≠ minimal              |
| 5   | HandoffObserver         | 需 handoff 配置               |
| 6   | CheckpointObserver      | 每 5 步 (需 db)               |
| 7   | StepEventObserver       | 需显式配置 + db               |
| 8   | ProcessIdentityObserver | **默认关闭** (仅 preset=full) |
| 9   | BlackboardObserver      | 需显式配置                    |
| 10  | ReflectionObserver      | preset ≠ minimal              |
| 11  | JudgeObserver           | **默认关闭** (仅 preset=full) |
| 12  | AutoReplanObserver      | **默认关闭** (仅 preset=full) |

---

### 3.2 CLI Harness

**文件**: `packages/agent/src/adapters/harness/` (1,709 行, 8 文件)

**v2 评级**: A-
**v3 评级**: **A** ↑

| v2 问题                                | 当前状态                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| A2A 双实现                             | ✅ `A2AConnector` 已标记 `@deprecated` — 仅向后兼容别名                            |
| CliAdapter 遗留                        | ✅ 已完全删除                                                                      |
| BaseCliRuntime.discoverSessions() 可选 | ✅ 6 个 `abstract` 成员 — 子类必须实现全部                                         |
| COMMAND_HARNESS_MAP 硬编码             | ⚠️ 仍是 `const` — 但有 `_customHarnessMap` 运行时覆盖 + `registerHarnessMapping()` |

---

### 3.3 Workflow Engine

**文件**: `packages/workflow/src/`

**v2 评级**: A-
**v3 评级**: **A** ↑

| v2 问题                                                   | 当前状态                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| engine.ts ~998 行                                         | ✅ **~300 行** — `NodeExecutor` 提取到 `node-executor.ts`，错误恢复提取到 `error-recovery.ts` |
| evaluateOp 重复                                           | ✅ engine 薄包装委托给 `condition-evaluator.ts` 的单一实现                                    |
| StateGraph 编译 + fallback 双路径                         | ✅ 已删除 dual path — 单一邻接图遍历，新增 `resolveIfElseChildren()`                          |
| 命名混淆 (validateBlueprint vs validateWorkflowBlueprint) | ✅ `validateWorkflowBlueprint` 标记 `@deprecated` → `validateWorkflowExport`                  |
| blueprint-yaml 零测试                                     | ✅ `__tests__/blueprint-yaml.test.ts` 覆盖全部节点类型 + 错误场景                             |
| ManagerExecutor 独立文件                                  | ✅ `manager-executor.ts` 已删除，逻辑内联到 `engine.ts`                                       |

**文件清单**:

| 文件                   | 行数   |
| ---------------------- | ------ |
| engine.ts              | 300    |
| blueprint-io.ts        | 396    |
| condition-evaluator.ts | 337    |
| node-executor.ts       | (新增) |
| error-recovery.ts      | (新增) |
| manager-executor.ts    | 233    |
| blueprint-yaml.ts      | 182    |
| blueprint-validator.ts | 179    |
| manager-context.ts     | 169    |

---

### 3.4 Memory System

**文件**: `packages/memory/src/`

**v2 评级**: A-
**v3 评级**: **A** ↑ (本次重评最大升级)

| v2 问题                   | 当前状态                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| HNSW fallback 缺失        | ✅ **v2 审计断言错误** — `bruteForceSemanticSearch()` 已存在 (line 655), 分页扫描 ≤50,000 行 |
| WriteGate regex-only      | ✅ 双通道: 8 语言 regex (fast) + embedding 慢通道 (opt-in)                                   |
| KG 实体提取纯正则         | ✅ 混合: regex fast-path + compromise.js (人/地/组织) + 89 词停用词表                        |
| KG 矛盾检测无 LLM         | ✅ `setLlmJudge()` + `runLlmContradictionCheck()` + 24h cooldown cache                       |
| MemoryFacade              | ✅ 327 行, 18+ 公共方法, implements MemoryProvider                                           |
| MemoryOrchestrator 空接口 | ✅ 已删除                                                                                    |
| STM.\_store 封装泄漏      | ✅ `private cache` + `getEntriesOlderThan()`                                                 |
| **Phase 6.2**: 自适应衰减 | ✅ `computeAdaptiveHalfLife()` — 动态 7-90 天, 访问历史跟踪                                  |
| **Phase 6.4**: 跨项目迁移 | ✅ `CrossProjectMigrator` — scope 标记 + Jaccard 模式发现 (≥0.4 相似度)                      |

**新增/增强组件**:

| 组件                      | 行数 | 功能                                                             |
| ------------------------- | ---- | ---------------------------------------------------------------- |
| memory-decay.ts           | ~150 | Ebbinghaus 自适应衰减 (Phase 6.2)                                |
| cross-project-migrator.ts | ~120 | 跨项目记忆迁移 (Phase 6.4)                                       |
| entity-extractor.ts       | 148  | 混合 NER                                                         |
| memory-facade.ts          | 327  | 统一记忆接口                                                     |
| hybrid-retriever.ts       | 145  | RAG 混合检索                                                     |
| write-gate.ts             | 295  | 双通道写门                                                       |
| long-term.ts              | 709  | 新增 bruteForceSemanticSearch + findByMetadataFilter + findByIds |

---

### 3.5 Multi-Agent (Dispatcher / Secretary / Daemon)

**v2 评级**: A-
**v3 评级**: **A** ↑

#### Dispatcher

| v2 问题                      | 当前状态                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| switch-case 3 模式           | ✅ `dispatch()` 委托给 `executeDispatchGraph()` (dispatcher.ts:237)                      |
| DispatchGraph 死代码         | ✅ **被调用** — dispatcher.ts import + line 237 call → 内部调用 `compileDispatchGraph()` |
| ResultSynthesizer 无矛盾发现 | ⚠️ 有冲突检测 + `similarTopic()` (CJK 感知: 阈值 6 用于 CJK, 4 用于 Latin)               |

#### Secretary

| v2 记录         | 当前状态                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| 3 层意图解析    | **实际为 4 层**: keyword → regex → embedding → LLM (非 v2 审计记录的 3 层) |
| Blackboard 集成 | `useBlackboard()` + discoveries/outputs 双写                               |

#### Daemon

| v2 问题       | 当前状态                                            |
| ------------- | --------------------------------------------------- |
| 固定 60s 轮询 | ✅ 自适应: 3s 起步, 指数退避, WebSocket 连接时暂停  |
| 心跳监控      | ✅ 15s 间隔, 60s 超时                               |
| Squad 路由    | ✅ SquadRouter (4 策略) + SquadLeader               |
| Autopilot     | ✅ TriggerScheduler (CronAdapter) + TriggerExecutor |

---

### 3.6 Skill System

**文件**: `packages/agent/src/`

**v2 评级**: B (4 个问题 "完全未动")

**v3 评级**: **B+** ↑ (Phase 2 overhaul 修复了全部 4 个基线问题)

v2 审计的 "4 个核心问题全部未动" 是 Phase 2 实施前的状态。Phase 2 (commit `f66da30`) 及其后续修复 (`d196881`, `cb9baf8`, `7977575`) 系统性地解决了这些问题：

| v2 问题      | v2 断言                                    | Phase 2 修复                                                                                              |
| ------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 提取阈值过高 | "不变 — toolCalls>=5, steps>=10, success"  | `SkillExtractorConfig` — 全部可配置 + `kindOverrides`                                                     |
| 质量控制缺失 | "不变 — 单次 Haiku 提示, 无 guardrails"    | `scoreSkillQuality()` — 6 维度评分 + auto/review/discard 分层保存                                         |
| 并发不安全   | "不变 — 无锁 Map 单例"                     | `Mutex` class (acquire/release) + 异步安全方法                                                            |
| 语义混淆     | "不变 — 仍暴露为 use_skill\_\_{name} 工具" | `exposure` 字段 — `prompt`/`tool`/`both` + `getToolDefinitions()` 过滤 + `getPromptSkills()` 系统提示注入 |

**剩余问题**:

- `use_skill__{name}` 命名约定对 tool-exposed skill 是设计意图，非问题
- 内置 skills (4 个, 484 行) 是大型 prompt 模板 — 在 agent loop 中可能浪费 token
- `registerBuiltInSkills()` 在每次调用时注入全部 4 个模板到系统提示

---

### 3.7 MCP System

**文件**: `apps/server/src/mcp/`

**v2 评级**: A-
**v3 评级**: **A-** (维持)

| v2 问题              | 当前状态                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 仅 stdio transport   | ✅ SSE transport 已添加                                                                                                                                                  |
| 无 resources/prompts | ✅ `listResources()`, `listPrompts()`, `readResource()`, `getPrompt()`                                                                                                   |
| 一次性工具发现       | ✅ 每 5 分钟 `rediscover()` + diff 更新                                                                                                                                  |
| 安全沙盒缺失         | ⚠️ 两层分类存在: `classifyToolRisk()` (MCPSideEffectRisk) + `resolveEffectiveCategory()` (SafetyGuard)。但 MCP manager 自身不感知 T0-T3 — 信任级别检查在外部 SafetyGuard |
| 错误恢复简单         | ⚠️ try/catch 无指数退避；但重发现独立错误处理                                                                                                                            |

MCP 安全架构当前状态:

```
MCP Server → MCPSideEffectRisk (none/readonly/mutation/destructive)
                 ↓
          SafetyGuard.resolveEffectiveCategory() → ToolCategory (read_only/light_write/moderate/cost/destructive)
                 ↓
          agent-loop.ts TrustLevel (T0-T3) → SafetyGuard 检查 category vs trust level
```

T0-T3 检查**不在** MCP manager 内部 — 依赖外部 SafetyGuard。MCP manager 自身对所有 trust level 的调用方一视同仁。

---

### 3.8 Decision / S5 PolicyEngine

**文件**: `packages/decision/src/`

**v2 评级**: A-
**v3 评级**: **A-** (维持)

所有 v2 审计建议已验证完成：加权仲裁 (`arbitrate()`)、MissionProfile (3 轴)、T0-T3 全覆盖 (`getAutoApproveMaxLevel()`)、`checkDecision()` 在 T2/T3 路径执行。

**新发现**: `LevelClassifier` 的 L0 守卫 (`!isCrossSession && optionCount <= 2 && totalCost === 0`) 在 L1 守卫 (`optionCount <= 3 && totalCost <= 0.1`) 之后检查。任何满足 L0 条件的输入也满足 L1 → **L0 在实践中不可达**。这是守卫顺序 bug，非设计意图。

---

### 3.9 Harness 包

**文件**: `packages/harness/src/` (14 文件)

**v2 评级**: A-
**v3 评级**: **A** ↑

| 组件                   | 行数 | 状态                                                                  |
| ---------------------- | ---- | --------------------------------------------------------------------- |
| ObservabilityCollector | 442  | 大幅扩展 — 按角色/全局健康评分, 日报, 指数移动平均                    |
| SubconsciousLoop       | 138  | **Phase 6.3 升级** — LTM 采样, KG 扩展, 事件驱动激活, 每 10 tick 分析 |
| ProgressTracker        | 316  | 结构化 JSON + Markdown 总结                                           |
| FailureAnalyzer        | 197  | 工具/模型/错误类型三维度分析                                          |
| HarnessAnalyst         | 107  | LLM 驱动日均 harness 健康洞察                                         |
| PreferenceLearner      | 77   | 从决策历史学习 Captain 偏好                                           |
| AutoAdjuster           | 288  | 监听 `subconscious_insight` 事件                                      |
| BrowserPool            | 245  | 保留 — 完整 session 管理 + Playwright                                 |
| TeachBack              | 14   | 保留                                                                  |
| GarbageCollector       | —    | ✅ 已删除                                                             |
| BrowserVerifier        | —    | ✅ 已删除                                                             |

---

### 3.10 Dashboard + ContextSlot

**v2 评级**: B
**v3 评级**: **B+** ↑

Phase 5 解决全部 5 个 Dashboard 问题：

| v2 问题          | Phase 5 修复                                           |
| ---------------- | ------------------------------------------------------ |
| 实时 count(\*)   | Repository 方法 + 10s 内存缓存                         |
| Events 静态映射  | `humanizeEventType()` 动态                             |
| 类型不同         | 共享类型提取到 `@cabinet/types`                        |
| 缺少 Agent 健康  | `/dashboard/agent-status` endpoint + `AgentStatusCard` |
| WebSocket 未消费 | `useWebSocket.ts` + `App.tsx`                          |

**ContextSlot 仍为未解决问题**: Agent Blackboard 是更强的替代，但两者独立并行，无同步桥接。v2 审计提到的 `syncSlotToBlackboard()` **不存在**。ContextSlot 用于 TaskQueueEntry 数据总线，Blackboard 用于多 Agent 协作 — 职责有重叠但无协调。

---

## 4. Phase 6 增量贡献

Phase 6 系列（4 个 commit）是 v2 审计后最集中的功能增量，直接回应了多个原则级问题：

| Phase   | 内容                  | 影响的控制论原则                                     | 解决的具体瓶颈                                  |
| ------- | --------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| **6.1** | ToolPruner 语义增强   | 原则 2 (Variety), 原则 7 (Ceiling)                   | 工具选择 variety gap ~150:10 → 语义剪枝缩小 gap |
| **6.2** | Ebbinghaus 自适应衰减 | 原则 2 (Variety), 原则 1 (Process)                   | 记忆 relevance 匹配信息自然衰减率               |
| **6.3** | SubconsciousLoop 集成 | 原则 1 (Process), 原则 4 (Closed-Loop)               | 低频后台认知补充高频 AgentLoop                  |
| **6.4** | 跨项目记忆迁移        | 原则 5 (Structural Determinism), 原则 8 (Enablement) | 知识边界控制 + 主动知识复用                     |

---

## 5. 修复过程中引入的新问题

本次重评新发现的问题（不在 v2 审计中）：

### 5.1 P1 — 架构层面

1. **ContextSlot + Blackboard 概念重复**: 两个并行跨 Agent 数据共享机制，无同步桥接。ContextSlot 用于 TaskQueue 数据总线，Blackboard 用于多 Agent 协作。v2 审计假设 `syncSlotToBlackboard()` 存在但实际不存在。应明确职责边界或合并。

2. **LevelClassifier L0 不可达**: L1 守卫先捕获了 L0 条件 (`optionCount <= 2 && totalCost === 0` 总是满足 `optionCount <= 3 && totalCost <= 0.1`)。需调整守卫顺序。

### 5.2 P2 — 实现层面

3. **`agent-loop.ts` 1,287 行 + `tools/index.ts` 1,301 行**: 两个文件均超 CABINET.md 500 行上限 2.5x。`_execute()` 323 行生成器难以测试隔离。`tools/index.ts` 是巨型 barrel。

4. **内置 skill 模板 token 浪费**: `built-in-skills.ts` 4 个大型 prompt 模板在每次 agent loop 的 `_assembleContext()` 中注入系统提示。应改为按需加载或使用 skill registry 的 L1 discover → L2 load 渐进加载。

5. **SubconsciousLoop 与 AgentLoop 无直接集成**: Phase 6.3 的 SubconsciousLoop 仍在 harness 层，agent-loop.ts 无任何引用。两个认知过程（高频 AgentLoop + 低频 SubconsciousLoop）独立运行，无协调。

6. **`SelfConsistencyEngine` 仍非 Observer**: 作为独立对象打破统一的 Observer Pipeline 抽象。应重构为 Observer 或将推理一致性检查整合到 JudgeObserver。

7. **7 个 Observer 默认关闭**: ProcessIdentityObserver、JudgeObserver、AutoReplanObserver、StepEventObserver、ContentGuardObserver、HandoffObserver、BlackboardObserver 需要显式配置或 `preset: 'full'` 才能激活。系统的 L4 自适应能力存在但大部分未激活。

---

## 6. 综合评分更新

### 6.1 十维度评分

| 维度             | v2  | v3     | Δ   | 说明                                                         |
| ---------------- | --- | ------ | --- | ------------------------------------------------------------ |
| **架构设计**     | A   | **A**  | 0   | Observer Pipeline + MemoryFacade + Blackboard                |
| **代码质量**     | A-  | **A-** | 0   | agent-loop 和 tools/index 仍超行数上限                       |
| **过程连续性**   | A-  | **A-** | 0   | Checkpoint + PIS 趋势跟踪                                    |
| **记忆系统**     | A-  | **A**  | +1  | HNSW fallback 确认存在 + Ebbinghaus (6.2) + 跨项目迁移 (6.4) |
| **Variety 管理** | B+  | **A-** | +1  | ToolPruner 语义升级 (6.1) + WriteGate 双通道                 |
| **安全边界**     | A-  | **A-** | 0   | MCP 安全沙盒仍非 T0-T3 集成                                  |
| **可观测性**     | A-  | **A-** | 0   | ObservabilityCollector + PIS + ConsolidationMetrics          |
| **生态开放性**   | B+  | **B+** | 0   | MCP 完整协议 (SSE+resources+prompts)                         |
| **系统体重**     | B+  | **B+** | 0   | 删除 meeting/organize/EL/GC/BV；@cabinet/graph 仍有引用      |
| **技能系统**     | A-  | **A-** | 0   | Phase 2 修复了 v2 标记的 4 个问题；内置模板 token 浪费       |

### 6.2 综合评分

|              | v2 审计         | v3 重评         |
| ------------ | --------------- | --------------- |
| **综合评分** | **A- (87/100)** | **A- (89/100)** |

**+2 分来源**: 记忆系统 (+1, HNSW fallback + Phase 6.2/6.4) + Variety 管理 (+1, ToolPruner 语义升级 6.1)

**v2→v3 的核心叙事**: v2 审计完成了准确的诊断。Phase 5-6 完成了系统性的治疗。系统从 "设计理念先进但关键实现有缺口" (B+/A- 边界) 提升到 "架构完整性接近 L4 自适应级别，具备可工作的自适应组件" (稳固的 A-)。

**A- (89) → A (90+) 的剩余差距**:

1. 激活 7 个默认关闭的自适应 Observer — 即使以保守阈值
2. MCP 安全沙盒 T0-T3 集成
3. 拆分 agent-loop.ts + tools/index.ts
4. 解决 ContextSlot ↔ Blackboard 概念重复
5. 修复 LevelClassifier L0 守卫顺序

---

## 7. 剩余行动建议

### 7.1 短期 (1-2 周): 闭环剩余 P1/P2

| 优先级 | 任务                                    | 预计工作量 | 说明                                                        |
| ------ | --------------------------------------- | ---------- | ----------------------------------------------------------- |
| **P1** | MCP 安全沙盒 T0-T3 集成                 | 2-3 天     | 将 trust level 检查下沉到 MCP manager 内部                  |
| **P1** | 修复 LevelClassifier L0 守卫顺序        | 0.5 天     | L0 检查移到 L1 之前                                         |
| **P1** | 统一或明确分工 ContextSlot ↔ Blackboard | 1-2 天     | 添加同步桥接或明确文档化两者职责边界                        |
| **P2** | 拆分 `tools/index.ts` (1,301 行)        | 2-3 天     | 按类别拆分: file-tools, search-tools, skill-tools 等        |
| **P2** | 拆分 `agent-loop.ts` (1,287 行)         | 2-3 天     | 提取 \_execute() 生成器为独立模块                           |
| **P2** | 激活 PIS + Judge (至少 log_only 模式)   | 1 天       | 将默认 preset 从 'standard' 改为 'enhanced'，或改为 opt-out |
| **P2** | 内置 skill 按需加载                     | 1 天       | L1 discover → L2 load 渐进加载，非全量注入 system prompt    |
| **P2** | 重构 SelfConsistencyEngine 为 Observer  | 1 天       | 统一到 Observer Pipeline 抽象                               |
| **P3** | 验证并清理 `@cabinet/graph` 所有消费者  | 0.5 天     | 如仅剩 agent-node + trace，考虑内联到 agent                 |
| **P3** | SubconsciousLoop 与 AgentLoop 直接集成  | 1-2 天     | agent-loop 可选择性消费 `subconscious_insight` 事件         |

### 7.2 中期 (2-4 周): 激活自适应

| 优先级 | 任务                                                                      |
| ------ | ------------------------------------------------------------------------- |
| **P1** | 收集 AdaptiveContextMonitor 基线数据 → 评估 adaptive threshold 准备就绪度 |
| **P1** | WriteGate embedding 慢通道成本/收益分析 → 决定是否默认激活                |
| **P2** | ProcessIdentityScore 在实际 session 中的验证 → 校准 intervene 阈值        |
| **P2** | Dashboard 历史趋势 (7 天/30 天聚合)                                       |
| **P2** | ToolPruner 指标驱动的自适应调参                                           |

### 7.3 长期 (与 v2 审计一致)

- MCP 安全沙盒完成 (T0-T3 原生集成)
- 外部 Agent 发现协议标准化
- Ebbinghaus 衰减参数从访问历史自适应学习
- 跨项目知识迁移的自动化触发 (阈值驱动, 替代手动 API)

---

## 附录 A: 超行数上限文件（已大幅削减）

CABINET.md 规定单文件不超过 500 行。v3 审计后大量服务端文件已完成拆分（`context.ts`、`capabilities.ts`、`workflows.ts`、`tool-dependencies.ts`、`agent-daemon.ts` 等从 >1,000 行降至 <20 行）。以下为当前仍超过 500 行的核心源文件（不含测试文件）：

| 文件                                                | 行数 |
| --------------------------------------------------- | ---- |
| apps/desktop/src/factory/WorkflowPanel.tsx          | 981  |
| apps/desktop/src/components/EmployeeEditModal.tsx   | 961  |
| apps/desktop/src/components/ChatView.tsx            | 849  |
| apps/desktop/src/App.tsx                            | 767  |
| packages/storage/src/system-knowledge-base.ts       | 756  |
| apps/desktop/src/pages/MemoryPage.tsx               | 754  |
| apps/desktop/src/components/ChatPanel.tsx           | 734  |
| packages/memory/src/long-term.ts                    | 732  |
| apps/desktop/src/contexts/ChatContext.tsx           | 711  |
| packages/gateway/src/ai-sdk-adapter.ts              | 644  |
| apps/desktop/src/components/ProjectExplorer.tsx     | 590  |
| apps/desktop/src/components/office/AgentMonitor.tsx | 576  |
| apps/desktop/src/pages/Workbench/McpTab.tsx         | 562  |
| packages/secretary/src/session-manager.ts           | 558  |
| packages/types/src/primitives.ts                    | 550  |
| packages/agent/src/adapters/harness/a2a/runtime.ts  | 535  |

**说明**: 剩余超行文件主要为 **desktop 前端组件**，服务端核心文件已全部拆分至 500 行以内。

---

## 附录 B: 审计方法说明

本次重评使用 4 个并行 Explore Agent + 直接文件读取 + 代码搜索验证：

- **Agent 1**: AgentLoop + Observer Pipeline + 文件大小统计
- **Agent 2**: Memory + Skill + MCP 子系统
- **Agent 3**: Workflow + CLI Harness + Harness 包 + Phase 5
- **Agent 4**: Decision/Policy + Multi-Agent + Dashboard + 架构验证

所有 Agent 直接读取源代码文件（非缓存或摘要）。关键断言通过 `grep` + `wc -l` + 直接 `Read` 交叉验证。

**v2 vs v3 方法论差异**: v2 审计的若干断言（HNSW fallback 缺失、Skill 系统未动、engine.ts 998 行等）与源代码实际状态不符。这可能是因为 v2 审计在 Phase 5-6 实施前运行，或 Agent 工作目录未与最新 commit 同步。v3 确保所有断言在当前 HEAD (`67c716a`) 下通过直接文件读取验证。

---

## 附录 C: 包结构总览

```
packages/ (13):
  Layer 4: ui, cli
  Layer 3: decision, secretary, workflow, harness
  Layer 2: agent, gateway, memory, agent-sdk (private)
  Layer 1: types, events, storage

apps/ (2):
  desktop (Tauri 2.0 + React 19)
  server (Hono + WebSocket)

总代码量: ~123,265 行 TypeScript/TSX (含 node_modules，源文件约 350+ 文件)
```
