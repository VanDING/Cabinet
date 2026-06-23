# Cabinet → Mastra 集成计划 v6

> **基于 Mastra + AI SDK 底层关系重新制定 — 2026-06-23**
>
> 前置发现：Mastra (`@mastra/core`) 底层依赖 `@ai-sdk/*` provider 包，是 AI SDK 之上的更高层框架。集成 Mastra 不是替换 AI SDK，而是用 Mastra 提供开箱即用的 Agent/Workflow/Memory/Observability，替换 Cabinet 当前自研的同功能模块。

---

## 背景：为什么从 SDK v7 裸用转向 Mastra

V5 计划的目标是在 AI SDK v7 之上自建 Agent 循环、工具系统、工作流、记忆、可观测性。P1-P5 已完成 ToyProtocolAgent 集成。

Mastra 已经在 AI SDK 之上提供了这些能力的生产级实现，避免了重复造轮子：

| 能力       | V5 路线 (自建)                       | Mastra (现成)                                 |
| ---------- | ------------------------------------ | --------------------------------------------- |
| Agent 循环 | `ToolLoopAgent` 手动配置             | `new Agent({ instructions, model, tools })`   |
| 工具系统   | `tool()` + `toolsContext`            | `createTool({ id, inputSchema, execute })`    |
| 工作流引擎 | Subagent 模式自建                    | `createWorkflow().then().branch().parallel()` |
| 记忆系统   | 自研 STM→WriteGate→CascadeBuffer→LTM | `new Memory({ observationalMemory: true })`   |
| 可观测性   | `@ai-sdk/otel` + 自建 EventBus       | `new Observability()` + Studio 可视化         |
| 评估       | 自研 harness (已部分删除)            | `@mastra/evals` 内置 scorer + 实时/历史评估   |
| 模型路由   | 自研 gateway (8 provider)            | Mastra 内置 40+ provider                      |
| 调试 UI    | 无                                   | Studio 开箱即用                               |

**V5 的 P1-P5 不会被浪费**——它们建立了 SDK v7 的直接使用经验，Mastra 底层基于相同的 AI SDK provider 抽象，迁移是概念对等的。

---

## 架构变更

```
V5 架构 (已完成):
  LLM → ToolLoopAgent → tool() + toolsContext
    → lifecycle callbacks
    → Subagents → dagToSubagentTools
    → MCP Tools

V6 目标架构:
  LLM (Mastra model router, 40+ provider)
    └─ Mastra Agent (Secretary, Curator, Specialist)
         ├─ Mastra Tools (createTool)
         ├─ Mastra Workflows (createWorkflow)
         ├─ Mastra Memory (Observational + Working + Semantic)
         └─ Mastra Observability (tracing + Studio)
              ↓
  Cabinet 独有层 (不受影响):
    ├─ Decision L0-L3 (Captain 范式核心)
    ├─ Human Node (结构化人工协作节点)
    ├─ Knowledge Graph + 矛盾检测
    ├─ DAG Editor UI + Tauri 桌面应用
    ├─ Skills 即 Markdown
    └─ SQLite 持久化 + 项目隔离
```

---

## 已完成 (V5 P1-P5)

| Phase | 内容                                 | 状态 |
| ----- | ------------------------------------ | ---- |
| P1    | Agent Loop 替换为 ToolLoopAgent      | ✅   |
| P2    | 工具迁移为 `tool()` + `toolApproval` | ✅   |
| P3    | DAG → Subagent 编排                  | ✅   |
| P4    | MCP Tools 集成                       | ✅   |
| P5    | Telemetry + Middleware               | ✅   |

---

## Phase 6: 安装 Mastra + 搭建底座

**预估：新增 ~50 行**

安装 Mastra 核心包并创建 Mastra 实例。利用 Mastra 的 Hono server adapter 与现有 server 并存。

