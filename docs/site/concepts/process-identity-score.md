# Process Identity Score (PIS)

Process Identity Score（PIS）量化长时运行工作流的过程连贯性：Agent 是否在持续解决最初的问题，还是已经"漂移"到了无关任务。

PIS ∈ [0, 1]，附带趋势分类（improving / stable / drifting / lost）和推荐动作（continue / compact / handoff / abort）。

## 核心概念

PIS 由 4 个因子加权计算：

| 因子                  | 权重 | 含义                                   | 计算方式                                                                                                |
| --------------------- | ---- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Intent Alignment**  | 0.35 | 原始任务 vs 最近 tool 调用的语义一致性 | Phase 1: keyword Jaccard + deviation penalty；Phase 2: embedding cosine（当 `EmbeddingService` 可用时） |
| **Tool Coherence**    | 0.25 | 工具调用序列的聚焦程度                 | `1 - uniqueTools / totalCalls`（最近 10 步窗口）                                                        |
| **Goal Progress**     | 0.25 | 已完成子目标的比例                     | 扫描 tool result 中的 `milestone_complete` / `subtask_done` / `goal_achieved` 标记                      |
| **Context Stability** | 0.15 | Context zone 的震荡频率                | `1 - zoneCrossings / stepCount`                                                                         |

## 配置示例

```typescript
import { AgentLoop } from '@cabinet/agent';

const loop = new AgentLoop({
  // ... gateway, toolExecutor, etc.
  pis: {
    enabled: true,
    mode: 'log_only', // 'log_only' | 'intervene'
    evaluationIntervalSteps: 3, // 每 3 步计算一次 PIS
    weights: {
      intentAlignment: 0.35,
      toolCoherence: 0.25,
      goalProgress: 0.25,
      contextStability: 0.15,
    },
  },
});
```

> **建议**：初期使用 `mode: 'log_only'` 运行至少 2 周，观察 PIS 分布和误报率，再切换为 `intervene`。

## 使用场景

### 场景 1：检测任务漂移

Agent 收到任务"Review src/agent-loop.ts for bugs"，执行 10 步后开始讨论无关的 UI 设计：

```
Step 6  PIS: 0.72  trend: stable   action: continue
Step 9  PIS: 0.48  trend: drifting action: compact  ← 工具调用中出现 "create_component", "css_color"
Step 12 PIS: 0.22  trend: lost     action: handoff  ← 意图对齐度骤降
```

在 `intervene` 模式下，`ProcessIdentityObserver` 会发布 `process_identity_alert` 事件：

```typescript
eventBus.publish({
  messageType: MessageType.SystemNotification,
  payload: {
    type: 'process_identity_alert',
    data: { sessionId, score: 0.22, trend: 'lost', action: 'handoff' },
  },
});
```

Dashboard 或监控系统可订阅该事件，向用户提示"Agent 可能已偏离原始任务"。

### 场景 2：Embedding 升级（Phase 2）

默认使用 keyword Jaccard 计算 Intent Alignment。当 `EmbeddingService` 传入时，自动升级为语义级 cosine similarity：

```typescript
import { EmbeddingService } from '@cabinet/agent';

const embeddingService = new EmbeddingService(gateway);
const pis = await calculatePIS(ctx, originalTask, embeddingService);
```

示例：任务为"Build a web application"，工具调用为 `create_react_app({ template: 'typescript' })`。

- Keyword 模式："build" 匹配 "create" → Jaccard 中等 → score ~0.5
- Embedding 模式：语义高度相关 → cosine ~0.85 → score 显著更高

### 场景 3：手动触发 PIS 评估

在非 AgentLoop 场景（如后台审计）中直接调用：

```typescript
import { calculatePIS } from '@cabinet/agent';

const pis = await calculatePIS(
  {
    sessionId: 'sess-1',
    stepCount: 12,
    toolCallHistory: [...],
    zoneCrossings: [...],
    systemPrompt: 'You are a code reviewer...',
    // ... 其他 AgentExecutionContext 字段
  } as AgentExecutionContext,
  'Review src/agent-loop.ts for bugs',
);

console.log(pis.total, pis.trend, pis.recommendedAction);
```

## API 参考

### `calculatePIS`

```typescript
async function calculatePIS(
  ctx: AgentExecutionContext,
  originalTask: string,
  embeddingService?: EmbeddingService,
): Promise<ProcessIdentityScore>;
```

返回结构：

```typescript
interface ProcessIdentityScore {
  total: number; // 加权总分，范围 [0, 1]
  factors: PISFactor[]; // 4 个因子的明细
  trend: 'improving' | 'stable' | 'drifting' | 'lost';
  recommendedAction: 'continue' | 'compact' | 'handoff' | 'abort';
}

interface PISFactor {
  name: string; // 'intentAlignment' | 'toolCoherence' | 'goalProgress' | 'contextStability'
  weight: number;
  score: number; // 该因子得分 [0, 1]
}
```

### `ProcessIdentityObserver`

AgentLoop 内置 observer，自动在 step boundary 触发 PIS 计算。

注册条件：AgentLoop 构造参数传入 `pis.enabled: true`。

行为：

- 仅在 `stepCount >= 3` 且 `stepCount % evaluationIntervalSteps === 0` 时计算
- 计算结果写入 `ctx.lastPIS` 和 `ctx.pisHistory`
- `mode: 'intervene'` 且 `recommendedAction` 为 `handoff`/`abort` 时，向 EventBus 发布 `process_identity_alert`

### `EmbeddingService`

```typescript
class EmbeddingService {
  constructor(gateway: LLMGateway);
  async embed(text: string): Promise<number[]>;
  async cosineSimilarity(a: string, b: string): Promise<number>;
}
```

薄封装，直接调用 LLMGateway 的 `generateEmbeddings` API。不传 `EmbeddingService` 时，`calculatePIS` 自动回退到 keyword Jaccard。

### 推荐动作阈值

| PIS 总分  | stepCount < 5 | stepCount ≥ 5                   |
| --------- | ------------- | ------------------------------- |
| > 0.7     | `continue`    | `continue`                      |
| 0.5 – 0.7 | `continue`    | `compact`（建议 context 压缩）  |
| 0.3 – 0.5 | `continue`    | `handoff`（建议交接给新 agent） |
| ≤ 0.3     | `continue`    | `abort`（建议终止）             |

> stepCount < 5 时统一返回 `continue`，因为样本不足以做可靠判断。

### 趋势分类规则

基于最近 4 次 PIS 记录：

| Δ (最后 - 最初) | 趋势        |
| --------------- | ----------- |
| > +0.15         | `improving` |
| < -0.25         | `lost`      |
| < -0.10         | `drifting`  |
| 其他            | `stable`    |

记录数 < 4 时，默认返回 `stable`。

## 注意事项

1. **Goal Progress 的 milestone 标记** — 若 tool 输出不包含 `milestone_complete`、`subtask_done`、`goal_achieved`，该因子恒为 0.5（neutral）。建议在 tool 描述或 system prompt 中引导 LLM 在完成任务子目标时输出这些标记。

2. **与 HandoffObserver 的优先级** — PIS 的 `recommendedAction` 优先级低于 `HandoffObserver`。PIS 仅作为辅助输入，不直接触发 agent 终止。

3. **Context Stability 依赖 zoneCrossings** — 需要 `ContextMonitorObserver` 在 pipeline 中先于 `ProcessIdentityObserver` 运行，以填充 `ctx.zoneCrossings`。
