# Cabinet 系统全景审计报告

> 生成时间：2026-06-23
> 审计范围：apps/server/、packages/ 全部模块
> 背景：经历 V5 SDK v7 迁移（P1-P5）+ P6-P7 清理 + P6-P11 Mastra 集成后

---

## 总体结论：三层混合架构

系统目前存在三个平行的层，其中只有两层参与生产流量，Mastra 层是完整但休眠的侧车。

```
┌─────────────────── PRODUCTION ACTIVE ───────────────────┐  ┌── DORMANT ──┐

Agent:     SecretaryAgent                                  │  Mastra Agents
             ├─ ToolLoopAgent (SDK v7) 优先                │  (0 调用)
             └─ AgentLoop → SdkAgentLoopAdapter            │
                → ToolLoopAgent (回退, 冗余包装)            │

Tools:     75+ ToolDefinition → createSdkTools()            │  3 Mastra tools
           → SDK tool()                                     │  (不同命名/无安全)

Workflow:  @cabinet/workflow WorkflowEngine                 │  Mastra workflow
           (DAG + 17 node types)                            │  (hello-world 死代码)

Memory:    STM → WriteGate → CascadeBuffer → LTM            │  Mastra Memory
           + KG + Decay + MemoryFacade                      │  (observationalMemory)

Observability: EventBus + ObservabilityCollector            │  Mastra Observability
               + Gateway + 6 timers                         │  + MastraStorageExporter

Model Routing: @cabinet/gateway                             │  Mastra Agent.model
               (AISDKAdapter + 8 providers + budget)         │  (单字符串, 无 fallback)
```

---

## 一、Agent 层

### 1.1 生产请求路径

```
POST /api/secretary/chat
  │
  ▼
Hono router → rateLimiter → authMiddleware → secretaryRouter
  │
  ▼
chat/index.ts handler
  │
  ├─ getOrCreateAgent(sessionId, projectId, captainId, model)
  │
  │   ├─ [SDK v7] createSecretaryAgent(toolDeps)
  │   │     → ToolLoopAgent { model: deepseek-chat, tools: 75+, stopWhen: 50 }
  │   │
  │   ├─ [Legacy] AgentLoop(safetyChecker, checkpoints, memory, rules, tools)
  │   │     → 内部委托 SdkAgentLoopAdapter → ToolLoopAgent
  │   │
  │   └─ [Orchestrator] new SecretaryAgent(agentLoop, intentParser, ...)
  │        返回 { agent, agentLoop, sdkAgent }
  │
  └─ 路由分支:
      ├─ 直接 secretary: sdkAgent.generate() 优先, agentLoop.run() 回退
      ├─ specialist: dispatch → getAgentLoopForRole() → SdkAgentLoopAdapter
      └─ pipeline/parallel: AgentDispatcher
```

### 1.2 包装层级

| 路径                 | 层数 | 调用链                                                                                      |
| -------------------- | ---- | ------------------------------------------------------------------------------------------- |
| 直接 SDK（主要路径） | 2    | SecretaryAgent → ToolLoopAgent → LLM                                                        |
| AgentLoop 回退       | 4    | SecretaryAgent → AgentLoop → SdkAgentLoopAdapter → ToolLoopAgent → LLM                      |
| Specialist 分发      | 5    | SecretaryAgent → dispatch → getAgentLoopForRole → SdkAgentLoopAdapter → ToolLoopAgent → LLM |
| Dispatcher 编排      | 4    | AgentDispatcher → AgentLoop → SdkAgentLoopAdapter → ToolLoopAgent → LLM                     |

### 1.3 冗余发现

| 组件                                   | 状态         | 说明                                      |
| -------------------------------------- | ------------ | ----------------------------------------- |
| `AgentLoop` (agent-loop.ts)            | **结构冗余** | 230 行空壳，100% 委托 SdkAgentLoopAdapter |
| `SdkAgentLoopAdapter` (sdk-adapter.ts) | **核心抽象** | 真正的工作层，所有路径最终都经过它        |
| `createCuratorAgent()`                 | **死代码**   | 导出但零生产引用                          |
| Mastra `secretaryAgent`                | **休眠**     | 定义在 mastra/agents/，零调用             |
| Mastra `curatorAgent`                  | **休眠**     | 定义在 mastra/agents/，零调用             |
| `ctx.mastra`                           | **休眠**     | build-context.ts 设值，无路由读取         |

