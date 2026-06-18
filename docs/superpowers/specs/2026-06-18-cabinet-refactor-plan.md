# Cabinet 全面修复计划

> 基于 2026-06-17 四路并行功能深度分析产出
> 覆盖：重复实现 / 死代码 / 过度复杂 / 紧耦合 / 缺失抽象 / 集成问题

---

## 总览

| 指标                  | 值          |
| --------------------- | ----------- |
| 发现问题总数          | 约 60       |
| 建议操作项            | 约 40       |
| 按优先级：P0/P1/P2/P3 | 3/8/15/14   |
| 预计总工作量          | 约 5-8 人日 |

---

## 执行策略

```
Phase 0 — 接入死代码（P0-P1）  ← 直接接入已有的完整实现，产生即时价值
Phase 1 — 移除死代码（P1）      ← 安全删除，降低维护负担
Phase 2 — 去重（P1-P2）         ← 合并重复实现
Phase 3 — 解耦与抽象（P2）      ← 提取共享抽象
Phase 4 — 拆分大文件（P2-P3）   ← 降低复杂度
Phase 5 — 修复集成断点（P0-P2） ← 连接已断开的管线
```

---

## Phase 0 — 接入死代码（即时价值）

目标：已有完整实现但零调用者的功能，决定"接上"或"移除"。

### P0‑01 接入 BudgetGuard + CostTracker 到 LLM 调用路径

- **位置**：`packages/gateway/src/budget-guard.ts` + `cost-tracker.ts`
- **现状**：`AISDKAdapter.generateText()` 不检查预算，不记录成本。预算限制无效。
- **操作**：
  1. 在 `AISDKAdapter` 构造函数中接受可选的 `BudgetGuard`
  2. 在 `generateText()` 开头调用 `budgetGuard.check()`，超预算时抛 `BudgetExceededError`
  3. 在成功后调用 `costTracker.record()` 写入成本
  4. 在 `streamText()` 中也插入同样的检查
- **文件修改**：`ai-sdk-adapter.ts` + `budget-guard.ts`（调整 API）
- **风险**：低（新增行为，不改变现有逻辑）
- **工作量**：约 0.5 人日

### P0‑02 接入 WriteGate 分类到 LongTermMemory 存储路径

- **位置**：`packages/memory/src/long-term.ts` + `write-gate.ts`
- **现状**：`WriteGate` 将内容分为 `daily | register | working` 三级，但 `LongTermMemory.store()` 忽略层级，所有内容同等对待
- **操作**：
  1. `LongTermMemory.store()` 接受可选 `memoryTier` 参数
  2. 高 tier（working）→ 更多 HNSW 邻居、更长 TTL
  3. 低 tier（daily）→ 更少邻居、可被更快驱逐
  4. `ConsolidationService` 在写入时传递 `writeGate.evaluate()` 结果
- **文件修改**：`long-term.ts`、`consolidation.ts`、可选 `memory-facade.ts`
- **风险**：低（新增参数，默认行为兼容）
- **工作量**：约 0.5 人日

### P1‑01 接入 FallbackChain 到 AISDKAdapter

- **位置**：`packages/gateway/src/fallback.ts` → `ai-sdk-adapter.ts`
- **现状**：`FallbackChain` 完全实现但零调用。`generateText()` 无超时/重试/回退
- **操作**：在 `generateText()` 中用 `FallbackChain` 包装实际 LLM 调用，配置 2 次重试 + 降级模型回退
- **工作量**：约 0.3 人日

### P1‑02 接入或移除 HybridRetriever / chunkDocument

- **位置**：`packages/memory/src/hybrid-retriever.ts` + `chunking.ts`
- **现状**：完整的 BM25+embedding 混合检索管线，零生产者调用
- **操作**：决定二选一：
  - **方案 A（推荐）**：在 `MemoryFacade.search()` 中插入 `HybridRetriever` 作为可选检索器。当 `query` 超过 50 字时走语义搜索，否则走 BM25 全文搜索
  - **方案 B**：标记为 `@deprecated`，移除导出来源清理
- **工作量**：方案 A 约 0.3 人日，方案 B 约 0.1 人日

### P1‑03 接入或移除 CrossProjectMigrator / ProjectIsolatedMemory

- **位置**：`packages/memory/src/cross-project-migrator.ts` + `project-isolation.ts`
- **现状**：完整实现但零调用
- **操作**：决定二选一：
  - **方案 A**：保留，标记 `@experimental`，不接入生产路径（计划未来使用）
  - **方案 B（推荐）**：移除，代码已存在 6+ 月无人接入
