# Cabinet → Vercel AI SDK v7 迁移实施计划

## 目标

用 Vercel AI SDK v7 原生能力替换 Cabinet 自建的 Agent 基础设施层，保留视觉 DAG 编辑器、Memory、SessionManager、Curator、桌面 UI 等独特价值。

**预期成果**：删除 ~12,000 行自建代码，替换为 ~200 行 SDK 配置。

---

## 架构变更

```
迁移前:
  LLM → Gateway Adapter (644行) → AgentLoop (307行) → execute-generator (400行)
    → Observer Pipeline (11个observer, ~600行) → ToolExecutor (200行) → 工具

迁移后:
  LLM → ToolLoopAgent / WorkflowAgent (SDK内置)
    → tool() + toolsContext (SDK内置)
    → lifecycle callbacks (~30行)
```

---

## Phase 1: 替换 Agent Loop + LLM 调用（~1,500 行删除）

### P1.1 — 安装依赖

```bash
pnpm add ai@beta @ai-sdk/deepseek @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google
```

### P1.2 — 新建 `packages/agent/src/agent.ts`

创建所有 Agent 定义文件，包含 Secretary 和 Curator 的 ToolLoopAgent 实例：

```typescript
import { ToolLoopAgent } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { cabinetTools } from './tools';
import { buildInstructions, prepareStep } from './context';
import { hooks } from './hooks';

export const secretaryAgent = new ToolLoopAgent({
  model: createDeepSeek('deepseek-chat'),
  instructions: buildInstructions('secretary'),
  tools: cabinetTools,
  stopWhen: [
    /* 自定义停止条件 */
  ],
  prepareStep,
  toolApproval: {},
  ...hooks,
});

export const curatorAgent = new ToolLoopAgent({
  /* ... */
});
```

**调用方式**（替换 `secretaryAgent.handleMessage()` 中的 `agentLoop.run()`）：

```typescript
const result = await secretaryAgent.generate({
  messages: conversationHistory,
  runtimeContext: { sessionId, projectId, captainId },
  toolsContext: {
    /* per-tool configs */
  },
});
```

**需要适配**：

- SecretaryAgent 中的 `agentLoop.run()` 调用改为 `secretaryAgent.generate()`
- streaming 调用改为 `secretaryAgent.stream()`
- Curator 任务中 `createLoop()` → `curatorAgent.generate()`

### P1.3 — 新建 `packages/agent/src/tools.ts`

将现有 `createCabinetTools(deps)` 的输出转换为 SDK `tool()` 格式：

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const cabinetTools = {
  readFile: tool({
    description: 'Read a file from the local filesystem',
    inputSchema: z.object({ path: z.string() }),
    contextSchema: z.object({ allowedPaths: z.array(z.string()).optional() }),
    execute: async ({ path }, { context }) => {
      // 复用现有工具逻辑
    },
  }),
  // ... 所有工具
};
```

**`toolsContext` 替代 `ToolDependencies`**：工具的依赖（DB、EventBus、Memory 等）通过 `toolsContext` 注入：

```typescript
const result = await secretaryAgent.generate({
  toolsContext: {
    readFile: { allowedPaths: ['/home/user/projects'] },
    writeFile: { allowedPaths: ['/home/user/projects'] },
    // ...
  },
});
```

### P1.4 — 新建 `packages/agent/src/context.ts`

```typescript
import { SHARED_PROMPT } from './prompt-shared';

export function buildInstructions(role: 'secretary' | 'curator'): string {
  return [
    SHARED_PROMPT,
    role === 'secretary' ? secretaryIdentity() : curatorIdentity(),
    // rules 内容由 RulesLoader 加载后传入
  ].join('\n\n');
}

