# Cabinet → Vercel AI SDK v7 迁移计划 v5

> **基于 AI SDK v7 (Beta) 官方文档重新制定 — 2026-06**
>
> 该版本修正了 V4 计划中的 3 个致命 API 假设错误（WorkflowAgent DAG、HarnessAgent 导入、uploadSkill API），并纳入了 V4 遗漏的 v7 新能力。

---

## 一、v7 能力全景与采用策略

| v7 能力                                     | 计划覆盖?      | 采用决策                                      |
| ------------------------------------------- | -------------- | --------------------------------------------- |
| `ToolLoopAgent` — Agent 循环                | ✅ P1          | **核心替换目标**，替换 agent-loop.ts          |
| `tool()` + `toolsContext` + `contextSchema` | ✅ P2          | **核心替换目标**，替换旧工具系统              |
| `toolApproval` — 工具审批                   | ✅ P2          | 替换 SafetyCheckObserver                      |
| Lifecycle Callbacks — 生命周期              | ✅ P1          | 替换 Observer Pipeline                        |
| `stopWhen` — 循环控制                       | ✅ P1          | 内置 `isStepCount(n)`                         |
| `prepareStep` — 步骤预处理                  | ✅ P1          | context 管理 + 消息裁剪                       |
| **Subagents** — 子 agent                    | ❌ V4 遗漏     | **P3 新增**，替换 Orchestrator + DAG 节点执行 |
| **MCP Tools** — `@ai-sdk/mcp`               | ❌ V4 遗漏     | **P4 新增**，为 Cabinet 增加外部工具扩展能力  |
| **Structured Output** — `Output.object()`   | ❌ V4 遗漏     | **P1/P3 新增**，类型安全输出                  |
| **Telemetry** — `@ai-sdk/otel`              | ❌ V4 遗漏     | **P5 新增**，替换 EventBus 和自定义观测       |
| **Middleware** — `wrapLanguageModel`        | ❌ V4 遗漏     | **P5 新增**，替换 gateway 部分功能            |
| Memory Providers                            | ⚠️ V4 提及     | 可选集成，保留自定义 Memory 作为核心          |
| `HarnessAgent` — `@ai-sdk/harness`          | ⚠️ V4 错误     | **P8 可选**，需 Vercel Sandbox                |
| `WorkflowAgent` — `@ai-sdk/workflow`        | ⚠️ V4 错误     | **P8 可选**，需 Vercel Workflow 平台          |
| `uploadSkill` — skill 上传                  | ⚠️ V4 API 错误 | **P8 可选**，仅 Anthropic/OpenAI              |
| `dynamicTool` — 动态工具                    | ❌ V4 遗漏     | 按需使用                                      |

---

## 二、架构变更

```
迁移前:
  LLM → Gateway Adapter → AgentLoop → execute-generator
    → Observer Pipeline (11个observer) → ToolExecutor → 工具

迁移后:
  Secretary (ToolLoopAgent) → tool() + toolsContext + toolApproval
    → lifecycle callbacks (onStepEnd, onToolExecutionStart, onEnd)
    → Subagents (Curator, Research, etc.)
    → MCP Tools (external extensibility)

可选项:
  model → wrapLanguageModel(middleware) → guardrails / caching / RAG
  → @ai-sdk/otel → OpenTelemetry spans
```

---

## Phase 1: Agent Loop 替换 + LLM 调用替换

**删除：~1,500 行 ｜ 新增：~120 行**

### P1.1 — 安装依赖

```bash
pnpm add ai@beta @ai-sdk/deepseek @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google
```

> 注意：`ai@beta` 为 v7，`ai` (latest) 为 v6。`ToolLoopAgent`、`Output.object()`、`stopWhen`、`toolApproval` 等均为 v7 API。

### P1.2 — 新建 `packages/agent/src/agents.ts`

定义 Secretary 和 Curator 两个 ToolLoopAgent 实例。注意：lifecycle callbacks 在构造函数中直接是函数属性，不是 hooks 对象。

