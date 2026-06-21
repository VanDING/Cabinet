# Backend Performance — IntentParser Short-Circuit + Async I/O

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除对话首 token 延迟过高的问题（3-5s → <500ms），通过默认路径短路、延迟初始化、增量更新、异步 I/O、修复硬编码模型。

**Architecture:** 不改动 Context 设计或系统记忆机制，仅在执行路径上减少冗余 LLM 调用和同步阻塞。

**Tech Stack:** Node.js, TypeScript, AI SDK, SQLite, Vitest

---

## 依赖与顺序

```
Task 1 (默认路径短路) ──→ Task 2 (延迟初始化)
Task 3 (ContextBuilder 增量) ──→ Task 4 (消除同步 I/O)
Task 5 (修复硬编码模型) ──→ 可独立并行
```

---

## Task 1: IntentParser 默认路径短路

**背景:** 80-90% 消息目标就是 secretary，但每条消息都走完整 embedding + LLM routing，耗时 400-1600ms。

**Files:**

- Modify: `packages/secretary/src/intent-parser.ts`
- Modify: `packages/secretary/src/secretary-agent.ts`
- Test: `packages/secretary/src/__tests__/intent-parser.test.ts`（新增/修改）

---

- [ ] **Step 1: 读取路由逻辑**

Read: `packages/secretary/src/intent-parser.ts`
Locate: `routeToAgent()` 方法
确认其内部调用链：

1. `parse()` — 关键词匹配
2. `generateEmbeddings()` — 话题连续性
3. `matchIntentByEmbedding()`
4. `parseWithLLM()`
5. `routeWithLLM()`

---

- [ ] **Step 2: 添加上下文缓存字段**

Edit: `packages/secretary/src/intent-parser.ts`

在 `IntentParser` 类中增加：

```typescript
interface RoutingState {
  lastAgent: string;
  lastTimestamp: number;
  topicHash: string;
}

private routingState: RoutingState | null = null;
```

---

- [ ] **Step 3: 实现短路条件**

在 `routeToAgent()` 最开头添加：

```typescript
async routeToAgent(message: string, context: RoutingContext): Promise<RoutingResult> {
  // 短路条件
  const noAgentMention = !message.includes('@');
  const noSkillPrefix = !message.startsWith('/');
  const wasSecretary = this.routingState?.lastAgent === 'secretary';
  const withinWindow = this.routingState
    ? Date.now() - this.routingState.lastTimestamp < 5 * 60 * 1000
    : false;
  const topicStable = this.routingState
    ? this.computeTopicHash(message) === this.routingState.topicHash
    : false;

  if (noAgentMention && noSkillPrefix && wasSecretary && withinWindow && topicStable) {
    return { agent: 'secretary', confidence: 0.95, source: 'short-circuit' };
  }

  // 原有完整路径
  const result = await this.routeWithFullPath(message, context);

  // 更新缓存
  this.routingState = {
    lastAgent: result.agent,
    lastTimestamp: Date.now(),
    topicHash: this.computeTopicHash(message),
  };

  return result;
}

private computeTopicHash(message: string): string {
  // 简单实现：取前 20 个非空字符的 hash
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return String(hash);
}
```

---

- [ ] **Step 4: 测试短路逻辑**

Create or modify: `packages/secretary/src/__tests__/intent-parser.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { IntentParser } from '../intent-parser';

describe('IntentParser.routeToAgent short-circuit', () => {
  const parser = new IntentParser({
    // 注入 mock embedding / llm 依赖
    generateEmbedding: vi.fn(),
    llm: { generateText: vi.fn() },
  } as any);

  it('short-circuits when previous route was secretary and message is plain text', async () => {
    // 预热缓存
    parser['routingState'] = {
      lastAgent: 'secretary',
      lastTimestamp: Date.now(),
      topicHash: '12345',
    };

    const result = await parser.routeToAgent('hello world', {
      sessionId: 's1',
      history: [],
    } as any);

    expect(result.agent).toBe('secretary');
    expect(result.source).toBe('short-circuit');
    // 确保没有调用 LLM
    expect(parser['llm'].generateText).not.toHaveBeenCalled();
  });

  it('does NOT short-circuit on @mention', async () => {
    parser['routingState'] = {
      lastAgent: 'secretary',
      lastTimestamp: Date.now(),
      topicHash: '12345',
    };

    await parser.routeToAgent('@specialist do this', { sessionId: 's1', history: [] } as any);

    expect(parser['llm'].generateText).toHaveBeenCalled();
  });
});
```