- **工作量**：方案 A 约 0.05 人日（加注释），方案 B 约 0.1 人日

### P1‑04 接入或移除 GreetingService

- **位置**：`packages/secretary/src/greeting.ts`
- **现状**：LLM 驱动问候语生成器，`SecretaryAgent` 不调用
- **操作**：在 `SecretaryAgent.process()` 首次与 Captain 交互时调用 `greetingService.generate()`
- **工作量**：约 0.2 人日

### P0‑03 接入 DecisionService.onResolved → PreferenceLearner

- **位置**：`packages/decision/src/decision-service.ts` → `packages/harness/src/preference-learner.ts`
- **现状**：决策完成后触发 `onResolved` 回调，但 `PreferenceLearner.learnFromDecisions()` 从不被调用
- **操作**：在 `apps/server/src/context/build-context.ts` 中连线：`decisionService.onResolved = (d) => preferenceLearner.learnFromDecisions(d)`
- **工作量**：约 0.2 人日

---

## Phase 1 — 移除死代码

### 安全删除清单

每项操作：删除文件/代码 + 更新 index.ts 导出 + 删除测试文件 + CI 验证

| #   | 位置                                                                                 | 说明                                   | 工作量 |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------- | ------ |
| D01 | `packages/agent/src/observers/self-consistency.ts`                                   | 三个空钩子的 Observer                  | 0.1d   |
| D02 | `packages/agent/src/execution/agent-loop-options.ts` 中 `maxProbeTools`              | 定义但永不引用                         | 0.05d  |
| D03 | `packages/agent/src/execution/session-reporter.ts` 中 `report()`                     | 仅在 catch 中传入全零调用              | 0.1d   |
| D04 | `packages/harness/src/escalation.ts`（HarnessEscalation）                            | 零调用                                 | 0.1d   |
| D05 | `packages/harness/src/browser-pool.ts`                                               | 零调用（仅在系统知识库字符串中被提及） | 0.1d   |
| D06 | `packages/workflow/src/blueprint-io.ts` 中 `validateWorkflowBlueprint`（deprecated） | 委托包装器                             | 0.05d  |
| D07 | `packages/storage/src/metrics.ts` 中 `flushToDb()` / `stopPeriodicFlush()`           | 空方法                                 | 0.05d  |
| D08 | `apps/desktop/src/utils/api.ts` 中 `authHeaders()`                                   | 返回 `{}`，被 12+ 处调用               | 0.1d   |
| D09 | `apps/server/src/index.ts` 注释掉的 import                                           | 删除注释                               | 0.05d  |
| D10 | `packages/decision/src/policy-engine.ts` 中 `scoreProposal()`                        | 37 行私有死代码                        | 0.1d   |
| D11 | `packages/storage/src/` 中 `scheduled-task-repo.ts` + migration 004                  | scheduled_tasks 已被 workflows 替代    | 0.2d   |

---

## Phase 2 — 去重

### P1‑11 统一三份只读工具列表

- **操作**：将 `safety.ts` 的 `READ_ONLY_TOOLS` 提取为 `tool-categories.ts`，`execute-generator.ts` 从中导入
- **工作量**：0.2 人日

### P1‑12 统一三个条件评估器

- **操作**：
  1. `condition-evaluator.ts` 导出 `compareValues()` 和 `evaluateCondition()`
  2. `node-executor.ts` 导入而不是重写 `compareOp()`
  3. `engine.ts` 导入而不是重写 `evaluateCondition()`
- **风险**：需要验证现有行为完全一致（从动态 import 作为回退看，应一致）
- **工作量**：0.3 人日

### P1‑13 统一三个 Agent 调度机制

- **决策**：移除 `agent-node.ts`，统一到 `dispatch-graph.ts`
- **操作**：
  1. 验证 `dispatch-graph.ts` 覆盖所有 `agent-node.ts` 的使用场景
  2. 移除 `packages/agent/src/agent-node.ts` 和相关导出
  3. 更新 `dispatcher.ts` 让其内部使用 `dispatch-graph.ts`（如果合适）
- **风险**：中。需确认 `agent-node.ts` 没有被外部（如 `OrganizeInteractiveAgent`）直接依赖
- **工作量**：0.5 人日

### P2‑21 统一三个 Blueprint 格式