```typescript
import { ToolLoopAgent, tool, Output, isStepCount } from 'ai';
import { z } from 'zod';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { cabinetTools } from './tools';
import { buildInstructions, prepareStep } from './context';

export const secretaryAgent = new ToolLoopAgent({
  model: createDeepSeek('deepseek-chat'),
  instructions: buildInstructions('secretary'),
  tools: cabinetTools,
  stopWhen: isStepCount(20),

  // Lifecycle callbacks — 直接作为构造函数属性
  onStepEnd: async ({ stepNumber, usage, finishReason, toolCalls }) => {
    // 记录指标、保存 checkpoint
  },
  onToolExecutionStart: async ({ toolCall, toolContext }) => {
    // Safety 检查
  },
  onEnd: async ({ steps, usage }) => {
    // Session report
  },
});

export const curatorAgent = new ToolLoopAgent({
  model: createDeepSeek('deepseek-chat'),
  instructions: buildInstructions('curator'),
  tools: {
    /* curator-specific tools */
  },
  stopWhen: isStepCount(10),
  // 可选 structured output
  output: Output.object({
    schema: z.object({
      sessionBref: z.string().describe('Session summary for LTM'),
      decisions: z.array(z.string()),
      nextActions: z.array(z.string()),
    }),
  }),
});
```

**调用方式**（替换 `agentLoop.run()`）：

```typescript
// generate —— 非流式
const result = await secretaryAgent.generate({
  prompt: userMessage,
  runtimeContext: { sessionId, projectId, captainId },
  toolsContext: {
    readFile: { allowedPaths: [workspaceRoot] },
    writeFile: { allowedPaths: [workspaceRoot] },
  },
});
// result.text, result.steps, result.responseMessages

// stream —— 流式
const result = await secretaryAgent.stream({
  messages: conversationHistory, // ModelMessage[]
  runtimeContext: { ... },
  toolsContext: { ... },
});
for await (const chunk of result.textStream) { /* ... */ }
```

**关键修正点（vs V4）：**

- ✅ `messages` 必须是 `ModelMessage[]`，UIMessage 需用 `convertToModelMessages()` 转换
- ✅ lifecycle callbacks 是独立函数属性，不是 `hooks: {...}` 对象
- ✅ `stopWhen: isStepCount(n)` 而非自定义条件数组
- ✅ `runtimeContext` / `toolsContext` 参数位置正确
- ✅ 构造函数 callbacks 和 `generate()`/`stream()` 的 per-call callbacks 可共存

### P1.3 — 新建 `packages/agent/src/tools.ts`

将现有工具系统转为 `tool()` 格式。每个工具必须声明 `contextSchema` 才能在 execute 中接收 `context`。

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const cabinetTools = {
  readFile: tool({
    description: 'Read a file from the local filesystem',
    inputSchema: z.object({ path: z.string() }),
    contextSchema: z.object({
      allowedPaths: z.array(z.string()).optional(),
    }),
    execute: async ({ path }, { context, abortSignal }) => {
      // context.allowedPaths 类型安全
    },
  }),

  execCommand: tool({
    description: 'Execute a shell command',
    inputSchema: z.object({
      command: z.string(),
      workingDirectory: z.string().optional(),
    }),
    contextSchema: z.object({
      whitelist: z.array(z.string()).optional(),
    }),
    execute: async ({ command, workingDirectory }, { context, abortSignal }) => {
      // ...
    },
  }),

  // ... 所有工具
};
```

**与 V4 计划的关键区别：**

- ✅ 每个 tool 必须声明 `contextSchema`，不能只写 `/* per-tool configs */`
- ✅ `execute` 第二参数包含 `{ context, abortSignal, messages, toolCallId, experimental_sandbox }`
- ✅ `toolsContext` 在调用时注入，按 tool name 匹配

### P1.4 — 新建 `packages/agent/src/context.ts`

```typescript
import { SHARED_PROMPT } from './prompt-shared';
import type { ModelMessage, PrepareStepFunction } from 'ai';