export async function prepareStep({ messages }) {
  // 简化版 context 管理
  if (messages.length > 30) {
    return { messages: [messages[0], ...messages.slice(-20)] };
  }
  return {};
}
```

### P1.5 — 新建 `packages/agent/src/hooks.ts`

Lifecycle callbacks 替代 Observer Pipeline：

```typescript
export const hooks = {
  onStepEnd: async ({ stepNumber, usage, toolCalls, finishReason }) => {
    // 记录指标 (Observability)
    // 保存 checkpoint (messages 到 DB)
  },
  onToolExecutionStart: async ({ toolCall }) => {
    // Safety 检查 (保留现有 safety.ts)
  },
  onEnd: async ({ steps, usage, finishReason }) => {
    // Session report
    // Subconscious tick (如果保留)
  },
};
```

### P1.6 — 删除文件

```
packages/agent/src/agent-loop.ts
packages/agent/src/execution/execute-generator.ts
packages/agent/src/execution/observer-factory.ts
packages/agent/src/execution/observer-presets.ts
packages/agent/src/execution/context-assembler.ts
packages/agent/src/execution/session-reporter.ts
packages/agent/src/execution/agent-loop-options.ts
```

---

## Phase 2: 工具迁移 + 安全替换（~200 行删除）

### P2.1 — 工具定义迁移

所有 `createXXXTools(deps)` 中的工具定义转为 `tool()` 格式。保留 deps 逻辑但通过 `toolsContext` 注入。

### P2.2 — Safety 集成

`toolApproval` 替换 SafetyCheckObserver：

```typescript
const secretaryAgent = new ToolLoopAgent({
  toolApproval: {
    execCommand: 'user-approval',
    deleteFile: 'user-approval',
    writeFile: async ({ args, context }) => {
      // 自定义安全检查逻辑
      return context.allowedPaths?.some((p) => args.path.startsWith(p))
        ? 'auto-approve'
        : 'user-approval';
    },
  },
});
```

### P2.3 — 删除文件

```
packages/agent/src/tool-executor.ts
packages/agent/src/tool-categories.ts
packages/agent/src/tool-pruner.ts
packages/agent/src/tool-variety-collector.ts
packages/agent/src/observers/safety.ts       (仅 SafetyCheckObserver，safety.ts 保留)
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

---

## Phase 3: WorkflowAgent 替换 WorkflowEngine（~2,500 行删除）

### P3.1 — 替换引擎

```typescript
import { WorkflowAgent } from 'ai';

const workflow = new WorkflowAgent({
  name: 'file-organizer',
  steps: [
    {
      name: 'scan',
      agent: secretaryAgent,
      prompt: 'Scan the Downloads folder and list all files by type',
    },
    {
      name: 'classify',
      agent: secretaryAgent,
      prompt: 'Based on the scan results, classify files into categories',
      dependsOn: ['scan'],
    },
    {
      name: 'move',
      agent: secretaryAgent,
      prompt: 'Move files to their respective category folders',
      dependsOn: ['classify'],
      approval: 'user-approval', // 需要用户确认
    },
  ],
});

const result = await workflow.run({
  runtimeContext: { projectId, sessionId },
});
```

### P3.2 — DAG Editor 适配

Visual DAG Editor（前端）输出的节点定义需要适配 `WorkflowAgent` 的 steps 格式。转换层：

```typescript
function dagToWorkflowSteps(dag: DAGDefinition): WorkflowStep[] {
  // 将 DAG Editor 的输出转为 WorkflowAgent 的 steps 格式
}
```

### P3.3 — 删除文件

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
```

---

## Phase 4: SDK Skill + HarnessAgent 替换（~600 行删除）

### P4.1 — SDK Skill 替换

```typescript
import { uploadSkill } from 'ai';

const { providerReference } = await uploadSkill({
  api: createDeepSeek('deepseek-chat'), // 或 provider.files()
  skill: fs.readFileSync('./SKILL.md', 'utf-8'),
  filename: 'SKILL.md',
});
```

本地 skill 发现保留（`RulesLoader` 加载 `.cabinet/skills/`），但 skill 的 LLM 侧处理交给 SDK。

### P4.2 — HarnessAgent 替换

```typescript
import { HarnessAgent } from 'ai';

