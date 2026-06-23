# Cabinet → Mastra 全量切换计划 v9：框架优先重建

> 原则：每一项能力，先查 Mastra 官方文档。有框架能力的，不写一行代码。框架没有的，再审视是否有必要保留。
> 日期：2026-06-23
> 前置：已完成 Mastra 全量文档研究（Agents、Workflows、Workspace、Memory、Observability、Evals、MCP、Channels、Voice、Auth、Processors/Guardrails、Signals、Background Tasks、HITL、Studio、Deployment）

---

## 一、框架优先裁决：逐能力审判

### 1.1 应该删除（Mastra 有更优等价物）

| #   | Cabinet 能力                                         | Mastra 等价物                                             | 理由                                                                                                                                                                      |
| --- | ---------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `@cabinet/agent` 全部                                | Mastra Agent + supervisor                                 | Agent 循环、工具调用、sub-agent 编排、background tasks、stopWhen——Mastra 全部内置，且多出 signals/streaming/structured output                                             |
| 2   | `@cabinet/workflow` 全部                             | `createWorkflow()`                                        | DAG (then/branch/parallel)、循环 (dountil/dowhile/foreach)、人机协同 (suspend/resume/HITL)、错误恢复 (retries/error handlers)、状态管理——Mastra 全覆盖且能力更强          |
| 3   | `@cabinet/gateway` 全部                              | Mastra Model Router + CostGuardProcessor                  | 40+ provider 路由、成本追踪、预算守卫、fallback 链——全部框架内置                                                                                                          |
| 4   | `@cabinet/events` 全部                               | Mastra Observability + Logging + Signals                  | Tracing 替代事件链、Logging 替代事件持久化、Signals 替代 AgentEventBus                                                                                                    |
| 5   | `@cabinet/harness` 全部                              | Mastra Evals + Observability + ObservationalMemory        | 15+ prebuilt scorers 替代 evaluator、ObservationalMemory Observer 替代 subconscious loop、Workflow state 替代 progress tracker、MCP 替代 browser pool                     |
| 6   | 文件工具（15个）                                     | Workspace Filesystem (`LocalFilesystem`)                  | 读/写/列/grep/move/copy/delete + requireReadBeforeWrite + requireApproval + maxOutputTokens ——比自研更安全                                                                |
| 7   | Shell 工具（1个）                                    | Workspace Sandbox (`LocalSandbox`)                        | 命令执行 + 输出截断 + ANSI清理 + approval                                                                                                                                 |
| 8   | LSP 工具（4个）                                      | Workspace LSP (`lsp: true`)                               | hover、goto-def、references、implementations 一行配置                                                                                                                     |
| 9   | 浏览器工具（6个）                                    | MCP + Browser MCP server                                  | 连接 Playwright/browser MCP 即可                                                                                                                                          |
| 10  | Web 工具（3个）                                      | MCP + web-fetch server                                    | HTTP/Web fetch 通过 MCP                                                                                                                                                   |
| 11  | 文档解析（4个）                                      | Workspace Sandbox（shell 调 pandoc）                      | Agent 自行用 shell 调用工具                                                                                                                                               |
| 12  | 知识搜索工具（3个）                                  | Workspace Search                                          | BM25 + 向量 + 混合搜索                                                                                                                                                    |
| 13  | 技能系统                                             | Workspace Skills                                          | `skills: ['skills']` 目录路径，Markdown 技能自动加载                                                                                                                      |
| 14  | MCP 集成代码                                         | Mastra MCPClient/MCPServer                                | 框架原生 MCP，不需要自己封装                                                                                                                                              |
| 15  | 安全检测 4 层                                        | Mastra Guardrails + Workspace policies                    | PromptInjectionDetector、ModerationProcessor、PIIDetector、CostGuardProcessor、UnicodeNormalizer、SystemPromptScrubber + Workspace requireApproval/requireReadBeforeWrite |
| 16  | 规则系统                                             | Mastra Guardrails                                         | Processor pipeline 替代规则引擎                                                                                                                                           |
| 17  | Route feedback                                       | Mastra Delegation hooks + Evals                           | onDelegationStart/Complete 替代反馈检测，scorers 替代路由质量评估                                                                                                         |
| 18  | Dashboard 统计                                       | Mastra Studio + Client SDK metrics API                    | Studio 可视化 + 编程查询                                                                                                                                                  |
| 19  | Progress tracker                                     | Mastra Workflow state                                     | 工作流状态自带进度追踪                                                                                                                                                    |
| 20  | Telemetry                                            | Mastra Observability                                      | 全部覆盖                                                                                                                                                                  |
| 21  | Insights                                             | Mastra ObservationalMemory + Scorers                      | Observer 提取模式 + 评分分析                                                                                                                                              |
| 22  | Evaluations                                          | Mastra Evals (15+ scorers)                                | answer-relevancy、faithfulness、toxicity、completeness 等                                                                                                                 |
| 23  | `@cabinet/secretary` — 意图解析 + LLM路由 + 嵌入匹配 | Mastra Agent instructions + RequestContext dynamic config | Agent 的 instructions 做路由决策，RequestContext 做动态模型/工具选择                                                                                                      |
| 24  | `@cabinet/secretary` — SecretaryAgent 编排器         | Mastra Agent supervisor 模式                              | Secretary 就是一个带有 sub-agents 的 supervisor Agent                                                                                                                     |
| 25  | Browser pool                                         | MCP browser server                                        | 不再需要自己管理 Playwright 进程池                                                                                                                                        |
| 26  | Human Node（结构化人工协作）                         | Mastra HITL (suspend/resume) + Agent Approval             | suspend 传上下文给人工、resume 恢复执行，比 Human Node 更灵活                                                                                                             |
| 27  | Employee 管理                                        | Mastra Working Memory (user profile template)             | 用户画像存入 working memory                                                                                                                                               |
| 28  | Communication (RSS/Email)                            | Mastra Channels (Slack/Discord/Telegram) + MCP            | Channels 覆盖消息通道，RSS/Email 可通过 MCP 或独立微服务                                                                                                                  |
| 29  | System 工具（剪贴板/通知/进程/对话框）               | —                                                         | 这些是桌面端独占的操作，服务端不需要，删除即可                                                                                                                            |
| 30  | Greeting 系统                                        | —                                                         | 纯前端功能，不依赖框架                                                                                                                                                    |

