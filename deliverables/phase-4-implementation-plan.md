# Cabinet 阶段四实施计划 — 代际提升

> **基于**: AUDIT_REPORT.md (系统性全面优化方案 §7) + optimization-plan-assessment.md (评估修订)
> **版本**: v1.0 | **制定日期**: 2026-06-08
> **预计工期**: 4–6 周（仅在前三阶段全部验收通过后启动）

---

## 一、总体策略

### 1.1 核心原则

- **前置硬性门槛**: 第三阶段全部子项验收通过，且系统稳定运行 ≥1 周
- **数据驱动**: 4.1 和 4.3 依赖 `SessionMetricsRepository` 的历史数据，若数据量不足 200 条 session，则延期启动
- **实验分支隔离**: 4.2 (Agent Blackboard) 和 4.4 (MCP 完整协议) 在独立实验分支开发，不影响 `main`
- **渐进交付**: 每个子项可独立验收，不强制串行阻塞

### 1.2 五大子项与依赖关系

> **⚠️ 关键修正**: 原方案遗漏了数据基础设施前提。4.1 和 4.3 依赖的 per-step 数据当前**不存在**，必须先建设 **4.0 数据基础设施**。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  前置条件: 第三阶段全部完成 + SessionMetricsRepo ≥200 条记录 + 系统稳定 1 周   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4.0 数据基础设施（阻塞性前置）                                                │
│  ├─ 新建 step_events 表（tool_call / zone_crossing / utilization 快照）      │
│  ├─ StepEventObserver（AgentLoop 中收集并写入）                               │
│  └─ SessionMetricsRepository 扩展查询 API                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
   ┌──────────────┐           ┌──────────────┐           ┌────────────────┐
   │ 4.1 自适应    │◄─────────│ 4.3 进程身份  │           │ 4.2 Agent      │
   │   阈值        │ 数据共享  │   评分(PIS)  │           │   Blackboard   │
   └──────────────┘           └──────────────┘           └────────────────┘
          │                           │                           │
          │         ┌─────────────────┘                           │
          │         ▼                                               ▼
          │  ┌──────────────┐                             ┌────────────────┐
          └──┤ 自适应可观测性 │                             │ 4.4 MCP 完整   │
             │   主题合并    │                             │   协议支持     │
             └──────────────┘                             └────────────────┘
                                                                (实验分支)
```

| 子项                              | 依赖第三阶段的产出        | 内部依赖            |
| --------------------------------- | ------------------------- | ------------------- |
| **4.0** 数据基础设施              | MemoryFacade 统一接口就绪 | 无                  |
| **4.1** ContextMonitor 自适应阈值 | 4.0 完成                  | 无                  |
| **4.3** ProcessIdentityScore      | 4.0 完成                  | 依赖 4.1 的数据管道 |
| **4.2** Agent Blackboard          | MemoryFacade 统一接口完成 | 无（可与 4.0 并行） |
| **4.4** MCP 完整协议              | 无                        | 无（可与 4.0 并行） |

**推荐执行顺序**: 4.0 → 4.1 → 4.3 → 4.2 → 4.4（4.2/4.4 可与 4.0/4.1/4.3 并行）

---

## 二、子项 4.0: 数据基础设施（阻塞性前置）

> **为什么必须存在**: 4.1 和 4.3 都依赖 per-step 的细粒度数据（每一步的 zone、tool call、utilization）。当前 `session_metrics` 表仅存储 session 级别的聚合数据（`total_steps`、`total_tokens`、`tool_calls_total` 等），没有 step-level 事件记录。这是**基础设施新建**，不是"API 扩展"。

### 2.1 现状与问题

当前数据库（`005_workflow_runs.ts:19-36`）中 `session_metrics` 表的字段：

```
session_id, project_id, role, model, total_steps, total_tokens, total_cost,
tool_calls_total, tool_calls_failed, tool_calls_blocked, duration_ms,
success, error_type, started_at, ended_at
```

**缺失的数据**:

- 每一步使用了什么 tool（`tool_call` 事件序列）
- 每一步结束时的 context utilization 和 zone
- zone crossing 发生的具体 step 和方向
- 每一步的 token 消耗

**后果**: 没有这些数据，4.1 的 `findInflectionPoint()` 和 4.3 的 `Tool Coherence` 因子都是无源之水。

### 2.2 目标

建立 `step_events` 表和对应的数据收集管道，为 4.1 和 4.3 提供可查询的细粒度数据源。

### 2.3 技术方案

#### 2.3.1 数据库迁移

```typescript
// packages/storage/src/migrations/00X_step_events.ts（新迁移文件）

