# Cabinet 系统性优化方案 — 评估报告

> **评估原则**: 仅作评估与建议，不实施任何修改。基于对项目实际代码的逐文件、逐行核查。

---

## 一、总体结论

**方案的战略方向是正确的**，与 Cabinet 当前 alpha 阶段的技术债务分布高度吻合。

**但存在三类必须修正的问题**:

1. **数据失准** — 多处关键行数、代码结构、当前状态的描述与实际情况不符，若直接执行会导致资源错配和进度失控
2. **复杂度低估** — 部分重构的侵入性和风险被显著低估（尤其是 AgentLoop 统一和 CascadeBuffer 删除）
3. **关键遗漏** — 缺少测试策略、回滚方案、兼容性保障和依赖关系排序

**建议**: **修订后再执行**。第一阶段（大一统）可以启动，但需基于修订后的详细计划。

---

## 二、数据准确性核查

以下数据错误会直接影响排期和人力估算:

| 方案声称                                  | 实际核查                                        | 偏差等级                  |
| ----------------------------------------- | ----------------------------------------------- | ------------------------- |
| CLI Runtime "各 30–36 行"                 | **300–570 行/文件，共 2,160 行**                | 🔴 **严重**（低估 10 倍） |
| GarbageCollector "~150 行"                | **459 行**                                      | 🔴 严重（低估 3 倍）      |
| EL 蓝图 "~200 行"                         | **534 行**（含 tokenizer + parser + compiler）  | 🟡 中度（低估 2.5 倍）    |
| PolicyEngine "~200 行"                    | **137 行**                                      | 🟢 轻微                   |
| "adjustmentNotifyCallback 总是返回 true"  | **仅在 `needsApproval`（T0/T1）时调用**         | 🔴 严重（逻辑误判）       |
| "ManagerExecutor 暴露为独立 API"          | **未在 index.ts 导出，仅 engine.ts 内部使用**   | 🟡 中度（状态过时）       |
| "Dispatcher.runPipeline() 承担工作流角色" | **纯 Agent 顺序调度，与 WorkflowEngine 零交集** | 🟡 中度                   |
| agent-loop.ts "1,137 行"                  | **1,136 行**                                    | 🟢 准确                   |
| dispatcher.ts "387 行"                    | **387 行**                                      | 🟢 准确                   |
| meeting "699 行" / organize "931 行"      | **准确**                                        | 🟢 准确                   |
| CascadeBuffer "115 行"                    | **准确**                                        | 🟢 准确                   |

> **影响**: CLI Harness 基类提取的工作量被严重低估。按方案估算 "120+45+40=205 行"，实际可能需要 **400–500 行**（基类需承载 200+ 行公共 helper + 生命周期方法 + 差异抽象）。

---

## 三、分阶段逐项评估

---

### 第一阶段: 大一统 — 消除分支冗余

#### 1.1 AgentLoop: 合并 `run()` 和 `runStreaming()`

**方向**: ✅ 正确。两者在 context 构建、tool 执行、session 报告、skill injection、project snapshot 等环节确有大量重复。

**问题与风险**:

| 问题                          | 详情                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 **能力不对等**             | `runStreaming()` 明确注释: _"Does NOT support checkpoint resumption or context monitoring"_。方案说 "`run()` 变为 `runStreaming()` 的同步包装器"，实际是要给 streaming 路径**补全 checkpoint + context monitor + handoff** 三大能力，这不是包装器，是能力重建 |
| 🔴 **StateGraph 依赖深**      | `buildRunGraph()` 实际 **~330 行**（非 ~200 行），内部节点（buildContext → callLLM → executeTool → checkSafety → checkpoint → contextMonitor）与 StateGraph 编译强耦合。统一为 stream-first 意味着重写这些节点的执行语义                                      |
| 🟡 **handoff_block chunk**    | "在 streaming 中插入 `handoff_block` chunk 后重启 stream" 依赖 AI SDK 支持自定义 chunk 类型。当前 `streamText` 的 chunk 类型由 SDK 定义，自定义 chunk 可能不可行，需改用 callback 或 event 机制                                                               |
| 🟡 **Observer Pipeline 抽象** | 将 contextCheck/safetyCheck/toolExecute/checkpoint 抽象为 `(chunk, ctx) => ctx` 中间件链，在理论上是好设计，但 toolExecute 在当前 streaming 路径中是**异步副作用**（通过 `execute` callback 嵌入 tool definition），与 "纯中间件" 的函数式语义冲突            |

