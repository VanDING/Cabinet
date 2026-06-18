# Cabinet v3 vs Claw Code — 全面对比报告

> 日期：2026-06-13
> 来源：[ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) — 194K Stars, 1,680 commits, MIT License
> 语言：Rust (95.5%)
> 规模：9 crates, ~48,599 LOC Rust, 2,568 test LOC
> 定位：Claude Code 的 Rust 直接移植

---

## 项目概况

|                | Cabinet v3                             | Claw Code                                                    |
| -------------- | -------------------------------------- | ------------------------------------------------------------ |
| **定位**       | 聚焦 Coding Agent，从零重新设计        | Claude Code 的功能级 Rust 移植                               |
| **设计来源**   | v2 经验 + 6 份对标报告 + 逐 crate 讨论 | Claude Code 上游行为的直接复刻                               |
| **Crate 数量** | 18                                     | 9                                                            |
| **代码量**     | 0（设计阶段，~5500 行设计文档）        | ~48,599 LOC Rust                                             |
| **测试量**     | 0                                      | 2,568 test LOC + mock parity harness（12 场景, 21 请求捕获） |
| **Stars**      | —                                      | 194K                                                         |
| **版本**       | v0.1.0 设计稿                          | 0.1.3 (publish=false)                                        |
| **Edition**    | Rust 2024                              | Rust 2021                                                    |
| **发布模式**   | 独立二进制                             | 源码构建（`cargo build --workspace`）                        |
| **默认模型**   | claude-sonnet-4-6                      | claude-opus-4-7                                              |
| **API 认证**   | API key + OAuth + 本地 Provider        | API key only（不支持 Claude 订阅登录）                       |
| **不安全代码** | 未规定                                 | `unsafe_code = "forbid"`                                     |

> 核心差异：Claw Code 是 "make it work like Claude Code"（移植），Cabinet v3 是 "make it better than Claude Code"（重新设计）。

---

## 一、Crate 架构

### Claw Code — 9 Crates

```
rust/crates/
  rusty-claude-cli/     ← 主 CLI 二进制 (claw)。REPL、one-shot、流式渲染、工具调用展示
  runtime/              ← ConversationRuntime。配置加载、会话持久化、权限、MCP、系统提示词组装
  tools/                ← 40 个工具规格 + 执行（bash/read/write/edit/glob/grep/web/agent/todo/skill）
  commands/             ← 斜杠命令定义、解析、帮助文本生成
  api/                  ← Provider 客户端（Anthropic + OpenAI 兼容）、SSE 流式、认证
  plugins/              ← 插件元数据、安装/启用/禁用/卸载
  telemetry/            ← 会话 trace events 和 telemetry payload
  mock-anthropic-service/  ← 确定性 /v1/messages mock（12 场景, 21 请求）
  compat-harness/       ← 对比上游行为（与 Claude Code 输出比对）
```

### Cabinet v3 — 18 Crates

```
Foundation (7):       base, types, exec-types, gateway-types, storage, otel, codegraph
Engine (6):           exec, gateway, sandbox, session, tool, plugin
Intelligence (3):     agent, skill, memory
Application (1):      app-core
Interface (1):        tui
```

### 架构对比

| 维度             | Claw Code                                      | Cabinet v3                                                           |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| **层数**         | 扁平（无显式分层）                             | 5 层（Foundation → Engine → Intelligence → Application → Interface） |
| **类型 crate**   | 无独立 types crate                             | 3 个（types + exec-types + gateway-types）                           |
| **错误 crate**   | 无独立 error/base crate                        | cabinet-base（统一错误 trait + 配置 + 路径）                         |
| **存储 crate**   | 无独立 storage crate（runtime 内置）           | cabinet-storage（独立 Repository 层）                                |
| **代码智能**     | ❌ 无                                          | cabinet-codegraph（7 种语言，SQLite + FTS5）                         |
| **会话**         | runtime 内置                                   | cabinet-session（独立事件溯源系统）                                  |
| **记忆**         | 文件系统（CLAUDE.md + CLAW.md + AGENTS.md）    | cabinet-memory（5 层流水线 + Sideagent + DreamLoop）                 |
| **Skill**        | tools 内置 skill 工具                          | cabinet-skill（独立 crate + Curator + SkillGenerator）               |
| **可观测性**     | telemetry crate（轻量）                        | cabinet-otel（OpenTelemetry + tracing 桥接 + Perfetto）              |
| **沙箱**         | 无独立 crate（bash 工具内置 unshare/容器检测） | cabinet-sandbox（Docker + Bwrap + Local 三种实现）                   |
| **测试基础设施** | ✅ mock-anthropic-service + compat-harness     | ❌                                                                   |
| **Exec 策略**    | 无独立 crate                                   | cabinet-exec（ShellCommand + ExecPolicy + Approval）                 |