---

- [ ] **Step 5: Commit**

```bash
git add packages/secretary/src/intent-parser.ts packages/secretary/src/__tests__/intent-parser.test.ts
git commit -m "perf(intent): add short-circuit for secretary default path

Skips embedding + LLM routing for 80-90% of plain messages.
Expected latency reduction: 400-1600ms → <1ms for cached path."
```

---

## Task 2: 延迟初始化

**背景:** `ToolExecutor` 和 `AgentLoop` 在第一条消息到达时才 `new`，应改为服务器启动时预创建。

**Files:**

- Modify: `apps/server/src/context.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `packages/secretary/src/intent-parser.ts`

---

- [ ] **Step 1: 读取初始化时序**

Read: `apps/server/src/main.ts` L13
Read: `apps/server/src/context.ts`（`getServerContext()` 相关）

---

- [ ] **Step 2: 将 AgentLoop / ToolExecutor 创建移到 `getServerContext()`**

Edit: `apps/server/src/context.ts`
在 `getServerContext()` 完成时，预创建共享实例：

```typescript
export function getServerContext() {
  if (ctx) return ctx;

  // ... 现有初始化逻辑 ...

  // 预创建可复用实例
  const toolExecutor = new ToolExecutor(ctx.tools);
  const agentLoopPool = new Map<string, AgentLoop>();

  (ctx as any)._toolExecutor = toolExecutor;
  (ctx as any)._agentLoopPool = agentLoopPool;

  return ctx;
}
```

如果 `AgentLoop` 构造函数参数太重，改为工厂模式：

```typescript
ctx.createAgentLoop = (sessionId: string) => {
  let loop = agentLoopPool.get(sessionId);
  if (!loop) {
    loop = new AgentLoop({ sessionId, toolExecutor, ... });
    agentLoopPool.set(sessionId, loop);
  }
  return loop;
};
```

---

- [ ] **Step 3: 修改 `IntentParser.warmupEmbeddings()` 为真正异步**

Edit: `packages/secretary/src/intent-parser.ts`
确保 `warmupEmbeddings()` 返回 `Promise<void>`，并且调用方（`main.ts`）用 `await` 或不阻塞主路径：

```typescript
async warmupEmbeddings(): Promise<void> {
  // 后台执行，不阻塞
  this.warmupPromise = this.doWarmup();
}

async doWarmup() {
  // 原有逻辑
}
```

在 `main.ts` 中：

```typescript
const parser = new IntentParser(...);
parser.warmupEmbeddings(); // 不 await，让它后台跑
```

---

## Task 3: ContextBuilder 增量更新

**Files:**

- Modify: `packages/agent/src/context-builder.ts`
- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/src/context-monitor.ts`
- Test: `packages/agent/src/__tests__/context-monitor.test.ts`

---

- [ ] **Step 1: Token 估算改为增量**

Read: `packages/agent/src/context-monitor.ts`
找到 `estimateTokens()` 方法。

修改为维护累计值：

```typescript
export class ContextMonitor {
  private tokenCache = new Map<string, number>(); // messageId → tokenCount
  private totalTokens = 0;

  estimateTokens(messages: ChatMessage[]): number {
    // 增量计算：只计算新消息的 token
    let newTokens = 0;
    for (const msg of messages) {
      if (!this.tokenCache.has(msg.id)) {
        const count = encode(msg.content).length;
        this.tokenCache.set(msg.id, count);
        newTokens += count;
      }
    }
    this.totalTokens += newTokens;
    return this.totalTokens;
  }

  reset() {
    this.tokenCache.clear();
    this.totalTokens = 0;
  }
}
```

---

- [ ] **Step 2: rulesLoader cache TTL 延长**

Read: `packages/agent/src/rules-loader.ts`（或相关文件）
找到 `contextCache` TTL 配置
将 TTL 从 `5s` 改为 `60s`（或更长）

---

- [ ] **Step 3: shortTerm 增量维护**

Read: `packages/agent/src/context-builder.ts`
在 `build()` 方法中，将 `shortTerm.getAll()` 改为使用 sessionCache 增量列表：

