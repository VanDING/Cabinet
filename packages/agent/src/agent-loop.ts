import type { LLMGateway, LLMResponse } from '@cabinet/gateway';
import type { EventBus } from '@cabinet/events';
import { ToolExecutor } from './tool-executor.js';
import { SafetyChecker } from './safety.js';
import { withRetry } from './retry.js';
import { CheckpointManager, type CheckpointState } from './checkpoint.js';
import { ContextBuilder, type MemoryProvider, type ContextBuildResult } from './context-builder.js';
import { ContextMonitor, type ContextBreakdown } from './context-monitor.js';
import { ContextHandoff } from './context-handoff.js';

export interface AgentSessionSummary {
  sessionId: string;
  projectId: string;
  captainId: string;
  model: string;
  totalSteps: number;
  totalTokens: { prompt: number; completion: number };
  toolCalls: { total: number; succeeded: number; failed: number; blocked: number };
  contextZones: { smart: number; warning: number; critical: number; dumb: number };
  contextHandoffs: number;
  errors: { transient: number; recoverable: number; fatal: number };
  durationMs: number;
  success: boolean;
  startTime: string;
}

export type SessionCompleteCallback = (summary: AgentSessionSummary) => void;

export interface AgentLoopOptions {
  gateway: LLMGateway;
  toolExecutor: ToolExecutor;
  safetyChecker: SafetyChecker;
  checkpointManager: CheckpointManager;
  memoryProvider: MemoryProvider;
  sessionId: string;
  projectId: string;
  captainId: string;
  systemPrompt?: string;
  maxSteps?: number;
  eventBus?: EventBus;
  model?: string;
  activeFiles?: string[];
  taskDescription?: string;
  /** Timeout for individual tool execution in ms (default 300000 = 5 min). */
  toolTimeoutMs?: number;
  /** Called when the agent session completes (success or failure). */
  onSessionComplete?: SessionCompleteCallback;
}

export interface AgentResult {
  content: string;
  steps: number;
  toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
}

export class AgentLoop {
  private readonly gateway: LLMGateway;
  private readonly toolExecutor: ToolExecutor;
  private readonly safetyChecker: SafetyChecker;
  private readonly checkpointManager: CheckpointManager;
  private readonly contextBuilder: ContextBuilder;
  private readonly contextMonitor: ContextMonitor | null;
  private readonly options: AgentLoopOptions;
  /** Accumulated handoff state across multiple run() calls (for segment-based workflow use). */
  private sessionHandoff: ContextHandoff | null = null;

  constructor(options: AgentLoopOptions) {
    this.gateway = options.gateway;
    this.toolExecutor = options.toolExecutor;
    this.safetyChecker = options.safetyChecker;
    this.checkpointManager = options.checkpointManager;
    this.contextBuilder = new ContextBuilder(options.memoryProvider);
    this.contextMonitor = options.eventBus
      ? ContextMonitor.forModel(options.model ?? 'claude-sonnet-4-6', options.eventBus)
      : null;
    this.options = options;
  }

  /** Set a callback for session observability (after construction). */
  set onSessionComplete(callback: SessionCompleteCallback | undefined) {
    this.options.onSessionComplete = callback;
  }

  /** Expose the context monitor for external querying. */
  get monitor(): ContextMonitor | null {
    return this.contextMonitor;
  }

  async run(userMessage: string, resumeState?: CheckpointState | null): Promise<AgentResult> {
    const maxSteps = this.options.maxSteps ?? 10;
    const startTime = Date.now();

    // Try to restore from checkpoint (unless caller already provided state)
    const state = resumeState ?? this.checkpointManager.load(this.options.sessionId);
    const isResuming = state !== null && state !== undefined;
    let steps = state?.step ?? 0;
    const executedToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] =
      state?.toolCallHistory ?? [];

    // If resuming from a crashed session, skip re-adding the user message (it's already in checkpoint)
    let messages: { role: 'user' | 'assistant'; content: string }[] = state?.messages ?? [];
    const wasCrashed = (state?.metadata as Record<string, unknown>)?.crashed === true;

    // Observability tracking
    const zoneCounts = { smart: 0, warning: 0, critical: 0, dumb: 0 };
    let handoffCount = 0;
    const errorCounts = { transient: 0, recoverable: 0, fatal: 0 };
    const toolCounts = { total: 0, succeeded: 0, failed: 0, blocked: 0 };
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // Add user message (skip if resuming from crash — already in checkpoint)
    if (!isResuming || wasCrashed) {
      // Don't re-add the same user message on resume
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.content !== userMessage) {
        messages.push({ role: 'user', content: userMessage });
      }
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    // Initialize or reuse handoff tracker (persists across run() calls for segment workflows)
    if (!this.sessionHandoff) {
      this.sessionHandoff = new ContextHandoff(userMessage);
    }
    const handoff = this.sessionHandoff;

