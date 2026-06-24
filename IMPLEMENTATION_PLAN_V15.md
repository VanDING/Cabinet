# Cabinet V15 — 系统级彻底重构计划

> 基于 V14 完成后的全面审计，对工具系统、LLM 流式输出、对话机制、LLM 网关四大系统进行彻底重构。
> 原则：**优先使用 Mastra 原生能力，不留旧代码，不渐进修补。**

---

## 总览

| 领域         | 当前状态                                                 | 目标                                                        | 变更文件数 |
| ------------ | -------------------------------------------------------- | ----------------------------------------------------------- | ---------- |
| **LLM 网关** | 自定义 `resolveModel()`，无 fallback、无超时、无成本追踪 | Mastra 原生 fallback chain + 超时 + 成本追踪 + 预算强制执行 | ~12        |
| **流式管线** | SSE 编码器仅处理 8/30+ chunk 类型，前端回调大量死代码    | 全类型覆盖，统一 Mastra chunk → SSE 事件映射                | ~5         |
| **工具系统** | 调度工具为 stub，MCP 双系统闲置，无 web 工具             | Mastra 原生调度，MCP 标准集成，补齐 web/npm 等缺失工具      | ~8         |
| **对话机制** | 三层存储孤岛，fork 丢上下文，压缩不同步                  | Mastra thread 为唯一真相源，fork/clone 完整上下文           | ~10        |
| **合计**     |                                                          |                                                             | **~35**    |

---

## 一、LLM 网关 — 从自定义到 Mastra 原生

### 1.1 问题回顾

- `resolveModel()` 完全自定义，绕过 Mastra 的 `ModelRouter`
- 无 fallback：首选供应商故障 = 所有调用失败
- 无超时：`LLM_TIMEOUT_MS=30000` 定义但未接入
- 无重试：`MAX_RETRY_TRANSIENT=3` 定义但未接入
- 成本追踪完全失效：`CostHistoryRepository.insert()` 从未调用
- 无预算强制执行：预算系统是空壳
- `activeApiKeyId` 孤立变量
- `base_url` 存储但 LLM 调用不传递
- `openrouter` 不在自动检测列表

### 1.2 Mastra 原生能力

Mastra v1.45 提供：

- **内置 fallback chain** — `model: [{model: 'openai/gpt-4o', maxRetries: 2}, {model: 'anthropic/claude-sonnet-4-6', maxRetries: 2}]`
- **`abortSignal`** — `agent.stream(input, { abortSignal: AbortSignal.timeout(30_000) })`
- **`onStepFinish`** — 每步完成时获得 `{ usage, text, toolCalls, toolResults }`，可追踪成本
- **`onFinish`** — 整体完成时获得 `{ totalUsage, steps }`
- **`ModelRouterEmbeddingModel`** — 仅用于 embedding，对话模型直接用字符串

### 1.3 实施方案

#### 1.3.1 删除自定义 resolver，改用 Mastra fallback chain

**删除**: `apps/server/src/mastra/model-config.ts`（整个文件）

**新建**: `apps/server/src/mastra/model-gateway.ts`

```typescript
// 核心职责：
// 1. 从 settings + API keys 构建 Mastra 原生 fallback chain
// 2. 提供统一的 buildModelConfig() 给所有 Agent
// 3. 输出 ModelWithRetries[] 数组给 Mastra Agent constructor

import type { ModelWithRetries } from '@mastra/core/agent';
import { loadSettings } from '../routes/settings/persistence.js';

type ModelTier = 'default' | 'reasoning';

export function buildModelConfig(tier: ModelTier = 'default'): ModelWithRetries[] {
  const settings = loadSettings();
  const mapping = settings.modelMapping as Record<string, string> | undefined;
  const providers = detectAvailableProviders();

  if (providers.length === 0) {
    throw new Error('No LLM providers configured');
  }

  // 构建 fallback chain：每个 provider 的默认模型 + 用户自定义映射
  const chain: ModelWithRetries[] = [];

  // 优先用户指定的模型
  if (mapping) {
    const key = tier === 'reasoning' ? 'deep_reasoning' : tier;
    const userModel = mapping[key] || mapping['deep_reasoning'] || mapping['reasoning'];
    if (userModel) {
      chain.push({ model: userModel, maxRetries: 2 });
    }
  }

  // 自动检测的 provider fallback
  for (const provider of providers) {
    const defaultModel = defaultModelForProvider(provider);
    if (!chain.some((c) => c.model === defaultModel)) {
      chain.push({ model: defaultModel, maxRetries: 1 });
    }
  }

  return chain.length > 0 ? chain : [{ model: 'openai/gpt-4o', maxRetries: 0 }];
}

function detectAvailableProviders(): string[] {
  const all = [
    'openai',
    'anthropic',
    'deepseek',
    'google',
    'qwen',
    'moonshot',
    'zhipu',
    'baichuan',
    'openrouter',
  ];
  return all.filter((p) => process.env[`${p.toUpperCase()}_API_KEY`]);
}

function defaultModelForProvider(provider: string): string {
  const m: Record<string, string> = {
    openai: 'openai/gpt-4o',
    anthropic: 'anthropic/claude-sonnet-4-6',
    deepseek: 'deepseek/deepseek-chat',
    google: 'google/gemini-2.0-flash',
    qwen: 'qwen/qwen-plus',
    moonshot: 'moonshot/moonshot-v1-32k',
    zhipu: 'zhipu/glm-4-flash',
    baichuan: 'baichuan/baichuan4',
    openrouter: 'openrouter/anthropic/claude-sonnet-4',
  };
  return m[provider] ?? `openai/gpt-4o`;
}
```

