import type { LLMGateway, LLMResponse } from '@cabinet/gateway';
import type { EventBus } from '@cabinet/events';
import { ToolExecutor } from './tool-executor.js';
import { SafetyChecker } from './safety.js';
import { withRetry } from './retry.js';
import { CheckpointManager, type CheckpointState } from './checkpoint.js';
import { ContextBuilder, type MemoryProvider, type ContextBuildResult } from './context-builder.js';
import { ContextMonitor, type ContextBreakdown } from './context-monitor.js';
import { ContextHandoff } from './context-handoff.js';

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
  /** Event bus for context-zone alerts. When omitted, zone monitoring is disabled. */
  eventBus?: EventBus;
  /** Model name for context-window sizing. Defaults to 200K window. */
  model?: string;
  /** Files currently active (for rule glob matching). */
  activeFiles?: string[];
  /** Current task description (for semantic rule matching). */
  taskDescription?: string;
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

  /** Expose the context monitor for external querying. */
  get monitor(): ContextMonitor | null {
    return this.contextMonitor;
  }

  async run(userMessage: string): Promise<AgentResult> {
    const maxSteps = this.options.maxSteps ?? 10;
    let steps = 0;
    const toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] = [];

    // Try to restore from checkpoint
    const state = this.checkpointManager.load(this.options.sessionId);
    let messages: { role: 'user' | 'assistant'; content: string }[] =
      state?.messages ?? [];

    // Add user message
    messages.push({ role: 'user', content: userMessage });

    // Initialize handoff tracker (for context reset on long tasks)
    const handoff = new ContextHandoff(userMessage);

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
      const newMessages = messages.slice(ctx.messages.length);
      const allMessages = [...ctx.messages, ...newMessages];

      // ── Context Utilization Check (before LLM call) ──
      if (this.contextMonitor) {
        const breakdown: ContextBreakdown = {
          systemPrompt: this.contextMonitor.estimateTokens(ctx.systemPrompt),
          messages: this.contextMonitor.estimateTokens(
            allMessages.map(m => m.content).join('\n')
          ),
          toolResults: this.contextMonitor.estimateTokens(
            messages
              .filter(m => m.role === 'user' && m.content.startsWith('Tool result'))
              .map(m => m.content)
              .join('\n')
          ),
          memory: this.contextMonitor.estimateTokens(
            ctx.messages.map(m => m.content).join('\n')
          ),
        };
        const snap = this.contextMonitor.snapshot(breakdown);

        if (snap.zone === 'critical' || snap.zone === 'dumb') {
          console.warn(
            `[ContextMonitor] ${snap.zone.toUpperCase()} ZONE: ` +
            `${snap.utilization * 100}% utilization ` +
            `(${snap.estimatedTokens.toLocaleString()} / ${snap.maxTokens.toLocaleString()} tokens)`
          );

          // Perform context handoff if we're in dangerous territory
          if (handoff.shouldHandoff(snap)) {
            const result = handoff.performHandoff(snap);
            console.warn(
              `[ContextHandoff] Handoff #${result.state.handoffId} performed. ` +
              `Resetting context from ${snap.estimatedTokens.toLocaleString()} tokens.`
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
              model: 'claude-sonnet-4-6',
              systemPrompt: ctx.systemPrompt,
              messages: allMessages,
            }),
          new Error('LLM call')
        );
      } catch (error) {
        return {
          content: `Agent loop failed at step ${steps}: ${(error as Error).message}`,
          steps,
          toolCalls,
        };
      }

      // Calibrate estimator against actual token usage from the API
      if (this.contextMonitor && response.usage?.promptTokens) {
        const snap = this.contextMonitor.current;
        if (snap) {
          const estimationError = snap.estimatedTokens > 0
            ? (response.usage.promptTokens - snap.estimatedTokens) / snap.estimatedTokens
            : 0;
          // Log significant estimation drift (>30% off) for debugging
          if (Math.abs(estimationError) > 0.3) {
            console.debug(
              `[ContextMonitor] Estimation drift: ${(estimationError * 100).toFixed(0)}% ` +
              `(estimated ${snap.estimatedTokens}, actual ${response.usage.promptTokens})`
            );
          }
        }
      }

      // No tool calls — agent is done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content });
        return { content: response.content, steps: steps + 1, toolCalls };
      }

      // Execute tool calls
      for (const tc of response.toolCalls) {
        // Safety check
        const safety = this.safetyChecker.check(tc.name, tc.arguments);
        if (!safety.allowed) {
          toolCalls.push({ name: tc.name, args: tc.arguments, result: `BLOCKED: ${safety.reason}` });
          continue;
        }

        // Execute
        const result = await this.toolExecutor.execute(tc.name, tc.id, tc.arguments);
        toolCalls.push({ name: tc.name, args: tc.arguments, result: result.error ?? result.output });

        // Record for context handoff
        handoff.recordToolResult(
          `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}): ${JSON.stringify(result.error ?? result.output).slice(0, 80)}`
        );

        // Add tool result as user message for feedback
        messages.push({
          role: 'user',
          content: `Tool result for ${tc.name}: ${JSON.stringify(result.error ?? result.output)}`,
        });
      }

      steps++;

      // Save checkpoint
      this.checkpointManager.save({
        sessionId: this.options.sessionId,
        step: steps,
        messages,
        toolCallHistory: toolCalls,
        metadata: { projectId: this.options.projectId },
      });
    }

    return {
      content: `Agent reached max steps (${maxSteps}) without final response.`,
      steps,
      toolCalls,
    };
  }

  /** Resume from a saved checkpoint */
  async resume(userMessage: string): Promise<AgentResult> {
    const state = this.checkpointManager.load(this.options.sessionId);
    if (!state) {
      return this.run(userMessage);
    }
    // Continue from checkpoint — just add the new message
    return this.run(userMessage);
  }
}