    while (steps < maxSteps) {
      // Build context (reload short-term memory each iteration)
      const ctx: ContextBuildResult = await this.contextBuilder.build({
        sessionId: this.options.sessionId,
        projectId: this.options.projectId,
        captainId: this.options.captainId,
        systemPrompt: this.options.systemPrompt,
        activeFiles: this.options.activeFiles,
        taskDescription: this.options.taskDescription,
      });

      // Combine system context messages with conversation messages
      const allMessages = [...ctx.messages, ...messages];

      // ── Context Utilization Check (before LLM call) ──
      if (this.contextMonitor) {
        const breakdown: ContextBreakdown = {
          systemPrompt: this.contextMonitor.estimateTokens(ctx.systemPrompt),
          messages: this.contextMonitor.estimateTokens(
            allMessages.map((m) => m.content).join('\n'),
          ),
          toolResults: this.contextMonitor.estimateTokens(
            messages
              .filter((m) => m.role === 'user' && m.content.startsWith('Tool result'))
              .map((m) => m.content)
              .join('\n'),
          ),
          memory: this.contextMonitor.estimateTokens(ctx.messages.map((m) => m.content).join('\n')),
        };
        const snap = this.contextMonitor.snapshot(breakdown);

        // Track zone distribution
        zoneCounts[snap.zone]++;

        if (snap.zone === 'critical' || snap.zone === 'dumb') {
          console.warn(
            `[ContextMonitor] ${snap.zone.toUpperCase()} ZONE: ` +
              `${snap.utilization * 100}% utilization ` +
              `(${snap.estimatedTokens.toLocaleString()} / ${snap.maxTokens.toLocaleString()} tokens)`,
          );

          // Perform context handoff if we're in dangerous territory
          if (handoff.shouldHandoff(snap)) {
            const result = handoff.performHandoff(snap);
            handoffCount++;
            console.warn(
              `[ContextHandoff] Handoff #${result.state.handoffId} performed. ` +
                `Resetting context from ${snap.estimatedTokens.toLocaleString()} tokens.`,
            );
            // Reset messages to just the handoff message
            messages = [{ role: 'user', content: result.handoffMessage }];
            handoff.reset();
            // Skip LLM call this iteration — restart with fresh context
            continue;
          }
        }
      }

      // Call LLM via gateway with retry on transient errors
      let response: LLMResponse;
      try {
        response = await withRetry(
          () =>
            this.gateway.generateText({
              model: this.options.model ?? 'claude-sonnet-4-6',
              systemPrompt: ctx.systemPrompt,
              messages: allMessages,
            }),
          new Error('LLM call'),
        );
      } catch (error) {
        errorCounts.fatal++;
        this.reportSession(startTime, steps, executedToolCalls, totalPromptTokens, totalCompletionTokens,
          zoneCounts, handoffCount, errorCounts, toolCounts, false);
        return {
          content: `Agent loop failed at step ${steps}: ${(error as Error).message}`,
          steps,
          toolCalls: executedToolCalls,
        };
      }

      // Track token usage
      totalPromptTokens += response.usage?.promptTokens ?? 0;
      totalCompletionTokens += response.usage?.completionTokens ?? 0;

      // Calibrate estimator against actual token usage from the API
      if (this.contextMonitor && response.usage?.promptTokens) {
        const snap = this.contextMonitor.current;
        if (snap) {
          const estimationError =
            snap.estimatedTokens > 0
              ? (response.usage.promptTokens - snap.estimatedTokens) / snap.estimatedTokens
              : 0;
          // Log significant estimation drift (>30% off) for debugging
          if (Math.abs(estimationError) > 0.3) {
            console.debug(
              `[ContextMonitor] Estimation drift: ${(estimationError * 100).toFixed(0)}% ` +
                `(estimated ${snap.estimatedTokens}, actual ${response.usage.promptTokens})`,
            );
          }
        }
      }

      // No tool calls — agent is done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content });
        handoff.recordStep(`Step ${steps + 1}: Agent completed with final response (${this.contextMonitor ? this.contextMonitor.current?.zone ?? 'unknown' : 'unknown'} zone)`);
        handoff.recordDecision(response.content.slice(0, 200), 'agent final response');
        this.reportSession(startTime, steps + 1, executedToolCalls, totalPromptTokens, totalCompletionTokens,
          zoneCounts, handoffCount, errorCounts, toolCounts, true);
        return { content: response.content, steps: steps + 1, toolCalls: executedToolCalls };
      }