### 架构差异要点

- Claw Code 的**轻量化架构**（9 crates 覆盖 40 个工具 + 完整 CLI）证明了"可以用更少 crate 做到更多"。v3 的 18 crate 分层是设计选择，不是必需的
- Claw Code **没有独立的类型/错误/存储 crate**——这些功能内嵌在 runtime 中。v3 的严格分层增加了 crate 数量但提高了模块边界清晰度
- Claw Code 的 **mock + compat-harness 是最值得借鉴的**——v3 没有任何测试基础设施
- Claw Code **没有 CodeGraph**——它和 Claude Code 一样依赖 grep/glob/ls 探索代码。v3 的 CodeGraph 是核心壁垒

---

## 二、Agent 系统

| 维度                      | Claw Code                                                           | Cabinet v3                                                             |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Agent 核心**            | `ConversationRuntime`（在 runtime crate）                           | `AgentLoop` struct（8 状态状态机）                                     |
| **Agent 类型**            | 无显式分类——所有 Agent 同一类型                                     | 5 种（Build/Plan/Explore/Verify/GeneralPurpose）                       |
| **子代理**                | ✅ `Agent` 工具——fork 子代理 + 独立上下文 + 独立工具子集            | ✅ `task` 工具——5 种子代理类型 + 中断传播 + 超时 + 记忆合并            |
| **Task 管理**             | ✅ `TaskRegistry`（create/get/list/stop/update/output/status/team） | ❌ 无 Task 注册表——task 是即用即弃的                                   |
| **Plan Mode**             | ❌ 无（跟随 Claude Code 行为——Plan Mode 在系统提示词中隐式处理）    | ✅ 显式 Plan Mode + PlanGuardObserver + 计划级审批                     |
| **系统提示词**            | 文件拼接：CLAUDE.md + CLAW.md + AGENTS.md                           | PromptAssembler 12 个 Fragment（分层/priority/CacheTTL/ContextBudget） |
| **Environment Awareness** | ❌                                                                  | ✅ EnvironmentHint + PlatformHint                                      |
| **Model Guidance**        | ❌                                                                  | ✅ ModelGuidance fragment                                              |
| **Hard Limits**           | ❌                                                                  | ✅ 每种 Agent 类型显式声明边界                                         |
| **压缩**                  | 跟随 Claude Code 行为                                               | ContextCompressor 4 阶段                                               |

### Agent 系统差异要点

- Claw Code 的 **TaskRegistry**（create/get/list/stop/update/output 6 个工具）是 v3 完全缺失的——子代理可以**持久化追踪和管理**。v3 的 task 是 fire-and-forget
- Claw Code 用 `ConversationRuntime`（扁平大对象），v3 用 `AgentLoop`（显式状态机）。v3 更结构化
- v3 的系统提示词体系比 Claw Code 更精细——12 个 Fragment vs 3 个文件拼接

---

## 三、工具系统