---

## 二、工具层

### 2.1 工具系统分布

| 系统                      | 文件                                       | 工具数     | 状态         |
| ------------------------- | ------------------------------------------ | ---------- | ------------ |
| `createCabinetTools()`    | packages/agent/src/tools/ (27 文件)        | 75+        | **生产使用** |
| `createSdkTools()` (主)   | packages/agent/src/tools-wrapper.ts        | 75+ (包装) | **生产使用** |
| `createSdkTools()` (重复) | packages/agent/src/runner/tools.ts         | 75+ (包装) | **死代码**   |
| Mastra `createTool()`     | apps/server/src/mastra/tools/filesystem.ts | 3          | **休眠**     |

### 2.2 工具分类清单

| 类别            | 工具名称                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision        | query_decisions, get_decision, get_decision_audit, create_decision, approve_decision, reject_decision                                                                            |
| Event           | get_recent_events, publish_notification                                                                                                                                          |
| Memory          | remember, recall, search_memory, list_memories, write_memory, update_memory, delete_memory                                                                                       |
| Project         | get_project_context, add_milestone, update_project_summary, get_captain_preferences, set_captain_preferences, set_project_context, create_project, list_projects                 |
| Workflow        | list_workflows, get_workflow, create_workflow, update_workflow, run_workflow, delete_workflow, get_workflow_run, list_workflow_runs                                              |
| Employee        | create_employee                                                                                                                                                                  |
| Agent Mgmt      | list_agents, register_agent, update_agent, delete_agent, invoke_agent                                                                                                            |
| Status          | get_status, get_dashboard_stats, get_memory_stats                                                                                                                                |
| Task            | delegate_task, get_task_status, list_active_tasks                                                                                                                                |
| File            | read_file, write_file, edit_file, apply_patch, move_file, copy_file, make_directory, file_info, list_directory, glob, grep, recent_files, watch_file, index_project, delete_file |
| Web             | web_fetch, http_request, fetch_github_repo, fetch_webpage_clean                                                                                                                  |
| Shell           | execute_command                                                                                                                                                                  |
| Scheduler       | schedule_task, list_scheduled_tasks, cancel_scheduled_task                                                                                                                       |
| Knowledge       | index_document, search_documents, clear_index                                                                                                                                    |
| Evaluation      | evaluate                                                                                                                                                                         |
| LSP             | workspace_symbol, go_to_definition, find_references, diagnostics                                                                                                                 |
| SystemKnowledge | query_system_knowledge, get_system_knowledge                                                                                                                                     |
| Document        | read_pdf, read_docx, read_xlsx, read_pptx                                                                                                                                        |
| Archive         | read_zip, extract_zip                                                                                                                                                            |
| Browser         | browser_navigate, browser_click, browser_type, browser_read, browser_screenshot, browser_evaluate                                                                                |
| Communication   | fetch_rss, send_email                                                                                                                                                            |
| System OS       | read_clipboard, write_clipboard, send_notification, start_process, kill_process, show_open_dialog                                                                                |
| Review          | present_for_review                                                                                                                                                               |
| Skills (动态)   | use_skill, update_skill, use_skill\_\_{name}                                                                                                                                     |
| MCP (动态)      | mcp\_\_{name}                                                                                                                                                                    |

### 2.3 冗余发现

| #   | 冗余                             | 位置                                                                                |
| --- | -------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | `createSdkTools` 两份实现        | tools-wrapper.ts vs runner/tools.ts                                                 |
| 2   | `buildToolDependencies` 两份实现 | secretary/tool-deps/builder.ts (16 子模块) vs workflows/tool-deps.ts (348 行独立)   |
| 3   | Mastra 工具无安全检查            | filesystem.ts 的 readFile/writeFile/execCommand 无 resolveSafePath/command blocking |
| 4   | `get_project_context` 重复注册   | project-tools.ts 行 11 和行 135                                                     |

---

## 三、工作流层

### 3.1 引擎分布