**修改**：所有 Agent 文件，将 `model: resolveModel('default')` → `model: buildModelConfig('default')`

涉及文件：

- `apps/server/src/mastra/agents/secretary.ts`
- `apps/server/src/mastra/agents/curator.ts`
- `apps/server/src/mastra/agents/specialist-planner.ts`（用 `'reasoning'` tier）
- `apps/server/src/mastra/agents/specialist-writer.ts`
- `apps/server/src/mastra/agents/specialist-analyst.ts`
- `apps/server/src/mastra/agents/specialist-researcher.ts`
- `apps/server/src/mastra/agents/specialist-reviewer.ts`
- `apps/server/src/mastra/agents/specialist-tester.ts`

#### 1.3.2 接入超时控制

**修改**: `apps/server/src/routes/secretary.ts`（chat handler）

```typescript
// 使用 Mastra 原生 abortSignal
const result = await agent.stream(input, {
  model: model ?? buildModelConfig('default'),
  memory: { thread: { id: sessionId } },
  abortSignal: AbortSignal.timeout(300_000), // 5 分钟总超时
  maxSteps: 50,
});
```

同时传入 `c.req.raw.signal` 以支持客户端取消传播：

```typescript
const abortController = new AbortController();
// 客户端取消时传播
c.req.raw.signal.addEventListener('abort', () => abortController.abort());
// 超时保护
const timeoutId = setTimeout(() => abortController.abort(), 300_000);

const result = await agent.stream(input, {
  model: model ?? buildModelConfig('default'),
  memory: { thread: { id: sessionId } },
  abortSignal: abortController.signal,
  maxSteps: 50,
});

clearTimeout(timeoutId);
```

#### 1.3.3 接入成本追踪

**新建**: `apps/server/src/mastra/cost-tracker.ts`

```typescript
// 通过 Mastra 的 onStepFinish 回调追踪每次 LLM 调用的 token 消耗
// 将 cost_history 写入 SQLite
import type { LLMStepResult } from '@mastra/core/agent';
import { getServerContext } from '../context.js';

export function createCostTracker(sessionId: string) {
  return {
    onStepFinish(step: LLMStepResult) {
      const ctx = getServerContext();
      const usage = step.usage;
      if (!usage) return;

      try {
        ctx.costHistoryRepo.insert({
          timestamp: new Date().toISOString(),
          model: (step as any).modelId ?? 'unknown',
          prompt_tokens: usage.inputTokens ?? 0,
          completion_tokens: usage.outputTokens ?? 0,
          cost_usd: estimateCost((step as any).modelId, usage),
        });
      } catch {
        // cost tracking is best-effort
      }
    },
  };
}

function estimateCost(
  modelId: string,
  usage: { inputTokens?: number; outputTokens?: number },
): number {
  // 标准 pricing（$/1M tokens）
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'deepseek-chat': { input: 0.27, output: 1.1 },
    'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  };

  const key = Object.keys(pricing).find((k) => modelId.includes(k));
  const p = key ? pricing[key] : { input: 1, output: 5 };

  return (
    ((usage.inputTokens ?? 0) / 1_000_000) * p.input +
    ((usage.outputTokens ?? 0) / 1_000_000) * p.output
  );
}
```

**修改**: `apps/server/src/routes/secretary.ts` — 将 costTracker 传入 `onStepFinish`

#### 1.3.4 接入预算强制执行

**新建**: `apps/server/src/mastra/budget-guard.ts`

```typescript
import { DAILY_BUDGET, MONTHLY_BUDGET } from '@cabinet/types';
import { getServerContext } from '../context.js';

export function checkBudget(): { allowed: boolean; reason?: string } {
  const ctx = getServerContext();
  const now = new Date();

  // 每日预算
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dailyCost = ctx.costHistoryRepo.sumSince(todayStart);
  if (dailyCost >= DAILY_BUDGET) {
    return {
      allowed: false,
      reason: `Daily budget exceeded: $${dailyCost.toFixed(2)} / $${DAILY_BUDGET}`,
    };
  }

  // 每月预算
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthlyCost = ctx.costHistoryRepo.sumSince(monthStart);
  if (monthlyCost >= MONTHLY_BUDGET) {
    return {
      allowed: false,
      reason: `Monthly budget exceeded: $${monthlyCost.toFixed(2)} / $${MONTHLY_BUDGET}`,
    };
  }

  return { allowed: true };
}
```

**修改**: `apps/server/src/routes/secretary.ts` — 在 `agent.stream()` 前调用 `checkBudget()`，超预算返回 429。

#### 1.3.5 删除/合并冗余代码