**修订建议**:

- 将目标修正为 **"以 AI SDK streamText 为底层，在其上叠加 checkpoint/contextMonitor/handoff 能力"**，而非简单的 "包装器"
- 保留 `run()` 作为公共 API（避免外部调用方大面积修改），但内部改为调用统一的 stream 引擎 + 收集模式
- 将 handoff 机制从 "chunk 注入" 改为 "stream 中断 + event 触发 + 新 stream 启动"
- **单独排期 2–3 周**，不要与其他 1.x 子项并行

---

#### 1.2 Dispatcher: 合并 Pipeline/Parallel/Single → DispatchGraph

**方向**: ✅ 正确。三个模式确实是拓扑差异，执行机制相同。

**问题与风险**:

| 问题                          | 详情                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡 **pipelineContext 数据流** | `runPipeline()` 中前一步的输出通过 `pipelineContext` 序列化后传给下一步（第 167–212 行）。这不是 DAG 的 "节点间无状态传递"，而是**顺序数据流**。StateGraph 需要支持边上传参或节点间状态共享 |
| 🟡 **并发控制退化风险**       | 当前手动 batch 支持 rateLimitTracker 动态调整（`maxConcurrency = min(3, floor(remaining/2))`）。改为 graph 层自动调度后，这一精细控制能力可能丢失，需确保 StateGraph 的并发调度支持此类策略 |
| 🟢 **AgentNode 复用**         | 方向好，但需注意 WorkflowEngine 当前在 `case 'agentGroup'` 中是自己创建 AgentLoop（workflows.ts 第 23 行引入 AgentLoop），需统一为使用 AgentNode                                            |

**修订建议**:

- 明确 StateGraph 需支持**带数据流的顺序边**（pipeline 模式）和**带并发限制的并行分叉**（parallel 模式）
- 保留 rateLimitTracker 的集成点，不要降级为无限制并发
- `DispatchResult` 中的 `steps` 聚合逻辑（当前在各方法中分别计算）需统一到 graph 层

---

#### 1.3 CLI Harness: 合并 5 个 Runtime → 1 个基类 + 4 个配置

**方向**: ✅ 正确。4 个 CLI Runtime 有约 **200+ 行完全重复代码**（stop/healthCheck/parseOutput/cancelTask/extractTaggedSections/extractDeliverable/readStream/collectStderr/execSimple 等 9 个方法逐行复制）。

**问题与风险**:

| 问题                      | 详情                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 **工作量严重低估**     | 方案估算 "基类 120 行 + 子类 15 行 × 3 + A2A 40 行 = 205 行"。实际公共逻辑（含 helper）约 220 行，但 `dispatchTask()` 核心流程虽相同，差异点分散在各处（ClaudeCode 的 `--print`/`--cwd`、GenericCli 的 stderr logging、各 CLI 的 timeout 差异 120s vs 300s、正则表达式差异）。更现实的估计是 **基类 220 行 + 子类 80–120 行 × 3 + A2A 保留 500 行 = ~960 行** |
| 🟡 **`buildArgs` 不存在** | 方案假设注入点为 `buildArgs(task)` / `parseOutput(raw)` / `injectSkill()`，但当前代码中**不存在 `buildArgs` 方法**，参数构建内联在 `dispatchTask()` 中。抽象时需要提取这一内联逻辑                                                                                                                                                                            |
| 🟡 **A2A 的独立性**       | A2AHarnessRuntime（570 行）采用 HTTP + WebSocket，与子进程模型差异大。方案说 "共享 ExternalAgentAdapter 接口"，但当前 A2A 直接实现 `HarnessRuntime`，没有 ExternalAgentAdapter 这一层                                                                                                                                                                         |

**修订建议**:

- 分两步走：第一步提取 `GenericCliRuntimeBase`（220 行公共 helper + 生命周期），第二步将差异点内聚为 protected 方法供子类覆盖
- `dispatchTask()` 的抽象采用 **Template Method 模式**：定义 `buildSpawnArgs(task): string[]`（即方案中的 `buildArgs`）、`handleStderr(data)`、`getDefaultTimeout()` 等 protected 钩子
- A2A 独立为 `A2AHarnessRuntime`，不要强行纳入 CLI 基类继承树

---

#### 1.4 Workflow: 合并 3 条执行路径 → 统一 WorkflowEngine