| 维度                 | Claw Code                                                                                                                                                                    | Cabinet v3                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **工具数量**         | **40 个**暴露的工具 spec                                                                                                                                                     | **22 个**内置                                                                                                                              |
| **核心工具**         | bash, read_file, write_file, edit_file, glob_search, grep_search, WebFetch, WebSearch, Skill, Agent, TodoWrite, NotebookEdit, ToolSearch, Sleep, Config, REPL, PowerShell 等 | 22 个：codegraph*\*(6) + read/write/edit + glob/grep + bash + web*\*(2) + task + workflow + todo + skill_invoke/create + memory + ask_user |
| **Sleep 工具**       | ✅                                                                                                                                                                           | ❌                                                                                                                                         |
| **Config 工具**      | ✅ Agent 可读写配置                                                                                                                                                          | ❌ Agent 通过 `/config` 命令操作                                                                                                           |
| **PowerShell 工具**  | ✅ Windows 专用                                                                                                                                                              | ❌                                                                                                                                         |
| **CodeGraph 工具族** | ❌ 无代码智能工具                                                                                                                                                            | ✅ 6 个（explore/search/callers/callees/impact/trace）                                                                                     |
| **Workflow 工具**    | ❌                                                                                                                                                                           | ✅ workflow（pipeline/barrier/loop）                                                                                                       |
| **Task 管理工具**    | ✅ 6 个（create/get/list/stop/update/output）                                                                                                                                | ❌ task 工具是 fire-and-forget                                                                                                             |
| **Team/Cron 工具**   | ⚠️ in-memory registry（未完整实现）                                                                                                                                          | ❌                                                                                                                                         |
| **NotebookEdit**     | ✅                                                                                                                                                                           | ❌（非 Coding Agent 场景）                                                                                                                 |
| **REPL 工具**        | ✅                                                                                                                                                                           | ❌                                                                                                                                         |
| **LSP 工具**         | ⚠️ registry 级（completion/formatting 未暴露到工具 schema）                                                                                                                  | ❌                                                                                                                                         |
| **Tool 宏/生成器**   | ❌                                                                                                                                                                           | ❌（两者都没有 #[tool] 宏）                                                                                                                |
| **工具并发**         | 跟随 Claude Code                                                                                                                                                             | 按 is_concurrency_safe 分组                                                                                                                |
| **Tool Timeout**     | bash 工具有 timeout/background 支持                                                                                                                                          | ❌ 无全局保护                                                                                                                              |
| **Tool Retry**       | 跟随 Claude Code 重试逻辑                                                                                                                                                    | ❌ 无工具层自动重试                                                                                                                        |

### 工具系统差异要点

- Claw Code 的 40 个工具 vs v3 的 22 个——Claw Code 包含更多**元工具**（Sleep/Config/REPL/Task 管理/Team/Cron）
- v3 的 6 个 CodeGraph 工具是**Claw Code 完全缺失的**——代码智能领域
- Claw Code 的 **Task 管理体系**（6 个工具）值得 v3 认真考虑
- v3 的 **Workflow 工具**是独有——Claw Code 没有多阶段编排

---

## 四、Model / Gateway

| 维度               | Claw Code                                        | Cabinet v3                                       |
| ------------------ | ------------------------------------------------ | ------------------------------------------------ |
| **Provider 架构**  | `api` crate: Anthropic + OpenAI 兼容             | 2 格式适配器（Anthropic + OpenAICompatible）     |
| **Provider 配置**  | 环境变量（ANTHROPIC_API_KEY, OPENAI_API_KEY 等） | `[[providers]]` 配置列表 + `/model` 运行时切换   |
| **流式支持**       | SSE streaming（api crate）                       | 始终流式 + 统一 StreamChunk                      |
| **模型别名**       | ✅ opus/sonnet/haiku → 自动映射最新版本          | ❌                                               |
| **Preflight 检查** | ✅ api crate 内置                                | ❌                                               |
| **Prompt 缓存**    | 跟随 Claude Code 行为                            | ✅ 完整体系：CacheTTL + 断点 + 缓存键 + 失效策略 |
| **Cost Tracking**  | ❌ 无提及                                        | ✅ CostTracker + CostRepo + 8 家定价表           |
| **Budget Guard**   | ❌                                               | ✅ 4 级预算状态                                  |
| **Rate Limit**     | ❌                                               | ✅ RateLimitTracker                              |
| **Fallback**       | ❌                                               | ❌（用户手动切换）                               |
| **Thinking 适配**  | 跟随 Anthropic API                               | ✅ 显式适配                                      |

### Gateway 差异要点

- Claw Code 更务实——跟随上游 Anthropic/OpenAI API 行为，不做抽象
- v3 的 Prompt 缓存体系和成本控制三件套（Cost/Budget/Rate）是独有优势
- Claw Code 的**模型别名**（opus→latest）是便利性功能，v3 没有

---

## 五、代码智能