| 操作     | 文件                                          | 原因                                                                     |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| **删除** | `apps/server/src/mastra/model-config.ts`      | 被 `model-gateway.ts` 替代                                               |
| **删除** | `apps/server/src/context/api-keys.ts`         | `activeApiKeyId` 孤立变量                                                |
| **简化** | `apps/server/src/main.ts`                     | 删除 `CABINET_PRIMARY_PROVIDER` 设置逻辑（Mastra fallback chain 不需要） |
| **保留** | `apps/server/src/crypto.ts`                   | API key 加密解密仍需保留                                                 |
| **保留** | `apps/server/src/routes/settings/api-keys.ts` | API key CRUD 保留                                                        |
| **保留** | `apps/server/src/config.ts`                   | env 验证保留                                                             |

### 1.4 验证标准

1. 配置多个 API key（如 DeepSeek + OpenAI）→ Agent 在首选故障时自动切换
2. 发送消息 → cost_history 表有记录
3. 超预算 → 返回 429 错误
4. 客户端取消请求 → 服务端 LLM 调用被 abort

---

## 二、流式管线 — SSE 编码器全类型覆盖

### 2.1 问题回顾

- SSE 编码器只处理 Mastra 30+ chunk 类型中的 8 种
- 前端注册了 19 种回调，但编码器只发出 6 种有效事件
- `onStopped` 回调未实现
- `onUsage` 回调未接入
- 无断线重连
- 部分 SSE chunk 可能丢 token

### 2.2 Mastra Chunk → SSE Event 完整映射

基于 Mastra `AgentChunkType` + 前端 `readSSEStream` callbacks 的完整配对：

| Mastra chunk.type           | SSE data JSON                                                                                       | 前端回调                  | 优先级 |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- | ------ |
| `text-delta`                | `{"content":"text"}`                                                                                | `onContent`               | **P0** |
| `text-start`                | `{"type":"text_start"}`                                                                             | (新增心跳)                | P2     |
| `text-end`                  | (空操作)                                                                                            | —                         | —      |
| `reasoning-delta`           | `{"type":"thinking","content":"text"}`                                                              | `onThinking`              | **P0** |
| `reasoning-start`           | `{"type":"thinking_start"}`                                                                         | (新增)                    | P1     |
| `reasoning-end`             | `{"type":"thinking_done"}`                                                                          | `onThinkingDone`          | **P0** |
| `tool-call`                 | `{"type":"tool_status","toolType":"call","message":"...","detail":{"name":"...","args":{...}}}`     | `onToolStatus`            | **P0** |
| `tool-call-delta`           | `{"type":"tool_status","toolType":"call_delta","detail":{"name":"...","argsDelta":"..."}}`          | `onToolStatus`            | P1     |
| `tool-result`               | `{"type":"tool_status","toolType":"result","message":"...","detail":{"name":"...","result":"..."}}` | `onToolStatus`            | **P0** |
| `tool-error`                | `{"type":"tool_status","toolType":"error","message":"...","detail":{"name":"...","error":"..."}}`   | `onToolStatus`            | **P0** |
| `step-start`                | `{"type":"step_start","stepNumber":N}`                                                              | (新增)                    | P2     |
| `step-finish`               | `{"type":"step_finish","usage":{"promptTokens":N,"completionTokens":N}}`                            | (新增) → 同时触发 onUsage | P1     |
| `finish`                    | `{"type":"done","usage":{"promptTokens":N,"completionTokens":N}}`                                   | `onDone`                  | **P0** |
| `error`                     | `{"type":"error","message":"..."}`                                                                  | `onError`                 | **P0** |
| `abort`                     | `{"type":"aborted"}`                                                                                | (新增)                    | P1     |
| `start`                     | `{"type":"run_start"}`                                                                              | (新增心跳)                | P2     |
| `background-task-started`   | `{"type":"task_status","tasks":[{"id":"...","name":"...","status":"running"}]}`                     | `onTaskUpdate`            | P1     |
| `background-task-completed` | `{"type":"task_status","tasks":[{"id":"...","name":"...","status":"completed"}]}`                   | `onTaskUpdate`            | P1     |
| `background-task-failed`    | `{"type":"task_status","tasks":[{"id":"...","name":"...","status":"error"}]}`                       | `onTaskUpdate`            | P1     |

### 2.3 实施方案

**重写**: `apps/server/src/mastra/sse-encoder.ts`