**方向**: ✅ 正确，但当前状态描述需修正。

**问题与风险**:

| 问题                                   | 详情                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡 **ManagerExecutor 已内部化**        | 方案说 "ManagerExecutor 保持但不再暴露为独立 API"，但实际上它**已经不在 index.ts 导出**，仅在 engine.ts 内部使用。这条 "合并" 的工作量远小于方案预期                                                                                                                      |
| 🔴 **EL 蓝图删除风险**                 | EL 编译器 534 行，且 `parseEL`/`compileEL` 是当前 `@cabinet/workflow` 的**公共 API**（index.ts 第 19–23 行导出）。`apps/server/src/context.ts` 第 1406 行在蓝图热加载时调用 `compileEL`。删除 EL 需要同时替换热加载路径                                                   |
| 🟡 **YAML 支持薄弱**                   | 方案说 "YAML 蓝图是唯一的外部工作流定义格式"，但当前 YAML 支持仅停留在文件监视 + `validateBlueprint` 验证（且 validateBlueprint 只是 re-export `@cabinet/organize` 的实现）。**没有原生 YAML→WorkflowNodeDef 的解析器**。如果删除 EL，需要新建 YAML 解析器或强制使用 JSON |
| 🟡 **Dispatcher.runPipeline() 的归属** | 方案说要将 pipeline 逻辑移到 Workflow 层。但 `runPipeline()` 是 `AgentDispatcher` 的核心 API，被外部调用（如 server routes 或 CLI）。直接迁移会改变 `@cabinet/agent` 的公共 API 边界，需评估影响面                                                                        |

**修订建议**:

- 修正当前状态：ManagerExecutor 已经是 WorkflowEngine 的内部节点，无需 "降级"
- EL 删除前需确认：**(a)** 是否有外部 `.el` 蓝图文件在用；**(b)** 热加载路径是否可完全转为 YAML/JSON
- 如果 YAML 解析器未建设完成，**不要同时删除 EL**，保留 EL 作为过渡，先建 YAML 解析器再 deprecate EL
- `Dispatcher.runPipeline()` 不要 "移到 Workflow 层"，而是在 Workflow 层新增一个 `AgentGroupNode` 来内部调用 Dispatcher，保留 Dispatcher 的公共 API 不变（向后兼容）

---

#### 1.5 记忆系统: 合并双 Consolidation 管道 + 删除空壳

**方向**: 部分正确，但 **CascadeBuffer 删除需极度谨慎**。

**问题与风险**:

| 问题                                 | 详情                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 **CascadeBuffer 的成本价值**      | 当前 `consolidateBasic()` 将 daily tier 条目放入 CascadeBuffer，由 `autoSeal()` 在条目数 ≥3 或年龄 ≥30 分钟时自动汇总为 L1 summary 写入 LTM。**这是零 LLM 成本的批量压缩机制**。如果删除 CascadeBuffer，daily 条目只有两个选择：(a) 直接丢弃 或 (b) 全部走 Curator LLM consolidation。方案假设 "Curator LLM 替代质量更高"，但忽略了 **LLM 调用成本** 和 **延迟** |
| 🟡 **ConsolidationService 的降级**   | 方案说降级为 "WriteGate 调用 + Curator Queue 入队"。但当前 `ConsolidationService` 已同时管理 `consolidateBasic`（自动）和 `consolidateWithLLM`（回调驱动），且 `flushSession()` 在 session close 时被调用。简化为单一管道需要重新设计触发时机                                                                                                                    |
| 🟢 **MemoryOrchestrator 可安全删除** | 23 行空接口，无任何实现类，确认可删                                                                                                                                                                                                                                                                                                                              |

**修订建议**:

- **暂缓删除 CascadeBuffer**，先进行成本测算：统计当前 daily tier 条目量 × Haiku/Claude 调用成本，判断全量 LLM consolidation 是否可承受
- 如果决定删除，建议分两步：(1) 将 CascadeBuffer 的 L1 summary 逻辑改为轻量规则汇总（非 LLM），替代当前的手工 seal；(2) 验证成本可控后，再完全移除
- `ConsolidationService` 的改造建议保留 `flushSession()` 作为 session close 的显式 checkpoint，不要完全依赖异步 Curator Queue

---

### 第二阶段: 削冗 — 删除/降级/外移

#### 2.1 完全删除

