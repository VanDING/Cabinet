# Cabinet → Mastra 全量迁移计划 v7

> **原则：不保留旧代码。Mastra 有等价物的全删，Mastra 无等价物的保留。一次性系统切换。**
>
> 生成时间：2026-06-23
> 前置状态：Mastra 已安装但完全休眠（零生产调用），V6 方案未执行
> 审计参考：docs/system-audit-2026-06-23.md（三层混合架构 + 13 项死代码 + 7 项结构冗余）

---

## 一、核心判断矩阵

每行 = 一个能力域。Mastra 能覆盖的 → 删除并替换。Mastra 不能覆盖的 → 保留。

| #   | 能力域             | 当前实现                                                 | Mastra 等价物                                                                 | 决策               | 原因                                                                |
| --- | ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------- |
| 1   | **Agent 循环**     | `ToolLoopAgent` + `AgentLoop` + `SdkAgentLoopAdapter`    | `Agent({ instructions, model, tools, memory })` + `.generate()` / `.stream()` | **删 → 替代**      | Mastra Agent 内置完整循环、工具调用、多步推理                       |
| 2   | **多 Agent 编排**  | `AgentDispatcher` + 手动 subagent                        | `Agent({ agents: { sub1, sub2 } })` supervisor 模式                           | **删 → 替代**      | Mastra 原生 supervisor + 自动 tool 包装 + delegation hooks          |
| 3   | **工具系统**       | `tool()` + `toolsContext` + `createSdkTools` (两份)      | `createTool({ id, inputSchema, outputSchema, execute })`                      | **删 → 替代**      | 75+ 工具逐批迁移至 Mastra createTool，tool hooks 替代安全检查       |
| 4   | **工作流引擎**     | `@cabinet/workflow` DAG + 17 节点类型                    | `createWorkflow().then().branch().parallel().foreach().commit()`              | **删 → 替代**      | Mastra Workflow 覆盖 DAG、条件分支、并行、循环、挂起/恢复、人机协同 |
| 5   | **短期记忆**       | STM (Map+SQLite, LRU+TTL)                                | `lastMessages: 20`                                                            | **删 → 替代**      | Mastra 内置消息历史                                                 |
| 6   | **写入过滤**       | WriteGate (5-tier regex, 8 语言)                         | Mastra 内置 Observational Memory                                              | **删 → 替代**      | Observer 自动压缩替代手动过滤                                       |
| 7   | **记忆压缩**       | CascadeBuffer → seal → LTM                               | Observer → Observations → Reflector → Reflections                             | **删 → 替代**      | Mastra OM 三阶记忆（消息→观察→反思）更先进                          |
| 8   | **长期检索**       | HNSW + RRF 混合搜索                                      | Semantic Recall (`semanticRecall: true`)                                      | **删 → 替代**      | Mastra 内置 RAG 向量检索 + metadata filter                          |
| 9   | **实体/偏好记忆**  | EntityMemory (偏好/配置)                                 | Working Memory (`workingMemory: { enabled: true }`)                           | **删 → 替代**      | Mastra 内置结构化/模板化持久状态                                    |
| 10  | **记忆统一 API**   | MemoryFacade                                             | `memory.recall()` / `memory.listMessages()`                                   | **删 → 替代**      | Mastra Memory 统一 API                                              |
| 11  | **事件总线**       | EventBus + SqliteEventStore + AgentEventBus              | Mastra Observability Tracing + Logging                                        | **删 → 替代**      | Mastra 内置 OpenTelemetry 兼容 tracing + 自动日志关联               |
| 12  | **可观测收集**     | ObservabilityCollector + 6 定时器                        | `new Observability({ exporters: [MastraStorageExporter] })`                   | **删 → 替代**      | Mastra 自动 metric 提取 + Studio 可视化                             |
| 13  | **模型路由**       | `@cabinet/gateway` (AISDKAdapter + 8 providers + budget) | Mastra Model Router (40+ providers, `provider/model` 字符串)                  | **删 → 替代**      | Mastra 内置 40+ provider 路由                                       |
| 14  | **成本控制**       | CostTracker + BudgetGuard                                | `CostGuardProcessor({ maxCost, scope, window })`                              | **删 → 替代**      | Mastra 内置 cost guard processor                                    |
| 15  | **评估系统**       | Evaluator (死代码)                                       | `@mastra/evals` prebuilt scorers (answerRelevancy, toxicity, rubric)          | **删 → 替代**      | Mastra 内置 live + trace evaluation                                 |
| 16  | **安全检测**       | safety.ts (4 层检查)                                     | `PromptInjectionDetector` + `ModerationProcessor` + `PIIDetector`             | **保留 safety.ts** | Cabinet 4 层检查比 Mastra guardrails 更深                           |
| 17  | **决策 L0-L3**     | `@cabinet/decision` (状态机 + 审计)                      | 无等价物                                                                      | **保留**           | Captain 范式核心，Mastra 无此概念                                   |
| 18  | **Human Node**     | `@cabinet/workflow` HumanNode                            | Mastra Workflow `suspend/resume`                                              | **部分保留**       | Mastra 有人机协同但 Cabinet Human Node 更结构化                     |
| 19  | **知识图谱**       | KnowledgeGraph + 矛盾检测                                | 无等价物                                                                      | **保留**           | Cabinet 独创                                                        |
| 20  | **DAG Editor UI**  | `@xyflow/react` 视觉编辑器                               | Mastra Studio Graph View                                                      | **保留**           | 独家视觉编辑器，适配输出 Mastra Workflow                            |
| 21  | **Tauri Desktop**  | React 19 + Tauri 2.0                                     | 无等价物                                                                      | **保留**           | 桌面应用                                                            |
| 22  | **Skills 系统**    | Skills 即 Markdown + 动态加载                            | Mastra workspace skills (粒度不同)                                            | **保留**           | Cabinet skills 粒度更细                                             |
| 23  | **SQLite 持久化**  | `@cabinet/storage` (better-sqlite3)                      | LibSQLStore, PgStore 等                                                       | **保留**           | Cabinet 自定义存储引擎                                              |
| 24  | **External Agent** | Projector + agent-sdk                                    | 无等价物                                                                      | **保留**           | 外部 agent 投影协议                                                 |
| 25  | **CLI**            | `@cabinet/cli`                                           | 无等价物                                                                      | **保留**           | 自定义 CLI 入口                                                     |
| 26  | **UI 组件库**      | `@cabinet/ui` (DecisionCard 等)                          | 无等价物                                                                      | **保留**           | 共享 React 组件                                                     |
| 27  | **Shared Types**   | `@cabinet/types`                                         | 部分 Mastra 类型可替代                                                        | **精简**           | 保留 Cabinet 独有类型                                               |