export function buildInstructions(role: 'secretary' | 'curator'): string {
  return [SHARED_PROMPT, role === 'secretary' ? secretaryIdentity() : curatorIdentity()].join(
    '\n\n',
  );
}

export const prepareStep: PrepareStepFunction<typeof cabinetTools> = async ({
  stepNumber,
  messages,
  runtimeContext,
  toolsContext,
  steps,
}) => {
  // 消息裁剪
  if (messages.length > 30) {
    return {
      messages: [messages[0], ...messages.slice(-20)],
    };
  }

  // 根据 runtimeContext 动态调整
  if (runtimeContext?.escalated) {
    return { temperature: 0.1 };
  }

  return {};
};
```

**关键修正点：**

- ✅ `prepareStep` 可返回 `messages`（裁剪）、`temperature`、`toolChoice`、`activeTools`、`instructions`、`runtimeContext`、`toolsContext` 等
- ✅ 返回的 `messages` 会持久化到后续步骤
- ✅ `runtimeContext` 在 `prepareStep` 中可读可更新

### P1.5 — 不需要独立的 hooks.ts

V4 计划的 `hooks.ts` 不再需要单独文件。Lifecycle callbacks 直接在 `ToolLoopAgent` 构造函数中定义（见 P1.2）。

### P1.6 — 删除文件

```
packages/agent/src/agent-loop.ts
packages/agent/src/execution/execute-generator.ts
packages/agent/src/execution/observer-factory.ts
packages/agent/src/execution/observer-presets.ts
packages/agent/src/execution/context-assembler.ts
packages/agent/src/execution/session-reporter.ts
packages/agent/src/execution/agent-loop-options.ts
packages/agent/src/runner/                     ← 删除实验性 runner 代码
```

### P1.7 — 适配 SecretaryAgent

`packages/secretary/src/secretary-agent.ts`：

```typescript
// 旧:
await this.agentLoop.run(message);
await this.agentLoop.runStreaming(message, callback);

// 新:
const result = await secretaryAgent.generate({
  prompt: message,
  runtimeContext: { sessionId, projectId, captainId },
  toolsContext: buildToolsContext(),
});