```typescript
export function createSSEStream(
  reader: ReadableStreamDefaultReader,
  options?: {
    onText?: (text: string) => void;
    abortSignal?: AbortSignal;
  },
): ReadableStream {
  const encoder = new TextEncoder();
  let accumulatedText = '';
  let aborted = false;

  if (options?.abortSignal) {
    options.abortSignal.addEventListener('abort', () => {
      aborted = true;
    });
  }

  return new ReadableStream({
    async start(controller) {
      try {
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done || aborted) break;

          const chunk: any = value;
          const payload = chunk.payload ?? {};

          switch (chunk.type) {
            // ── Text ──
            case 'text-delta':
              accumulatedText += payload.text ?? '';
              emit(controller, { content: payload.text });
              break;
            case 'text-start':
              emit(controller, { type: 'text_start' });
              break;
            case 'text-end':
              break;

            // ── Reasoning / Thinking ──
            case 'reasoning-delta':
              emit(controller, { type: 'thinking', content: payload.text ?? '' });
              break;
            case 'reasoning-start':
              emit(controller, { type: 'thinking_start' });
              break;
            case 'reasoning-end':
              emit(controller, { type: 'thinking_done' });
              break;

            // ── Tool Calls ──
            case 'tool-call':
              emit(controller, {
                type: 'tool_status',
                toolType: 'call',
                message: `Calling ${payload.toolName}`,
                detail: { name: payload.toolName, args: payload.args },
              });
              break;
            case 'tool-call-delta':
              emit(controller, {
                type: 'tool_status',
                toolType: 'call_delta',
                detail: { name: payload.toolName, argsDelta: payload.argsTextDelta },
              });
              break;
            case 'tool-result':
              emit(controller, {
                type: 'tool_status',
                toolType: 'result',
                message: `Done ${payload.toolName}`,
                detail: { name: payload.toolName, result: payload.result },
              });
              break;
            case 'tool-error':
              emit(controller, {
                type: 'tool_status',
                toolType: 'error',
                message: `Error in ${payload.toolName}`,
                detail: { name: payload.toolName, error: String(payload.error ?? '') },
              });
              break;

            // ── Step lifecycle ──
            case 'step-start':
              emit(controller, { type: 'step_start', stepNumber: payload.stepNumber });
              break;
            case 'step-finish':
              emit(controller, {
                type: 'step_finish',
                usage: payload.usage
                  ? {
                      promptTokens: payload.usage.inputTokens,
                      completionTokens: payload.usage.outputTokens,
                    }
                  : undefined,
              });
              // Also emit usage for frontend tracking
              if (payload.usage) {
                emit(controller, {
                  type: 'usage',
                  promptTokens: payload.usage.inputTokens,
                  completionTokens: payload.usage.outputTokens,
                });
              }
              break;

            // ── Finish / Error / Abort ──
            case 'finish':
              emit(controller, {
                type: 'done',
                usage: payload.usage
                  ? {
                      promptTokens: payload.usage.inputTokens,
                      completionTokens: payload.usage.outputTokens,
                    }
                  : undefined,
              });
              break;
            case 'error':
              emit(controller, { type: 'error', message: String(payload.error ?? '') });
              controller.close();
              return;
            case 'abort':
              emit(controller, { type: 'aborted' });
              controller.close();
              return;

            // ── Background tasks ──
            case 'background-task-started':
            case 'background-task-completed':
            case 'background-task-failed':
              emit(controller, {
                type: 'task_status',
                tasks: [
                  {
                    id: payload.taskId ?? '',
                    name: payload.taskName ?? '',
                    status:
                      chunk.type === 'background-task-started'
                        ? 'running'
                        : chunk.type === 'background-task-completed'
                          ? 'completed'
                          : 'error',
                  },
                ],
              });
              break;

            // ── Metadata events (passthrough) ──
            case 'start':
              emit(controller, { type: 'run_start' });
              break;
            case 'source':
            case 'file':
            case 'raw':
              // Forward as-is with type prefix
              emit(controller, { type: `meta_${chunk.type}`, data: payload });
              break;

            // ── Structured output ──
            case 'object':
            case 'object-result':
              emit(controller, {
                type: 'structured_output',
                outputType: chunk.type === 'object' ? 'partial' : 'final',
                data: payload.object ?? payload,
              });
              break;

            default:
              // Unknown chunk types: emit as generic event for forward compat
              if (payload && Object.keys(payload).length > 0) {
                emit(controller, { type: `raw_${chunk.type}`, data: payload });
              }
              break;
          }
        }

        // Normal completion
        if (!aborted) {
          emit(controller, { type: 'done' });
        }
        controller.close();
        options?.onText?.(accumulatedText);
      } catch (err) {
        if (aborted) {
          emit(controller, { type: 'aborted' });
        } else {
          emit(controller, { type: 'error', message: String(err) });
        }
        controller.close();
      }
    },
  });

  function emit(ctrl: ReadableStreamDefaultController, data: Record<string, unknown>) {
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }
}
```

**修改**: `apps/server/src/routes/secretary.ts` — chat handler 使用新的 encoder 签名，传入 `abortSignal`

#### 2.3.1 前端适配

**修改**: `apps/desktop/src/contexts/ChatContext.tsx`

- 接入 `onUsage` 回调 → 更新 message.usage
- 接入 `onStopped` 回调 → 设置 message 状态为 'stopped'

**修改**: `apps/desktop/src/utils/streaming.ts`

- 保留现有 SSE 解析器（已支持所有事件类型）
- 添加 `onStopped` 的默认处理

### 2.4 验证标准

1. 发送"帮我分析这个项目" → 前端显示 thinking（思考过程）+ tool_status（工具调用）+ 最终回答
2. 推理模型（如 DeepSeek-R1）→ thinking 事件持续推送
3. 工具调用失败 → tool_status error 前端可见
4. 点击 Stop 按钮 → 服务端 stream abort，前端消息状态为 stopped
5. 发送消耗 token 多的请求 → usage 数据在前端消息中可见

---

## 三、工具系统 — 补全+去 stub+标准 MCP 集成

### 3.1 问题回顾

- 3 个调度工具返回假数据
- `MCPManager`（492行自定义）和 `MCPClient`（Mastra原生）两套系统都闲置
- `browserMcp` 是死代码
- 无 web fetch / web search / npm 工具
- Researcher agent prompt 声称有搜索能力但无对应工具