      // Execute tool calls
      for (const tc of response.toolCalls) {
        toolCounts.total++;

        // ── Idempotency check on resume: skip already-executed tool calls ──
        if (isResuming) {
          const alreadyDone = executedToolCalls.find(
            (prev) =>
              prev.name === tc.name &&
              JSON.stringify(prev.args) === JSON.stringify(tc.arguments) &&
              prev.result !== undefined,
          );
          if (alreadyDone) {
            toolCounts.succeeded++;
            messages.push({
              role: 'user',
              content: `Tool result for ${tc.name} (cached): ${JSON.stringify(alreadyDone.result)}`,
            });
            continue;
          }
        }

        // Safety check
        const safety = this.safetyChecker.check(tc.name, tc.arguments);
        if (!safety.allowed) {
          toolCounts.blocked++;
          executedToolCalls.push({
            name: tc.name,
            args: tc.arguments,
            result: `BLOCKED: ${safety.reason}`,
          });
          continue;
        }

        // Execute with watchdog timeout
        const toolTimeoutMs = this.options.toolTimeoutMs ?? 300000; // default 5 min
        let result: { toolCallId: string; output: unknown; error?: string };
        try {
          result = await Promise.race([
            this.toolExecutor.execute(tc.name, tc.id, tc.arguments),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Tool '${tc.name}' timed out after ${toolTimeoutMs}ms`)),
                toolTimeoutMs,
              ),
            ),
          ]);
        } catch (timeoutError) {
          // Save checkpoint with crashed marker before giving up
          this.checkpointManager.save({
            sessionId: this.options.sessionId,
            step: steps,
            messages,
            toolCallHistory: executedToolCalls,
            metadata: { projectId: this.options.projectId, crashed: true },
          });
          throw timeoutError;
        }

        if (result.error) {
          toolCounts.failed++;
        } else {
          toolCounts.succeeded++;
        }
        executedToolCalls.push({
          name: tc.name,
          args: tc.arguments,
          result: result.error ?? result.output,
        });

        // Record for context handoff
        handoff.recordToolResult(
          `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}): ${JSON.stringify(result.error ?? result.output).slice(0, 80)}`,
        );

        // Add tool result as user message for feedback
        messages.push({
          role: 'user',
          content: `Tool result for ${tc.name}: ${JSON.stringify(result.error ?? result.output)}`,
        });
      }

      steps++;

      // Record step for context handoff tracking
      const executedCount = executedToolCalls.filter(t => !String(t.result).includes('BLOCKED')).length;
      handoff.recordStep(`Step ${steps}: ${executedCount} tool calls executed in ${this.contextMonitor?.current?.zone ?? 'unknown'} zone`);

      // Save checkpoint
      this.checkpointManager.save({
        sessionId: this.options.sessionId,
        step: steps,
        messages,
        toolCallHistory: executedToolCalls,
        metadata: { projectId: this.options.projectId },
      });
    }

    this.reportSession(startTime, steps, executedToolCalls, totalPromptTokens, totalCompletionTokens,
      zoneCounts, handoffCount, errorCounts, toolCounts, false);
    return {
      content: `Agent reached max steps (${maxSteps}) without final response.`,
      steps,
      toolCalls: executedToolCalls,
    };
  }

  private reportSession(
    startTime: number, steps: number,
    toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[],
    promptTokens: number, completionTokens: number,
    zones: { smart: number; warning: number; critical: number; dumb: number },
    handoffs: number, errors: { transient: number; recoverable: number; fatal: number },
    tools: { total: number; succeeded: number; failed: number; blocked: number },
    success: boolean,
  ): void {
    this.options.onSessionComplete?.({
      sessionId: this.options.sessionId,
      projectId: this.options.projectId,
      captainId: this.options.captainId,
      model: this.options.model ?? 'claude-sonnet-4-6',
      totalSteps: steps,
      totalTokens: { prompt: promptTokens, completion: completionTokens },
      toolCalls: tools,
      contextZones: zones,
      contextHandoffs: handoffs,
      errors,
      durationMs: Date.now() - startTime,
      success,
      startTime: new Date(startTime).toISOString(),
    });
  }

  /**
   * Generate a handoff document from accumulated session state.
   * Called at segment boundaries to transfer context between agents.
   */
  generateHandoff(): string {
    if (!this.sessionHandoff) return '';
    const snap = this.contextMonitor?.current;
    const result = this.sessionHandoff.performHandoff(
      snap ?? {
        estimatedTokens: 0,
        maxTokens: 200_000,
        utilization: 0,
        zone: 'smart',
        breakdown: { systemPrompt: 0, messages: 0, toolResults: 0, memory: 0 },
        timestamp: new Date(),
      },
    );
    this.sessionHandoff.reset();
    return result.handoffMessage;
  }

  /** Reset the accumulated handoff state (e.g., after disposal). */
  resetHandoff(): void {
    this.sessionHandoff = null;
  }

  /** Resume from a saved checkpoint */
  async resume(userMessage: string): Promise<AgentResult> {
    const state = this.checkpointManager.load(this.options.sessionId);
    if (!state) {
      return this.run(userMessage);
    }
    return this.run(userMessage, state);
  }
}