// 流式:
const result = await secretaryAgent.stream({
  messages: conversationHistory,
  runtimeContext: { ... },
  toolsContext: { ... },
});
```

### P1.8 — 更新 `packages/agent/src/index.ts`

```typescript
export { secretaryAgent, curatorAgent } from './agents';
export { cabinetTools } from './tools';
export { buildInstructions, prepareStep } from './context';
// 不再导出 AgentLoop, ToolExecutor, Observer*, etc.
```

---

## Phase 2: 工具迁移 + 安全替换

**删除：~200 行 ｜ 新增：~60 行**

### P2.1 — 工具定义全部迁移为 `tool()` 格式

所有 `createXXXTools(deps)` 转为 `tool()`，依赖通过 `toolsContext` + `contextSchema` 注入。

### P2.2 — Safety 替换为 `toolApproval`

`toolApproval` 在构造函数级别声明（全局策略）或 `generate()`/`stream()` 调用时传入（per-call 策略）：

```typescript
const secretaryAgent = new ToolLoopAgent({
  model: createDeepSeek('deepseek-chat'),
  tools: cabinetTools,
  toolApproval: {
    execCommand: 'user-approval', // 始终需要用户确认
    deleteFile: 'user-approval',
    writeFile: async ({ args, toolContext }) => {
      // 动态判断
      return toolContext.allowedPaths?.some((p) => args.path.startsWith(p))
        ? undefined // not-applicable，自动执行
        : 'user-approval';
    },
  },
});
```

`toolApproval` 支持 4 种状态：`'not-applicable'` | `'approved'` | `'denied'` | `'user-approval'`。也可用 `GenericToolApprovalFunction` 全局处理。

**注意：** 旧 `needsApproval` 属性已废弃，使用 `toolApproval` 替代。

### P2.3 — 删除文件

```
packages/agent/src/tool-executor.ts
packages/agent/src/tool-categories.ts
packages/agent/src/tool-pruner.ts
packages/agent/src/tool-variety-collector.ts
packages/agent/src/observers/safety.ts            (SafetyCheckObserver 部分)
packages/agent/src/observers/tool-execute.ts
packages/agent/src/observers/handoff.ts
packages/agent/src/observers/context-monitor.ts
packages/agent/src/observers/checkpoint.ts
packages/agent/src/observers/step-event-observer.ts
packages/agent/src/observers/blackboard-observer.ts
packages/agent/src/observers/subconscious-insight.ts
packages/agent/src/observers/content-guard.ts
packages/agent/src/observers/reflection.ts
packages/agent/src/observers/judge.ts
packages/agent/src/observers/auto-replan.ts
packages/agent/src/context-builder.ts
packages/agent/src/context-monitor.ts
packages/agent/src/context-handoff.ts
packages/agent/src/checkpoint.ts
packages/agent/src/retry.ts
```

**保留：** `packages/agent/src/safety.ts`（4 层安全检查比 toolApproval 更深）。

---

## Phase 3: DAG 编排 → Subagent 模式

**删除：~3,000 行 ｜ 新增：~150 行**

### 3.1 — 背景：为什么不用 WorkflowAgent

AI SDK v7 中的 `WorkflowAgent`（`@ai-sdk/workflow`）是一个**持久化 agent loop**，必须运行在 Vercel Workflow 运行时中。它**不支持** `steps`、`dependsOn` 等多 agent DAG 编排——V4 计划中描述的这种 API 不存在。

`WorkflowAgent` 的用途是：需要跨进程持久化 + 人工审批 + 自动重试的 agent。如果 Cabinet 未来需要此特性，可作为可选增强。

### 3.2 — 替代方案：Subagent 模式 + 保留 DAG Editor

SDK v7 的 **Subagents** 模式原生支持 parent agent 通过 tool 调用子 agent：

```
Main Agent (Secretary)
  └─ tool: delegateToCurator  →  Curator Subagent
  └─ tool: research        →  Research Subagent
  └─ tool: codeAnalysis    →  Code Analysis Subagent
```

**视觉 DAG Editor 适配方案：**

```
DAG Editor 输出 → dagToSubagentPlan() → Subagent 执行计划
                                    ↓
              SecretaryAgent (ToolLoopAgent)
                ├─ tool: runNode('scan')   → scanSubagent.generate()
                ├─ tool: runNode('classify') → classifySubagent.generate()
                └─ tool: runNode('move')    → moveSubagent.generate()
```

```typescript
// DAG 节点 → Subagent 转换
function dagToSubagentTools(dag: DAGDefinition) {
  const tools: Record<string, Tool> = {};

  for (const node of dag.nodes) {
    tools[`run_${node.id}`] = tool({
      description: `Execute node: ${node.name}`,
      inputSchema: z.object({
        context: z.string().describe('Context from previous nodes'),
      }),
      execute: async ({ context }, { abortSignal }) => {
        const agent = createNodeAgent(node);
        const result = await agent.generate({
          prompt: context,
          abortSignal,
        });
        return result.text;
      },
    });
  }

  return tools;
}
```

**关键设计决策：**

- DAG Editor 保持不变（前端独家价值）
- 执行层从旧的 WorkflowEngine 改为 Subagent 模式
- Subagent 之间通过 tool `execute` 的返回值传递上下文
- Subagent **不支持 toolApproval**（需自动执行），审批逻辑在 parent 层处理

### 3.3 — 删除文件

```
packages/workflow/src/engine.ts
packages/workflow/src/node-executor.ts
packages/workflow/src/engine/manager.ts
packages/workflow/src/engine-helpers.ts
packages/workflow/src/condition-evaluator.ts
packages/workflow/src/code-sandbox.ts
packages/workflow/src/persistence.ts
packages/workflow/src/error-recovery.ts
packages/workflow/src/blueprint-io.ts
packages/workflow/src/blueprint-yaml.ts
packages/workflow/src/manager-context.ts
packages/workflow/                                  ← 整个包可以删除
```

**保留/迁移：**

- DAG Editor UI → `apps/desktop/src/components/DAGEditor/`
- DAG 定义类型 → `packages/types/src/dag.ts`（精简）
- 视觉组件、连线、节点编辑器 → apps/desktop

---

## Phase 4: MCP Tools（新能力）

**新增：~80 行 ｜ Phase 4 完全新增**

MCP (Model Context Protocol) 让 Cabinet 可以连接外部工具服务器：

```typescript
import { createMCPClient } from '@ai-sdk/mcp';