export function runMigration00X(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS step_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      -- event_type 枚举: 'tool_call', 'tool_result', 'zone_snapshot', 'zone_crossing',
      --                    'handoff', 'error', 'checkpoint', 'llm_call'
      payload TEXT NOT NULL DEFAULT '{}',
      -- payload JSON 结构因 event_type 而异:
      --   tool_call:    { tool_name, args, blocked }
      --   tool_result:  { tool_name, success, duration_ms }
      --   zone_snapshot:{ utilization, zone, breakdown: {...} }
      --   zone_crossing:{ from, to, utilization }
      --   handoff:      { reason, tokens_before, tokens_after }
      --   error:        { category, message }
      --   checkpoint:   { checkpoint_id }
      --   llm_call:     { model, prompt_tokens, completion_tokens, cost }
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_step_events_session ON step_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_step_events_session_step ON step_events(session_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_step_events_type ON step_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_step_events_time ON step_events(timestamp);
  `);
}
```

#### 2.3.2 StepEventObserver

```typescript
// packages/agent/src/observers/step-event-observer.ts

export class StepEventObserver implements AgentObserver {
  name = 'StepEventRecorder';

  constructor(
    private readonly db: Database.Database,
    private readonly sessionId: string,
  ) {}

  async onToolCall(
    call: { id: string; name: string; args: Record<string, unknown> },
    ctx: AgentExecutionContext,
  ): Promise<void> {
    this.insertEvent(ctx.stepCount, 'tool_call', {
      tool_name: call.name,
      args: call.args,
    });
  }

  async onToolResult(
    call: { id: string; name: string; args: Record<string, unknown> },
    result: unknown,
    ctx: AgentExecutionContext,
  ): Promise<void> {
    const success = !(result instanceof Error);
    this.insertEvent(ctx.stepCount, 'tool_result', {
      tool_name: call.name,
      success,
    });
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<void> {
    if (ctx.lastSnapshot) {
      this.insertEvent(ctx.stepCount, 'zone_snapshot', {
        utilization: ctx.lastSnapshot.utilization,
        zone: ctx.lastSnapshot.zone,
        breakdown: ctx.lastSnapshot.breakdown,
      });
    }
    if (ctx.zoneCrossings && ctx.zoneCrossings.length > 0) {
      const last = ctx.zoneCrossings[ctx.zoneCrossings.length - 1];
      this.insertEvent(ctx.stepCount, 'zone_crossing', {
        from: last.from,
        to: last.to,
      });
    }
  }

  private insertEvent(step: number, type: string, payload: unknown): void {
    // 使用 prepared statement 批量写入或立即写入
    // 为降低开销，可缓存 10 条后批量 flush
  }
}
```

#### 2.3.3 SessionMetricsRepository 扩展查询

```typescript
// packages/storage/src/repositories/session-metrics-repo.ts 新增

interface StepEventRow {
  id: number;
  session_id: string;
  step_number: number;
  event_type: string;
  payload: string; // JSON
  timestamp: string;
}

interface ZonePerformanceQuery {
  model: string;
  role?: string;
  timeWindowDays: number;
}

interface ZonePerformanceRow {
  zone: 'smart' | 'warning' | 'critical' | 'dumb';
  sessionCount: number;
  avgSuccessRate: number;
  avgToolErrorRate: number;
  avgFormatFailureRate: number;
  avgStepCount: number;
}

class SessionMetricsRepository {
  // 已有方法保持不变 ...

  // ── 新增查询（依赖 step_events 表）──

  /** 按 zone 聚合 session 质量指标 */
  getZonePerformance(query: ZonePerformanceQuery): ZonePerformanceRow[] {
    // JOIN session_metrics + step_events，按 peak_zone 分组
    // peak_zone = 该 session 中达到的最高 zone
  }

  /** 获取 utilization 分布与对应成功率 */
  getPeakUtilizationDistribution(
    model: string,
    days: number,
  ): { utilizationBin: string; count: number; successRate: number }[] {
    // 将 utilization 0.0-1.0 分 20 个 bin（每 bin 0.05）
    // 每个 bin 统计 session 数量和平均成功率
  }

  /** 获取指定 session 的 tool 调用序列 */
  getToolSequence(
    sessionId: string,
  ): { step: number; tool: string; args: string; success: boolean }[] {
    return this.db
      .prepare(
        `SELECT step_number, json_extract(payload, '$.tool_name') as tool,
                json_extract(payload, '$.args') as args,
                json_extract(payload, '$.success') as success
         FROM step_events
         WHERE session_id = ? AND event_type IN ('tool_call', 'tool_result')
         ORDER BY step_number`,
      )
      .all(sessionId) as any[];
  }

  /** 获取指定 session 的 zone crossing 记录 */
  getZoneCrossings(sessionId: string): { step: number; from: string; to: string; at: string }[] {
    return this.db
      .prepare(
        `SELECT step_number, json_extract(payload, '$.from') as from_zone,
                json_extract(payload, '$.to') as to_zone, timestamp
         FROM step_events
         WHERE session_id = ? AND event_type = 'zone_crossing'
         ORDER BY step_number`,
      )
      .all(sessionId) as any[];
  }

  /** 获取指定 session 的 utilization 时间序列 */
  getUtilizationSeries(sessionId: string): { step: number; utilization: number; zone: string }[] {
    return this.db
      .prepare(
        `SELECT step_number, json_extract(payload, '$.utilization') as utilization,
                json_extract(payload, '$.zone') as zone
         FROM step_events
         WHERE session_id = ? AND event_type = 'zone_snapshot'
         ORDER BY step_number`,
      )
      .all(sessionId) as any[];
  }
}
```

### 2.4 实施步骤

| 步骤  | 任务                                                         | 文件                                                        | 工时 | 验收标准                                                |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------- | ---- | ------------------------------------------------------- |
| 4.0.1 | 新建 `step_events` 表迁移脚本                                | `packages/storage/src/migrations/00X_step_events.ts`        | 3h   | 迁移执行成功，表结构正确                                |
| 4.0.2 | 实现 `StepEventObserver`                                     | `packages/agent/src/observers/step-event-observer.ts`       | 6h   | 单元测试覆盖 tool_call/zone_snapshot/zone_crossing 记录 |
| 4.0.3 | 实现批量 flush 策略（避免每步写 DB）                         | `packages/agent/src/observers/step-event-observer.ts`       | 3h   | 1000 步 session 的 DB 写入次数 ≤ 100（10 条批量）       |
| 4.0.4 | 扩展 `SessionMetricsRepository` 查询 API                     | `packages/storage/src/repositories/session-metrics-repo.ts` | 6h   | 通过 mock 数据验证 4 个新增查询返回正确聚合结果         |
| 4.0.5 | 在 `ObserverPipeline` 中注册 `StepEventObserver`（默认关闭） | `packages/agent/src/agent-loop.ts` 或配置层                 | 2h   | 配置 `stepEvents: { enabled: true }` 时数据正确写入     |
| 4.0.6 | 端到端测试：完整 session → step_events 数据验证              | `packages/agent/src/__tests__/step-event-observer.test.ts`  | 6h   | mock AgentLoop 执行后，step_events 表内容完整且正确     |

**合计**: ~26 小时（~3.5 个工作日）

### 2.5 风险与回滚

| 风险                              | 缓解措施                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| step_events 表数据量过大          | 配置 `maxRetentionDays`（默认 90 天），`SessionMetricsRepository.pruneOlderThan` 扩展清理 step_events |
| 写入性能影响 AgentLoop            | 批量 flush（每 10 条或每 5 秒）；使用 WAL 模式；异步写入不阻塞 onStepEnd                              |
| 与现有 session_metrics 数据不一致 | `StepEventObserver` 和 `ObservabilityCollector` 独立运行，不互相依赖                                  |

**回滚**: 从 `ObserverPipeline` 中移除 `StepEventObserver`，或设置 `stepEvents: { enabled: false }`。已写入的数据保留在表中，不影响系统运行。

---

## 三、子项 4.1: ContextMonitor 自适应阈值

### 3.1 现状与问题

当前 `ContextMonitor` 使用**静态阈值**：

```
smart: 0.4  (40%)  → warning: 0.6  (60%)  → critical: 0.8  (80%)  → dumb (>80%)
```

**问题**:

- 不同模型（Claude Sonnet vs GPT-4o-mini）在相同 utilization 下的实际表现差异巨大——小模型在 50% 就开始降质，大模型到 70% 仍稳定
- 不同任务类型（代码生成 vs 简单问答）对 context 压力的耐受度不同
- 阈值是"拍脑袋"定的，没有数据支撑

### 3.2 目标

建立**数据驱动的自适应阈值系统**，按 `(model, taskType)` 维度学习最优阈值。

### 3.3 技术方案

#### 3.3.1 数据模型（依赖 4.0）

4.0 已建立 `step_events` 表和 `SessionMetricsRepository` 扩展查询。4.1 直接使用：

```typescript
// packages/agent/src/context-monitor-adaptive.ts

interface AdaptiveThresholdConfig {
  enabled: boolean;
  explorationRate: number; // 0.0–1.0, default 0.1
  lookbackDays: number; // default 14
  minSamplesPerZone: number; // default 20
  hardLimits: {
    smartZoneMin: number; // default 0.3
    criticalThresholdMax: number; // default 0.9
  };
}
```

#### 3.3.2 自适应阈值算法

采用**简单滑动窗口统计**（无需引入复杂 ML 库）：

```typescript
class AdaptiveContextMonitor extends ContextMonitor {
  private adaptiveConfig: AdaptiveThresholdConfig;
  private metricsRepo: SessionMetricsRepository;

  /** 每 24h 或在 session 启动时重新计算阈值 */
  async recalibrate(model: string, role: string): Promise<ContextWindowConfig> {
    const perf = this.metricsRepo.getZonePerformance({
      model,
      role,
      timeWindowDays: this.adaptiveConfig.lookbackDays,
    });

    if (perf.length < this.adaptiveConfig.minSamplesPerZone * 4) {
      // 样本不足 — 回退到默认值
      return DEFAULT_WINDOW_CONFIG;
    }

    // 获取 utilization 分布与成功率
    const distribution = this.metricsRepo.getPeakUtilizationDistribution(
      model,
      this.adaptiveConfig.lookbackDays,
    );

    const smartWarningBoundary = this.findInflectionPoint(distribution, 0.3, 0.55);
    const warningCriticalBoundary = this.findInflectionPoint(distribution, 0.55, 0.8);
    const criticalDumbBoundary = this.findInflectionPoint(distribution, 0.75, 0.92);

    // 应用 hard limits
    return {
      maxTokens: MODEL_CONTEXT_SIZES[model] ?? DEFAULT_WINDOW_CONFIG.maxTokens,
      smartZoneThreshold: Math.max(
        this.adaptiveConfig.hardLimits.smartZoneMin,
        smartWarningBoundary,
      ),
      warningThreshold: warningCriticalBoundary,
      criticalThreshold: Math.min(
        this.adaptiveConfig.hardLimits.criticalThresholdMax,
        criticalDumbBoundary,
      ),
    };
  }

  /**
   * 在 distribution 中寻找 successRate 显著下降的 utilization 点。
   * 算法：计算相邻 bin 的 successRate 一阶差分，找到最大负差分点。
   * 若数据不足或无明显拐点，返回 range 中点作为保守估计。
   */
  private findInflectionPoint(
    distribution: { utilizationBin: string; count: number; successRate: number }[],
    minRange: number,
    maxRange: number,
  ): number {
    // 1. 筛选在 [minRange, maxRange] 内的 bin
    const filtered = distribution
      .map((d) => ({ ...d, binCenter: parseFloat(d.utilizationBin) }))
      .filter((d) => d.binCenter >= minRange && d.binCenter <= maxRange)
      .sort((a, b) => a.binCenter - b.binCenter);

    if (filtered.length < 3) {
      return (minRange + maxRange) / 2;
    }

    // 2. 计算一阶差分（successRate 变化）
    let maxDrop = 0;
    let inflectionBin = filtered[Math.floor(filtered.length / 2)]!.binCenter;

    for (let i = 1; i < filtered.length; i++) {
      const drop = filtered[i - 1]!.successRate - filtered[i]!.successRate;
      if (drop > maxDrop) {
        maxDrop = drop;
        inflectionBin = filtered[i]!.binCenter;
      }
    }

    // 3. 若最大下降 < 0.05，认为无明显拐点，返回中点
    if (maxDrop < 0.05) {
      return (minRange + maxRange) / 2;
    }

    return inflectionBin;
  }
}
```

#### 3.3.2 自适应阈值算法

采用**简单贝叶斯优化**（无需引入复杂 ML 库）：

```typescript
// packages/agent/src/context-monitor-adaptive.ts

interface AdaptiveThresholdConfig {
  // 探索-利用平衡
  explorationRate: number; // 默认 0.1 — 10% 的 session 使用探索性阈值

  // 滑动窗口
  lookbackDays: number; // 默认 14
  minSamplesPerZone: number; // 默认 20 — 低于此样本量回退到默认阈值

  // 质量指标权重（可调）
  weights: {
    successRate: number; // 默认 0.4
    toolErrorRate: number; // 默认 0.3（负向）
    formatFailureRate: number; // 默认 0.2（负向）
    stepEfficiency: number; // 默认 0.1（目标步数/实际步数）
  };
}

class AdaptiveContextMonitor extends ContextMonitor {
  private adaptiveConfig: AdaptiveThresholdConfig;
  private metricsRepo: SessionMetricsRepository;

  /** 每 24h 或在 session 启动时重新计算阈值 */
  async recalibrate(model: string, role: string): Promise<ContextWindowConfig> {
    const perf = this.metricsRepo.getZonePerformance({
      model,
      role,
      timeWindowDays: this.adaptiveConfig.lookbackDays,
    });

    if (perf.length < this.adaptiveConfig.minSamplesPerZone * 4) {
      // 样本不足 — 回退到默认值
      return DEFAULT_WINDOW_CONFIG;
    }

    // 寻找最优分界点：使每个 zone 内的质量指标最大化
    // 简化为：找到 utilization 区间，使 successRate 下降最陡的点
    const distribution = this.metricsRepo.getPeakUtilizationDistribution(
      model,
      this.adaptiveConfig.lookbackDays,
    );

    const smartWarningBoundary = this.findInflectionPoint(distribution, 0.35, 0.55);
    const warningCriticalBoundary = this.findInflectionPoint(distribution, 0.55, 0.75);
    const criticalDumbBoundary = this.findInflectionPoint(distribution, 0.75, 0.9);

    return {
      maxTokens: MODEL_CONTEXT_SIZES[model] ?? DEFAULT_WINDOW_CONFIG.maxTokens,
      smartZoneThreshold: smartWarningBoundary,
      warningThreshold: warningCriticalBoundary,
      criticalThreshold: criticalDumbBoundary,
    };
  }

  /** 找到 successRate 显著下降的 utilization 点 */
  private findInflectionPoint(
    distribution: { utilizationBin: string; count: number; successRate: number }[],
    minRange: number,
    maxRange: number,
  ): number {
    // 实现：在 distribution 中搜索 successRate 二阶导数最大的点
    // 若数据不足，回退到线性插值默认值
    // ...
  }
}
```

#### 3.3.3 探索-利用机制

```
每个新 session:
  ├─ 90% 概率: 使用当前最优阈值（利用）
  └─ 10% 概率: 使用随机偏移阈值（探索，±10% 范围）
        → 记录该 session 的质量指标
        → 若探索阈值表现优于当前最优 → 更新最优阈值
```

#### 3.3.4 与现有 ObserverPipeline 集成

```typescript
// packages/agent/src/observers/context-monitor.ts 改造

export class ContextMonitorObserver implements AgentObserver {
  name = 'ContextMonitor';
  private monitor: ContextMonitor | AdaptiveContextMonitor;

  constructor(
    eventBus: EventBus,
    config: {
      adaptive?: boolean;
      metricsRepo?: SessionMetricsRepository;
      model: string;
      role: string;
    },
  ) {
    if (config.adaptive && config.metricsRepo) {
      this.monitor = new AdaptiveContextMonitor(eventBus, config.metricsRepo, {}, config.model);
      // 异步校准阈值
      this.monitor.recalibrate(config.model, config.role).catch(() => {});
    } else {
      this.monitor = ContextMonitor.forModel(config.model, eventBus);
    }
  }
  // ... onStepEnd 保持不变
}
```

### 3.4 实施步骤

| 步骤  | 任务                                                               | 文件                                                            | 工时 | 验收标准                                                                |
| ----- | ------------------------------------------------------------------ | --------------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| 4.1.1 | 实现 `AdaptiveContextMonitor` 核心算法（含 `findInflectionPoint`） | `packages/agent/src/context-monitor-adaptive.ts`                | 10h  | 通过模拟数据测试：能识别已知的 inflection point；无明显拐点时回退到中点 |
| 4.1.2 | 实现探索-利用调度器                                                | `packages/agent/src/context-monitor-adaptive.ts`                | 4h   | 10% 探索概率在 1000 次调用中均匀分布；hard limit 不被突破               |
| 4.1.3 | 改造 `ContextMonitorObserver` 支持自适应模式                       | `packages/agent/src/observers/context-monitor.ts`               | 4h   | 配置 `adaptive: false` 时行为与当前完全一致（向后兼容）                 |
| 4.1.4 | 在 `agent-factory.ts` 中接入（默认关闭）                           | `apps/server/src/agent-factory.ts`                              | 2h   | 通过配置项控制，不破坏现有 session 创建流程                             |
| 4.1.5 | 集成测试：端到端验证自适应阈值生效                                 | `packages/agent/src/__tests__/context-monitor-adaptive.test.ts` | 8h   | mock metrics repo → 验证阈值随数据变化；探索-利用比例正确               |

**合计**: ~28 小时（~4 个工作日）

### 3.5 风险与回滚

| 风险                               | 缓解措施                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| 探索性阈值导致 session 质量下降    | 探索仅偏移 ±10%，且不会越过 hard limit（smart 最低 0.3，critical 最高 0.9） |
| 样本不足导致阈值震荡               | `minSamplesPerZone` 门槛 + 滑动平均平滑（ema α=0.3）                        |
| 计算 inflection point 的算法不稳定 | 保留默认阈值作为 fallback，算法异常时自动回退                               |
| 数据隐私（metrics 含项目信息）     | metrics 中 `projectId` 已存在，不加新项目敏感字段                           |

**回滚**: 将 `adaptive: false`（默认）即可立即恢复静态阈值，无需代码回滚。

---

## 四、子项 4.3: ProcessIdentityScore (PIS)

### 4.1 现状与问题

当前系统缺乏对**长时运行工作流连贯性**的量化度量。一个工作流执行 50 步后是否还在解决最初的问题？Agent 是否" drift "到了无关任务？没有客观指标。

评估报告指出的问题："ProcessIdentityScore 是全新概念，方案中仅给出四个因子，未给出具体计算公式和阈值设定方法"。

### 4.2 目标

定义并实现对**长时间运行工作流的过程连贯性评分 (ProcessIdentityScore, PIS)**，使系统能检测并干预"任务漂移"。

### 4.3 技术方案

#### 4.3.1 PIS 定义

PIS ∈ [0, 1]，衡量工作流在执行过程中保持"原始意图"的程度。

```typescript
// packages/agent/src/process-identity-score.ts

interface PISFactor {
  name: string;
  weight: number;
  score: number; // 0–1
}

interface ProcessIdentityScore {
  total: number; // 加权总分
  factors: PISFactor[]; // 各因子明细
  trend: 'improving' | 'stable' | 'drifting' | 'lost';
  recommendedAction: 'continue' | 'compact' | 'handoff' | 'abort';
}
```

#### 4.3.2 四大核心因子（含具体算法）

| 因子                  | 计算方式                                             | 权重 | 说明                                                                |
| --------------------- | ---------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| **Intent Alignment**  | 原始任务描述 vs 最近 3 步 tool_call 目标的语义相似度 | 0.35 | **Phase 1: keyword overlap（Jaccard）**；Phase 2: embedding cosine  |
| **Tool Coherence**    | 工具调用序列的熵 — 频繁切换不相关工具 = 低分         | 0.25 | `1 - (uniqueToolsInWindow / totalCallsInWindow)`，窗口 = 最近 10 步 |
| **Goal Progress**     | 已完成子目标 / 总识别子目标                          | 0.25 | 从 tool result 中检测 `milestone_complete` / `subtask_done` 标记    |
| **Context Stability** | `1 - (zoneCrossingCount / max(stepCount, 1))`        | 0.15 | 频繁在 zone 间震荡 = 低分                                           |

**具体算法**:

```typescript
// ── Intent Alignment（Phase 1: Keyword Jaccard）──
function calculateIntentAlignment(originalTask: string, recentToolCalls: ToolCallRecord[]): number {
  // 1. 提取原始任务的关键词（简单分词 + 去停用词）
  const taskWords = extractKeywords(originalTask);
  if (taskWords.length === 0) return 0.5;

  // 2. 提取最近 tool calls 的目标描述（从 tool_name + args 中拼接）
  const toolWords = recentToolCalls.flatMap((tc) =>
    extractKeywords(tc.name + ' ' + JSON.stringify(tc.args)),
  );
  if (toolWords.length === 0) return 0.5;

  // 3. Jaccard similarity
  const intersection = new Set(taskWords.filter((w) => toolWords.includes(w)));
  const union = new Set([...taskWords, ...toolWords]);
  const jaccard = intersection.size / Math.max(union.size, 1);

  // 4. 引入方向性惩罚：若 toolWords 包含明显偏离的任务关键词（如 "test" 任务出现 "deploy"），降低分数
  const deviationPenalty = calculateDeviationPenalty(taskWords, toolWords);

  return Math.max(0, Math.min(1, jaccard * (1 - deviationPenalty)));
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    'the',
    'a',
    'an',
    'to',
    'of',
    'in',
    'and',
    'for',
    'is',
    'it',
    'this',
    'that',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));
}

function calculateDeviationPenalty(taskWords: string[], toolWords: string[]): number {
  // 若 toolWords 中有高频词完全不在 taskWords 中 → 可能偏离
  const toolFreq = frequencyMap(toolWords);
  let penalty = 0;
  for (const [word, freq] of toolFreq) {
    if (!taskWords.includes(word) && freq >= 2) {
      penalty += 0.05; // 每个高频偏离词 +5% 惩罚
    }
  }
  return Math.min(penalty, 0.5); // 封顶 50%
}

// ── Tool Coherence ──
function calculateToolCoherence(toolCalls: ToolCallRecord[]): number {
  if (toolCalls.length === 0) return 1;
  const uniqueTools = new Set(toolCalls.map((tc) => tc.name)).size;
  const total = toolCalls.length;
  // 若只用 1 种工具 → 1.0；若 10 步用了 10 种不同工具 → 0.0
  return Math.max(0, 1 - uniqueTools / Math.max(total, 1));
}

// ── Goal Progress ──
function calculateGoalProgress(ctx: AgentExecutionContext): number {
  // 从 tool result 中扫描 milestone 完成标记
  const completedMilestones = ctx.toolCallHistory.filter((tc) => {
    const resultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
    return /\b(milestone_complete|subtask_done|goal_achieved)\b/i.test(resultStr);
  }).length;

  // 从 system prompt 或原始任务中提取总子目标数（启发式：按句子数估算）
  const estimatedTotalGoals = Math.max(1, ctx.systemPrompt.split(/[.!?]/).length / 3);

  return Math.min(1, completedMilestones / estimatedTotalGoals);
}

// ── Context Stability ──
function calculateContextStability(ctx: AgentExecutionContext): number {
  if (ctx.stepCount === 0) return 1;
  return Math.max(0, 1 - ctx.zoneCrossings.length / ctx.stepCount);
}

// ── Trend Classification ──
function classifyTrend(
  pisHistory: { step: number; score: number }[],
): ProcessIdentityScore['trend'] {
  if (pisHistory.length < 4) return 'stable';
  const recent = pisHistory.slice(-4);
  const first = recent[0]!.score;
  const last = recent[recent.length - 1]!.score;
  const delta = last - first;

  if (delta > 0.15) return 'improving';
  if (delta < -0.25) return 'lost';
  if (delta < -0.1) return 'drifting';
  return 'stable';
}

// ── Main Entry ──
function calculatePIS(ctx: AgentExecutionContext, originalTask: string): ProcessIdentityScore {
  const factors: PISFactor[] = [
    {
      name: 'intentAlignment',
      weight: 0.35,
      score: calculateIntentAlignment(originalTask, ctx.toolCallHistory.slice(-3)),
    },
    {
      name: 'toolCoherence',
      weight: 0.25,
      score: calculateToolCoherence(ctx.toolCallHistory.slice(-10)),
    },
    {
      name: 'goalProgress',
      weight: 0.25,
      score: calculateGoalProgress(ctx),
    },
    {
      name: 'contextStability',
      weight: 0.15,
      score: calculateContextStability(ctx),
    },
  ];

  const total = factors.reduce((sum, f) => sum + f.score * f.weight, 0);

  return {
    total: Math.round(total * 1000) / 1000,
    factors,
    trend: classifyTrend(ctx.pisHistory ?? []),
    recommendedAction: recommendAction(total, ctx.stepCount),
  };
}

function recommendAction(
  score: number,
  stepCount: number,
): ProcessIdentityScore['recommendedAction'] {
  if (stepCount < 5) return 'continue'; // 样本不足
  if (score > 0.7) return 'continue';
  if (score > 0.5) return 'compact'; // context 压缩可能恢复 focus
  if (score > 0.3) return 'handoff'; // 需要交接给新 agent
  return 'abort'; // 已严重漂移，建议终止
}
```

#### 4.3.3 Intent Alignment 的两阶段路线

| 阶段                                   | 实现                                | 质量                   | 成本                              |
| -------------------------------------- | ----------------------------------- | ---------------------- | --------------------------------- |
| **Phase 1**（4.3 完成时）              | Keyword Jaccard + deviation penalty | 中等（能检测明显偏离） | 零 LLM 成本                       |
| **Phase 2**（EmbeddingService 建成后） | Embedding cosine similarity         | 高（语义级匹配）       | 每 evaluation 1 次 embedding 调用 |

> **决策**: 4.3 验收时仅以 Phase 1（keyword）为准。Phase 2 作为后续 enhancement，独立排期。

#### 4.3.4 与 4.0 数据共享

PIS 计算依赖 4.0 建立的 `step_events` 数据：

```typescript
// 4.0 中已提供
getToolSequence(sessionId: string): { step: number; tool: string; args: string; success: boolean }[];
getZoneCrossings(sessionId: string): { step: number; from: string; to: string; at: string }[];
getUtilizationSeries(sessionId: string): { step: number; utilization: number; zone: string }[];
```

#### 4.3.5 Observer 集成

```typescript
// packages/agent/src/observers/process-identity-observer.ts

export class ProcessIdentityObserver implements AgentObserver {
  name = 'ProcessIdentity';
  private originalTask: string;
  private pisHistory: { step: number; score: number }[] = [];

  constructor(
    private readonly eventBus: EventBus,
    originalTask: string,
  ) {
    this.originalTask = originalTask;
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<{ handoff?: boolean } | void> {
    // 仅在 evaluationIntervalSteps 的倍数步计算（默认每 3 步）
    if (ctx.stepCount < 3 || ctx.stepCount % (ctx.config?.pisEvaluationInterval ?? 3) !== 0) return;

    const pis = calculatePIS(ctx, this.originalTask);
    this.pisHistory.push({ step: ctx.stepCount, score: pis.total });
    ctx.pisHistory = this.pisHistory;

    // 若推荐 handoff/abort，触发 event（仅在 intervene 模式下）
    if (
      (pis.recommendedAction === 'handoff' || pis.recommendedAction === 'abort') &&
      ctx.config?.pisMode === 'intervene'
    ) {
      this.eventBus
        .publish({
          messageId: `pis_alert_${ctx.sessionId}_${ctx.stepCount}`,
          correlationId: ctx.sessionId,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: {
            type: 'process_identity_alert',
            data: {
              sessionId: ctx.sessionId,
              score: pis.total,
              trend: pis.trend,
              action: pis.recommendedAction,
            },
          },
        })
        .catch(() => {});
    }

    ctx.lastPIS = pis;
  }
}
```

### 4.4 实施步骤

| 步骤  | 任务                                                   | 文件                                                        | 工时 | 验收标准                                        |
| ----- | ------------------------------------------------------ | ----------------------------------------------------------- | ---- | ----------------------------------------------- |
| 4.3.1 | 定义 PIS 类型和核心计算函数（含 keyword Jaccard 算法） | `packages/agent/src/process-identity-score.ts`              | 8h   | 通过 10 组手工构造的 context 数据，评分符合直觉 |
| 4.3.2 | 实现 Tool Coherence、Goal Progress、Context Stability  | `packages/agent/src/process-identity-score.ts`              | 6h   | 工具熵计算正确；milestone 标记检测覆盖现有格式  |
| 4.3.3 | 实现 Trend Classification 和 recommendAction           | `packages/agent/src/process-identity-score.ts`              | 4h   | 趋势判断与手工标注一致率 ≥70%                   |
| 4.3.4 | 实现 `ProcessIdentityObserver`                         | `packages/agent/src/observers/process-identity-observer.ts` | 4h   | onStepEnd 不抛异常；event 正确发布              |
| 4.3.5 | 在 `ObserverPipeline` 中注册（默认关闭，配置控制）     | `packages/agent/src/agent-loop.ts` 或配置层                 | 2h   | 不启用时零开销                                  |
| 4.3.6 | Dashboard 展示 PIS（可选，可延后）                     | `apps/server/src/routes/dashboard.ts` + frontend            | 4h   | dashboard summary 新增 "Process Health" 卡片    |

**合计**: ~28 小时（~3.5 个工作日）

### 4.5 风险与回滚

| 风险                                            | 缓解措施                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| PIS 算法不准确，产生大量误报                    | 默认 `log_only` 模式运行 2 周，评估准确率后再切 `intervene`                                       |
| Intent Alignment keyword 方法质量不足           | Phase 1 已明确仅做中等质量检测；明显偏离场景（工具完全无关）可检测                                |
| 与 HandoffObserver 的决策冲突                   | PIS `recommendedAction` 优先级低于 HandoffObserver；PIS 仅作辅助输入                              |
| Goal Progress 的 milestone 标记依赖工具输出格式 | 支持多种标记格式（`milestone_complete`、`subtask_done`、`goal_achieved`）；无标记时 neutral (0.5) |

**回滚**: 从 `ObserverPipeline` 中移除 `ProcessIdentityObserver`，或设置 `processIdentity: { enabled: false }`。

---

## 五、子项 4.2: Agent Blackboard 实时通信

### 5.1 现状与问题

当前 Agent 间通信只有 **handoff 文档**一种模式：

- Agent A 完成后生成结构化 handoff 文档 → 传递给 Agent B
- 没有实时、双向、多对多的通信机制
- 多个 agent 同时处理同一项目时，信息不同步

### 5.2 目标

建立**Agent Blackboard** — 共享的实时数据面，支持多 agent 同时读写、事件驱动更新。

### 5.3 技术方案

#### 5.3.1 架构设计

复用现有的 `EventBus`（`packages/events/src/bus.ts`），在其上构建 Blackboard 语义层：

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Blackboard                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Topic:      │  │ Topic:      │  │ Topic:              │  │
│  │ discoveries │  │ decisions   │  │ shared_context      │  │
│  │ (append)    │  │ (append)    │  │ (CRDT merge)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ TopicRouter: 将 topic 名称 → EventBus messageType       ││
│  │   统一使用 SystemNotification，payload.topic 路由       ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 底层: EventBus (pub/sub + replay + causation chain)     ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

#### 5.3.2 EventBus → Blackboard Topic 适配层

现有 `EventBus` 的 `subscribe` 基于 `MessageType` 枚举，不支持任意 topic 字符串：

```typescript
// 现有 EventBus 接口
subscribe(messageType: MessageType, handler: MessageHandler, name?: string): void;
// MessageType = 'decision_request' | 'task_order' | ... | 'system_notification'
```

**适配方案 — TopicRouter**：

```typescript
// packages/agent/src/blackboard-topic-router.ts

class BlackboardTopicRouter {
  private topicHandlers = new Map<string, Set<MessageHandler>>();

  constructor(private readonly eventBus: EventBus) {
    // 订阅一个统一的 SystemNotification，内部按 payload.topic 分发
    this.eventBus.subscribe(MessageType.SystemNotification, (envelope) => {
      const payload = envelope.payload as unknown as Record<string, unknown> | undefined;
      const topic = payload?.topic as string | undefined;
      if (!topic) return;

      const handlers = this.topicHandlers.get(topic);
      if (handlers) {
        for (const handler of handlers) {
          handler(envelope).catch((err) => console.error(`Topic handler error for ${topic}:`, err));
        }
      }
    });
  }

  subscribeTopic(topic: string, handler: MessageHandler): () => void {
    let set = this.topicHandlers.get(topic);
    if (!set) {
      set = new Set();
      this.topicHandlers.set(topic, set);
    }
    set.add(handler);

    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.topicHandlers.delete(topic);
    };
  }

  async publishTopic(topic: string, payload: Record<string, unknown>): Promise<void> {
    await this.eventBus.publish({
      messageId: `bb_${topic}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      correlationId: `bb_${topic}`,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: { type: 'blackboard_update', topic, data: payload },
    });
  }
}
```

> **设计理由**: 不修改 EventBus 接口（保持底层稳定），在 Blackboard 层内聚 topic 路由逻辑。`SystemNotification` 是现有的通用事件类型，payload 中的 `topic` 字段实现二次路由。

#### 5.3.3 核心抽象

```typescript
// packages/agent/src/blackboard.ts