| 引擎                               | 位置                              | 状态             |
| ---------------------------------- | --------------------------------- | ---------------- |
| `@cabinet/workflow` WorkflowEngine | packages/workflow/src/            | **全部生产流量** |
| DAG 遍历 + NodeExecutor            | 17 种节点类型                     | **全部生产流量** |
| Mastra `processFilesWorkflow`      | apps/server/src/mastra/workflows/ | **死代码**       |
| `subagent-orchestrator.ts`         | packages/agent/src/               | **死代码**       |

### 3.2 生产请求入口

| 请求                           | 引擎                                |
| ------------------------------ | ----------------------------------- |
| POST /api/factory/:id/run      | WorkflowEngine.startRun()           |
| Secretary 工具调用 runWorkflow | WorkflowEngine.startRun()           |
| 定时任务执行                   | WorkflowEngine.startRun()           |
| 审批轮询恢复                   | WorkflowEngine.continueRun()        |
| 前端 DAG Editor                | 输出 JSON → 直接送入 WorkflowEngine |

---

## 四、记忆层

### 4.1 双系统对比

| 维度     | Cabinet 自定义                  | Mastra Memory             |
| -------- | ------------------------------- | ------------------------- |
| 状态     | **生产活跃**                    | **休眠**                  |
| 短期记忆 | STM (Map+SQLite, LRU+TTL)       | lastMessages: 20          |
| 写入过滤 | WriteGate (5-tier regex, 8语言) | 内置 Observational Memory |
| 压缩管线 | CascadeBuffer → seal → LTM      | Observer + Reflector 自动 |
| 长期检索 | HNSW + RRF 混合搜索             | Semantic Recall           |
| 实体记忆 | EntityMemory (偏好/配置)        | Working Memory            |
| 项目记忆 | ProjectMemory (目标/里程碑)     | 无等价物                  |
| 知识图谱 | KnowledgeGraph + 矛盾检测       | 无等价物                  |
| 遗忘曲线 | MemoryDecayService              | 无等价物                  |
| 统一 API | MemoryFacade                    | Memory API                |

### 4.2 管线对比

```
Cabinet 管线:
  STM → WriteGate.evaluate()
         ├── working/register → LTM.store() (直接)
         ├── daily → CascadeBuffer → seal → LTM.store() (压缩)
         └── noise → 丢弃

Mastra 管线:
  Messages → Observer (background LLM)
           → Observations log
           → Reflector (condense when >40K tokens)
           → Reflections
```

### 4.3 两个 Curator

- **Cabinet Curator**: SdkAgentLoopAdapter in curator-loop.ts — 真正在后台做 consolidation/briefs/pattern extraction
- **Mastra Curator**: mastra/agents/curator.ts — 指令写了 "Store meaningful information" 但从未执行

---

## 五、可观测/事件层

### 5.1 组件状态

| 组件                                     | 文件                                  | 状态                             |
| ---------------------------------------- | ------------------------------------- | -------------------------------- |
| EventBus + SqliteEventStore              | packages/events/                      | **30+ 引用，进程通信骨干**       |
| AgentEventBus                            | packages/events/                      | **WebSocket 广播**               |
| ObservabilityCollector                   | packages/harness/observability.ts     | **3 条 API 路由 + 定时持久化**   |
| SubconsciousLoop                         | packages/harness/subconscious-loop.ts | **curator 子系统活跃**           |
| BrowserPool                              | packages/harness/browser-pool.ts      | **capabilities/browser.ts 使用** |
| ProgressTracker                          | packages/harness/progress-tracker.ts  | **routes/progress.ts 使用**      |
| Evaluator                                | packages/harness/evaluator.ts         | **死代码** — 无生产引用          |
| TeachBack                                | packages/harness/teach-back.ts        | **死代码** — 无生产引用          |
| HarnessEscalation                        | packages/harness/escalation.ts        | **死代码** — 无生产引用          |
| AISDKAdapter + CostTracker + BudgetGuard | packages/gateway/                     | **42+ 引用，唯一 LLM 基础设施**  |
| initTelemetry                            | packages/agent/src/telemetry.ts       | **死代码** — 从未调用            |
| Mastra Observability                     | apps/server/src/mastra/index.ts       | **休眠** — ctx.mastra 从未读取   |

### 5.2 6 个活跃定时器