| 删除项                         | 评估                                                                                                 | 建议                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **meeting 包** (699 行)        | ✅ 可删。已是 `private: true`，无外部依赖。但需检查 `pnpm-workspace.yaml` 中是否仍被引用             | 删除前确认 workspace 配置                                |
| **EL 蓝图** (534 行)           | 🟡 **有条件删除**。公共 API 已导出，server 热加载在使用。当前状态是 "有文件监视但无原生 YAML 解析器" | **延期到 YAML 解析器建设完成后**                         |
| **MemoryOrchestrator** (23 行) | ✅ 可删                                                                                              | 直接删除                                                 |
| **CascadeBuffer** (115 行)     | 🔴 **暂缓删除**。理由见 1.5                                                                          | 需成本测算后再决策                                       |
| **GarbageCollector** (459 行)  | 🟡 需功能确认。方案说是 "静态分析工具"，但实际 459 行，需确认是否属于 harness 的核心资源管理         | **调研后再决策**，不要仅因 "不属于 AI agent 框架" 就删除 |

**修订建议**:

- 将第二阶段的起点从 "第一阶段完成后" 改为 "第一阶段验收通过后"
- 删除 meeting 和 MemoryOrchestrator 可以**提前到第一阶段中期**（它们是独立的，不依赖其他统一工作）

#### 2.2 降级为内部实现

| 模块                     | 评估                                                                                                                                                   | 建议                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **organize 包** (931 行) | 🟡 已是 `private: true`，但 `@cabinet/workflow` 的 `blueprint-validator.ts` 直接 re-export 了 organize 的实现。如果合并到 workflow，需要内迁这部分代码 | 可行，但注意 organize 的测试文件（232 行）也需迁移 |
| **BrowserPool/Verifier** | 🟢 合理。如果确认仅在测试中使用                                                                                                                        | 迁移前确认无生产代码引用                           |
| **agent-sdk**            | 🟢 合理。当前无 `private` 字段，但版本为 `0.1.0-alpha.0`，尚未对外承诺                                                                                 | 添加 `"private": true` 即可，无需代码迁移          |

#### 2.3 外移为插件

| 模块           | 评估                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **文件解析器** | ⚠️ 实际依赖关系需核实。`xlsx`/`mammoth`/`pdf-parse` 仅在 `packages/storage/src/system-knowledge-base.ts` 的**文档字符串**中提及，未在 `package.json` 中找到静态依赖。可能已经是运行时动态加载或仅作为工具描述 |
| **邮件通知**   | 同上，`nodemailer` 仅在文档字符串中出现                                                                                                                                                                       |
| **系统通知**   | `node-notifier` 也仅在文档字符串中出现                                                                                                                                                                        |

**修订建议**:

- 先运行 `pnpm why xlsx mammoth pdf-parse nodemailer node-notifier` 确认真实依赖关系，再决定是否外移。如果这些包当前并未被实际安装为依赖，则 "外移" 工作已经存在（只是需要清理文档中的引用）。

---

### 第三阶段: 补强 — 修复薄弱层

#### 3.1 S5 PolicyEngine: 从二元判断到加权仲裁

**方向**: ✅ 正确，是当前架构中优先级最高的补强项。

**问题与风险**:

| 问题                             | 详情                                                                                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡 **当前状态误读**              | 方案说 PolicyEngine "只做 yes/no 判断"，但实际已有 `arbitrate(s3Action, s4Insight)` 方法（第 95–116 行），虽然实现简单（仅检查 quality_first mission）。且 `evaluateAdjustment()` 已有 PolicyEngine 集成点（AutoAdjuster 第 72–74 行）。这不是 "从零建设"，而是 **"增强现有骨架"** |
| 🟡 **MissionProfile 的数据来源** | `costSensitivity`/`qualityThreshold`/`autonomyLevel`/`safetyStrictness` 需要 Captain 配置界面支持。当前 EntityMemory 中是否有结构化存储这些配置的位置？                                                                                                                            |

**修订建议**:

- 将工作重心从 "新增 arbitrate()" 改为 "丰富 evaluateAdjustment() 的策略规则 + 增强 arbitrate() 的加权算法"
- `MissionProfile` 的存储建议放在 `EntityMemory` 的 preferences 子结构中，但需确认 schema 兼容性
- 低 confidence 升级为 Captain 裁决的链路需要 UI/notification 层配合，需评估 secretary 包的支持度

---

#### 3.2 KnowledgeGraph: 正则实体提取 → 轻量 NER