- **操作**：
  1. 明确主格式为 `WorkflowBlueprint`（JSON schema）
  2. `parseYamlBlueprint()` 作为输入转换器，输出 `WorkflowBlueprint`
  3. `validateBlueprint()` 作为共享验证器，不再区分 `Blueprint` vs `WorkflowBlueprint`
- **工作量**：0.3 人日

### P2‑22 统一三个 Embedding 接口

- **操作**：保留 `EmbeddingGatewayLike`（memory-facade.ts），让 `WriteGate` 和 `HybridRetriever` 使用同一接口
- **工作量**：0.2 人日

### P3‑31 统一两个 Handoff 抽象

- **操作**：创建共享 `HandoffDocument` 接口，`ContextHandoff` 实现它，`agent-handoff.ts` 消费它
- **工作量**：0.3 人日

---

## Phase 3 — 解耦与抽象

### P2‑41 提取 BaseRepository

- **操作**：
  1. 创建 `packages/storage/src/repositories/base-repo.ts`
  2. 提取公共方法：`findAll()`、`findById()`、`update(id, changes)`（动态 SET 构建器）、`delete(id)`
  3. 逐个迁移现有 Repository 继承 `BaseRepository`
  4. 每迁移一个，移除其内联的动态 SET 构建器
- **范围**：6+ 个有手写动态 SET 的 repo（project、employee、skill、squad 等）
- **风险**：低。纯重构，行为不变
- **工作量**：1 人日

### P2‑42 拆分 ServerContext

- **操作**：
  1. 将 `ServerContext` 拆分为按域分组的子接口：`InfraContext`（DB/logger/metrics）、`MemoryContext`、`AgentContext`、`GatewayContext`、`RegistryContext`
  2. 每个路由只导入需要的子上下文
  3. 提供 `getServerContext()` 向后兼容，但新路由应使用按需导入
- **风险**：中。影响所有路由文件，需逐个修改 import
- **工作量**：0.5 人日

### P2‑43 提取共享的 cosineSimilarity 和向量工具

- **操作**：
  1. 在 `packages/memory/src/` 内部创建 `vector-utils.ts`
  2. 三处 `cosineSimilarity` 统一为一个实现（用 epsilon 稳定版本）
  3. `write-gate.ts`、`long-term.ts`、`hybrid-retriever.ts` 都导入同一函数
- **工作量**：0.2 人日

### P2‑44 LongTermMemory 提取 rowToEntry 工厂

- **操作**：创建私有 `rowToEntry(row: LongTermMemoryRow): LongTermEntry`，替换 6 处内联 `JSON.parse(r.metadata ?? '{}')` + 字段映射
- **工作量**：0.2 人日

### P3‑51 添加 Observer 生命周期 dispose

- **操作**：
  1. 在 `AgentObserver` 接口中添加可选的 `dispose(): void`
  2. 在 `ObserverPipeline` 中添加 `dispose()` 方法，遍历所有 observer 调用
  3. 实现 `dispose()` 的 observer：BlackboardObserver、SubconsciousInsightObserver、StepEventObserver
- **风险**：低（可选方法，无 observer 强制实现）
- **工作量**：0.3 人日

### P3‑52 拆分 LLMGateway 接口

- **操作**：定义 `TextGenerator`（generateText）、`TextStreamer`（streamText）、`Embedder`（generateEmbeddings）三个子接口，`LLMGateway` 合并三者
- **工作量**：0.2 人日

### P3‑53 消除 Embedding 的 OpenAI 锁定

- **操作**：`AISDKAdapter.resolveEmbeddingModel()` 复用 `model-router` 的选择逻辑，不再硬编码 `createOpenAI()`
- **工作量**：0.3 人日

---

## Phase 4 — 拆分大文件

### P2‑61 拆分 LongTermMemory（739 行）

- **操作**：
  1. `long-term-hnsw.ts` — HNSW 索引管理（初始化、读写、重建、标记删除）
  2. `long-term-prune.ts` — 记忆修剪/驱逐（复用 MemoryDecayService）
  3. `long-term-contradiction.ts` — 矛盾检测（图 + LLM）
  4. `long-term.ts` — 保留核心 CRUD + 搜索，3 个新文件的方法注入或继承
- **工作量**：0.5 人日

### P2‑62 拆分 AISDKAdapter（576 行）

