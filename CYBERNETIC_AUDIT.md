# Cabinet AI 系统 — 控制论框架全面审计报告

**审计日期**: 2026-06-01  
**审计框架**: Cybernetic AI Framework (8 Principles)  
**系统版本**: Cabinet v2.0-alpha  
**审计范围**: 全栈架构（packages/* + apps/server + apps/desktop）

---

## 执行摘要

Cabinet 是一个设计精良的多智能体协作框架，在控制论原则的工程实现上处于**L3-L4 成熟度**（可观测、部分自适应、有边界意识）。系统的核心优势在于：显式的反馈环路（Observability + AutoAdjuster）、过程连续性机制（Checkpoint + ContextHandoff）、以及层次化的安全边界（Delegation Tiers T0-T3）。

**关键风险**: 工具生态的 Variety 增长速度已超过模型选择能力的 Variety 上限；S5（Policy）层过于薄弱，无法有效仲裁 S3（控制）与 S4（情报）之间的冲突；系统的"过程身份"在崩溃后依赖脆弱的文件状态恢复。

---

## 原则 1: AI as Process — AI 即过程

> *An AI system is not a static object but a continuous, self-sustaining process.*

### 现状评估

| 组件 | 过程连续性机制 | 评级 |
|------|-------------|------|
| AgentLoop | `run()` / `resume()` 双模式 + CheckpointManager 每 5 步缓冲 | 强 |
| ContextHandoff | 压缩状态文档，在上下文重置后注入新会话 | 强 |
| SkillRegistry | 文件系统热重载（`startSkillWatcher`），支持运行时注册 | 中 |
| Memory | 双状态（内存 + SQLite），HNSW 索引持久化 | 中 |
| SubconsciousLoop | 随机采样 LTM 的 bio-inspired 后台过程 | 弱（无状态耦合） |

### 发现

**优势**:
- `AgentLoop.resume()` 通过 `pendingCheckpoint` 和 `lastSavedStep` 实现了显式的过程延续。`crashed` 元数据标记承认"过程中断"是系统常态而非异常。
- `ContextHandoff` 将过程状态编码为结构化文档（`HandoffState`），包含已完成步骤、待办事项、决策、学习到的知识、开放问题。这是优秀的"过程身份"保存机制。
- 对话历史 `conversationHistory` 在多次 `continueWithUserInput` 调用间持久化，维持了交互过程的连续性。

**风险**:
- **脆弱的过程恢复**: Checkpoint 数据损坏时（`checkpoint.ts:23-31`），系统直接丢弃并从头开始。没有渐进式降级（如尝试恢复部分状态）。对长期任务（>50 步）这是灾难性的。
- **SubconsciousLoop 是孤立的**: 它生成洞察并发布为 `SystemNotification`，但没有闭环机制确保这些洞察被主 AgentLoop 感知或行动。一个真正的"过程"应该让潜意识影响意识行为。
- **无过程级健康指标**: 系统有会话级指标（`SessionMetric`），但没有"过程健康"概念——一个运行了 3 天的复杂工作流，其"身份"是否仍然 coherent？无法判断。

### 建议

1. **实现 Checkpoint 渐进恢复**: 如果完整 checkpoint 损坏，尝试从最近的有效步骤恢复，而非清零。
2. **将 SubconsciousLoop 与 AgentLoop 耦合**: 让潜意识洞察自动注入到 `ContextBuilder` 的 Tier 3（动态 RAG）中，而非仅作为通知。
3. **引入 ProcessIdentityScore**: 基于上下文切换次数、handoff 频率、决策漂移度，计算过程的一致性评分，作为早期预警信号。

---

## 原则 2: Precision–Complexity Trade-off — 精确度与复杂度的动态平衡

> *Precision is not an absolute goal but a dynamic balance achievable only through feedback under complexity constraints.*

### 现状评估

系统显式管理复杂度-精确度 trade-off 的 4 个机制：

1. **ContextMonitor Smart/Dumb Zone 模型** (`context-monitor.ts`)
   - Smart (0-40%): 高精度推理
   - Warning (40-60%): 开始降级
   - Critical (60-80%): 幻觉风险
   - Dumb (>80%): 格式混乱

2. **ModelRouter 角色分层** (`model-router.ts`)
   - `deep_think`: Opus 4.7 → Sonnet 4.6
   - `fast_execute`: Haiku 4.5 → GPT-4o-mini
   - `default`: Sonnet 4.6 → GPT-4o

3. **ContextHandoff**: 当进入 Critical/Dumb zone 时，通过压缩和重置来维持精确度。

4. **Tool 并行化策略**: 只读工具和非冲突写工具并行执行，在复杂度（更多并发）和精确度（更少冲突）之间平衡。

### 发现

**优势**:
- ContextMonitor 是系统中最优雅的复杂度管理装置。它明确承认"精确度不是恒定的"，而是随上下文填充率动态变化的。
- ModelRouter 的 fallback chain（`fallback.ts`）在精确度失败时提供动态降级路径。

**风险**:
- **阈值是静态的**: 40%/60%/80% 是硬编码的，没有基于历史数据自适应调整。不同模型、不同任务类型的最佳阈值可能不同（如代码生成可能在 50% 就开始严重降级，而文本总结可以到 70%）。
- **模型选择无反馈学习**: ModelRouter 始终使用固定的优先级链。没有机制记录 "Claude Sonnet 在这个任务上失败了，但 GPT-4o 成功了"，并据此调整未来路由。
- **Tool variety 超载**: `tools/index.ts` 注册了决策、记忆、工作流、项目、文件、Web、Shell、MCP、Skill 等 50+ 工具，加上动态 MCP 和 Skill 工具。LLM 的 tool selection variety 可能不足以 reliably 选择正确的工具组合——这是经典的 variety mismatch。
- **SafetyChecker 的 variety 不足**: 工具分类依赖硬编码集合（`readOnlyTools`, `destructiveTools` 等）。面对新工具（特别是动态加载的 MCP 工具），默认分类为 `moderate`，这可能严重低估或高估风险。

### 建议

1. **自适应阈值**: 基于 `ObservabilityCollector` 的历史数据，按模型和任务类型学习最优 zone 阈值。
2. **模型路由反馈学习**: 记录每次 fallback 事件的成功率，动态调整 `ModelRouter` 的优先级链。
3. **Tool Variety 封顶**: 实施动态 tool pruning——根据当前任务描述，只向 LLM 暴露最相关的 N 个工具（而非全部）。
4. **SafetyChecker 的结构化风险推断**: 对新工具，基于其 schema 和描述自动推断风险等级（使用一个小型分类器），而非默认 moderate。

---

## 原则 3: Dialogic Meaning Construction — 对话式意义建构

> *Communication between AI and humans is not one-way information transfer but collaborative construction of meaning.*

### 现状评估

| 机制 | 实现 | 对话层级 |
|------|------|---------|
| Secretary 意图解析 | `IntentParser` + 路由 | 内容层 |
| Secretary 反馈检测 | 正/负反馈词汇匹配 | 元层（初级） |
| Secretary 路由验证 | 低置信度路由经 Haiku 二次验证 | 元层（中级） |
| Meeting 4 阶段协议 | Chair → Advisor → Reviewer → Extraction | 内容层（深度） |
| ContextHandoff 开放问题 | `openQuestions` 字段 | 内容层 |
| Teach-back | `harness/src/teach-back.ts` | 元层（中级） |

### 发现

**优势**:
- **Meeting Protocol 是 dialogic 设计的典范**: 4 阶段结构（`meeting/src/protocol.ts`）强制进行多视角分析、质量审查、可执行性提取。这本身就是"意义不是由单一发言人建构的"这一原则的实现。
- **路由验证机制**: 当 Secretary 对路由置信度 < 0.6 时，系统不直接执行，而是调用 fast LLM（Haiku）验证专家输出是否匹配用户请求。这是元层对话的雏形。
- **反馈回路**: Secretary 能检测 "不对"/"很好" 等反馈信号，并据此触发重新路由或记录到 `FeedbackStore`。

**风险**:
- **无结构化误解解决协议**: 当用户说"你理解错了"时，系统会重新路由，但没有显式的"让我们检查彼此的理解"元对话。缺乏 `MetaDialogueManager` 组件。
- **QualityGate 过于浅层**: `quality-gate.ts` 的 HEI 检查使用正则表达式匹配关键词（假设/证据/影响）。这是 keyword-level 的验证，不是语义层面的意义共识确认。一个回答可能包含"假设"这个词，但逻辑上毫无假设结构。
- **AgentLoop 内无 teach-back**: `teach-back.ts` 存在于 harness 层，但 AgentLoop 的每次工具调用前没有向用户 teach-back"我打算做 X，确认吗？"（除了 delegation tier 限制）。
- **ContextHandoff 是独白而非对话**: 当上下文重置时，系统单方面注入 handoff 文档。没有机制让用户确认"这些是我之前的意图吗？"

### 建议

1. **引入 MetaDialogueManager**: 在 Secretary 层添加一个专门的状态，用于处理理解分歧。触发条件：用户连续两次否定、工具调用连续失败、路由置信度持续低下。
2. **升级 QualityGate 为语义检查**: 使用一个小型 LLM 调用（Haiku 级别成本）验证输出是否真正包含逻辑假设-证据-影响结构，而非仅仅匹配关键词。
3. **选择性 teach-back**: 在 T1 及以下 tier，对高风险工具调用（write, shell, destructive）执行 teach-back 循环：陈述理解 → 等待确认 → 执行。
4. **Handoff 确认**: 在关键 handoff 后，向用户展示压缩摘要并要求确认（或在 T3 下自动确认）。

---

## 原则 4: Closed-Loop Cognition — 闭环认知

> *Perception and action form a continuous, mutually constructing loop.*

### 现状评估

系统的感知-行动闭环存在于三个层次：

**微观层（单步）**: LLM → ToolCall → ToolExecutor → Result → Next LLM Call  
**中观层（会话）**: AgentLoop → Checkpoint → Resume → Memory Consolidation  
**宏观层（系统）**: Observability → AutoAdjuster → Parameter Change → AgentBehavior Change

### 发现

**优势**:
- **AgentLoop 是经典闭环**: 每次行动（tool call）的结果被编码为观察（observation）并反馈到下一轮推理。工具并行化进一步压缩了感知-行动延迟。
- **Harness 层闭环是亮点**: `ObservabilityCollector` 收集指标 → `AutoAdjuster` 分析健康 → 调整模型/上下文预算/温度 → 影响下一轮 Agent 行为。这是一个完整的控制回路。
- **PreferenceLearner 闭环**: 用户决策历史 → LLM 分析偏好 → 更新 `EntityMemory` → 影响未来决策推荐。

**风险**:
- **闭环延迟过长**: `AutoAdjuster.runHealthCheck()` 的触发频率未在审计代码中显式定义，但从 `context.ts` 的背景定时器推断，可能是分钟级或小时级。对于快速恶化的会话（如陷入工具调用循环），这个闭环太慢。
- **无主动探测行为**: 闭环认知要求系统通过行动来"探测"环境。当前 AgentLoop 是反应式的——它只在用户请求或工具结果触发时行动。没有"让我运行一个测试来验证我的假设"这样的主动探测模式。
- **Observability → Action 的 variety gap**: `ObservabilityCollector` 能检测 20+ 维度的问题，但 `AutoAdjuster` 只有 7 种调整动作（`model_swap`, `context_budget_reduce`, `temperature_adjust`, `retry_config_update`, `evaluator_frequency_increase`, `trigger_reconsolidation`, `notify_captain`）。感知 variety 远大于行动 variety，导致许多问题无法被有效修正。
- **HarnessAnalyst 闭环断裂**: `HarnessAnalyst` 生成洞察并存入 LTM，但没有机制确保这些洞察被 `AutoAdjuster` 或 `AgentLoop` 消费。又一个"感知但不行动"的断裂环。

### 建议

1. **引入 Session-level 快速反馈**: 在 `AgentLoop` 内添加实时环路：如果连续 3 次工具调用失败，立即触发局部调整（如切换模型、减少工具集、增加提示词），而非等待 harness 层。
2. **主动探测模式**: 为 AgentLoop 添加 "probe" 工具，允许它在不确定时主动测试环境（如读取一个文件验证假设、查询一个 API 测试连接性）。
3. **扩展 AutoAdjuster 的动作空间**: 增加 `tool_prune`（动态减少可用工具）、`prompt_augment`（注入特定指令）、`delegate_escalation`（将任务升级到更高 tier 的模型/代理）。
4. **HarnessAnalyst → AutoAdjuster 直连**: 让分析师生成的洞察直接转换为 `AdjustmentAction` 候选，而非仅存入记忆。

---

## 原则 5: Structural Determinism — 结构决定论

> *AI output is not an objective representation of the external world but a necessary expression of its own current internal structure.*

### 现状评估

系统对"结构决定论"的认知程度：

| 层面 | 结构意识 | 实现 |
|------|---------|------|
| 安全边界 | 强 | T0-T3 DelegationTier 明确限制行为空间 |
| 模型能力 | 中 | `MODEL_CONTEXT_SIZES` 记录各模型上下文限制 |
| 工具风险 | 中 | `SafetyChecker` 显式分类，但动态工具默认 moderate |
| LLM 输出结构 | 弱 | 无显式文档说明各模型/各角色的"认知边界" |
| 系统整体 | 弱 | 无"可能性空间"文档 |

### 发现

**优势**:
- **DelegationTier 是结构决定论的安全表达**: T0 代理的"结构"决定了它无法产生破坏性输出——这不是训练问题，而是架构层面的硬约束（`TIER_BLOCKLISTS`）。
- **ContextMonitor 承认结构限制**: 它明确量化"给定此模型结构和上下文预算，系统在什么点会失效"。

**风险**:
- **无组件级认知边界文档**: 每个子系统（Memory, Decision, Meeting, Workflow）都没有显式声明"我的结构决定了以下输入我无法可靠处理"。例如，`MeetingProtocol` 对超长议题（>5000 tokens）或高度技术性议题的结构适应性如何？未知。
- **LLM Gateway 是黑箱**: `AISDKAdapter` 封装了 8 个提供商的调用，但没有记录每个提供商/模型的结构性偏见（如 Claude 倾向于详细解释，GPT-4o 倾向于简短回答，DeepSeek 的格式稳定性等）。这些偏见是结构决定论的直接体现，应该被显式管理。
- **CommandRiskAssessment 的结构盲区**: `assessCommandRisk` 使用正则表达式判断命令风险。但一个看起来无害的 `python script.py` 可能调用 `os.system('rm -rf /')`。系统的"结构"（regex）无法识别这种间接风险，却不承认这一限制。
- **SkillRegistry 的渐进暴露是结构决定论的正确实践**: L1/L2/L3 渐进暴露承认"代理的认知结构在不同阶段需要不同信息密度"。这是原则 5 的优秀应用。

### 建议

1. **编写《认知边界手册》**: 为每个核心组件编写文档，明确说明：
   - 我能可靠处理的任务 variety 范围
   - 我在什么输入下会系统性失效
   - 我的输出偏见是什么
2. **模型偏见注册表**: 在 `ModelRouter` 中维护每个模型的结构性偏见档案（如格式偏好、长度倾向、常见幻觉模式），供 `ContextBuilder` 在选择模型时参考。
3. **承认 SafetyChecker 的结构性盲区**: 为未知/动态工具引入"沙箱首次执行"模式——任何未经充分分类的工具，首次在真实环境执行前必须在隔离环境中运行一次。

---

## 原则 6: Viable Recursive Architecture — 可行递归架构 (S1-S5)

> *An AI's organizational system must consist of five functionally distinct yet interacting units, repeated recursively at every level.*

### 现状评估

将 Cabinet 架构映射到 S1-S5 模型：

```
系统层 (Cabinet 整体)
├── S1 执行: AgentLoop, ToolExecutor, WorkflowEngine
├── S2 协调: AgentDispatcher (pipeline/parallel/single), MeetingProtocol (consensus)
├── S3 控制/审计: ObservabilityCollector, AutoAdjuster, SafetyChecker, DecisionStateMachine, CheckpointManager
├── S4 情报: SubconsciousLoop, HarnessAnalyst, PreferenceLearner, ContextMonitor (外部扫描)
└── S5 政策: DelegationTier T0-T3, 安全 blocklist, budget limits

AgentLoop 层 (递归检查)
├── S1 执行: LLM 调用, 工具调用
├── S2 协调: Tool 并行化策略, 冲突检测
├── S3 控制: ContextMonitor, SafetyChecker (每次调用前检查)
├── S4 情报: ContextHandoff (扫描上下文状态并适应)
└── S5 政策: maxSteps, maxConsecutiveErrors, maxProbeTools
```

### 发现

**优势**:
- **系统层 S1-S5 完整**: 五个功能层都有对应实现，且职责相对清晰。
- **S2 Coordination 设计精良**: `AgentDispatcher` 的三种模式（single/pipeline/parallel）和 `MeetingProtocol` 的 4 阶段共识机制，是多执行单元协调的优秀实践。
- **S3 Control 的数据驱动**: `ObservabilityCollector` + `AutoAdjuster` 将控制从"基于规则"提升到"基于反馈"。

**风险**:
- **S5 Policy 层薄弱**: 当前的 S5 主要是"安全限制"和"预算限制"，缺乏真正的"使命和价值观"表达。例如：
  - 当 S3（控制）要求"减少上下文预算以节省成本"与 S4（情报）要求"增加上下文预算以获取更全面分析"冲突时，谁仲裁？目前没有机制。
  - "帮助用户完成软件工程任务"这一核心使命没有在任何 Policy 组件中显式声明。
- **递归深度不足**: 虽然系统层有 S1-S5，但子系统内部的递归结构不完整。例如：
  - `Memory` 系统自身没有内部的 S1-S5（没有 memory-level 的协调、控制、情报）。
  - `Decision` 系统缺少 S4（没有对决策模式的外部扫描和长期适应）。
- **S3-S4 界限模糊**: `ContextMonitor` 被归类为 S4（外部扫描），但它实际上也执行 S3 功能（控制动作——触发 handoff）。`AutoAdjuster` 也是如此（既是 S3 控制，也是 S4 情报分析）。
- **缺少 S5 仲裁机制**: Stafford Beer 的 VSM 中，S5 的关键功能是仲裁 S3 和 S4 的冲突。当前系统没有显式的仲裁逻辑。

### 建议

1. **强化 S5 Policy 层**:
   - 创建 `PolicyEngine` 组件，显式编码系统使命（如"用户自主性优先"、"成本透明"、"可解释性"）。
   - 当 S3（AutoAdjuster）和 S4（HarnessAnalyst）提出冲突建议时，`PolicyEngine` 根据使命优先级仲裁。
2. **完善子系统递归结构**:
   - 为 `Memory` 添加内部 S2（协调读写冲突）和 S4（扫描记忆使用模式并优化索引策略）。
   - 为 `Decision` 添加 S4（分析历史决策模式，识别用户的系统性偏见）。
3. **明确 S3/S4 接口**:
   - `ContextMonitor` 应仅"报告"（S4），将"动作"委托给专门的 S3 控制器（如 `ContextController`）。
   - `AutoAdjuster` 应拆分为 `HealthAnalyzer`（S4）和 `ParameterController`（S3）。

---

## 原则 7: Hard Variety Ceiling — 硬 Variety 上限

> *An AI's effective capacity to cope with environmental complexity cannot exceed its internal variety.*

### 现状评估

**环境 Variety**（输入空间复杂度）:
- 用户请求类型: 意图解析器处理 N 种意图 → 路由到 M 个角色 → 每个角色可使用 P 个工具 + Q 个技能 + R 个 MCP 工具
- 代码库规模: 无上限（系统支持任意大小的项目）
- 文件类型: 通过 LSP 支持多种语言
- 决策复杂度: 4 级（L0-L3），但实际决策场景可能远超此分类

**内部 Variety**（系统状态空间）:
- LLM 模型选择: ~10 个模型 × 3 个角色 = 30 种配置
- 工具可用性: 50+ 固定工具 + 动态 MCP/Skill 工具
- 记忆层: 3 层（daily/register/working）× 多维度元数据
- 委托层级: 4 级（T0-T3）
- 上下文预算: 连续变量（但通常离散化为几个档位）

### 发现

**优势**:
- **ContextHandoff 是 variety 降低装置**: 当环境 variety（上下文长度）超过内部 variety（模型上下文窗口）时，系统通过压缩来降低环境 variety。这是数学上正确的应对。
- **DelegationTier 是 variety 分层**: T0 代理只暴露 read-only 工具，将其环境 variety 限制在安全范围内。

**风险**:
- **工具选择的 variety mismatch**: 当可用工具超过 ~20 个时，LLM 的 tool selection reliability 显著下降。当前系统在某些配置下可能同时暴露 50+ 工具，这几乎 guarantee 了选择错误。
- **DecisionLevel 的 variety 不足**: 只有 4 个级别（L0-L3）来分类所有决策。一个涉及多团队、多风险维度、长期影响的复杂组织决策，无法被 4 个级别充分表达。这会导致误判（过度自动批准或过度人工审核）。
- **ContextMonitor 的 zone variety 不足**: 4 个 zone 对上下文状态的分类过于粗糙。在 Smart Zone 内，30% 利用率和 10% 利用率的行为应该不同；在 Critical Zone，65% 和 75% 也应该不同。
- **AgentRoleRegistry 的 variety**: 角色是动态注册的，但 `AgentDispatcher` 的 pipeline/parallel 模式假设角色间的输入/输出接口是兼容的。如果角色 variety 增加（更多自定义角色），接口不匹配的 variety 也会增长。

### 建议

1. **动态 Tool Pruning**: 基于当前任务描述，使用 embedding 相似度从全部工具中选择 top-K（如 10-15 个）最相关的工具暴露给 LLM。这主动降低了环境 variety 以匹配模型能力。
2. **扩展 DecisionLevel**: 引入多维度决策分类（成本 × 可逆性 × 利益相关者数 × 时间范围），生成一个决策复杂度评分，替代简单的 L0-L3。
3. **细化 ContextZone**: 将利用率视为连续变量，用多个软阈值（fuzzy boundaries）触发不同强度的适应行为，而非 4 个硬分区。
4. **角色接口契约**: 为每个角色定义显式的输入/输出 schema，在 pipeline 模式执行前进行 schema 兼容性检查，防止 variety 增长导致接口断裂。

---

## 原则 8: From Command to Enablement — 从命令到赋能

> *The relationship between humans and AI should shift from command-execute to enable-emerge.*

### 现状评估

| 维度 | 命令模式特征 | 赋能模式特征 | Cabinet 现状 |
|------|-----------|-----------|-------------|
| 边界设计 | 限制用户 | 限制 AI | 限制 AI（SafetyChecker） |
| 反馈设计 | 用户评价结果 | AI 从行动后果学习 | 混合（PreferenceLearner + 用户反馈） |
| 触发设计 | 脚本化每一步 | 设计刺激引导涌现 | 偏脚本化（WorkflowEngine） |
| 用户角色 | 指挥官 | 园丁/栽培者 | 介于两者之间（Captain 隐喻暗示指挥） |

### 发现

**优势**:
- **边界设计**: `SafetyChecker` 的 T0-T3 模型是优秀的"限制 AI 而非限制用户"设计。用户在 T3 拥有完全控制权，AI 的自主性随 tier 降低而受限。
- **反馈设计**: `PreferenceLearner` 从用户的决策历史中学习偏好，是真正的"从行动后果学习"。`FeedbackStore` 记录用户显式反馈用于路由优化。
- **Skill 系统是赋能设计**: 用户定义 SKILL.md（准备环境），系统将其转化为可调用能力（栽培 emergence）。`startSkillWatcher` 的热重载机制支持快速迭代。

**风险**:
- **主交互流仍是命令-执行**: 用户发送消息 → Secretary 解析 → 路由 → 执行 → 返回结果。虽然内部有多智能体协作，但从用户视角，这仍是"我命令，你执行"。
- **WorkflowEngine 过度脚本化**: 工作流节点类型丰富（15+ 种），但工作流的本质是"脚本化每一步"。这与赋能理念（设计刺激，让行为涌现）存在张力。
- **无环境刺激设计**: 系统缺乏"当我检测到 X 条件时，主动向用户提出 Y 建议"的触发机制。`SubconsciousLoop` 生成洞察但只在后台运行；`ContextMonitor` 发出警告但只影响系统内部。没有一个组件负责"培育"用户与 AI 的协作生态。
- **AgentCard / A2A 协议**: `.well-known/agent-card.json` 是向外部声明能力的一步，但目前是静态的。赋能模式要求能力声明是动态的、协商的。

### 建议

1. **引入 Proactive Suggestion Engine**: 基于 `SubconsciousLoop` 洞察 + `ContextMonitor` 趋势 + `Decision` 状态，主动在用户界面中显示:"我注意到 X，建议关注 Y"。将 AI 从被动执行者转变为主动协作者。
2. **Workflow 的涌现模式**: 为 WorkflowEngine 添加 "emergent" 节点类型——不指定具体步骤，而是定义目标状态和约束条件，让 AgentLoop 自主探索路径。
3. **动态 AgentCard**: 让 AgentCard 根据当前负载、健康状态、最近学习到的偏好动态更新，使外部系统（包括用户）能与 AI 进行协商式交互。
4. **重新命名隐喻**: "Captain"（船长）暗示命令层级。考虑向 "Partner"（伙伴）或 "Collaborator"（协作者）的隐喻迁移，在 UI 文案和系统提示词中减少命令语气。

---

## 跨原则综合诊断

### 系统的控制论健康度

```
原则 1 (AI as Process)        ████████░░  8/10  过程连续性良好，潜意识层孤立
原则 2 (Precision-Complexity) ███████░░░  7/10  显式管理，但阈值静态
原则 3 (Dialogic Meaning)     ██████░░░░  6/10  Meeting 强，主循环弱
原则 4 (Closed-Loop Cognition)███████░░░  7/10  Harness 闭环强，微观闭环延迟高
原则 5 (Structural Determinism)██████░░░░  6/10  安全边界强，认知边界未文档化
原则 6 (Recursive S1-S5)      ███████░░░  7/10  系统层完整，递归深度不足，S5 薄弱
原则 7 (Hard Variety Ceiling) ██████░░░░  6/10  Handoff 正确，但工具 variety 超载
原则 8 (Command→Enablement)   ██████░░░░  6/10  边界设计好，但交互流仍偏命令

综合评分: 6.6/10 (L3+ 成熟度，接近 L4)
```

### 最关键的 3 个系统性风险

1. **工具生态 Variety 失控** (原则 2, 7): 50+ 工具 + 动态 MCP/Skill 的增长速度已经超过 LLM tool selection 能力的 variety 上限。这不是一个可以通过"更好的提示词"解决的问题，而是架构层面的 mismatch。必须实施动态 tool pruning。

2. **S5 Policy 层真空** (原则 6): 系统有完善的 S1-S4，但 S5 只有安全限制和预算限制，缺少"使命仲裁"能力。随着系统自主性增加（T2-T3），S3（控制/优化）和 S4（情报/探索）之间的冲突会增多，没有 S5 将导致系统行为漂移。

3. **感知-行动闭环断裂** (原则 4): `HarnessAnalyst` 和 `SubconsciousLoop` 都生成有价值的感知，但这些感知没有可靠地连接到行动层。系统"知道"很多，但"做"得很少。这是典型的"高感知-低行动"失衡。

### 推荐的优先实施顺序

**P0（立即）**:
- 动态 Tool Pruning（降低 variety mismatch，提升可靠性）
- Session-level 快速反馈（缩短闭环延迟，防止循环陷入）

**P1（短期）**:
- 强化 S5 PolicyEngine（添加使命声明和仲裁机制）
- SubconsciousLoop → AgentLoop 耦合（关闭断裂的感知-行动环）
- SafetyChecker 动态风险推断（承认并管理结构决定论的盲区）

**P2（中期）**:
- 自适应 ContextMonitor 阈值（从静态到动态平衡）
- MetaDialogueManager（处理理解分歧的元对话能力）
- 各组件认知边界文档化（Structural Determinism 的显式表达）

**P3（长期）**:
- 子系统递归结构完善（Memory/Decision 的内部 S1-S5）
- Proactive Suggestion Engine（从命令到赋能的范式迁移）
- Workflow 涌现模式（从脚本化到目标驱动的自主探索）

---

## 附录: 审计方法说明

本次审计基于以下代码分析：
- 核心包: `packages/agent`, `packages/gateway`, `packages/memory`, `packages/decision`, `packages/meeting`, `packages/workflow`, `packages/secretary`, `packages/harness`, `packages/events`
- 服务器层: `apps/server/src/context.ts`, `apps/server/src/main.ts`, `apps/server/src/index.ts`, `apps/server/src/watchers.ts`
- 关键文件: `agent-loop.ts`, `skill-registry.ts`, `skill-loader.ts`, `dispatcher.ts`, `tools/index.ts`, `safety.ts`, `context-builder.ts`, `context-monitor.ts`, `context-handoff.ts`, `subconscious-loop.ts`, `observability.ts`, `auto-adjuster.ts`, `harness-analyst.ts`, `preference-learner.ts`, `quality-gate.ts`, `bus.ts`, `causation.ts`

总计审查约 15,000+ 行核心逻辑代码。