```bash
pnpm add @mastra/core @mastra/memory @mastra/evals
pnpm add @mastra/libsql             # 存储层 (可选)
pnpm add @mastra/deepseek           # DeepSeek provider 适配
```

```typescript
// packages/server/src/mastra/index.ts
import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

export const mastra = new Mastra({
  storage: new LibSQLStore({ url: ':memory:' }),
  agents: {
    // 后续 Phase 注册
  },
  workflows: {
    // 后续 Phase 注册
  },
});
```

---

## Phase 7: Agent — 替换 packages/agent

**删除：~1,000 行 ｜ 新增：~80 行**

用 Mastra `Agent` 替换当前 `ToolLoopAgent` + lifecycle callbacks + `SdkAgentLoopAdapter` 兼容层。

```typescript
// packages/server/src/mastra/agents/secretary.ts
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

export const secretaryAgent = new Agent({
  id: 'secretary',
  name: 'Secretary',
  instructions: SHARED_PROMPT + secretaryIdentity(),
  model: 'deepseek/deepseek-chat',
  tools: {
    /* Phase 8 迁移的工具 */
  },
  memory: new Memory({ options: { lastMessages: 20 } }),
});

// packages/server/src/mastra/agents/curator.ts
export const curatorAgent = new Agent({
  id: 'curator',
  name: 'Curator',
  instructions: SHARED_PROMPT + curatorIdentity(),
  model: 'deepseek/deepseek-chat',
  memory: new Memory({ options: { observationalMemory: true } }),
});
```

**删除文件：**

```
packages/agent/src/agents.ts          ← Mastra Agent 替代
packages/agent/src/sdk-adapter.ts     ← 兼容层不再需要
packages/agent/src/agent-loop.ts      ← Mastra 内置循环
packages/agent/src/context.ts         ← Mastra instructions 替代
packages/agent/src/telemetry.ts       ← Mastra Observability 替代
packages/agent/src/subagent-orchestrator.ts  ← Mastra 内置 subagent
packages/agent/src/observers/*        ← Mastra hooks/lifecycle 替代
```

**保留：**

```
packages/agent/src/safety.ts          ← 4 层检查比 Mastra guardrails 更深
packages/agent/src/projector/*        ← 外部 agent 投影，无 Mastra 等价物
```

---

## Phase 8: 工具 — 迁移为 Mastra Tool

**删除：~250 行 ｜ 新增：~60 行**

将当前 `tool()` + `toolsContext` + `contextSchema` 迁移为 Mastra `createTool()`。

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const readFileTool = createTool({
  id: 'read-file',
  description: 'Read a file from the local filesystem',
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ context }) => {
    // context 中包含 workspace 路径等
  },
});