| 维度               | Claw Code                                                                                                                                   | Cabinet v3                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **内置代码图**     | ❌ 无                                                                                                                                       | ✅ CodeGraph（tree-sitter + SQLite + FTS5 + 7 种语言） |
| **符号搜索**       | ❌ 依赖 glob/grep                                                                                                                           | ✅ codegraph_search/explore                            |
| **调用追踪**       | ❌ 依赖 grep                                                                                                                                | ✅ codegraph_trace（双向 BFS）                         |
| **影响分析**       | ❌                                                                                                                                          | ✅ codegraph_impact                                    |
| **Framework 检测** | ❌                                                                                                                                          | ✅ 7 种框架                                            |
| **文件监控**       | ❌                                                                                                                                          | ✅ notify + 增量索引                                   |
| **LSP 客户端**     | ⚠️ `LspRegistry`——diagnostics, hover, definition, references, completion, symbols, formatting（但被描述为"registry-backed approximations"） | ❌                                                     |
| **诊断解析**       | ❌（LSP 注册表级，未完整实现）                                                                                                              | ❌                                                     |

### 代码智能差异要点

**这是最大的结构性差异。** Claw Code 走 LSP 路线（和 Claude Code 一样——依赖外部语言服务器获取诊断/补全/引用），v3 走 CodeGraph 路线（自建符号图、调用追踪、影响分析）。两者互补——LSP 擅长实时诊断，CodeGraph 擅长语义理解和影响分析。

---

## 六、会话与状态

| 维度         | Claw Code                                                             | Cabinet v3                                                               |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **会话管理** | runtime crate 内置。`.claw.json` 配置 merge（user > project > local） | cabinet-session：事件溯源 + Projector + Snapshot(N=20) + Fork + 崩溃恢复 |
| **事件溯源** | ❌ 跟随 Claude Code 的 transcript 模型                                | ✅ 完整事件流（15 种 SessionEvent + 14 种 AgentEvent）                   |
| **会话恢复** | 跟随 Claude Code（transcript + checkpoint）                           | ✅ 两阶段准入协议 + 中断恢复 + resume                                    |
| **Fork**     | ❌ 无提及                                                             | ✅ 从任意事件位置分叉新会话                                              |
| **持久化**   | `.claw.json` + transcript                                             | SQLite（session_events + session_snapshots + sessions）                  |

### 会话系统差异要点

- v3 的**事件溯源**是架构级差异化——Claw Code 跟随 Claude Code 的 transcript 模式
- Claw Code 的 `.claw.json` 配置 merge（user > project > local）更灵活
- v3 的 **Fork** 能力独有

---

## 七、记忆系统

| 维度           | Claw Code                                                            | Cabinet v3                                               |
| -------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| **记忆存储**   | 文件系统：CLAUDE.md + CLAW.md + AGENTS.md（从 git root 或 cwd 发现） | SQLite + FTS5（LongTermMemory）+ 5 层流水线              |
| **记忆注入**   | CLAUDE.md 优先注入系统提示词                                         | MemorySnapshot fragment（PerTurn + token budget 自适应） |
| **自动提取**   | ❌ 跟随 Claude Code 的 autoDream                                     | ✅ DreamLoop + Sideagent + AutoNudge                     |
| **置信度过滤** | ❌                                                                   | ✅ Sideagent LLM 验证                                    |
| **符号关联**   | ❌                                                                   | ✅ 记忆关联 CodeGraph 符号                               |
| **衰减/过期**  | ❌ 文件系统手动管理                                                  | ✅ 复合评分衰减 + 500K 裁剪                              |
| **记忆搜索**   | ❌ grep 搜索文件内容                                                 | ✅ FTS5 全文搜索                                         |

### 记忆系统差异要点

- Claw Code 的记忆 = **文件系统**（轻量、人工可读、git 可追踪）——Claude Code 的做法
- v3 的记忆 = **数据库**（结构化、可搜索、自动衰减、符号关联）——v2 遗留下来的复杂系统
- Claw Code 的方法更简单但功能更少。v3 的方法更复杂但能力更强

---

## 八、安全/授权/权限

