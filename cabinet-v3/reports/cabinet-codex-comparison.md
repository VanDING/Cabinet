# Cabinet ↔ Codex CLI 全维度深度对比分析报告

> 生成日期：2026-06-12
> 分析范围：OpenAI Codex CLI（90k+ Star）与 Cabinet v2.0（TypeScript 重写后）
> 目的：逐层、逐模块、逐设计识别差距与改进机会

---

## 目录

1. [项目概览与定位对比](#一项目概览与定位对比)
2. [架构层对比](#二架构层对比)
3. [Agent 核心执行对比](#三agent-核心执行对比)
4. [工具与执行系统对比](#四工具与执行系统对比)
5. [安全与沙箱对比](#五安全与沙箱对比)
6. [Skill 系统对比](#六skill-系统对比)
7. [记忆系统对比](#七记忆系统对比)
8. [TUI 与用户界面对比](#八tui-与用户界面对比)
9. [MCP 与扩展机制对比](#九mcp-与扩展机制对比)
10. [Hooks/中间件系统对比](#十hooks中间件系统对比)
11. [工程纪律与质量保障对比](#十一工程纪律与质量保障对比)
12. [关键设计差异总结表](#十二关键设计差异总结表)
13. [优先级改进建议](#十三优先级改进建议)
14. [结论](#十四结论)

---

## 一、项目概览与定位对比

### 1.1 基本信息

| 维度            | Codex CLI                                                                                                         | Cabinet                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **全称**        | OpenAI Codex CLI                                                                                                  | Cabinet — "Your AI Council"            |
| **作者/组织**   | OpenAI                                                                                                            | Cabinet Dev                            |
| **一句话描述**  | "Lightweight coding agent that runs in your terminal"                                                             | "Your AI Council"（你的 AI 内阁）      |
| **定位**        | 终端中的轻量级 AI 编码 Agent——通过自然语言在本地完成开发任务                                                      | AI 驱动的项目管理与自主执行平台        |
| **开源时间**    | 2025-04-13                                                                                                        | 未公开                                 |
| **GitHub Star** | 90,000+                                                                                                           | —                                      |
| **Fork**        | 13,000+                                                                                                           | —                                      |
| **Open Issues** | 6,757                                                                                                             | —                                      |
| **主语言**      | **Rust**（codex-rs 工作空间）                                                                                     | TypeScript                             |
| **构建系统**    | **Bazel** + Cargo                                                                                                 | pnpm + tsc -b                          |
| **UI**          | **ratatui TUI**（终端界面）+ IDE 插件（VS Code/Cursor/Windsurf）+ 桌面应用（codex app）+ Web（chatgpt.com/codex） | Tauri 桌面应用 + Hono 服务端           |
| **数据库**      | SQLite（thread-store）+ 文件系统                                                                                  | SQLite（better-sqlite3，AES-256 加密） |
| **License**     | Apache-2.0                                                                                                        | MIT                                    |
| **代码规模**    | **~110+ Rust crates**（Cargo workspace）                                                                          | 15 packages + 2 apps（pnpm workspace） |
| **安装方式**    | 一键安装（curl/NPM/Homebrew）+ 预编译二进制                                                                       | pnpm install + pnpm build              |
| **运行时**      | 原生二进制（Rust 编译）                                                                                           | Node.js (ES2022)                       |
| **模型后端**    | **OpenAI Responses API**（ChatGPT Plus/Pro/Business/Edu/Enterprise）+ API Key                                     | 8 个 Provider（通过 Vercel AI SDK）    |
| **部署模式**    | 本地 CLI + Codex Web（云端）+ 桌面应用 + IDE 插件                                                                 | 桌面应用 + 服务端                      |

### 1.2 设计哲学对比

| 设计理念       | Codex CLI                                                                                                       | Cabinet                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Agent 架构** | 客户端-服务器分离：TUI 客户端 ↔ app-server（可通过 Unix Socket/WebSocket 通信）                                 | 嵌入式：AgentLoop 在 ServerContext 内执行                                          |
| **核心原则**   | **轻量 + 本地优先**——"runs locally on your computer"。**模块即 Crate**——110+ 细粒度 crate。抵制向 core 添加代码 | **4 层架构**——依赖单向流动。**从终局设计**——假设 AI 全能                           |
| **代码哲学**   | **Rust 工程纪律**——严格的 clippy lint、模块 <500 行、变更 <800 行、Snapshot UI 测试、async trait Send bound     | **TypeScript 工程纪律**——strict mode、noUncheckedIndexedAccess、lint:arch 架构校验 |
| **交互范式**   | TUI（ratatui）+ 命令面板 + IDE 集成。开箱即用的编码体验                                                         | 桌面应用 + Web UI。用户是 Captain，关注交付物                                      |
| **扩展性**     | Plugin 系统 + Skills + Hooks + MCP + External Agent + Custom Slash Commands                                     | Observer Pipeline + Skill Registry + MCP + A2A Adapter                             |
| **安全模型**   | **多层沙箱**——linux-sandbox / windows-sandbox-rs / bwrap + execpolicy（执行策略）+ sandbox-exec + 网络隔离      | SafetyChecker + DelegationTier + 黑名单检测                                        |

### 1.3 语言选择的影响

这是本次对比中最根本的差异——**Rust vs TypeScript**：

| 维度           | Rust (Codex)                                  | TypeScript (Cabinet)                       |
| -------------- | --------------------------------------------- | ------------------------------------------ |
| **性能**       | 原生编译，零成本抽象。启动毫秒级              | V8 JIT，有预热开销。启动 ~200ms            |
| **内存**       | 无 GC，确定性内存管理                         | V8 GC，堆内存 ~50-100MB 起步               |
| **并发**       | async/await + Tokio。编译期保证线程安全       | async/await + Node.js 事件循环。单线程模型 |
| **类型系统**   | 代数类型 + trait + 所有权。编译期消除整类 bug | 结构化类型 + interface。运行时灵活性       |
| **包管理**     | Cargo + Bazel。依赖树编译期解析               | pnpm + node_modules。运行时解析            |
| **编译时间**   | 长（110+ crate 全量编译可能 10+ 分钟）        | 短（tsc -b 增量编译秒级）                  |
| **分发方式**   | 单一静态二进制（~50-100MB）                   | JS bundle + node_modules                   |
| **开发效率**   | 较慢（编译-运行循环长）                       | 快（热重载、即时反馈）                     |
| **正确性保证** | 极高——所有权系统消除内存 bug 和数据竞争       | TypeScript strict mode 提供较好保证        |

---

## 二、架构层对比

### 2.1 总体架构模式

```
Codex CLI 架构（客户端-服务器分离）:
  ┌─────────────────────────────────────────────┐
  │              TUI Client (ratatui)            │
  │  chatwidget / composer / bottom_pane / ...  │
  │  keymap / markdown_render / diff_render     │
  └────────────────┬────────────────────────────┘
                   │ Unix Socket / WebSocket / In-Process
  ┌────────────────┴────────────────────────────┐
  │           App Server (app-server crate)      │
  │  request_processors/ (28 个处理器)            │
  │  thread_state / config_manager / models      │
  │  message_processor / mcp_refresh             │
  └────────────────┬────────────────────────────┘
                   │
  ┌────────────────┴────────────────────────────┐
  │              Core (codex-core crate)         │
  │  agent / codex_thread / tools / codex_delegate│
  │  session / turn_context / context_fragments  │
  └────────────────┬────────────────────────────┘
                   │ OpenAI Responses API
  ┌────────────────┴────────────────────────────┐
  │      横向支持 Crate（110+）                    │
  │  exec / sandboxing / skills / memories       │
  │  hooks / plugin / mcp-server / codex-mcp     │
  │  file-search / file-system / file-watcher    │
  │  analytics / feedback / rollout / otel       │
  └─────────────────────────────────────────────┘

Cabinet 架构（分层 Monorepo）:
  Layer 4 (Interface):   ui (React)  server (Hono)  desktop (Tauri)  cli
    ↑
  Layer 3 (Business):    decision  secretary  workflow  harness
    ↑
  Layer 2 (Agent Core):  gateway (Vercel AI SDK)  agent  memory  agent-sdk
    ↑
  Layer 1 (Infra):       graph  types  events  storage (SQLite + AES-256)
```

| 对比点           | Codex CLI                                                                                                                                            | Cabinet                                               | 评价                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **架构模式**     | **客户端-服务器分离**——TUI 客户端通过 app-server 协议与核心通信。支持三种模式：嵌入（in-process）、本地守护进程（Unix Socket）、远程（WebSocket）    | **嵌入式单体**——AgentLoop 在 ServerContext 内直接执行 | **Codex 的分离更灵活**——同一核心可以服务 TUI/IDE/Web/CLI 多个前端。Cabinet 也有 server-client 分离但不够彻底 |
| **模块组织**     | **110+ 细粒度 crate**——每个功能域独立 crate。core 被标记为"已臃肿"且禁止添加新代码                                                                   | **15 个粗粒度 package**——按层组织，每层 3-5 个包      | Codex 的 crate 粒度更细（更容易并行开发和独立测试）；Cabinet 的分层更清晰（依赖方向有保证）                  |
| **IPC 协议**     | ✅ **app-server-protocol**——类型化的 JSON-RPC 协议。`*Params`/`*Response`/`*Notification` 命名。`<resource>/<method>` 路由。自动生成 TypeScript 类型 | ❌ 无标准 IPC 协议——REST API + WebSocket ad-hoc       | **Codex 更好**——类型化协议自动生成多语言绑定                                                                 |
| **构建系统**     | **Bazel**——支持多语言、远程缓存、增量构建                                                                                                            | pnpm + tsc -b——简单直接                               | Bazel 更强大但更复杂；pnpm 更轻量但缺少远程缓存                                                              |
| **配置管理**     | ConfigManager + config_manager_service + 热重载                                                                                                      | Settings DB + .env + fs.watch                         | Codex 的配置系统更结构化（有专门的 service crate）                                                           |
| **Feature Flag** | ✅ **rollout crate**——功能发布和 A/B 测试                                                                                                            | ❌ 无                                                 | **Codex 独有**——生产级功能发布管理                                                                           |

### 2.2 建议

1. **保持 Cabinet 的分层 Monorepo**——Codex 的 110+ crate 适合 Rust 生态但不适合 TypeScript 的包管理开销
2. **P2：考虑定义标准 IPC 协议**——参考 Codex 的 app-server-protocol，定义类型化的 JSON-RPC 接口，自动生成前后端类型绑定
3. **P3：引入 Feature Flag 系统**——参考 Codex 的 rollout crate，支持按用户/环境/百分比灰度发布

---

## 三、Agent 核心执行对比

### 3.1 架构对比

```
Codex 核心（codex-core crate）:
  lib.rs → 声明所有模块 + 公开 re-export

  主要模块:
    agent/           → Agent 循环（核心逻辑）
    codex_thread/    → 会话线程（CodexThread，即 conversation）
    codex_delegate/  → Agent 委派（子代理）
    tools/           → 工具系统
    mcp_tool_call/   → MCP 工具调用
    function_tool/   → 函数工具
    session/         → 会话生命周期
    turn_context/    → 每轮上下文
    context_fragments/ → 上下文片段（注入到 prompt 的受控片段，<10K tokens）
    mention_syntax/  → 工具/插件提及语法（@tool, !plugin）
    session_startup_prewarm/ → 启动预热

Cabinet 核心（@cabinet/agent）:
  agent-loop.ts      → AgentLoop 主类（_execute 方法）
  dispatcher.ts      → AgentDispatcher（多模式调度）
  tool-executor.ts   → ToolExecutor（注册与执行）
  observer-pipeline.ts → ObserverPipeline（生命周期钩子）
  context-builder.ts → ContextBuilder（分层 prompt 构建）
  context-monitor.ts → ContextMonitor（token 监控）
  context-handoff.ts → ContextHandoff（上下文交接）
  checkpoint.ts      → CheckpointManager（状态持久化）
```

| 对比点         | Codex CLI                                                                  | Cabinet                                             | 评价                                                                  |
| -------------- | -------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| **会话模型**   | `CodexThread`——每个线程有独立状态、turn context、thread store              | `AgentLoop`——每个 loop 实例绑定一个会话             | Codex 的 Thread 抽象更清晰（ThreadManager 管理创建/分叉/关闭）        |
| **上下文注入** | ✅ `ContextualUserFragment`——受控的上下文片段（<10K tokens），需要额外审查 | `ContextBuilder`——分层构建（Tier1/Tier2/Tier3/RAG） | Codex 的片段模式更受控（大小限制 + 手动审查）；Cabinet 的层级更系统化 |
| **Agent 委派** | ✅ `codex_delegate`——专用的委派模块                                        | `AgentDispatcher`——多模式 dispatch                  | Codex 将委派作为一等模块                                              |
| **启动预热**   | ✅ `session_startup_prewarm`——会话启动时预热资源                           | ❌ 无                                               | **Codex 独有**——减少首轮延迟                                          |
| **提及语法**   | ✅ `mention_syntax`——`TOOL_MENTION_SIGIL` 和 `PLUGIN_TEXT_MENTION_SIGIL`   | ❌ 无                                               | **Codex 独有**——通过语法糖引用工具和插件                              |
| **Turn 管理**  | ✅ `turn_context` + `SteerInputError`                                      | `AgentExecutionContext`（统一可变对象）             | Codex 的 turn 管理更结构化                                            |
| **Fork 模式**  | ✅ `ForkSnapshot`——线程快照分叉                                            | ❌ 无                                               | **Codex 独有**——从任意点分叉会话                                      |

### 3.2 执行流程对比

```
Codex 执行流程:
  1. Thread Startup
     session_startup_prewarm → 预热资源
     ContextualUserFragment 组装 → 注入上下文片段
  2. Turn Execution
     TurnContext 创建 → Steer 处理 → API 调用 (OpenAI Responses API)
     → tool_call 返回 → 工具分发 (agent/tools) → 结果注入
     → 循环直到 stop_reason
  3. Thread Lifecycle
     ThreadManager 管理 → Fork/Resume/Shutdown

Cabinet 执行流程:
  1. Context Assembly
     _assembleContext → Checkpoint 恢复 → ContextBuilder.build()
  2. Observer Pipeline
     onStreamStart → onUserInput → onToolCall → onToolResult
     → onStepEnd → onStreamEnd
  3. Session Report
     _reportSessionFromContext → AgentSessionSummary
```

### 3.3 建议

1. **P2：增加 Thread Fork 机制**——参考 Codex 的 ForkSnapshot，允许从任意会话点分叉
2. **P2：增加会话启动预热**——预加载 system prompt、工具目录、项目上下文
3. **P2：增加提及语法**——`@tool-name` 和 `!plugin-name` 语法糖，让用户在输入中直接引用工具
4. **P3：考虑 Thread 抽象分离**——将会话管理与 Agent 执行分离为独立模块

---

## 四、工具与执行系统对比

### 4.1 架构对比

```
Codex 工具-执行系统:
  exec/ crate              → 命令执行引擎
  exec-server/ crate       → 执行服务器（独立进程）
  execpolicy/ crate        → 执行策略（批准/拒绝规则）
  execpolicy-legacy/ crate → 旧版执行策略
  shell-command/ crate     → Shell 命令抽象
  shell-escalation/ crate  → Shell 升级（权限提升）
  sandboxing/ crate        → 沙箱抽象
  linux-sandbox/ crate     → Linux 沙箱（bwrap/seatbelt）
  windows-sandbox-rs/ crate → Windows 沙箱
  bwrap/ crate             → Bubblewrap 沙箱包装器
  process-hardening/ crate → 进程加固

  tools/ crate             → 工具实现
  file-system/ crate       → 文件系统工具
  file-search/ crate       → 文件搜索工具（ripgrep 集成）
  file-watcher/ crate      → 文件变化监控
  apply-patch/ crate       → Patch 应用工具（流式解析器）

Cabinet 工具-执行系统:
  tools/ (13 个文件)       → 工具实现
  tool-executor.ts         → 工具注册与执行
  safety.ts                → 安全检查
  utils/security.ts        → 危险命令黑名单

  ❌ 无独立 crate/package   → 执行引擎与工具耦合
  ❌ 无执行策略系统          → 仅 DelegationTier 全局控制
  ❌ 无沙箱                 → 宿主机直接执行
```

| 对比点         | Codex CLI                                                                     | Cabinet                                       | 评价                                           |
| -------------- | ----------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| **执行引擎**   | ✅ **独立 exec crate**——命令执行作为独立子系统                                | ❌ execute_command 工具直接调用 child_process | **Codex 更好**——执行引擎独立，可替换、可沙箱化 |
| **执行策略**   | ✅ **execpolicy crate**——声明式执行策略（批准/拒绝/允许规则）                 | ❌ SafetyChecker 黑名单——粗粒度               | **Codex 更好**——execpolicy 是独立的策略引擎    |
| **Shell 抽象** | ✅ **shell-command + shell-escalation**——类型安全的 Shell 命令抽象 + 权限升级 | ❌ 直接字符串 exec                            | **Codex 更好**——类型安全的命令构造             |
| **文件搜索**   | ✅ **file-search crate**——集成 ripgrep，独立的搜索引擎                        | ✅ glob + grep 工具                           | Codex 将搜索作为独立子系统更灵活               |
| **Patch 应用** | ✅ **apply-patch crate**——流式 patch 解析器 + 独立的 CLI 工具                 | ✅ apply_patch 工具                           | Codex 的流式解析更好（处理大 patch）           |
| **进程加固**   | ✅ **process-hardening crate**——子进程安全加固                                | ❌ 无                                         | **Codex 独有**                                 |

### 4.2 工具架构对比

```
Codex 工具模型:
  工具定义分布在多个 crate:
    - tools/ crate       → 核心工具
    - file-system/ crate → 文件工具
    - mcp-server/ crate  → MCP 服务器（将 Codex 工具暴露为 MCP）
    - codex-mcp/ crate   → MCP 客户端

  Agent 可以：
    - 通过 tool_call 调用内置工具
    - 通过 MCP 调用外部工具
    - 通过 plugin 扩展工具
    - 通过 skill 组合工具

  execpolicy 控制：
    - 哪些命令可以执行
    - 是否需要用户审批
    - 命令参数约束

Cabinet 工具模型:
  ToolExecutor 统一注册表:
    - name, description, parameters (JSON Schema)
    - execute: async (args, context?) => {...}
    - createView() → 受限视图

  ToolPruner 动态裁剪:
    - 基于 embedding 语义相关性
```

| 对比点         | Codex CLI                                          | Cabinet                                   | 评价                                               |
| -------------- | -------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| **工具组织**   | 分散在 10+ 个独立 crate 中——每个领域一个 crate     | 集中在 tools/ 目录的 13 个文件中          | Codex 的组织更利于独立开发和测试                   |
| **工具安全**   | ✅ execpolicy——声明式策略引擎 + 审批流程           | ✅ DelegationTier + 黑名单                | Codex 的策略引擎更精细                             |
| **工具发现**   | 编译时静态链接 + MCP 动态发现 + Plugin 注册        | 运行时 ToolExecutor.register() + MCP 注册 | Codex 的编译时保证更强；Cabinet 的运行时灵活性更高 |
| **Patch 工具** | ✅ 流式解析器——支持大 patch 分块处理               | ✅ 字符串替换                             | Codex 的流式处理更强                               |
| **MCP 双向**   | ✅ mcp-server crate 将 Codex 自身暴露为 MCP 服务器 | ❌ 仅 MCP 客户端                          | **Codex 独有**——Codex 也是一个 MCP 服务器          |

### 4.3 建议

1. **P1：将执行引擎独立为子系统**——参考 Codex 的 exec crate，命令执行作为独立可替换模块
2. **P1：增加执行策略引擎**——参考 Codex 的 execpolicy，声明式批准/拒绝规则
3. **P1：增加 Shell 命令类型抽象**——参考 shell-command crate，类型安全的命令构造
4. **P2：增强 Patch 工具**——参考 Codex 的流式解析器
5. **P3：将 Cabinet 暴露为 MCP 服务器**——让其他 Agent 可以通过 MCP 调用 Cabinet 的能力

---

## 五、安全与沙箱对比

### 5.1 架构对比

```
Codex 沙箱系统:
  多层沙箱架构:
    sandboxing/ crate           → 沙箱抽象层
    ├── linux-sandbox/ crate    → Linux: bwrap (Bubblewrap) + sandbox-exec (seatbelt)
    ├── windows-sandbox-rs/ crate → Windows: Windows Sandbox
    └── bwrap/ crate            → Bubblewrap CLI 包装器

  网络隔离:
    CODEX_SANDBOX_NETWORK_DISABLED=1 → shell 工具使用时自动设置
    CODEX_SANDBOX=seatbelt → sandbox-exec 子进程标记

  执行策略:
    execpolicy/ crate:
      - 命令审批规则
      - 路径限制
      - 参数约束
      - 用户确认流程

  进程加固:
    process-hardening/ crate → 子进程安全配置

  容器支持:
    .devcontainer/ → VS Code Dev Container 配置（含防火墙初始化）

Cabinet 安全系统:
  SafetyChecker + DelegationTier (T0-T3)
  危险命令黑名单 (utils/security.ts)
  输入过滤 (ContentGuardObserver)
  ❌ 无沙箱隔离
  ❌ 无网络隔离
  ❌ 无执行策略引擎
```

| 对比点            | Codex CLI                                             | Cabinet                 | 评价                                       |
| ----------------- | ----------------------------------------------------- | ----------------------- | ------------------------------------------ |
| **沙箱层数**      | ✅ **3 层**——Linux (bwrap + seatbelt)、Windows、macOS | ❌ 0 层——宿主机直接执行 | **Codex 遥遥领先**——这是安全层面的根本差距 |
| **网络隔离**      | ✅ 执行 shell 命令时自动禁用网络                      | ❌ 无                   | **Codex 独有**                             |
| **进程加固**      | ✅ process-hardening——子进程安全配置                  | ❌ 无                   | **Codex 独有**                             |
| **执行策略**      | ✅ execpolicy——声明式、可配置                         | ❌ 硬编码黑名单         | **Codex 更好**——策略可审计、可版本控制     |
| **Dev Container** | ✅ 预配置的 VS Code Dev Container + 防火墙            | ❌ 无                   | Codex 的安全开发环境                       |
| **跨平台沙箱**    | ✅ Linux + Windows + macOS                            | ❌ 无                   | Codex 覆盖所有平台                         |

### 5.2 建议

**P0（已在 DeerFlow 对比中识别，Codex 验证了重要性）：**

1. **沙箱隔离**——Codex 的 3 层沙箱架构验证了"AI 执行命令必须隔离"这条铁律
2. **网络隔离**——执行 shell 命令时自动禁用网络是最小权限原则的体现
3. **执行策略引擎**——不是简单的黑名单，而是声明式的、可审计的策略规则

---

## 六、Skill 系统对比

### 6.1 架构对比

```
Codex Skill 系统:
  目录结构:
    .codex/skills/  (项目级) + codex-rs/core-skills/ (内置)
    ├── babysit-pr/          → PR 监控
    ├── code-review/         → 代码审查
    ├── code-review-breaking-changes/
    ├── code-review-change-size/
    ├── code-review-context/
    ├── code-review-testing/
    ├── codex-bug/           → Bug 报告
    ├── codex-issue-digest/  → Issue 摘要
    ├── codex-pr-body/       → PR 正文生成
    ├── pushing-ci-changes/  → CI 变更推送
    ├── remote-tests/        → 远程测试
    ├── test-tui/            → TUI 测试
    └── update-v8-version/   → V8 版本更新

  core-skills/ crate → Skill 核心（注册、发现、加载）
  skills/ crate      → Skill 运行时（执行、作用域）

  特性:
    - 项目级 + 用户级 + 内置三级
    - 可被 / 斜杠命令触发
    - 可被 Agent 在 tool_call 中调用
    - Skills Watcher 监控文件变化热重载

Cabinet Skill 系统:
  SkillRegistry:
    - global (~/.cabinet/skills/) + project (.cabinet/skills/)
    - L1 元数据 → L2 完整 body → L3 refs/scripts
    - 4 个内置 Skill
```

| 对比点         | Codex CLI                                                | Cabinet                                                              | 评价                                                               |
| -------------- | -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Skill 数量** | 13 个内置（都是编码工作流相关）+ 用户自定义              | 4 个内置（workflowDesigner, agentCreator, skillCreator, mcpBuilder） | Codex 的内置 Skill 更实用（直接服务编码场景）                      |
| **Skill 类型** | 编码工作流——PR、Code Review、CI、Bug Report、Test        | 通用——Agent 创建、Workflow 设计、Skill 创建、MCP 构建                | 定位不同。Codex 的 Skill 面向"编码"；Cabinet 的 Skill 面向"元工具" |
| **Crate 支持** | ✅ **独立的 core-skills + skills crate**——编译时类型安全 | ❌ 运行时字符串解析                                                  | **Codex 更好**——编译时类型检查 Skill 定义                          |
| **三级加载**   | ❌ 全量注册                                              | ✅ L1→L2→L3 渐进式 token 控制                                        | **Cabinet 更好**——更精细的 token 管理                              |
| **热重载**     | ✅ skills_watcher (fs_watch)                             | ✅ fs.watch 监控                                                     | 一致                                                               |
| **作用域**     | ❌ 项目级 + 用户级（无显式 global/project 区分）         | ✅ global / project 两种作用域显式声明                               | **Cabinet 更好**                                                   |

### 6.3 建议

1. **P2：增加更多实用的内置 Skill**——参考 Codex 的 code-review/bug-report/pr-body 等实用工作流
2. **保持 Cabinet 的三级渐进加载和显式作用域**——这些是优势

---

## 七、记忆系统对比

### 7.1 架构对比

```
Codex 记忆系统:
  memories/ crate           → 记忆核心
  message-history/ crate    → 消息历史
  thread-store/ crate       → 线程存储（SQLite）
  agent-graph-store/ crate  → Agent 图存储
  context-fragments/ crate  → 上下文片段（<10K tokens）

  记忆类型:
    - 会话级消息历史（message-history）
    - 线程级存储（thread-store）
    - Agent 图存储（agent-graph-store——多 Agent 关系图？）
    - 上下文片段（受控的 prompt 注入片段）

  反馈系统:
    feedback/ crate → 用户反馈收集与处理

Cabinet 记忆系统:
  MemoryFacade → 5 层流水线:
    ShortTermMemory → WriteGate → CascadeBuffer
    → LongTermMemory (SQLite + FTS5 + HNSW)
    → KnowledgeGraph
  + EntityMemory + ProjectMemory
  + MemoryDecayService + ConsolidationService
```

| 对比点         | Codex CLI                                                      | Cabinet                                                         | 评价                                     |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| **存储后端**   | SQLite（thread-store）+ 文件系统                               | SQLite + FTS5 + HNSW 向量索引                                   | **Cabinet 更好**——支持语义搜索和向量检索 |
| **记忆分层**   | 会话消息 + 线程存储 + Agent 图 + 上下文片段                    | 5 层：ShortTerm→WriteGate→CascadeBuffer→LongTerm→KnowledgeGraph | **Cabinet 更好**——记忆流水线更系统       |
| **Agent 图**   | ✅ **agent-graph-store**——多 Agent 关系图存储                  | ✅ KnowledgeGraph——实体关系图                                   | 各有千秋                                 |
| **反馈系统**   | ✅ 独立的 feedback crate——用户反馈收集                         | ✅ FeedbackSurvey 组件                                          | Codex 的反馈系统是独立的子系统           |
| **上下文片段** | ✅ **ContextualUserFragment**——受控的 prompt 注入，<10K tokens | ❌ 无等效                                                       | **Codex 独有**——受控的上下文注入片段     |
| **记忆提取**   | 消息历史简单存储（无自动提取）                                 | ✅ ConsolidationService + LLM 提取 + WriteGate 分类             | **Cabinet 更好**——自动化记忆管理         |
| **记忆衰减**   | ❌ 无                                                          | ✅ MemoryDecayService                                           | **Cabinet 更好**                         |
| **写入门控**   | ❌ 无                                                          | ✅ WriteGate 5 级分类                                           | **Cabinet 更好**                         |

### 7.2 建议

1. **P2：增加 Contextual Fragments 概念**——受控的、大小限制的上下文注入片段，需要额外审查
2. **P2：增加独立的反馈子系统**——参考 Codex 的 feedback crate
3. **保持 Cabinet 的记忆流水线优势**——WriteGate、衰减、知识图谱、向量搜索

---

## 八、TUI 与用户界面对比

### 8.1 界面覆盖

| 界面类型          | Codex CLI                                                                        | Cabinet                             |
| ----------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| **TUI（终端）**   | ✅ **ratatui**——90+ 模块，完整的终端 UI 框架                                     | ❌ 无 TUI                           |
| **桌面应用**      | ✅ codex app（Electron/原生）                                                    | ✅ **Tauri 桌面**——Rust 后端 < 10MB |
| **Web**           | ✅ chatgpt.com/codex（云端版本）                                                 | ✅ Hono Server + 前端路由           |
| **IDE 插件**      | ✅ VS Code + Cursor + Windsurf                                                   | ❌ 无                               |
| **语音输入**      | ✅ macOS 支持（Linux stub 返回错误）                                             | ❌ 无                               |
| **Markdown 渲染** | ✅ 专用 Markdown 管道（markdown_render + markdown_stream + markdown_text_merge） | ❌ 基础的 Markdown                  |
| **Diff 展示**     | ✅ diff_render 模块——结构化 diff 可视化                                          | ❌ 无                               |
| **命令面板**      | ✅ 完整的 keymap 系统（keymap + keymap_setup + key_hint）                        | ❌ 无键盘快捷键系统                 |
| **Shimmer 动画**  | ✅ shimmer 模块——加载动画                                                        | ❌ 基础 spinner                     |
| **Pager Overlay** | ✅ pager_overlay——长文本浏览                                                     | ❌ 无                               |
| **终端探针**      | ✅ terminal_probe——自动检测终端能力（颜色/超链接/图片）                          | ❌ 无                               |

### 8.2 TUI 架构对比（Codex 独有）

```
Codex TUI 架构 (ratatui + 90+ 模块):
  App::run()
    ├── chatwidget          → 主聊天界面
    ├── composer_input      → 输入框
    ├── bottom_pane         → 底部面板
    ├── status_indicator    → 状态指示
    ├── goal_display        → 目标显示
    ├── exec_cell           → 命令执行块
    ├── history_cell        → 历史记录块
    ├── markdown_render     → Markdown 渲染
    ├── diff_render         → Diff 可视化
    ├── shimmer             → 加载动画
    ├── pager_overlay       → 长文本浏览
    ├── notifications       → 通知系统
    ├── tooltips            → 提示
    ├── keymap              → 键盘映射
    ├── app_backtrack       → 导航历史
    ├── terminal_hyperlinks → 终端超链接
    ├── terminal_title      → 终端标题
    ├── voice               → 语音输入
    └── ascii_animation     → ASCII 动画

  App Server 通信:
    app_server_session → app-server-protocol (JSON-RPC)
    三种模式: Embedded / LocalDaemon (Unix Socket) / Remote (WebSocket)
```

这 90+ 个 TUI 模块构成了 Codex 用户体验的核心竞争力。

### 8.3 建议

1. **P3：如果需要 TUI**——参考 Codex 的 ratatui 架构。注意 90+ 模块的工程量
2. **P3：如果需要 IDE 集成**——参考 Codex 的 VS Code/Cursor/Windsurf 插件策略
3. **P2：增加终端能力检测**——自动检测颜色深度、超链接支持、图片支持
4. **P2：增加 Markdown 流式渲染管道**——独立的流式 Markdown 渲染

---

## 九、MCP 与扩展机制对比

### 9.1 架构对比

```
Codex 扩展系统:
  MCP:
    codex-mcp/ crate        → MCP 客户端（调用外部 MCP 工具）
    mcp-server/ crate       → MCP 服务器（将 Codex 自身暴露为 MCP）
    rmcp-client/ crate      → 远程 MCP 客户端
    mcp_refresh.rs          → MCP 连接热刷新

  Plugin:
    plugin/ crate           → 插件系统
    core-plugins/ crate     → 内置插件
    marketplace_processor   → 插件市场
    extensions.rs           → 扩展管理

  External Agent:
    external_agent_config   → 外部 Agent 配置
    external_agent_migration → 外部 Agent 迁移
    external_agent_sessions  → 外部 Agent 会话
    external_agent_session_import → 会话导入

  Hooks:
    hooks/ crate            → 钩子系统

  Connectors:
    connectors/ crate       → 外部服务连接器
    chatgpt/ crate          → ChatGPT 集成

Cabinet 扩展系统:
  MCP: MCP 客户端（mcp__{name} 工具注册）
  A2A: Agent-to-Agent 协议
  External Agent: CLI/Codex/OpenCode Adapter
  Skill: SkillRegistry
  Observer: ObserverPipeline
```

| 对比点             | Codex CLI                                                                   | Cabinet            | 评价                                              |
| ------------------ | --------------------------------------------------------------------------- | ------------------ | ------------------------------------------------- |
| **MCP 双向**       | ✅ **既是客户端也是服务器**——mcp-server crate 将 Codex 工具暴露给其他 Agent | ❌ 仅 MCP 客户端   | **Codex 更好**——Codex 可以作为其他 Agent 的工具源 |
| **MCP 连接管理**   | ✅ mcp_refresh——连接热刷新                                                  | ❌ 需重启          | **Codex 更好**                                    |
| **外部 Agent**     | ✅ 完整的 lifecycle——配置/迁移/会话/导入                                    | ✅ CLI/A2A Adapter | Codex 的外部 Agent 生命周期更完整                 |
| **Plugin 系统**    | ✅ marketplace + 安装 + 管理                                                | ❌ 无              | **Codex 独有**                                    |
| **Connector 模式** | ✅ connectors crate——标准化的外部服务连接模式                               | ❌ 无              | **Codex 独有**                                    |
| **ChatGPT 集成**   | ✅ chatgpt crate——与 chatgpt.com/codex 的深度集成                           | ❌ 无              | Codex 的平台集成更深                              |

### 9.2 建议

1. **P2：将 Cabinet 暴露为 MCP 服务器**——让其他 Agent 调用 Cabinet 的 Decision/Workflow/Memory 能力
2. **P2：增加 MCP 连接热刷新**——无需重启即可更新 MCP 连接
3. **P3：增加 Plugin Marketplace**——参考 Codex 的 marketplace 模式
4. **P3：增加 Connector 模式**——标准化的外部服务集成接口

---

## 十、Hooks/中间件系统对比

### 10.1 架构对比

```
Codex Hooks 系统:
  hooks/ crate:
    - 独立 crate——编译时类型安全
    - 事件驱动的钩子注册
    - 配置热重载

  支持的事件（推测，基于代码结构）:
    - 会话启动/结束
    - 工具调用前/后
    - API 调用前/后
    - 文件变化

Cabinet Observer Pipeline:
  AgentObserver 接口:
    - onStreamStart / onStreamEnd
    - onUserInput
    - onChunk
    - onToolCall / onToolResult
    - onStepEnd
    - onSessionComplete
```

| 对比点           | Codex CLI                                        | Cabinet                               | 评价                                   |
| ---------------- | ------------------------------------------------ | ------------------------------------- | -------------------------------------- |
| **类型安全**     | ✅ 独立 Rust crate——编译时类型检查               | ✅ TypeScript interface               | 两者都有类型安全                       |
| **可扩展性**     | ✅ 独立 crate——第三方可依赖 hooks crate 开发扩展 | ❌ Observer 只能在代码内注册          | **Codex 更好**——hooks crate 是公开 API |
| **生命周期覆盖** | 标准（会话/工具/API）                            | ✅ 更细粒度（chunk 级别 + step 级别） | **Cabinet 更好**——更精细的生命周期钩子 |

### 10.2 建议

1. **P2：将 Observer 接口独立为公开 package**——参考 Codex 的独立 hooks crate，让第三方可以依赖开发扩展

---

## 十一、工程纪律与质量保障对比

### 11.1 完整对比

| 对比点            | Codex CLI                                                                                                                        | Cabinet                          | 评价                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| **语言**          | **Rust**——编译时消除整类 bug（内存安全、数据竞争、空指针）                                                                       | TypeScript + strict mode         | Rust 的正确性保证更强                                       |
| **构建系统**      | Bazel——远程缓存、增量构建、多语言支持                                                                                            | pnpm + tsc -b——简单直接          | Bazel 更强大；pnpm 更轻量                                   |
| **模块限制**      | ✅ **500 行/模块**（不含测试），800 行硬上限。**core 禁止添加代码**                                                              | ✅ 500 行上限/文件，800 行硬上限 | 规则一致                                                    |
| **变更限制**      | ✅ **800 行/PR**（非机械变更），复杂逻辑 **500 行**                                                                              | ❌ 无 PR 大小限制                | **Codex 更好**——强制小步提交                                |
| **测试框架**      | ✅ Rust test + insta snapshot + 集成测试优先 + pretty_assertions                                                                 | ✅ Vitest                        | Codex 的测试工具链更丰富                                    |
| **Snapshot 测试** | ✅ **insta**——UI 变更必须更新 snapshot。`just test -p codex-tui` → review → accept                                               | ❌ 无                            | **Codex 独有**——确保 UI 回归不遗漏                          |
| **CI/CD**         | 15+ GitHub Actions workflow                                                                                                      | .github/workflows/               | 一致                                                        |
| **Lint**          | ✅ **clippy**——12+ 自定义 lint 规则（collapsible_if, inline_format_args, method_references, exhaustive_matches, boolean_params） | ✅ eslint + tsc --noEmit         | Codex 的 lint 规则更严格和具体                              |
| **架构校验**      | ❌ 无自动校验（依赖 code review 和 crate 边界）                                                                                  | ✅ `lint:arch` 自动验证 4 层依赖 | **Cabinet 独有**                                            |
| **控制论自评**    | ❌ 无                                                                                                                            | ✅ 8 条 VSM 原则，目标 88/100    | **Cabinet 独有**                                            |
| **依赖管理**      | ✅ Cargo.lock + **deny.toml**（cargo-deny 安全审计）+ 供应链审计 workflow                                                        | ✅ pnpm-lock.yaml                | Codex 的供应链安全更严格                                    |
| **API 兼容性**    | ✅ `just write-app-server-schema`——API 变更自动生成 TypeScript 类型                                                              | ❌ 无自动 API 类型生成           | **Codex 更好**                                              |
| **文档**          | ✅ AGENTS.md（极其详细，覆盖命名/测试/lint/API/沙箱/Snapshot）                                                                   | CABINET.md + CLAUDE.md           | **Codex 的 AGENTS.md 更全面**——覆盖了 Rust 特有的每一条规则 |
| **Feature Flag**  | ✅ rollout crate + rollout-trace                                                                                                 | ❌ 无                            | **Codex 独有**                                              |
| **OpenTelemetry** | ✅ otel crate——生产级可观测性                                                                                                    | ❌ 无                            | **Codex 独有**                                              |
| **Analytics**     | ✅ analytics crate——独立的事件追踪系统（client/events/facts/reducer）                                                            | ❌ 无                            | Codex 的分析系统更完整                                      |

### 11.2 Codex 的 Rust 工程规范亮点

AGENTS.md 中记录的规则展示了极高的工程纪律：

1. **禁止向 core 添加代码**——"resist adding code to codex-core"——防止核心膨胀
2. **Boolean 参数禁止**——`foo(false)` 或 `bar(None)` 不允许。使用 enum、命名方法或 newtype。逃逸时须用 `/*param_name*/` 注释
3. **Exhaustive matches**——避免 wildcard arms
4. **Method references over closures**——`foo.map(bar)` 优于 `foo.map(|x| bar(x))`
5. **Collapsible if**——可合并的 if 必须合并
6. **Inline format args**——所有 format! 变量必须内联
7. **Async trait**——禁止 `#[async_trait]`，使用 RPITIT + 显式 Send bound
8. **Snapshot 测试**——任何 UI 变更必须有 snapshot 覆盖
9. **API 规范**——`*Params`/`*Response`/`*Notification` 命名。`<resource>/<method>` 路由。camelCase 序列化。自动生成 TS 类型

### 11.3 建议

1. **P1：增加 PR 大小限制**——参考 Codex 的 800 行硬上限
2. **P1：增加 API 类型自动生成**——前后端共享类型，避免手动同步
3. **P2：增加 Snapshot 测试**——UI 变更自动回归
4. **P2：增加供应链安全审计**——cargo-deny 风格的依赖审计 workflow
5. **P2：增加更严格的 lint 规则**——参考 Codex 的 clippy 规则
6. **P3：引入 OpenTelemetry**——生产级可观测性
7. **P3：引入 Feature Flag 系统**——支持灰度发布和 A/B 测试

---

## 十二、关键设计差异总结表

| 设计维度         | Codex CLI 优势                                                                         | Cabinet 优势                                           | 建议优先级                                            |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| **语言**         | **Rust**——编译时安全 + 原生性能 + 静态二进制                                           | TypeScript——快速迭代 + 丰富生态                        | 各有场景                                              |
| **架构**         | 客户端-服务器分离 + 110+ crate + IPC 协议                                              | 4 层 monorepo + lint:arch 自动校验                     | P2：IPC 协议标准化                                    |
| **Agent 执行**   | Thread Fork + 启动预热 + 提及语法 + 受控上下文片段                                     | Observer Pipeline + 分层 ContextBuilder + 工具分类并行 | P2：Fork + 预热 + 提及语法                            |
| **工具系统**     | **独立执行引擎 + execpolicy + Shell 抽象 + 流式 patch + MCP 双向**                     | ToolPruner 动态裁剪 + DelegationTier                   | **P1：执行引擎独立化 + execpolicy**                   |
| **沙箱**         | **3 层沙箱 + 网络隔离 + 进程加固 + 跨平台**                                            | ❌ 无——最大安全差距                                    | **P0**（已在 DeerFlow 对比中识别）                    |
| **Skill**        | 13 个实用编码 Skill + 独立 crate                                                       | 三级渐进加载 + 显式作用域 + 变量替换                   | P2：增加更多实用 Skill                                |
| **记忆**         | 受控上下文片段 + 独立反馈系统                                                          | **WriteGate + 知识图谱 + 向量搜索 + 记忆衰减**         | 保持 Cabinet 优势                                     |
| **TUI**          | **ratatui + 90+ 模块——完整的终端体验**                                                 | Tauri Desktop + Web UI                                 | 各有场景                                              |
| **MCP**          | **双向（客户端+服务器）+ 热刷新**                                                      | 基础客户端                                             | P2：MCP 服务器 + 热刷新                               |
| **Hooks/扩展**   | 独立 hooks crate + Plugin Marketplace + Connectors                                     | Observer Pipeline（更细粒度）                          | P3：Plugin Marketplace                                |
| **工程纪律**     | **Rust lint 12 条 + PR 800 行限制 + Snapshot 测试 + API 自动 TS 生成 + OpenTelemetry** | lint:arch + 行数限制 + 控制论自评                      | P1：PR 限制 + API 生成 P2：Snapshot 测试 + 供应链审计 |
| **Feature Flag** | **rollout crate——生产级灰度发布**                                                      | ❌ 无                                                  | P3                                                    |
| **分发**         | **单一静态二进制 + 一键安装 + 预编译发布**                                             | pnpm install + build                                   | P2：改进分发（二进制打包）                            |
| **多前端**       | **TUI + IDE + 桌面 + Web——同一协议服务所有前端**                                       | Desktop + Web（无标准协议）                            | P2：IPC 协议标准化                                    |

---

## 十三、优先级改进建议

### P1 — 架构增强（1-2 周）

| #   | 改进项                 | 参考 Codex 模块                                      | 工作量       | 说明                                                   |
| --- | ---------------------- | ---------------------------------------------------- | ------------ | ------------------------------------------------------ |
| 1   | **执行引擎独立化**     | exec/ + exec-server/ crates                          | 中（3-5 天） | 将命令执行抽取为独立包 `@cabinet/exec`，支持可替换后端 |
| 2   | **执行策略引擎**       | execpolicy/ crate                                    | 中（3-5 天） | 声明式批准/拒绝规则，替代硬编码黑名单                  |
| 3   | **API 类型自动生成**   | app-server-protocol (`just write-app-server-schema`) | 中（3-5 天） | 从服务端类型自动生成前端 TypeScript 类型               |
| 4   | **PR 大小限制**        | 800 行/PR 硬上限                                     | 小（配置）   | 在 CI 中增加 diff 大小检查                             |
| 5   | **Shell 命令类型抽象** | shell-command/ crate                                 | 小（1-2 天） | 类型安全的命令构造，防止注入                           |

### P2 — 体验优化（按需）

| #   | 改进项                 | 参考 Codex 模块                     | 工作量       |
| --- | ---------------------- | ----------------------------------- | ------------ |
| 6   | **IPC 协议标准化**     | app-server-protocol/ crate          | 大（1-2 周） |
| 7   | **MCP 服务器模式**     | mcp-server/ crate                   | 中（3-5 天） |
| 8   | **MCP 连接热刷新**     | mcp_refresh.rs                      | 小（1-2 天） |
| 9   | **Snapshot UI 测试**   | insta + snapshot workflow           | 中（3-5 天） |
| 10  | **供应链安全审计**     | deny.toml + cargo-deny workflow     | 小（1 天）   |
| 11  | **会话 Fork 机制**     | ForkSnapshot                        | 中（3-5 天） |
| 12  | **会话启动预热**       | session_startup_prewarm             | 小（1-2 天） |
| 13  | **提及语法**           | mention_syntax (`@tool`, `!plugin`) | 小（1-2 天） |
| 14  | **更多实用内置 Skill** | code-review/bug-report/pr-body 等   | 中（3-5 天） |
| 15  | **分发优化**           | 预编译二进制 + 一键安装             | 中（3-5 天） |

### P3 — 战略方向（长期）

| #   | 改进项                 | 参考 Codex 模块                            | 说明                                  |
| --- | ---------------------- | ------------------------------------------ | ------------------------------------- |
| 16  | **Feature Flag 系统**  | rollout/ crate                             | 支持灰度发布和 A/B 测试               |
| 17  | **Plugin Marketplace** | marketplace_processor + plugin crate       | 完整的插件分发基础设施                |
| 18  | **OpenTelemetry**      | otel/ crate                                | 生产级可观测性                        |
| 19  | **TUI 支持**           | ratatui + 90+ 模块                         | 如需终端界面——巨大工程量              |
| 20  | **IDE 集成**           | VS Code/Cursor/Windsurf 插件               | 如需面向开发者的 IDE 体验             |
| 21  | **沙箱系统**           | linux-sandbox + windows-sandbox-rs + bwrap | P0 优先级（已在 DeerFlow 对比中识别） |
| 22  | **Connector 模式**     | connectors/ crate                          | 标准化的外部服务集成                  |
| 23  | **Analytics 子系统**   | analytics/ crate                           | 独立的事件追踪和分析                  |

---

## 十四、结论

### 14.1 总体评价

**Codex CLI** 代表了 OpenAI 对"AI 编码 Agent"的最高工程水平。它的优势在于：

- **Rust 工程纪律极致**——110+ crate、12 条 clippy lint、500 行模块限制、800 行 PR 限制、Snapshot UI 测试、编译时类型安全
- **安全架构完善**——3 层跨平台沙箱（Linux bwrap + seatbelt + Windows Sandbox）、网络隔离、进程加固、execpolicy 声明式策略引擎
- **客户端-服务器分离优雅**——app-server-protocol 定义标准 IPC、TUI/IDE/桌面/Web 共享同一后端
- **工具系统深厚**——独立执行引擎、Shell 命令类型抽象、流式 patch 解析器
- **分发体验极好**——单一静态二进制、一键安装、预编译发布
- **MCP 双向**——既是 MCP 客户端也是服务器
- **生产级基础设施**——Feature Flag (rollout)、OpenTelemetry、Analytics、Feedback 独立子系统

它的不足（从 Cabinet 视角）在于：

- 无 Decision 状态机和 Workflow 引擎——Codex 是"执行者"而非"管理者"
- 无知识图谱和向量搜索——记忆系统较简单
- 记忆管理无自动提取和衰减——依赖人工组织
- 记忆无 WriteGate 质量管理——Agent 直接写入
- 无成本预算控制（仅有 API plan 限制）
- Skill 系统无渐进加载——全量注册
- 单体仓库无显式架构分层——靠 110+ crate 边界而非分层规则

**Cabinet** 与 Codex 形成了清晰的**互补关系**：

| 场景             | Codex CLI 更适合                  | Cabinet 更适合                       |
| ---------------- | --------------------------------- | ------------------------------------ |
| **编码**         | ✅ 终端原生 + IDE 集成 + 沙箱安全 | ❌ 无终端/IDE 集成                   |
| **项目管理**     | ❌ 无 Decision/Workflow           | ✅ Decision + Workflow + Deliverable |
| **长期记忆**     | ❌ 基础消息存储                   | ✅ 知识图谱 + 向量搜索 + 衰减管理    |
| **成本控制**     | ❌ 依赖 plan 限制                 | ✅ CostTracker + BudgetGuard         |
| **多 Agent**     | ❌ 基础委派                       | ✅ Secretary + Dispatcher + Decision |
| **安全（执行）** | ✅ 3 层沙箱                       | ❌ 无沙箱                            |
| **安全（治理）** | ❌ 无分级授权                     | ✅ DelegationTier + Decision L0-L3   |
| **平台扩展**     | ❌ 封闭                           | ✅ A2A + External Agent + Daemon     |

### 14.2 核心行动

**三个最关键的改进：**

1. **P1：执行引擎独立化 + execpolicy**——Codex 验证了"执行子系统必须独立且可策略控制"这条架构原则
2. **P1：API 类型自动生成**——Codex 的 `just write-app-server-schema` 展示了前后端类型同步的最佳实践
3. **P0：沙箱隔离**（已在 DeerFlow 对比中识别，Codex 用 3 层沙箱验证了其必要性）

**三个最具价值的改进：**

4. **P2：MCP 服务器模式**——让 Cabinet 的能力（Decision/Workflow/Memory）可以被其他 Agent 通过 MCP 调用
5. **P2：IPC 协议标准化**——参考 app-server-protocol，为多前端架构奠定基础
6. **P1：PR 大小限制 + Snapshot 测试**——直接提升工程质量

### 14.3 Codex 对 Cabinet 的最大启示

Codex 用 Rust 和 110+ crate 证明了：

1. **"工具执行和安全"必须是独立的一等子系统**——不是 agent 代码中的几个工具文件
2. **"客户端-服务器分离"是规模化前提**——当你有 TUI + IDE + 桌面 + Web 四个前端时
3. **"工程纪律"是产品质量的基础**——12 条 lint、800 行 PR 限制、Snapshot UI 测试不是负担而是保障
4. **"MCP 双向"让 Agent 成为生态节点**——既是工具消费者也是工具提供者

而 Cabinet 在"软件治理"维度（Decision 状态机、Workflow 引擎、DelegationTier、知识图谱）上走得更远。两者结合将产生一个既有 Rust 级安全执行又有结构化决策治理的完整 AI 平台。

---

> 报告结束。如需针对某个具体模块编写详细实现方案，请指定模块名称。