---

## 二、分模块执行计划（按工程顺序）

### Phase A: Mastra 底座搭建

**状态：Mastra 已安装但配置不全，需要重新配置**

#### A1: 依赖确认与补充

```
已安装:
  @mastra/core: ^1.45.0
  @mastra/memory: ^1.21.0
  @mastra/evals: ^1.4.0
  @mastra/libsql: ^1.14.0
  @mastra/observability: ^1.15.0

需补充:
  pnpm add @mastra/hono@latest    # Hono 集成适配器（替换自建路由）
```

#### A2: 重写 Mastra 实例

**位置：** `apps/server/src/mastra/index.ts`

```typescript
import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, MastraStorageExporter } from '@mastra/observability';
import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/prebuilt';

// agents — Phase B 注册
import { secretaryAgent } from './agents/secretary';
import { curatorAgent } from './agents/curator';

// workflows — Phase D 注册
import { fileProcessWorkflow } from './workflows/file-process';
// ... 其余 workflow

export const mastra = new Mastra({
  // 存储
  storage: new LibSQLStore({
    id: 'cabinet-storage',
    url: 'file:./data/cabinet.db',
  }),

  // Agent 注册
  agents: {
    secretary: secretaryAgent,
    curator: curatorAgent,
    // ... 其余 agent
  },

  // Workflow 注册
  workflows: {
    fileProcess: fileProcessWorkflow,
    // ... 其余 workflow
  },

  // 可观测性
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'cabinet',
        sampling: { type: 'ratio', probability: 0.1 },
        exporters: [new MastraStorageExporter()],
      },
    },
  }),

  // 评估
  scorers: {
    answerRelevancy: createAnswerRelevancyScorer({
      model: 'deepseek/deepseek-chat',
    }),
  },
});
```

#### A3: 用 Mastra Hono Adapter 替换自建路由

**文件：** `apps/server/src/main.ts`

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { HonoBindings, HonoVariables, MastraServer } from '@mastra/hono';
import { mastra } from './mastra';

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();

// Cabinet 独有中间件（在 Mastra 之前）
// auth, CORS, rate-limit 等

const server = new MastraServer({
  app,
  mastra,
  prefix: '/api',
  openapiPath: '/openapi.json',
});

// 手动初始化以控制顺序
server.registerContextMiddleware();

// Cabinet 独有路由（在 Mastra context 之后）
// /api/decisions, /api/knowledge-graph, etc.
const decisionsApp = new Hono();
// ... Cabinet 独有路由

app.route('/api', decisionsApp);

await server.registerRoutes();