### 1.2 应该保留（Mastra 无等价物，且产品必需）

| #   | Cabinet 能力                         | 保留理由                                                                                                  |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | **Decision L0-L3** 决策框架 + 审计   | Mastra 有 Agent Approval 和 HITL suspend 但都不是分层的 4 级决策状态机。这是 Captain 范式的核心，不可替代 |
| 2   | **Knowledge Graph + 矛盾检测**       | Mastra ObservationalMemory 是日志型（观察→反思），不是图型。KG 的实体关系建模和矛盾检测没有等价物         |
| 3   | **Agent-SDK (A2A/SlotClient)**       | 外部 Agent 通信协议。Mastra MCP 是工具协议，A2A 是 Agent 协议——不同层面                                   |
| 4   | **Tauri Desktop** 桌面应用           | Mastra Studio 是 Web UI，不是原生桌面。Tauri 桌面体验是产品独有价值                                       |
| 5   | **DAG Editor UI**                    | 视觉工作流编辑器。Mastra Studio 有 Graph View 但需要适配输出 Mastra workflow 格式                         |
| 6   | **`@cabinet/cli`**                   | Cabinet 专属命令（安装、备份、迁移），Mastra CLI 不覆盖                                                   |
| 7   | **`@cabinet/ui`** 共享组件库         | 桌面端使用的 React 组件（DecisionCard 等）                                                                |
| 8   | **`@cabinet/storage`** SQLite 持久化 | 存储 Decision、KG、Skills、Settings 等 Cabinet 域数据。Mastra Storage 为自己的内部数据服务                |
| 9   | **Session Manager**                  | Mastra 的 thread/resource 管理的薄封装，提供 Cabinet 语义（projectId → thread 映射）                      |
| 10  | **Scheduler (cron)**                 | Mastra 的 background tasks + workflow sleepUntil 不覆盖 cron 表达式。定时循环任务需要 cron                |
| 11  | **Backup 系统**                      | 基础设施层，与 AI 框架无关                                                                                |
| 12  | **Workbench**                        | Cabinet 基础设施管理（agent 安装、MCP 注册等）                                                            |
| 13  | **Projector**                        | 外部 Agent 投影到本地工具。Mastra 没有等价概念                                                            |
| 14  | **Autopilot (cron + webhook)**       | 自主定时触发能力。cron 部分保留，webhook 可用 Mastra Workflow 入口替代                                    |

---

## 二、最终架构