| 维度                | Claw Code                                                           | Cabinet v3                                                             |
| ------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **权限模式**        | `workspace-write`（默认）+ `read-only`                              | 4 种 PermissionMode（Safe/Plan/Trusted/Everything）                    |
| **权限执行**        | ✅ `PermissionEnforcer` — 工具门控 + 文件写入边界 + bash 只读启发式 | ✅ 6 层安全模型 + ExecPolicy + Permissions + PlanGuard + Clarification |
| **Bash 验证**       | ⚠️ 1 个子模块 on main（permission-gating）；6 个 branch-only        | ✅ readOnlyValidation + shadowedRuleDetection + 声明式规则             |
| **路径安全**        | ✅ 路径穿越防护（symlink, `../` escape）                            | ✅ 沙箱虚拟路径映射 + 逃逸检测                                         |
| **文件安全**        | ✅ 二进制检测、大小限制、workspace 边界                             | ✅ FileOperationLock + write 原子性                                    |
| **AskUserQuestion** | ⚠️ 返回 pending response payload（非真正交互 UI）                   | ✅ PermissionDialog（AllowOnce/All/Save/Deny）                         |
| **权限持久化**      | ❌ 无提及                                                           | ✅ Allow & Save 写入 permissions 表                                    |
| **Hard Limits**     | ❌                                                                  | ✅ 每种 Agent 显式边界                                                 |

### 安全差异要点

- Claw Code 的 **PermissionEnforcer** 是代码级实现，v3 的 **6 层安全模型**是架构级设计
- v3 的 ExecPolicy（readOnlyValidation + shadowedRuleDetection）是设计优势，但尚未实现
- Claw Code 的路径/文件安全检查是**已实现的生产代码**——v3 还是设计

---

## 九、Skill / Plugin / 扩展

| 维度            | Claw Code                                                                                                    | Cabinet v3                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **Skill 系统**  | Skill 工具 + 文件系统加载（跟随 Claude Code）                                                                | 完整 Skill 系统：发现→加载→匹配→Curator→SkillGenerator         |
| **Skill 自治**  | ❌ Agent 不自主创建 Skill                                                                                    | ✅ SkillGenerator（Agent 从会话创建）+ Curator（生命周期管理） |
| **Plugin 系统** | ✅ plugins crate：metadata + install/enable/disable/update                                                   | ✅ PluginManager + WASM runtime + MCP aggregation              |
| **MCP 集成**    | ⚠️ `McpToolRegistry` bridge——连接状态/工具列表/认证/断开追踪。但"end-to-end MCP connection population"未完成 | ✅ MCP 聚合在 cabinet-plugin（stdio/SSE/WebSocket 三种传输）   |

### Skill/Plugin 差异要点

- Claw Code 的 Plugin 系统是**已实现代码**（install/enable/disable/update），v3 是设计
- v3 的 Skill 自治（SkillGenerator + Curator）独有
- 两者的 MCP 都是 registry 级，都还需要端到端实现

---

## 十、CLI / TUI / 交互

| 维度             | Claw Code                                                                   | Cabinet v3                                                                    |
| ---------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| **交互界面**     | REPL（纯文本，无 TUI）+ one-shot prompt                                     | ratatui TUI（5 个组件：StatusBar/ChatView/Sidebar/Composer/PermissionDialog） |
| **斜杠命令**     | ✅ 丰富：`/skills`, `/agents`, `/mcp`, `/doctor`, `/plugin`, `/subagent` 等 | ✅ 15 个内置命令                                                              |
| **输出格式**     | `--output-format text                                                       | json`（可被脚本调用）                                                         | ❌ 无 JSON 输出——仅 TUI |
| **流式渲染**     | ✅ 流式显示 + 工具调用渲染                                                  | ✅ 流式渲染回调 + Markdown 增量渲染                                           |
| **文件引用**     | ✅ `@path` 文件上下文 + attachments                                         | ✅ 文件引用可点击（`{path}:{line}` → 打开编辑器）                             |
| **JSON API**     | ✅ version/status/mcp/doctor 命令支持 JSON 输出                             | ❌                                                                            |
| **Doctor**       | ✅ 包含 memory/MCP/hook 验证                                                | ✅ `/doctor` 诊断（沙箱/DB/API key/CodeGraph）                                |
| **Windows 支持** | ✅ PowerShell 专用文档 + `.exe` 支持                                        | ❌ 未提及（依赖 Docker Desktop 做沙箱）                                       |

### 交互差异要点

- Claw Code 是**纯文本 REPL**（和 Claude Code 一样），v3 是 **TUI**（ratatui）
- Claw Code 的 **JSON 输出**让它可以被脚本和 CI 集成——v3 没有这个能力
- v3 的 TUI 有更丰富的交互（代码高亮、可折叠工具调用、文件可点击）
- Claw Code 的 **`@path` 文件上下文**是使用便利性功能

