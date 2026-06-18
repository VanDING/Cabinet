# Cabinet v3 vs ADK-Rust — 全面对比报告

> 日期：2026-06-13
> 范围：逐子系统对比，涵盖 14 个维度
> 来源：[adk-rust](https://github.com/zavora-ai/adk-rust) v1.0.0，43 crates，Apache 2.0
> 方法：ADK-Rust 通过 docs.rs API 文档 + README + Cargo.toml workspace members 分析

---

## 项目概况

|                   | Cabinet v3         | ADK-Rust                  |
| ----------------- | ------------------ | ------------------------- |
| **定位**          | 聚焦 Coding Agent  | 通用 AI Agent 框架        |
| **语言**          | Rust edition 2024  | Rust                      |
| **Crate 数量**    | 18                 | 43                        |
| **版本**          | v0.1.0（设计阶段） | v1.0.0（semver 稳定承诺） |
| **下载量**        | —                  | 130K+（6 个月）           |
| **许可证**        | MIT                | Apache 2.0                |
| **冷启动**        | 目标 < 100ms       | 109ms（实测）             |
| **内存基线**      | 目标 < 80MB        | ~15MB RSS                 |
| **框架开销/turn** | —                  | ~568μs                    |

> ADK-Rust 的 43 crates 覆盖了语音、支付、浏览器、部署等 Coding Agent 不需要的领域。v3 的 18 crates 更精简——只做 Coding Agent。

---

## 一、类型与错误系统

| 维度                   | ADK-Rust                                                            | Cabinet v3                                                                       |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **类型架构**           | `adk-core` 统一类型 crate                                           | 3 个 types crate（cabinet-types + exec-types + gateway-types）                   |
| **Agent trait**        | `Agent` trait: `name()` + `description()` + `run()` → `EventStream` | `AgentLoop` struct（非 trait）                                                   |
| **Tool trait**         | `Tool` trait: `name()` + `description()` + `execute()`              | `ToolHandler` trait: `execute()` + `definition()` + `check_concurrency_safety()` |
| **ToolContext**        | `ToolContext` trait（可自定义实现）                                 | `ToolContext` struct（明确字段）                                                 |
| **错误系统**           | `AdkError` struct: `ErrorCategory` + `ErrorComponent`               | `CabinetError` trait: `code()` + `severity()` + `retryable()` + `user_message()` |
| **错误分类**           | `ErrorCategory` enum + `ErrorComponent` enum（哪个组件出错）        | 13 段错误码（AGENT/TOOL/GW/EXEC/...）+ `ErrorSeverity` 3 级                      |
| **Event 类型**         | `Event` struct（单一类型，包含 `LlmResponse`）                      | `SessionEvent` enum（15 variants）+ `AgentEvent` enum（14 variants，内存通信）   |
| **State 管理**         | `State` trait: KV 存储，`user:` / `app:` / `temp:` 三层前缀         | `SessionState` struct（强类型 schema-fixed）                                     |
| **Identity**           | 7 个 typed ID 类型（UserId, SessionId, InvocationId, AppName...）   | SessionId + TurnId（内联类型）                                                   |
| **Content 类型**       | `Content` / `Part` enum（Text, Image, Audio, FunctionCall...）      | `MessageContent` enum（Text, ToolCalls, ToolResult, MultiContent）               |
| **SchemaAdapter**      | `SchemaAdapter` trait：Provider 感知的 JSON Schema 规范化           | Provider format 适配器内部处理                                                   |
| **SchemaCache**        | ✅ `SchemaCache` struct：线程安全 schema 缓存                       | ❌                                                                               |
| **Callback 系统**      | `callbacks` 模块：扁平 callback 列表                                | Observer Pipeline：13 个 Observer，优先级 + 依赖声明                             |
| **BackpressurePolicy** | ✅ `BackpressurePolicy` enum                                        | ❌                                                                               |
| **RetryBudget**        | ✅ 工具重试配置                                                     | ❌ 工具层无自动重试                                                              |
| **#[tool] 宏**         | ✅ 过程宏，自动生成 Tool 实现                                       | ❌ 需手写 ToolHandler impl                                                       |
| **FunctionTool**       | ✅ 从 async 函数自动创建工具                                        | ❌ 需手写 struct + impl                                                          |

### 类型系统差异要点

- v3 的错误系统是 **trait-based**，允许下游 crate 扩展。ADK-Rust 是单一 struct——更简单但不可扩展
- v3 的 Event 系统区分了**持久化事件**（SessionEvent）和**内存事件**（AgentEvent）。ADK-Rust 只有一种 Event
- v3 的 State 是 **schema-fixed struct**——编译时类型安全，但不可灵活扩展。ADK-Rust 是 **schema-flexible KV**——灵活但无编译时检查
- ADK-Rust 的 `#[tool]` 宏是**开发体验优势**，v3 应该借鉴
- v3 的 **Observer Pipeline** 比 ADK-Rust 的 callback 列表更结构化——有优先级、依赖声明

---

## 二、Agent 系统

| 维度                      | ADK-Rust                                                                                                                    | Cabinet v3                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Agent 类型**            | `LlmAgent` + `CustomAgent` + `SequentialAgent` + `ParallelAgent` + `LoopAgent` + `ConditionalAgent` + `LlmConditionalAgent` | Build / Plan / Explore / Verify / GeneralPurpose                                                                            |
| **分类维度**              | 按**编排模式**分类（顺序/并行/循环/条件）                                                                                   | 按**角色职责**分类（构建/规划/探索/验证/通用）                                                                              |
| **Agent 组合**            | Agent 可作为 Tool（`AgentTool`）+ Agent 可作为子 Agent                                                                      | task 工具 + WorkflowExecutor（pipeline/barrier/sequential）                                                                 |
| **Agent Builder**         | `LlmAgentBuilder` — 完整 builder 模式                                                                                       | `AgentLoop::new()` — 构造器 + 配置 struct                                                                                   |
| **LlmConditionalAgent**   | ✅ LLM 驱动的条件路由                                                                                                       | ❌                                                                                                                          |
| **CustomAgent**           | ✅ 用户定义任意 async handler                                                                                               | ❌（v3 不需要）                                                                                                             |
| **LoopAgent**             | ✅ 循环 N 次或直到 escalation（1 种模式）                                                                                   | ✅ loop-until-count / loop-until-budget / loop-until-dry（3 种模式）                                                        |
| **Agent 内部架构**        | `Agent::run()` → `EventStream`（流式事件，无显式状态机）                                                                    | `AgentLoopState` 状态机（8 个状态：Idle/Planning/AwaitingApproval/Executing/Compacting/Interrupted/Terminating/Terminated） |
| **Plan Mode**             | ❌ `ToolConfirmationPolicy` 是逐工具审批                                                                                    | ✅ Plan Mode + PlanGuardObserver + 计划级审批                                                                               |
| **System Prompt**         | 每个 Agent 独立 `instruction` 字段                                                                                          | PromptAssembler 12 个 Fragment 组装（分层/分 priority/分 CacheTTL）                                                         |
| **Environment Awareness** | ❌                                                                                                                          | ✅ EnvironmentHint + PlatformHint                                                                                           |
| **Model Guidance**        | ❌（Provider 层面处理）                                                                                                     | ✅ ModelGuidance fragment（Anthropic/OpenAI/Google 专属）                                                                   |
| **Context Compaction**    | `LlmEventSummarizer`（单步 LLM 摘要）                                                                                       | ContextCompressor 4 阶段（工具裁剪 → 边界选择 → LLM 摘要 → 组装防抖）                                                       |
| **Sub-agent delegation**  | `AgentTool` — Agent 作为 Tool                                                                                               | `task` 工具 — 创建子 AgentLoop                                                                                              |
| **Compaction 维度**       | 区分 Intra-turn 和 Events 两种压缩                                                                                          | 单一种压缩                                                                                                                  |
| **Hard Limits**           | ❌                                                                                                                          | ✅ 每种 Agent 类型显式声明能力边界                                                                                          |

### Agent 系统差异要点

- **分类哲学不同**：ADK-Rust 按编排模式，v3 按角色职责。两者**正交**——v3 的角色 Agent 内部也可以有顺序/并行/循环模式
- **Agent 组合**：ADK-Rust 的 `AgentTool`（Agent 就是 Tool）比 v3 的 `task` 工具更自然
- **Plan Mode** 是 v3 独有——ADK-Rust 没有计划-审批工作流
- **ContextCompressor** v3 的 4 阶段压缩比 ADK-Rust 的单步 LLM 摘要更精细
- **Hard Limits** v3 独有——每种 Agent 知道自己不能做什么

---

## 三、工具系统

| 维度                  | ADK-Rust                                                  | Cabinet v3                                                                  |
| --------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| **工具数量**          | 15+ 内置（Google 6 + OpenAI 8 + Anthropic 3 + Utility 4） | 22 个内置（全部自建）                                                       |
| **Provider 专属工具** | ✅ GoogleSearch, OpenAICodeInterpreter, AnthropicBash 等  | ❌ 所有工具自建                                                             |
| **代码执行工具**      | ✅ CodeInterpreter, Shell, ApplyPatch（Provider 原生）    | bash + write_file + edit_file + apply_patch（沙箱自建）                     |
| **Agent 作为工具**    | ✅ `AgentTool`                                            | ✅ `task` 工具                                                              |
| **MCP 支持**          | ✅ `McpToolset` + `McpServerManager`（基于 rmcp crate）   | ✅ MCP 聚合在 cabinet-plugin                                                |
| **Tool 宏**           | ✅ `#[tool]` 过程宏                                       | ❌                                                                          |
| **Tool 执行策略**     | `ToolExecutionStrategy` enum                              | 固定并发/串行分组（按 is_concurrency_safe）                                 |
| **Tool Confirmation** | `ToolConfirmationPolicy`: Never/Always/PerTool            | PermissionMode（4 种全局模式）+ PermissionOption（AllowOnce/All/Save/Deny） |
| **Tool Concurrency**  | `ToolConcurrencyConfig` + Semaphore                       | 按 `is_concurrency_safe` 分组 → join_all / sequential                       |
| **Tool Timeout**      | ✅ `DEFAULT_TOOL_TIMEOUT`（5 min）全局保护                | ❌ 无全局默认                                                               |
| **Tool Retry**        | ✅ `RetryBudget` + `OnToolErrorCallback`                  | ❌ 工具层无自动重试                                                         |
| **Tool Predicate**    | `ToolPredicate` type alias（编程式过滤）                  | `disallowed_for` + `requires_tools` / `fallback_for_tools`（声明式过滤）    |
| **StatefulTool**      | ✅ 有状态闭包                                             | ❌ 无状态（通过 ToolContext 访问外部状态）                                  |
| **ExitLoopTool**      | ✅ 控制流工具                                             | ❌（循环由 WorkflowExecutor 管理）                                          |

### 工具系统差异要点

- v3 工具数量更多（22 vs 15+），但 ADK-Rust 有 Provider 原生工具（CodeInterpreter 等）
- ADK-Rust 的 `#[tool]` 宏 + `FunctionTool` 显著降低工具开发成本
- v3 的 **Tool Confirmation**（4 种全局模式 × 4 种 per-operation 选项）比 ADK-Rust 更精细
- v3 缺少 **Tool Timeout 全局保护**和 **Tool Retry**——值得补

---

## 四、Model / Gateway

| 维度                    | ADK-Rust                                       | Cabinet v3                                           |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| **Provider 数量**       | 10+ providers（独立 feature gate）             | 2 格式适配器覆盖所有                                 |
| **Provider trait**      | `Llm` trait                                    | `ProviderHandle` struct                              |
| **默认 Provider**       | Google Gemini                                  | Anthropic (claude-sonnet-4-6)                        |
| **本地推理**            | ✅ `adk-mistralrs`（Gemma 4, Qwen 3.5 + 量化） | ❌                                                   |
| **流式支持**            | `StreamingMode` enum（可选）                   | 始终流式                                             |
| **Prompt 缓存**         | `CacheCapable` trait + `ContextCacheConfig`    | ✅ 完整体系：CacheTTL + 断点设计 + 缓存键 + 失效策略 |
| **Cache Hit Rate**      | ❌ 无监控                                      | ✅ `cache_read_tokens` / `cache_write_tokens` 追踪   |
| **Fallback chain**      | ❌                                             | ❌（已移除——用户手动 `/model` 切换）                 |
| **Multi-model routing** | ❌                                             | ✅ `[[providers]]` 配置 + `/model` 运行时切换        |
| **Schema Adapter**      | `SchemaAdapter` trait（模块化）                | Provider format 适配器内部处理                       |
| **Cost Tracking**       | `UsageMetadata` struct（仅统计 token）         | ✅ CostTracker + CostRepo（8 家定价表 + RMB 汇率）   |
| **Budget Guard**        | ❌                                             | ✅ 4 级预算状态（ok/warning/critical/blocked）       |
| **Rate Limit**          | ❌                                             | ✅ RateLimitTracker（解析 HTTP 头 + 等待/重试）      |
| **Thinking 适配**       | ❌ 无提及                                      | ✅ thinking.rs（Anthropic 原生 / OpenAI extra_body） |
| **Citation tracking**   | ✅ `CitationMetadata` / `CitationSource`       | ❌                                                   |

### Gateway 差异要点

- **Provider 设计哲学完全相反**：ADK-Rust 每个 Provider 一个 feature gate（开闭原则），v3 两个格式适配器覆盖全部（极简）
- v3 的 **Prompt 缓存体系**是独有优势——ADK-Rust 有基础支持但无分级策略
- v3 的 **CostTracker + BudgetGuard + RateLimitTracker** 三个组件 ADK-Rust 全部没有
- ADK-Rust 的 `SchemaAdapter` 比 v3 更模块化——v3 埋在 format adapter 里

---

## 五、会话系统

| 维度                   | ADK-Rust                                                                 | Cabinet v3                                                               |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **存储后端**           | 6 种（InMemory/SQLite/PostgreSQL/Redis/MongoDB/Neo4j）+ schema migration | 1 种（SQLite）                                                           |
| **Session trait**      | `Session` trait: conversation session with state and events              | `SessionManager` struct                                                  |
| **Event Sourcing**     | ❌ 事件历史可访问，但无投影/重放/snapshot                                | ✅ 完整事件溯源：事件追加 + Projector + Snapshot(N=20) + Fork + 崩溃恢复 |
| **Session Identity**   | `SessionId` typed ID                                                     | `SessionId` + `TurnId`                                                   |
| **Session Lifecycle**  | Create/Get/List/Delete/AppendEvent                                       | create()/admit_prompt()/resume()/complete()/abandon() — 两阶段准入协议   |
| **State 管理**         | `State` trait: KV，三层前缀（user/app/temp）                             | `SessionState` struct（schema-fixed）                                    |
| **Encrypted Sessions** | ✅ AES-256-GCM                                                           | ❌（本地单用户不需要）                                                   |
| **GDPR delete**        | ✅ `delete_user` 跨项目                                                  | ❌（本地工具不需要）                                                     |
| **State Migration**    | ✅ schema migration 模块                                                 | ✅ database migration（cabinet-storage）                                 |

### 会话系统差异要点

- **事件溯源**是 v3 的核心差异化——ADK-Rust 的 Session 本质是 CRUD state bag
- ADK-Rust 的多后端设计面向多租户/服务化部署。v3 的 SQLite 够用
- v3 的**两阶段准入协议**（用户消息先于 LLM 调用持久化）ADK-Rust 没有

---

## 六、记忆系统

| 维度                    | ADK-Rust                                                        | Cabinet v3                                                                             |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **存储后端**            | 6 种（InMemory/SQLite/PostgreSQL+pgvector/Redis/MongoDB/Neo4j） | 1 种（SQLite + FTS5）                                                                  |
| **向量搜索**            | ✅ pgvector（PostgreSQL）                                       | ❌ 条件触发（50+ Skill / 10K+ 记忆后）                                                 |
| **图数据库**            | ✅ Neo4j 后端                                                   | ❌                                                                                     |
| **Memory 注入**         | `LlmAgentBuilder::include_memory()` — 自动搜索注入              | MemoryFacade::recall() → MemorySnapshot fragment（PerTurn + token budget 自适应）      |
| **Scoping**             | `(app_name, user_id, project_id?)` 三层隔离                     | `project_path: Option<PathBuf>` — 全局/项目                                            |
| **Search API**          | `SearchRequest` / `SearchResponse`                              | FTS5 全文搜索 + Sideagent LLM 验证                                                     |
| **MemoryEntry**         | struct: 内容 + 元数据                                           | struct: 内容 + category + confidence + importance + access_count + tags + symbol_links |
| **Write Gate**          | ❌                                                              | ✅ 5 级分类（v0.1.0 去掉——Sideagent + 置信度已足够）                                   |
| **Memory Decay**        | ❌                                                              | ✅ 复合评分衰减公式（importance × confidence × recency_decay × access_boost）          |
| **Cascade Buffer**      | ❌                                                              | ✅ L0 暂存 → minCount=3 / maxAge=30min 封存                                            |
| **Sideagent**           | ❌                                                              | ✅ LLM 验证相关性后注入（来自 jcode）                                                  |
| **Symbol Links**        | ❌                                                              | ✅ 记忆关联 CodeGraph 符号                                                             |
| **Auto Nudge**          | ❌                                                              | ✅ 自主提示保存记忆（来自 Hermes）                                                     |
| **DreamLoop**           | ❌                                                              | ✅ 后台记忆整合 + 模式发现（对标 Claude Code autoDream）                               |
| **MemoryService trait** | ✅ 允许自定义后端                                               | ❌ MemoryFacade 单一实现                                                               |

### 记忆系统差异要点

- **v3 的记忆系统是所有对标产品中最完整的**——10 个独有组件（Decay/Cascade/Sideagent/SymbolLinks/Nudge/DreamLoop/FTS5/Confidence/Importance/AutoBudget）
- ADK-Rust 的**多后端 + 向量搜索**面向企业级部署。v3 用 SQLite FTS5 替代向量搜索——够用
- v3 的 **Sideagent** 是独有——注入时 LLM 验证，而不是写入时分类
- v3 的 **DreamLoop** 对标 Claude Code autoDream——ADK-Rust 没有后台记忆整合

---

## 七、沙箱

| 维度                     | ADK-Rust                                                                            | Cabinet v3                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **沙箱类型**             | `ProcessBackend`（子进程）+ `WasmBackend`（wasmtime）+ Docker（Container executor） | `DockerSandbox`（容器）+ `BubblewrapSandbox`（Linux 命名空间）+ `LocalSandbox`（dev only） |
| **代码执行**             | ✅ `RustExecutor`: check→build→execute 管道                                         | ❌ 只有 `bash("cargo build")`——纯文本执行                                                  |
| **编译诊断解析**         | ✅ `diagnostics` 模块——解析 Rust 编译器输出为结构化诊断                             | ❌                                                                                         |
| **Harness 模板**         | ✅ `HARNESS_TEMPLATE`——代码嵌入标准化执行环境                                       | ❌（Agent 在真实项目中运行）                                                               |
| **WASM 执行**            | ✅ `WasmGuestExecutor`                                                              | ❌                                                                                         |
| **JavaScript 执行**      | ✅ 嵌入式 JS（boa_engine）                                                          | ❌                                                                                         |
| **Sandbox Policy**       | `SandboxPolicy`（filesystem/network/env 三层声明式策略）                            | PathMapping + NetworkControl + FileOperationLock                                           |
| **Sandbox Enforcer**     | `SandboxEnforcer` trait + `WrappedCommand`（策略与执行分离）                        | `SandboxProvider` trait（策略与执行合并）                                                  |
| **Backend Capabilities** | ✅ `BackendCapabilities`——声明后端能力                                              | ❌ `IsolationLevel` enum 隐式表达                                                          |
| **Policy Validation**    | ✅ `validate_policy()`——执行前验证后端能力                                          | ❌                                                                                         |
| **Workspace**            | ✅ `Workspace` struct + `CollaborationEvent`                                        | ❌ 共享 sandbox 隐式协作                                                                   |

### 沙箱差异要点

- **编译诊断解析**是 v3 最大的沙箱缺口。ADK-Rust 能把 `cargo build` 输出解析为结构化诊断（文件路径、行号、错误类型、修复建议）。v3 的 Agent 需要手动解析纯文本
- ADK-Rust 的 `RustExecutor`（check→build→execute 管道）是一个结构化代码执行层。v3 没有
- ADK-Rust 的 Policy Validation（执行前验证后端能力）值得借鉴
- v3 的安全隔离（Docker + Bwrap + Local）更注重系统级安全，ADK-Rust 更注重代码执行

---

## 八、代码智能

| 维度               | ADK-Rust                                 | Cabinet v3                                                   |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| **内置代码图**     | ❌ 依赖外部工具                          | ✅ CodeGraph（tree-sitter + SQLite + FTS5）                  |
| **符号搜索**       | ❌                                       | ✅ codegraph_search / explore（FTS5 搜索）                   |
| **调用追踪**       | ❌                                       | ✅ codegraph_trace（双向 BFS，深度 5）                       |
| **影响分析**       | ❌                                       | ✅ codegraph_impact（BFS 遍历）                              |
| **Framework 检测** | ❌                                       | ✅ 7 种框架（Next.js/Express/Axum/Actix/FastAPI/Django/Gin） |
| **文件监控**       | ❌                                       | ✅ notify crate + 增量索引 + 2s 去抖                         |
| **编译诊断**       | ✅ diagnostics 模块——Rust 编译器输出解析 | ❌                                                           |

### 代码智能差异要点

**这是最大的互补点。** ADK-Rust 有**代码执行的结构化诊断**（编译器输出解析），v3 有**代码理解的结构化图**（符号图、调用追踪、影响分析）。两者结合才是完整的 Coding Agent——CodeGraph 告诉 Agent "代码是什么"，编译诊断告诉 Agent "代码哪里错了"。

---

## 九、工作流 / 编排

| 维度                   | ADK-Rust                                                         | Cabinet v3                                               |
| ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| **Sequential**         | ✅ `SequentialAgent`                                             | ✅ `WorkflowExecutor::run_sequential()`                  |
| **Parallel**           | ✅ `ParallelAgent` + `SharedState`                               | ✅ `WorkflowExecutor::run_pipeline()` + `run_barrier()`  |
| **Loop**               | ✅ `LoopAgent`（N 次或 escalation）                              | ✅ loop-until-count / loop-until-budget / loop-until-dry |
| **Conditional**        | ✅ `ConditionalAgent`（规则）+ `LlmConditionalAgent`（LLM 路由） | ❌                                                       |
| **Graph Agent**        | ✅ `adk-graph` — LangGraph 风格 + state + checkpoint             | ❌                                                       |
| **SharedState**        | ✅ `SharedState` struct                                          | ❌（并行子代理通过结果合并隐式协调）                     |
| **Workflow 持久化**    | ✅ Graph checkpoint（adk-graph）                                 | ✅ 保存为 Skill（JSON definition → SKILL.md）            |
| **Agent 作为编排元素** | ✅ Agent 本身就是编排元素                                        | ✅ WorkflowExecutor 内部使用 task 子代理                 |

### 工作流差异要点

- v3 的**循环模式更丰富**——3 种 vs 1 种
- ADK-Rust 的 **ConditionalAgent**（LLM 驱动的条件路由）v3 没有——"根据结果决定下一步用什么 Agent"
- ADK-Rust 的 `SharedState`（并行 Agent 显式协调）值得 v3 考虑
- v3 的**工作流持久化为 Skill** 是独有——Agent 可以把 Workflow 保存并复用

---

## 十、安全 / 授权

| 维度              | ADK-Rust                                                                        | Cabinet v3                                                                            |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **全局授权模式**  | ❌                                                                              | ✅ 4 种 PermissionMode（Safe/Plan/Trusted/Everything）                                |
| **逐工具审批**    | `ToolConfirmationPolicy`: Never/Always/PerTool                                  | PermissionOption: AllowOnce/AllowAll/AllowAndSave/Deny                                |
| **命令级安全**    | ❌                                                                              | ✅ ExecPolicy: 声明式规则 + pattern 匹配 + readOnlyValidation + shadowedRuleDetection |
| **计划级安全**    | ❌                                                                              | ✅ Plan Mode + PlanGuardObserver                                                      |
| **沙箱安全**      | ✅ 3 种沙箱                                                                     | ✅ 3 种沙箱 + 6 层安全模型（Layer 0-5）                                               |
| **Guardrails**    | ✅ `adk-guardrail` — PII redaction + content filtering + JSON schema validation | ✅ ContentGuardObserver（注入攻击检测）                                               |
| **RBAC**          | ✅ scope-based tool security                                                    | ❌（单用户不需要）                                                                    |
| **SSO / OAuth**   | ✅                                                                              | ❌                                                                                    |
| **Audit Log**     | ✅ 审计日志                                                                     | ✅ SessionEvent 事件流（更完整——事件溯源 = 完整审计）                                 |
| **Plugin Policy** | pluginBlocklist + orphanedPluginFilter                                          | ✅ PluginPolicy（WASM memory/exec/fuel + capabilities）                               |
| **Hard Limits**   | ❌                                                                              | ✅ 每种 Agent 类型显式声明能力边界                                                    |

### 安全差异要点

- v3 的 **6 层安全模型**（Layer 0 PermissionMode → Layer 5 Clarification）比 ADK-Rust 更系统
- v3 的 **ExecPolicy**（readOnlyValidation + shadowedRuleDetection）是独有——命令级智能
- v3 的 **Plan Mode**（计划内自动批准，计划外拦截）ADK-Rust 没有
- ADK-Rust 的 **Guardrails**（PII 脱敏 + 内容过滤）更全面。v3 只有注入检测
- v3 的 **Hard Limits** 独有——Agent 知道自己的边界

---

## 十一、Skill / Plugin 扩展

| 维度                  | ADK-Rust                                      | Cabinet v3                                                  |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| **Skill 系统**        | `adk-skill` crate（存在，文档不详）           | ✅ 完整 Skill 系统（发现→加载→匹配→Curator→SkillGenerator） |
| **Curator**           | ❌                                            | ✅ Active→Stale(30d)→Archived(90d) + LLM 整合审查           |
| **SkillGenerator**    | ❌                                            | ✅ Agent 自主从会话创建 Skill                               |
| **Skill 安全**        | ❌                                            | ✅ 安全扫描 + allowed_tools 白名单                          |
| **Plugin 系统**       | `adk-plugin` + PluginPolicy + PluginBlocklist | ✅ PluginManager + WASM runtime + MCP aggregation           |
| **MCP 集成**          | ✅ `McpToolset`（基于 rmcp crate）            | ✅ MCP 聚合（在 cabinet-plugin 中）                         |
| **Agent Marketplace** | ❌                                            | ❌                                                          |

### Skill/Plugin 差异要点

- v3 的 **Skill 自治体系**（Curator + SkillGenerator + 安全扫描）是独有
- ADK-Rust 的 MCP 集成直接使用 rmcp crate——v3 是自研
- 两者都没有 Agent Marketplace——共同的生态缺口

---

## 十二、评估 / Harness

| 维度                        | ADK-Rust                                                                                                             | Cabinet v3                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Agent Evaluation**        | ✅ `adk-eval` — Trajectory validation + response similarity + LLM-judged semantic matching + hallucination detection | ✅ Evaluator（LLM 评分 4 维度）+ QualityGate（HEI 检查） |
| **Auto-adjust**             | ❌                                                                                                                   | ✅ AutoAdjuster + SuggestProviderSwitch                  |
| **Preference Learning**     | ❌                                                                                                                   | ✅ PreferenceLearner（从用户审批行为学习）               |
| **Failure Analysis**        | ❌                                                                                                                   | ✅ FailurePatternAnalyzer（工具失败模式分析）            |
| **Daily Analysis**          | ❌                                                                                                                   | ✅ HarnessAnalyst（每日元分析）                          |
| **DreamLoop**               | ❌                                                                                                                   | ✅ 后台记忆整合（对标 autoDream）                        |
| **Benchmark**               | ✅ `adk-bench` crate                                                                                                 | ❌                                                       |
| **Trajectory validation**   | ✅ 验证 Agent 执行路径                                                                                               | ❌                                                       |
| **Hallucination detection** | ✅                                                                                                                   | ❌                                                       |

### 评估差异要点

- ADK-Rust 的**轨迹验证和幻觉检测** v3 没有——v3 的 Evaluator 只评输出质量，不评执行过程
- v3 的 **Harness 闭环**（6 个组件 + AutoAdjust + DreamLoop）ADK-Rust 没有
- 两者互补——ADK-Rust 评得更宽（过程+幻觉），v3 评得更深（6 个自主分析组件）

---

## 十三、Telemetry / 可观测性

| 维度                  | ADK-Rust                         | Cabinet v3                                      |
| --------------------- | -------------------------------- | ----------------------------------------------- |
| **Telemetry crate**   | ✅ `adk-telemetry`               | ✅ `cabinet-otel`                               |
| **OpenTelemetry**     | 未知                             | ✅ tracing + opentelemetry 桥接 + Perfetto 导出 |
| **Privacy**           | 未知                             | ✅ 三级隐私控制 + 内容哈希替代明文              |
| **ExecutionMetadata** | ✅ 关联 telemetry/audit/artifact | ❌                                              |

### Telemetry 差异要点

- v3 的**隐私设计**（三级控制 + 内容哈希）是差异化的
- v3 的 **Perfetto 导出** 对调试 Agent 行为很有价值
- ADK-Rust 的 `ExecutionMetadata` 统一关联 telemetry/audit/artifact——v3 可以借鉴

---

## 十四、基础设施

| 维度                   | ADK-Rust                                | Cabinet v3                                              |
| ---------------------- | --------------------------------------- | ------------------------------------------------------- |
| **Crate 数量**         | 43                                      | 18                                                      |
| **Feature flags**      | ✅ 大量（provider/backend/wasm/mcp...） | ✅ 精简（lang-rust/ts/python/go + wasm/mcp）            |
| **CLI 脚手架**         | ✅ `cargo adk new`                      | ❌                                                      |
| **Server 模式**        | ✅ `adk-server` — REST + A2A v1.0       | ❌（v0.1.0 不做）                                       |
| **Browser Automation** | ✅ `adk-browser` — 46 WebDriver 工具    | ❌（非 Coding Agent 场景）                              |
| **Voice**              | ✅ `adk-realtime`                       | ❌（非 Coding Agent 场景）                              |
| **Payments**           | ✅ `adk-payments` — ACP/AP2             | ❌（非 Coding Agent 场景）                              |
| **本地推理**           | ✅ `adk-mistralrs`                      | ❌（Coding Agent 首选云端）                             |
| **Enterprise**         | ✅ `adk-enterprise`                     | ❌                                                      |
| **Managed Runtime**    | ✅ `adk-managed`                        | ❌                                                      |
| **AWP Protocol**       | ✅ `awp-types` + `adk-awp`              | ❌（非 Coding Agent 场景）                              |
| **发布模式**           | 各 crate 独立发布到 crates.io（框架）   | 独立二进制（应用）                                      |
| **Performance**        | 109ms cold start, 568μs/turn, 15MB RSS  | 目标 <100ms cold start, <80MB baseline, <2ms turn write |

### 基础设施差异要点

- ADK-Rust 是**通用平台**（43 crates），v3 是**聚焦应用**（18 crates）
- ADK-Rust 有**更多可选功能**（语音/支付/浏览器/部署/企业）——这些 v3 全不需要
- v3 的**内存目标更高**（80MB vs 15MB）——因为 SQLite + tree-sitter，但 Coding Agent 场景完全可接受
- v3 的**冷启动目标相当**（<100ms vs 109ms）

---

## 总结

### v3 核心优势（ADK-Rust 没有的）

| #   | 能力                                                    | 类型       |
| --- | ------------------------------------------------------- | ---------- |
| 1   | **CodeGraph** — 内置代码智能                            | 核心壁垒   |
| 2   | **事件溯源** — 完整事件追加/投影/快照/重放/崩溃恢复     | 架构优势   |
| 3   | **Prompt 缓存体系** — 多级 CacheTTL + 缓存键 + 失效策略 | 成本优势   |
| 4   | **ContextBudget** — 弹性注入预算（所有对标产品独有）    | 差异化能力 |
| 5   | **Plan Mode** — 计划级审批                              | 安全优势   |
| 6   | **6 层安全模型** — 全局模式 + 5 层防御                  | 安全优势   |
| 7   | **Skill 自治** — SkillGenerator + Curator               | 生态优势   |
| 8   | **Memory 深度** — 10 个独有组件                         | 记忆优势   |
| 9   | **Harness 闭环** — 6 个自主分析组件                     | 质量优势   |
| 10  | **Hard Limits** — Agent 知道自己的边界                  | 安全优势   |
| 11  | **readOnlyValidation** + **shadowedRuleDetection**      | 命令安全   |

### v3 应借鉴的（ADK-Rust 优势）

| #   | 缺口                        | 严重程度 | 说明                                               |
| --- | --------------------------- | -------- | -------------------------------------------------- |
| 1   | **编译诊断解析**            | 高       | `adk-code::diagnostics` — 解析编译输出为结构化诊断 |
| 2   | **Tool Retry**              | 中       | 工具层 `RetryBudget` — 自动重试 N 次               |
| 3   | **Tool Timeout 全局保护**   | 中       | `DEFAULT_TOOL_TIMEOUT` — 防止工具永久挂起          |
| 4   | **SchemaCache**             | 低       | 缓存工具参数 JSON Schema                           |
| 5   | **Trajectory Validation**   | 低       | 评估 Agent 执行路径，不只看输出                    |
| 6   | **Hallucination Detection** | 中       | 验证 Agent 引用的路径和符号是否存在                |
| 7   | **Guardrails PII**          | 低       | PII 脱敏——本地场景概率低                           |
| 8   | **Backpressure**            | 低       | LLM 过多 tool calls 时的反压                       |
| 9   | **LlmConditionalAgent**     | 低       | Workflow 中的 LLM 条件路由                         |
| 10  | **SharedState**             | 低       | 并行子代理显式协调                                 |
| 11  | **Policy Validation**       | 低       | 沙箱执行前验证后端能力                             |

### ADK-Rust 有但 v3 明确不需要的

| 能力                         | 原因                   |
| ---------------------------- | ---------------------- |
| 语音 Agent (Realtime)        | 非 Coding Agent 场景   |
| 浏览器自动化 (46 WebDriver)  | 非 Coding Agent 场景   |
| 支付 (ACP/AP2)               | 非 Coding Agent 场景   |
| AWP Web 协议                 | 非 Coding Agent 场景   |
| Server 模式 / REST API       | v0.1.0 不做            |
| 本地推理 (MistralRS)         | Coding Agent 首选云端  |
| 多租户 / SSO / RBAC          | 单用户本地工具         |
| 企业 SDK / Managed Runtime   | 不需要                 |
| Neo4j / MongoDB / Redis 后端 | SQLite 够用            |
| Benchmark 框架               | v0.1.0 过度设计        |
| Provider 独立 feature gate   | 2 格式适配器已覆盖全部 |
| 多 Session 后端              | SQLite 够用            |
| 多 Memory 后端               | SQLite + FTS5 够用     |

### 结论

ADK-Rust 和 Cabinet v3 的**核心架构高度一致**——两者独立设计了相同的 Agent/Tool/Session/Memory/Sandbox 分层。差异在于：

- ADK-Rust 是**通用 Agent 平台**（广度优先——43 crates，覆盖语音/支付/浏览器/企业）
- Cabinet v3 是**聚焦 Coding Agent**（深度优先——18 crates，CodeGraph/事件溯源/Prompt 缓存/ContextBudget/Skill 自治都是独有壁垒）

两者最互补的点是代码智能：**v3 的 CodeGraph（理解代码结构）+ ADK-Rust 的 diagnostics（理解编译错误）= 完整的 Coding Agent 代码感知层。**