```
┌─────────────────────── MASTRA 框架 ───────────────────────┐
│                                                            │
│  Agent       Supervisor (Secretary + 3 specialists)         │
│  Tools       Workspace (文件+Shell+LSP) + MCP (浏览+Web)    │
│  Workflow    createWorkflow (DAG/条件/并行/循环/HITL)       │
│  Memory      Observational + Working + Semantic Recall      │
│  Observability  Tracing + Logging + Metrics + Studio        │
│  Evals       15 prebuilt scorers + custom                   │
│  Guardrails  PromptInjection + Moderation + PII + Cost      │
│  Server      Hono adapter + Auth + Rate Limit + OpenAPI     │
│  MCP         MCPClient（消费外部工具）+ MCPServer（暴露服务）  │
│  Channels     Slack/Discord/Telegram (可选)                  │
│  Voice       TTS/STT/Speech-to-Speech (可选)                 │
│  Background Tasks  长任务异步执行                            │
│                                                            │
├─────────────────────── CABINET 独有 ───────────────────────┤
│                                                            │
│  Decision L0-L3   决策状态机 + 审计日志                      │
│  Knowledge Graph  实体关系 + 矛盾检测                        │
│  DAG Editor       Tauri 桌面可视化编辑器                    │
│  Projector        外部 Agent 投影                           │
│  Agent-SDK        A2A 协议 + SlotClient                     │
│  Session Manager  thread/resource 封装                      │
│  Scheduler        cron 定时任务                             │
│  Backup           数据备份                                  │
│  Workbench        基础设施管理                              │
│  Storage          SQLite (better-sqlite3)                   │
│  Desktop          Tauri + React 19                          │
│  CLI              cabinet 命令                              │
│  UI               共享组件库                                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 三、删除统计

| 包                        | 当前行数 | 删除后                                        | 状态         |
| ------------------------- | -------- | --------------------------------------------- | ------------ |
| `packages/agent`          | ~4,500   | ~500（safety + projector + process-identity） | 大幅削减     |
| `packages/workflow`       | ~3,000   | 0                                             | **完全删除** |
| `packages/gateway`        | ~2,000   | 0                                             | **完全删除** |
| `packages/events`         | ~1,500   | 0                                             | **完全删除** |
| `packages/harness`        | ~2,000   | ~300（browser-pool → 移到 desktop）           | 大幅削减     |
| `packages/memory`         | ~1,500   | ~400（KG + entity + contradiction）           | 大幅削减     |
| `packages/secretary`      | ~800     | ~150（session manager + greeting）            | 大幅削减     |
| `packages/types`          | ~800     | ~300（decision + KG + projector + workbench） | 削减         |
| `apps/server/src/routes/` | ~5,000   | ~2,500（保留 17 个 Cabinet 独有路由）         | 削减         |
| **总计删除**              |          | **~19,600 行**                                |              |

**新增 Mastra 代码：** ~500 行（mastra/index.ts + agents + workspace.ts + mcp.ts + 5 个 Cabinet 独有工具文件）

---

## 四、实施阶段

### 阶段 1：修复审计问题（先修 bug）

- [ ] Memory 添加 vector + embedder（阻止 semanticRecall 运行时崩溃）
- [ ] 修复 memory.ts 硬编码 sessionId
- [ ] Secretary Agent 添加 maxSteps

### 阶段 2：Workspace + MCP 替换自研工具

- [ ] 删除 `mastra/tools/file.ts`、`shell.ts`、`web.ts`
- [ ] 创建 `mastra/workspace.ts`（LocalFilesystem + LocalSandbox + LSP）
- [ ] 创建 `mastra/mcp.ts`（browser MCP）
- [ ] Secretary Agent 挂载 workspace

### 阶段 3：清理被 Mastra 覆盖的依赖

- [ ] 从 `apps/server/package.json` 移除：`@cabinet/agent`、`@cabinet/workflow`、`@cabinet/gateway`、`@cabinet/events`、`@cabinet/harness`
- [ ] 更新所有 import 指向 Mastra 等价物
- [ ] 清理 `context/build-context.ts` 中不再需要的初始化

### 阶段 4：补全 Cabinet 独有工具

- [ ] `mastra/tools/decision.ts`
- [ ] `mastra/tools/knowledge.ts`
- [ ] `mastra/tools/project.ts`
- [ ] `mastra/tools/agent.ts`
- [ ] `mastra/tools/scheduler.ts`
- [ ] `mastra/tools/status.ts`

### 阶段 5：Desktop DAG Editor 适配

- [ ] 导出格式从 Cabinet workflow JSON → Mastra workflow 定义
- [ ] 适配 Mastra Studio Graph View 作为参考

### 阶段 6：测试 + 最终验证

- [ ] `pnpm typecheck` 零错误
- [ ] Agent 对话功能正常
- [ ] 工具调用正常
- [ ] Workflow 执行正确
- [ ] Memory 读写正常