const claudeCode = new HarnessAgent({
  harness: 'claude-code',
  model: 'anthropic/claude-sonnet-4.5',
});
```

### P4.3 — 删除文件

```
packages/agent/src/skill-registry.ts        (部分，保留本地 skill 发现)
packages/agent/src/skill-loader.ts
packages/agent/src/skill-extractor.ts
packages/agent/src/built-in-skills.ts
packages/agent/src/tools/skill-tools.ts
packages/agent/src/projector/*              (全部 10 个 projector 文件)
```

---

## Phase 5: 删除残留系统（~4,000 行删除）

### P5.1 — Decision 系统

```
packages/decision/*                              ← 全部删除
apps/server/src/context/decision.ts
apps/server/src/context/curator-types.ts         ← 移除 DecisionService 引用
apps/server/src/context/curator-loop.ts          ← 移除 decision 工具
```

### P5.2 — Secretariat 路由

```
packages/secretary/src/intent-parser.ts
packages/secretary/src/intent-constants.ts
packages/secretary/src/intent-embedding-matcher.ts
packages/secretary/src/intent-llm-router.ts
packages/secretary/src/intent-pattern-matcher.ts
```

`SecretaryAgent` 简化为直接调用 `secretaryAgent.generate()`。

### P5.3 — Blackboard

```
packages/agent/src/blackboard.ts
packages/agent/src/blackboard-topic-router.ts
packages/agent/src/blackboard-compress.ts
```

Curator 的 session_brief 通过 STM 传递代替 Blackboard。

### P5.4 — SubconsciousLoop

```
packages/harness/src/subconscious-loop.ts
```

### P5.5 — Memory 系统精简

```
packages/memory/src/knowledge-graph.ts           ← 删除
packages/memory/src/consolidation.ts             ← 删除
packages/memory/src/memory-decay.ts              ← 保留 score()，删除类
packages/memory/src/write-gate.ts                ← 删除
packages/memory/src/cascade-buffer.ts            ← 删除
packages/memory/src/memory-facade.ts             ← 简化
packages/memory/src/factory.ts                   ← 简化
```

### P5.6 — Harness 残留

```
packages/harness/*                               ← 全部删除
```

### P5.7 — 路由残留

```
packages/secretary/src/intent-parser.ts
packages/secretary/src/intent-constants.ts
packages/secretary/src/intent-embedding-matcher.ts
packages/secretary/src/intent-llm-router.ts
packages/secretary/src/intent-pattern-matcher.ts
```

---

## Phase 6: 清理 types/events/gateway（~3,000 行删除）

### P6.1 — Gateway 包

```
packages/gateway/*                               ← 全部删除
```

保留 `cost-tracker.ts` 和 `budget-guard.ts`，移到 `packages/agent/src/` 下。

### P6.2 — Types 包精简

删除不再使用的类型文件：

```
packages/types/src/decisions.ts                  ← 删除（Decision 系统已删）
packages/types/src/events.ts                     ← 删除（用 SDK lifecycle events）
packages/types/src/blueprints.ts                 ← 删除（Workflow 引擎已删）
packages/types/src/pipeline.ts                   ← 删除
packages/types/src/skills.ts                     ← 删除（但保留 SkillMetadata 用于本地发现）
packages/types/src/boundaries.ts                 ← 精简
packages/types/src/agent-output.ts               ← 删除
packages/types/src/blackboard.ts                 ← 删除
packages/types/src/primitives.ts                 ← 精简
packages/types/src/agent-config.ts               ← 精简（只保留必要配置）
```

### P6.3 — Events 包

```
packages/events/*                                ← 全部删除
```

用 SDK lifecycle events + WebSocket 直接推送替代 EventBus。

---

## 实施总览

| Phase    | 内容                      | 删除行数    | 新增行数 | 风险 |
| -------- | ------------------------- | ----------- | -------- | ---- |
| P1       | Agent Loop + LLM 调用替换 | ~1,500      | ~80      | 中   |
| P2       | 工具迁移 + 安全替换       | ~200        | ~50      | 低   |
| P3       | WorkflowAgent 替换        | ~2,500      | ~40      | 中   |
| P4       | Skill + HarnessAgent      | ~600        | ~20      | 低   |
| P5       | 删除残留系统              | ~4,000      | ~10      | 低   |
| P6       | 清理 types/events/gateway | ~3,000      | ~0       | 低   |
| **总计** |                           | **~11,800** | **~200** |      |

### 最终包结构

```
packages/
  agent/          ← 大幅瘦身 (~2,000 行)
  secretary/      ← 精简 (~300 行)
  memory/         ← 精简 (~1,200 行)
  types/          ← 精简 (~500 行)
  storage/        ← 保留 (~5,000 行, 数据库层)
  cli/            ← 保留
  ui/             ← 保留
  agent-sdk/      ← 保留
  ~decision/      ← 删除
  ~harness/       ← 删除
  ~gateway/       ← 删除
  ~events/        ← 删除
  ~workflow/      ← 删除 (DAG Editor 迁移到 apps/desktop)

apps/
  desktop/        ← 保留 + DAG Editor 适配
  server/         ← 精简
```

### 保留不变

| 组件                            | 原因                         |
| ------------------------------- | ---------------------------- |
| Visual DAG Editor               | 独家                         |
| Memory (STM+LTM+Entity)         | SDK 不做结构化分层           |
| SessionManager                  | SDK 不做数据持久化           |
| Curator (consolidation + brief) | SDK 不做后台 agent 任务      |
| RulesLoader                     | 分层规则加载                 |
| Safety (safety.ts)              | 4 层检查比 toolApproval 更深 |
| Tauri Desktop UI                | 产品                         |
| Hono Server + WebSocket         | 基础设施                     |
| Prompt shared                   | SHARED_PROMPT 硬约束         |