### 3.2 使用 Mastra 原生调度替代 stub

Mastra v1.45 原生支持 `schedule: { cron: '0 9 * * *' }` 在 workflow 定义中。

**删除**: `apps/server/src/mastra/tools/scheduler.ts`（stub 文件）

**新建**: `apps/server/src/mastra/workflows/scheduled-examples.ts`

将调度能力从"Agent 工具"改为"Mastra workflow 调度"——这是正确的抽象。Agent 不需要"创建定时任务"的工具，而是 Captain 在 Factory 页面配置带 schedule 的工作流。

**修改**: `apps/server/src/mastra/tools/index.ts` — 移除 scheduler 工具引用

### 3.3 标准 MCP 集成（删除自定义 MCPManager）

**删除**:

- `apps/server/src/mcp/mcp-manager.ts`（492 行自定义实现）
- `apps/server/src/mcp/` 整个目录及相关引用
- `apps/server/src/mastra/mcp.ts` 中的 `browserMcp`（死代码）

**新建**: `apps/server/src/mastra/mcp-integration.ts`

使用 Mastra 原生 `MCPClient` + `toMCPServerProxies()`：

```typescript
import { MCPClient } from '@mastra/mcp';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CABINET_DIR } from '@cabinet/storage';

export async function createMCPClient(): Promise<MCPClient | null> {
  const configDir = join(CABINET_DIR, 'mcp');
  if (!existsSync(configDir)) return null;

  const configs = readdirSync(configDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(configDir, f), 'utf-8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const servers: Record<string, any> = {};
  for (const cfg of configs) {
    if (!cfg.enabled) continue;

    if (cfg.transport?.type === 'stdio') {
      servers[cfg.name] = {
        command: cfg.transport.command,
        args: cfg.transport.args ?? [],
        env: cfg.transport.env,
      };
    } else if (cfg.transport?.type === 'sse') {
      servers[cfg.name] = {
        url: new URL(cfg.transport.url),
        requestInit: cfg.transport.headers ? { headers: cfg.transport.headers } : undefined,
      };
    }
  }

  if (Object.keys(servers).length === 0) return null;

  const mcp = new MCPClient({ servers, timeout: 60_000 });
  return mcp;
}
```

**修改**: `apps/server/src/mastra/index.ts`

- 初始化 MCPClient
- 将 `mcp.toMCPServerProxies()` 注册到 Mastra
- 或将 `mcp.listToolsets()` 的结果动态注入 Agent

### 3.4 添加缺失工具

#### 3.4.1 Web Fetch 工具

**新建**: `apps/server/src/mastra/tools/web.ts`

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const webFetchTool = createTool({
  id: 'webFetch',
  description: 'Fetch content from a URL and return as text or markdown',
  inputSchema: z.object({
    url: z.string().url(),
    format: z.enum(['text', 'markdown']).default('text'),
  }),
  execute: async ({ url, format }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Cabinet/2.0' },
      });
      const html = await res.text();

      if (format === 'markdown') {
        // 简单 HTML→text 转换
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, '\n')
          .trim()
          .slice(0, 50_000);
        return { content: text, title: res.url };
      }
      return { content: html.slice(0, 100_000), title: res.url };
    } finally {
      clearTimeout(timeout);
    }
  },
});

export const webSearchTool = createTool({
  id: 'webSearch',
  description: 'Search the web using DuckDuckGo (no API key required)',
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number().default(5),
  }),
  execute: async ({ query, maxResults }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
        { signal: controller.signal },
      );
      const data = await res.json();
      const results = ((data as any).RelatedTopics ?? [])
        .slice(0, maxResults)
        .map((r: any) => ({
          title: r.Text?.split(' - ')[0] ?? '',
          snippet: r.Text ?? '',
          url: r.FirstURL ?? '',
        }));
      return { results, query };
    } catch (err) {
      return { results: [], query, error: String(err) };
    } finally {
      clearTimeout(timeout);
    }
  },
});
```

#### 3.4.2 NPM 工具

**新建**: `apps/server/src/mastra/tools/npm.ts`

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execSync } from 'node:child_process';

export const npmInstallTool = createTool({
  id: 'npmInstall',
  description: 'Install npm packages in the current project',
  inputSchema: z.object({
    packages: z.array(z.string()),
    dev: z.boolean().default(false),
  }),
  execute: async ({ packages, dev }) => {
    const cmd = `pnpm add ${dev ? '-D ' : ''}${packages.join(' ')}`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 120_000, cwd: process.cwd() });
    return { output, command: cmd };
  },
});

export const npmListTool = createTool({
  id: 'npmList',
  description: 'List installed npm dependencies',
  inputSchema: z.object({
    json: z.boolean().default(true),
  }),
  execute: async ({ json: asJson }) => {
    if (asJson) {
      const output = execSync('pnpm ls -r --depth 0 --json', {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      return { packages: JSON.parse(output) };
    }
    const output = execSync('pnpm ls -r --depth 0', { encoding: 'utf-8', cwd: process.cwd() });
    return { output };
  },
});
```

### 3.5 工具绑定矩阵更新