- **操作**：
  1. `ai-sdk-providers.ts` — provider 实例工厂（8 个 switch 分支迁移至此）
  2. `ai-sdk-stream-adapter.ts` — streaming 映射层（10→7 chunk 类型转换 + thinking 状态管理）
  3. `ai-sdk-adapter.ts` — 保留核心 generateText + streamText 编排，约 250 行
- **工作量**：0.5 人日

### P3‑71 拆分 executeGenerator（353 行）

- **操作**：提取为独立函数：
  - `handleUserInput()` — 输入验证 + 安全检查
  - `resolveAndPrepareTools()` — ToolPruner + 动态工具解析
  - `executeToolCallsWithTimeout()` — 超时封装
  - `handleStepEndAndCheckpoint()` — 步骤结束 + 检查点
- **工作量**：0.5 人日

### P3‑72 拆分 SafetyChecker（443 行）

- **操作**：
  1. `tool-categories.ts` — 工具分类常量（Set）
  2. `command-risks.ts` — `assessCommandRisk()`
  3. `sensitive-paths.ts` — `isSensitivePath()`
  4. `safety-checker.ts` — SafetyChecker 类（约 150 行）
- **工作量**：0.3 人日

---

## Phase 5 — 修复集成断点

### P2‑81 消除两个 RateLimitTracker 漂移

- **操作**：`Dispatcher` 停止维护自己的 `RateLimitTracker`，改为从 `AISDKAdapter` 中读取或通过 EventBus 接收更新
- **工作量**：0.3 人日

### P2‑82 修复 SubconsciousLoop / AutoAdjuster / HarnessAnalyst 无协调

- **操作**：
  1. `SubconsciousLoop.tick()` 不再用空数据调用 `failureAnalyzer.analyze([])`
  2. 三个循环通过 EventBus 发布 `analysis_requested` 事件，由一个协调器管理执行间隔
  3. 短期：在 `SubconsciousLoop` 配置中加入去重间隔
- **工作量**：0.3 人日

### P3‑91 清理 scheduled_tasks 孤儿表

- **操作**：
  1. 创建 migration 028，将 `scheduled_tasks` 数据迁移到 `workflows` 表
  2. 删除 `scheduled_tasks` 表
  3. 移除 `scheduled-task-repo.ts`
- **工作量**：0.2 人日

### P3‑92 添加 autopilot_runs ON DELETE CASCADE

- **操作**：创建 migration 添加 CASCADE 约束
- **工作量**：0.1 人日

### P3‑93 创建 MemorySystem 工厂函数

- **操作**：`packages/memory/src/factory.ts` 导出 `createMemorySystem()`，一次性连线所有依赖（ShortTerm → LongTerm → Consolidation → Cascade → WriteGate）
- **工作量**：0.3 人日

### P3‑94 统一三个错误分类

- **操作**：`packages/agent/src/retry.ts` 作为规范来源，让 `workflow/error-recovery.ts` 和 `harness/failure-analyzer.ts` 从 `@cabinet/agent` 导入 `classifyError`
- **工作量**：0.2 人日

---

## 工作量汇总

| Phase    | 内容                   | 总人日         |
| -------- | ---------------------- | -------------- |
| Phase 0  | 接入死代码（即时价值） | 2.0            |
| Phase 1  | 移除死代码（安全删除） | 1.0            |
| Phase 2  | 去重                   | 2.0            |
| Phase 3  | 解耦与抽象             | 3.0            |
| Phase 4  | 拆分大文件             | 1.8            |
| Phase 5  | 修复集成断点           | 1.4            |
| **合计** |                        | **约 11 人日** |

> 实际工作量因并行执行可压缩：Phase 0 + Phase 1 可全并行，Phase 2 有先后依赖。

---

## 推荐执行顺序（最短路径）

```
Week 1:
  Mon: Phase 0 — 接入 BudgetGuard + WriteGate + PreferenceLearner
  Tue: Phase 0 — 接入 FallbackChain + HybridRetriever 接入决策
  Wed: Phase 1 — 删除 11 项死代码（可并行）
  Thu: Phase 2 — 统一只读工具列表 + 条件评估器 + Embedding 接口
  Fri: Phase 2 — 统一调度机制 + Blueprint 格式

Week 2:
  Mon: Phase 3 — BaseRepository 提取（最大单项）
  Tue: Phase 3 — ServerContext 拆分
  Wed: Phase 3 — 向量工具 + rowToEntry + Observer dispose
  Thu: Phase 4 — LongTermMemory + AISDKAdapter 拆分
  Fri: Phase 5 — 集成断点修复 + 清理孤儿表
```