interface BlackboardTopic<T> {
  name: string;
  mergeStrategy: 'append' | 'replace' | 'crdt';
  schema: z.ZodSchema<T>; // 运行时验证
  ttlMs?: number; // 可选过期
  maxEntries?: number; // 可选容量限制
}

interface BlackboardEntry<T> {
  id: string; // UUID
  topic: string;
  agentId: string; // 写入者
  timestamp: Date;
  payload: T;
  causationId: string | null; // 因果链
}

class AgentBlackboard {
  private topics = new Map<string, BlackboardTopic<unknown>>();
  private entries = new Map<string, BlackboardEntry<unknown>[]>(); // topic -> entries
  private router: BlackboardTopicRouter;

  constructor(private readonly eventBus: EventBus) {
    this.router = new BlackboardTopicRouter(eventBus);
  }

  /** 注册 topic（在系统启动时） */
  registerTopic<T>(topic: BlackboardTopic<T>): void;

  /** Agent 写入条目 */
  async write<T>(topicName: string, payload: T, agentId: string): Promise<BlackboardEntry<T>>;

  /** Agent 读取 topic 当前状态 */
  read<T>(topicName: string): BlackboardEntry<T>[];

  /** Agent 订阅 topic 实时更新 */
  subscribe<T>(topicName: string, handler: (entry: BlackboardEntry<T>) => void): () => void {
    return this.router.subscribeTopic(topicName, (envelope) => {
      const payload = (envelope.payload as unknown as Record<string, unknown>)?.data as T;
      if (payload !== undefined) {
        handler({
          id: envelope.messageId,
          topic: topicName,
          agentId: 'unknown', // 从 payload 中提取或简化
          timestamp: envelope.timestamp,
          payload,
          causationId: envelope.causationId,
        });
      }
    });
  }