serve({ fetch: app.fetch, port: 4111 }, () => {
  console.log('Cabinet server running on port 4111');
});
```

---

### Phase B: Agent 层全面替换

**删除：** `packages/agent/src/agents.ts`, `agent-loop.ts`, `sdk-adapter.ts`, `context.ts`, `telemetry.ts`, `subagent-orchestrator.ts`, `observers/*`, `runner/*`, `discovery/*`, `daemon/*`, `interactive/*`

**新建 / 迁移：** `apps/server/src/mastra/agents/`

#### B1: Secretary Agent（主 Agent）

```typescript
// apps/server/src/mastra/agents/secretary.ts
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { SHARED_PROMPT } from '../prompts/shared';

export const secretaryAgent = new Agent({
  id: 'secretary',
  name: 'Secretary',
  description: '首席助理 agent，处理用户请求、协调 specialist、调用工具执行任务',
  instructions:
    SHARED_PROMPT +
    `
你是 Cabinet 的 Secretary（秘书），你是用户的首席助理和总调度。

职责：
1. 接收并理解用户意图
2. 编排工具和 sub-agent 完成任务
3. 管理项目上下文和会话
4. 遵循决策层级（L0-L3）

工具使用准则：
- 涉及文件：使用文件系统工具
- 涉及记忆：使用 recall/remember 工具
- 需要深度分析：委托给分析类 sub-agent
- 需要执行命令：先通过安全检查再执行
`,
  model: 'deepseek/deepseek-chat',
  memory: new Memory({
    options: {
      lastMessages: 20,
      observationalMemory: true,
      workingMemory: {
        enabled: true,
        template: `# 项目上下文
- 当前项目：
- 用户目标：
- 最近任务：
`,
      },
    },
  }),
  // 工具在 Phase C 注册
  // 子 agent 在 Phase B3 注册
});
```

#### B2: Curator Agent（后台记忆维护）

```typescript
// apps/server/src/mastra/agents/curator.ts
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

export const curatorAgent = new Agent({
  id: 'curator',
  name: 'Curator',
  description: '后台记忆维护 agent，负责压缩、整理、提取模式',
  instructions: `
你是 Cabinet 的 Curator（馆长）。

职责：
1. 观察对话历史，提取关键信息
2. 整理和压缩长期记忆
3. 发现行为模式和用户偏好
4. 生成对话摘要和简报

你静默运行在后台，不对用户直接回复。
`,
  model: 'deepseek/deepseek-chat',
  memory: new Memory({
    options: {
      observationalMemory: true,
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template: `# 用户画像
- 工作风格：
- 常见任务：
- 偏好工具：
`,
      },
    },
  }),
});
```

#### B3: 多 Agent 体系（Supervisor 模式）

根据系统审计，当前有 specialist 分发路径（5 层调用链）。Mastra supervisor 模式将其简化为 2 层。

```typescript
// apps/server/src/mastra/agents/specialist-writer.ts
export const writerAgent = new Agent({
  id: 'writer',
  name: 'Writer',
  description: '撰写和编辑文本文档、代码注释、报告',
  instructions: '你是专业的写作者。产出清晰、准确、符合上下文的文本。',
  model: 'deepseek/deepseek-chat',
});

// apps/server/src/mastra/agents/specialist-analyst.ts
export const analystAgent = new Agent({
  id: 'analyst',
  name: 'Analyst',
  description: '分析数据、代码结构、项目架构',
  instructions: '你是专业的分析师。深入检查数据或代码，输出结构化分析结果。',
  model: 'deepseek/deepseek-chat',
});

// apps/server/src/mastra/agents/specialist-researcher.ts
export const researcherAgent = new Agent({
  id: 'researcher',
  name: 'Researcher',
  description: '搜索网络、文档、知识库获取信息',
  instructions: '你是专业的研究员。广泛搜索并提取关键信息。',
  model: 'deepseek/deepseek-chat',
  tools: {
    webFetch: webFetchTool, // Phase C 迁移
    searchDocs: searchDocsTool, // Phase C 迁移
  },
});
```

然后在 secretary 中注册为 sub-agent：

```typescript
// secretary.ts 补充
export const secretaryAgent = new Agent({
  // ... 基础配置
  agents: {
    writer: writerAgent,
    analyst: analystAgent,
    researcher: researcherAgent,
  },
  // 委托配置
  delegation: {
    onDelegationStart: async (ctx) => {
      // 安全检查：某些 agent 不允许执行危险操作
      return { proceed: true };
    },
  },
});
```

**效果：** Secretary 是 supervisor，当用户说"帮我分析这个代码库"，Secretary 自动委托给 analyst；"帮我写文档"自动委托给 writer。不再需要 AgentDispatcher + 5 层调用链。

#### B4: 删除清单 (packages/agent)

```
packages/agent/src/agents.ts              ✗ 删除 (replaced by mastra/agents/)
packages/agent/src/agent-loop.ts          ✗ 删除 (Mastra Agent 内置循环)
packages/agent/src/sdk-adapter.ts         ✗ 删除 (不再需要适配层)
packages/agent/src/context.ts             ✗ 删除 (Mastra instructions 替代)
packages/agent/src/context-builder.ts     ✗ 删除
packages/agent/src/telemetry.ts           ✗ 删除 (Mastra Observability)
packages/agent/src/subagent-orchestrator.ts ✗ 删除 (Mastra supervisor)
packages/agent/src/observers/*            ✗ 删除 (Mastra hooks + processors)
packages/agent/src/runner/*               ✗ 删除
packages/agent/src/discovery/*            ✗ 删除
packages/agent/src/daemon/*               ✗ 删除 (Mastra background tasks)
packages/agent/src/interactive/*          ✗ 删除
packages/agent/src/prompt-assembler.ts    ✗ 删除
packages/agent/src/skill-loader.ts        ✗ 保留 → 移到 server/mastra/skills/
packages/agent/src/safety.ts              ✓ 保留 (再包装为 Mastra hook)
packages/agent/src/projector/*            ✓ 保留 (外部 agent 投影)
packages/agent/src/checkpoint-manager.ts  ✗ 删除 (Mastra suspend/resume)
packages/agent/src/retry.ts               ✗ 删除 (Mastra 内置)
packages/agent/src/tool-executor.ts       ✗ 删除 (Mastra 内置)
packages/agent/src/process-identity.ts    ✓ 保留 → 移到 server/mastra/
packages/agent/src/project-snapshot.ts    ✓ 移入 storage/
```

---

### Phase C: 工具层全面替换

**删除：** `packages/agent/src/tools-wrapper.ts`, `packages/agent/src/tools/*`, `packages/agent/src/runner/tools.ts`

**新建：** `apps/server/src/mastra/tools/` (按类别分文件)

#### C1: 工具分类迁移清单

| 类别             | 原工具数 | Mastra 文件           | 说明                                                                          |
| ---------------- | -------- | --------------------- | ----------------------------------------------------------------------------- |
| File Ops         | 15       | `tools/file.ts`       | read/write/edit/move/copy/delete/list/glob/grep/info/recent/watch/mkdir/index |
| Shell            | 1        | `tools/shell.ts`      | execute_command + 安全包装                                                    |
| Web              | 3        | `tools/web.ts`        | web_fetch, http_request, fetch_github_repo                                    |
| Memory           | 7        | `tools/memory.ts`     | Mastra 内置替代 5 个，保留 2 个                                               |
| Project          | 8        | `tools/project.ts`    | 项目上下文管理                                                                |
| Workflow         | 8        | `tools/workflow.ts`   | Mastra workflow API 替代                                                      |
| Decision         | 6        | `tools/decision.ts`   | 决策系统工具（保留）                                                          |
| Document         | 4        | `tools/document.ts`   | PDF/DOCX/XLSX/PPTX 解析                                                       |
| Browser          | 6        | `tools/browser.ts`    | Playwright 浏览器操作                                                         |
| Knowledge        | 3        | `tools/knowledge.ts`  | 文档索引搜索                                                                  |
| LSP              | 4        | `tools/lsp.ts`        | 语言服务协议                                                                  |
| Skills           | 3        | `tools/skills.ts`     | 技能系统                                                                      |
| MCP              | 动态     | ➜ Mastra MCP 内置     | 不需要自定义工具                                                              |
| Communication    | 2        | `tools/comm.ts`       | RSS fetch, email send                                                         |
| System OS        | 7        | `tools/system.ts`     | 剪贴板、通知、进程                                                            |
| Review           | 1        | `tools/review.ts`     | 人工审核                                                                      |
| Scheduler        | 3        | `tools/scheduler.ts`  | 定时任务                                                                      |
| Employee         | 1        | `tools/employee.ts`   | 人员管理                                                                      |
| Evaluation       | 1        | ➜ `@mastra/evals`     | 不需要自定义工具                                                              |
| Agent Mgmt       | 5        | `tools/agent-mgmt.ts` | 外部 agent 管理                                                               |
| Status/Dashboard | 3        | `tools/status.ts`     | 系统状态                                                                      |

#### C2: 工具示例（file 工具集）

```typescript
// apps/server/src/mastra/tools/file.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolveSafePath, readFileContent } from '../../services/file-service';
import { securityCheck } from '../../security';

export const readFileTool = createTool({
  id: 'readFile',
  description: '读取指定路径的文件内容。支持文本文件和图片。',
  inputSchema: z.object({
    path: z.string().describe('文件路径（相对于工作区根目录）'),
    encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8'),
  }),
  outputSchema: z.object({
    content: z.string(),
    language: z.string().optional(),
  }),
  execute: async ({ context, inputData }) => {
    const safePath = resolveSafePath(context.workspacePath, inputData.path);
    const content = await readFileContent(safePath, inputData.encoding);
    return { content, language: detectLanguage(inputData.path) };
  },
});

export const writeFileTool = createTool({
  id: 'writeFile',
  description: '写入内容到指定文件。如果文件不存在则创建，存在则覆盖。',
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    bytesWritten: z.number(),
  }),
  execute: async ({ context, inputData }) => {
    const safePath = resolveSafePath(context.workspacePath, inputData.path);
    await securityCheck('write', safePath);
    // ... write logic
    return { success: true, bytesWritten: Buffer.byteLength(inputData.content) };
  },
});

// ... editFileTool, moveFileTool, copyFileTool, makeDirectoryTool,
//     fileInfoTool, listDirectoryTool, globTool, grepTool, deleteFileTool,
//     recentFilesTool, watchFileTool, indexProjectTool, applyPatchTool
```

#### C3: 工具安全 hook（替代 tool-executor.ts）

```typescript
// apps/server/src/mastra/agents/secretary.ts 补充
import { securityCheck } from '../../security';

export const secretaryAgent = new Agent({
  // ...
  hooks: {
    beforeToolCall: ({ toolName, input }) => {
      // 危险命令拦截
      if (toolName === 'executeCommand') {
        const command = (input as { command?: string }).command ?? '';
        if (command.includes('rm -rf /') || command.includes('format')) {
          return {
            proceed: false,
            output: '命令被安全策略阻止。',
          };
        }
      }
      // 敏感文件保护
      if (toolName === 'writeFile' || toolName === 'deleteFile') {
        const path = (input as { path?: string }).path ?? '';
        if (path.includes('.env') || path.includes('.secret')) {
          return {
            proceed: false,
            output: '操作受保护的敏感文件被拒绝。',
          };
        }
      }
    },
  },
});
```

#### C4: 工具删除清单

```
packages/agent/src/tools-wrapper.ts        ✗ 删除
packages/agent/src/runner/tools.ts         ✗ 删除 (重复定义)
packages/agent/src/tools/*.ts              ✗ 全部删除 (27 文件)
apps/server/src/mastra/tools/filesystem.ts ✗ 删除 (重构)
```

**保留但重构：**

```
packages/agent/src/skill-loader.ts → apps/server/src/mastra/skills/loader.ts
packages/agent/src/projector/     → apps/server/src/mastra/projector/
```

---

### Phase D: 工作流层全面替换

**删除：** `packages/workflow/` 全部（~3000 行）

**新建：** `apps/server/src/mastra/workflows/`

#### D1: 节点类型映射

| Cabinet 节点      | Mastra 等价实现                                                |
| ----------------- | -------------------------------------------------------------- |
| Agent Node        | `.then(createStep({ execute: async () => agent.generate() }))` |
| LLM Node          | `.then(createStep({ execute: async () => generateText() }))`   |
| Skill Node        | `.then(skillStep)`                                             |
| Human Node        | `createStep({ suspend: true })` (挂起等待人工批准)             |
| External Node     | `.then(externalStep)`                                          |
| Code Node         | `.then(codeSandboxStep)`                                       |
| Decision Node     | `.branch([condition, stepA], [condition, stepB])`              |
| Parallel Fork     | `.parallel([step1, step2, step3])`                             |
| Loop Node         | `.dountil(step, condition)` / `.dowhile(step, condition)`      |
| Foreach Node      | `.foreach(step, { concurrency: N })`                           |
| Condition Node    | `.branch([...])`                                               |
| Timer Node        | step 内 `setTimeout/setInterval`                               |
| Notification Node | step 内调用通知服务                                            |
| Sub-Workflow Node | `.then(childWorkflow)`                                         |
| Template Node     | `.map()` 数据转换                                              |
| Gate Node         | `.branch()` 多条件                                             |

#### D2: 工作流示例

```typescript
// apps/server/src/mastra/workflows/file-process.ts
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { readFileTool, writeFileTool } from '../tools/file';
import { analystAgent } from '../agents/specialist-analyst';

const scanStep = createStep({
  id: 'scan',
  inputSchema: z.object({ dir: z.string() }),
  outputSchema: z.object({ files: z.array(z.object({ path: z.string(), type: z.string() })) }),
  execute: async ({ inputData, tools }) => {
    // 使用文件工具扫描目录
    const files = await tools.readFile({ path: inputData.dir });
    return { files: /* 解析结果 */ [] };
  },
});

