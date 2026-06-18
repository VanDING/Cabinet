# Cabinet ↔ Hermes Agent 全维度深度对比分析报告

> 生成日期：2026-06-12
> 分析范围：Nous Research Hermes Agent（191k+ Star）与 Cabinet v2.0（TypeScript 重写后）
> 目的：逐层、逐模块、逐设计识别差距与改进机会

---

## 目录

1. [项目概览与定位对比](#一项目概览与定位对比)
2. [架构层对比](#二架构层对比)
3. [Agent 核心执行对比](#三agent-核心执行对比)
4. [系统提示词与上下文工程对比](#四系统提示词与上下文工程对比)
5. [工具系统对比](#五工具系统对比)
6. [Skill 系统对比](#六skill-系统对比)
7. [记忆系统对比](#七记忆系统对比)
8. [子代理 / 委派系统对比](#八子代理--委派系统对比)
9. [上下文压缩与管理对比](#九上下文压缩与管理对比)
10. [Gateway / 多平台连接对比](#十gateway--多平台连接对比)
11. [IM 频道 / 消息网关对比](#十一im-频道--消息网关对比)
12. [调度与自动化对比](#十二调度与自动化对比)
13. [插件系统对比](#十三插件系统对比)
14. [安全机制对比](#十四安全机制对比)
15. [用户界面与交互对比](#十五用户界面与交互对比)
16. [工程纪律与质量保障对比](#十六工程纪律与质量保障对比)
17. [关键设计差异总结表](#十七关键设计差异总结表)
18. [优先级改进建议](#十八优先级改进建议)
19. [结论](#十九结论)

---

## 一、项目概览与定位对比

### 1.1 基本信息

| 维度            | Hermes Agent                                                           | Cabinet                                                          |
| --------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **全称**        | Hermes Agent                                                           | Cabinet — "Your AI Council"                                      |
| **作者/组织**   | Nous Research                                                          | Cabinet Dev                                                      |
| **一句话描述**  | "The agent that grows with you"（与你共同成长的 Agent）                | "Your AI Council"（你的 AI 内阁）                                |
| **定位**        | 自我进化的个人 AI 助手——从经验中创建技能、跨会话保留记忆、主动自我提示 | AI 驱动的项目管理与自主执行平台——多 Agent 内阁协作、决策、工作流 |
| **核心隐喻**    | 个人管家/助手——一个随你而变的 AI 伙伴                                  | 船长（Captain）+ 内阁（Cabinet）——你决策，AI 执行                |
| **开源时间**    | 2025-07-22                                                             | 未公开                                                           |
| **GitHub Star** | 191,000+                                                               | —                                                                |
| **Fork**        | 33,000+                                                                | —                                                                |
| **Open Issues** | 19,848                                                                 | —                                                                |
| **主语言**      | Python                                                                 | TypeScript                                                       |
| **底层框架**    | 自研 Agent Loop（直接调用 LLM API）                                    | Hono + Vercel AI SDK + 自研 Graph                                |
| **UI**          | TUI（Ink/React）+ Electron 桌面 + Web Dashboard                        | Tauri 桌面应用 + Hono 服务端                                     |
| **数据库**      | SQLite（FTS5 全文搜索）                                                | SQLite（better-sqlite3，AES-256 加密）                           |
| **License**     | MIT                                                                    | MIT                                                              |
| **仓库大小**    | 325,863 KB                                                             | —                                                                |
| **包管理**      | pip + uv（Python）                                                     | pnpm workspace（TypeScript monorepo）                            |
| **安装方式**    | 一键 Shell 脚本（`curl \| bash`）                                      | pnpm install + pnpm build                                        |

### 1.2 设计哲学对比

| 设计理念       | Hermes Agent                                                                        | Cabinet                                                                  |
| -------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Agent 架构** | 单体 AIAgent（12K LOC 核心类）+ 工具生态 + 委派子代理                               | 多 Agent 内阁：Secretary → 多 Agent → Decision → Workflow                |
| **核心原则**   | **Prompt 缓存不可侵犯**：任何破坏缓存的操作都是设计 bug；**窄腰**：核心工具门槛极高 | **4 层架构**：依赖单向流动；**从终局设计**：假设 AI 全能，逐步添加脚手架 |
| **进化方式**   | **闭环学习**：Agent 自主创建 Skill → Curator 管理生命周期 → Skill 在使用中自我改进  | **控制论反馈**：Harness 层通过 Observer Pipeline 监控、评估、自我调节    |
| **用户角色**   | 用户是对话者——通过 CLI/TUI/IM 直接交互                                              | 用户是 Captain（船长）——做方向性选择和价值判断                           |
| **过程可见性** | 流式输出 + 工具调用过程可见 + 思考过程（thinking）可见                              | "Don't watch the process; judge the result"——只看交付物                  |
| **设计先验**   | 实用主义——解决"今天"的问题，不做投机性基础设施                                      | 控制论——VSM 8 条原则的系统级自我认知                                     |
| **代码规模**   | 单体 Python（核心 12K LOC + 900 测试文件 ~17K tests）                               | TypeScript monorepo（15 packages + 2 apps）                              |

### 1.3 核心交集

两者都是 **AI Agent 运行系统**，共享以下核心概念：

- Agent 生命周期管理（会话、中断、恢复）
- Skill/插件系统（能力模块的创建与复用）
- 记忆系统（短期 + 长期，跨会话持久化）
- 工具生态系统（文件系统、Shell、Web 搜索、MCP）
- 子代理委派（并行执行、上下文隔离）
- 流式响应（SSE / 流式 HTTP）
- 多平台连接（IM 频道 / 消息网关）
- 上下文压缩与管理
- 定时任务调度

**根本差异：** Hermes 是"单体进化型个人助手"——一个不断学习、自我改进的 AI Agent，通过即时交互（CLI/IM）使用。Cabinet 是"多体结构化项目管理平台"——通过内阁协作、决策状态机、工作流引擎来管理复杂项目。

---

## 二、架构层对比

### 2.1 总体架构模式

```
Hermes Agent 架构:
  ┌────────────────────────────────────────────┐
  │           入口层                            │
  │  CLI (hermes_cli/)   TUI (ui-tui/)   Gateway│
  │  Web Dashboard        Electron Desktop      │
  └────────────────┬───────────────────────────┘
                   │
  ┌────────────────┴───────────────────────────┐
  │          Agent 核心 (run_agent.py)          │
  │  AIAgent 类 (12K LOC)                       │
  │  ├── conversation_loop.py (主执行循环)       │
  │  ├── system_prompt.py (三级提示词组装)        │
  │  ├── context_compressor.py (上下文压缩)       │
  │  ├── curator.py (Skill 生命周期管理)          │
  │  ├── agent_init.py (初始化与委派)             │
  │  └── tool_executor.py (工具分发)             │
  └────────────────┬───────────────────────────┘
                   │
  ┌────────────────┴───────────────────────────┐
  │              横向支持系统                    │
  │  tools/ (60+ 工具)   skills/ (内置技能)      │
  │  memory/ (FTS5 记忆)  plugins/ (插件系统)    │
  │  gateway/ (消息网关)   cron/ (调度器)        │
  │  transports/ (多 Provider 适配)             │
  └────────────────────────────────────────────┘

Cabinet 架构:
  ┌────────────────────────────────────────────┐
  │           Layer 4: Interface                │
  │  ui (React)  server (Hono)  desktop (Tauri)│
  │                    cli                      │
  └────────────────┬───────────────────────────┘
                   │
  ┌────────────────┴───────────────────────────┐
  │           Layer 3: Business                 │
  │  decision  secretary  workflow  harness     │
  └────────────────┬───────────────────────────┘
                   │
  ┌────────────────┴───────────────────────────┐
  │           Layer 2: Agent Core               │
  │  gateway (Vercel AI SDK)  agent  memory     │
  └────────────────┬───────────────────────────┘
                   │
  ┌────────────────┴───────────────────────────┐
  │           Layer 1: Infra                    │
  │  graph (自研 StateGraph)  types  events     │
  │  storage (SQLite + AES-256)                 │
  └────────────────────────────────────────────┘
```

| 对比点              | Hermes Agent                                                                                                     | Cabinet                                                                       | 评价                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **架构风格**        | **单体核心 + 插件扩展**：一个 AIAgent 类承载所有核心逻辑（12K LOC），外围通过 plugin/provider/transport 接口扩展 | **分层 Monorepo**：15 个包严格按 4 层架构组织，每层有明确的依赖方向           | **Hermes 简单直接**——对快速迭代友好。**Cabinet 更工程化**——适合多人协作和长期维护         |
| **核心 vs 外围**    | 窄腰设计：核心 Agent + 工具 schema 极度克制，新能力通过 skill/plugin/MCP 添加                                    | 4 层设计：Layer 1-2 稳定，Layer 3-4 活跃。架构规则通过 `lint:arch` 自动校验   | Hermes 的窄腰哲学很清晰；Cabinet 的分层更结构化                                           |
| **可扩展性**        | Plugin 系统（pre/post_tool_call, pre/post_llm_call 等生命周期钩子）+ Memory Provider + Model Provider + MCP      | Observer Pipeline（生命周期钩子）+ Skill Registry + MCP + A2A Adapter         | **Hermes 的插件面更广**（Model/Memory/Plugin 三类扩展）；Cabinet 的 Observer 面更细粒度   |
| **Provider 抽象**   | Transport 抽象层：anthropic / chat_completions / bedrock / codex，每种 transport 处理不同的 API 形状             | AISDKAdapter：统一通过 Vercel AI SDK 适配 8 个 provider                       | Hermes 直接处理 API 差异更灵活；Cabinet 通过 SDK 更简洁                                   |
| **配置热重载**      | ✅ Skill 索引 mtime/size 校验 + 磁盘快照缓存。Config 热重载                                                      | ✅ fs.watch 监控 `~/.cabinet/` 目录变更                                       | 一致                                                                                      |
| **Prompt 缓存策略** | **核心设计约束**：系统提示词一次构建、跨 turn 复用；压缩时触发重建；`/reload-skills` 不失效缓存                  | 通过 ContextBuilder 分层构建：Tier1（稳定）→ Tier2（会话稳定）→ Tier3（动态） | **Hermes 极其重视**——缓存命中率直接影响用户成本。Cabinet 也有 tier 设计但不如 Hermes 极端 |

### 2.2 窄腰 vs 宽腰

```
Hermes 窄腰设计:
  所有模型调用共享同一套核心工具 schema
  → 添加核心工具的门槛极高（必须"基础且广泛有用"）
  → 新能力优先通过 Skill + CLI 命令 + MCP + Plugin 添加
  → 核心工具数量受严格控制

Cabinet 宽腰设计:
  每个 Agent 角色的工具集可以不同（通过 ToolExecutor.createView()）
  → 工具按角色分类（Secretary ~55 / Curator ~40 / Organize ~70）
  → 新工具可以随时注册
  → 工具数量不受严格控制
```

| 对比点           | Hermes                                                       | Cabinet                                                         |
| ---------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| **核心工具哲学** | 极度克制——每个核心工具每次 API 调用都会发送，增加 token 成本 | 按需分配——通过角色+ToolPruner 动态裁剪到 12-18 个工具           |
| **扩展方式**     | Skill（对话中注入）+ Plugin（生命周期钩子）+ MCP（外部进程） | Skill（注册为工具）+ Observer（管道钩子）+ MCP + External Agent |
| **工具发现**     | 注册表自动发现（`tools/*.py` 的 `registry.register()` 调用） | 显式组装（`createCabinetTools()` 工厂函数）                     |

### 2.3 建议

1. **Hermes 的窄腰哲学值得借鉴**——Cabinet 应考虑将核心工具集分为"每次发送的基础工具"和"按需加载的扩展工具"两层
2. **保持 Cabinet 的分层架构**——这对多人协作和长期维护至关重要
3. **借鉴 Hermes 的 Prompt 缓存策略**——在 ContextBuilder 中明确标注"缓存安全"和"需失效"的 prompt 段
4. **考虑引入 Plugin 系统**（参考 Hermes 的生命周期钩子）——补充现有 Observer Pipeline，让第三方可以扩展 Agent 行为

---

## 三、Agent 核心执行对比

### 3.1 执行循环

```
Hermes (conversation_loop.py:run_conversation):
  1. Per-Turn Prologue
     → build_turn_context(): 消息清理、系统提示词恢复、插件钩子、记忆预取
  2. Main Loop (while api_call_count < max_iterations)
     → Interrupt 检查
     → Budget 消耗
     → Steer 注入
     → API 消息组装（清理 + 缓存断点 + 序列修复）
     ├─ Inner Retry Loop
     │   → Rate limit 守卫
     │   → API 调用（优先流式）
     │   → 响应校验（按 transport 类型）
     │   → 错误处理（指数退避 5s-120s + Fallback Provider）
     ├─ Finish Reason 处理
     │   → length → 续写/截断处理
     │   → tool_calls → 工具分发
     │   → stop → 正常结束
     ├─ 工具分发 (execute_tool_calls_concurrent / sequential)
     │   → 中间件管道（unwrap → middleware → plugin → guardrail）
     │   → 并行（ThreadPoolExecutor 8 workers）或串行
     │   → 后处理（guardrail 观察 + 文件变更追踪 + 持久化）
     └─ Turn Exit & Response
         → 持久化会话 → 清理任务资源

Cabinet (agent-loop.ts:AgentLoop._execute):
  1. 组装上下文 (_assembleContext)
     → checkpoint 恢复 → 会话历史合并 → ContextBuilder.build()
  2. Observer Pipeline 通知 (onStreamStart)
  3. 用户输入安全检查 (onUserInput)
  4. Main Loop (while stepCount < maxSteps)
     → 工具集动态裁剪 (ToolPruner)
     → LLM 调用 (withRetry)
     → CostTracker 记录
     → 无工具调用 → break
     → 工具分类：只读 → Promise.all 并行；写入 → for 串行
     → Observer 通知 (onToolCall → onToolResult → onStepEnd)
  5. Observer Pipeline 通知 (onStreamEnd)
  6. 会话报告
```

### 3.2 核心差异

| 对比点              | Hermes Agent                                                                                                                    | Cabinet                                                         | 评价                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **执行模式**        | 同步（Python 线程）+ ThreadPoolExecutor 并行工具 + 中断信号                                                                     | 异步（async/await）+ 只读工具并行 + 写入工具串行                | **Cabinet 更现代**——async 模式下资源利用更好。Hermes 的同步模式更简单                |
| **重试/容错**       | ✅ **极其健壮**：内层重试循环 + 指数退避（5s-120s）+ Fallback Provider 自动切换 + 特定 Provider 诊断信息 + Unicode 错误特殊处理 | ✅ withRetry() + FallbackChain（指数退避 1s/2s/4s）+ 模型降级链 | **Hermes 更健壮**——针对各种 API 错误码有专属提示，Fallback Provider 是运行时自动激活 |
| **中断机制**        | ✅ `_interrupt_requested` 标志 + 线程信号 + 每 200ms 轮询检查 + 子代理传播                                                      | ❌ 无显式中断机制                                               | **Hermes 更好**——用户可以随时中断长时间运行的任务                                    |
| **Steer 机制**      | ✅ **独特**：`/steer` 允许用户在 Agent 执行中途注入指令（不中断，等待工具批次完成）                                             | ❌ 无等效机制                                                   | **Hermes 独有**——非破坏性的中途引导                                                  |
| **流式处理**        | ✅ **流式优先**——即使没有消费者也使用流式（"fine-grained health checking"）                                                     | ✅ Vercel AI SDK `streamText`                                   | 一致                                                                                 |
| **Turn Budget**     | ✅ 显式迭代预算 + 一次"grace call" + `api_call_count` 追踪                                                                      | ✅ `maxSteps`（默认 50）+ `consecutiveErrors` 阈值              | Hermes 的 grace call 是不错的细节                                                    |
| **API 调用计数**    | ✅ `api_call_count` 精确追踪每个 API 调用的 token 和成本                                                                        | ✅ CostTracker（但粒度是会话级而非调用级）                      | Hermes 的调用级追踪更细粒度                                                          |
| **Checkpoint/恢复** | ✅ 每次 Turn 持久化会话到 SQLite + 崩溃恢复                                                                                     | ✅ CheckpointManager（每 N 步保存，4 级降级）                   | Cabinet 的 4 级降级策略更健壮                                                        |
| **会话 DB**         | ✅ SessionDB（SQLite + FTS5）存储完整消息历史、token 计数、系统提示词                                                           | ✅ SessionManager（文件存储 + 内存缓存）                        | Hermes 的 SQLite 更可靠                                                              |
| **Thinking 处理**   | ✅ `think_scrubber.py`——处理推理模型的 thinking block + 预算耗尽                                                                | ❌ 基础支持                                                     | **Hermes 更好**——针对推理模型的专门优化                                              |

### 3.3 建议

1. **P1：增加中断机制**——参考 Hermes 的 `_interrupt_requested` 模式，为 `AgentLoop` 增加 `AbortController` 支持
2. **P1：增加 Steer 机制**——允许用户在 Agent 执行中注入非破坏性引导指令
3. **P2：增强 Fallback Provider 逻辑**——参考 Hermes 的"运行时自动 Fallback"而非仅在初始化时配置的 FallbackChain
4. **P2：增加调用级 Token 追踪**——在每次 LLM 调用而非仅在会话结束时记录成本

---

## 四、系统提示词与上下文工程对比

### 4.1 提示词组装

```
Hermes (system_prompt.py 三级组装):
  Tier 1 (Stable — 会话生命周期缓存):
    SOUL.md 身份 → 环境提示 → 模型专属指导 → 任务完成指导
    → 计算机使用指导 → 记忆/会话搜索指导 → Skill 指导
    → Kanban 指导 → Hermes 帮助 → 订阅信息 → 工具强制指导

  Tier 2 (Context — 会话依赖):
    调用者 system_message + 项目上下文文件 (AGENTS.md/.cursorrules 等)

  Tier 3 (Volatile — 每 Turn 变化，永不缓存):
    记忆快照 + USER.md 档案 + 外部记忆 provider + 时间戳 + 会话 ID

Cabinet (ContextBuilder 分层组装):
  Tier 1 (Static):
    角色指令 ("You are a Cabinet AI assistant...")

  Tier 2 (Session-Stable):
    项目上下文 + Captain 偏好 + 项目规则 (.cabinet/rules/)

  Tier 3 (Dynamic):
    RAG 长期记忆搜索结果 + 最近背景洞察 (insights)
```

| 对比点             | Hermes Agent                                                                                              | Cabinet                                                                                | 评价                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **身份定义**       | ✅ **SOUL.md**——独立的人格文件，可被替换                                                                  | ❌ 硬编码在 ContextBuilder 或 AgentRole.modules.identity 中                            | **Hermes 更好**——SOUL.md 是用户可编辑的独立文件                                                     |
| **项目上下文**     | ✅ AGENTS.md / .cursorrules / CLAUDE.md / HERMES.md——自动发现并注入                                       | ✅ .cabinet/rules/——三层加载（always/auto/on-demand）                                  | 各有千秋。Hermes 兼容多种格式；Cabinet 有更精细的加载策略                                           |
| **平台感知**       | ✅ `PLATFORM_HINTS`——根据平台（WhatsApp vs WebUI）调整 Markdown 和格式建议                                | ❌ 无平台感知提示词                                                                    | **Hermes 更好**——在 IM 场景下尤为重要                                                               |
| **环境感知**       | ✅ **极其详细**：本地/远程/Windows/WSL/Docker/Desktop——针对每种环境的 Shell 路径、用户名、$HOME 提示      | ❌ 仅有基本的 project root snapshot                                                    | **Hermes 更好**——环境感知对命令执行准确性至关重要                                                   |
| **模型专属指导**   | ✅ 区分 OpenAI/GPT/Codex/Grok 和 Google/Gemini/Gemma 两套指导 + 工具强制使用模型列表                      | ❌ 无模型专属提示词                                                                    | **Hermes 更好**——不同模型家族需要不同的指令风格                                                     |
| **Skill 索引注入** | ✅ **两层缓存**（内存 LRU + 磁盘快照）+ mtime/size 校验 + 按平台/环境过滤 + coding focus 模式下的类别降级 | ✅ SkillRegistry.describeForRouting()（L1 元数据列表）                                 | Hermes 的 Skill 索引更智能（条件显示/类别降级）。Cabinet 的 L1-L2-L3 三级渐进加载在加载粒度上更精细 |
| **提示词缓存**     | ✅ **核心设计约束**：仅在压缩时重建；`/reload-skills` 不失效缓存；Tier 3 在 API 调用时才注入              | ✅ ContextBuilder.buildCachedSystemPrompt() 返回 Tier 1+2 用于 Anthropic cache_control | **Hermes 更极端**——缓存策略是架构决策而非实现细节                                                   |
| **注入攻击检测**   | ✅ `_scan_context_content()`——对 SOUL.md 和上下文文件进行 prompt injection 扫描                           | ✅ ContentGuardObserver——检查用户输入和 LLM 输出                                       | Hermes 更全面（覆盖上下文文件）；Cabinet 更实时（覆盖用户输入和 LLM 输出）                          |

### 4.2 建议

1. **P1：支持 SOUL.md / AGENTS.md 格式**——让用户可以通过简单的 Markdown 文件定义 Agent 身份
2. **P1：增加模型专属指导**——至少为 Anthropic 和 OpenAI 模型提供不同的指令风格切换
3. **P2：增加平台感知提示词**——如果未来支持 IM，需要根据平台调整 Markdown 使用
4. **P2：增强环境感知**——在 prompt 中注入更详细的 Shell/OS/路径上下文
5. **P2：提高 Prompt 缓存的优先级**——将缓存策略作为架构设计的一等约束

---

## 五、工具系统对比

### 5.1 工具注册与发现

```
Hermes 工具系统:
  tools/registry.py → 全局单例 Registry
    ↑
  tools/*.py  → 每个文件调用 registry.register()
    ↑ 自动发现：任何 tools/*.py 的 register() 调用在 import 时生效
  model_tools.py → 导入 registry + 触发放行发现
  toolsets.py → TOOLSETS 字典 + _HERMES_CORE_TOOLS 集合
    → 工具必须手动加入 toolset 才会暴露给 Agent

  注册格式：
    registry.register(
      name="tool_name",
      toolset="filesystem",
      schema={...},        # JSON Schema
      fn=lambda args: ...  # handler 函数
      check_fn=lambda: ..., # 条件启用
      requires_env=[...],   # 所需环境变量
    )

Cabinet 工具系统:
  ToolExecutor 类:
    register(tool: ToolDefinition) → tools Map
    execute(name, toolCallId, args, context?) → ToolResult
    createView(allowedTools) → ToolExecutor (受限视图)
    getToolDescriptors() → AI SDK 格式

  注册格式：
    {
      name: "tool_name",
      description: "...",
      parameters: {...},        # JSON Schema
      execute: async (args, context?) => {...},
      timeoutMs?: number,
    }
```

| 对比点           | Hermes Agent                                                                                 | Cabinet                                                 | 评价                                            |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| **工具数量**     | 60+ 内置（受控）                                                                             | 80+ 注册（按 category 分组为 13 个文件）                | 接近                                            |
| **注册模式**     | 全局 Registry 单例 + 装饰器风格                                                              | ToolExecutor 实例 + 构造时注入                          | Hermes 更简洁；Cabinet 更易测试（无全局状态）   |
| **条件启用**     | ✅ `check_fn` + `requires_env`——运行时动态判断                                               | ❌ 无等效——通过 ToolPruner 动态裁剪                     | **Hermes 更好**——工具可以有条件地不可用         |
| **Toolset 分组** | ✅ TOOLSETS 字典——工具按功能分组，Agent 可以启用/禁用整个组                                  | ❌ 无等效——通过 category 前缀隐式分组                   | **Hermes 更好**——用户可以按组启用/禁用          |
| **动态裁剪**     | ❌ 无显式裁剪——所有启用的工具每次调用都发送                                                  | ✅ ToolPruner——基于 embedding 语义相关性裁剪到 12-18 个 | **Cabinet 更好**——减少 token 消耗               |
| **工具搜索**     | ✅ `tool_search`——Agent 可以按名称/描述搜索工具目录                                          | ❌ 无等效                                               | **Hermes 更好**——Agent 可以自主发现不常用的工具 |
| **Handler 模式** | Lambda 函数 + 内联分发（特定工具名前缀） + 回退到 `run_agent.handle_function_call()`         | 每个 ToolDefinition 有自己的 `execute` 函数             | Cabinet 更整洁——每个工具自包含                  |
| **中间件管道**   | ✅ tool_search unwrap → request middleware → plugin block → guardrail → execution middleware | ✅ Observer Pipeline（onToolCall → onToolResult）       | Hermes 的工具中间件更丰富                       |

### 5.2 建议

1. **P1：增加 Toolset 分组机制**——让用户/角色可以按组启用/禁用工具（而非单个工具粒度的白名单）
2. **P1：增加条件工具启用**——在 ToolDefinition 中增加 `checkFn` 和 `requiresEnv` 字段
3. **P2：增加 tool_search 工具**——让 Agent 可以自主搜索和发现工具
4. **保持 Cabinet 的 ToolPruner**——这是优势，在大量工具场景下控制 token 消耗

---

## 六、Skill 系统对比

### 6.1 格式对比

```
Hermes SKILL.md 格式:
  ---
  name: my-skill
  description: One sentence, ≤60 chars, period-terminated. (required)
  metadata:
    hermes:
      config:              # 声明 config.yaml 变量
        - MY_API_KEY
      platform: [cli]      # 限定平台
      environment: [local] # 限定运行环境
  ---
  # Skill Content
  ...Markdown body → 作为 user message 注入（非 system prompt）...

  Skill 目录结构:
    skills/my-skill/
    ├── SKILL.md
    ├── scripts/        # 可执行脚本
    ├── references/     # 参考文档
    └── templates/      # 模板文件

Cabinet SKILL.md 格式:
  ---
  name: my-skill
  description: ...
  kind: tool | prompt | composite
  version: 1
  ---
  # Skill Content
  ...Markdown body → promptTemplate...
  # 支持变量替换: $ARGUMENTS, $0, $1, {{key}}
```

### 6.2 功能对比

| 对比点              | Hermes Agent                                                                                                                        | Cabinet                                                           | 评价                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| **格式**            | YAML frontmatter + Markdown body                                                                                                    | YAML frontmatter + Markdown body                                  | **高度兼容**                                                 |
| **自主创建**        | ✅ **Agent 自主创建 Skill**——完成任务后用 `skill_manage action=create` 保存经验。这是 Hermes 的核心差异化能力                       | ❌ 无——Skill 需要人工编写                                         | **Hermes 独有且关键**——这是"闭环学习"的基石                  |
| **生命周期管理**    | ✅ **Curator**——后台自动审查 Agent 创建的 Skill：`active`→`stale`→`archived`（30 天/90 天），支持合并、创建伞 Skill、降级为支持文件 | ❌ 无——Skill 只有 draft/active/deprecated 三态，无自动管理        | **Hermes 独有**——Skill 库的自动健康维护                      |
| **Skill 索引缓存**  | ✅ 两层（内存 LRU + 磁盘快照）+ mtime/size 校验 + 进程重启后恢复                                                                    | ❌ 无——每次全量加载到内存                                         | **Hermes 更好**——启动更快，token 更省                        |
| **条件显示**        | ✅ `fallback_for_toolsets`（工具可用时隐藏 Skill）+ `requires_toolsets`（工具不可用时隐藏）+ 平台/环境过滤                          | ❌ 无——所有 active Skill 始终可见                                 | **Hermes 更好**——避免向 Agent 展示不可用的 Skill             |
| **类别降级**        | ✅ Coding focus 模式下，非 coding 类别的 Skill 降级为仅名称（不显示描述，节省 token）                                               | ❌ 无                                                             | **Hermes 更好**——上下文敏感的信息密度控制                    |
| **变量替换**        | ❌ 无——通过 `metadata.hermes.config` 声明配置变量并在 prompt 中注入 resolved 值                                                     | ✅ `$ARGUMENTS`, `$0`, `$1`, `{{key}}`                            | 各有千秋。Hermes 从 config.yaml 解析；Cabinet 支持参数化输入 |
| **三级渐进加载**    | ❌ 无——`skill_view(name)` 全量加载                                                                                                  | ✅ L1 元数据 → L2 完整 body → L3 refs/scripts                     | **Cabinet 更好**——更精细的 token 控制                        |
| **Skill 调用方式**  | `/skill-name` 作为 user message 注入（保护 prompt 缓存）                                                                            | `/skill-name` 触发 SkillActivationMiddleware → 注入 system prompt | Hermes 的 user message 注入策略保护缓存                      |
| **Hub/社区**        | ✅ **agentskills.io**——开源 Skill Hub，社区贡献和共享                                                                               | ❌ 无——仅有 4 个内置 Skill                                        | **Hermes 独有**——Skill 可移植、可共享                        |
| **安全扫描**        | ❌ 无显式扫描——但 AGENTS.md 中提到"不修改核心文件"的规则                                                                            | ❌ 无                                                             | 两者都缺失                                                   |
| **外部 Skill 目录** | ✅ `skills.external_dirs`——从多个目录加载，本地 Skill 覆盖外部同名                                                                  | ✅ `global` / `project` 两种作用域                                | 各有千秋                                                     |
| **使用追踪**        | ✅ `bump_use()` → Curator 生命周期管理                                                                                              | ✅ `usageCounts: Map<string, number>`                             | 一致                                                         |

### 6.3 Hermes 的闭环学习机制（Curator）

这是 Hermes 最独特的架构特性：

```
Agent 完成复杂任务（5+ tool calls）
  │
  ├─ Skill 指导提示："将方法保存为 Skill"
  │
  ▼
Agent 调用 skill_manage(action='create', name='...', content='...')
  │ → SKILL.md 写入 ~/.hermes/skills/
  │ → 标记 created_by: "agent"
  │
  ▼
Curator（后台，空闲时触发）
  │
  ├─ Stage 1: 自动状态转换（纯规则，无 LLM）
  │    active → stale（30 天无活动）
  │    stale → archived（90 天无活动）
  │    固定 Skill 免疫
  │
  └─ Stage 2: LLM 整合审查（Fork AIAgent）
       扫描前缀聚类（pr-*, python-*, security-*）
       → 合并到现有伞 Skill 或 创建新伞 Skill
       → 将吸收的 Skill 归档
       → 写 REPORT.md + run.json
```

### 6.4 建议

1. **P1：支持 Agent 自主创建 Skill**——这是 Hermes 最核心的差异化能力。在 Cabinet 中增加一个 `create_skill` 工具，允许 Agent 在完成复杂任务后保存经验
2. **P2：增加 Skill 生命周期管理**——参考 Hermes 的 Curator，实现基本的 stale/archive 机制
3. **P1：增加条件 Skill 显示**——`fallback_for_toolsets` / `requires_toolsets` 机制
4. **P2：Skill 索引缓存**——参考 Hermes 的两层缓存 + mtime 校验
5. **P2：类别降级**——在特定角色/模式下仅显示相关 Skill 的完整信息
6. **保持 Cabinet 的三级渐进加载和变量替换**——这些是优势
7. **P3：考虑加入 agentskills.io 生态**——让 Cabinet Skill 格式兼容 agentskills.io 标准

---

## 七、记忆系统对比

### 7.1 架构对比

```
Hermes 记忆系统:
  MemoryManager（插件化路由层）
    ├── Built-in Memory Provider
    │     ├── SessionDB (SQLite + FTS5)
    │     │     ├── 会话消息历史（支持全文搜索）
    │     │     ├── Token 使用计数
    │     │     └── 系统提示词缓存
    │     ├── session_search 工具（FTS5 全文搜索历史对话）
    │     └── memory 工具（保存/检索持久事实）
    ├── External Memory Provider（插件）
    │     └── Honcho（辩证用户建模）
    └── Memory Provider Plugins（可安装到 ~/.hermes/plugins/）

  记忆工具：
    memory(action='save', fact='...')       → 保存事实
    memory(action='search', query='...')    → 搜索记忆
    session_search(query='...')             → FTS5 搜索历史会话
    /insights [--days N]                    → 跨会话洞察

  关键约束：
    - 不存储任务进度或会话结果（"declarative facts over imperative instructions"）
    - 不存储过时产物
    - 写操作在后台线程（不阻塞 UI）

Cabinet 记忆系统:
  MemoryFacade（统一接口）
    ├── ShortTermMemory（会话 KV，LRU + TTL，maxSize=1000）
    │     → WriteGate（5 级分类：working/register/daily/transient_noise/结构化前缀）
    │     → CascadeBuffer（L0 暂存，minCount=3/maxAge=30min 自动封存）
    ├── LongTermMemory（SQLite + FTS5 + HNSW 向量索引）
    ├── EntityMemory（Captain 偏好 + 员工配置）
    ├── ProjectMemory（目标/里程碑/决策）
    ├── KnowledgeGraph（实体关系图 + 矛盾检测）
    ├── ConsolidationService（可选 LLM 提取）
    └── MemoryDecayService（过期/归档/修剪）
```

### 7.2 功能对比

| 对比点         | Hermes Agent                                                                          | Cabinet                                                                 | 评价                                                  |
| -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| **存储后端**   | SQLite + FTS5 全文搜索                                                                | SQLite + FTS5 + HNSW 向量索引                                           | **Cabinet 更好**——有向量语义搜索                      |
| **记忆分层**   | 2 层：会话级（FTS5）+ 持久事实（memory 工具）                                         | 5 层：ShortTerm → WriteGate → CascadeBuffer → LongTerm → KnowledgeGraph | **Cabinet 更好**——多级流水线更丰富                    |
| **会话搜索**   | ✅ `session_search`——FTS5 全文搜索历史对话 + LLM 摘要                                 | ❌ 无等效——仅有 short-term KV 和 long-term 语义搜索                     | **Hermes 更好**——全文搜索历史对话非常实用             |
| **用户建模**   | ✅ **Honcho 辩证用户模型**——"builds a deepening model of who you are across sessions" | ✅ EntityMemory——Captain 偏好学习                                       | Hermes 的 Honcho 是专门的用户建模系统；Cabinet 更通用 |
| **自主记忆**   | ✅ **Periodic nudges**——Agent 主动提示自己保存知识；`_iters_since_skill` 计数器       | ❌ 无主动提示——需要 Curator 显式触发                                    | **Hermes 独有**——Agent 主动自我管理记忆               |
| **写入门控**   | ❌ 无——Agent 自主决定保存什么                                                         | ✅ WriteGate——5 级分类 + 多语言正则                                     | **Cabinet 更好**——防止记忆污染                        |
| **记忆衰减**   | ❌ 无显式衰减                                                                         | ✅ MemoryDecayService——过期/归档/重要性衰减                             | **Cabinet 更好**                                      |
| **知识图谱**   | ❌ 无                                                                                 | ✅ 实体关系图 + 矛盾检测                                                | **Cabinet 独有**                                      |
| **记忆提供者** | ✅ **插件化**——MemoryProvider ABC 接口 + 外部 provider（Honcho 等）+ 后台写线程       | ❌ 无插件化——MemoryFacade 是单一实现                                    | **Hermes 更好**——记忆后端可替换                       |
| **Insights**   | ✅ `/insights [--days N]`——跨会话洞察                                                 | ✅ `getRecentInsights()` + HarnessAnalyst                               | 各有千秋                                              |
| **记忆写隔离** | ✅ 后台 worker 线程（防止慢 provider 阻塞 UI）                                        | ❌ 同步写入                                                             | **Hermes 更好**——非阻塞写                             |
| **用户档案**   | ✅ USER.md——独立的用户档案文件                                                        | ❌ 无等效——偏好存储在 EntityMemory 中                                   | Hermes 的 USER.md 更简单直观                          |

### 7.3 建议

1. **P1：增加会话全文搜索**——参考 Hermes 的 `session_search`，在当前和历史会话中 FTS5 搜索
2. **P1：记忆提供者插件化**——参考 Hermes 的 MemoryProvider ABC 接口，让记忆后端可替换
3. **P2：增加自主记忆提示**——Agent 主动提示自己保存重要知识
4. **P2：增加 USER.md 支持**——让用户通过简单的 Markdown 文件定义自己的偏好和背景
5. **保持 Cabinet 独有的优势**：WriteGate、知识图谱、向量搜索、记忆衰减——这些是 DeerFlow 和 Hermes 都没有的

---

## 八、子代理 / 委派系统对比

### 8.1 架构对比

```
Hermes 委派 (delegate_task 工具):
  delegate_task(
    goal="...",           # 子代理目标
    context="...",        # 可选上下文
    toolsets=[...],       # 委派的工具集
    role="leaf"           # leaf (受限) 或 orchestrator (可再委派)
  )

  批量模式:
    delegate_task(tasks=[{goal, context}, ...])  → 并行子代理

  配置:
    delegation.max_concurrent_children: 3
    delegation.max_spawn_depth: 2
    delegation.child_timeout_seconds: ...
    delegation.subagent_auto_approve: bool

  执行模型:
    - 同步——父代理等待子代理完成
    - 隔离上下文 + 独立终端后端
    - 非持久——需用 cronjob 做持久任务
    - 中断传播——父中断自动传给所有活跃子代理

Cabinet 委派 (AgentDispatcher + Daemon):
  Dispatcher:
    dispatch(mode, roles, request)
      Single:    单个 AgentLoop（特定角色）
      Pipeline:  角色序列
      Parallel:  多角色并发 + ResultSynthesizer

  Daemon（外部 Agent）:
    CLI Adapter + A2A Connector
    - pull-mode 任务队列
    - 3s 轮询 / WebSocket 推送
    - 3 并发任务上限
```

### 8.2 功能对比

| 对比点         | Hermes Agent                                    | Cabinet                                       | 评价                                                    |
| -------------- | ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| **触发方式**   | ✅ Agent 自主调用 `delegate_task` 工具          | 外部 Dispatcher.dispatch() + Daemon 任务队列  | **Hermes 更灵活**——Agent 自主判断何时委派               |
| **并行模式**   | ✅ 批量 tasks: [...] 并行 + ThreadPoolExecutor  | ✅ Parallel 模式 + ResultSynthesizer 去重合并 | 各有千秋                                                |
| **角色限制**   | leaf（受限工具）vs orchestrator（可再委派）     | 3 个内置角色 + 自定义角色                     | Cabinet 的角色系统更完善                                |
| **深度限制**   | ✅ `max_spawn_depth`——防止无限委派              | ❌ 无显式深度限制                             | **Hermes 更安全**                                       |
| **超时管理**   | ✅ `child_timeout_seconds`                      | ✅ AgentDaemon 300s；AgentLoop 无             | Hermes 的子代理超时更明确                               |
| **审批门控**   | ✅ `subagent_auto_approve`——可要求 Captain 审批 | ✅ DelegationTier + SafetyChecker             | 各有千秋                                                |
| **持久性**     | ❌ 明确非持久——需用 cronjob                     | ✅ Daemon pull-mode——任务可在后台长期运行     | **Cabinet 更好**——Daemon 的任务队列适合长时间运行的任务 |
| **中断传播**   | ✅ 父中断 → 所有活跃子代理                      | ❌ 无                                         | **Hermes 更好**                                         |
| **上下文隔离** | ✅ 独立上下文 + 独立终端后端                    | ✅ 独立 AgentLoop + 共享 memorySessionId      | 一致                                                    |
| **外部 Agent** | ❌ 无                                           | ✅ CLI/A2A Adapter——连接外部 Agent 生态       | **Cabinet 独有**                                        |

### 8.3 建议

1. **P1：增加 spawn 深度限制**——参考 Hermes 的 `max_spawn_depth`
2. **P1：增加中断传播**——父 Agent 被中断时，自动取消所有活跃子代理
3. **P2：增加子代理审批门控**——某些操作需要、某些可自动批准
4. **保持 Cabinet 独有的 Daemon + Squad + Interactive 子代理**——这些是独特优势

---

## 九、上下文压缩与管理对比

### 9.1 压缩策略

```
Hermes ContextCompressor (context_compressor.py):
  Phase 1 — 工具结果裁剪（无 LLM）:
    去重相同工具结果 (MD5 hash)
    替换大型工具输出 (>200 chars) 为一行摘要
    截断大型 tool_call 参数 (>500 chars) 保留 JSON 有效性
    移除旧 computer_use 截图

  Phase 2 — 边界选择:
    保护 head（系统提示词 + protect_first_n 消息）
    保护 tail（token 预算内 + 至少 3 条）
    对齐边界（不拆分 tool_call/tool_result 对）
    确保最后 user message 在 tail 中

  Phase 3 — LLM 摘要:
    结构化 prompt（Goal, Completed Actions, Active State, Key Decisions, etc.）
    时序锚定（将相对引用转为过去式事实）
    迭代更新（再次压缩时更新已有摘要）
    Token 比例预算（20%，min 2000, max 12000）

  Phase 4 — 组装与防抖:
    连续两次压缩节省 <10% → 跳过

  特殊处理:
    图片处理（>1600 token 估计 → 占位符替换）
    模型降级（辅助模型失败 → 主模型 → 兜底文本摘要）

Cabinet ContextHandoff + ContextMonitor:
  ContextMonitor:
    估算 token 使用量
    跟踪区间（smart/warning/critical/dumb）
    记录区间穿越

  ContextHandoff:
    跟踪已完成步骤、决策、事实、工具结果
    生成结构化交接文档
    重置消息列表

  AdaptiveContextMonitor:
    基于历史指标动态调整阈值
    按任务类别分类
```

### 9.2 功能对比

| 对比点               | Hermes Agent                                                             | Cabinet                                                            | 评价                                                                             |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **触发机制**         | ✅ 自动（`should_compress()` 每次 turn 检查 75% 阈值）+ 手动 `/compress` | ✅ ContextMonitor 监控 + ContextHandoff 触发（critical/dumb 区间） | 各有千秋                                                                         |
| **压缩策略**         | ✅ **LLM 结构化摘要**——保留 Goal/Actions/State/Decisions/Blockers        | ✅ **交接文档**——为下一个 Agent 生成结构化上下文                   | Hermes 更侧重于"同一 Agent 的持续压缩"；Cabinet 更侧重于"Agent 之间的上下文传递" |
| **工具结果裁剪**     | ✅ **无 LLM 的廉价预裁剪**——去重、摘要、截断                             | ✅ ToolExecutor.summarizeToolResult()——按条数/长度截断             | **Hermes 更好**——裁剪粒度更细（200 chars 阈值、MD5 去重、保留 JSON 有效性）      |
| **边界保护**         | ✅ 严格保护 head/tail + 边界对齐 + 最后 user message 确保保留            | ✅ 最后 4 条消息进入交接文档                                       | **Hermes 更好**——边界保护逻辑更精密                                              |
| **迭代压缩**         | ✅ 再次压缩时更新已有摘要（保持连续性）                                  | ❌ 无——每次交接是独立的                                            | **Hermes 更好**——避免信息在多次压缩中丢失                                        |
| **防抖**             | ✅ 连续两次压缩节省 <10% → 跳过                                          | ❌ 无                                                              | **Hermes 更好**——避免不必要的压缩开销                                            |
| **图片处理**         | ✅ 替换旧截图为占位符（1600 token 估计）                                 | ❌ 无                                                              | **Hermes 更好**——处理多模态场景                                                  |
| **模型降级**         | ✅ 辅助模型失败 → 主模型 → 兜底文本摘要                                  | ❌ 无降级链                                                        | **Hermes 更好**——压缩本身也需要容错                                              |
| **Focus Topic**      | ✅ `/compress <focus>`——引导压缩优先保留特定主题                         | ❌ 无                                                              | **Hermes 更好**                                                                  |
| **Token 自适应预算** | ✅ 20% 比例预算（min 2000, max 12000）                                   | ❌ 固定 budget                                                     | **Hermes 更好**——按上下文大小自适应                                              |
| **Preflight 检查**   | ✅ `should_compress_preflight()`——API 调用前的快速粗略检查               | ❌ 无                                                              | **Hermes 更好**                                                                  |

### 9.3 建议

1. **P1：升级上下文压缩策略**——这是 Cabinet 和 Hermes 差距最大的领域之一。参考 Hermes 实现：
   - 无 LLM 的工具结果预裁剪（去重、阈值截断、JSON 保留）
   - LLM 结构化摘要（Goal/Completed/Actions/State/Decisions）
   - 迭代压缩（更新已有摘要）
   - Token 自适应预算
2. **P1：增加防抖逻辑**——避免在节省很少时触发压缩
3. **P2：增加 Focus Topic 引导压缩**——让用户或 Agent 指定要保留的关键主题

---

## 十、Gateway / 多 Provider 对比

### 10.1 架构对比

```
Hermes Transport 层:
  transports/
    ├── anthropic.py        → Anthropic Messages API
    ├── chat_completions.py → OpenAI Chat Completions API
    ├── bedrock.py          → AWS Bedrock Converse
    ├── codex.py            → OpenAI Codex Responses API
    └── types.py            → 共享类型

  Model Provider 插件:
    plugins/model-providers/ → 每个推理后端一个插件
    ProviderProfile(name, provider_type, base_url, ...)

  支持的 300+ 模型:
    Nous Portal, OpenRouter, NovitaAI, NVIDIA NIM,
    Xiaomi MiMo, z.ai/GLM, Kimi/Moonshot, MiniMax,
    Hugging Face, OpenAI, Anthropic, Google, DeepSeek...

  更改模型: /model 命令（无代码改动，无锁定）

Cabinet Gateway:
  AISDKAdapter implements LLMGateway:
    - 8 个 Provider（通过 Vercel AI SDK）
    - ModelRouter（4 级路由）
    - FallbackChain（指数退避 + 模型降级）
    - CostTracker（RMB 定价）
    - BudgetGuard（日/周/月预算）
    - RateLimitTracker
```

| 对比点                | Hermes Agent                                                              | Cabinet                                                    | 评价                                            |
| --------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| **Provider 数量**     | **300+ 模型**（通过 6+ Provider 类型）                                    | 8 个 Provider，23 个模型                                   | **Hermes 遥遥领先**——模型灵活性是核心卖点       |
| **Provider 扩展**     | Model Provider 插件系统——新后端作为插件安装                               | 显式 ProviderConfig 注册 + createOpenAICompatible 通用适配 | **Hermes 更灵活**——插件化 Provider 是更优的架构 |
| **模型切换**          | `/model` 运行时切换，无代码改动                                           | 运行时选择 + 4 级角色路由                                  | Hermes 的用户体验更好                           |
| **成本追踪**          | ✅ `usage_pricing.py` + `credits_tracker.py` + `account_usage.py`         | ✅ CostTracker（RMB 单价表）+ BudgetGuard                  | 各有千秋                                        |
| **Rate Limit 守卫**   | ✅ `nous_rate_guard.py`——跨会话 rate limit 协调 + `rate_limit_tracker.py` | ✅ RateLimitTracker（解析 HTTP 响应头）                    | 各有千秋                                        |
| **Fallback**          | ✅ 运行时自动 Fallback——retry 耗尽后自动切换 provider                     | ✅ FallbackChain——初始化时配置的降级链                     | **Hermes 更灵活**——运行时发现 Fallback          |
| **Credential Pool**   | ✅ `credential_pool.py`——多 API Key 池化 + 轮转                           | ❌ 单 Key 模式                                             | **Hermes 更好**——避免单 Key 的 rate limit       |
| **Credential 持久化** | ✅ `credential_persistence.py`——加密持久化                                | ✅ AES-256 加密存储                                        | 一致                                            |

### 10.2 建议

1. **P2：Model Provider 插件化**——参考 Hermes 的 Model Provider Plugin 系统，让新 Provider 可以通过插件安装
2. **P2：增加 Credential Pool**——多 API Key 轮转避免 rate limit
3. **P2：增加运行时 Fallback**——在 retry 耗尽后自动尝试下一个可用 Provider
4. **保持 Cabinet 的 CostTracker + BudgetGuard**——这是独特优势

---

## 十一、IM 频道 / 消息网关对比

### 11.1 平台覆盖

| 平台                      | Hermes Agent           | Cabinet     |
| ------------------------- | ---------------------- | ----------- |
| **CLI**                   | ✅ 原生 TUI + 基本 CLI | ✅ 基本 CLI |
| **Telegram**              | ✅                     | ❌          |
| **Discord**               | ✅（含语音频道）       | ❌          |
| **Slack**                 | ✅                     | ❌          |
| **WhatsApp**              | ✅                     | ❌          |
| **Signal**                | ✅                     | ❌          |
| **Matrix**                | ✅                     | ❌          |
| **Mattermost**            | ✅                     | ❌          |
| **Email**                 | ✅                     | ❌          |
| **SMS**                   | ✅                     | ❌          |
| **钉钉 (DingTalk)**       | ✅                     | ❌          |
| **飞书 (Feishu)**         | ✅                     | ❌          |
| **企业微信 (WeCom)**      | ✅                     | ❌          |
| **微信 (Weixin)**         | ✅                     | ❌          |
| **QQ Bot**                | ✅                     | ❌          |
| **Microsoft Teams**       | ✅                     | ❌          |
| **Google Chat**           | ✅                     | ❌          |
| **Home Assistant**        | ✅                     | ❌          |
| **BlueBubbles**           | ✅                     | ❌          |
| **Yuanbao**               | ✅                     | ❌          |
| **Webhook（入站）**       | ❌                     | ✅          |
| **A2A（Agent-to-Agent）** | ❌                     | ✅          |

### 11.2 架构对比

```
Hermes 消息网关:
  gateway/
    ├── delivery.py       → DeliveryRouter（fan-out 消息总线）
    ├── run.py            → Gateway 运行器
    ├── session.py        → Gateway 会话管理
    ├── pairing.py        → DM 配对
    ├── platforms/        → 20+ 平台适配器
    │   ├── telegram.py
    │   ├── discord.py
    │   ├── slack.py
    │   ├── whatsapp.py
    │   ├── signal.py
    │   ├── matrix.py
    │   └── ...
    └── hooks.py          → Gateway 钩子系统

  关键特性:
    - 单进程服务 20+ 平台
    - 语音消息转录
    - 跨平台对话连续性
    - 反循环守卫（silence narration 过滤）
    - 消息截断门控（4000 chars → 3800 + 完整文件）

Cabinet:
  无 IM 频道集成
  通过 Tauri Desktop + Web UI 交互
  + Webhook 入站 + A2A 协议
```

### 11.3 分析

Hermes 在 IM 频道覆盖上**全面碾压**。这是一个"IM-first"的设计——用户可以在任何常用聊天工具中使用 AI。

Cabinet 没有 IM 集成，依赖桌面应用和 Web UI 交互。这适合"坐在电脑前工作"的场景，但不适合移动端或碎片化交互。

### 11.4 建议

1. **P3：如果需要 IM 集成**，Hermes 的 DeliveryRouter fan-out 架构和 20+ 平台适配器是最佳参考
2. **P3：反循环守卫**——如果要支持 IM bot，Hermes 的 silence narration filter 是必需的
3. **保持 Cabinet 的 A2A 和 Webhook**——这些是 Hermes 没有的能力

---

## 十二、调度与自动化对比

### 12.1 架构对比

```
Hermes Cron 调度器:
  cron/
    ├── scheduler.py      → 调度引擎
    └── jobs.py           → 任务定义

  特性:
    - 内置 cron 表达式 + 自然语言定义（"every monday 9am"）
    - 投递到任意 IM 平台
    - 3 分钟硬中断
    - 追赶窗口（半周期，限制 120s-2h）
    - 文件锁防止重复 tick
    - 默认 skip_memory=True（cron 任务不污染记忆）

Cabinet 调度器:
  自研 TaskScheduler（apps/server/src/scheduler.ts）
   + Autopilot（cron/webhook/manual 触发器）
   + Daemon（pull-mode 任务队列）
```

| 对比点           | Hermes Agent                                             | Cabinet           | 评价                      |
| ---------------- | -------------------------------------------------------- | ----------------- | ------------------------- |
| **自然语言调度** | ✅ "every monday 9am" / "daily at 7pm" → 自动解析为 cron | ❌ 仅 cron 表达式 | **Hermes 更好**——用户友好 |
| **跨平台投递**   | ✅ 投递到任意连接的 IM 平台                              | ❌ 仅内部         | **Hermes 更好**           |
| **硬中断**       | ✅ 3 分钟硬中断防止失控                                  | ❌ 无             | **Hermes 更安全**         |
| **去重保护**     | ✅ 文件锁 + 追赶窗口                                     | ❌ 未明确         | **Hermes 更好**           |
| **记忆隔离**     | ✅ `skip_memory=True`——cron 任务不污染记忆               | ❌ 无             | **Hermes 更好**           |
| **Webhook 触发** | ❌ 无                                                    | ✅ HMAC 安全令牌  | **Cabinet 独有**          |

### 12.2 建议

1. **P2：支持自然语言调度**——用户说"每天早上 9 点"而不是写 cron 表达式
2. **P2：增加调度任务的硬中断和去重保护**
3. **P2：增加调度任务记忆隔离**——可选地不将 cron 执行结果写入长期记忆

---

## 十三、插件系统对比

### 13.1 架构对比

```
Hermes 插件系统:
  PluginManager:
    发现来源: ~/.hermes/plugins/ + ./.hermes/plugins/ + pip entry points
    注册钩子:
      - pre_tool_call / post_tool_call
      - pre_llm_call / post_llm_call
      - on_session_start / on_session_end
    注册工具: ctx.register_tool()
    注册 CLI 命令: ctx.register_cli_command()
    规则: 插件绝不能修改核心文件

  Memory Provider 插件:
    MemoryProvider ABC
    生命周期: sync_turn, prefetch, shutdown, post_setup
    策略: 内置 Memory Provider 集合已关闭 (2026-05)

  Model Provider 插件:
    ProviderProfile 注册
    用户插件覆盖内置插件 (last-writer-wins)

Cabinet 插件系统:
  无独立插件系统
  扩展方式:
    - Observer Pipeline（生命周期钩子）
    - MCP 工具/资源/提示词发现
    - A2A 外部 Agent 协议
    - Skill Registry
```

| 对比点          | Hermes Agent                                             | Cabinet                                   | 评价                                          |
| --------------- | -------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| **通用插件**    | ✅ PluginManager——生命周期钩子 + 工具注册 + CLI 命令注册 | ❌ 无——通过 Observer + MCP + A2A 间接实现 | **Hermes 更好**——插件是一等公民               |
| **Memory 插件** | ✅ MemoryProvider ABC——可替换记忆后端                    | ❌ 无——MemoryFacade 是单一实现            | **Hermes 更好**                               |
| **Model 插件**  | ✅ ProviderPlugin——可安装新推理后端                      | ❌ 无——需修改 AISDKAdapter 源码           | **Hermes 更好**                               |
| **规则**        | ✅ "插件绝不能修改核心文件"——扩展面清晰                  | ❌ 无插件规则                             | Hermes 的插件边界更明确                       |
| **发现机制**    | ✅ 多来源自动发现（目录 + pip entry points）             | ✅ fs.watch 热重载 skills/agents/rules    | Hermes 的 pip entry points 是更标准的发现机制 |

### 13.2 建议

1. **P2：引入通用插件系统**——参考 Hermes 的 PluginManager，为 Lifecycle Hooks + Tool Registration + CLI Command Registration 提供标准接口
2. **P3：Memory Provider 插件化**——让记忆后端（向量数据库、外部知识库等）可以通过插件替换
3. **P3：Model Provider 插件化**——新推理后端作为插件安装

---

## 十四、安全机制对比

### 14.1 完整对比

| 安全域           | Hermes Agent 机制                                                                                           | Cabinet 机制                                                  | 差距                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| **命令审批**     | ✅ Command approval——执行前可要求审批                                                                       | ✅ SafetyChecker + DelegationTier                             | 各有千秋                                         |
| **容器隔离**     | ✅ Container isolation（Docker/Singularity 后端）                                                           | ❌ 无沙箱                                                     | **Hermes 更好**                                  |
| **终端后端隔离** | ✅ 6 种终端后端（local/Docker/SSH/Daytona/Singularity/Modal）——其中 Docker/Singularity/Modal 提供容器级隔离 | ❌ 仅宿主机                                                   | **Hermes 更好**                                  |
| **文件安全**     | ✅ `file_safety.py`——文件操作安全检查                                                                       | ✅ SafetyChecker 按 DelegationTier 分级                       | 各有千秋                                         |
| **工具护栏**     | ✅ `tool_guardrails.py`——工具调用前后的护栏检查                                                             | ✅ ContentGuardObserver + SafetyCheckObserver                 | 各有千秋                                         |
| **注入检测**     | ✅ `_scan_context_content()`——SOUL.md 和上下文文件的 prompt injection 扫描                                  | ✅ ContentGuardObserver——用户输入和 LLM 输出                  | Hermes 覆盖上下文文件；Cabinet 覆盖实时输入/输出 |
| **反循环**       | ✅ silence narration 过滤 + 调度硬中断                                                                      | ❌ 无                                                         | **Hermes 更好**                                  |
| **危险命令检测** | ❌ 未明确                                                                                                   | ✅ utils/security.ts 黑名单（rm -rf, dd, mkfs, chmod 777 等） | **Cabinet 更好**                                 |
| **API Key 加密** | ✅ `credential_persistence.py`                                                                              | ✅ AES-256 加密存储                                           | 一致                                             |
| **认证**         | Gateway 平台认证（各平台原生）                                                                              | origin-based（仅 localhost/Tauri/file）                       | 场景不同                                         |
| **速率限制**     | ✅ `nous_rate_guard.py` + `rate_limit_tracker.py`                                                           | ✅ RateLimiter（100 req/min per IP）                          | 各有千秋                                         |
| **网络出站隔离** | ✅ `docs/security/network-egress-isolation.md`——文档化网络隔离策略                                          | ❌ 未明确                                                     | **Hermes 更好**                                  |
| **秘密来源**     | ✅ `secret_sources/bitwarden.py`——集成外部秘密管理器                                                        | ❌ 无                                                         | **Hermes 更好**                                  |

### 14.2 分析

Hermes 在**执行环境保护**（6 种终端后端，其中 Docker/Singularity/Modal 提供容器隔离）上做得更好。Cabinet 在**用户侧安全**（工具分级、输入过滤、危险命令检测）上做得更好。

但两者都没有 DeerFlow 那样的 ClarificationMiddleware 和 LoopDetectionMiddleware——这也是 Cabinet 可以补齐的方向。

### 14.3 建议

1. **P2：增加命令审批机制**——参考 Hermes 的 command approval 模式
2. **P2：集成外部秘密管理器**——参考 Hermes 的 Bitwarden 集成
3. **保持 Cabinet 的危险命令检测和工具分级**——这些是优势

---

## 十五、用户界面与交互对比

### 15.1 界面覆盖

| 界面类型          | Hermes Agent                                                                             | Cabinet                                       |
| ----------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| **CLI**           | ✅ Rich + prompt_toolkit（多行编辑、自动补全、历史）                                     | ✅ 基本 CLI                                   |
| **TUI**           | ✅ **Ink (React) TUI**——TypeScript 前端 + Python JSON-RPC 后端                           | ❌ 无                                         |
| **Electron 桌面** | ✅ **独立 Electron 桌面应用**——React + nanostores + @assistant-ui/react                  | ✅ **Tauri 桌面应用**——Rust 后端 + React 前端 |
| **Web Dashboard** | ✅ 嵌入真实 TUI（ptyprocess + WebSocket）                                                | ✅ Hono Server + 前端路由                     |
| **语音**          | ✅ CLI/Telegram/Discord 语音模式 + 语音备忘录转录                                        | ❌ 无                                         |
| **斜杠命令**      | ✅ `/model`, `/new`, `/retry`, `/undo`, `/compress`, `/skills`, `/steer`, `/insights` 等 | ✅ `/skill-name`                              |
| **交互式子代理**  | ❌ 无                                                                                    | ✅ OrganizeInteractiveAgent（多轮交互）       |

### 15.2 TUI 架构对比

```
Hermes TUI:
  hermes --tui
    └─ Node (Ink React) ──stdio JSON-RPC── Python (tui_gateway)
         │                                    └─ AIAgent + tools + sessions
         └─ 渲染：transcript, composer, prompts, activity

  Dashboard:
    嵌入真实 TUI via ptyprocess + WebSocket
    "Do not re-implement the primary chat experience in React"
    → 结构化的 React UI 围绕 TUI（侧边栏、检查器等）

Cabinet Desktop:
  Tauri (Rust)
    └─ React 前端
         └─ 通过 Hono Server API 通信
```

| 对比点       | Hermes Agent                                                       | Cabinet                 | 评价                                                           |
| ------------ | ------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------- |
| **TUI 策略** | ✅ **复用 TUI 作为核心聊天界面**——Dashboard 嵌入真实 TUI，不做重写 | ❌ 无 TUI——桌面应用独占 | Hermes 的 TUI 策略保证终端和 Web 体验一致                      |
| **桌面应用** | Electron + React                                                   | Tauri + React           | Cabinet 的 Tauri 更轻量（Rust 后端 < 10MB vs Electron ~150MB） |
| **语音支持** | ✅ 多平台语音模式                                                  | ❌ 无                   | **Hermes 更好**                                                |

### 15.3 建议

1. **P3：如果需要跨平台一致的聊天体验**——参考 Hermes 的 TUI → WebSocket 嵌入策略
2. **P3：增加语音支持**——如果需要

---

## 十六、工程纪律与质量保障对比

### 16.1 完整对比

| 对比点                            | Hermes Agent                                                                               | Cabinet                             | 评价                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------- |
| **测试数量**                      | ~17,000 测试（~900 文件）                                                                  | 大量测试（每个包都有 `__tests__/`） | **Hermes 测试规模巨大**                               |
| **测试框架**                      | pytest（Python）                                                                           | Vitest（TypeScript）                | 语言差异                                              |
| **测试隔离**                      | ✅ **子进程隔离**（`multiprocessing.spawn`）——每个测试在独立 Python 子进程中运行，30s 超时 | ✅ Vitest 默认隔离                  | Hermes 的子进程隔离更彻底                             |
| **CI/CD**                         | 15+ GitHub Actions workflow                                                                | .github/workflows/                  | Hermes 的 CI 覆盖面更广                               |
| **代码检查**                      | ruff + mypy                                                                                | eslint + tsc --noEmit               | 一致                                                  |
| **Pre-commit**                    | 通过 CI 强制                                                                               | .husky/                             | 一致                                                  |
| **设计文档**                      | 在线文档 + AGENTS.md（非常详细的开发指南）                                                 | docs/ + deliverables/ + CABINET.md  | **Hermes 的 AGENTS.md 极其详细**——800+ 行的开发者手册 |
| **Architecture Decision Records** | ✅ `.plans/` 目录 + AGENTS.md 中内嵌设计原理                                               | ❌ 无显式 ADR                       | **Hermes 更好**                                       |
| **模块行数限制**                  | 无显式规则（核心 AIAgent 12K LOC）                                                         | ✅ 500 行上限/文件，800 行硬上限    | **Cabinet 更好**——有明确的代码健康规则                |
| **架构校验**                      | ❌ 无自动校验                                                                              | ✅ `lint:arch` 自动验证 4 层依赖    | **Cabinet 更好**                                      |
| **控制论自评**                    | ❌ 无                                                                                      | ✅ 8 条 VSM 原则，目标 88/100       | **Cabinet 独有**                                      |
| **依赖锁定**                      | ✅ **极其严格**：PyPI `>=floor,<next_major`，Git `commit SHA`，CI 用 `==exact`             | pnpm-lock.yaml（标准锁定）          | Hermes 的锁定策略更严格                               |
| **依赖审计**                      | ✅ `osv-scanner.yml` + `supply-chain-audit.yml`                                            | ❌ 未明确                           | **Hermes 更好**                                       |
| **贡献指南**                      | ✅ **AGENTS.md 极其详细**——包含设计哲学、代码结构、添加工具的步骤、测试约定、已知陷阱      | CONTRIBUTING.md + CABINET.md        | **Hermes 的 AGENTS.md 是标杆级的**                    |
| **安装体验**                      | ✅ **一键安装**（`curl \| bash`）+ 安装向导 + `hermes doctor`                              | pnpm install + pnpm build           | **Hermes 的安装体验更好**                             |
| **自主更新**                      | ✅ `hermes update`                                                                         | ❌ 无                               | **Hermes 更好**                                       |

### 16.2 Hermes 的 AGENTS.md 质量分析

Hermes 的 AGENTS.md（约 800 行）是开发者文档的标杆：

1. **设计哲学明确**：Prompt 缓存不可侵犯 + 窄腰设计——每个开发者都理解什么能做、什么不能做
2. **代码结构清晰**：每个文件/目录的职责一句话说明
3. **操作指南详细**：添加新工具的完整步骤（从 footprint ladder 到 toolset 注册到测试）
4. **反模式明确**："What Gets Rejected" 列出了不会接受的上游贡献类型
5. **已知陷阱记录**：`_last_resolved_tool_names` 临时过时、squash merge 风险等
6. **测试约定**：不写 change-detector 测试，测试 invariant 而非具体值

### 16.3 建议

1. **P1：编写 Cabinet 的 AGENTS.md**——参考 Hermes 的 AGENTS.md 格式，内容覆盖：
   - 设计哲学与不变约束
   - 代码结构地图
   - 添加新 Agent/Observer/Tool 的完整步骤
   - 已知陷阱与反模式
   - 测试约定
2. **P1：增加依赖审计**——在 CI 中增加安全依赖扫描
3. **P2：改进安装体验**——支持一键安装脚本
4. **P2：增加自主更新**——`cabinet update` 命令
5. **保持 Cabinet 的架构校验和行数限制**——这些是独特优势

---

## 十七、关键设计差异总结表

| 设计维度             | Hermes Agent 优势                                                          | Cabinet 优势                                              | 建议优先级                                      |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| **Agent 执行**       | 中断/Steer 机制 + 重试极其健壮 + 流式优先                                  | async 模式 + Observer Pipeline + 工具分类并行             | P1：增加中断和 Steer 机制                       |
| **提示词工程**       | SOUL.md + 平台感知 + 环境感知 + 模型专属指导 + Prompt 缓存优先             | 分层构建 + RAG 注入 + MCP 元数据                          | P1：支持 SOUL.md 和模型专属指导                 |
| **工具系统**         | Toolset 分组 + 条件启用 + tool_search + 中间件管道                         | ToolPruner 动态裁剪 + 工具分类执行                        | P1：Toolset 分组和条件启用                      |
| **Skill 系统**       | **自主创建 + Curator 生命周期 + agentskills.io Hub + 条件显示 + 两层缓存** | 三级渐进加载 + 变量替换 + 类型区分 + 作用域               | **P1：自主创建 Skill**——Hermes 的核心差异化能力 |
| **记忆**             | FTS5 会话搜索 + 插件化 + 自主提示 + Honcho 用户建模                        | WriteGate + 知识图谱 + 向量搜索 + 记忆衰减 + 项目管理记忆 | P1：会话全文搜索 P2：Memory 插件化              |
| **上下文压缩**       | **LLM 结构化摘要 + 工具结果预裁剪 + 迭代压缩 + 防抖 + Focus Topic**        | 交接文档 + 上下文监控                                     | **P1：升级压缩策略**——最大差距领域之一          |
| **委派**             | Agent 自主 + 深度限制 + 中断传播 + 审批门控                                | 结构化调度 + Daemon + Squad + 外部 Agent                  | P1：深度限制和中断传播                          |
| **Gateway/Provider** | **300+ 模型 + Provider 插件化 + Credential Pool + 运行时 Fallback**        | CostTracker + BudgetGuard + RateLimitTracker              | P2：Provider 插件化和 Credential Pool           |
| **IM 频道**          | **20+ 平台（单进程）**                                                     | ❌ 无                                                     | P3：按需参考                                    |
| **调度**             | 自然语言调度 + 跨平台投递 + 硬中断                                         | Webhook + Autopilot + Daemon                              | P2：自然语言调度                                |
| **插件系统**         | **通用 Plugin + Memory Provider + Model Provider**                         | Observer Pipeline + MCP + A2A                             | P2：通用插件系统                                |
| **安全**             | 6 种终端后端（含容器隔离）+ 命令审批                                       | 工具分级 + 输入过滤 + 危险命令检测 + AES-256              | P2：命令审批                                    |
| **UI**               | TUI + Electron + Web + 语音                                                | Tauri Desktop + Web UI                                    | 各有优势                                        |
| **工程纪律**         | **17K 测试 + 子进程隔离 + 依赖严格锁定 + AGENTS.md 标杆**                  | 架构校验 + 行数限制 + 控制论自评                          | P1：编写 AGENTS.md P1：依赖审计                 |
| **安装/更新**        | **一键安装 + hermes update + hermes doctor**                               | pnpm install                                              | P2：改进安装体验                                |

---

## 十八、优先级改进建议

### P0 — 安全紧急（立即执行）

从 Hermes 对比中，没有发现新的 P0 安全差距（在 DeerFlow 对比中已识别的 Sandbox、Clarification、LoopDetection 仍是最高优先级）。Hermes 的容器隔离后端验证了 Sandbox 的重要性。

### P1 — 架构增强（1-2 周）

| #   | 改进项                                | 参考 Hermes 模块                                                            | 工作量       | 实施方案                                                                                                 |
| --- | ------------------------------------- | --------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | **Agent 自主创建 Skill**              | `skill_commands.py` + Agent 的 `skill_manage` 工具                          | 中（3-5 天） | 新增 `create_skill` 工具。Agent 完成复杂任务后调用。写入 `~/.cabinet/skills/`。标记 `createdBy: "agent"` |
| 2   | **Agent 自主 spawn 子代理**           | `delegate_task.py` + Agent 的 `delegate_task` 工具                          | 中（3-5 天） | 增加 `delegate_task(goal, context, toolsets)` 工具。支持深度限制和中断传播                               |
| 3   | **升级上下文压缩**                    | `context_compressor.py` 完整实现                                            | 大（1-2 周） | 实现 4 阶段压缩：工具结果预裁剪 → 边界选择 → LLM 结构化摘要 → 防抖。这是差距最大的领域                   |
| 4   | **中断机制**                          | `_interrupt_requested` + `_interrupt_thread_signal_pending` + 每 200ms 轮询 | 中（3-5 天） | 为 `AgentLoop` 增加 `AbortController`。在工具循环的每个 await 点检查中断信号                             |
| 5   | **会话全文搜索**                      | `session_search` 工具（FTS5）                                               | 小（1-2 天） | 在 SessionDB 中启用 FTS5 索引。新增 `session_search` 工具                                                |
| 6   | **编写 AGENTS.md**                    | AGENTS.md 格式和内容                                                        | 中（2-3 天） | 覆盖：设计哲学、代码地图、添加 Agent/Observer/Tool 的步骤、已知陷阱、测试约定                            |
| 7   | **增加依赖审计**                      | `osv-scanner.yml` + `supply-chain-audit.yml`                                | 小（1 天）   | 在 CI 中增加 `pnpm audit` + `osv-scanner`                                                                |
| 8   | **ToolDefinition 增加 category 属性** | Toolset 分组                                                                | 小（1 天）   | 替换硬编码 `READ_TOOL_NAMES` Set。支持按 toolset 分组启用/禁用                                           |

### P2 — 体验优化（按需）

| #   | 改进项                     | 参考 Hermes 模块                                         | 工作量       | 实施方案                                                          |
| --- | -------------------------- | -------------------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| 9   | **Steer 机制**             | `/steer` + `_pending_steer` + `_pending_steer_lock`      | 小（1-2 天） | 增加非中断式的中途引导注入                                        |
| 10  | **Memory Provider 插件化** | `memory_provider.py` MemoryProvider ABC                  | 中（3-5 天） | 定义 MemoryProvider 接口。支持外部记忆后端插件                    |
| 11  | **Model Provider 插件化**  | `plugins/model-providers/`                               | 中（3-5 天） | Provider 插件注册机制                                             |
| 12  | **自然语言调度**           | Cron "every monday 9am" → cron parser                    | 小（1-2 天） | 增加自然语言到 cron 的解析                                        |
| 13  | **支持 SOUL.md / USER.md** | `system_prompt.py` 中的 load_soul_md()                   | 小（1-2 天） | 加载 `~/.cabinet/SOUL.md` 和 `~/.cabinet/USER.md`，注入系统提示词 |
| 14  | **Credential Pool**        | `credential_pool.py`                                     | 小（1-2 天） | 支持多 API Key 轮转                                               |
| 15  | **Skill 条件显示**         | `fallback_for_toolsets` / `requires_toolsets` / 平台过滤 | 小（1-2 天） | 根据工具可用性和平台过滤 Skill 可见性                             |
| 16  | **改进安装体验**           | `install.sh` 一键脚本                                    | 中（2-3 天） | 一键安装脚本 + `cabinet doctor` 诊断命令                          |
| 17  | **工具搜索**               | `tool_search`                                            | 小（1-2 天） | 让 Agent 可以按名称/描述搜索工具                                  |

### P3 — 战略方向（长期）

| #   | 改进项                  | 参考 Hermes 模块               | 说明                                                           |
| --- | ----------------------- | ------------------------------ | -------------------------------------------------------------- |
| 18  | **Skill 生命周期管理**  | `curator.py`——Curator 后台审查 | 自动 stale/archive、LLM 合并审查、伞 Skill 创建                |
| 19  | **通用插件系统**        | `plugins/`——PluginManager      | Lifecycle Hooks + Tool Registration + CLI Command Registration |
| 20  | **IM 频道**             | `gateway/platforms/`           | 如需支持 Telegram/飞书/微信等                                  |
| 21  | **TUI 界面**            | `ui-tui/` + `tui_gateway/`     | Ink React TUI——更丰富的终端交互                                |
| 22  | **agentskills.io 兼容** | agentskills.io 开放标准        | Cabinet Skill 格式兼容 agentskills.io，可复用社区 Skill        |
| 23  | **语音支持**            | 多平台语音模式                 | CLI/桌面语音交互                                               |

---

## 十九、结论

### 19.1 总体评价

**Hermes Agent** 是一个成熟度极高的**个人 AI 助手操作系统**。它的优势在于：

- **闭环学习**（Agent 自主创建 Skill → Curator 管理生命周期 → Skill 在使用中自我改进）——这是它最独特的架构特性
- **上下文压缩极其精密**（4 阶段、LLM 结构化摘要、迭代压缩、防抖、边界保护）
- **300+ 模型支持** + Provider 插件化 + Credential Pool
- **20+ IM 平台**单进程覆盖
- **工程纪律标杆级**（17K 测试、子进程隔离、严格依赖锁定、极其详细的 AGENTS.md）
- **安装体验极好**（一键安装、自主更新、doctor 诊断）
- **窄腰设计哲学清晰**——每行代码的取舍都有明确的设计原理

它的不足在于：

- 单体核心（AIAgent 12K LOC）——不利于多人协作
- 无分层架构——依赖方向没有形式化约束
- 无决策状态机——缺少项目级别的决策追踪
- 无工作流引擎——缺少结构化的多步骤流程编排
- 无成本预算控制——缺少 BudgetGuard
- 无知识图谱——缺少结构化的知识组织

**Cabinet** 的设计思想更先进的项目管理导向平台。对比场景差异：

- Hermes 适合"一个人 + 一个 AI 助手"的日常开发/运维/研究场景
- Cabinet 适合"一个人 + 一个 AI 内阁"的复杂项目管理和多 Agent 协作场景

### 19.2 核心行动

**三个最关键的改进：**

1. **P1：Agent 自主创建 Skill**——这是 Hermes 的核心差异化能力。让 Agent 可以从经验中学习并持久化知识，而不是每次从零开始
2. **P1：升级上下文压缩**——这是 Cabinet 和 Hermes 差距最大的领域。实现 4 阶段压缩，特别是 LLM 结构化摘要和工具结果预裁剪
3. **P1：编写 AGENTS.md**——Hermes 的开发者文档是标杆级的。Cabinet 需要同等质量的内部开发指南

**三个最具价值的改进：**

4. **P1：中断机制 + Steer 机制**——让用户可以随时引导和中断 Agent 执行
5. **P2：Memory Provider 插件化 + 会话全文搜索**——让记忆系统更灵活、更可查询
6. **P2：自然语言调度 + Credential Pool**——提升用户体验和可靠性

### 19.3 两项目的互补关系

Hermes Agent 和 Cabinet 是**互补而非竞争**关系：

| 维度     | Hermes 的优势                     | Cabinet 的优势                           |
| -------- | --------------------------------- | ---------------------------------------- |
| **交互** | 多 IM 平台 + TUI + 语音——随时随地 | 桌面应用 + Web UI——沉浸式工作            |
| **学习** | 自主创建 Skill + Curator 管理     | 控制论反馈 + Observer 管道               |
| **记忆** | FTS5 全文搜索 + 插件化 + Honcho   | WriteGate + 知识图谱 + 向量搜索          |
| **执行** | Cron + 委派 + 6 种后端            | Workflow + Decision + Daemon + Squad     |
| **治理** | 个人助手——Agent 自主决策          | 内阁——Decision L0-L3 升级 + Captain 审批 |

如果未来的 Cabinet 能像 Hermes 一样让 Agent 自主创建 Skill，同时 Hermes 能像 Cabinet 一样拥有 Decision 状态机和 Workflow 引擎——两者都将更接近"完美的 AI 伙伴"。

---

> 报告结束。如需针对某个具体模块编写详细实现方案，请指定模块名称。
