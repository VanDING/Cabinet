# Cabinet AI 系统 — 阶段一至三实施审计报告

**审计日期**: 2026-06-08
**审计范围**: Phase 1 (大一统) + Phase 2 (削冗) + Phase 3 (补强)
**审计方法**: 逐项对比 AUDIT_REPORT.md 计划 vs 实际代码实现
**基准 commit**: `003be1f` (HEAD)

---

## 总体评估

| 维度 | 评级 | 说明 |
|------|------|------|
| **实施完整度** | **B+** (85%) | 17 项计划中 13 项完全完成，2 项部分完成，2 项未完成 |
| **代码质量** | **A-** (88%) | 架构模式统一，封装良好，测试覆盖合理 |
| **设计忠实度** | **B+** (82%) | 核心架构按计划实施，少数项有设计偏离 |
| **回归安全** | **B** (75%) | 有测试但 Observer Pipeline 和 DispatchGraph 缺少专项测试 |

---

## 第一阶段: 大一统 — 消除分支冗余

### 1.1 CLI Harness: 提取公共基类 ✅ **完成 (90%)**

**计划**: 提取 GenericCliRuntime 为显式基类，子类只覆盖 buildPrompt/buildArgs/parseDeliverable/injectSkill。预期 2,150 → ~1,500 行。

**实际**:
- 新增 `base-cli.ts` (265 行) — 封装 spawn/stdio/timeout/错误恢复/deliverable 解析
- 5 个子类均继承 `BaseCliRuntime`，只覆盖抽象钩子
- 总行数: 2,150 → 1,709 (减少 441 行，-20.5%)

| 文件 | 重构前 | 重构后 | 变化 |
|------|--------|--------|------|
| base-cli.ts | — | 265 | **新增** |
| claude-code.ts | 439 | 265 | -174 |
| codex.ts | 353 | 179 | -174 |
| opencode.ts | 342 | 174 | -168 |
| generic.ts | 313 | 112 | -201 |
| a2a.ts | 570 | 570 | 未变 (HTTP, 非子进程) |
| factory.ts | 133 | 133 | 未变 |
| **合计** | **2,150** | **1,709** | **-441** |

**差距**: 未达到 ~1,500 行的预期目标。原因: ClaudeCode 保留了会话发现、安装逻辑、详细指标提取等超出纯子进程管理的功能。

**质量评价**: 基类设计干净。抽象钩子定义合理 (`getDefaultCommand`, `buildArgs`, `convertPrompt`, `extractMetrics`, `injectSkill`)。`execSimple` 作为 protected 方法提供给子类使用。

---

### 1.2 AgentLoop: 合并 run() 和 runStreaming() ✅ **完成 (85%)**

**计划**: 统一为 Observer Pipeline (ContextMonitorObserver + HandoffObserver + SafetyCheckObserver + ToolExecuteObserver + CheckpointObserver)。run() 和 runStreaming() 共享 `_execute()` 路径。

**实际**:
- `_execute()` (async generator) 是唯一执行路径 — run() 和 runStreaming() 都通过它
- 5 个 Observer 全部实现 (`packages/agent/src/observers/`)
- `buildRunGraph()` 已删除 — 不再每次编译 StateGraph
- agent-loop.ts: 1,137 → 1,031 行 (-106 行)
- Observer Pipeline 基础设施: `observer-pipeline.ts` (102 行) + 5 个 observer 文件 (138 行)

**设计偏离**:
- ⚠️ **使用 `gateway.generateText()` 而非 `streamText`** — 计划预期 LLM 调用始终流式，但实现使用非流式 API，在无工具调用时通过 chunking 模拟流式输出 (agent-loop.ts:602-606)。这是务实的简化，但未达到"始终流式"的设计目标
- ⚠️ **Observer 文件偏小** (22-33 行/文件) — 功能正确但薄，特别是 ContextMonitorObserver 的 token 估算使用简单的字符数 ÷ 4 启发式 (来自 ContextMonitor)

**缺失**:
- 没有 observer-pipeline 或 agent-loop 统一后的专项测试 (agent-loop.test.ts 存在但是否覆盖新路径待验证)