const classifyStep = createStep({
  id: 'classify',
  inputSchema: z.object({ files: z.array(z.object({ path: z.string(), type: z.string() })) }),
  outputSchema: z.object({
    sourceFiles: z.array(z.object({ path: z.string() })),
    docFiles: z.array(z.object({ path: z.string() })),
    otherFiles: z.array(z.object({ path: z.string() })),
  }),
  execute: async ({ inputData }) => {
    const sourceFiles = inputData.files.filter((f) => f.type === 'source');
    const docFiles = inputData.files.filter((f) => f.type === 'doc');
    const otherFiles = inputData.files.filter((f) => f.type === 'other');
    return { sourceFiles, docFiles, otherFiles };
  },
});

const analyzeStep = createStep({
  id: 'analyze',
  inputSchema: z.object({ sourceFiles: z.array(z.object({ path: z.string() })) }),
  outputSchema: z.object({ analysis: z.string() }),
  execute: async ({ inputData, context }) => {
    // 委托给 analyst agent
    const agent = context.mastra.getAgentById('analyst');
    const result = await agent.generate(
      `Analyze these source files: ${inputData.sourceFiles.map((f) => f.path).join(', ')}`,
    );
    return { analysis: result.text };
  },
});

const reviewStep = createStep({
  id: 'review',
  inputSchema: z.object({ analysis: z.string() }),
  outputSchema: z.object({ approved: z.boolean(), feedback: z.string().optional() }),
  execute: async ({ inputData, suspend }) => {
    // 挂起等待人工审核
    return suspend({ analysis: inputData.analysis });
  },
  resume: async ({ resumeData }) => {
    return resumeData as { approved: boolean; feedback?: string };
  },
});