---

## 十一、任务 / 团队 / 调度

| 维度              | Claw Code                                                                   | Cabinet v3                                                    |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Task 管理**     | ✅ `TaskRegistry`（create/get/list/stop/update/output）+ Team/Cron registry | ❌                                                            |
| **子代理追踪**    | ✅ task 可被追踪和停止                                                      | ❌ fire-and-forget                                            |
| **团队协作**      | ⚠️ TeamRegistry（in-memory）——团队分配                                      | ❌                                                            |
| **后台调度**      | ⚠️ CronRegistry（in-memory）——未实现真正的后台调度                          | ❌                                                            |
| **Workflow 编排** | ❌                                                                          | ✅ WorkflowExecutor（pipeline/barrier/sequential + 3 种循环） |

### 任务调度差异要点

- Claw Code 的 **Task 管理体系**（6 个工具 + TaskRegistry）是 v3 的 task 工具远远不及的——子代理可以被创建、查看状态、更新、停止、获取输出
- v3 的 **Workflow 编排**独有——Claw Code 没有多阶段工作流
- 两者方向不同：Claw Code 提供**子代理生命周期管理**，v3 提供**子代理编排模式**

---

## 十二、测试与质量保障

| 维度             | Claw Code                                                                       | Cabinet v3                                                                                       |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **测试框架**     | ✅ 2,568 test LOC。**0 个 `#[ignore]` 测试**                                    | ❌                                                                                               |
| **Mock 服务**    | ✅ `mock-anthropic-service`——确定性 `/v1/messages` mock（12 场景，21 请求捕获） | ❌                                                                                               |
| **兼容性测试**   | ✅ `compat-harness`——对比上游 Claude Code 行为                                  | ❌                                                                                               |
| **CI 状态**      | ⚠️ "still open"（非每次 commit 都绿）                                           | ❌                                                                                               |
| **Harness 闭环** | ❌                                                                              | ✅ Evaluator + QualityGate + AutoAdjuster + PreferenceLearner + FailureAnalyzer + HarnessAnalyst |
| **Benchmark**    | ❌                                                                              | ❌                                                                                               |

### 测试差异要点

**这是 v3 最应该羞愧的维度。** Claw Code 有 2,568 行测试 + mock 服务 + 兼容性 harness——v3 是零。Claw Code 证明了 Rust Coding Agent 可以用测试驱动开发。v3 的 Harness 闭环是设计上的优势，但测试基础设施是零。

---

## 十三、Telemetry / 可观测性

| 维度               | Claw Code                                                   | Cabinet v3                                                                |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Telemetry**      | ✅ `telemetry` crate——会话 trace events + telemetry payload | ✅ `cabinet-otel`——OpenTelemetry + tracing 桥接 + Perfetto + 三级隐私控制 |
| **Trace 导出**     | 未知                                                        | ✅ Perfetto JSON 导出                                                     |
| **隐私**           | 未知                                                        | ✅ 三级控制 + 内容哈希                                                    |
| **Usage Tracking** | ✅ runtime 内置                                             | ✅ CostTracker + CostRepo                                                 |

---

## 十四、未实现/薄弱的共通领域

两个项目在这些方面都有缺口的：

| 能力                  | Claw Code                            | Cabinet v3                       |
| --------------------- | ------------------------------------ | -------------------------------- |
| **ACP/Zed 守护进程**  | ❌ README 注明 "not yet implemented" | ❌ 不适用                        |
| **远程触发/外部触发** | ⚠️ `RemoteTrigger` stub only         | ❌                               |
| **LSP 完整性**        | ⚠️ registry 级，未到工具 schema      | ❌                               |
| **MCP 运行时深度**    | ⚠️ bridge 级，未完整                 | ❌                               |
| **Bash 深度验证**     | ⚠️ 6 个分支未合并                    | ✅ 设计完备                      |
| **编译诊断解析**      | ❌（依赖 LSP，未完整实现）           | ❌                               |
| **多会话管理**        | 跟随 Claude Code                     | ✅ SessionManager + 完整生命周期 |
| **崩溃恢复**          | ❌ 无提及                            | ✅ 事件溯源天然支持              |

