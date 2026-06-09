import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';
import type Database from 'better-sqlite3';

export interface StepEventConfig {
  enabled: boolean;
  batchSize?: number;
  flushIntervalMs?: number;
}

interface PendingEvent {
  sessionId: string;
  stepNumber: number;
  eventType: string;
  payload: string;
}

/**
 * Records per-step events into the step_events table.
 * Uses batch flushing to minimize DB write overhead.
 *
 * Design note: payload stores JSON in a TEXT column. For the expected
 * workload (3–5 events/step × 100 steps = 300–500 events/session) this
 * is acceptable within the 90-day retention window. If future analytics
 * need to aggregate by tool_name across all history, consider adding a
 * dedicated tool_name column to avoid full-table json_extract scans.
 */
export class StepEventObserver implements AgentObserver {
  name = 'StepEventRecorder';
  private db: Database.Database | null = null;
  private sessionId: string;
  private batchSize: number;
  private flushIntervalMs: number;
  private pending: PendingEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private insertStmt: Database.Statement | null = null;

  constructor(
    sessionId: string,
    config?: StepEventConfig,
    db?: Database.Database,
  ) {
    this.sessionId = sessionId;
    this.batchSize = config?.batchSize ?? 10;
    this.flushIntervalMs = config?.flushIntervalMs ?? 5000;
    if (config?.enabled && db) {
      this.db = db;
      this.insertStmt = db.prepare(
        `INSERT INTO step_events (session_id, step_number, event_type, payload)
         VALUES (?, ?, ?, ?)`,
      );
      this.scheduleFlush();
    }
  }

  async onToolCall(
    call: { id: string; name: string; args: Record<string, unknown> },
    ctx: AgentExecutionContext,
  ): Promise<void> {
    if (!this.db) return;
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
    if (!this.db) return;
    const success = !(result instanceof Error) && !(typeof result === 'string' && result.startsWith('Error'));
    const blocked = typeof result === 'string' && result.startsWith('BLOCKED:');
    this.insertEvent(ctx.stepCount, 'tool_result', {
      tool_name: call.name,
      success,
      blocked,
    });
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<void> {
    if (!this.db) return;

    if (ctx.lastSnapshot) {
      this.insertEvent(ctx.stepCount, 'zone_snapshot', {
        utilization: ctx.lastSnapshot.utilization,
        zone: ctx.lastSnapshot.zone,
        breakdown: ctx.lastSnapshot.breakdown,
      });
    }

    const crossings = (ctx as any).zoneCrossings as Array<{ from: string; to: string }> | undefined;
    if (crossings && crossings.length > 0) {
      const last = crossings[crossings.length - 1];
      if (last) {
        this.insertEvent(ctx.stepCount, 'zone_crossing', {
          from: last.from,
          to: last.to,
          utilization: ctx.lastSnapshot?.utilization,
        });
      }
    }
  }

  async onStreamEnd(ctx: AgentExecutionContext): Promise<void> {
    if (!this.db) return;
    // Insert llm_call summary for the session
    this.insertEvent(ctx.stepCount, 'llm_call', {
      model: ctx.model,
      prompt_tokens: ctx.totalPromptTokens,
      completion_tokens: ctx.totalCompletionTokens,
    });
    await this.flush();
    this.dispose();
  }

  private insertEvent(step: number, type: string, payload: unknown): void {
    this.pending.push({
      sessionId: this.sessionId,
      stepNumber: step,
      eventType: type,
      payload: JSON.stringify(payload),
    });

    if (this.pending.length >= this.batchSize) {
      this.flush();
    }
  }

  private flush(): void {
    if (!this.db || !this.insertStmt || this.pending.length === 0) return;

    const batch = this.pending.splice(0, this.pending.length);
    const transaction = this.db.transaction((events: PendingEvent[]) => {
      for (const ev of events) {
        this.insertStmt!.run(ev.sessionId, ev.stepNumber, ev.eventType, ev.payload);
      }
    });

    try {
      transaction(batch);
    } catch (err) {
      console.error('StepEventObserver flush failed:', err);
      // Re-queue failed events to avoid silent data loss
      this.pending.unshift(...batch);
      if (this.pending.length > this.batchSize * 3) {
        // Prevent unbounded growth if DB is down
        this.pending = this.pending.slice(-this.batchSize * 3);
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.flushTimer = null;
      if (this.db) {
        this.scheduleFlush();
      }
    }, this.flushIntervalMs);
  }

  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    this.db = null;
    this.insertStmt = null;
  }
}