export const fileProcessWorkflow = createWorkflow({
  id: 'file-process',
  inputSchema: z.object({ dir: z.string() }),
  outputSchema: z.object({ result: z.string() }),
})
  .then(scanStep)
  .then(classifyStep)
  .branch([
    [async ({ inputData }) => inputData.sourceFiles.length > 0, analyzeStep.then(reviewStep)],
    [
      async () => true,
      createStep({
        id: 'skip',
        inputSchema: z.any(),
        outputSchema: z.object({ message: z.string() }),
        execute: async () => ({ message: 'No source files to analyze' }),
      }),
    ],
  ])
  .commit();
```

#### D3: 删除清单

```
packages/workflow/src/engine.ts           ✗ 删除
packages/workflow/src/engine/*            ✗ 全部删除
packages/workflow/src/node-executor.ts    ✗ 删除
packages/workflow/src/blueprint-io.ts     ✗ 删除 (DAG Editor 直接输出 Mastra workflow)
packages/workflow/src/blueprint-yaml.ts   ✗ 删除
packages/workflow/src/condition-evaluator.ts ✗ 删除
packages/workflow/src/error-recovery.ts   ✗ 删除
packages/workflow/src/code-sandbox.ts     ✗ 保留 → 移到 server/services/
apps/server/src/routes/workflows/*        ✗ 重构 (走 Mastra API)
apps/server/src/mastra/workflows/process-files.ts ✗ 删除 (重构)
```

---

### Phase E: 记忆层全面替换

**删除：** `packages/memory/` 的大部分

**保留：** `knowledge-graph.ts` + `entity.ts` (Mastra 无等价物)

#### E1: 映射表

| Cabinet Memory 组件                 | Mastra 等价物                               | 操作   |
| ----------------------------------- | ------------------------------------------- | ------ |
| STM (short-term.ts)                 | `lastMessages: 20`                          | ✗ 删除 |
| WriteGate (write-gate.ts)           | Observer 自动过滤                           | ✗ 删除 |
| CascadeBuffer (cascade-buffer.ts)   | Observer async buffering                    | ✗ 删除 |
| LTM (long-term.ts)                  | Semantic Recall (`semanticRecall: true`)    | ✗ 删除 |
| Consolidation (consolidation.ts)    | Reflector 自动压缩                          | ✗ 删除 |
| MemoryDecay (memory-decay.ts)       | Temporal gap markers                        | ✗ 删除 |
| MemoryFacade (memory-facade.ts)     | `memory.recall()` / `memory.listMessages()` | ✗ 删除 |
| Factory (factory.ts)                | `new Memory({...})`                         | ✗ 删除 |
| EntityMemory (entity.ts)            | Working Memory (`workingMemory`)            | ✗ 删除 |
| KnowledgeGraph (knowledge-graph.ts) | 无等价物                                    | ✓ 保留 |
| Entity extraction (entity.ts)       | 无等价物 (KG 依赖)                          | ✓ 保留 |
| Hybrid retriever                    | Semantic Recall + metadata filter           | ✗ 删除 |
| Project memory                      | Working Memory template                     | ✗ 删除 |

#### E2: Memory 配置（在 Agent 中）

```typescript
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';

const memory = new Memory({
  storage: new LibSQLStore({
    id: 'cabinet-memory',
    url: 'file:./data/cabinet-memory.db',
  }),
  vector: new LibSQLVector({
    id: 'cabinet-vector',
    url: 'file:./data/cabinet-vector.db',
  }),
  embedder: new ModelRouterEmbeddingModel('openai/text-embedding-3-small'),
  options: {
    lastMessages: 20,
    observationalMemory: {
      model: 'deepseek/deepseek-chat',
      scope: 'thread',
      observation: {
        messageTokens: 30_000,
        bufferTokens: 0.2,
        bufferActivation: 0.8,
      },
      reflection: {
        observationTokens: 40_000,
        bufferActivation: 0.5,
      },
      activateAfterIdle: '1hr', // DeepSeek cache TTL
    },
    workingMemory: {
      enabled: true,
      scope: 'resource',
      template: `# 项目上下文
- 当前项目：
- 用户目标：
- 最近任务：
- 重要决定：
`,
    },
    semanticRecall: {
      topK: 5,
      messageRange: 2,
      scope: 'thread',
    },
  },
});
```

#### E3: 知识图谱集成

Knowledge Graph 保留为独立服务，通过工具暴露给 Mastra Agent：

```typescript
// apps/server/src/mastra/tools/knowledge.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { knowledgeGraph } from '../../services/knowledge-graph';

export const queryKGTool = createTool({
  id: 'queryKnowledgeGraph',
  description: '查询知识图谱，获取实体关系和已有知识',
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number().optional().default(10),
  }),
  outputSchema: z.object({
    entities: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        properties: z.record(z.unknown()),
      }),
    ),
    relations: z.array(
      z.object({
        source: z.string(),
        target: z.string(),
        type: z.string(),
      }),
    ),
  }),
  execute: async ({ inputData }) => {
    const result = await knowledgeGraph.query(inputData.query, inputData.maxResults);
    return result;
  },
});
```

#### E4: 删除清单

```
packages/memory/src/short-term.ts         ✗ 删除
packages/memory/src/long-term.ts          ✗ 删除
packages/memory/src/consolidation.ts      ✗ 删除
packages/memory/src/write-gate.ts         ✗ 删除
packages/memory/src/cascade-buffer.ts     ✗ 删除
packages/memory/src/memory-decay.ts       ✗ 删除
packages/memory/src/memory-facade.ts      ✗ 删除
packages/memory/src/factory.ts            ✗ 删除
packages/memory/src/hybrid-retriever.ts   ✗ 删除
packages/memory/src/entity.ts             ✗ → 精简为知识图谱依赖
packages/memory/src/knowledge-graph.ts    ✓ 保留
packages/memory/src/contradiction.ts      ✓ 保留
```

---

### Phase F: 可观测性 + 评估 + 网关全面替换

**删除：** `packages/events/`, `packages/harness/`, `packages/gateway/`

#### F1: 映射表

| 组件                              | Mastra 等价物                        | 操作          |
| --------------------------------- | ------------------------------------ | ------------- |
| EventBus (packages/events/)       | Mastra Observability Tracing         | ✗ 删除全部    |
| AgentEventBus                     | Mastra Observability traces          | ✗ 删除        |
| ObservabilityCollector (harness/) | MastraStorageExporter                | ✗ 删除        |
| SubconsciousLoop (harness/)       | Curator Agent (Observational Memory) | ✗ 删除        |
| BrowserPool (harness/)            | 保留 → 移到 server/services/         | ✓ 移到 server |
| ProgressTracker (harness/)        | Mastra workflow state                | ✗ 删除        |
| Evaluator (harness/)              | `@mastra/evals` scorers              | ✗ 删除        |
| TeachBack (harness/)              | ✗ 删除（死代码）                     | ✗ 删除        |
| HarnessEscalation                 | ✗ 删除（死代码）                     | ✗ 删除        |
| AISDKAdapter (gateway/)           | Mastra Model Router (40+ providers)  | ✗ 删除        |
| CostTracker                       | CostGuardProcessor                   | ✗ 删除        |
| BudgetGuard                       | CostGuardProcessor                   | ✗ 删除        |
| Fallback (gateway/)               | Mastra model fallback                | ✗ 删除        |
| Model Router (gateway/)           | Mastra `provider/model` strings      | ✗ 删除        |

#### F2: 6 个活跃定时器的迁移

| 定时器                          | 当前实现                               | Mastra 替代                                |
| ------------------------------- | -------------------------------------- | ------------------------------------------ |
| observabilityTimer (30min)      | `setInterval` → ObservabilityCollector | MastraStorageExporter 自动持久化           |
| budgetCheckTimer (1hr)          | `setInterval` → BudgetGuard            | CostGuardProcessor 每次 LLM 调用前自动检查 |
| sessionCleanupTimer (6hr)       | `setInterval` → 手动清理               | 保留在 server/services/ 独立管理           |
| browserPoolCleanupTimer (10min) | `setInterval` → BrowserPool            | 保留在 server/services/ browser-pool.ts    |
| externalAgentDetectTimer (60s)  | `setInterval` → agent 检测             | 保留在 server/services/ agent-detector.ts  |
| memoryMaintenanceTimer (1hr)    | `setInterval` → 记忆衰减               | Observer/Reflector 自动维护                |

#### F3: 可观测性配置

```typescript
// mastra/index.ts 中
import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability'

observability: new Observability({
  configs: {
    default: {
      serviceName: 'cabinet',
      sampling: { type: 'ratio', probability: 0.1 },
      exporters: [new MastraStorageExporter()],
      spanOutputProcessors: [new SensitiveDataFilter()],
    },
  },
}),
```

#### F4: 评估配置

```typescript
// 在 Agent 上直接配置
export const secretaryAgent = new Agent({
  // ...
  scorers: {
    relevancy: {
      scorer: createAnswerRelevancyScorer({ model: 'deepseek/deepseek-chat' }),
      sampling: { type: 'ratio', rate: 0.1 },
    },
  },
});
```

#### F5: 删除清单

```
packages/events/src/bus.ts               ✗ 删除
packages/events/src/causation.ts         ✗ 删除
packages/events/src/memory-bus.ts        ✗ 删除
packages/events/src/agent-event-bus.ts   ✗ 删除
packages/events/src/repositories/*       ✗ 删除
packages/harness/src/observability.ts    ✗ 删除
packages/harness/src/evaluator.ts        ✗ 删除
packages/harness/src/teach-back.ts       ✗ 删除
packages/harness/src/escalation.ts       ✗ 删除
packages/harness/src/progress-tracker.ts ✗ 删除
packages/harness/src/subconscious-loop.ts ✗ 删除
packages/harness/src/browser-pool.ts     ✓ 移到 server/services/
packages/gateway/src/llm-gateway.ts      ✗ 删除
packages/gateway/src/model-router.ts     ✗ 删除
packages/gateway/src/ai-sdk-adapter.ts   ✗ 删除
packages/gateway/src/budget-guard.ts     ✗ 删除
packages/gateway/src/cost-tracker.ts     ✗ 删除
packages/gateway/src/fallback.ts         ✗ 删除
```

---

### Phase G: 秘书层 + 会话管理保留/精简

**保留核心：** 意图解析（IntentParser）和会话管理（SessionManager）

**删除：** 冗余编排逻辑（已由 Mastra Agent/Workflow 替代）

```typescript
// apps/server/src/mastra/services/session-manager.ts
// 精简后的会话管理（不再包含 agent 编排逻辑）
export class SessionManager {
  async getOrCreateSession(userId: string, projectId: string) {
    // 创建/获取 thread + resource pair
    const threadId = `${projectId}-${Date.now()}`;
    return {
      threadId,
      resourceId: userId,
    };
  }
}

// apps/server/src/mastra/services/intent-parser.ts (精简)
export class IntentParser {
  async parse(message: string) {
    // 返回意图分类结果
    // 路由逻辑由 secretary agent 的 instructions + supervisor mode 处理
    return { intent: 'chat', confidence: 0.95 };
  }
}
```

```
packages/secretary/src/secretary-agent.ts  ✗ 删除 (Mastra Agent 替代)
packages/secretary/src/intent-parser.ts    ✓ 保留（精简）
packages/secretary/src/session-manager.ts  ✓ 保留（精简）
packages/secretary/src/intent-llm-router.ts ✗ 删除 (supervisor 替代)
packages/secretary/src/intent-embedding-matcher.ts ✗ 删除
packages/secretary/src/intent-pattern-matcher.ts ✗ 删除
packages/secretary/src/greeting.ts         ✓ 保留
```

---

### Phase H: Server 路由精简

**当前：** 38 个路由模块 + 32 个 context 模块

**目标：** Mastra Hono Adapter 自动注册标准路由 + Cabinet 独有路由

#### Mastra 自动注册的路由（不需要手动实现）

| 路由路径                            | 说明                |
| ----------------------------------- | ------------------- |
| `/api/agents`                       | Agent 列表          |
| `/api/agents/:agentId/chat`         | Agent 对话          |
| `/api/agents/:agentId/stream`       | Agent 流式对话      |
| `/api/workflows`                    | Workflow 列表       |
| `/api/workflows/:workflowId/start`  | 启动 workflow       |
| `/api/workflows/:workflowId/stream` | 流式 workflow       |
| `/api/workflows/:workflowId/runs`   | workflow 运行记录   |
| `/api/workflows/:workflowId/resume` | 恢复挂起的 workflow |
| `/api/memory/threads`               | 记忆线程            |
| `/api/memory/messages`              | 记忆消息            |
| `/api/observability/traces`         | Trace 数据          |
| `/api/evals/scorers`                | 评估结果            |

#### Cabinet 独有路由（需保留）

```
apps/server/src/routes/
  ├── decisions.ts       ✓ 保留 (L0-L3 决策)
  ├── knowledge-graph.ts  ✓ 保留
  ├── skills.ts           ✓ 保留 (Skills as Markdown)
  ├── employees.ts        ✓ 保留
  ├── backup.ts           ✓ 保留
  ├── settings.ts         ✓ 保留
  ├── install.ts          ✓ 保留
  ├── autopilot.ts        ✓ 保留 (cron + webhook)
  ├── workbench.ts        ✓ 保留
  ├── squads.ts           ✓ 保留
  ├── dashboard.ts        ✓ 精简 (数据来源变为 Mastra API)
  ├── health.ts           ✓ 保留
  └── openapi.ts          ✗ 删除 (Mastra 自动生成)
```

**删除：**

```
apps/server/src/routes/secretary/*     ✗ 删除 (Mastra agent chat API 替代)
apps/server/src/routes/workflows/*     ✗ 删除 (Mastra workflow API 替代)
apps/server/src/routes/harness.ts      ✗ 删除
apps/server/src/routes/observability.ts ✗ 删除
apps/server/src/routes/evaluations.ts   ✗ 删除
apps/server/src/routes/insights.ts      ✗ 删除
apps/server/src/routes/progress.ts      ✗ 删除
apps/server/src/routes/memory.ts       ✗ 删除 (Mastra memory API 替代)
apps/server/src/routes/audit.ts        ✓ 保留 (决策审计)
apps/server/src/context/*              ✗ 大部分删除 (Mastra context 替代)
  ├── build-context.ts                 ✗ 删除
  ├── memory.ts                        ✗ 删除
  ├── knowledge.ts                     ✓ 保留
  ├── timers.ts                        ✗ 拆分到 services/
```

---

### Phase I: 类型层精简

**`packages/types/`** 当前包含 Cabinet 特有类型 + 大量可删除 SDK 类型。

```
packages/types/src/primitives.ts       ✓ 保留 (基础类型)
packages/types/src/decisions.ts        ✓ 保留 (决策类型)
packages/types/src/skills.ts           ✓ 保留 (技能类型)
packages/types/src/blackboard.ts       ✗ 删除 (Mastra 无此概念)
packages/types/src/boundaries.ts       ✓ 保留
packages/types/src/agent-output.ts     ✗ 删除 (Mastra 内置)
packages/types/src/pipeline.ts         ✗ 删除 (Mastra workflow 替代)
packages/types/src/events.ts           ✗ 删除 (Mastra observability 替代)
packages/types/src/workbench.ts        ✓ 保留
```

---

### Phase J: Desktop 适配

DAG Editor 不再输出 Cabinet 自定义 workflow JSON，而是输出 Mastra workflow 定义。

```typescript
// apps/desktop/src/components/DAGEditor/export.ts (修改)
export function exportAsMastraWorkflow(nodes: DAGNode[], edges: DAGEdge[]) {
  // 将 DAG 图转换为 Mastra workflow 定义
  // .then() → 串联节点
  // .parallel([a, b]) → 并行的同层节点
  // .branch([[cond, a], [cond, b]]) → 条件分支
  // .foreach(step) → 循环节点
  return generateMastraWorkflowCode(nodes, edges);
}
```

Desktop 其他部分保持不变。

---

## 三、最终包结构

```
packages/
  types/          ← 精简 (~200 行，Cabinet 独有类型)
  storage/        ← 保留 (SQLite 持久化)
  agent-sdk/      ← 保留 (外部 agent 通信协议)
  decision/       ← 保留 (L0-L3 Captain 范式核心)
  cli/            ← 保留
  ui/             ← 保留 (共享 React 组件)
  memory/         ← 仅保留 knowledge-graph + entity + contradiction (~300 行)

  ~agent/         ← 删除 (Mastra Agent 替代)
  ~workflow/      ← 删除 (Mastra Workflow 替代)
  ~harness/       ← 删除 (Mastra Evals + Observability 替代)
  ~events/        ← 删除 (Mastra Observability 替代)
  ~gateway/       ← 删除 (Mastra Model Router 替代)
  ~secretary/     ← 精简为 SessionManager + IntentParser + Greeting (~100 行)

apps/
  server/
    src/
      main.ts                  ← Hono + Mastra Hono Adapter
      mastra/
        index.ts               ← Mastra 实例
        agents/
          secretary.ts         ← Secretary Agent
          curator.ts           ← Curator Agent
          specialist-writer.ts
          specialist-analyst.ts
          specialist-researcher.ts
        tools/
          file.ts              ← 文件操作工具集
          shell.ts             ← Shell 命令工具
          web.ts               ← Web 请求工具
          memory.ts            ← 记忆工具
          decision.ts          ← 决策工具
          document.ts          ← 文档解析工具
          browser.ts           ← 浏览器操作工具
          knowledge.ts         ← 知识图谱工具
          lsp.ts               ← LSP 工具
          skills.ts            ← 技能工具
          system.ts            ← 系统 OS 工具
          workflow.ts          ← 工作流工具
          project.ts           ← 项目管理工具
          scheduler.ts         ← 调度工具
          ...                  ← 其余工具
        workflows/
          file-process.ts
          code-review.ts
          deploy.ts
          ...                  ← 其余 workflow
        prompts/
          shared.ts            ← SHARED_PROMPT
          identities.ts        ← agent 身份提示词
        skills/
          loader.ts            ← 技能加载器 (从 packages/agent 迁移)
        projector/
          ...                  ← 外部 agent 投影 (从 packages/agent 迁移)
        process-identity.ts    ← 保留
      routes/
        decisions.ts           ← 保留
        knowledge-graph.ts     ← 保留
        skills.ts              ← 保留
        employees.ts           ← 保留
        backup.ts              ← 保留
        settings.ts            ← 保留
        workbench.ts           ← 保留
        squads.ts              ← 保留
        dashboard.ts           ← 精简
        health.ts              ← 保留
        autopilot.ts           ← 保留
      services/
        browser-pool.ts        ← 从 harness 迁移
        agent-detector.ts      ← 外部 agent 检测
        session-cleanup.ts     ← 会话清理
        code-sandbox.ts        ← 从 workflow 迁移
        safety.ts              ← 从 agent 迁移
        knowledge-graph.ts     ← KG 服务
        file-service.ts        ← 文件操作服务
  desktop/
    src/
      components/
        DAGEditor/
          export.ts            ← 修改为输出 Mastra workflow
      ...                      ← 其余保持不变
```

---

## 四、删除行数统计

| Phase | 删除的包/模块               | 代码行数 (估算) |
| ----- | --------------------------- | --------------- |
| B     | packages/agent (大部分)     | ~4,500          |
| C     | 工具 wrapper + tools/\*     | ~3,500          |
| D     | packages/workflow (全部)    | ~3,000          |
| E     | packages/memory (大部分)    | ~1,500          |
| F     | packages/events (全部)      | ~1,500          |
| F     | packages/harness (大部分)   | ~2,000          |
| F     | packages/gateway (全部)     | ~2,000          |
| G     | packages/secretary (大部分) | ~800            |
| H     | server routes (精简)        | ~2,000          |
| H     | server contexts (精简)      | ~1,500          |
| I     | packages/types (精简)       | ~500            |
|       | **总计删除**                | **~22,800**     |
|       | **总计新增** (mastra/)      | **~1,200**      |

---

## 五、风险与依赖

| 风险                                             | 等级 | 对策                                                   |
| ------------------------------------------------ | ---- | ------------------------------------------------------ |
| Mastra API 破坏性更新                            | 中   | 锁定版本范围 `^1.45`，定期查看 changelog               |
| DeepSeek 模型与 structured output + tools 兼容性 | 中   | 使用 `jsonPromptInjection: true` 或 `prepareStep` 分离 |
| 知识图谱与观察记忆的数据一致性                   | 中   | 独立维护 KG，通过工具暴露，不与 OM 互写                |
| Desktop DAG Editor 输出格式转换                  | 低   | 增量适配，保留原有导出能力做回退                       |
| 现有 session 数据迁移                            | 低   | 新建 thread/resource 映射，旧会话只读导出              |
| Mastra Studio 端口冲突                           | 低   | 修改 Studio 端口配置                                   |
| 已有用户数据和记忆丢失                           | 高   | 迁移前备份，编写单向迁移脚本                           |

---

## 六、执行顺序

```
Phase A: Mastra 底座 ➜ Phase B: Agent ➜ Phase C: Tools
                                              ↓
Phase D: Workflow ←────────────────────────────┘
         ↓
Phase E: Memory ➜ Phase F: Observability/Events/Gateway
         ↓
Phase G: Secretary 精简 ➜ Phase H: Server 路由 ➜ Phase I: Types 精简
                                                     ↓
                                            Phase J: Desktop 适配
```

**关键依赖：**

- Phase C 依赖 Phase B（tools 需要注册到 agent 上）
- Phase D 可并行 Phase E/F（workflow 相对独立）
- Phase F 必须在 Phase B 之后（observability 需要 agent 产生 traces）

---

## 七、验证标准

每一阶段完成后需通过：

1. **TypeScript 编译**：`pnpm typecheck` 零错误
2. **单元测试**：该阶段涉及的测试全部通过
3. **架构校验**：`pnpm lint:arch` 通过（更新架构规则后）
4. **功能验证**：启动 server 后
   - Agent 能正常对话
   - 工具调用正常
   - Workflow 能执行完成
   - 记忆能读写
   - Studio 能看到 traces
5. **回归验证**：Desktop 应用正常启动，DAG Editor 正常操作，技能系统正常