| Agent                        | 现有工具                              | 新增                                       |
| ---------------------------- | ------------------------------------- | ------------------------------------------ |
| **Secretary**                | cabinetTools（全部 21 个）            | + webFetch, webSearch, npmInstall, npmList |
| **Researcher**               | readOnlyTools（11 个）                | + webFetch, webSearch（只读）              |
| **Writer**                   | readOnlyTools + workspace（可写）     | 不变                                       |
| **Planner/Reviewer/Analyst** | readOnlyTools + workspace（只读拦截） | 不变                                       |
| **Curator**                  | 无显式工具                            | 不变                                       |

### 3.6 验证标准

1. 请求"搜索最新的 React 19 特性" → Researcher 调用 webSearch 并返回结果
2. 请求"读取 https://example.com 的内容" → Secretary 调用 webFetch
3. 请求"安装 lodash" → Secretary 调用 npmInstall
4. MCP 配置文件中添加服务器 → 工具自动注册到 Agent
5. Workflow 配置 `schedule: { cron: '*/5 * * * *' }` → 每 5 分钟自动执行

---

## 四、对话机制 — 统一存储、正确 fork/clone

### 4.1 问题回顾

- **三层存储**：Desktop localStorage + Server 文件系统 JSON + Mastra LibSQL — 无同步
- **Fork 丢上下文**：新 session 的 Mastra thread 为空
- **压缩不同步**：`/compact` 只清理 SessionManager，Mastra thread 保留完整历史
- **Thread 不删除**：关闭 session 后 Mastra LibSQL 数据无限累积
- **GreetingService 死代码**
- **lastMessages: 20 硬限制**
- **Sub-agent 非流式**

### 4.2 实施方案

#### 4.2.1 删除 SessionManager 文件存储，以 Mastra Thread 为唯一真相源

**删除**: `packages/secretary/src/session-manager.ts`

**新建**: `apps/server/src/mastra/session-service.ts`

```typescript
// 基于 Mastra Memory API 的 session 服务
// Thread = Session（一对一映射）
// Thread metadata = session metadata（title, projectId, parentId, etc.）

import { memory } from './index.js';

export class SessionService {
  // 创建 session = 创建 Mastra thread
  async create(
    sessionId: string,
    metadata?: {
      title?: string;
      projectId?: string;
      parentId?: string;
      captainId?: string;
    },
  ): Promise<void> {
    try {
      await memory.createThread({
        threadId: sessionId,
        resourceId: metadata?.projectId ?? 'default',
        title: metadata?.title ?? 'New Session',
        metadata: metadata as Record<string, unknown>,
      });
    } catch {
      // Thread may already exist — noop
    }
  }

  // 获取 session 信息
  async get(sessionId: string) {
    return memory.getThreadById({ threadId: sessionId });
  }

  // 获取 session 消息（最近 N 条）
  async getMessages(sessionId: string, limit = 50) {
    const result = await memory.query({
      threadId: sessionId,
      selectBy: { last: limit },
    });
    return result?.messages ?? [];
  }

  // 列出所有 sessions（分页）
  async list(perPage = 50) {
    return memory.listThreads({ perPage });
  }

  // Fork = Mastra cloneThread
  async fork(sourceSessionId: string, newSessionId: string, forkPointMessageId?: string) {
    await memory.cloneThread({
      sourceThreadId: sourceSessionId,
      targetThreadId: newSessionId,
      // Mastra's cloneThread copies all messages — the context IS preserved
    });
    return newSessionId;
  }

  // 删除 session
  async delete(sessionId: string) {
    await memory.deleteThread(sessionId);
  }

  // 压缩 = 触发 Mastra observationalMemory 的 compaction
  async compact(sessionId: string) {
    // Mastra handles compaction automatically via observationalMemory config
    // We can trigger it explicitly if needed
    const thread = await memory.getThreadById({ threadId: sessionId });
    if (!thread) return;

    // Update memory config to force compaction
    await (memory as any).updateObservationalMemoryConfig?.({
      threadId: sessionId,
      config: { forceCompact: true },
    });
  }

  // 获取子 sessions
  async getChildren(parentSessionId: string) {
    const allThreads = await memory.listThreads({ perPage: 1000 });
    return (
      (allThreads as any[])?.filter((t: any) => t.metadata?.parentId === parentSessionId) ?? []
    );
  }
}
```

#### 4.2.2 修改 ServerContext，注入 SessionService

**修改**: `apps/server/src/context/types.ts` — 将 `sessionManager` 替换为 `sessionService: SessionService`

**修改**: `apps/server/src/context/build-context.ts` — 创建 SessionService 实例

**修改**: 所有引用 `sessionManager` 的地方：

- `apps/server/src/routes/secretary.ts`（chat, subagent, context, compact, sessions）
- `apps/server/src/routes/memory.ts`

#### 4.2.3 桌面端改为从服务端获取 session 列表

**修改**: `apps/desktop/src/hooks/useSessions.ts`

```typescript
// 从服务端 API 获取 session 列表，替代 localStorage
async function fetchSessions() {
  const res = await apiFetch('/api/memory');
  const data = await res.json();
  return data.entries.map(mapThreadToSession);
}

function mapThreadToSession(entry: any): Session {
  return {
    id: entry.id,
    title: entry.content || entry.metadata?.title || 'Untitled',
    projectId: entry.metadata?.resourceId,
    parentId: entry.metadata?.parentId,
    messages: [], // lazy-load on select
    lastActivity: entry.timestamp,
  };
}
```