**方向**: ✅ 正确。当前 `extractCandidateEntities()` 使用 `[A-Z][a-zA-Z]+` + CJK 匹配，质量确实低。

**问题与风险**:

| 问题                          | 详情                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡 **compromise.js 体积**     | compromise 约 200KB（minified），对桌面端（Tauri）可接受，对 server 端无影响                                                                                                                            |
| 🟡 **jieba 的 Node.js 支持**  | `nodejieba` 需要原生 C++ 编译，在跨平台（尤其是 Windows 桌面端）可能引入构建复杂度。可考虑 `@node-rs/jieba`（Rust 绑定，预编译二进制）或纯 JS 分词替代                                                  |
| 🟡 **Phase 2 LLM 验证的时机** | 方案说 Phase 2 走 Curator 队列（低优先级、异步）。但 `LongTermMemory.store()` 路径上的 `detectContradictions()` 需要**同步**获取实体列表来进行矛盾检测。如果实体还没被 LLM 验证，矛盾检测的质量仍然受限 |

**修订建议**:

- Phase 1 先落地（compromise + jieba），Phase 2 可延后
- 矛盾检测的 LLM Judge（3.4）和 NER 的 Phase 2 不要强耦合，可以先注入 Judge 用当前正则实体，再升级实体质量
- 评估 ` @node-rs/jieba` 替代 `nodejieba` 的可行性，避免引入 node-gyp 构建负担

---

#### 3.3 WriteGate: 正则启发式 → 正则 + Embedding 混合

**方向**: ✅ 合理。

**问题与风险**:

| 问题                          | 详情                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 **Embedding 基础设施缺失** | 当前项目中未找到统一的 embedding 服务调用点。`LongTermMemory` 和 `KnowledgeGraph` 使用 better-sqlite3，但 embedding 生成需要调用 LLM provider（如 OpenAI embedding API 或本地模型）。**这是新增基础设施**，不是纯逻辑改造 |
| 🟡 **锚点向量的维护成本**     | "从已知重要的记忆中提取的 centroid" 需要定期重新计算，且随着 LTM 增长，锚点集合的选择策略会影响准确率                                                                                                                     |
| 🟡 **多语言触发词扩展的收益** | 当前 WriteGate 的正则覆盖中英 + 少量西语（`recuerda esto`）。扩展日/法/德/韩/阿的触发词对 Cabinet 的目标用户群（主要中文 + 英文）收益有限，边际收益递减                                                                   |

**修订建议**:

- 将 embedding slow path 拆分为独立任务：**先建设 EmbeddingService**（封装 provider 调用、缓存、降维），再集成到 WriteGate
- 锚点向量建议采用 "最近 N 条 high-importance 记忆的滑动窗口 centroid"，而非全量 LTM
- 多语言触发词扩展优先级降低，先聚焦中英（覆盖 95%+ 场景）

---

#### 3.4 矛盾检测: 实际注入 LLM Judge

**方向**: ✅ 正确。`detectContradictions()` 的 `llmJudge` 参数确实定义了但从未被调用。

**问题与风险**:

| 问题                             | 详情                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡 **当前检测并非 "基本不工作"** | 当前代码基于图结构（查找 `contradicts` 关系和 depth=1 的间接冲突），对已知矛盾实体有效。方案说 "基本不工作" 过于悲观——它的问题是 **漏报**（无法发现新的矛盾对），而非 **完全失效** |
| 🟡 **LLM Judge 的成本**          | 方案说 "每次 store 最多触发 1–3 次 judge 调用"。但 `store()` 在活跃 session 中可能被频繁调用（工具执行结果、观察记录等）。即使使用 Haiku，高频调用仍会产生可观成本                 |
| 🟡 **注入点的耦合**              | 在 `LongTermMemory` 构造时通过 `setContradictionHandler` 注入，意味着所有调用方（ConsolidationService、Curator、可能的工具）都需要修改构造逻辑                                     |

**修订建议**:

- 将 LLM Judge 的触发条件增加前置过滤：**仅当实体相似度（或 embedding 距离）超过阈值时才调用 Judge**，减少无效调用
- 考虑将 Judge 调用改为**异步后置**（写入 LTM 后后台检测），而非同步阻塞 store() 路径
- 保留当前的图结构检测作为 fast path，LLM Judge 作为 slow path

---

#### 3.5 统一记忆接口: MemoryProvider ← → ToolDependencies

