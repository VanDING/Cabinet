# Agent Blackboard

Agent Blackboard 是多 Agent 实时协作的共享数据面。它建立在 EventBus 之上，支持多个 AgentLoop 实例同时读写同一 Topic，并将关键更新实时注入到正在运行的 Agent 对话上下文中。

## 核心概念

- **Topic** — 按语义划分的命名空间，如 `discoveries`、`files`、`preferences`
- **Entry** — Agent 写入 Topic 的单条记录，包含 payload、写入者 agentId、时间戳
- **Merge Strategy** — 控制同一 Topic 多条记录的合并方式：
  - `append` — 追加（适合 discoveries、memories）
  - `replace` — 整体替换（适合 files、project、security）
  - `merge` — 对象级 last-write-wins 合并（适合 preferences）
- **Snapshot** — 将指定 Topic 的当前内容序列化为文本，注入 system prompt
- **Snapshot Compression** — 当 snapshot 超出 token 预算时，按策略截断或丢弃旧条目

## 配置示例

```typescript
import { AgentBlackboard } from '@cabinet/agent';
import { MemoryEventBus } from '@cabinet/events';

const eventBus = new MemoryEventBus();

// 使用默认内置 Topic（discoveries, memories, files, outputs, project, preferences, security）
const blackboard = new AgentBlackboard(eventBus);

// 或自定义配置
const blackboard = new AgentBlackboard(eventBus, {
  enabled: true,
  snapshotBudgetTokens: 2000, // snapshot 注入 system prompt 的 token 上限
  defaultMaxEntries: 100, // 每个 topic 默认保留最多 100 条
  defaultTtlMs: 24 * 60 * 60 * 1000, // 条目默认存活 24 小时
  topics: [
    { name: 'discoveries', mergeStrategy: 'append', maxEntries: 50 },
    { name: 'files', mergeStrategy: 'replace' },
    { name: 'preferences', mergeStrategy: 'merge' },
    { name: 'metrics', mergeStrategy: 'append', ttlMs: 60 * 60 * 1000 },
  ],
});
```

## 使用场景

### 场景 1：跨 Agent 实时发现同步

Agent A 在代码审查中发现一个 bug，写入 blackboard：

```typescript
await blackboard.write(
  'discoveries',
  {
    type: 'bug',
    summary: 'Race condition in agent-loop.ts line 622',
    severity: 'high',
  },
  'agent-a',
);
```

正在运行中的 Agent B 通过 `BlackboardObserver` 订阅 EventBus，在下一个 step 开始前将更新注入 messages：

```
[Shared Context Update]
- [BLACKBOARD UPDATE @2026-06-09T12:00:00Z] discoveries: {"type":"bug","summary":"Race condition..."}
```

### 场景 2：System Prompt 注入

在 AgentLoop 构建 context 时，将 blackboard snapshot 附加到 system prompt：

```typescript
const snapshot = blackboard.snapshot(['discoveries', 'project']);
const prompt = injectBlackboardSnapshot(snapshot, baseSystemPrompt, 2000);
```

若 snapshot 超过 2000 token，自动压缩：保留 `discoveries` 和 `project` 优先，截断长条目，丢弃旧记录。

### 场景 3：Topic 订阅与实时回调

非 Agent 组件（如 Dashboard）订阅特定 Topic：

```typescript
const unsubscribe = blackboard.subscribe('discoveries', (entry) => {
  console.log(`New discovery from ${entry.agentId}:`, entry.payload);
});
// 卸载时取消订阅
unsubscribe();
```

## API 参考

### `AgentBlackboard`

#### Constructor

```typescript
new AgentBlackboard(eventBus: EventBus, config?: Partial<BlackboardConfig>)
```

`BlackboardConfig` 字段：

| 字段                   | 类型                                                  | 默认值         | 说明                                      |
| ---------------------- | ----------------------------------------------------- | -------------- | ----------------------------------------- |
| `enabled`              | `boolean`                                             | `false`        | 是否启用 blackboard                       |
| `snapshotBudgetTokens` | `number`                                              | `2000`         | snapshot 注入 system prompt 的 token 预算 |
| `defaultMaxEntries`    | `number`                                              | `100`          | 各 topic 默认最大条目数                   |
| `defaultTtlMs`         | `number \| undefined`                                 | `undefined`    | 各 topic 默认存活时间                     |
| `topics`               | `Array<{ name, mergeStrategy, maxEntries?, ttlMs? }>` | 7 个内置 topic | 注册的 topic 列表                         |

#### Methods

| 方法            | 签名                                                                                 | 说明                               |
| --------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| `registerTopic` | `<T>(topic: BlackboardTopic<T>) => void`                                             | 运行时注册新 topic                 |
| `write`         | `<T>(topicName: string, payload: T, agentId: string) => Promise<BlackboardEntry<T>>` | 写入条目并广播                     |
| `read`          | `<T>(topicName: string) => BlackboardEntry<T>[]`                                     | 读取 topic 当前全部条目            |
| `subscribe`     | `<T>(topicName: string, handler: (entry: BlackboardEntry<T>) => void) => () => void` | 订阅实时更新，返回取消订阅函数     |
| `snapshot`      | `(topics?: string[]) => string`                                                      | 生成文本快照（用于 system prompt） |

### `injectBlackboardSnapshot`

```typescript
injectBlackboardSnapshot(
  snapshot: string,
  systemPrompt: string,
  budgetTokens: number,
): string
```

将 snapshot 附加到 system prompt。若超出 `budgetTokens`，自动调用 `compressSnapshot` 压缩。压缩策略：

1. 截断单条记录至 200 字符
2. 优先保留 `discoveries`、`project` topic
3. 从非优先 topic 开始丢弃最旧条目

### `BlackboardObserver`

在 AgentLoop 的 ObserverPipeline 中注册，负责：

- 监听 EventBus 上 `SystemNotification` 类型的 blackboard 更新
- 在 `onStepEnd` 时将 pending updates 暂存到 `ctx.pendingBlackboardUpdates`
- AgentLoop 在下一个 step 开始前将 updates 注入 messages

启用方式（AgentLoop 构造参数）：

```typescript
new AgentLoop({
  // ...
  eventBus,
  blackboard,
});
```

当 `eventBus` 和 `blackboard` 同时传入时，`BlackboardObserver` 自动加入 observer pipeline。

## 与现有机制的关系

- **Handoff 文档** — Blackboard 是 handoff 的增强而非替代。Handoff 用于跨 session 持久化；Blackboard 用于同 session 内实时同步。
- **ContextSlot** — Blackboard 的 7 个内置 topic 对应原有 ContextSlot 字段。`ContextSlot` 类型仍作为兼容层存在，但新代码应直接使用 Blackboard API。