#### 4.2.4 Fork 修复

**修改**: `apps/desktop/src/hooks/useSessions.ts` — `forkSession()`

```typescript
async function forkSession(sessionId: string, messageId?: string) {
  const newId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 调用服务端 fork（使用 Mastra cloneThread）
  await apiFetch('/api/secretary/fork', {
    method: 'POST',
    body: JSON.stringify({ sourceSessionId: sessionId, newSessionId: newId, messageId }),
  });

  return newId;
}
```

**新增**: `apps/server/src/routes/secretary.ts` — `POST /fork` 端点

```typescript
secretaryRouter.post('/fork', async (c) => {
  const { sessionService } = getServerContext();
  const { sourceSessionId, newSessionId, messageId } = await c.req.json();
  await sessionService.fork(sourceSessionId, newSessionId, messageId);
  return c.json({ sessionId: newSessionId });
});
```

#### 4.2.5 接入 GreetingService

**新增**: `apps/server/src/routes/secretary.ts`

```typescript
secretaryRouter.get('/greeting', async (c) => {
  const { decisionRepo, costHistoryRepo } = getServerContext();
  const greetingService = new GreetingService();

  const pendingDecisions = decisionRepo.listAllPending({ limit: 5 });
  const todayCost = costHistoryRepo.sumSince(todayStart) ?? 0;

  const greeting = await greetingService.generate({
    captainName: 'Captain',
    pendingDecisions: pendingDecisions.length,
    todayCost,
    lastSessionSummary: null,
    activeWorkflowCount: 0,
  });

  return c.json(greeting);
});
```

**修改**: `apps/desktop/src/components/dashboard/WelcomeHeader.tsx` — 从 API 获取 greeting 数据

#### 4.2.6 增加 lastMessages 限制

**修改**: `apps/server/src/mastra/index.ts`

```typescript
// 从 lastMessages: 20 → 50
const memory = new Memory({
  // ...
  options: {
    lastMessages: 50, // 修复：20 太少，长对话丢失上下文
    // ...
  },
});
```

#### 4.2.7 Sub-agent 改为流式

**修改**: `apps/server/src/routes/secretary.ts` — `/subagent/input` 端点

```typescript
secretaryRouter.post('/subagent/input', async (c) => {
  // ...
  // 从 generate() 改为 stream() + SSE
  const result = await agent.stream(message, {
    memory: { thread: { id: `${sessionId}_sub` } },
    abortSignal: AbortSignal.timeout(120_000),
  });

  c.header('Content-Type', 'text/event-stream');
  const stream = createSSEStream(result.fullStream.getReader());
  return c.newResponse(stream);
});
```

### 4.3 验证标准

1. 创建 session → 服务端 Mastra thread 创建，桌面端从 API 拉取列表
2. Fork session → 新 session 的 Mastra thread 包含 fork 点之前的所有消息
3. 手动压缩 → Mastra thread 的 observationalMemory 触发压缩
4. 关闭 session → Mastra thread 被删除
5. 桌面端第一次加载 → greeting 从服务端 API 获取（含 pending decisions、今日成本等）
6. Sub-agent 调用 → 前端看到实时 streaming 输出
7. 长对话（50+ 轮）→ 上下文仍然可用

---

## 五、实施顺序与依赖

```
Phase 1: LLM 网关         (基础 — 所有 Agent 调用都依赖)
  ├── model-gateway.ts    新建
  ├── 所有 Agent 文件     修改 model 引用
  ├── cost-tracker.ts     新建
  ├── budget-guard.ts     新建
  ├── secretary.ts        修改（abortSignal + onStepFinish）
  └── main.ts             简化 API key 加载

Phase 2: 流式管线         (用户可见 — 依赖 Phase 1 的 timeout/abort)
  ├── sse-encoder.ts      重写
  ├── secretary.ts        修改（新 encoder 签名）
  ├── ChatContext.tsx      修改（接入 onUsage/onStopped）
  └── streaming.ts        微调

Phase 3: 工具系统         (独立性强 — 不阻塞 Phase 1-2)
  ├── scheduler.ts        删除 stub
  ├── tools/web.ts        新建
  ├── tools/npm.ts        新建
  ├── mcp-integration.ts  新建
  ├── mcp/mcp-manager.ts  删除
  ├── mcp/ 目录           删除
  ├── tools/index.ts      修改（移除 scheduler，添加 web/npm）
  └── researcher agent    修改（添加 web 工具）

Phase 4: 对话机制         (独立性强 — 并行于 Phase 3)
  ├── session-service.ts  新建
  ├── session-manager.ts  删除
  ├── context/types.ts    修改
  ├── context/build-context.ts 修改
  ├── routes/secretary.ts 修改（所有引用 + /fork + /greeting）
  ├── routes/memory.ts    修改
  ├── useSessions.ts      重写（API 替代 localStorage）
  ├── GreetingService     接入
  └── index.ts            修改（lastMessages: 20→50）
```

---

## 六、完整文件变更清单