  /** 生成当前 blackboard 的 snapshot（用于注入 system prompt） */
  snapshot(topics?: string[]): string;
}
```

#### 5.3.4 与现有 Context Slot 的关系

当前 `ContextSlot`（定义在 `types/src/primitives.ts:300`）的实际结构：

```typescript
// 实际 ContextSlot（非计划中原先错误描述的版本）
interface ContextSlot {
  project: {
    name: string;
    tech_stack?: string;
    goals: string[];
    constraints?: Record<string, unknown>;
  };
  memories: string[];
  preferences: {
    riskTolerance?: 'low' | 'medium' | 'high';
    preferredDecisionStyle?: 'consensus' | 'directive' | 'analytical';
    [key: string]: unknown;
  };
  files: string[];
  discoveries: Array<{ type: string; summary: string; [key: string]: unknown }>;
  previous_outputs: string[];
  deliverable?: unknown;
  security: {
    level: string;
    tier?: string;
    maxRetries: number;
  };
}
```

**迁移策略**:

1. Blackboard 引入 7 个内置 topic 对应现有 ContextSlot 字段：
   | ContextSlot 字段 | Blackboard Topic | Merge Strategy | 说明 |
   |------------------|------------------|----------------|------|
   | `discoveries` | `discoveries` | `append` | 新发现追加 |
   | `memories` | `memories` | `append` | 记忆追加 |
   | `files` | `files` | `replace` | 文件列表替换 |
   | `previous_outputs` | `outputs` | `append` | 输出历史 |
   | `project` | `project` | `replace` | 项目信息整体替换 |
   | `preferences` | `preferences` | `crdt` | 偏好合并（last-write-wins per key） |
   | `security` | `security` | `replace` | 安全策略替换 |
2. `deliverable` 不放入 Blackboard — 它是 session 终态产物，非共享状态
3. SessionManager 内部使用 Blackboard 替代直接操作 `ContextSlot`
4. 保留 `ContextSlot` 类型定义作为兼容层，标记 `@deprecated`

#### 5.3.5 Snapshot 注入 System Prompt

评估报告的风险提醒："snapshot() 注入 system prompt 的实现需要谨慎处理 token 预算"。

解决方案 — **分层注入 + token 预算控制**：

```typescript
function injectBlackboardSnapshot(
  blackboard: AgentBlackboard,
  systemPrompt: string,
  budgetTokens: number, // 默认 2000 tokens
): string {
  const snapshot = blackboard.snapshot();
  const estimated = estimateTokens(snapshot);

  if (estimated <= budgetTokens) {
    return systemPrompt + '\n\n[Shared Context]\n' + snapshot;
  }

  // 超出预算 — 压缩
  const compressed = compressSnapshot(snapshot, budgetTokens);
  return systemPrompt + '\n\n[Shared Context (compressed)]\n' + compressed;
}