```typescript
class ContextBuilder {
  private sessionMessages = new Map<string, ChatMessage[]>();

  async build(sessionId: string): Promise<Context> {
    const cached = this.sessionMessages.get(sessionId);
    const fresh = await this.shortTerm.getAll(sessionId);

    if (!cached || fresh.length === cached.length) {
      this.sessionMessages.set(sessionId, fresh);
    } else if (fresh.length > cached.length) {
      // 只追加新消息
      const appended = fresh.slice(cached.length);
      this.sessionMessages.set(sessionId, [...cached, ...appended]);
    }

    const messages = this.sessionMessages.get(sessionId)!;
    // ... 继续原有逻辑
  }
}
```

---

## Task 4: 消除 SessionManager 同步 I/O

**Files:**

- Modify: `packages/storage/src/session-manager.ts`
- Test: `packages/storage/src/__tests__/session-manager.test.ts`

---

- [ ] **Step 1: 读取现有 persist 实现**

Read: `packages/storage/src/session-manager.ts`
Locate: `persist()` 方法
确认使用 `writeFileSync`

---

- [ ] **Step 2: 改为异步批量写入**

Edit: `packages/storage/src/session-manager.ts`

```typescript
import { writeFile } from 'fs/promises';

export class SessionManager {
  private pendingWrites = new Map<string, SessionData>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  async persist(sessionId: string, data: SessionData): Promise<void> {
    this.pendingWrites.set(sessionId, data);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 500);
  }

  private async flush() {
    this.flushTimer = null;
    const batch = new Map(this.pendingWrites);
    this.pendingWrites.clear();

    const promises: Promise<void>[] = [];
    for (const [sessionId, data] of batch) {
      const path = this.getPath(sessionId);
      promises.push(
        writeFile(path, JSON.stringify(data, null, 2)).catch((err) => {
          logger.warn(`Session persist failed for ${sessionId}`, err);
        }),
      );
    }
    await Promise.all(promises);
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flush();
  }
}
```

在应用退出时调用 `sessionManager.shutdown()`。

---

- [ ] **Step 3: 测试异步写入**

```typescript
import { describe, it, expect } from 'vitest';
import { SessionManager } from '../session-manager';
import fs from 'fs/promises';
import path from 'path';

describe('SessionManager.persist', () => {
  it('persists asynchronously without blocking', async () => {
    const dir = '/tmp/test-sessions';
    await fs.mkdir(dir, { recursive: true });
    const mgr = new SessionManager(dir);

    const start = Date.now();
    await mgr.persist('s1', { messages: [] });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50); // 不应阻塞
    await mgr.shutdown();

    const content = await fs.readFile(path.join(dir, 's1.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual({ messages: [] });
  });
});
```

---

## Task 5: 修复 IntentParser 硬编码模型

**Files:**

- Modify: `packages/secretary/src/intent-parser.ts`
- Read: `packages/gateway/src/ai-sdk-adapter.ts`（确认 tier 配置读取方式）

---

- [ ] **Step 1: 读取 tier 配置**

Run: `rg "default.*tier|deep_reasoning|fast_execution" packages/gateway/src apps/server/src --type ts -n`
确认用户配置的 tier 如何传入（如 `ctx.gateway.resolveModel('default')`）

---

- [ ] **Step 2: 替换硬编码模型**

Edit: `packages/secretary/src/intent-parser.ts`
在 `parseWithLLM` 和 `routeWithLLM` 中：

```typescript
// Before:
model: 'claude-sonnet-4-6';

// After:
model: this.modelResolver?.('routing') ?? this.modelResolver?.('default') ?? 'claude-sonnet-4-6';
```

`IntentParser` 构造函数接收 `modelResolver: (tier: string) => string`：

```typescript
interface IntentParserOptions {
  // ... 现有选项
  modelResolver?: (tier: string) => string;
}
```

在 `context.ts` 初始化时注入：

```typescript
new IntentParser({
  ...,
  modelResolver: (tier) => gateway.resolveModel(tier),
});
```

---

## 最终验证

- [ ] **Step 1: 全量编译**
      Run: `pnpm run build`
      Expected: 0 errors

- [ ] **Step 2: 运行后端测试**
      Run: `pnpm --filter @cabinet/server test`
      Expected: 新增测试通过

- [ ] **Step 3: 手动验证延迟**
      启动服务器，发送一条普通消息，观察首 token 时间
      Expected: <500ms（对比之前的 3-5s）

---

## Self-Review

- [ ] 默认路径短路覆盖 80-90% 消息且不改变上下文设计
- [ ] 同步 I/O 全部替换为异步
- [ ] Token 估算改为增量，TTL 延长
- [ ] 模型不再硬编码，回退到 sonnet 仅在未配置时
- [ ] 所有修改文件编译通过