### 新建文件 (7)

| 文件                                        | 职责                               |
| ------------------------------------------- | ---------------------------------- |
| `apps/server/src/mastra/model-gateway.ts`   | Mastra fallback chain 构建         |
| `apps/server/src/mastra/cost-tracker.ts`    | onStepFinish 成本记录              |
| `apps/server/src/mastra/budget-guard.ts`    | 预算检查 + 强制执行                |
| `apps/server/src/mastra/session-service.ts` | 基于 Mastra thread 的 session 管理 |
| `apps/server/src/mastra/mcp-integration.ts` | Mastra 原生 MCPClient 封装         |
| `apps/server/src/mastra/tools/web.ts`       | webFetch + webSearch 工具          |
| `apps/server/src/mastra/tools/npm.ts`       | npmInstall + npmList 工具          |

### 删除文件 (3)

| 文件                                        | 原因                     |
| ------------------------------------------- | ------------------------ |
| `apps/server/src/mastra/model-config.ts`    | 被 model-gateway.ts 替代 |
| `apps/server/src/mcp/mcp-manager.ts`        | Mastra MCPClient 替代    |
| `packages/secretary/src/session-manager.ts` | Mastra thread 替代       |

### 重写文件 (3)

| 文件                                    | 变更                                                        |
| --------------------------------------- | ----------------------------------------------------------- |
| `apps/server/src/mastra/sse-encoder.ts` | 全 chunk 类型覆盖 + abortSignal                             |
| `apps/server/src/routes/secretary.ts`   | timeout/abort/cost tracker/fork/greeting/subagent streaming |
| `apps/desktop/src/hooks/useSessions.ts` | localStorage → 服务端 API                                   |

### 修改文件 (22)

| 文件                                                      | 变更                                 |
| --------------------------------------------------------- | ------------------------------------ |
| `apps/server/src/mastra/agents/secretary.ts`              | model: buildModelConfig()            |
| `apps/server/src/mastra/agents/curator.ts`                | model: buildModelConfig()            |
| `apps/server/src/mastra/agents/specialist-planner.ts`     | model: buildModelConfig('reasoning') |
| `apps/server/src/mastra/agents/specialist-writer.ts`      | model: buildModelConfig()            |
| `apps/server/src/mastra/agents/specialist-analyst.ts`     | model: buildModelConfig()            |
| `apps/server/src/mastra/agents/specialist-researcher.ts`  | model + web 工具                     |
| `apps/server/src/mastra/agents/specialist-reviewer.ts`    | model: buildModelConfig()            |
| `apps/server/src/mastra/agents/specialist-tester.ts`      | model: buildModelConfig()            |
| `apps/server/src/mastra/index.ts`                         | MCPClient 初始化、lastMessages: 50   |
| `apps/server/src/mastra/tools/index.ts`                   | 移除 scheduler，添加 web/npm         |
| `apps/server/src/mastra/mcp.ts`                           | 删除 browserMcp                      |
| `apps/server/src/main.ts`                                 | 简化 API key 加载                    |
| `apps/server/src/context/types.ts`                        | sessionManager → sessionService      |
| `apps/server/src/context/build-context.ts`                | 创建 SessionService                  |
| `apps/server/src/routes/memory.ts`                        | 适配 SessionService                  |
| `apps/server/src/context/api-keys.ts`                     | 删除（孤立变量）                     |
| `apps/desktop/src/contexts/ChatContext.tsx`               | 接入 onUsage/onStopped               |
| `apps/desktop/src/utils/streaming.ts`                     | 微调（可选）                         |
| `apps/desktop/src/components/dashboard/WelcomeHeader.tsx` | API greeting                         |
| `apps/desktop/src/components/ChatView.tsx`                | usage 渲染（可选）                   |
| `apps/desktop/src/hooks/useChat.ts` 或相关                | 适配 session API                     |
| `packages/secretary/src/index.ts`                         | 移除 session-manager 导出            |

---

## 七、风险与注意事项

1. **Mastra `cloneThread` API** — 需要确认 Mastra v1.45 的 Memory 实现是否稳定支持。如果不可用，fallback 为手动复制 messages。

2. **API 兼容性** — desktop 端的 localStorage session 格式与服务端 API 返回格式不同，需要迁移逻辑。建议在 `useSessions.ts` 中添加 `try/catch`：优先 API，fallback localStorage。

3. **SSE 事件类型扩展** — 前端 `readSSEStream` 有 `default` case 处理未知事件类型。新增的 `step_start`、`run_start`、`aborted` 等事件在前端会被忽略（非破坏性），可逐步接入 UI。

4. **MCP 配置热加载** — Mastra MCPClient 不支持运行时动态添加服务器。如果用户通过 Settings UI 添加 MCP 服务器，需要重启服务。短期方案：标记需要重启；长期方案：使用 Mastra 支持的 `refreshTools()`。

5. **成本估算精确度** — `estimateCost()` 使用硬编码定价表，可能不精确。后续可从 Mastra observability spans 中提取 `costContext` 获得精确成本。

6. **向后兼容** — Phase 4 删除 SessionManager 后，旧的 `~/.cabinet/sessions/*.json` 文件不再使用。可在首次运行时自动迁移到 Mastra threads。
