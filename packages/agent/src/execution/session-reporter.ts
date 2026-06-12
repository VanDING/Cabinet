import { MessageType } from '@cabinet/types';
import type { ToolExecutor } from '../tool-executor.js';
import type { AgentExecutionContext } from '../observer-pipeline.js';
import { collectToolVariety } from '../tool-variety-collector.js';
import type {
  AgentLoopOptions,
  AgentSessionSummary,
  SessionCompleteCallback,
} from './agent-loop-options.js';

export class SessionReporter {
  constructor(
    private readonly options: AgentLoopOptions,
    private readonly toolExecutor: ToolExecutor,
  ) {}

  reportFromContext(ctx: AgentExecutionContext): void {
    // Collect tool variety metrics
    const variety = collectToolVariety(
      ctx.sessionId,
      ctx.toolCallHistory,
      this.toolExecutor.listTools().length,
    );
    this.options.eventBus
      ?.publish({
        messageId: `tool_variety_${ctx.sessionId}_${Date.now()}`,
        correlationId: ctx.sessionId,
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SystemNotification,
        payload: {
          type: 'tool_variety',
          data: variety as unknown as Record<string, unknown>,
        },
      })
      .catch(() => {});

    this.options.onSessionComplete?.({
      sessionId: ctx.sessionId,
      projectId: ctx.projectId,
      captainId: ctx.captainId,
      model: ctx.model,
      totalSteps: ctx.stepCount,
      totalTokens: { prompt: ctx.totalPromptTokens, completion: ctx.totalCompletionTokens },
      toolCalls: ctx.toolCounts,
      contextZones: ctx.zoneCounts,
      contextHandoffs: ctx.handoffCount,
      errors: ctx.errorCounts,
      durationMs: Date.now() - ctx.startTime,
      success:
        !ctx.finalContent.startsWith('Agent stopped') &&
        !ctx.finalContent.startsWith('Agent loop failed'),
      startTime: new Date().toISOString(),
      toolCallHistory: ctx.toolCallHistory,
    });
  }

  report(
    startTime: number,
    steps: number,
    zones: { smart: number; warning: number; critical: number; dumb: number },
    handoffs: number,
    errors: { transient: number; recoverable: number; fatal: number },
    tools: { total: number; succeeded: number; failed: number; blocked: number },
    success: boolean,
  ): void {
    this.options.onSessionComplete?.({
      sessionId: this.options.sessionId,
      projectId: this.options.projectId,
      captainId: this.options.captainId,
      model: this.options.model ?? 'claude-sonnet-4-6',
      totalSteps: steps,
      totalTokens: { prompt: 0, completion: 0 },
      toolCalls: tools,
      contextZones: zones,
      contextHandoffs: handoffs,
      errors,
      durationMs: Date.now() - startTime,
      success,
      startTime: new Date(startTime).toISOString(),
      toolCallHistory: [],
    });
  }
}

export type { AgentSessionSummary, SessionCompleteCallback };