---

### 1.3 Dispatcher: 统一 DispatchGraph ✅ **完成 (95%)**

**计划**: runSingle/runPipeline/runParallel → 统一的 `executeDispatchGraph()`。预期 387 → ~220 行。

**实际**:
- `dispatch-graph.ts` (257 行) — `compileDispatchGraph()` + `executeDispatchGraph()`
- `dispatcher.ts` (240 行) — 只保留编排逻辑，委托给 `executeDispatchGraph()`
- 三个旧方法 (runSingle/runPipeline/runParallel) 完全移除
- Total: 497 行 (dispatcher + dispatch-graph)，但架构清晰分离

**设计评价**: Graph 编译和执行分离 (`compileDispatchGraph` vs `executeDispatchGraph`) 是好设计。`AgentStepFn` 和 `SynthesizeFn` 类型注入使 dispatcher 可测试。Pipeline 模式正确维护 `PipelineContext` 在步骤间传递。

---

### 1.4 Workflow: YAML 解析器 + 删除 EL ✅ **完成 (100%)**

**计划**: 实现 YAML 解析器 → 删除 EL 编译器 → 合并 ManagerExecutor 入口。

**实际**:
- ✅ `el-compiler.ts` (534 行) — **已删除**
- ✅ `blueprint-yaml.ts` (182 行) — 新增 YAML 蓝图解析器
- ✅ `parseYamlBlueprint()` 导出在 index.ts
- ✅ ManagerExecutor 不再是公共导出 (只在 engine.ts 内部使用)
- ✅ 项目中无残留 EL 引用 (`compileEL`/`parseEL`/`.el` 全部清理)
- ✅ YAML 验证测试存在 (`blueprint-validator.test.ts`)

---

### 1.5 记忆系统: 合并双管道 ✅ **完成 (90%)**

**计划**: 删除 MemoryOrchestrator → 修复 `_store` 封装泄漏 → 明确 ConsolidationService 和 Curator 的职责分离 → 新增 ConsolidationMetrics 日志。

**实际**:
- ✅ `orchestrator.ts` (23 行) — **已删除**
- ✅ ShortTermMemory.\_store — **已修复**: 全部字段改为 `private`，通过 `getAll()`/`getAllSessionIds()` 公共 API 访问
- ✅ ConsolidationService 保留 — 职责明确: `consolidateBasic()` 处理 daily tier (零 LLM)，Curator 处理 register/working tier (LLM)
- ⚠️ ConsolidationMetrics 日志 — 未找到显式的 metrics 日志记录
- ✅ `cascade-buffer.ts` 保留 (137 行) — 符合 Scenario A (保留方案)

---

## 第二阶段: 削冗 — 删除/降级/外移

### 2.1 完全删除

| 删除项 | 状态 | 证据 |
|--------|------|------|
| **meeting 包** (699 行) | ✅ 已删除 | `packages/meeting/` 不存在；`pnpm-workspace.yaml` 无 meeting 条目；项目无 `@cabinet/meeting` 导入 |
| **EL 编译器** (534 行) | ✅ 已删除 | `el-compiler.ts` 不存在；项目无 `.el` 或 `compileEL` 引用 |
| **MemoryOrchestrator** (23 行) | ✅ 已删除 | `orchestrator.ts` 不存在 |
| **organize 包** (931 行) | ✅ 已删除 | `packages/organize/` 不存在；`pnpm-workspace.yaml` 无 organize 条目 |

### 2.2 降级为内部实现