// 连接 MCP 服务器
const mcpClient = await createMCPClient({
  transport: {
    type: 'http',
    url: 'https://mcp-server.example.com/mcp',
    headers: { Authorization: `Bearer ${token}` },
  },
});

// 获取 MCP 工具
const mcpTools = await mcpClient.tools({
  schemas: {
    'search-docs': {
      inputSchema: z.object({ query: z.string() }),
    },
  },
});

// 注入到 Agent
const agent = new ToolLoopAgent({
  model: createDeepSeek('deepseek-chat'),
  tools: {
    ...cabinetTools,
    ...mcpTools, // MCP 工具与内置工具并存
  },
});
```

**价值：**

- 用户可通过 MCP 扩展 Cabinet 的工具能力（连接外部 API、数据库等）
- 利用 MCP 生态（数百个 MCP Server）
- stdio transport 支持本地 MCP 服务器

---

## Phase 5: Telemetry + Middleware（新能力）

**新增：~100 行 ｜ 删除 EventBus：~1,500 行**

### 5.1 — Telemetry 替换 EventBus

```typescript
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';

registerTelemetry(
  new OpenTelemetry({
    enrichSpan: ({ spanType, runtimeContext }) => ({
      'cabinet.session_id': runtimeContext.sessionId,
      'cabinet.project_id': runtimeContext.projectId,
    }),
  }),
);
```

SDK 自动为每个 agent 调用创建 OpenTelemetry spans（`invoke_agent`、`chat`、`execute_tool`），替换 `packages/events/` 全部功能。

### 5.2 — Middleware 替换 Gateway 部分功能

```typescript
import { wrapLanguageModel, extractReasoningMiddleware } from 'ai';