**方向**: ✅ 正确。`MemoryProvider`（5 方法）和 `ToolDependencies`（直接访问 STM/LTM/Entity/Project）确实分裂。

**问题与风险**:

| 问题                               | 详情                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 **getSTM()/getLTM() 破坏封装**  | 方案说 "允许内部子系统通过 getSTM()/getLTM() 直接访问——但不鼓励"。这是**门面模式的反模式**——如果内部系统需要直接访问底层，说明门面设计不完整，应该补充 facade 方法而非暴露底层实例 |
| 🟡 **ToolDependencies 的广泛使用** | `ToolDependencies` 被 `createCabinetTools()` 和 `registerCabinetTools()` 使用（packages/agent/src/tools/index.ts 第 184、1150 行），涉及所有 cabinet tool 的构造。改造影响面大     |

**修订建议**:

- **不要暴露 getSTM()/getLTM()**。而是将 Curator/AgentLoop 所需的底层操作抽象为 facade 方法（如 `queueConsolidation()`、`getRawStore()` 等）
- 分两步：(1) 新增 `MemoryFacade` 并实现所有转发逻辑；(2) 逐步迁移调用方，保留旧接口为 `@deprecated`
- 评估 `ToolDependencies` 中各字段的使用频率，优先迁移高频路径

---

### 第四阶段: 升级

第四阶段的方案总体方向合理，但存在共性风险:

| 风险                        | 详情                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡 **数据基础不足**         | 4.1 ContextMonitor 自适应阈值需要 `SessionMetricsRepo` 有足够历史数据。alpha 阶段数据量可能不足以支撑可靠的动态阈值学习                            |
| 🟡 **全新概念缺乏细节**     | 4.3 ProcessIdentityScore 是全新概念，方案中仅给出四个因子，未给出具体计算公式和阈值设定方法                                                        |
| 🟡 **MCP 完整协议的优先级** | 4.4 MCP 支持 SSE transport + resources + prompts。当前 Cabinet 的 MCP 使用场景（stdio + tools）是否足以支撑投入 1–2 周的升级？建议评估实际用户需求 |
| 🟢 **Agent Blackboard**     | 4.2 方向合理，EventBus 已存在，可复用。但 "snapshot() 注入 system prompt" 的实现需要谨慎处理 token 预算                                            |

**修订建议**:

- 第四阶段整体**降优先级**。在前三阶段完成并稳定后再启动
- 4.1 和 4.3 合并为 "自适应可观测性" 主题，共享 SessionMetricsRepo 数据
- 4.4 MCP 完整协议建议拆分为独立实验分支，不影响主线

---

## 四、遗漏的关键内容（需增补）

### 1. 测试策略（最高优先级增补）

方案完全未提及测试。如此大规模的重构（涉及 agent-loop、dispatcher、workflow、memory 等核心包）必须有测试保障:

- **增补**: 每个 1.x 子项的交付标准必须包含 "对应包的单元测试/集成测试全部通过"
- **增补**: AgentLoop 统一后，需要验证 streaming 和 non-streaming 路径的输出一致性（determinism 测试）
- **增补**: Dispatcher 的 DispatchGraph 改造后，需要覆盖 single/pipeline/parallel 三种模式的端到端测试

### 2. 回滚与兼容性策略

- **增补**: 定义每个阶段的 "最小可回滚单元"。例如 AgentLoop 改造不应影响 `AgentResult` 的接口结构，避免上游（server routes、CLI）大面积适配
- **增补**: 公共 API 的 `@deprecated` 周期。如 `MemoryProvider` 向 `MemoryFacade` 迁移时，旧接口需保留至少一个版本

### 3. 性能基线与回归测试

- **增补**: 在改造前记录关键路径的基准数据：
  - `AgentDispatcher.dispatch()` 的平均延迟（single/pipeline/parallel）
  - `AgentLoop.run()` vs `runStreaming()` 的 token 使用量和 step 数
  - `ConsolidationService.consolidateBasic()` 的吞吐量
- **增补**: 改造后对比基线，确保没有性能回归（尤其是 CascadeBuffer 删除后的 LLM 调用频率）

### 4. 第一阶段内部依赖排序

方案说 "每一阶段的产出是下一阶段的基础"，但第一阶段内部的 5 个子项也有依赖关系:

