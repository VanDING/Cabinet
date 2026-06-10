# Cabinet 系统 vs Agentic Design Patterns — 全面对照分析

> 基于 [Agentic Design Patterns](https://adp.xindoo.xyz/) 全书 21 章 + 7 附录，
> 逐章对照 Cabinet 当前实现，识别已有能力与待提升点。

---

## 第 1 章：提示词链 (Prompt Chaining)

**ADP 要点：** 将复杂任务分解为顺序子任务链，每步输出作为下一步输入。结构化输出（JSON）保证数据完整性。

**Cabinet 已有：**

- [dispatcher.ts](packages/agent/src/dispatcher.ts) — `executeDispatchGraph` 支持顺序角色链（sequential mode）
- [prompt-assembler.ts](packages/agent/src/prompt-assembler.ts) — 多模块 prompt 组装
- [organize-interactive-agent.ts](packages/agent/src/interactive/organize-interactive-agent.ts) — planning → deploy 两阶段流水线

**评估：✅ 充分实现**

**待提升：** 无重大缺口。可选增强：链步骤间自动 schema 验证（确保上一步 JSON 输出被下一步正确消费）。

---

## 第 2 章：路由 (Routing)

**ADP 要点：** 基于意图/嵌入/规则动态选择下游处理器。核心组件：分类器 + 条件分支。

**Cabinet 已有：**

- [secretary/intent-llm-router.ts](packages/secretary/src/intent-llm-router.ts) — LLM 驱动的意图路由
- [secretary/intent-pattern-matcher.ts](packages/secretary/src/intent-pattern-matcher.ts) — 规则兜底
- [gateway/model-router.ts](packages/gateway/src/model-router.ts) — 模型级路由（deep_think / fast_execute / default）
- [daemon/squad/squad-router.ts](packages/agent/src/daemon/squad/squad-router.ts) — Squad 内 Agent 路由

**评估：✅ 充分实现**

**待提升：**

1. **嵌入路由缺失** — 目前无基于语义相似度的路由（如将用户查询向量与各 Agent 能力描述做相似度匹配）。可作为低成本路由的补充（避免每次调用 LLM 做分类）。
2. **路由可观测性** — 路由决策应记录到 audit log，便于事后分析路由准确率。

---

## 第 3 章：并行化 (Parallelization)

**ADP 要点：** 无依赖子任务并发执行，减少总延迟。关键是识别可并行环节。

**Cabinet 已有：**

- [dispatcher.ts](packages/agent/src/dispatcher.ts) — `DispatchMode = 'parallel'`
- [dispatch-graph.ts](packages/agent/src/dispatch-graph.ts) — 并行分支编排
- 速率限制感知的并发控制（rateLimitTracker）

**评估：✅ 充分实现**

**待提升：**

1. **自动并行化检测** — 当前需手动指定 parallel mode。可增强为自动分析角色依赖关系，自动并行化无依赖步骤。
2. **并行结果去重/冲突解决** — 当多个并行 Agent 产出冲突结果时，当前仅简单合并，缺少冲突检测与裁决。

---

## 第 4 章：反思 (Reflection)

**ADP 要点：** 生产者-评审者模型。生成输出 → 评估 → 迭代优化。核心是反馈循环。

**Cabinet 已有：**

- [observer-pipeline.ts](packages/agent/src/observer-pipeline.ts) — Observer 管道
- [observers/safety.ts](packages/agent/src/observers/safety.ts) — SafetyCheckObserver
- [observers/process-identity-observer.ts](packages/agent/src/observers/process-identity-observer.ts) — PIS 自我评估打分
- [context-monitor.ts](packages/agent/src/context-monitor.ts) — 上下文健康度监控（smart→warning→critical→dumb）

**评估：⚠️ 部分实现 — 存在重要缺口**

**待提升：**

1. **缺少显式反思循环** — 当前 Observer 管道是"事后检查"而非"迭代优化"。没有"生成→评审→重写"的闭环。
2. **缺少独立 Critic Agent** — ADP 强调分离 Producer 和 Reviewer 角色以避免认知偏差。当前 PIS 是打分器而非 Critic。
3. **建议：** 实现 `ReflectionLoop` 包装器，对关键输出（代码、计划、决策）自动触发 critique→revise 循环，最多 N 次迭代。

---

## 第 5 章：工具使用 (Tool Use / Function Calling)

**ADP 要点：** 工具定义 → LLM 决策 → 函数调用生成 → 执行 → 结果返回。

**Cabinet 已有：**

- [tool-executor.ts](packages/agent/src/tool-executor.ts) — 完整的工具注册/执行/超时/错误分类
- [tool-pruner.ts](packages/agent/src/tool-pruner.ts) — 基于任务描述动态裁剪工具集
- [tools/](packages/agent/src/tools/) — 12+ 工具类别
- AI SDK 工具转换（`convertTools`）

**评估：✅ 充分实现**

**待提升：**

1. **工具结果结构化** — 当前 `summarizeToolResult` 仅做截断，可增强为自动提取关键信息并以结构化格式返回。
2. **工具使用分析** — 缺少工具调用成功率/延迟的聚合仪表盘。

---

## 第 6 章：规划 (Planning)

**ADP 要点：** 高层目标 → 自主分解为子步骤 → 动态调整计划。Google Deep Research 级别：迭代搜索→反思→完善。

**Cabinet 已有：**

- [organize-interactive-agent.ts](packages/agent/src/interactive/organize-interactive-agent.ts) — planning → review → deploy 三阶段
- Six-Step Method（Clarify, Design, Implementation Plan, Execute, Review）
- `present_for_review` 工具

**评估：⚠️ 基础实现 — 存在重要缺口**

**待提升：**

1. **无自主规划** — 当前规划需人工 approve，缺少全自主 planning→execution→replan 循环。
2. **无动态重规划** — 当执行步骤失败时，缺少"分析失败原因→调整后续计划"的能力。这与 Reflection（第 4 章）的缺口相关。
3. **无 Deep Research 风格** — 缺少"迭代搜索→发现知识缺口→补充搜索→综合"的研究能力。
4. **建议：** 增强 OrganizeInteractiveAgent 支持 `autonomous` 模式（跳过 review 阶段），配合 Reflection 循环实现自我修正。

---

## 第 7 章：多 Agent 协作 (Multi-Agent Collaboration)

**ADP 要点：** 顺序交接、并行处理、辩论共识、层次结构、专家团队、批评者-审查者。

**Cabinet 已有：**

- [dispatcher.ts](packages/agent/src/dispatcher.ts) — 多角色调度（sequential / parallel）
- [blackboard.ts](packages/agent/src/blackboard.ts) — 共享状态黑板（append/replace/merge 策略，TTL，容量限制）
- [blackboard-observer.ts](packages/agent/src/observers/blackboard-observer.ts) — 跨 Agent 状态同步
- [daemon/squad/](packages/agent/src/daemon/squad/) — Squad 系统（SquadLeader + SquadRouter）
- [agent-handoff.ts](packages/agent/src/agent-handoff.ts) — Agent 交接（上下文传递）
- [interactive-sub-agent.ts](packages/agent/src/interactive-sub-agent.ts) — 子 Agent 接口
- [adapters/a2a-connector.ts](packages/agent/src/adapters/a2a-connector.ts) — A2A 协议连接器

**评估：✅ 充分实现 — 这是系统最成熟的领域之一**

**待提升：**

1. **辩论/共识机制缺失** — 无 ADP 描述的"多 Agent 各自提出方案→辩论→投票→综合"模式。Blackboard 提供了基础设施但缺少编排层。
2. **Agent 发现机制弱** — SquadRouter 依赖硬编码路由规则，缺少基于能力描述的动态 Agent 发现。
3. **建议：** 实现 `DebateCoordinator` 包装器，利用 Blackboard 做观点交换，由仲裁 Agent 做最终综合。

---

## 第 8 章：记忆管理 (Memory Management)

**ADP 要点：** 短期记忆（上下文窗口）+ 长期记忆（向量库/知识图谱/数据库）。Session/State/Memory 三层模型。

**Cabinet 已有：**

- [memory/short-term.ts](packages/memory/src/short-term.ts) — 向量化短期记忆
- [memory/long-term.ts](packages/memory/src/long-term.ts) — SQLite + 知识图谱长期记忆
- [memory/knowledge-graph.ts](packages/memory/src/knowledge-graph.ts) — 实体-关系图谱
- [memory/consolidation.ts](packages/memory/src/consolidation.ts) — CascadeBuffer 记忆巩固
- [memory/memory-facade.ts](packages/memory/src/memory-facade.ts) — 统一 API
- [memory/project-isolation.ts](packages/memory/src/project-isolation.ts) — 项目隔离
- [memory/memory-decay.ts](packages/memory/src/memory-decay.ts) — 记忆衰减
- [session-manager.ts](packages/secretary/src/session-manager.ts) — Session 管理

**评估：✅ 充分实现 — 记忆系统架构完整**

**待提升：**

1. **缺少情节记忆 (Episodic Memory)** — 当前记忆存储事实和实体，但缺少"在什么情境下发生了什么"的时间线记录。
2. **记忆检索缺乏 RAG 式分块** — 没有文档分块 (chunking) 策略，检索粒度粗。
3. **建议：** Session 的事件历史天然是情节记忆的来源，增加自动摘要和时间线查询接口。

---

## 第 9 章：学习与适应 (Learning and Adaptation)

**ADP 要点：** 强化学习、监督学习、少样本学习、在线学习、基于记忆的学习。SICA 自我修改代码。AlphaEvolve 进化算法。

**Cabinet 已有：**

- [harness/preference-learner.ts](packages/harness/src/preference-learner.ts) — 偏好学习
- [harness/auto-adjuster.ts](packages/harness/src/auto-adjuster.ts) — 运行时参数自动调整
- [harness/subconscious-loop.ts](packages/harness/src/subconscious-loop.ts) — 后台学习循环

**评估：❌ 严重不足 — 这是系统最大的缺口之一**

**待提升：**

1. **无 RL/DPO** — 无强化学习或直接偏好优化机制。PreferenceLearner 仅记录偏好不做模型微调。
2. **无从错误中学习** — 工具调用失败、用户纠正等信息仅记录不分析，没有反馈到后续行为。
3. **无自我改进** — 不像 SICA 那样能修改自身行为策略。
4. **建议：**
   - 短期：从用户纠正和工具失败中提取模式，自动调整 prompt 策略
   - 中期：实现基于偏好数据的 few-shot 示例自动注入
   - 长期：RLVR 风格的奖励信号（任务成功/失败）驱动行为优化

---

## 第 10 章：模型上下文协议 (MCP)

**ADP 要点：** 客户端-服务器架构。资源/工具/提示的标准化暴露与发现。与 Function Calling 互补。

**Cabinet 已有：**

- [server/mcp/mcp-manager.ts](apps/server/src/mcp/mcp-manager.ts) — MCP 服务器连接管理
- MCPToolset 集成
- STDIO 和 HTTP 传输支持

**评估：✅ 基础实现充分**

**待提升：**

1. **动态工具发现** — 当前 MCP 工具在启动时加载，不支持运行时动态发现新服务器
2. **MCP 工具与内置工具的统一** — MCP 工具和内置 ToolExecutor 工具分属两套体系，增加 Agent 选择复杂度
3. **建议：** 将 MCP 工具自动注册到 ToolExecutor 的统一注册表中

---

## 第 11 章：目标设定与监控 (Goal Setting and Monitoring)

**ADP 要点：** 为智能体设定具体目标 + 进度跟踪 + 成功判定。迭代生成→评估→完善直到目标满足。

**Cabinet 已有：**

- [context-monitor.ts](packages/agent/src/context-monitor.ts) — 上下文利用率和健康度追踪
- [observers/step-event-observer.ts](packages/agent/src/observers/step-event-observer.ts) — 步骤事件记录
- [harness/progress-tracker.ts](packages/harness/src/progress-tracker.ts) — 任务进度追踪
- [harness/quality-gate.ts](packages/harness/src/quality-gate.ts) — 质量门禁

**评估：⚠️ 部分实现**

**待提升：**

1. **无显式目标达成判定** — 没有"这个任务做完了吗？做到什么程度？"的自动化判定。ADP 示例用 LLM 判断 `goals_met` 返回 True/False。
2. **目标分解不自动** — 高层目标到子目标的分解依赖 prompt 工程，无结构化跟踪。
3. **建议：** 实现 `GoalTracker`，在任务开始时提取可验证的子目标列表，每步执行后自动检查完成度。

---

## 第 12 章：异常处理与恢复 (Exception Handling and Recovery)

**ADP 要点：** 错误检测 → 错误处理（日志/重试/回退/降级/通知）→ 恢复（状态回滚/诊断/自我纠正/升级）。

**Cabinet 已有：**

- [gateway/fallback.ts](packages/gateway/src/fallback.ts) — 模型级 fallback 链（指数退避重试）
- [agent/safety.ts](packages/agent/src/safety.ts) — 分级安全阻断
- [agent/retry.ts](packages/agent/src/retry.ts) — 重试逻辑
- [agent/tool-executor.ts](packages/agent/src/tool-executor.ts) — 工具错误分类（timeout/permission/not_found/invalid_input/internal/network）
- [agent/checkpoint.ts](packages/agent/src/checkpoint.ts) — 状态检查点
- [events/dead-letter.ts](packages/events/src/dead-letter.ts) — 死信队列

**评估：✅ 较充分实现**

**待提升：**

1. **工具级 fallback** — 当工具调用失败时，缺少自动尝试替代工具的能力（如 grep 失败→自动尝试 glob+read）。
2. **自我纠正与 Reflection 联动** — 错误发生后缺少自动分析→调整策略→重试的闭环（需配合第 4 章 Reflection）。
3. **建议：** 在 ToolExecutor 中增加 `fallbackTools` 映射，定义工具间的替代关系。

---

## 第 13 章：人机协同 (Human-in-the-Loop)

**ADP 要点：** 人类监督/干预/反馈/决策增强/升级策略。核心：在自动化和人工判断间取得平衡。

**Cabinet 已有：**

- [organize-interactive-agent.ts](packages/agent/src/interactive/organize-interactive-agent.ts) — review 阶段需人工 approve
- [decision/decision-service.ts](packages/decision/src/decision-service.ts) — approve/reject 流程
- [types/DelegationTier](packages/types/) — 委托层级（哪些决策可自动，哪些需人工）
- [decision/escalation.ts](packages/decision/src/escalation.ts) — 升级服务
- `present_for_review` 工具
- `detectTrustLevelOverride` — 自然语言信任级别覆盖

**评估：✅ 充分实现**

**待提升：**

1. **人类反馈闭环弱** — 人工 approve/reject 后缺少"为什么"的反馈收集，无法驱动后续行为优化。
2. **人在循环外 (Human-on-the-loop)** — ADP 描述的变体（人设策略、AI 执行）尚未实现。
3. **建议：** reject 时要求提供原因，将原因反馈给 Planning agent 用于重规划。

---

## 第 14 章：知识检索 RAG (Knowledge Retrieval)

**ADP 要点：** 嵌入→分块→向量库→语义搜索→增强生成。GraphRAG。Agentic RAG（反思源验证、协调冲突、多步推理）。

**Cabinet 已有：**

- [memory/short-term.ts](packages/memory/src/short-term.ts) — 向量化存储
- [memory/knowledge-graph.ts](packages/memory/src/knowledge-graph.ts) — 知识图谱
- [agent/embedding-service.ts](packages/agent/src/embedding-service.ts) — 嵌入服务

**评估：❌ 严重不足 — 这是系统第二大缺口**

**待提升：**

1. **无文档分块 (Chunking)** — 缺少文档→chunk→embedding→retrieve 的完整 RAG 流水线。
2. **无混合搜索** — 没有 BM25 + 语义搜索的混合检索。
3. **无 Agentic RAG** — 没有源验证、冲突协调、多步推理检索。
4. **GraphRAG 基础设施存在但未充分利用** — KnowledgeGraph 已建表但缺少自动化知识抽取和查询。
5. **建议：**
   - 短期：实现文档分块 + 向量索引
   - 中期：集成 BM25 + embedding 混合检索
   - 长期：实现 Agentic RAG（检索→评估→补充检索→综合）

---

## 第 15 章：Agent 间通信 A2A (Inter-Agent Communication)

**ADP 要点：** Agent Card、发现机制、任务/消息/工件、同步/异步/流式/推送四种交互模式。与 MCP 互补。

**Cabinet 已有：**

- [adapters/a2a-connector.ts](packages/agent/src/adapters/a2a-connector.ts) — A2A 协议连接器
- [agent-sdk/a2a-helper.ts](packages/agent-sdk/src/a2a-helper.ts) — A2A 辅助工具
- [agent-sdk/slot-client.ts](packages/agent-sdk/src/slot-client.ts) — 客户端 SDK
- Agent Card 支持

**评估：✅ 基础实现充分**

**待提升：**

1. **Agent 发现机制** — 缺少 `.well-known/agent.json` 自动发现和注册表查询
2. **推送通知** — 仅支持同步和流式，缺少 webhook 推送
3. **建议：** 实现 Agent 注册表和自动发现

---

## 第 16 章：资源感知优化 (Resource-Aware Optimization)

**ADP 要点：** 动态选择模型（成本/能力权衡）、延迟优化、服务可靠性回退。

**Cabinet 已有：**

- [gateway/budget-guard.ts](packages/gateway/src/budget-guard.ts) — 日/周/月预算控制 + 降级提示
- [gateway/cost-tracker.ts](packages/gateway/src/cost-tracker.ts) — 成本追踪
- [gateway/model-router.ts](packages/gateway/src/model-router.ts) — 分层模型路由（deep_think→fast_execute→default）
- [gateway/fallback.ts](packages/gateway/src/fallback.ts) — 模型 fallback 链
- [agent/tool-pruner.ts](packages/agent/src/tool-pruner.ts) — 工具裁剪减少 token
- [agent/context-monitor.ts](packages/agent/src/context-monitor.ts) — 上下文预算管理

**评估：✅ 充分实现**

**待提升：**

1. **无动态模型选择** — ADP 描述根据查询复杂度自动选择便宜/贵模型。当前路由是静态角色映射，不感知查询内容。
2. **无延迟 SLA 追踪** — 缺少"此任务必须在 X 秒内完成"的约束感知。
3. **建议：** 在 ModelRouter 中增加查询复杂度分类器，简单查询自动路由到 haiku/flash。

---

## 第 17 章：推理技术 (Reasoning Techniques)

**ADP 要点：** CoT、ToT、自我纠正、PALM、RLVR、ReAct、CoD、GoD、MASS。推理扩展定律。

**Cabinet 已有：**

- CoT 通过系统提示词隐式支持
- ReAct 通过 tool use 循环隐式支持
- 自我纠正通过 PIS observer 部分支持

**评估：❌ 严重不足**

**待提升：**

1. **无 Tree-of-Thought** — 缺少多路径探索+回溯机制
2. **无辩论机制 (CoD/GoD)** — 缺少多 Agent 辩论达成更优结论
3. **无 PALM** — 虽然 coding agent 可执行代码，但缺少"LLM 生成代码→执行→结果返回 LLM"的结构化集成
4. **无推理预算控制** — 不能根据问题复杂度动态分配"思考步数"
5. **建议：**
   - 短期：对复杂问题自动触发 multi-sample + self-consistency
   - 中期：实现 ToT（分支探索 + 回溯）
   - 长期：接入专门的推理模型（如 o3/o4-mini）

---

## 第 18 章：Guardrails / 安全模式 (Guardrails/Safety Patterns)

**ADP 要点：** 输入验证/过滤 → 输出过滤/后处理 → 行为约束 → 工具限制 → 外部审核 → 人工监督。多层防御。

**Cabinet 已有：**

- [agent/safety.ts](packages/agent/src/safety.ts) — SafetyChecker + DelegationTier
- [observers/safety.ts](packages/agent/src/observers/safety.ts) — SafetyCheckObserver
- 工具执行阻断
- 委托层级访问控制

**评估：⚠️ 部分实现 — 缺少关键的输入/输出防护**

**待提升：**

1. **无输入内容过滤** — 没有对用户输入的越狱/恶意注入检测。ADP 示例用了完整的 PolicyEvaluation Pydantic 模型。
2. **无输出内容过滤** — 生成内容不经安全审查直接返回用户。
3. **无偏见/毒性检测** — 缺少对有害输出的自动检测。
4. **建议：**
   - 短期：集成轻量级分类器做输入安全检查（越狱/注入检测）
   - 中期：增加输出内容过滤层
   - 长期：参考 CrewAI 示例实现完整的多层 Guardrails

---

## 第 19 章：评估与监控 (Evaluation and Monitoring)

**ADP 要点：** 响应准确性、延迟、token 使用、LLM-as-Judge、轨迹评估、A/B 测试、漂移检测、异常检测。

**Cabinet 已有：**

- [observer-pipeline.ts](packages/agent/src/observer-pipeline.ts) — 完整的 Observer 生命周期
- [observers/step-event-observer.ts](packages/agent/src/observers/step-event-observer.ts) — 步骤级事件追踪
- [context-monitor.ts](packages/agent/src/context-monitor.ts) — 上下文资源监控
- [harness/observability.ts](packages/harness/src/observability.ts) — 可观测性面板
- [harness/evaluator.ts](packages/harness/src/evaluator.ts) — 评估器
- [harness/harness-analyst.ts](packages/harness/src/harness-analyst.ts) — 质量分析
- `AgentExecutionContext` 中 token 计数

**评估：⚠️ 部分实现 — 缺少关键评估方法**

**待提升：**

1. **无 LLM-as-Judge** — 缺少用 LLM 评估输出质量的自动化机制（有用性、准确性、安全性评分）。
2. **无轨迹评估** — 缺少对比"实际步骤序列"与"理想步骤序列"的能力。
3. **无 A/B 测试框架** — 无法系统对比两个 Agent 版本。
4. **无漂移检测** — 不监控输出分布是否随时间退化。
5. **建议：**
   - 短期：实现 LLM-as-Judge 对关键输出做自动评分
   - 中期：增加轨迹对比评估（实际 vs 预期步骤序列）
   - 长期：建立 A/B 测试和漂移检测流水线

---

## 第 20 章：优先级排序 (Prioritization)

**ADP 要点：** 标准定义 → 任务评估 → 调度选择 → 动态重排。紧急性/重要性/依赖关系/资源/成本收益。

**Cabinet 已有：**

- [decision/decision-service.ts](packages/decision/src/decision-service.ts) — 决策创建+审批+级别分类
- [decision/policy-engine.ts](packages/decision/src/policy-engine.ts) — 策略引擎
- [decision/level-classifier.ts](packages/decision/src/level-classifier.ts) — 级别分类器
- DelegationTier 系统

**评估：⚠️ 部分实现 — 缺少 Agent 内部任务优先级**

**待提升：**

1. **无 Agent 内部多任务排序** — 当 Agent 同时面临多个子任务时，缺少动态优先级评估和排序。
2. **无紧急度自动感知** — 不根据 deadline/依赖关系/用户情绪自动调高优先级。
3. **建议：** 实现 `TaskPrioritizer` 在 dispatch 前对子任务做紧急度/重要性评分排序。

---

## 第 21 章：探索与发现 (Exploration and Discovery)

**ADP 要点：** 主动信息搜寻、假设生成、实验设计。Google Co-Scientist。Agent Laboratory。

**Cabinet 已有：** 无

**评估：❌ 完全缺失**

**待提升：**

1. **无假设生成** — 不能主动提出"可能是 X 导致 Y"的假设
2. **无实验设计** — 不能自主设计验证实验
3. **无探索/利用平衡** — 总是选最确定路径，不探索替代方案
4. **建议：** 这不是当前系统优先级最高的能力。如需要，可参考 Agent Laboratory 的架构（Professor→Postdoc→Reviewer 层次化 Agent 团队）。

---

## 附录对照

### 附录 A：高级提示技术

**状态：** 零样本/少样本通过系统提示词支持，但缺少结构化的 prompt 版本管理和 A/B 测试。

### 附录 B：AI Agentic 交互（GUI → 真实世界）

**状态：** 有 BrowserPool 做浏览器自动化。缺少视觉 GUI 理解（像 Anthropic Computer Use）。真实世界交互未覆盖。

### 附录 C：Agentic 框架概览

**状态：** 系统自研框架，涵盖了 LangChain/LangGraph（StateGraph）、CrewAI（角色化 Agent）、ADK（SequentialAgent/ParallelAgent）的核心概念。设计合理。

### 附录 D：AgentSpace

**状态：** 不适用 — AgentSpace 是 Google Cloud 产品。

### 附录 E：CLI 中的 AI Agent

**状态：** [apps/cli/](apps/cli/) 有基础 CLI。功能远不如 Claude Code/Gemini CLI/Aider 成熟。

### 附录 F：推理引擎内部机制

**状态：** 不适用 — 这是模型内部机制，非系统设计层面。

### 附录 G：编码 Agent

**状态：** 有代码生成/审查能力，但缺少 ADP 描述的完整"人类主导的智能体团队"框架（脚手架/测试/文档/优化/审查 Agent 各司其职）。

---

## 总结：能力矩阵

| 模式             | 评级    | 关键缺口                             |
| ---------------- | ------- | ------------------------------------ |
| 1. 提示词链      | ✅ 充分 | —                                    |
| 2. 路由          | ✅ 充分 | 嵌入路由、路由审计                   |
| 3. 并行化        | ✅ 充分 | 自动并行检测、冲突解决               |
| 4. 反思          | ⚠️ 部分 | **缺少显式反思循环和 Critic Agent**  |
| 5. 工具使用      | ✅ 充分 | 工具结果结构化                       |
| 6. 规划          | ⚠️ 部分 | **无自主重规划、无 Deep Research**   |
| 7. 多 Agent 协作 | ✅ 充分 | 辩论/共识机制                        |
| 8. 记忆管理      | ✅ 充分 | 情节记忆、RAG 分块                   |
| 9. 学习与适应    | ❌ 不足 | **无 RL/DPO、无从错误学习**          |
| 10. MCP          | ✅ 基础 | 动态发现、工具统一                   |
| 11. 目标设定监控 | ⚠️ 部分 | 无自动目标达成判定                   |
| 12. 异常处理恢复 | ✅ 充分 | 工具级 fallback                      |
| 13. 人机协同     | ✅ 充分 | 反馈闭环                             |
| 14. RAG          | ❌ 不足 | **无完整 RAG 流水线**                |
| 15. A2A          | ✅ 基础 | 发现机制、推送通知                   |
| 16. 资源优化     | ✅ 充分 | 动态模型选择                         |
| 17. 推理技术     | ❌ 不足 | **无 ToT/辩论/推理预算**             |
| 18. Guardrails   | ⚠️ 部分 | **无输入/输出内容过滤**              |
| 19. 评估监控     | ⚠️ 部分 | **无 LLM-as-Judge/轨迹评估/A/B测试** |
| 20. 优先级排序   | ⚠️ 部分 | 无 Agent 内部任务排序                |
| 21. 探索发现     | ❌ 缺失 | 假设生成/实验设计                    |

## 优先改进建议（按影响力排序）

### 🔴 P0 — 立即影响系统可靠性

1. **Reflection 循环（第 4 章）** — 对关键输出（代码/计划/决策）增加 critique→revise 闭环
2. **输入/输出 Guardrails（第 18 章）** — 防越狱注入 + 输出内容过滤
3. **LLM-as-Judge 评估（第 19 章）** — 自动化输出质量评分

### 🟡 P1 — 显著提升系统能力

4. **完整 RAG 流水线（第 14 章）** — 文档分块 + 混合检索
5. **自主重规划（第 6 章）** — 失败后自动分析→调整计划
6. **推理增强（第 17 章）** — ToT + self-consistency + 推理模型接入
7. **学习闭环（第 9 章）** — 从工具失败和用户纠正中学习

### 🟢 P2 — 锦上添花

8. 动态模型选择（第 16 章）
9. 任务优先级排序（第 20 章）
10. 轨迹评估 + A/B 测试（第 19 章）
11. 辩论/共识机制（第 7 章）
12. Agent 发现机制（第 15 章）