export const execCommandTool = createTool({
  id: 'exec-command',
  description: 'Execute a shell command',
  inputSchema: z.object({ command: z.string() }),
  execute: async ({ context }) => {
    // ...
  },
});
```

**删除文件：**

```
packages/agent/src/tools-wrapper.ts   ← Mastra createTool 替代
packages/agent/src/tools/*.ts         ← 逐个迁移
```

---

## Phase 9: 工作流 — 替换 packages/workflow

**删除：~3,000 行 ｜ 新增：~100 行**

用 Mastra `createWorkflow()` 替换当前自研 workflow engine。

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';

const scanStep = createStep({
  id: 'scan',
  inputSchema: z.object({ dir: z.string() }),
  outputSchema: z.object({ files: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    // scan logic
  },
});

export const fileWorkflow = createWorkflow({
  id: 'file-process',
  inputSchema: z.object({ dir: z.string() }),
  outputSchema: z.object({ result: z.string() }),
})
  .then(scanStep)
  .then(classifyStep)
  .then(moveStep)
  .commit();
```

**DAG Editor 适配：** Mastra Workflow 的 `.then()/.branch()/.parallel()` 语义与 DAG Editor 的节点连线模型对应。DAG Editor 输出的节点图转为 Mastra workflow 定义。

**删除文件：**

```
packages/workflow/*                    ← 全部删除
apps/server/src/routes/workflows/*    ← 精简路由，走 Mastra
```

**保留：**

```
apps/desktop/src/components/DAGEditor/  ← 前端独家价值，输出适配 Mastra
```

---

## Phase 10: 记忆 — 替换 packages/memory

**删除：~1,500 行 ｜ 新增：~40 行**

用 Mastra `Memory` 替换自研多级记忆管线。

```typescript
import { Memory } from '@mastra/memory';

const memory = new Memory({
  options: {
    lastMessages: 20, // 替代 ShortTerm
    observationalMemory: true, // 替代 WriteGate + CascadeBuffer + Consolidation
    workingMemory: true, // 偏好/事实存储
    semanticRecall: true, // 替代 LongTerm 向量检索
  },
});
```

**删除文件：**

```
packages/memory/src/short-term.ts       ← Mastra message history 替代
packages/memory/src/long-term.ts        ← Mastra semantic recall 替代
packages/memory/src/consolidation.ts    ← Mastra observational memory 替代
packages/memory/src/write-gate.ts       ← Mastra 内置过滤
packages/memory/src/cascade-buffer.ts   ← Mastra 内置压缩
packages/memory/src/memory-decay.ts     ← 可选保留 score() 算法
packages/memory/src/memory-facade.ts    ← Mastra Memory API 替代
packages/memory/src/factory.ts          ← Mastra 一行替代
```

**保留：**

```
packages/memory/src/knowledge-graph.ts   ← Cabinet 独有能力，Mastra 无等价物
packages/memory/src/entity.ts            ← 实体提取，KG 依赖
```

---

## Phase 11: 可观测 + 评估 — 替换 events/harness/gateway

**删除：~5,000 行 ｜ 新增：~50 行**

Mastra 的 Observability + Evals 覆盖 events/harness/gateway 三大包的功能。

```typescript
import { Observability, MastraStorageExporter } from '@mastra/observability';
import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/prebuilt';

export const mastra = new Mastra({
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'cabinet',
        sampling: { type: 'ratio', probability: 0.1 },
        exporters: [new MastraStorageExporter()],
      },
    },
  }),
  agents: {
    secretary: secretaryAgent.withScorers({
      relevancy: {
        scorer: createAnswerRelevancyScorer({ model: 'openai/gpt-5-mini' }),
        sampling: { type: 'ratio', rate: 0.5 },
      },
    }),
  },
});
```

**删除文件：**

```
packages/events/*             ← Mastra Observability tracing 替代
packages/harness/*            ← Mastra Evals + Observability 替代
packages/gateway/*            ← Mastra model router 替代
  (保留 cost-tracker.ts 和 budget-guard.ts 移到 server/)
```

---

## 保持不变 (Cabinet 独有价值)

| 组件                           | 原因                                            |
| ------------------------------ | ----------------------------------------------- |
| **Decision L0-L3**             | Captain 范式核心，Mastra 无等价物               |
| **Human Node**                 | 结构化人工协作节点，Mastra 无等价物             |
| **Knowledge Graph + 矛盾检测** | Cabinet 独创，Mastra 无等价物                   |
| **DAG Editor UI**              | 视觉工作流编辑器，适配为 Mastra Workflow 前端   |
| **Tauri Desktop**              | 桌面应用，Mastra 无等价物                       |
| **Skills 即 Markdown**         | 技能系统，Mastra 有 workspace skills 但粒度不同 |
| **SQLite 持久化**              | `packages/storage/` 保留                        |
| **SHARED_PROMPT**              | Cabinet 硬约束                                  |
| **Safety (safety.ts)**         | 4 层检查比 Mastra guardrails 更深               |
| **Projector**                  | 外部 agent 投影，Mastra 无等价物                |
| **agent-sdk**                  | 外部 agent 通信协议                             |

---

## 最终包结构

```
packages/
  types/          ← 精简 (~200 行，只保留 Cabinet 特有类型)
  storage/        ← 保留 (SQLite 持久化)
  agent-sdk/      ← 保留 (外部 agent 通信)
  memory/         ← 保留 knowledge-graph + entity (~300 行)
  secretary/      ← 精简为 SessionManager (~100 行)
  decision/       ← 保留 (Captain 范式核心)
  cli/            ← 保留
  ui/             ← 保留

  ~agent/         ← 删除 (Mastra Agent 替代)
  ~workflow/      ← 删除 (Mastra Workflow 替代)
  ~harness/       ← 删除 (Mastra Evals + Observability 替代)
  ~events/        ← 删除 (Mastra Observability 替代)
  ~gateway/       ← 删除 (Mastra model router 替代)

apps/
  server/         ← 精简路由 + Mastra Hono adapter
  desktop/        ← 保留 + DAG Editor 输出适配 Mastra Workflow

新增依赖:
  @mastra/core @mastra/memory @mastra/evals @mastra/libsql
```

---

## 迁移路径总览

```
阶段 0 (已完成):   V5 P1-P5 → ToolLoopAgent + tool() + Subagent + MCP + Telemetry
阶段 1 (P6-P7):    安装 Mastra + 搭建底座，与现有系统并行运行
阶段 2 (P8):       用 Mastra Agent 替换 ToolLoopAgent，删除 agent/ 大部分
阶段 3 (P9):       用 Mastra Workflow 替换自研引擎，删除 workflow/
阶段 4 (P10):      用 Mastra Memory 替换记忆管线，删除 memory/ 大部分
阶段 5 (P11):      用 Mastra Observability + Evals 替换 events/harness/gateway
阶段 6 (收尾):     清理 types/、精简 secretary/、更新 server 路由
```

| Phase    | 内容                  | 删除行数    | 新增行数 | 风险 | 状态      |
| -------- | --------------------- | ----------- | -------- | ---- | --------- |
| P1-P5    | SDK v7 基础迁移       | ~6,200      | ~430     | 中   | ✅ 完成   |
| P6       | Mastra 安装 + 底座    | 0           | ~50      | 低   | ⏳ 待开始 |
| P7       | Mastra Agent 替换     | ~1,000      | ~80      | 中   | ⏳ 待开始 |
| P8       | 工具迁移 Mastra       | ~250        | ~60      | 低   | ⏳ 待开始 |
| P9       | Workflow 替换         | ~3,000      | ~100     | 中   | ⏳ 待开始 |
| P10      | Memory 替换           | ~1,500      | ~40      | 中   | ⏳ 待开始 |
| P11      | Observability + Evals | ~5,000      | ~50      | 低   | ⏳ 待开始 |
| 收尾     | Types + Server 精简   | ~2,000      | ~30      | 低   | ⏳ 待开始 |
| **总计** |                       | **~18,950** | **~410** |      |           |

---

## 风险与对策

| 风险                                              | 对策                                                   |
| ------------------------------------------------- | ------------------------------------------------------ |
| Mastra API 不稳定 (v1.x 快速迭代)                 | 锁定版本，定期跟随 changelog 升级                      |
| Mastra 不支持某些 Cabinet 特有场景                | 保留 safety.ts / knowledge-graph / decision 等独有模块 |
| 工具行为差异（SDK tool() vs Mastra createTool()） | P8 逐工具验证，保留旧工具并联运行                      |
| Workflow 语义差异（DAG vs Mastra 链式）           | P9 先验证转换可行性，DAG Editor 保留为 Mastra 前端     |
| Memory 迁移可能丢失历史数据                       | P10 先双写，验证观察记忆质量后再切换                   |
| 包体积增大                                        | Mastra tree-shaking 测试，按需引入子包                 |