---

## 总结

### v3 核心优势（Claw Code 没有的）

| #   | 能力                     | 说明                                                                 |
| --- | ------------------------ | -------------------------------------------------------------------- |
| 1   | **CodeGraph**            | 内置代码智能——这是 Coding Agent 的核心壁垒                           |
| 2   | **事件溯源**             | 完整事件追加/投影/快照/重放/崩溃恢复                                 |
| 3   | **Prompt 缓存体系**      | 多级 CacheTTL + 缓存键 + 命中率监控                                  |
| 4   | **ContextBudget**        | 弹性注入预算——所有对标产品独有                                       |
| 5   | **Plan Mode**            | 计划级审批——Agent 先说再做的完整流程                                 |
| 6   | **6 层安全模型**         | 全局模式 + Sandbox + ExecPolicy + Permissions + Plan + Clarification |
| 7   | **Skill 自治**           | SkillGenerator + Curator + 安全扫描                                  |
| 8   | **Memory 深度**          | 10 个独有组件 + DreamLoop                                            |
| 9   | **Harness 闭环**         | 6 个自主分析组件                                                     |
| 10  | **Workflow 编排**        | pipeline/barrier/sequential + 3 种循环模式                           |
| 11  | **Layered Architecture** | 5 层 18 crate 严格分层                                               |
| 12  | **TUI**                  | ratatui 终端界面（vs Claw Code 的纯文本 REPL）                       |

### v3 应借鉴 Claw Code 的

| #   | 缺口                 | 严重程度 | 说明                                                                 |
| --- | -------------------- | -------- | -------------------------------------------------------------------- |
| 1   | **测试基础设施**     | **极高** | mock 服务 + compat harness + 2,568 test LOC。v3 是零——这是最大的差距 |
| 2   | **Task 管理体系**    | 高       | 6 个 task 管理工具 + TaskRegistry——子代理可追踪、可停止、可查看状态  |
| 3   | **JSON 输出模式**    | 中       | `--output-format json`——让 CLI 可被脚本和 CI 集成                    |
| 4   | **模型别名**         | 低       | opus/sonnet/haiku → 自动映射最新版本                                 |
| 5   | **@path 文件上下文** | 低       | 终端导航 + `@path` 附件机制                                          |
| 6   | **Config 工具**      | 低       | Agent 可读写自身配置                                                 |
| 7   | **Preflight 检查**   | 低       | Provider API 可用性预检                                              |

### 核心差异定位

|                | Claw Code                             | Cabinet v3                                  |
| -------------- | ------------------------------------- | ------------------------------------------- |
| **开发哲学**   | 移植——"make it work like Claude Code" | 重新设计——"make it better than Claude Code" |
| **架构复杂度** | 9 crates, 扁平                        | 18 crates, 5 层                             |
| **当前状态**   | **可运行的 Rust 代码**（48K LOC）     | **设计文档**（~5500 行）                    |
| **测试**       | ✅ 2,568 test LOC + mock harness      | ❌ 零                                       |
| **代码智能**   | ❌ LSP registry（incomplete）         | ✅ CodeGraph（设计完备）                    |
| **安全模型**   | 跟随 Claude Code                      | 6 层全新设计                                |
| **记忆系统**   | 文件系统（CLAUDE.md）                 | 数据库（5 层流水线）                        |
| **扩展性**     | Skill + Plugin + MCP（基础）          | Skill 自治 + Plugin + MCP（深度）           |

### 结论

Claw Code 是 v3 的**现实检验**——它证明了大约 50K 行 Rust 可以构建一个功能完整的 Coding Agent（40 个工具、REPL、权限、Plugin、MCP），不需要 18 个 crate 和 5 层架构。但 Claw Code 也恰好**缺少 v3 最具野心的部分**——CodeGraph、事件溯源、Plan Mode、Skill 自治、Harness 闭环、ContextBudget。两者追求不同：Claw Code 追求"能跑且对得上 Claude Code"，v3 追求"在 Claude Code 的基础上建立新的壁垒"。

v3 最大的风险不是设计不够好——而是**还一行代码都没有**。Claw Code 的教训是：一个 Coding Agent 不需要等所有设计完成再开始写代码。它的 mock harness + 兼容性测试策略是 v3 最应该直接采用的工程实践。