| 模块 | 状态 | 证据 |
|------|------|------|
| **agent-sdk → private** | ✅ 完成 | `packages/agent-sdk/package.json`: `"private": true` |
| **BrowserPool/Verifier → tests/** | ❌ 未完成 | 仍在 `packages/harness/src/`，仍在 `index.ts` 中公开导出 |
| **GarbageCollector → 删除** | ❌ 未完成 | 仍在 `packages/harness/src/garbage-collector.ts`，仍在 `index.ts` 中公开导出 |

**BrowserPool/GC 详细状态**:
```
packages/harness/src/browser-pool.ts       — EXISTS (公开导出)
packages/harness/src/browser-verifier.ts   — EXISTS (公开导出)
packages/harness/src/garbage-collector.ts  — EXISTS (公开导出)
```

这三个模块在审计报告中明确标记为应删除或外移，但**完全未动**。是第二阶段最大的遗漏。

### 2.3 依赖清理

| 依赖 | 计划动作 | 实际状态 |
|------|----------|----------|
| `xlsx` | 移除 | ❌ 保留 — 在 `apps/server/src/capabilities.ts` 中使用 (Excel 文件解析) |
| `mammoth` | 移除 | ❌ 保留 — 在 `apps/server/src/capabilities.ts` 中使用 (Word 文档解析) |
| `pdf-parse` | 移除 | ❌ 保留 — 在 `apps/server/src/capabilities.ts` 中使用 (PDF 解析) |
| `adm-zip` | 移除 | ❌ 保留 — 在 `capabilities.ts` 和 `routes/skills.ts` 中使用 |
| `nodemailer` | 移除 | ❌ 保留 — 在 `capabilities.ts` 中使用 (邮件通知) |
| `node-notifier` | 移除 | ❌ 保留 — 在 `capabilities.ts` 中使用 (系统通知) |

**结论**: 审计报告的判断有误 — 这些依赖**确实被使用**。`capabilities.ts` 是 server 的文件处理能力层，它们不是死代码。正确的依赖清理判断需要更仔细的引用链分析。

---

## 第三阶段: 补强 — 修复薄弱层

### 3.1 S5 PolicyEngine: 从二元判断到加权仲裁 ✅ **完成 (95%)**

**计划**: arbitrate() 方法 → Channel A (T0/T1 approval) + Channel B (T2/T3 validate) → MissionProfile 从 EntityMemory 推断。

**实际**:
- ✅ `packages/decision/src/policy-engine.ts` (305 行) — 完整重写
- ✅ `MissionProfile` 接口: riskTolerance / costSensitivity / conflictResolution
- ✅ `arbitrate(s3Action, s4Insight)` — 加权评分算法 (S3 score + S4 score + profile bias)
- ✅ `evaluateAdjustment(action)` — Channel A: 5 条规则 (L3 等效/预算临界/外部代理沙盒/可解释性/用户自治)
- ✅ `checkDecision(decision)` — L3 自动批准拦截 + 外部代理 L2 限制
- ✅ Channel B 集成: `AutoAdjuster` 在 T2/T3 路径调用 `policyEngine.evaluateAdjustment()` (harness auto-adjuster.ts:72-73)
- ✅ `setProfile()` 允许运行时更新偏好
- ✅ 测试: `packages/decision/src/__tests__/policy-engine.test.ts`

**小差距**: MissionProfile 的 `riskTolerance`/`costSensitivity` 目前是手动设置，未从 PreferenceLearner 的决策历史中自动推断。计划中提到的"从决策历史自动推断 riskTolerance/costSensitivity"未实现。

---

### 3.2 KnowledgeGraph: 正则实体提取 → 轻量 NER ✅ **完成 (95%)**

**计划**: compromise.js (英文) + token-boundary heuristics (中日韩文) → 替换纯正则。

**实际**:
- ✅ 新增 `entity-extractor.ts` (148 行) — 混合提取器
- ✅ compromise.js 集成 — 提取人名/组织/地点 (英文)
- ✅ 正则快速路径保留 — 用于技术术语 (React, TypeScript, LangGraph)
- ✅ 停用词表 (45+ 词) — 过滤冠词/介词/代词/常见技术噪声词 (error, code, data, value...)
- ✅ CJK 支持: 2+ 字符的 Unicode CJK 范围匹配
- ✅ 引用术语提取: 引号内的短语
- ✅ `knowledge-graph.ts` 使用 `extractCandidateEntities()` (从 entity-extractor 导入)
- ✅ 测试: `entity-extractor.test.ts`

**设计亮点**: 混合策略明确承认 "compromise.js 在技术术语上失败" 的 trade-off — regex + NER 互补。

---

### 3.3 WriteGate: 单 regex → 双通道 (regex + embedding) ✅ **完成 (85%)**

**计划**: 添加 embedding-based 语义分类作为慢通道，与 regex 快速通道并行。

**实际**:
- ✅ `WriteGateChannel` 类型: `'fast' | 'slow' | 'fallback'`
- ✅ `EmbeddingProvider` 接口 — 允许注入 embedding 生成器
- ✅ `evaluateAsync()` — 异步双通道评估
- ✅ `classifyByEmbedding()` — 余弦相似度 vs 锚点 embedding
- ✅ 多语言 regex 增强 — 中日英法西德俄日全覆盖
- ✅ `isDecision` 逻辑放宽 — 不再要求同时有决策词+推理词

**差距**:
- ⚠️ 慢通道需要显式 opt-in (`useEmbeddingSlowPath: true` + `embeddingProvider` + `anchorEmbeddings`)
- ⚠️ 未找到实际注入 embedding provider 的调用点 (server 或 agent 层)
- ⚠️ 锚点 embedding 的生成和管理策略未定义

**结论**: 架构设计完整，但 embedding 慢通道在当前代码中**未被激活**。计划声称"双通道架构"但实际只运行快速通道。

---

### 3.4 矛盾检测: LLM Judge 注入 ⚠️ **部分完成 (40%)**

**计划**: 将 llmJudge 实际注入 KnowledgeGraph.detectContradictions()，让矛盾检测真正工作。

**实际**:
- ✅ `detectContradictions()` 的 options 参数添加了 `llmJudge` 回调类型
- ❌ **llmJudge 从未被调用** — 方法体仍然是纯图结构检测 (直接 contradicts 关系 + 间接相关实体)
- 代码路径: 提取候选实体 → 查找 contradicts 关系边 → 查找间接矛盾 → 返回排序结果
- llmJudge 在函数签名中可用但**没有任何调用点** — `options?.llmJudge` 在整个方法体中不存在

**严重性**: 这是审计报告 Top 4 指出的核心问题之一 ("矛盾检测在当前实现中基本不工作")，但修复只做了接口层面的准备。矛盾检测仍然是纯图结构驱动的 — 而图结构中的 contradicts 关系必须由外部显式创建 (`addContradiction()`)，实际中很少发生。

**相关**: 审计报告还指出 "LLM 裁判参数 llmJudge 在接口中定义了但从未被注入"。本次"修复"将参数从接口移到 options 对象，但仍未调用它。

---

### 3.5 MemoryFacade: 统一接口 ✅ **完成 (95%)**

**计划**: 创建 MemoryFacade 统一 Curator 的 ToolDependencies 访问和 Agent 的 MemoryProvider 访问。

**实际**:
- ✅ `memory-facade.ts` (327 行) — 完整的统一外观
- ✅ 实现 `MemoryProvider` 接口 — 向后兼容 ContextBuilder
- ✅ 丰富的读写 API: `remember/recall/forget/clearSession`, `search/storeMemory/updateMemory/deleteMemory`, `getProject/updateProjectSummary`, `getPreferences/setPreferences`
- ✅ `consolidateSession()` 支持 optional ConsolidationService + LLM extraction
- ✅ SessionManager 集成: `getSessionContext()` 合并对话消息 + STM KV 条目
- ✅ 消费者已接入:
  - `apps/server/src/context.ts` — 创建 MemoryFacade 实例
  - `apps/server/src/context/curator-loop.ts` — Curator 使用 MemoryFacade
  - `apps/server/src/context/curator.ts` — Curator 工具使用 MemoryFacade
  - `packages/agent/src/tools/index.ts` — Agent 工具使用 MemoryFacade
- ✅ 从 memory 包 index.ts 正确导出

**设计评价**: MemoryFacade 解决了审计报告 Top 5 问题之一的"两套记忆接口分歧"。通过 `SessionManagerLike` 和 `EmbeddingGatewayLike` 的结构类型，避免循环依赖。

---

## 遗漏与未实现汇总

### 🔴 高优先级遗漏

| # | 问题 | 审计报告引用 | 影响 |
|---|------|-------------|------|
| 1 | **BrowserPool / BrowserVerifier / GarbageCollector 未删除** | Phase 2.2: "移到 tests/e2e/"、"删除" | 死代码仍占用 ~500 行，仍在公共 API 中 |
| 2 | **LLM Judge 未被实际调用** | Phase 3.4: "让矛盾检测真正工作" | KnowledgeGraph 矛盾检测仍基本不工作 |
| 3 | **WriteGate embedding 慢通道未激活** | Phase 3.3: "双通道架构" | 实际只有 regex 快通道在运行 |

### 🟡 中优先级遗漏

| # | 问题 | 说明 |
|---|------|------|
| 4 | **AgentLoop 使用 generateText 而非 streamText** | 未达到"始终流式"的设计目标。当前通过 chunking 模拟流式输出 |
| 5 | **Observer Pipeline 缺少专项测试** | 5 个 observer 没有独立的单元测试文件 |
| 6 | **MissionProfile 未从决策历史自动推断** | riskTolerance/costSensitivity 需手动设置，未实现自适应学习 |
| 7 | **ConsolidationMetrics 日志未实现** | Phase 1.5 计划中提到的 consolidation metrics 记录 |

### 🟢 审计报告自身数据误差

| # | 原报告判断 | 实际情况 |
|---|-----------|----------|
| 8 | xlsx/mammoth/pdf-parse 等"未见实际使用" | 全都在 `capabilities.ts` 中实际使用 |
| 9 | CLI Harness 预期降至 ~1,500 行 | 实际 1,709 行，因子类保留了领域特有逻辑 |
| 10 | AgentLoop 预期降至 ~900 行 | 实际 1,031 行，Observer 基础设施需要额外代码 |

---

## 测试覆盖评估

| 模块 | 测试文件 | 状态 |
|------|---------|------|
| PolicyEngine | `decision/__tests__/policy-engine.test.ts` | ✅ 存在 |
| EntityExtractor (NER) | `memory/__tests__/entity-extractor.test.ts` | ✅ 存在 |
| Memory (通用) | `memory/__tests__/memory.test.ts` | ✅ 存在 |
| Blueprint Validator | `workflow/__tests__/blueprint-validator.test.ts` | ✅ 存在 |
| Workflow | `workflow/__tests__/workflow.test.ts` | ✅ 存在 |
| AgentLoop | `agent/__tests__/agent-loop.test.ts` | ⚠️ 存在但需验证覆盖新路径 |
| Observer Pipeline | — | ❌ 无专项测试 |
| DispatchGraph | — | ❌ 无专项测试 |
| WriteGate | — | ❌ 无专项测试 (memory.test.ts 可能包含) |
| KnowledgeGraph | — | ❌ 无专项测试 (memory.test.ts 可能包含) |
| MemoryFacade | — | ❌ 无专项测试 |

---

## 最终评级

| 维度 | 评级 | 分数 |
|------|------|------|
| **Phase 1 (大一统)** | **A-** | 90% |
| **Phase 2 (削冗)** | **B** | 70% |
| **Phase 3 (补强)** | **B+** | 78% |
| **整体实施质量** | **B+** | 82% |

### 关键建议

1. **立即处理**: BrowserPool/GC/BrowserVerifier 从 harness 公共 API 移除 (Phase 2 遗留)
2. **优先修复**: KnowledgeGraph.detectContradictions() 实际调用 llmJudge (Phase 3.4 核心遗漏)
3. **评估激活**: WriteGate embedding 慢通道 — 决定激活还是降级文档说明
4. **补充测试**: Observer Pipeline + DispatchGraph + MemoryFacade 的回归测试
5. **接受偏离**: generateText vs streamText 的简化是务实的工程决策，可以接受

---

**审计结论**: 三个阶段的核心架构目标已达成 — AgentLoop 统一、Dispatcher 统一、CLI 基类提取、EL 删除、Meeting/Organize 删除、PolicyEngine 加权仲裁、KG NER 升级。主要遗漏集中在 Phase 2 的 BrowserPool/GC 清理和 Phase 3.4 的 LLM Judge 实际调用上。整体实施质量良好，代码可维护性显著提升。
