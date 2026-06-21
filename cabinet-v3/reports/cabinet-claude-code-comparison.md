# Cabinet ↔ Claude Code 全维度深度对比分析报告

> 生成日期：2026-06-12
> 分析范围：Claude Code Rev（Anthropic Claude Code CLI 逆向工程重建，3.2k+ Star）与 Cabinet v2.0（TypeScript 重写后）
> 注意：Claude Code Rev 是 Anthropic Claude Code 的逆向工程重建版本，非原始上游仓库。部分模块为兼容性 shim 或降级实现
> 目的：逐层、逐模块、逐设计识别差距与改进机会

---

## 目录

1. [项目概览与定位对比](#一项目概览与定位对比)
2. [架构层对比](#二架构层对比)
3. [Agent 核心执行对比](#三agent-核心执行对比)
4. [工具系统对比](#四工具系统对比)
5. [权限与安全机制对比](#五权限与安全机制对比)
6. [上下文压缩与管理对比](#六上下文压缩与管理对比)
7. [Skill 系统对比](#七skill-系统对比)
8. [记忆系统对比](#八记忆系统对比)
9. [子代理/Agent 团队系统对比](#九子代理agent-团队系统对比)
10. [Hooks/中间件系统对比](#十hooks中间件系统对比)
11. [MCP 集成对比](#十一mcp-集成对比)
12. [插件系统对比](#十二插件系统对比)
13. [调度与自动化对比](#十三调度与自动化对比)
14. [用户界面与交互对比](#十四用户界面与交互对比)
15. [工程纪律与质量保障对比](#十五工程纪律与质量保障对比)
16. [关键技术细节对比](#十六关键技术细节对比)
17. [关键设计差异总结表](#十七关键设计差异总结表)
18. [优先级改进建议](#十八优先级改进建议)
19. [结论](#十九结论)

---

## 一、项目概览与定位对比

### 1.1 基本信息

| 维度            | Claude Code (Rev)                                                                 | Cabinet                                |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| **全称**        | Claude Code CLI（逆向工程重建版本）                                               | Cabinet — "Your AI Council"            |
| **作者/组织**   | Anthropic（逆向：oboard）                                                         | Cabinet Dev                            |
| **一句话描述**  | Anthropic 官方 AI 编码助手 CLI——"Agentic coding tool that lives in your terminal" | "Your AI Council"（你的 AI 内阁）      |
| **定位**        | 终端中的 AI 编码 Agent——理解代码库、执行多步骤操作、通过自然语言完成开发任务      | AI 驱动的项目管理与自主执行平台        |
| **开源时间**    | 2026-03（逆向重建版本）                                                           | 未公开                                 |
| **GitHub Star** | 3,200+（Rev 版本）/ 原版为闭源商业产品                                            | —                                      |
| **Fork**        | 3,800+                                                                            | —                                      |
| **Open Issues** | 9                                                                                 | —                                      |
| **主语言**      | TypeScript                                                                        | TypeScript                             |
| **运行时**      | **Bun**（Bun 1.3.5+）                                                             | Node.js（pnpm workspace）              |
| **底层框架**    | **Ink**（自研 React TUI 框架）+ 自研 Agent Loop                                   | Hono + Vercel AI SDK + 自研 Graph      |
| **UI**          | **Ink React TUI**（终端界面）+ 可选 IDE 集成（VS Code/JetBrains）                 | Tauri 桌面应用 + Hono 服务端           |
| **数据库**      | SQLite（会话持久化）+ 文件系统（memory/ 目录）                                    | SQLite（better-sqlite3，AES-256 加密） |
| **License**     | 无双 License（原始闭源产品的逆向工程）                                            | MIT                                    |
| **代码规模**    | **2,400+ 源文件**，单体 TypeScript 项目                                           | 15 packages + 2 apps，monorepo         |
| **安装方式**    | bun install + bun run dev                                                         | pnpm install + pnpm build              |
| **原始产品**    | Anthropic Claude Code——商业闭源产品，数万开发者日常使用                           | 自研开源项目                           |

### 1.2 设计哲学对比

| 设计理念       | Claude Code                                                                                  | Cabinet                                                                  |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Agent 架构** | 单体 QueryEngine + 工具池 + Hooks 事件系统 + compact 压缩。一个 QueryEngine 实例对应一个会话 | 多 Agent 内阁：Secretary → 多 Agent 协作 → Decision → Workflow           |
| **核心原则**   | **终端优先**——整个交互体验围绕 TUI 设计。**流式优先**——从 LLM 调用到工具执行全是流式         | **4 层架构**——依赖单向流动。**从终局设计**——假设 AI 全能，逐步添加脚手架 |
| **交互范式**   | 终端 REPL + 斜杠命令（100+ 命令）+ 权限审批弹窗 + IDE 集成                                   | 桌面应用 + Web UI + API。用户是 Captain，关注交付物而非过程              |
| **工具哲学**   | **工具即 UI 组件**——每个工具都有对应的 React 组件（`UI.tsx`），工具结果以富文本在 TUI 中渲染 | **工具即 Observer 钩子**——工具通过 Observer Pipeline 执行前后通知        |
| **代码组织**   | **大型单体**——所有代码在 `src/` 下，按功能分目录（tools/services/utils/components）          | **分层 Monorepo**——15 个包按 4 层架构组织                                |
| **扩展性**     | Plugin 系统（marketplace + 本地安装）+ Hooks（7 种事件类型）+ MCP + Skill + Output Style     | Observer Pipeline + MCP + A2A + Skill Registry                           |

### 1.3 核心交集

两者都是 **TypeScript AI Agent 运行时**，共享以下核心概念：

- Agent 循环执行（LLM 调用 → 工具执行 → 结果 → 下一轮）
- 工具系统（文件读写、Shell 命令、Web 搜索、Glob/Grep）
- 上下文压缩/摘要
- Skill 系统
- 记忆/文件持久化
- MCP 集成
- 子代理/委派
- 权限审批
- 流式 SSE 响应
- 斜杠命令系统

**根本差异：** Claude Code 是"终端中的 AI 编码伙伴"——一个极度务实、面向开发者的生产力工具，经过数百万真实用户的使用打磨。Cabinet 是"AI 内阁项目管理平台"——面向超级个体，通过多 Agent 协作和决策状态机管理复杂项目。前者是"即用型工具"，后者是"可扩展平台"。

---

## 二、架构层对比

### 2.1 总体架构模式

```
Claude Code 架构（单体 + 功能分区）:
  entrypoints/
    ├── cli.tsx           → CLI 入口
    ├── sdk/              → SDK 类型定义与协议
    ├── mcp.ts            → MCP 入口
    └── init.ts           → 初始化

  src/
    ├── QueryEngine.ts    → 核心 Agent 循环（会话状态管理）
    ├── Task.ts           → 任务系统
    ├── Tool.ts           → 工具基类
    ├── tools.ts          → 工具注册与过滤（getAllBaseTools + getTools）
    ├── commands.ts       → 命令注册
    ├── main.tsx          → 主入口（React TUI）
    │
    ├── query/
    │   ├── config.ts     → Query 配置
    │   ├── tokenBudget.ts → Token 预算
    │   └── transitions.ts → 状态转换
    │
    ├── services/
    │   ├── tools/        → 工具编排（toolOrchestration, StreamingToolExecutor）
    │   ├── compact/      → 上下文压缩
    │   ├── mcp/          → MCP 客户端与连接管理
    │   ├── lsp/          → LSP 集成
    │   ├── api/          → API 调用（claude.ts, client.ts）
    │   ├── plugins/      → 插件管理与安装
    │   ├── skills/       → Skill 搜索与发现
    │   └── analytics/    → 遥测与分析
    │
    ├── tools/            → 工具实现（每个工具一个目录，含 UI.tsx + prompt.ts）
    ├── components/       → React 组件（TUI 渲染）
    ├── hooks/            → React Hooks（状态管理）
    ├── utils/            → 工具函数（350+ 文件）
    └── commands/         → 斜杠命令实现

Cabinet 架构（分层 Monorepo）:
  Layer 4: ui (React)  server (Hono)  desktop (Tauri)  cli
    ↑
  Layer 3: decision  secretary  workflow  harness
    ↑
  Layer 2: gateway (Vercel AI SDK)  agent  memory
    ↑
  Layer 1: graph  types  events  storage
```

| 对比点             | Claude Code                                                                                                         | Cabinet                                                                                             | 评价                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **代码组织**       | **大型单体**——2,400+ 文件在单个 `src/` 下，按功能分目录。无正式的分层约束                                           | **分层 Monorepo**——15 个包按 4 层架构组织，有 `lint:arch` 自动校验                                  | Claude Code 的代码组织适用于"单一产品团队"；Cabinet 的架构更适合"多人多团队"和长期演进 |
| **架构约束**       | 隐式——通过代码审查和约定维持                                                                                        | 显式——`lint:arch` 自动验证依赖方向                                                                  | **Cabinet 更好**——架构规则自动执行                                                     |
| **工具与 UI 耦合** | **工具即 UI 组件**——每个工具目录包含 `UI.tsx`（TUI 渲染）+ `prompt.ts`（系统提示词）+ `ToolNameTool.ts`（执行逻辑） | **工具即纯函数**——每个 ToolDefinition 包含 name/description/parameters/execute。UI 渲染在应用层处理 | Claude Code 的工具封装更完整（自包含 UI + prompt）；Cabinet 的分离更清晰               |
| **状态管理**       | React Context + AppStateStore（Ink 组件树内）                                                                       | 每个 AgentLoop 有独立的 AgentExecutionContext                                                       | Claude Code 的 React 状态体系更成熟                                                    |
| **TUI 框架**       | **自研 Ink 框架**（`src/ink/`——完整 React reconciler + Yoga 布局引擎 + 终端 I/O）                                   | ❌ 无 TUI                                                                                           | **Claude Code 独有**——自研 TUI 框架是生产力工具的核心竞争力                            |

### 2.2 自研 Ink 框架（Claude Code 的核心基础设施）

Claude Code 包含一个完整的自研 TUI 框架（`src/ink/` 目录，150+ 文件），这是它与 Cabinet 最大的架构差异之一：

```
src/ink/
├── ink.tsx, reconciler.ts, root.ts    → React reconciler（将 React 组件渲染到终端）
├── renderer.ts, render-to-screen.ts   → 屏幕渲染引擎
├── layout/engine.ts, yoga.ts          → Yoga 布局引擎（Flexbox）
├── components/
│   ├── Box.tsx, Text.tsx              → 基础布局组件
│   ├── Button.tsx, Link.tsx           → 交互组件
│   ├── ScrollBox.tsx                  → 滚动容器
│   └── Newline.tsx, Spacer.tsx        → 布局辅助
├── hooks/
│   ├── use-input.ts                   → 键盘输入
│   ├── use-terminal-focus.ts          → 终端焦点
│   ├── use-animation-frame.ts         → 动画帧
│   └── use-selection.ts              → 文本选择
├── events/
│   ├── keyboard-event.ts             → 键盘事件
│   ├── input-event.ts                → 输入事件
│   ├── paste-event.ts                → 粘贴事件
│   └── resize-event.ts              → 窗口大小变化
├── termio/                           → 终端 I/O（ANSI/CSI/DEC/OSC/SGR 解析器）
└── selection.ts, focus.ts, cursor.ts → 高级终端特性
```

| 对比点       | Claude Code                                                              | Cabinet                          | 评价                                                 |
| ------------ | ------------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------- |
| **TUI 框架** | ✅ 自研 Ink——完整 React 终端渲染引擎                                     | ❌ 无 TUI——依赖桌面应用和 Web UI | **Claude Code 独有**——TUI 是开发者工具的最佳交互方式 |
| **终端特性** | ✅ 极其丰富——ANSI/CSI 解析、鼠标事件、粘贴事件、文本选择、焦点管理、动画 | ❌ 无                            | Claude Code 的终端能力是 Cabinet 完全缺失的维度      |

### 2.3 建议

1. **保持 Cabinet 的分层 Monorepo**——这对于长期演进和多人协作是必需的。Claude Code 的单体模式适合"单一产品团队"但不适合 Cabinet 的愿景
2. **P3：如果需要 TUI**，参考 Claude Code 的 Ink 框架——但注意这是巨大的工程量（150+ 文件的自研渲染引擎）
3. **借鉴 Claude Code 的工具封装模式**——每个工具自包含执行逻辑 + prompt + UI，而非将三者分离

---

## 三、Agent 核心执行对比

### 3.1 执行循环

```
Claude Code (QueryEngine.submitMessage + toolOrchestration.runTools):
  Phase 1 — Setup:
    清除发现集合 → 获取系统提示词 → 处理用户输入
    → persist transcript early（崩溃恢复）

  Phase 2 — Query Loop (for-await query({...})):
    每条消息 → push 到存储 → 记录 transcript → normalize SDK 消息
    message type: assistant | user | progress | stream_event | attachment
                | system (compact boundary) | tool_use_summary | tombstone

  Phase 3 — Tool Dispatch (runTools async generator):
    partitionToolCalls() → 按 isConcurrencySafe 分组
    ├─ 并发批次（只读工具）: runToolsConcurrently (max 10 concurrent)
    │   → yield* all(...) → 所有工具完成 → apply modifiers → advance context
    └─ 串行批次（写入工具）: runToolsSerially
        → 每个工具: apply modifier → update context → yield

  Phase 4 — Result:
    success | error_during_execution | error_max_turns
    | error_max_budget_usd | error_max_structured_output_retries

Cabinet (AgentLoop._execute):
  1. 组装上下文 (_assembleContext)
  2. Observer Pipeline: onStreamStart, onUserInput
  3. while (stepCount < maxSteps):
       toolExecutor dynamic pruning → LLM call (withRetry) → CostTracker
       → read-only tools: Promise.all parallel
       → write tools: for sequential
       → Observer: onToolCall → onToolResult → onStepEnd
  4. Observer Pipeline: onStreamEnd → Session Report
```

### 3.2 核心差异

| 对比点                | Claude Code                                                                                                                                        | Cabinet                                                    | 评价                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| **执行模式**          | AsyncGenerator（流式——每条消息和工具结果实时 yield）                                                                                               | async/await（手动循环）                                    | Claude Code 的 Generator 模式更优雅——天然支持流式和中断              |
| **工具并发**          | ✅ **partitionToolCalls()**——运行时判断 `isConcurrencySafe()`，自动分组为并发/串行批次。并发上限 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`（默认 10） | ✅ 硬编码的 `READ_TOOL_NAMES` Set（25 个名称），按集合判断 | **Claude Code 更好**——`isConcurrencySafe()` 是工具属性而非硬编码集合 |
| **上下文隔离**        | ✅ 并发工具执行时"context modifiers are queued (not applied immediately) to prevent race conditions"——并发完成后统一 apply                         | ❌ 无——并发工具直接修改共享 ctx                            | **Claude Code 更好**——并发安全是架构决策而非事后修补                 |
| **流式执行**          | ✅ **全链路流式**——从 LLM 调用（`stream_event`）到工具执行（`yield*` generator）到 UI 渲染                                                         | ❌ 手动 chunk 模拟（`content.slice(i, i+4)`）+ 8ms 延迟    | **Claude Code 原生流式**；Cabinet 是 hack                            |
| **Transcript 持久化** | ✅ **提前持久化**——用户消息在 API 调用**前**就写入 transcript，"so conversations are resumable even if killed mid-request"                         | ❌ 会话结束时才持久化                                      | **Claude Code 更好**——崩溃恢复更健壮                                 |
| **中断机制**          | ✅ abortController + 每次迭代检查                                                                                                                  | ❌ 无显式中断                                              | **Claude Code 更好**                                                 |
| **预算控制**          | ✅ **多层次预算**：maxTurns + maxBudgetUsd（成本预算）+ max_structured_output_retries（默认 5）                                                    | ✅ maxSteps（默认 50）+ CostTracker（会话级）              | Claude Code 的成本预算更实用（USD 上限 vs step 上限）                |
| **Structured Output** | ✅ 内置——`max_structured_output_retries` 最多重试 5 次                                                                                             | ✅ parseStructuredOutput() 三级回退提取                    | Claude Code 的内置 structured output 更可靠                          |

### 3.3 建议

1. **P1：将工具并发安全判断从硬编码 Set 改为 ToolDefinition 属性**——参考 Claude Code 的 `isConcurrencySafe()` 方法
2. **P1：增加 transcript 提前持久化**——用户消息在 LLM 调用前就写入持久化存储
3. **P1：增加多级预算控制**——在 maxSteps 之外增加 maxBudgetUsd（成本预算）
4. **P2：考虑将执行循环改为 AsyncGenerator 模式**——让流式更原生
5. **P2：增加并发安全上下文隔离**——并发工具 modifiers 排队，统一 apply

---

## 四、工具系统对比

### 4.1 工具注册与组织

```
Claude Code 工具系统:
  tools.ts:
    getAllBaseTools() → 返回所有工具构造器数组
      - 始终包含: AgentTool, TaskOutputTool, BashTool, FileReadTool,
                  FileEditTool, FileWriteTool, WebFetchTool, TodoWriteTool,
                  WebSearchTool, SkillTool, EnterPlanModeTool, BriefTool 等
      - 条件包含: 30+ 工具通过 feature flag / env var / 功能检测 gated

    getTools(permissionContext) → 过滤后的工具列表
      - Simple 模式: 仅 [BashTool, FileReadTool, FileEditTool]
      - Normal 模式: 去隐藏工具 + deny-rule 过滤 + isEnabled() 检查

    assembleToolPool() → 合并内置工具 + MCP 工具
      - 按名称排序（prompt-cache stability）
      - 去重（built-in 优先）
      - 应用 deny-rule

  每个工具目录结构:
    tools/BashTool/
    ├── BashTool.tsx         → 工具实现（执行 + UI）
    ├── UI.tsx               → TUI 渲染组件
    ├── prompt.ts            → 系统提示词注入
    ├── bashPermissions.ts   → 权限检查
    ├── bashSecurity.ts      → 安全检查
    ├── commandSemantics.ts  → 命令语义分析
    ├── destructiveCommandWarning.ts → 危险命令警告
    ├── pathValidation.ts    → 路径校验
    ├── toolName.ts          → 工具名称常量
    └── utils.ts             → 工具辅助函数

Cabinet 工具系统:
  tools/index.ts:
    createCabinetTools(deps) → 80+ ToolDefinition 数组
    按 category 拆分: file-tools, web-tools, shell-tools,
                     knowledge-tools, lsp-tools, browser-tools 等

  每个工具:
    {
      name, description, parameters (JSON Schema),
      execute: async (args, context?) => {...},
      timeoutMs?: number
    }
```

| 对比点                 | Claude Code                                                                                                              | Cabinet                                                    | 评价                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| **工具封装**           | **高度自包含**——每个工具目录包含执行逻辑 + TUI 渲染 + 系统提示词 + 安全检查 + 权限管理                                   | 执行逻辑 + description + parameters（分离的 UI 和 prompt） | Claude Code 的工具自包含模式更完整                             |
| **Feature Flag**       | ✅ **细粒度 gating**——30+ 工具通过 20+ feature flags 条件启用                                                            | ❌ 无——工具通过 ToolPruner 动态裁剪                        | Claude Code 的 feature flag 系统更生产级                       |
| **Simple 模式**        | ✅ `CLAUDE_CODE_SIMPLE`——仅暴露 3 个核心工具                                                                             | ❌ 无等效                                                  | Claude Code 的最小化模式值得借鉴                               |
| **MCP 合并**           | ✅ `assembleToolPool()`——按名称排序 + 去重 + 内置优先                                                                    | ✅ `registerMCPTools()`——MCP 工具注册为 `mcp__{name}`      | Claude Code 的去重策略更优雅                                   |
| **工具权限 deny 规则** | ✅ 基于规则的 deny 列表 + per-tool `isEnabled()`                                                                         | ✅ SafetyChecker 按 DelegationTier 分级                    | 各有千秋                                                       |
| **工具搜索**           | ✅ `ToolSearchTool`——Agent 可搜索工具目录                                                                                | ❌ 无                                                      | **Claude Code 更好**                                           |
| **反工具集**           | ✅ `ALL_AGENT_DISALLOWED_TOOLS`, `CUSTOM_AGENT_DISALLOWED_TOOLS`, `ASYNC_AGENT_ALLOWED_TOOLS`——细粒度 agent 类型工具控制 | ❌ 无——通过 ToolPruner 统一处理                            | **Claude Code 更好**——不同类型 Agent 有不同的工具白名单/黑名单 |

### 4.2 工具数量

| 类别           | Claude Code                                                                                                                 | Cabinet                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **文件系统**   | FileReadTool, FileWriteTool, FileEditTool, GlobTool, GrepTool, NotebookEditTool                                             | read_file, write_file, edit_file, glob, grep, file_info, list_directory, make_directory, delete_file, move_file, copy_file, apply_patch |
| **Shell**      | BashTool, PowerShellTool                                                                                                    | execute_command                                                                                                                         |
| **Web**        | WebFetchTool, WebSearchTool, WebBrowserTool                                                                                 | web_fetch, http_request                                                                                                                 |
| **Agent/委派** | AgentTool (子代理), TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool, TaskStopTool, SendMessageTool (Agent 间消息) | task (子代理，规划中)                                                                                                                   |
| **计划**       | EnterPlanModeTool, ExitPlanModeV2Tool, TodoWriteTool                                                                        | ❌ 无内置计划工具                                                                                                                       |
| **Skill**      | SkillTool, DiscoverSkillsTool                                                                                               | use_skill, update_skill                                                                                                                 |
| **MCP**        | ListMcpResourcesTool, ReadMcpResourceTool, McpAuthTool                                                                      | MCP 工具通过 `mcp__{name}` 注册                                                                                                         |
| **调度**       | CronCreateTool, CronDeleteTool, CronListTool, RemoteTriggerTool                                                             | ❌ 无内置调度工具（通过 Daemon/Autopilot 外部）                                                                                         |
| **团队**       | TeamCreateTool, TeamDeleteTool                                                                                              | ❌ 无（通过 Squad 间接）                                                                                                                |
| **Sandbox**    | EnterWorktreeTool, ExitWorktreeTool                                                                                         | ❌ 无 Sandbox                                                                                                                           |
| **其他**       | LSPTool, ReviewArtifactTool, SnipTool, TerminalCaptureTool, SleepTool, MonitorTool, ConfigTool                              | decision*\*, project*\_, employee\_\_, LSP tools, browser tools, email tools, archive tools                                             |

### 4.3 建议

1. **P1：增加 Feature Flag 系统**——不同场景/模式启用不同工具子集
2. **P1：增加 Simple 模式**——最小工具集的精简 Agent 模式
3. **P1：增加 Agent 类型专用工具控制**——不同类型 Agent 有不同的工具白名单/黑名单
4. **P1：增加 tool_search 工具**——让 Agent 自主搜索工具
5. **P2：借鉴 Claude Code 的工具自包含封装**——每个工具集 package 包含：执行逻辑 + UI 渲染提示 + 系统提示词注入 + 安全检查

---

## 五、权限与安全机制对比

### 5.1 权限系统

Claude Code 的权限系统是生产级工具中最成熟的设计之一：

```
Claude Code 权限系统:
  权限模式 (PermissionMode):
    - Default: 每次操作弹窗审批
    - Auto (Plan Mode): 在 Plan 模式下自动批准
    - Accept All Edits: 自动接受文件编辑
    - Bypass Permissions: 跳过权限检查（需确认）

  权限分类:
    ├── BashPermissionRequest (Shell 命令审批)
    │   ├── 命令语义分析 (commandSemantics.ts)
    │   ├── 危险命令检测 (destructiveCommandWarning.ts)
    │   ├── 路径校验 (pathValidation.ts)
    │   └── 只读命令自动批准 (readOnlyValidation.ts)
    ├── FileEditPermissionRequest (文件编辑审批)
    ├── FileWritePermissionRequest (文件写入审批)
    ├── FilePermissionDialog (通用文件权限)
    ├── WebFetchPermissionRequest (Web 请求审批)
    ├── AskUserQuestionPermissionRequest (向用户提问)
    ├── SkillPermissionRequest (Skill 使用审批)
    ├── SandboxPermissionRequest (Sandbox 权限)
    ├── EnterPlanModePermissionRequest (进入 Plan 模式)
    ├── ExitPlanModePermissionRequest (退出 Plan 模式)
    ├── NotebookEditPermissionRequest
    └── MonitorPermissionRequest

  权限规则系统:
    - PermissionRules: 持久化的用户规则（允许/拒绝特定操作）
    - 规则支持 glob 模式匹配（路径、命令、域名）
    - Directories 白名单（信任的工作区目录）
    - Shell 命令规则匹配 (shellRuleMatching.ts)
    - 影子规则检测 (shadowedRuleDetection.ts)

  权限持久化:
    - 用户规则存储在文件系统或安全存储
    - autoModeState 跟踪 Plan 模式下的自动批准状态
    - bypassPermissionsKillswitch 全局开关

  审批 UI:
    - 每种权限请求有专用的 React 组件（在 TUI 中渲染）
    - PermissionDialog 容器统一管理弹窗生命周期
    - 支持"总是允许"快捷选项

Cabinet 权限系统:
  SafetyChecker + DelegationTier (T0-T3):
    - T0 (Captain Review): 最高限制
    - T1 (Strategic Guard): 大多数工具需审批
    - T2 (Trusted Mode): 允许更多
    - T3 (Full Autonomy): 几乎全自动

  工具分类:
    - read_only, light_write, moderate, cost, destructive

  危险命令检测:
    - utils/security.ts 黑名单 (rm -rf, dd, mkfs, chmod 777 等)

  输入过滤:
    - ContentGuardObserver (用户输入和 LLM 输出)
```

| 对比点            | Claude Code                                                                   | Cabinet                                                    | 评价                                                                  |
| ----------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| **权限粒度**      | ✅ **每个工具类型有专用权限组件**——Bash/File/Web/Skill/Plan/Sandbox 各自独立  | ✅ 工具分类（read_only/write/destructive）+ DelegationTier | Claude Code 的粒度更细（每种工具独立的审批 UI）；Cabinet 的分级更简洁 |
| **用户规则**      | ✅ **PermissionRules**——用户可持久化"总是允许"/"总是拒绝"规则，支持 glob 匹配 | ❌ 无——仅通过 DelegationTier 全局控制                      | **Claude Code 独有**——用户可精细控制每个操作的权限                    |
| **Plan 模式**     | ✅ **Auto Mode (Plan Mode)**——在 Plan 模式下自动批准已 approve 的操作         | ❌ 无 Plan 模式                                            | **Claude Code 独有**——Plan Mode 是安全与效率的平衡点                  |
| **Bypass 模式**   | ✅ Bypass Permissions——高级用户可跳过所有权限检查                             | ✅ T3 (Full Autonomy)                                      | 概念一致                                                              |
| **危险命令检测**  | ✅ 语义分析 + 危险模式检测 + 路径校验 + 只读命令自动批准                      | ✅ 黑名单检测（rm -rf 等）                                 | Claude Code 更全面（不仅黑名单，还有语义分析和自动批准）              |
| **Web 请求审批**  | ✅ WebFetchPermissionRequest——preapproved 列表（documentation domains）       | ❌ 无                                                      | **Claude Code 更好**——防止 Agent 访问恶意 URL                         |
| **审批 UI**       | ✅ TUI 中的专用 React 弹窗组件 + "总是允许"快捷选项                           | ❌ 无 TUI——通过桌面/Web UI                                 | Claude Code 的审批体验更即时                                          |
| **Worktree 隔离** | ✅ EnterWorktreeTool/ExitWorktreeTool——git worktree 级别的文件系统隔离        | ❌ 无 Sandbox 隔离                                         | **Claude Code 独有**——轻量级的工作区隔离                              |

### 5.2 建议

1. **P1：增加用户可配置的权限规则**——参考 Claude Code 的 PermissionRules 系统，让用户可以持久化"总是允许/拒绝"特定操作的规则
2. **P1：增加 Plan Mode**——在明确的执行计划下自动批准计划内的操作
3. **P2：增加 Preapproved Web 域名列表**——内置 documentation/API 文档域名的自动批准
4. **P2：增强危险命令检测**——不仅是黑名单，增加命令语义分析和只读命令自动批准

---

## 六、上下文压缩与管理对比

### 6.1 压缩策略

```
Claude Code 压缩系统:
  compactConversation():
    1. 执行 pre-compact hooks
    2. streamCompactSummary() → 流式 LLM 摘要
       - 优先尝试 forked-agent path（复用主对话的 prompt cache）
       - 失败回退到直接流式调用
       - PTL retry: truncateHeadForPTLRetry() 丢弃最旧的 API-round groups
       - 30s keep-alive 信号（防止 WebSocket 空闲超时）
       - 剥离图片 + 已注入附件（避免重复）
       - 仅包含 FileReadTool（+ 可选 ToolSearchTool + MCP 工具）
    3. 清空文件状态和记忆缓存
    4. 并行生成 post-compact 附件（files, async agents, plans, skills, deferred tools, agent listings, MCP instructions）
    5. 运行 session-start + post-compact hooks

  partialCompactConversation():
    'up_to': 摘要 pivot 之前的消息（保留新消息）
    'from':  摘要 pivot 之后的消息（保留旧消息）
    清理旧的 compact boundary 防止"stale boundaries winning in backward scans"

  Post-Compact 参数:
    POST_COMPACT_MAX_FILES_TO_RESTORE: 5
    POST_COMPACT_TOKEN_BUDGET: 50,000
    POST_COMPACT_MAX_TOKENS_PER_FILE: 5,000
    POST_COMPACT_MAX_TOKENS_PER_SKILL: 5,000
    POST_COMPACT_SKILLS_TOKEN_BUDGET: 25,000
    MAX_COMPACT_STREAMING_RETRIES: 2

  Snip Compact:
    snipCompactIfNeeded() → snipProjection（投影到未来）
    SnipTool 允许 Agent 主动裁剪历史

Cabinet 压缩系统:
  ContextMonitor: 监控 token 使用量，跟踪 smart/warning/critical/dumb 区间
  ContextHandoff: 生成结构化的 Agent 交接文档
  AdaptiveContextMonitor: 基于历史指标动态调整阈值
```

| 对比点                         | Claude Code                                                                          | Cabinet                                           | 评价                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------- |
| **压缩触发**                   | ✅ 自动 + 手动（`/compact` 命令）                                                    | ✅ ContextMonitor auto-detection + ContextHandoff | Claude Code 的 `/compact` 手动触发是很好的用户体验                          |
| **压缩策略**                   | ✅ **LLM 流式摘要 + PTL retry + forked-agent cache sharing + post-compact 附件重建** | ✅ 交接文档（结构化 Markdown）                    | **Claude Code 的压缩更完整**——不仅是摘要，还包括文件/Agent/Skill 的重新附着 |
| **部分压缩**                   | ✅ **partialCompactConversation()**——`up_to`/`from` 两种方向                         | ❌ 无——仅全量交接                                 | **Claude Code 独有**——可以只压缩前半或后半对话                              |
| **Forked-Agent Cache Sharing** | ✅ 压缩时复用主对话的 prompt cache                                                   | ❌ 无                                             | **Claude Code 独有**——显著降低压缩的 token 成本                             |
| **Post-Compact 附件**          | ✅ **重新附着**——被压缩掉的文件重新读入、Agent/Skill listing 重新注入                | ❌ 无                                             | **Claude Code 更好**——确保压缩后 Agent 不丢失关键上下文                     |
| **Snip 机制**                  | ✅ **SnipTool + snipCompact**——Agent 可主动裁剪历史                                  | ❌ 无                                             | **Claude Code 更好**——Agent 自主管理上下文窗口                              |
| **Plan 模式延续**              | ✅ `createPlanModeAttachmentIfNeeded()`——压缩后重新附着 Plan 指令                    | ❌ 无                                             | Claude Code 确保压缩不破坏 Plan 状态                                        |
| **Token 预算**                 | ✅ 多个精确的 token 预算（files 50K, skills 25K, per-file 5K, per-skill 5K）         | ❌ 固定 budget                                    | **Claude Code 更精细**                                                      |

### 6.2 建议

1. **P1：升级上下文压缩**——参考 Claude Code 的：
   - LLM 流式摘要 + PTL retry
   - Post-compact 附件重新附着（文件、Agent 列表、Skill 列表）
   - 部分压缩（up_to/from）
   - Plan 模式状态延续
2. **P1：增加手动压缩命令**——`/compact` 让用户主动触发
3. **P2：增加 Snip 机制**——Agent 可自主调用 `snip` 工具裁剪对话历史
4. **P2：精确的 token 预算参数**——区别对待文件、Skill、Agent 列表的 token 配额

---

## 七、Skill 系统对比

### 7.1 架构对比

```
Claude Code Skill 系统:
  目录结构:
    src/skills/bundled/             → 内置 Skill
      ├── claude-api/               → Claude API 参考（多语言）
      │   ├── SKILL.md
      │   ├── python/, typescript/, go/, java/, csharp/, php/, ruby/
      │   └── shared/ (error-codes, models, prompt-caching, tool-use)
      ├── verify/                   → 验证 Skill
      │   ├── SKILL.md
      │   └── examples/ (cli.md, server.md)
      ├── debug.ts, dream.ts, hunter.ts, keybindings.ts
      ├── loop.ts, loremIpsum.ts, remember.ts, simplify.ts
      ├── skillify.ts, stuck.ts, updateConfig.ts
      ├── batch.ts, claudeInChrome.ts, scheduleRemoteAgents.ts
      └── runSkillGenerator.ts      → Skill 生成器

  加载流程:
    loadSkillsDir() → 扫描目录 → 解析 SKILL.md → 注册为 Skill
    mcpSkillBuilders.ts → 从 MCP 工具自动生成 Skill
    skillSearch/
      ├── localSearch.ts            → 本地 Skill 搜索
      ├── remoteSkillLoader.ts      → 远程 Skill 加载
      ├── remoteSkillState.ts       → 远程 Skill 状态管理
      └── prefetch.ts               → Skill 预取

  Skill 命令:
    /skills → 打开 Skill 管理界面
    SkillTool → Agent 可以调用 Skill

  扩展机制:
    - 用户自定义 Skill（~/.claude/skills/）
    - 项目级 Skill（.claude/skills/）
    - Marketplace Skill 安装
    - MCP 自动生成 Skill

Cabinet Skill 系统:
  目录结构:
    ~/.cabinet/skills/              → 用户 Skill
    项目/.cabinet/skills/           → 项目 Skill

  注册: SkillRegistry → L1 元数据 → L2 完整 body → L3 refs/scripts
  调用: /skill-name 斜杠命令
```

| 对比点             | Claude Code                                                               | Cabinet                                                            | 评价                                                       |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Skill 数量**     | 15+ 内置 + 社区 marketplace + MCP 自动生成 + 用户自定义                   | 4 内置（workflowDesigner, agentCreator, skillCreator, mcpBuilder） | Claude Code 的 Skill 生态更丰富                            |
| **MCP 自动 Skill** | ✅ **mcpSkillBuilders.ts**——MCP 工具自动生成 Skill                        | ❌ 无                                                              | **Claude Code 独有**——MCP 工具以 Skill 形式被注入 prompt   |
| **远程 Skill**     | ✅ **remoteSkillLoader + remoteSkillState**——从 URL/GitHub 动态加载 Skill | ❌ 无——仅本地文件目录                                              | **Claude Code 更好**——支持远程 Skill 安装和更新            |
| **Skill 搜索**     | ✅ **skillSearch/** 子系统——本地搜索 + 远程加载 + 预取                    | ❌ 无                                                              | **Claude Code 更好**                                       |
| **Skill 生成器**   | ✅ **runSkillGenerator.ts**——自动从经验生成 Skill                         | ❌ 无                                                              | **Claude Code 独有**                                       |
| **Output Styles**  | ✅ **outputStyles/**——可加载的输出风格目录（控制 Agent 的回复格式）       | ❌ 无                                                              | **Claude Code 独有**——不仅仅是 Skill，还有可加载的输出风格 |
| **Skill 变化检测** | ✅ `skillChangeDetector.ts`——自动检测 Skill 文件变化                      | ❌ 无                                                              | Claude Code 的热重载更智能                                 |
| **渐进加载**       | ❌ 全量加载                                                               | ✅ L1 元数据 → L2 完整 body → L3 refs/scripts                      | **Cabinet 更好**——更精细的 token 控制                      |
| **变量替换**       | ❌ 无                                                                     | ✅ $ARGUMENTS, $0, $1, {{key}}                                     | **Cabinet 更好**                                           |

### 7.3 建议

1. **P1：增加远程 Skill 加载**——从 URL/GitHub 动态安装 Skill
2. **P2：增加 MCP 自动 Skill 生成**——MCP 工具以 Skill 形式注入 prompt
3. **P2：增加 Skill 搜索**——本地全文搜索 + 远程发现
4. **P2：增加 Skill 自动生成**——从 Agent 完成的任务中自动提取 Skill
5. **P3：增加 Output Styles**——可加载的输出风格目录
6. **保持 Cabinet 的三级渐进加载和变量替换**——这些是优势

---

## 八、记忆系统对比

### 8.1 架构对比

```
Claude Code 记忆系统:
  memory/ 文件系统目录:
    ├── MEMORY.md          → 全局记忆（跨会话）
    ├── USER.md            → 用户档案
    ├── MEMORY.{project}/  → 项目特定记忆
    └── team/              → 团队共享记忆

  memdir/ (src/memdir/):
    ├── findRelevantMemories.ts  → 查找相关记忆
    ├── memoryScan.ts            → 扫描 memory/ 目录
    ├── memoryAge.ts             → 记忆时效管理
    ├── memoryTypes.ts           → 记忆类型
    ├── paths.ts                 → 目录路径
    └── teamMemPaths.ts          → 团队记忆路径
    └── teamMemPrompts.ts        → 团队记忆提示词

  services/SessionMemory/:
    ├── sessionMemory.ts         → 会话记忆提取
    ├── sessionMemoryUtils.ts    → 记忆工具函数
    └── prompts.ts               → 提取提示词

  services/extractMemories/:
    ├── extractMemories.ts       → LLM 驱动记忆提取
    └── prompts.ts               → 提取提示词

  services/autoDream/:
    ├── autoDream.ts             → 自动"梦想"（异步后台记忆整合）
    ├── consolidationLock.ts     → 整合锁
    ├── consolidationPrompt.ts   → 整合提示词
    └── config.ts               → 配置

  services/teamMemorySync/:
    ├── index.ts                 → 团队记忆同步
    ├── watcher.ts               → 文件变更监控
    ├── secretScanner.ts         → 秘密扫描（防止记忆泄露 API key）
    └── types.ts                → 类型定义

  记忆工具:
    - memory 工具（读写 MEMORY.md）
    - sessionMemory 提取
    - autoDream 后台整合
    - team memory 同步

Cabinet 记忆系统:
  MemoryFacade (统一接口)
    ├── ShortTermMemory (会话 KV, LRU + TTL)
    ├── LongTermMemory (SQLite + FTS5 + HNSW)
    ├── EntityMemory (偏好)
    ├── ProjectMemory (目标/里程碑/决策)
    ├── KnowledgeGraph (实体关系图)
    ├── WriteGate + CascadeBuffer + ConsolidationService
    └── MemoryDecayService
```

| 对比点       | Claude Code                                                                                                             | Cabinet                                                  | 评价                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| **存储后端** | 文件系统（Markdown 文件） + 会话内存                                                                                    | SQLite + FTS5 + HNSW 向量索引                            | **Cabinet 更好**——支持语义搜索和结构化查询                  |
| **记忆分类** | 全局 (MEMORY.md) + 用户 (USER.md) + 项目 (MEMORY.{project}) + 团队 (team/)                                              | ShortTerm + LongTerm + Entity + Project + KnowledgeGraph | Cabinet 的分类更系统化                                      |
| **记忆提取** | ✅ **autoDream**——异步后台 Agent 自动整合会话记忆。**sessionMemory**——会话级记忆提取。**extractMemories**——LLM 驱动提取 | ✅ ConsolidationService——可选 LLM 提取                   | Claude Code 的 autoDream 是"自主后台 Agent"模式，更富想象力 |
| **团队记忆** | ✅ **teamMemorySync**——Git 同步 + 文件监控 + 秘密扫描                                                                   | ❌ 无                                                    | **Claude Code 独有**——通过 Git 在团队间同步记忆             |
| **秘密防护** | ✅ **secretScanner.ts**——在团队记忆同步前扫描 API key/密码                                                              | ❌ 无                                                    | **Claude Code 更好**——防止记忆泄露敏感信息                  |
| **记忆时效** | ✅ **memoryAge.ts**——记忆时效管理                                                                                       | ✅ MemoryDecayService——更系统的衰减                      | Cabinet 的衰减更系统（expired/archived/superseded）         |
| **写入门控** | ❌ 无——Agent 直接写入 MEMORY.md                                                                                         | ✅ WriteGate 5 级分类                                    | **Cabinet 更好**——防止记忆污染                              |
| **知识图谱** | ❌ 无                                                                                                                   | ✅ 实体关系图 + 矛盾检测                                 | **Cabinet 独有**                                            |
| **向量搜索** | ❌ 无（文件系统）                                                                                                       | ✅ HNSW 向量索引                                         | **Cabinet 独有**                                            |

### 8.3 建议

1. **P1：增加 USER.md + MEMORY.md 文件支持**——让用户通过简单 Markdown 文件管理偏好和记忆
2. **P1：增加秘密扫描**——在记忆写入/同步前扫描 API key 和密码
3. **P2：增加 autoDream 风格的后台整合**——独立 Agent 在后台异步整合会话记忆
4. **P2：增加团队记忆同步**——通过 Git 在团队间同步共享记忆
5. **保持 Cabinet 的优势**：知识图谱、向量搜索、WriteGate、记忆衰减

---

## 九、子代理/Agent 团队系统对比

### 9.1 架构对比

```
Claude Code Agent 系统:
  AgentTool:
    ├── forkSubagent.ts          → Fork 子代理（独立上下文 + 工具子集）
    ├── runAgent.ts              → 运行 Agent
    ├── resumeAgent.ts           → 恢复 Agent 执行
    ├── agentMemory.ts           → Agent 记忆
    ├── agentMemorySnapshot.ts   → 记忆快照
    ├── agentDisplay.ts          → Agent 显示
    ├── agentColorManager.ts     → Agent 颜色管理
    └── prompt.ts                → 系统提示词

  built-in/:
    ├── claudeCodeGuideAgent.ts  → Claude Code 指南 Agent
    ├── exploreAgent.ts          → 探索 Agent（代码库探索）
    ├── generalPurposeAgent.ts   → 通用 Agent
    ├── planAgent.ts             → 计划 Agent
    ├── statuslineSetup.ts       → StatusLine 设置 Agent
    └── verificationAgent.ts     → 验证 Agent

  Agent 类型:
    - LocalAgentTask             → 本地 Agent 任务
    - InProcessTeammateTask      → 进程内队友（共享 TUI 布局）
    - RemoteAgentTask            → 远程 Agent（通过 Bridge）
    - DreamTask                  → 梦境任务（后台）
    - LocalWorkflowTask          → Workflow 任务
    - MonitorMcpTask             → MCP 监控任务

  Swarm 模式 (src/utils/swarm/):
    - 多 Agent 并行协作
    - ITerm/Tmux/InProcess 三种后端
    - Leader-Permission Bridge（权限从 Lead Agent 桥接）
    - spawnInProcess / inProcessRunner

  任务跟踪:
    - BackgroundTask, BackgroundTaskStatus, BackgroundTasksDialog
    - AsyncAgentDetailDialog, InProcessTeammateDetailDialog
    - WorkflowDetailDialog, ShellDetailDialog

Cabinet Agent 系统:
  AgentDispatcher:
    - Single / Pipeline / Parallel 三种模式
  Daemon: pull-mode 任务队列
  Squad: 团队路由
  External Agent: CLI/A2A Adapter
```

| 对比点           | Claude Code                                                                                                   | Cabinet                                                           | 评价                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| **内置 Agent**   | ✅ **6 个内置专用 Agent**——探索、计划、通用、验证、指南、StatusLine                                           | 3 个内置角色（Secretary/Curator/Organize）                        | Claude Code 的专用 Agent 更丰富                                   |
| **Swarm/团队**   | ✅ **Swarm 模式**——多 Agent 并行 + 多种终端后端 + Leader 权限桥接                                             | ✅ Squad Router——队长→队员负载均衡                                | Claude Code 的 Swarm 更偏向"终端多窗口"；Cabinet 更偏向"路由分发" |
| **Fork vs 新建** | ✅ **forkSubagent**——从当前 Agent fork，复用上下文                                                            | ✅ new AgentLoop——独立新建                                        | Claude Code 的 fork 模式更轻量                                    |
| **任务类型**     | ✅ **7 种任务类型**——LocalAgent, InProcessTeammate, RemoteAgent, Dream, LocalWorkflow, MonitorMcp, LocalShell | ✅ 3 种——Single/Pipeline/Parallel dispatch + Daemon + Interactive | Claude Code 的任务类型更丰富                                      |
| **进程内队友**   | ✅ **InProcessTeammateTask**——在同一个 TUI 布局中运行，共享界面                                               | ❌ 无——Agent 之间通过 EventBus 通信                               | **Claude Code 独有**——丰富的多 Agent 可视化                       |
| **Dream 任务**   | ✅ **DreamTask**——后台异步执行的"梦境"任务                                                                    | ✅ SubconsciousLoop——类似概念                                     | Claude Code 的 Dream 模式更完整                                   |
| **Agent 记忆**   | ✅ 每个 Agent 有独立的 agentMemory + agentMemorySnapshot                                                      | ❌ 共享 memorySessionId                                           | **Claude Code 更好**——Agent 级记忆隔离                            |
| **权限桥接**     | ✅ **Leader-Permission Bridge**——子代理从 Leader 继承权限                                                     | ✅ 共享 SafetyChecker                                             | Claude Code 的权限桥接更精细                                      |
| **Agent 颜色**   | ✅ **agentColorManager**——每个 Agent 在 TUI 中有独立颜色标识                                                  | ❌ 无                                                             | Claude Code 的 UX 细节                                            |

### 9.3 建议

1. **P1：增建更多内置专用 Agent**——参考 Claude Code 的 explore/plan/verify/general-purpose 分工
2. **P1：增加 Agent 级记忆隔离**——每个子代理有独立记忆，完成后可选地合并到父代理
3. **P2：增加 Swarm/团队视觉化**——多 Agent 并行时的可视化和状态追踪
4. **P3：增加 Dream 模式**——后台异步 Agent 持续执行低优先级任务

---

## 十、Hooks/中间件系统对比

### 10.1 架构对比

```
Claude Code Hooks 系统:
  7 种 Hook 事件类型:
    - SessionStart    → 会话启动
    - PreToolCall     → 工具调用前
    - PostToolCall    → 工具调用后
    - PreCompact      → 压缩前
    - PostCompact     → 压缩后
    - PreQuery        → API 调用前
    - Notification    → 系统通知

  执行模式:
    - execAgentHook    → 通过 Agent 执行 Hook（可调用工具）
    - execHttpHook     → HTTP 请求 Hook
    - execPromptHook   → 通过 Prompt 模板执行 Hook
    - fileChangedWatcher → 文件变化触发 Hook

  注册方式:
    - 通过 YAML 配置文件注册（frontmatter hooks）
    - 通过 Skill 注册（registerSkillHooks）
    - 通过 Plugin 注册（loadPluginHooks）

  生命周期:
    - hookEvents.ts → 事件发射器（单 subscriber + 缓冲队列）
    - hooksConfigManager.ts → 配置管理
    - hooksConfigSnapshot.ts → 配置快照
    - hooksSettings.ts → 设置管理

Cabinet Observer Pipeline:
  AgentObserver 接口:
    - onStreamStart    → 会话开始
    - onUserInput      → 用户输入
    - onChunk          → 流式块
    - onToolCall       → 工具调用
    - onToolResult     → 工具结果
    - onStepEnd        → 每步结束
    - onSessionComplete → 会话完成
    - onStreamEnd      → 流结束

  注册方式:
    - 在 AgentLoop 构造函数中显式注册
    - 通过 ObserverPipeline 统一调度
```

| 对比点           | Claude Code                                                            | Cabinet                                                   | 评价                                                     |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| **Hook 类型**    | ✅ **7 种事件类型**——覆盖会话/工具/压缩/API/通知                       | ✅ 8 种生命周期钩子——覆盖会话/工具/流式                   | 各有千秋。Claude Code 的 PreCompact/PostCompact 是独有的 |
| **执行方式**     | ✅ **3 种执行模式**——Agent Hook（可调用工具）+ HTTP Hook + Prompt Hook | ❌ 仅 Observer 类                                         | **Claude Code 更好**——Agent Hook 允许 Hook 本身调用工具  |
| **注册方式**     | ✅ **3 种注册方式**——YAML 配置 + Skill + Plugin                        | ❌ 仅代码内注册                                           | **Claude Code 更好**——非开发者也可以配置 Hooks           |
| **文件监控**     | ✅ **fileChangedWatcher**——文件变化触发 Hook                           | ❌ 无                                                     | **Claude Code 独有**                                     |
| **管道 vs 事件** | 事件发射器（单 subscriber + 缓冲队列）                                 | ✅ ObserverPipeline（链式通知，每 observer 独立错误处理） | Cabinet 的管道模式更健壮——一个 observer 失败不影响其他   |
| **配置热重载**   | ✅ hooksConfigSnapshot 支持配置热更新                                  | ❌ 需要重启                                               | **Claude Code 更好**                                     |

### 10.2 建议

1. **P1：增加文件变化 Hook**——文件变化时触发特定操作
2. **P2：增加多种 Hook 执行方式**——不仅限于 Observer 类，支持 HTTP Webhook 和外部脚本执行
3. **P2：增加 YAML/Skill 注册 Hooks**——让非开发者可以配置 Hooks
4. **P2：增加 PreCompact/PostCompact 事件**——压缩前后触发回调

---

## 十一、MCP 集成对比

| 对比点              | Claude Code                                                                           | Cabinet                             | 评价                              |
| ------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------- |
| **MCP 连接管理**    | ✅ **MCPConnectionManager**——完整的连接生命周期管理 + 重连 + OAuth 流程               | ✅ MCPManager——stdio/SSE 连接       | Claude Code 的连接管理更完整      |
| **MCP 认证**        | ✅ **McpAuthTool** + OAuth 端口监听 + XAA IdP 登录 + Channel 认证                     | ✅ OAuth 支持                       | Claude Code 的认证方式更丰富      |
| **MCP 工具合并**    | ✅ **assembleToolPool()**——内置工具优先 + 去重 + 按名称排序（prompt-cache stability） | ✅ mcp\_\_{name} 命名空间           | Claude Code 的去重策略更优雅      |
| **MCP 资源**        | ✅ ListMcpResourcesTool + ReadMcpResourceTool——Agent 可以浏览和读取 MCP 资源          | ✅ MCP resources/prompts 元数据注入 | Claude Code 的资源访问更交互式    |
| **MCP Elicitation** | ✅ **elicitationHandler + elicitationValidation**——MCP 服务器要求用户输入时的处理     | ❌ 无                               | **Claude Code 独有**              |
| **进程内 MCP**      | ✅ **InProcessTransport**——MCP 服务器运行在同一进程中                                 | ❌ 无                               | Claude Code 支持进程内 MCP 服务器 |
| **VSCode SDK MCP**  | ✅ **vscodeSdkMcp.ts**——与 VS Code 的 IDE 集成                                        | ❌ 无                               | Claude Code 的 IDE 集成更好       |
| **MCP 审批**        | ✅ **MCPServerApprovalDialog + MCPRemoteServerMenu**——新 MCP 服务器需要用户审批       | ❌ 无                               | **Claude Code 更好**——安全性更高  |
| **MCP 工具详情**    | ✅ **MCPToolDetailView + MCPToolListView**——TUI 中浏览 MCP 工具详情                   | ❌ 无 TUI                           | Claude Code 的 MCP UX 更完善      |

---

## 十二、插件系统对比

| 对比点           | Claude Code                                                                           | Cabinet                           | 评价                                 |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------ |
| **插件发现**     | ✅ **Marketplace**——官方 marketplace + 自定义 marketplace URL                         | ❌ 无 marketplace                 | **Claude Code 独有**                 |
| **插件安装**     | ✅ **PluginInstallationManager**——安装/更新/卸载 + marketplace browse + trust warning | ❌ 无——通过 npm 包和 MCP 间接扩展 | **Claude Code 更好**                 |
| **插件内容**     | ✅ 可扩展：Agent, Command, Hook, Skill, Output Style, MCP Server, Tool                | ❌ 仅 MCP + Skill                 | **Claude Code 的扩展面更广**         |
| **插件策略**     | ✅ pluginPolicy——安全策略控制 + pluginBlocklist + orphanedPluginFilter                | ❌ 无                             | **Claude Code 更好**                 |
| **插件自动更新** | ✅ pluginAutoupdate——自动检查并更新插件                                               | ❌ 无                             | **Claude Code 更好**                 |
| **插件市场**     | ✅ **officialMarketplace + officialMarketplaceGcs**——Google Cloud Storage 托管        | ❌ 无                             | Claude Code 有完整的插件分发基础设施 |

---

## 十三、调度与自动化对比

| 对比点         | Claude Code                                                                     | Cabinet                                | 评价                                                     |
| -------------- | ------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| **Cron 调度**  | ✅ CronCreateTool, CronDeleteTool, CronListTool——**Agent 可自主创建定时任务**   | ✅ Autopilot + Daemon——外部配置触发    | Claude Code 让 Agent 自主操作 cron；Cabinet 需要人工配置 |
| **Cron 实现**  | ✅ cronScheduler + cronTasks + cronTasksLock + cronJitterConfig——完整的调度引擎 | ✅ TaskScheduler + Autopilot + Webhook | 各有千秋。Claude Code 的 cron lock 和 jitter 是细节优化  |
| **远程触发**   | ✅ **RemoteTriggerTool**——远程触发 Agent 执行                                   | ❌ 无                                  | **Claude Code 更好**                                     |
| **Dream 模式** | ✅ **autoDream**——后台自动整合 + consolidationLock + consolidationPrompt        | ✅ SubconsciousLoop                    | Claude Code 的 Dream 模式更完整                          |
| **Agent 触发** | ✅ **AGENT_TRIGGERS** feature flag 控制                                         | ❌ 无等效                              | Claude Code 有专门的 Agent 触发器                        |

---

## 十四、用户界面与交互对比

| 对比点           | Claude Code                                                                                        | Cabinet                                       | 评价                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| **TUI**          | ✅ **Ink React TUI**——完整的终端用户界面（150+ 文件的自研框架）                                    | ❌ 无 TUI                                     | **Claude Code 的核心优势**                            |
| **桌面应用**     | 可选 IDE 集成（VS Code/JetBrains）+ Electron wrapper                                               | ✅ **Tauri 桌面应用**——Rust 后端 + React 前端 | Cabinet 的桌面应用更轻量                              |
| **IDE 集成**     | ✅ **深度 IDE 集成**——VS Code extension + JetBrains plugin + IDE diff + IDE selection + IDE status | ❌ 无                                         | **Claude Code 独有**——IDE 集成是编码 Agent 的核心体验 |
| **斜杠命令**     | ✅ **100+ 命令**——覆盖所有操作                                                                     | ✅ 基本命令                                   | Claude Code 的命令系统极其丰富                        |
| **语音输入**     | ✅ Voice mode (voice.ts + voiceStreamSTT + useVoice)                                               | ❌ 无                                         | Claude Code 支持语音                                  |
| **Vim 模式**     | ✅ **内置 Vim 模式**——完整的 Vim motions/operators/textObjects                                     | ❌ 无                                         | **Claude Code 独有**                                  |
| **主题**         | ✅ ThemePicker + OutputStylePicker + ColorPicker                                                   | ❌ 无                                         | Claude Code 的可定制性更强                            |
| **键盘快捷键**   | ✅ 完整的 keybinding 系统——可自定义 + 冲突检测 + 模板                                              | ❌ 无                                         | Claude Code 的键盘操作更专业                          |
| **Diff 展示**    | ✅ **StructuredDiff + colorDiff + syntax highlighting + in-IDE diff**                              | ❌ 无                                         | **Claude Code 独有**                                  |
| **Agent 可视化** | ✅ TeammateSpinnerTree + CoordinatorAgentStatus + AgentProgressLine + taskStatusUtils              | ❌ 无                                         | Claude Code 的多 Agent 可视化更丰富                   |
| **消息类型**     | ✅ **30+ 消息类型**——每种消息有专用 React 组件                                                     | ❌ 基本文本消息                               | Claude Code 的消息渲染极其丰富                        |
| **Spinner/动画** | ✅ GlimmerMessage + ShimmerChar + SpinnerAnimationRow + KawaiiSpinner                              | ❌ 无                                         | Claude Code 的等待动画更生动                          |

---

## 十五、工程纪律与质量保障对比

| 对比点         | Claude Code                                    | Cabinet                                                         | 评价                                                             |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| **测试**       | ❌ 未在 Rev 版本中包含（原版有完整的测试套件） | ✅ Vitest——每个包有 `__tests__/`                                | Cabinet 有可见的测试覆盖                                         |
| **CI/CD**      | ❓ Rev 版本无 CI（原版有）                     | ✅ .github/workflows/                                           | —                                                                |
| **代码规模**   | **2,400+ 文件**——大型单体                      | 15 packages + 2 apps——模块化                                    | Claude Code 的单体适合快速迭代；Cabinet 的 monorepo 适合长期演进 |
| **架构校验**   | ❌ 无自动校验                                  | ✅ `lint:arch` 自动验证 4 层依赖                                | **Cabinet 更好**                                                 |
| **行数限制**   | ❌ 无                                          | ✅ 500 行上限/文件，800 硬上限                                  | **Cabinet 更好**                                                 |
| **控制论自评** | ❌ 无                                          | ✅ 8 条 VSM 原则，目标 88/100                                   | **Cabinet 独有**                                                 |
| **TypeScript** | ✅ TypeScript（但无 strict mode 约束）         | ✅ strict: true, noUncheckedIndexedAccess, verbatimModuleSyntax | **Cabinet 更严格**                                               |
| **依赖管理**   | ✅ bun.lock（Bun 锁定文件）                    | ✅ pnpm-lock.yaml                                               | 一致                                                             |
| **Runtime**    | Bun（更快的启动和安装）                        | Node.js (ES2022)                                                | Bun 更快但 Node.js 生态更成熟                                    |

---

## 十六、关键技术细节对比

### 16.1 Claude Code 的独特能力（Cabinet 完全缺失）

| 能力                   | 说明                                                                  | 重要性     |
| ---------------------- | --------------------------------------------------------------------- | ---------- |
| **Ink TUI 框架**       | 自研 React 终端渲染引擎——150+ 文件。Claude Code 的核心用户体验基础    | ⭐⭐⭐⭐⭐ |
| **IDE 集成**           | VS Code + JetBrains 深度集成——in-IDE diff、selection sync、status bar | ⭐⭐⭐⭐⭐ |
| **Vim 模式**           | 完整的 Vim motions/operators/textObjects——面向开发者的键盘效率        | ⭐⭐⭐     |
| **Voice 输入**         | 语音转文本 + 语音模式                                                 | ⭐⭐       |
| **Plan Mode**          | 先出计划→用户审批→自动执行的模式                                      | ⭐⭐⭐⭐⭐ |
| **Swarm 模式**         | 多 Agent 并行 + 多终端后端 + Leader 权限桥接                          | ⭐⭐⭐⭐   |
| **Dream 任务**         | 后台异步 Agent 自动整合记忆和生成 Skill                               | ⭐⭐⭐     |
| **Worktree 隔离**      | Git worktree 级别的文件系统隔离                                       | ⭐⭐⭐     |
| **Snip 机制**          | Agent 自主裁剪对话历史                                                | ⭐⭐⭐     |
| **Output Styles**      | 可加载的输出风格目录                                                  | ⭐⭐       |
| **Plugin Marketplace** | 完整的插件分发和安装基础设施                                          | ⭐⭐⭐⭐   |
| **Diff 展示**          | StructuredDiff + 语法高亮 + IDE 内 diff                               | ⭐⭐⭐⭐   |
| **Prompt Cache**       | Forked-Agent Cache Sharing + prompt-cache stability（工具按名称排序） | ⭐⭐⭐⭐   |

### 16.2 Cabinet 的独特能力（Claude Code 不具备或较弱）

| 能力                | 说明                                                                          | 重要性     |
| ------------------- | ----------------------------------------------------------------------------- | ---------- |
| **Decision 状态机** | L0-L3 决策升级 + 自动批准 + 审计日志                                          | ⭐⭐⭐⭐⭐ |
| **Workflow 引擎**   | 18 种节点类型的 DAG 执行引擎                                                  | ⭐⭐⭐⭐⭐ |
| **知识图谱**        | 实体关系图 + 矛盾检测 + LLM 语义矛盾检查                                      | ⭐⭐⭐⭐   |
| **向量搜索**        | HNSW + BM25 RRF 融合的记忆搜索                                                | ⭐⭐⭐⭐   |
| **WriteGate**       | 5 级记忆分类——防止记忆污染                                                    | ⭐⭐⭐⭐   |
| **成本控制**        | CostTracker (RMB) + BudgetGuard (日/周/月) + FallbackChain + RateLimitTracker | ⭐⭐⭐⭐   |
| **A2A 协议**        | Agent-to-Agent 互操作协议                                                     | ⭐⭐⭐     |
| **外部 Agent**      | CLI/Codex/OpenCode Adapter + Daemon pull-mode                                 | ⭐⭐⭐     |
| **控制论框架**      | VSM 8 条原则 + 系统级自我认知 + PIS 评分                                      | ⭐⭐⭐     |
| **4 层架构**        | lint:arch 自动校验 + 行数限制                                                 | ⭐⭐⭐     |
| **Tauri 桌面**      | 轻量级桌面应用（Rust 后端 < 10MB）                                            | ⭐⭐⭐     |

---

## 十七、关键设计差异总结表

| 设计维度       | Claude Code 优势                                                            | Cabinet 优势                                          | 建议优先级                             |
| -------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| **Agent 执行** | AsyncGenerator 流式 + partitionToolCalls 自动分组 + transcript 提前持久化   | Observer Pipeline + 工具分类并行                      | P1：isConcurrencySafe() + 提前持久化   |
| **工具系统**   | Feature Flag gating + Agent 类型专用工具控制 + tool_search                  | ToolPruner 动态裁剪 + 工具分类执行                    | P1：Feature Flag + Agent 类型工具控制  |
| **权限**       | **PermissionRules + Plan Mode + 专用 UI 组件**                              | DelegationTier + SafetyChecker + 工具分类             | P1：PermissionRules + Plan Mode        |
| **上下文压缩** | **LLM 流式摘要 + post-compact 附件 + 部分压缩 + forked-agent cache + Snip** | 交接文档 + 监控                                       | **P1：全面升级**——最大差距             |
| **Skill**      | 远程加载 + MCP 自动生成 + 搜索 + 生成器                                     | 三级渐进加载 + 变量替换                               | P1：远程加载 + 搜索 P2：MCP 自动生成   |
| **记忆**       | USER.md + MEMORY.md + team sync + secret scanner                            | 知识图谱 + 向量搜索 + WriteGate + 衰减                | P1：USER.md/MEMORY.md + secret scanner |
| **子代理**     | 6 内置 Agent + Swarm + fork + Dream + agent memory 隔离                     | Structured dispatch + Daemon + Squad + A2A            | P2：增加内置 Agent + Agent 记忆隔离    |
| **Hooks**      | Agent Hook + HTTP Hook + Prompt Hook + 文件监控 + YAML 注册                 | Observer Pipeline（更健壮的链式执行）                 | P2：增加多种执行方式 + 文件监控        |
| **MCP**        | 连接管理 + 审批 + Elicitation + 进程内 + VS Code SDK                        | 基本 MCP 支持                                         | P2：MCP 审批 + 连接管理增强            |
| **插件**       | **Marketplace + 安装管理 + 自动更新 + 策略控制**                            | ❌ 无插件系统                                         | P3：插件系统                           |
| **调度**       | Agent 自主 cron + Remote Trigger + Dream                                    | Autopilot + Daemon + Webhook                          | P2：Agent 自主 cron                    |
| **UI**         | **Ink TUI + IDE 集成 + Vim + Voice + Diff + 100+ 命令**                     | Tauri Desktop + Web UI                                | 各有场景                               |
| **工程纪律**   | 单体 2,400+ 文件——快速迭代                                                  | **lint:arch + 行数限制 + 控制论 + TypeScript strict** | Cabinet 的工程纪律更扎实               |

---

## 十八、优先级改进建议

### P1 — 架构增强（1-2 周）

| #   | 改进项                               | 参考 Claude Code 模块                                      | 工作量       | 实施方案                                                                  |
| --- | ------------------------------------ | ---------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| 1   | **升级上下文压缩**                   | compact.ts + snipCompact + postCompactCleanup              | 大（1-2 周） | LLM 流式摘要 + post-compact 附件重新附着 + 部分压缩 + SnipTool            |
| 2   | **增加 Plan Mode**                   | EnterPlanModeTool + ExitPlanModeTool + planModeV2          | 中（3-5 天） | 先出计划→用户审批→自动执行。与 Decision 状态机集成                        |
| 3   | **增加用户权限规则**                 | PermissionRules + permissionRuleParser + shellRuleMatching | 中（3-5 天） | 持久化"总是允许/拒绝"规则，支持 glob 匹配                                 |
| 4   | **isConcurrencySafe() + 提前持久化** | Tool.isConcurrencySafe + transcript early persist          | 小（1-2 天） | ToolDefinition 增加 isConcurrencySafe 属性；用户消息在 LLM 调用前写入存储 |
| 5   | **增加 Feature Flag 系统**           | 20+ feature flags + getTools filtering                     | 中（3-5 天） | 不同场景/模式启用不同工具子集                                             |
| 6   | **增加 Agent 类型专用工具控制**      | ALL_AGENT_DISALLOWED_TOOLS 等                              | 小（1-2 天） | 不同 Agent 类型有不同的工具白名单/黑名单                                  |
| 7   | **支持 USER.md + MEMORY.md**         | memdir + sessionMemory + extractMemories                   | 小（1-2 天） | 加载和写入简单 Markdown 文件格式的记忆                                    |
| 8   | **增加秘密扫描**                     | secretScanner.ts + teamMemSecretGuard                      | 小（1 天）   | 记忆写入前扫描 API key/密码                                               |

### P2 — 体验优化（按需）

| #   | 改进项                            | 参考 Claude Code 模块                          | 工作量       |
| --- | --------------------------------- | ---------------------------------------------- | ------------ |
| 9   | **增加 tool_search 工具**         | ToolSearchTool                                 | 小（1-2 天） |
| 10  | **增加 Preapproved Web 域名列表** | WebFetchTool/preapproved.ts                    | 小（1 天）   |
| 11  | **增加远程 Skill 加载**           | remoteSkillLoader + remoteSkillState           | 中（3-5 天） |
| 12  | **增加 Skill 搜索**               | skillSearch/                                   | 中（3-5 天） |
| 13  | **增加文件变化 Hook**             | fileChangedWatcher                             | 小（1-2 天） |
| 14  | **增加 Agent 自主 cron**          | CronCreateTool + cronScheduler                 | 中（3-5 天） |
| 15  | **增加 Agent 级记忆隔离**         | agentMemory + agentMemorySnapshot              | 中（3-5 天） |
| 16  | **MCP 审批 + 连接管理增强**       | MCPServerApprovalDialog + MCPConnectionManager | 中（3-5 天） |
| 17  | **增加 Snip 机制**                | SnipTool + snipCompact                         | 中（3-5 天） |

### P3 — 战略方向（长期）

| #   | 改进项                 | 参考 Claude Code 模块                           | 说明                       |
| --- | ---------------------- | ----------------------------------------------- | -------------------------- |
| 18  | **TUI 支持**           | Ink 框架（150+ 文件）                           | 如需终端界面——巨大的工程量 |
| 19  | **IDE 集成**           | VS Code + JetBrains extension                   | 如需面向开发者的 IDE 集成  |
| 20  | **Plugin Marketplace** | PluginInstallationManager + marketplace         | 完整的插件分发基础设施     |
| 21  | **Swarm/团队可视化**   | Swarm + InProcessTeammate + TeammateSpinnerTree | 多 Agent 并行可视化        |
| 22  | **Dream 模式**         | autoDream + consolidationLock                   | 后台异步 Agent             |
| 23  | **Vim 模式**           | Vim motions/operators/textObjects               | 键盘效率                   |
| 24  | **Worktree 隔离**      | EnterWorktreeTool + ExitWorktreeTool            | Git worktree 级别的沙箱    |
| 25  | **Output Styles**      | outputStyles/ + OutputStylePicker               | 可加载的输出风格目录       |

---

## 十九、结论

### 19.1 总体评价

**Claude Code** 是一个经过数百万用户验证的**生产级 AI 编码 Agent**。它的优势在于：

- **终端体验极致**——自研 Ink TUI 框架（150+ 文件），Vim 模式、语音输入、100+ 命令
- **权限系统极其成熟**——PermissionRules + Plan Mode + 专用审批 UI 组件
- **上下文压缩精妙**——LLM 流式摘要 + post-compact 附件重建 + forked-agent cache sharing
- **工具系统灵活**——Feature Flag gating + Agent 类型工具控制 + 30+ 条件工具
- **IDE 集成深度**——VS Code + JetBrains 无缝集成
- **工程规模宏大**——2,400+ 文件，覆盖工具执行的每个细节

它的不足（从 Cabinet 视角）在于：

- 无 Decision 状态机和 Workflow 引擎
- 无知识图谱和向量搜索
- 无成本预算控制（仅有 USD 上限）
- 代码组织为单体——缺乏分层架构和模块边界
- 封闭产品（原始 Claude Code 闭源）

**Cabinet** 的设计思想更先进的项目管理导向平台，与 Claude Code 形成互补：

| 场景         | Claude Code 更适合       | Cabinet 更适合                                  |
| ------------ | ------------------------ | ----------------------------------------------- |
| **编码**     | ✅ IDE 集成 + 终端原生   | ❌ 无 IDE 集成                                  |
| **项目管理** | ❌ 无 Decision/Workflow  | ✅ Decision + Workflow + Deliverable            |
| **长期记忆** | ❌ 文件系统 + 无语义搜索 | ✅ 知识图谱 + 向量搜索 + WriteGate              |
| **成本控制** | ❌ 仅 USD 上限           | ✅ CostTracker + BudgetGuard + RateLimitTracker |
| **平台扩展** | ❌ 仅终端 + IDE          | ✅ 通过 monorepo 和 A2A 协议扩展                |

### 19.2 核心行动

**三个最关键的改进：**

1. **P1：升级上下文压缩**——这是 Cabinet 和 Claude Code 差距最大的领域。参考 compact.ts 的完整实现（LLM 流式摘要 + post-compact 附件 + 部分压缩）
2. **P1：增加 Plan Mode + 用户权限规则**——这是安全与效率的最佳平衡点
3. **P1：增加 Agent 类型工具控制 + Feature Flag 系统**——让不同场景的 Agent 有不同的工具集

**三个最具价值的改进：**

4. **P1：提前持久化 transcript**——崩溃恢复的关键改进
5. **P2：增加 Agent 自主 cron + 文件变化 Hook**——Agent 的自主性和反应性
6. **P2：增加远程 Skill 加载 + Skill 搜索**——Skill 生态的基础设施

### 19.3 两项目的互补关系

Claude Code 和 Cabinet 代表了 AI Agent 的两个不同方向：

- **Claude Code** 是"**深度工具**"——在单一领域（编码）做到极致，通过 TUI/IDE 提供最佳开发者体验
- **Cabinet** 是"**广度平台**"——通过多 Agent 内阁、决策状态机、工作流引擎覆盖复杂的项目管理场景

**如果 Cabinet 能借鉴 Claude Code 的：**上下文压缩策略、Plan Mode、用户权限规则、Feature Flag 系统
**如果 Claude Code 能借鉴 Cabinet 的：**Decision 状态机、Workflow 引擎、知识图谱、向量搜索、成本预算控制

两者都将更接近各自愿景中的"完美 AI 伙伴"。

---

> 报告结束。如需针对某个具体模块编写详细实现方案，请指定模块名称。