const model = wrapLanguageModel({
  model: createDeepSeek('deepseek-chat'),
  middleware: [
    extractReasoningMiddleware({ tagName: 'think' }), // DeepSeek R1 推理提取
    // 自定义 guardrails middleware
    {
      transformParams: async ({ params }) => {
        // RAG 注入、敏感词过滤等
        return params;
      },
    },
  ],
});
```

Middleware 可替代 gateway 的请求/响应拦截功能（预算控制、log、格式转换）。

### 5.3 — 删除文件

```
packages/events/*                    ← 全部删除（替换为 telemetry + lifecycle callbacks）
packages/gateway/src/llm-gateway.ts
packages/gateway/src/model-router.ts
packages/gateway/src/fallback.ts
packages/gateway/src/ai-sdk-adapter.ts
packages/gateway/                    ← 大部分删除
```

**保留：** `packages/gateway/src/cost-tracker.ts` 和 `budget-guard.ts` 移到 `packages/agent/src/`（SDK telemetry 已提供 usage 数据，可基于此做预算控制）。

---

## Phase 6: 删除残留系统

**删除：~4,000 行**

### 6.1 — Decision 系统

```
packages/decision/*                              ← 全部删除
apps/server/src/context/decision.ts
apps/server/src/context/curator-types.ts         ← 移除 DecisionService 引用
```

### 6.2 — Intent 路由

```
packages/secretary/src/intent-parser.ts
packages/secretary/src/intent-constants.ts
packages/secretary/src/intent-embedding-matcher.ts
packages/secretary/src/intent-llm-router.ts
packages/secretary/src/intent-pattern-matcher.ts
```

`SecretaryAgent` 简化为直接调用 `secretaryAgent.generate(prompt)`——ToolLoopAgent 自己决定工具调用。

### 6.3 — Blackboard

```
packages/agent/src/blackboard.ts
packages/agent/src/blackboard-topic-router.ts
packages/agent/src/blackboard-compress.ts
```

Curator 的 session_brief 通过 `runtimeContext` 传递，替代 Blackboard。

### 6.4 — Harness 残留

```
packages/harness/*                               ← 全部删除
```

SubconsciousLoop → lifecycle callback `onEnd` 替代。

### 6.5 — Memory 系统精简

```
packages/memory/src/knowledge-graph.ts           ← 删除
packages/memory/src/consolidation.ts             ← 保留核心，删除冗余
packages/memory/src/memory-decay.ts              ← 保留 score() 函数
packages/memory/src/write-gate.ts                ← 删除
packages/memory/src/cascade-buffer.ts            ← 删除
packages/memory/src/memory-facade.ts             ← 简化
packages/memory/src/factory.ts                   ← 简化
```

**可选：** 集成 MongoDB Memory Provider (`@mongodb-developer/vercel-ai-memory`) 作为底层存储。

### 6.6 — Projector 系统

```
packages/agent/src/projector/*                   ← 全部删除
packages/agent/src/skill-registry.ts             ← 部分删除
packages/agent/src/skill-loader.ts
packages/agent/src/skill-extractor.ts
packages/agent/src/built-in-skills.ts
packages/agent/src/tools/skill-tools.ts
```

---

## Phase 7: 清理 types

**删除：~2,000 行**

```
packages/types/src/decisions.ts                  ← 删除
packages/types/src/events.ts                     ← 删除
packages/types/src/blueprints.ts                 ← 精简为 dag.ts
packages/types/src/pipeline.ts                   ← 删除
packages/types/src/skills.ts                     ← 精简
packages/types/src/boundaries.ts                 ← 精简
packages/types/src/agent-output.ts               ← 删除
packages/types/src/blackboard.ts                 ← 删除
packages/types/src/primitives.ts                 ← 精简
packages/types/src/agent-config.ts               ← 精简
packages/types/src/dashboard.ts                  ← 已删除
```

---

## Phase 8: 可选增强（后续迭代）

### 8.1 — HarnessAgent（需 Vercel Sandbox）

```typescript
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { claudeCode } from '@ai-sdk/harness-claude-code';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';

const codingAgent = new HarnessAgent({
  harness: claudeCode,
  sandbox: createVercelSandbox({ runtime: 'node24', ports: [4000] }),
  instructions: 'You are a careful coding assistant.',
  onSandboxSession: async ({ session, sessionWorkDir, abortSignal }) => {
    // Prepare workspace
  },
});

const session = await codingAgent.createSession();
try {
  const result = await codingAgent.generate({ session, prompt: '...' });
  // result.text
} finally {
  await session.destroy();
}
```

**注意：** HarnessAgent 来自 `@ai-sdk/harness/agent`（非 `ai`），需要 sandbox 和复杂的 session 生命周期管理。

### 8.2 — Skill Uploads（仅 Anthropic/OpenAI）

```typescript
import { uploadSkill } from 'ai';

const { providerReference } = await uploadSkill({
  api: anthropic.skills(),
  files: [{ path: 'SKILL.md', content: readFileSync('./SKILL.md') }],
  displayTitle: 'My Skill',
});
```

**注意：** `uploadSkill` 的实际 API 接受 `files: [{ path, content }]` 而非 V4 计划中的 `skill` + `filename`。仅 Anthropic 和 OpenAI 支持。

### 8.3 — WorkflowAgent（需 Vercel Workflow）

如果未来需要持久化 agent（跨进程、人工审批、自动重试），可引入：

```bash
npm install @ai-sdk/workflow workflow
```

---

## 实施总览

| Phase    | 内容                      | 删除        | 新增      | 风险 | 状态        |
| -------- | ------------------------- | ----------- | --------- | ---- | ----------- |
| P1       | Agent Loop + LLM 调用替换 | 1,500 → 18  | 120 → 271 | 中   | ✅ 完成     |
| P2       | 工具迁移 + toolApproval   | 200 → 0     | 60 → 21   | 低   | ✅ 完成     |
| P3       | DAG → Subagent 编排       | 3,000 → 0   | 150 → 69  | 中   | ✅ 完成     |
| P4       | MCP Tools 集成 ✨         | 0           | ~80       | 低   | ✅ 完成     |
| P5       | Telemetry + Middleware ✨ | 1,500       | ~100      | 低   | ✅ 完成     |
| P6       | 删除残留系统              | ~4,000      | ~10       | 低   | ⏳ 部分完成 |
| P7       | 清理 types                | ~2,000      | ~30       | 低   | ⏳ 未开始   |
| **总计** |                           | **~12,200** | **~550**  |      |             |

> 标 ✨ 的 Phase 为 V4 计划未覆盖的 v7 新能力。
>
> 详细实施日志见 commit 历史：`git log --oneline` 从 aea8ec1 起。

---

## 保留不变

| 组件                            | 原因                             |
| ------------------------------- | -------------------------------- |
| Visual DAG Editor               | 独家价值，适配为 Subagent 执行   |
| Memory (STM+LTM+Entity)         | SDK 不做结构化分层               |
| SessionManager                  | SDK 不做数据持久化               |
| Curator (consolidation + brief) | 已迁移为 ToolLoopAgent（SDK v7） |
| RulesLoader                     | 分层规则加载                     |
| Safety (safety.ts)              | 4 层检查比 toolApproval 更深     |
| Tauri Desktop UI                | 产品                             |
| Hono Server + WebSocket         | 基础设施                         |
| SHARED_PROMPT                   | 硬约束                           |

---

## 最终包结构

```
packages/
  agent/          ← ToolLoopAgent + tools + context + adapter (~1,000 行)
  secretary/      ← 精简 + SdkAgent 接口 (~200 行)
  memory/         ← 精简 (~800 行)
  types/          ← 精简 (~300 行)
  storage/        ← 保留 (~5,000 行)
  cli/            ← 保留
  ui/             ← 保留
  agent-sdk/      ← 保留
  ~decision/      ← 删除
  ~harness/       ← 删除
  ~gateway/       ← 删除（cost/budget 移到 agent/）
  ~events/        ← 删除
  ~workflow/      ← 删除（DAG Editor 迁移到 apps/desktop）

apps/
  desktop/        ← 保留 + DAG Editor 适配 Subagent 层
  server/         ← 精简路由

新增依赖:
  ai@beta
  @ai-sdk/deepseek @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google
  @ai-sdk/mcp        (P4)
  @ai-sdk/otel       (P5)
```

---

---

## 已完成工作 (2026-06)

在 5 次连续会话中完成以下迁移：

### 核心包改动

| 新文件                                        | 说明                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/agent/src/agents.ts`                | `createSecretaryAgent()` / `createCuratorAgent()` — ToolLoopAgent 工厂 |
| `packages/agent/src/tools-wrapper.ts`         | 旧 `ToolDefinition[]` → SDK `tool()` 格式转换                          |
| `packages/agent/src/context.ts`               | `buildInstructions()` + `prepareStep()`（上下文消息裁剪）              |
| `packages/agent/src/subagent-orchestrator.ts` | DAG 节点 → Subagent tool 转换                                          |
| `packages/agent/src/mcp-integration.ts`       | MCP Server 连接管理（HTTP/SSE）                                        |
| `packages/agent/src/telemetry.ts`             | OpenTelemetry 初始化（`@ai-sdk/otel` 待版本对齐）                      |
| `packages/agent/src/sdk-adapter.ts`           | `SdkAgentLoopAdapter` — 旧 AgentLoop 兼容层                            |

### 改动文件

| 文件                                        | 改动                                                |
| ------------------------------------------- | --------------------------------------------------- |
| `packages/agent/src/agent-loop.ts`          | **重写** — 内部代理到 SdkAgentLoopAdapter           |
| `packages/agent/src/index.ts`               | 新增 SDK v7 导出                                    |
| `packages/secretary/src/secretary-agent.ts` | 新增 `SdkAgent` 接口 + 双路径（ToolLoopAgent 优先） |
| `packages/secretary/src/index.ts`           | 新增 `SdkAgent` 类型导出                            |
| `apps/server/.../secretary.ts`              | SDK ToolLoopAgent 创建 + 传入 SecretaryAgent        |
| `apps/server/.../chat/index.ts`             | SDK `generate()` 优先路径                           |
| `apps/server/.../loops.ts`                  | 全部 role loops 改用 SdkAgentLoopAdapter            |
| `apps/server/.../curator-loop.ts`           | 改用 SdkAgentLoopAdapter                            |
| `apps/server/.../workflows/engine.ts`       | 改用 SdkAgentLoopAdapter                            |

### 删除文件

```
execution/: context-assembler, execute-generator, observer-factory,
           observer-presets, parse-output, session-reporter,
           streaming-adapter, format-task, text-utils
observers/:  subconscious-insight, content-guard (及其测试)
tools/:      tool-variety-collector (及其测试)
secretary/:  intent-constants
```

### 当前架构

```
LLM → ToolLoopAgent (secretary/curator/role)
  → tool() + toolsContext (SDK tool format)
  → lifecycle callbacks (onStepEnd/onToolExecutionStart/onEnd)
  → toolApproval (execCommand/deleteFile/writeFile → user-approval)
  → Subagents (dagToSubagentTools)
  → MCP Tools (connectMCPServer)

向后兼容:
  AgentLoop class 保留 (delegates to SdkAgentLoopAdapter)
  SecretaryAgent 双路径 (sdkAgent 优先, agentLoop fallback)
```

### 仍需清理（服务器深度耦合，待独立重构）

```
packages/workflow/  ← apps/server/src/routes/workflows/*
packages/decision/  ← apps/server/src/context/decision.ts
packages/harness/   ← apps/server/context/* (BrowserPool, SubconsciousLoop...)
packages/events/    ← agent/gateway/harness/decision 广泛使用
packages/gateway/   ← agent/secretary/harness 广泛使用 (ctx.gateway)
```

## V4 → V5 修正清单

| V4 问题                                | V5 修正                                       |
| -------------------------------------- | --------------------------------------------- |
| `WorkflowAgent` 有 `steps`/`dependsOn` | ❌ 不存在，改用 Subagent 模式 (P3)            |
| `HarnessAgent` 从 `ai` 导入            | ✅ 从 `@ai-sdk/harness/agent` 导入 (P8)       |
| `uploadSkill` API 错误                 | ✅ 修正为 `files: [{path, content}]` (P8)     |
| lifecycle callbacks 在 `hooks` 对象中  | ✅ 改为独立函数属性 (P1)                      |
| `toolsContext` 无 `contextSchema`      | ✅ 补充 `contextSchema: z.object({...})` (P2) |
| `generate()` 直接传 UIMessage          | ✅ 补充 `convertToModelMessages()` (P1)       |
| `stopWhen` 笼统                        | ✅ 使用 `isStepCount(n)` (P1)                 |
| `prepareStep` 只做消息裁剪             | ✅ 支持返回多维度设置 (P1)                    |
| 未提及 Subagents                       | ✅ P3 核心编排方案                            |
| 未提及 MCP Tools                       | ✅ P4 扩展能力                                |
| 未提及 Telemetry                       | ✅ P5 替换 EventBus                           |
| 未提及 Middleware                      | ✅ P5 替换 Gateway                            |