function compressSnapshot(snapshot: string, budget: number): string {
  // 策略 1: 只保留最近 N 条（按时间）—— 计算保留条数使 token ≤ budget 的 80%
  // 策略 2: 只保留高重要性条目（discoveries 按 type 优先级过滤）
  // 策略 3: 截断长文本（每条 summary 最多 200 字符）
  // 策略 4: 使用 LLM 摘要（最后手段，有成本，需配置开启）
  // 默认策略 1+2+3 的组合
}
```

### 5.4 实施步骤

| 步骤  | 任务                                            | 文件                                              | 工时 | 验收标准                                                            |
| ----- | ----------------------------------------------- | ------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| 5.4.1 | 定义 Blackboard 核心类型和接口                  | `packages/types/src/blackboard.ts`                | 4h   | 通过类型编译，schema 验证可用                                       |
| 5.4.2 | 实现 `BlackboardTopicRouter`（EventBus 适配层） | `packages/agent/src/blackboard-topic-router.ts`   | 6h   | 单元测试：topic A 的订阅者不收到 topic B 的消息                     |
| 5.4.3 | 实现 `AgentBlackboard` 类                       | `packages/agent/src/blackboard.ts`                | 10h  | 单元测试覆盖 write/read/subscribe/snapshot；7 个内置 topic 注册正确 |
| 5.4.4 | 实现 snapshot 压缩策略                          | `packages/agent/src/blackboard-compress.ts`       | 6h   | 给定 5000 token snapshot + 2000 budget → 压缩后 ≤2000 tokens        |
| 5.4.5 | 将现有 ContextSlot 迁移到 Blackboard            | `packages/secretary/src/session-manager.ts`       | 6h   | 所有现有 ContextSlot 操作通过 Blackboard 代理；行为不变             |
| 5.4.6 | 在 AgentLoop 中注入 Blackboard snapshot         | `packages/agent/src/agent-loop.ts`                | 4h   | ContextBuilder 阶段包含 [Shared Context] 节                         |
| 5.4.7 | 端到端测试：多 agent 读写同一 topic             | `packages/agent/src/__tests__/blackboard.test.ts` | 6h   | 两个 AgentLoop 实例通过 Blackboard 共享 discoveries                 |

**合计**: ~42 小时（~5.5 个工作日）

### 5.5 风险与回滚

| 风险                                                                     | 缓解措施                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Snapshot 注入导致 system prompt 膨胀                                     | 强制 budget 控制；超出时拒绝写入新条目（backpressure）                           |
| 多 agent 并发写入冲突                                                    | `append` topic 天然无冲突；`replace` topic 使用 last-write-wins；未来可升级 CRDT |
| Blackboard 内存无限增长                                                  | 每个 topic 配置 `maxEntries` + `ttlMs`；自动清理                                 |
| 与现有 handoff 机制冲突                                                  | Blackboard 是 handoff 的**增强**而非替代；handoff 文档仍用于跨 session 持久化    |
| TopicRouter 误将非 Blackboard 的 SystemNotification 路由到 topic handler | payload 中强制包含 `type: 'blackboard_update'` 过滤；非 Blackboard 事件被忽略    |

**回滚**: 在 `ContextBuilder` 中跳过 Blackboard snapshot 注入，恢复原有 ContextSlot 注入逻辑。

---

## 六、子项 4.4: MCP 完整协议支持

### 6.1 现状与问题

当前 MCP Manager 仅支持：

- `stdio` transport
- `tools` 发现与调用

缺失：

- `resources`（文件内容、数据库查询结果等结构化数据）
- `prompts`（预设对话模板）
- `sse` / HTTP transport（无法连接远程 MCP 服务）
- 工具动态更新（连接时一次性 listTools，运行时不再更新）

### 6.2 目标

完整实现 MCP 协议 2024-11-05 规范的 **resources + prompts + SSE transport**。

### 6.3 技术方案

#### 6.3.1 SSE Transport

```typescript
// apps/server/src/mcp/mcp-transport.ts

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