| 定时器                   | 间隔   | 功能                                    |
| ------------------------ | ------ | --------------------------------------- |
| observabilityTimer       | 30 min | 持久化 ObservabilityCollector 到 SQLite |
| budgetCheckTimer         | 1 hr   | BudgetGuard 检查 + BudgetAlert 广播     |
| sessionCleanupTimer      | 6 hr   | 过期 session 清理                       |
| browserPoolCleanupTimer  | 10 min | 回收空闲 Playwright 会话                |
| externalAgentDetectTimer | 60 sec | 检测外部 agent 可用性                   |
| memoryMaintenanceTimer   | 1 hr   | 记忆衰减周期 + 每周索引重建             |

---

## 六、依赖关系总图

```
apps/server/
  ├── src/context/build-context.ts    ← 唯一引用 mastra 的地方
  ├── src/routes/secretary/          ← 使用 @cabinet/agent + @cabinet/secretary + @cabinet/gateway
  ├── src/routes/workflows/          ← 使用 @cabinet/workflow
  ├── src/context/memory.ts          ← 使用 @cabinet/memory
  ├── src/context/knowledge.ts       ← 使用 @cabinet/harness (SubconsciousLoop)
  ├── src/context/timers.ts          ← 使用 @cabinet/harness (ObservabilityCollector)
  └── src/routes/harness.ts          ← 使用 @cabinet/harness (ObservabilityCollector)

packages/agent/                       ← 30+ 消费者，包含 SDK v7 ToolLoopAgent + AgentLoop + SdkAgentLoopAdapter
packages/secretary/                   ← SecretaryAgent 编排器 + IntentParser 路由
packages/workflow/                    ← 自定义 DAG 工作流引擎
packages/memory/                      ← 5 级记忆管线 (STM/LTM/KG/Decay/Facade)
packages/events/                      ← EventBus 进程通信
packages/harness/                     ← 可观测收集器 + 潜意识循环 + 浏览器池
packages/gateway/                     ← 8 provider LLM 网关 + 成本追踪 + 预算守卫
packages/decision/                    ← L0-L3 分层决策
packages/storage/                     ← SQLite 持久化
packages/types/                       ← 共享类型定义
```

---

## 七、死代码清单

| #   | 文件                                            | 原因                                     |
| --- | ----------------------------------------------- | ---------------------------------------- |
| 1   | mastra/agents/secretary.ts                      | Mastra Agent 实例，零调用                |
| 2   | mastra/agents/curator.ts                        | Mastra Agent 实例，零调用                |
| 3   | mastra/workflows/process-files.ts               | Mastra 工作流，零触发                    |
| 4   | mastra/tools/filesystem.ts                      | 3 个 Mastra 工具，挂载到无人调用的 Agent |
| 5   | mastra/index.ts (Observability 配置)            | MastraStorageExporter 数据从未读取       |
| 6   | packages/agent/src/agents.ts:createCuratorAgent | 导出但零生产引用                         |
| 7   | packages/agent/src/runner/tools.ts              | 重复的 createSdkTools，无人用            |
| 8   | packages/agent/src/subagent-orchestrator.ts     | 导出但零引用                             |
| 9   | packages/agent/src/telemetry.ts                 | initTelemetry 从未调用                   |
| 10  | packages/harness/src/evaluator.ts               | 无生产引用                               |
| 11  | packages/harness/src/teach-back.ts              | 无生产引用                               |
| 12  | packages/harness/src/escalation.ts              | 无生产引用                               |
| 13  | packages/secretary/src/intent-constants.ts      | 已删除 (P7 cleanup)                      |

---

## 八、结构冗余清单

| #   | 冗余                       | 详情                                                        |
| --- | -------------------------- | ----------------------------------------------------------- |
| 1   | AgentLoop 空壳包装         | 230 行类仅委托 SdkAgentLoopAdapter                          |
| 2   | createSdkTools 重复        | tools-wrapper.ts 和 runner/tools.ts 两份                    |
| 3   | buildToolDependencies 重复 | builder.ts (16 子模块) 和 workflows/tool-deps.ts (348 行)   |
| 4   | get_project_context 重复   | project-tools.ts 中注册两次                                 |
| 5   | 双 Curator                 | Mastra curator 与 Cabinet curator 并存                      |
| 6   | 双记忆系统                 | Mastra Memory 与 Cabinet Memory 并存                        |
| 7   | 双可观测系统               | Mastra Observability 与 Cabinet ObservabilityCollector 并存 |