```
1.3 CLI Harness 基类提取 ←── 独立，可最早启动
1.2 Dispatcher DispatchGraph  ←── 依赖 AgentNode 抽象
1.1 AgentLoop 统一流式引擎  ←── 影响 AgentNode 的实现
1.4 Workflow 统一路径       ←── 依赖 1.2 的 AgentNode 和 1.1 的 AgentLoop
1.5 记忆管道统一             ←── 相对独立，但受 1.1 的 checkpoint 机制影响
```

**建议执行顺序**: 1.3 → 1.1 → 1.2 → 1.4 → 1.5

### 5. 包数量与代码行数目标的现实性

| 指标                           | 方案目标 | 现实评估                                                                                                                                                                                  |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package 数量 17 → 13           | -24%     | 实际可能 17 → 14（meeting 删、organize 并入 workflow、agent-sdk 标记 private，但 EL 可能暂不删）                                                                                          |
| 核心代码行数 ~52,000 → ~43,000 | -17%     | 当前未精确统计到 52k（590 个 ts 文件，但含测试）。删除 meeting(699)+organize(931)+MemoryOrchestrator(23)+CascadeBuffer(115) 仅 ~1,768 行，距 9,000 行差距大。更现实的目标是 **-5% ~ -8%** |

> **结论**: "~43,000 行"目标过于激进，且代码行数减少不应作为核心 KPI，**架构清晰度**才是。

---

## 五、修订后的路线图建议

```
Week 1–2  │ 预研与基线
          │ ├─ 建立性能基线（延迟、token 用量、step 数）
          │ ├─ 精确统计当前代码结构与依赖图
          │ ├─ 确认 GarbageCollector / 文件解析器依赖的真实状态
          │ └─ 设计 MemoryFacade 接口草案
          │
Week 3–4  │ 第一阶段-A: 低风险统一（CLI Harness + 削冗前置）
          │ ├─ 1.3 CLI Harness 提取 GenericCliRuntimeBase
          │ ├─ 删除 meeting 包（已 private，独立可删）
          │ ├─ 删除 MemoryOrchestrator
          │ └─ agent-sdk 标记 private: true
          │
Week 5–8  │ 第一阶段-B: 核心统一（AgentLoop + Dispatcher）
          │ ├─ 1.1 AgentLoop stream-first 改造（保留 run() API）
          │ ├─ 1.2 Dispatcher DispatchGraph 改造
          │ └─ 对应集成测试全覆盖
          │
Week 9–11 │ 第一阶段-C: Workflow 与记忆管道
          │ ├─ 1.4 Workflow 路径统一（保留 Dispatcher API 边界）
          │ ├─ EL 蓝图标记 deprecated（暂不删除，等 YAML 就绪）
          │ ├─ 1.5 记忆管道简化（CascadeBuffer 暂缓删除，先评估成本）
          │ └─ organize 包代码迁入 workflow
          │
Week 12–15│ 第三阶段: 补强
          │ ├─ 3.1 PolicyEngine 加权仲裁增强
          │ ├─ 3.2 KnowledgeGraph NER Phase 1（compromise + jieba）
          │ ├─ 3.4 矛盾检测 LLM Judge 注入（fast path 保留图检测）
          │ └─ 3.5 MemoryFacade 逐步迁移
          │
Week 16+  │ 第二阶段收尾 + 第四阶段实验
          │ ├─ 评估 CascadeBuffer 删除的可行性
          │ ├─ 3.3 WriteGate embedding slow path（需先建 EmbeddingService）
          │ ├─ 4.1 ContextMonitor 自适应阈值（数据积累后）
          │ └─ 4.2 Agent Blackboard 实验分支
```

**总工期**: 原方案 16 周，修订后建议 **18–20 周**（增加预研和测试时间）。

---

## 六、结论

这份优化方案展现了**清晰的架构视野和正确的优先级判断**（尤其是 AgentLoop 统一和 PolicyEngine 补强）。但它更像一份**方向性纲领**，而非可立即执行的工程计划。

**如果不修订直接执行**:

- 第一周的 CLI Harness 改造就会因 "30 行/文件" 的错误假设而排期崩溃
- CascadeBuffer 的删除可能在第三周引发 LTM 写入风暴和成本失控
- EL 蓝图的删除会导致 server 热加载路径断裂
- 缺少测试保障的重构会在第四周引发回归缺陷潮

**修订后的方案可以执行**。建议由架构负责人对方案进行一轮数据修正和依赖排序后，按 "预研 → 低风险统一 → 核心统一 → 补强 → 实验升级" 的节奏分阶段交付。