interface MCPTransportConfig {
  type: 'stdio' | 'sse';
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse
  url?: string;
  headers?: Record<string, string>;
}

function createTransport(config: MCPTransportConfig): StdioClientTransport | SSEClientTransport {
  if (config.type === 'sse') {
    return new SSEClientTransport(new URL(config.url!));
  }
  return new StdioClientTransport({
    command: config.command!,
    args: config.args ?? [],
    env: config.env,
  } as any);
}
```

#### 6.3.2 Resources 支持

```typescript
// apps/server/src/mcp/mcp-manager.ts 扩展

interface MCPResource {
  serverName: string;
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

class MCPManager {
  private resources = new Map<string, MCPResource>();

  async connectServer(config: MCPServerConfig): Promise<void> {
    // ... 现有 tool 发现代码 ...

    // 新增: resources 发现
    try {
      const { resources } = await client.listResources();
      for (const res of resources) {
        this.resources.set(`mcp_res__${res.uri}`, {
          serverName: config.name,
          uri: res.uri,
          name: res.name,
          mimeType: res.mimeType,
          description: res.description,
        });
      }
    } catch {
      // server 不支持 resources — 忽略
    }

    // 新增: prompts 发现
    try {
      const { prompts } = await client.listPrompts();
      for (const prompt of prompts) {
        this.prompts.set(`mcp_prompt__${prompt.name}`, {
          serverName: config.name,
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments,
        });
      }
    } catch {
      // server 不支持 prompts — 忽略
    }
  }

  /** 读取 resource 内容 */
  async readResource(uri: string): Promise<{ contents: unknown[] }> {
    const res = this.resources.get(uri);
    if (!res) throw new Error(`Resource not found: ${uri}`);
    const client = this.clients.get(res.serverName);
    if (!client) throw new Error(`Server not connected: ${res.serverName}`);
    return client.readResource({ uri: res.uri });
  }

  /** 获取 prompt 模板 */
  async getPrompt(name: string, args?: Record<string, string>): Promise<{ messages: unknown[] }> {
    const prompt = this.prompts.get(name);
    if (!prompt) throw new Error(`Prompt not found: ${name}`);
    const client = this.clients.get(prompt.serverName);
    if (!client) throw new Error(`Server not connected: ${prompt.serverName}`);
    return client.getPrompt({ name: prompt.name, arguments: args });
  }
}
```

#### 6.3.3 动态工具更新

```typescript
// 新增定时轮询 + server 推送支持
class MCPManager {
  private discoveryTimers = new Map<string, ReturnType<typeof setInterval>>();

  async connectServer(config: MCPServerConfig): Promise<void> {
    // ... 现有代码 ...

    // 每 5 分钟重新发现 tools/resources/prompts
    const timer = setInterval(
      async () => {
        await this.rediscover(config.name);
      },
      5 * 60 * 1000,
    );
    this.discoveryTimers.set(config.name, timer);
  }

  private async rediscover(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) return;

    const oldTools = new Set(this.tools.keys());
    const { tools } = await client.listTools();
    const newTools = new Set(tools.map((t) => `mcp__${t.name}`));

    // 注销已删除的 tool
    for (const key of oldTools) {
      if (!newTools.has(key) && this.tools.get(key)?.serverName === serverName) {
        this.tools.delete(key);
      }
    }

    // 注册新 tool
    for (const tool of tools) {
      const key = `mcp__${tool.name}`;
      if (!this.tools.has(key)) {
        this.tools.set(key, {
          serverName,
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
    }

    // 同逻辑处理 resources / prompts ...
  }
}
```

#### 6.3.4 与 AgentLoop 的集成

Resources 和 Prompts 不直接暴露为 tools，而是通过以下方式集成：

```
AgentLoop ContextBuilder:
  ├─ 现有: tools → LLM tool definitions
  ├─ 新增: mcpResources → 注入 system prompt 的 [Available Resources] 节
  │       (类似 skill 的 L1/L2 分层 — 只注入 URI + description，不注入内容)
  └─ 新增: mcpPrompts → 作为 skill 的替代/补充注入

当 LLM 输出包含 "请读取 resource://xxx" 时:
  → ToolExecutor 识别为 MCP resource 读取
  → 调用 MCPManager.readResource()
  → 内容注入到 messages 中
```

### 6.4 实施步骤

| 步骤  | 任务                                        | 文件                                                 | 工时 | 验收标准                                                                    |
| ----- | ------------------------------------------- | ---------------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| 4.4.1 | 抽象 Transport 层（stdio + sse）            | `apps/server/src/mcp/mcp-transport.ts`               | 4h   | 两种 transport 可互换，connect/disconnect 正常                              |
| 4.4.2 | 扩展 MCPManager 支持 resources/prompts 发现 | `apps/server/src/mcp/mcp-manager.ts`                 | 6h   | 连接支持 resources 的 MCP server（如 filesystem）后，listResources 返回非空 |
| 4.4.3 | 实现动态重新发现                            | `apps/server/src/mcp/mcp-manager.ts`                 | 4h   | 模拟 MCP server 新增 tool，5 分钟内 Cabinet 感知并可用                      |
| 4.4.4 | 集成 resources/prompts 到 ContextBuilder    | `packages/agent/src/context-builder.ts` 或 server 层 | 6h   | AgentLoop system prompt 包含 [Available MCP Resources] 节                   |
| 4.4.5 | Dashboard 展示 MCP server 状态              | `apps/server/src/routes/dashboard.ts`                | 4h   | dashboard summary 显示已连接 MCP servers 数 + resources 数                  |
| 4.4.6 | 端到端测试（使用 mock MCP server）          | `apps/server/src/mcp/__tests__/mcp-manager.test.ts`  | 6h   | mock server 提供 tools + resources + prompts，全部正确发现与调用            |

**合计**: ~30 小时（~4 个工作日）

### 6.5 风险与回滚

| 风险                                                 | 缓解措施                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| SSE transport 引入网络依赖（原来只有本地 stdio）     | SSE transport 默认不启用；需要显式配置；增加 URL 白名单校验                       |
| resources 内容过大导致 context 膨胀                  | resource 只注入 metadata（URI/description），不注入内容；内容按需读取             |
| prompts 与现有 skill 系统冲突                        | prompts 作为 skill 的补充而非替代；命名空间隔离 (`mcp_prompt__` vs `use_skill__`) |
| `@modelcontextprotocol/sdk` 版本升级 breaking change | 锁定 SDK 版本；升级时集中测试                                                     |

**回滚**: 从 `MCPServerConfig` 中移除 SSE 配置；在 `ContextBuilder` 中跳过 MCP resources/prompts 注入。

---

## 六、工程管理与质量标准

### 6.1 分支策略

```
main (稳定)
  └── feat/phase-4-data-infra          ← 4.0（阻塞性前置，最先合并）
  └── feat/phase-4-adaptive-monitor    ← 4.1 + 4.3（依赖 4.0）
  └── feat/phase-4-blackboard          ← 4.2（可与 4.0 并行）
  └── feat/phase-4-mcp-full            ← 4.4（可与 4.0 并行）
```

- 4.0 必须最先合并到 main，作为 4.1/4.3 的数据基础
- 4.2/4.4 可与 4.0 并行开发，但合入 main 时若 4.0 已存在则做集成验证
- 每个子项独立分支，独立 PR 合并
- 合并前必须通过：`pnpm typecheck` + `pnpm test` + `pnpm lint:arch`

### 6.2 测试要求

| 层级     | 要求                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 单元测试 | 每个新增类/函数必须有 ≥80% 分支覆盖                                              |
| 集成测试 | Observer 与 AgentLoop 的集成必须通过                                             |
| 表征测试 | 4.1 改造后，AgentLoop 的 `run()` 输出行为与改造前一致（使用 Phase 0 建立的基线） |
| 性能测试 | 4.1 的 adaptive 阈值计算延迟 < 50ms（异步，不阻塞 session 启动）                 |
| 数据测试 | 4.0 的 step_events 写入不使 AgentLoop 延迟增加 > 2%                              |

### 6.3 文档更新

| 文档                         | 更新内容                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| `CABINET.md`                 | 新增配置项说明（stepEvents, adaptive threshold, PIS, blackboard） |
| `packages/agent/README.md`   | ObserverPipeline 扩展说明（含 StepEventObserver）                 |
| `docs/external-agent-api.md` | MCP 完整协议支持说明（如适用）                                    |

### 6.4 数据基线（启动前必须测量）

在启动阶段四之前，记录以下基线：

| 指标                 | 测量方法                        | 目标                         |
| -------------------- | ------------------------------- | ---------------------------- |
| Session 平均步数     | `SessionMetricsRepository` 查询 | 不劣化（±5%）                |
| Context handoff 频率 | zoneCrossings 统计              | 不劣化                       |
| 平均 session 成本    | `totalCost` 聚合                | 不劣化                       |
| AgentLoop run() 延迟 | 端到端计时                      | 增加 < 5%（因新增 observer） |
| MCP tool 调用成功率  | `toolCalls.succeeded / total`   | 不劣化                       |

---

## 七、工时汇总与排期（修订版）

> **关键修正**: 原方案 ~134h 被评审指出存在乐观偏见。修订后上浮 ~38%，反映数据基础设施新建、TopicRouter 适配层、算法细化等实际工作量。

| 子项                              | 修订工时  | 原工时    | 日历天数            | 备注                                           |
| --------------------------------- | --------- | --------- | ------------------- | ---------------------------------------------- |
| **4.0** 数据基础设施              | ~26h      | —         | 3.5d                | **新增阻塞性子项**；4.1/4.3 依赖               |
| **4.1** ContextMonitor 自适应阈值 | ~28h      | ~28h      | 4d                  | 算法细化后工时持平                             |
| **4.3** ProcessIdentityScore      | ~28h      | ~26h      | 3.5d                | 算法细化 + 两阶段路线                          |
| **4.2** Agent Blackboard          | ~42h      | ~34h      | 5.5d                | +TopicRouter 适配层 + ContextSlot 实际字段映射 |
| **4.4** MCP 完整协议              | ~30h      | ~30h      | 4d                  | 无变化                                         |
| 代码审查 + 修复 + 合并            | ~20h      | ~16h      | 2.5d                | 增加数据层审查                                 |
| **总计**                          | **~174h** | **~134h** | **~23d (5.5–6 周)** | **并行后实际 5.5–6 周**                        |

### 建议排期（修订版）

```
Week 1    │ 4.0 启动 + 4.2 启动 + 4.4 启动（三者并行）
          │ ├─ 4.0.1–4.0.3: step_events 表 + StepEventObserver + 批量 flush
          │ ├─ 4.2.1–4.2.2: Blackboard 类型 + TopicRouter
          │ └─ 4.4.1–4.4.2: Transport 抽象 + resources/prompts
          │
Week 2    │ 4.0 收尾 + 4.2 继续 + 4.4 继续
          │ ├─ 4.0.4–4.0.6: Repository 查询 + Pipeline 注册 + 端到端测试
          │ ├─ 4.2.3–4.2.4: AgentBlackboard + snapshot 压缩
          │ └─ 4.4.3–4.4.4: 动态发现 + ContextBuilder 集成
          │
Week 3    │ 4.0 合入 main → 4.1 启动 + 4.2 收尾 + 4.4 收尾
          │ ├─ 4.1.1–4.1.3: AdaptiveContextMonitor + 探索-利用
          │ ├─ 4.2.5–4.2.7: ContextSlot 迁移 + AgentLoop 注入 + 测试
          │ └─ 4.4.5–4.4.6: Dashboard + 端到端测试
          │
Week 4    │ 4.1 收尾 + 4.3 启动
          │ ├─ 4.1.4–4.1.5: Observer 改造 + agent-factory 接入
          │ └─ 4.3.1–4.3.3: PIS 核心算法 + Tool Coherence + Trend
          │
Week 5    │ 4.3 收尾 + 全量集成测试
          │ ├─ 4.3.4–4.3.6: Observer + Pipeline 注册 + Dashboard
          │ └─ 基线对比：性能 + 行为一致性 + step_events 数据完整性验证
          │
Week 6    │ 缓冲周：审查、修复、文档、合并 4.1/4.3/4.2/4.4
```

---

## 八、验收标准（阶段四整体）

阶段四全部完成后，系统应满足：

1. **[4.0]** `step_events` 表能完整记录 100 步 session 的每一步 tool_call、zone_snapshot、zone_crossing；批量 flush 策略使 DB 写入开销 < 2%
2. **[4.1]** 运行 100 个 session 后，adaptive threshold 与默认阈值相比，dumb zone 进入率降低 ≥10%（或保持不劣化）
3. **[4.3]** PIS 评分在 drift 场景（手工构造的测试用例）中 ≤0.3，在专注场景 ≥0.8；Phase 1 keyword Jaccard 方法无需 embedding 服务即可工作
4. **[4.2]** 两个 AgentLoop 实例通过 Blackboard 共享 discoveries，读写延迟 < 10ms；snapshot 压缩在 2000 token budget 内生效
5. **[4.4]** 连接支持 resources/prompts 的 MCP server 后，Dashboard 正确展示 resource 数量
6. **整体**: `pnpm test` 全量通过，`pnpm typecheck` 零错误，`pnpm lint:arch` 零违规
7. **整体**: 核心性能指标（session 平均成本、延迟、成功率）不劣化于阶段三基线

---

## 九、附录：关键接口草案

### A. StepEvents 配置

```typescript
// packages/types/src/agent-config.ts 新增

interface StepEventsConfig {
  enabled: boolean;
  batchSize: number; // default 10
  flushIntervalMs: number; // default 5000
  maxRetentionDays: number; // default 90
}
```

### B. AdaptiveContextMonitor 配置

```typescript
// packages/types/src/agent-config.ts 新增

interface AdaptiveMonitorConfig {
  enabled: boolean;
  explorationRate: number; // 0.0–1.0, default 0.1
  lookbackDays: number; // default 14
  minSamplesPerZone: number; // default 20
  hardLimits: {
    smartZoneMin: number; // default 0.3
    criticalThresholdMax: number; // default 0.9
  };
}
```

### C. Blackboard 配置

```typescript
// packages/types/src/agent-config.ts 新增

interface BlackboardConfig {
  enabled: boolean;
  snapshotBudgetTokens: number; // default 2000
  defaultMaxEntries: number; // default 100
  defaultTtlMs?: number; // default undefined = 不自动过期
  topics: Array<{
    name: string;
    mergeStrategy: 'append' | 'replace' | 'crdt';
    maxEntries?: number;
    ttlMs?: number;
  }>;
}
```

### D. PIS 配置

```typescript
// packages/types/src/agent-config.ts 新增

interface PISConfig {
  enabled: boolean;
  mode: 'log_only' | 'intervene'; // 初期建议 log_only
  evaluationIntervalSteps: number; // default 3（每 3 步计算一次）
  weights?: {
    intentAlignment: number;
    toolCoherence: number;
    goalProgress: number;
    contextStability: number;
  };
}
```

```

```
