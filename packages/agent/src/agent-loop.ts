import type { LLMGateway } from '@cabinet/gateway';
import type { TrustLevel, DelegationTier } from '@cabinet/types';
import { ToolExecutor } from './tool-executor.js';
import { SafetyChecker } from './safety.js';
import { CheckpointManager, type CheckpointState } from './checkpoint.js';
import { ContextBuilder, type MemoryProvider } from './context-builder.js';
import { ContextMonitor } from './context-monitor.js';
import { ContextHandoff } from './context-handoff.js';
import { ToolPruner } from './tool-pruner.js';
import { ObserverPipeline } from './observer-pipeline.js';
import { AgentBlackboard } from './blackboard.js';
import { SelfConsistencyEngine } from './reasoning/self-consistency.js';
import { parseStructuredOutput } from './execution/parse-output.js';
import { StreamingCallbackAdapter } from './execution/streaming-adapter.js';
import type { StreamingCallback } from './execution/types.js';
import {
  TRUST_THRESHOLDS,
  type AgentLoopOptions,
  type AgentResult,
  type AgentSessionSummary,
  type SessionCompleteCallback,
} from './execution/agent-loop-options.js';
import { assembleExecutionContext } from './execution/context-assembler.js';
import { createObserverPipeline } from './execution/observer-factory.js';
import { executeGenerator } from './execution/execute-generator.js';
import { SessionReporter } from './execution/session-reporter.js';

export type {
  AgentLoopOptions,
  AgentResult,
  AgentSessionSummary,
  SessionCompleteCallback,
  StreamingCallback,
};

export class AgentLoop {
  private readonly gateway: LLMGateway;
  private readonly toolExecutor: ToolExecutor;
  private readonly safetyChecker: SafetyChecker;
  private readonly checkpointManager: CheckpointManager;
  private readonly contextBuilder: ContextBuilder;
  private readonly contextMonitor: ContextMonitor | null;
  private readonly options: AgentLoopOptions;
  private readonly observerPipeline: ObserverPipeline;
  private readonly sessionReporter: SessionReporter;

  /** Accumulated handoff state across multiple run() calls (for segment-based workflow use). */
  private sessionHandoff: ContextHandoff | null = null;
  /** Conversation history persisted across continueWithUserInput calls. */
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  /** One-shot skill context to inject into the system prompt on the next run. */
  private skillContext: string | null = null;
  /** Self-consistency engine for high-stakes task sampling (P1-6). */
  private selfConsistencyEngine: SelfConsistencyEngine | null = null;

  constructor(options: AgentLoopOptions) {
    this.gateway = options.gateway;
    this.toolExecutor = options.toolExecutor;
    this.safetyChecker = options.safetyChecker;
    this.checkpointManager = options.checkpointManager;
    this.contextBuilder = new ContextBuilder(options.memoryProvider, this.toolExecutor);
    if (options.rulesLoader) {
      this.contextBuilder.withRules(options.rulesLoader);
    }
    this.contextMonitor = options.eventBus
      ? ContextMonitor.forModel(
          options.model ?? 'claude-sonnet-4-6',
          options.eventBus,
          options.contextBudget,
        )
      : null;
    this.options = options;

    const observerResult = createObserverPipeline(
      options,
      this.gateway,
      this.safetyChecker,
      this.checkpointManager,
      this.contextMonitor,
    );
    this.observerPipeline = observerResult.pipeline;
    this.selfConsistencyEngine = observerResult.selfConsistencyEngine;
    this.sessionReporter = new SessionReporter(options, this.toolExecutor);
  }

  /** Set a callback for session observability (after construction). */
  set onSessionComplete(callback: SessionCompleteCallback | undefined) {
    this.options.onSessionComplete = callback;
  }

  /** Expose the context monitor for external querying. */
  get monitor(): ContextMonitor | null {
    return this.contextMonitor;
  }

  /** Expose the self-consistency engine for high-stakes task sampling (P1-6). */
  getSelfConsistencyEngine(): SelfConsistencyEngine | null {
    return this.selfConsistencyEngine;
  }

  /** Update delegation tier on the cached safety checker. */
  setDelegationTier(tier: DelegationTier): void {
    this.safetyChecker.setTier(tier);
  }

  /** Resolve the active tool executor, applying dynamic pruning if configured. */
  private async resolveToolExecutor(
    taskDescription?: string,
    recentMessages?: Array<{ role: string; content: string }>,
  ): Promise<ToolExecutor> {
    if (!this.options.toolPruner || !taskDescription) {
      return this.toolExecutor;
    }
    try {
      if (!this.options.toolPruner.isIndexed()) {
        await this.options.toolPruner.indexTools(this.toolExecutor);
      }
      const contextMessages = recentMessages
        ?.filter((m) => m.role !== 'system')
        .slice(-6)
        .map((m) => `${m.role}: ${m.content}`);
      const pruned = await this.options.toolPruner.pruneWithContext(
        taskDescription,
        contextMessages,
      );
      return this.toolExecutor.createView(pruned.allowedTools);
    } catch {
      return this.toolExecutor;
    }
  }

  async run(userMessage: string, resumeState?: CheckpointState | null): Promise<AgentResult> {
    return this._wrapExecution(userMessage, resumeState, undefined);
  }

  async runStreaming(userMessage: string, callback: StreamingCallback): Promise<AgentResult> {
    return this._wrapExecution(userMessage, undefined, callback);
  }

  private async _wrapExecution(
    userMessage: string,
    resumeState: CheckpointState | null | undefined,
    streamingCallback?: StreamingCallback,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const adapter = streamingCallback
      ? new StreamingCallbackAdapter(streamingCallback, this.options.maxSteps ?? 50)
      : null;
    let result: AgentResult | undefined;

    try {
      const assembly = await assembleExecutionContext(
        userMessage,
        {
          options: this.options,
          checkpointManager: this.checkpointManager,
          contextBuilder: this.contextBuilder,
          conversationHistory: this.conversationHistory,
          sessionHandoff: this.sessionHandoff,
          skillContext: this.skillContext,
        },
        resumeState,
      );
      this.sessionHandoff = assembly.sessionHandoff;
      this.skillContext = assembly.skillContext;
      const ctx = assembly.context;

      for await (const event of executeGenerator(
        {
          options: this.options,
          gateway: this.gateway,
          observerPipeline: this.observerPipeline,
          toolExecutor: this.toolExecutor,
          checkpointManager: this.checkpointManager,
          resolveToolExecutor: this.resolveToolExecutor.bind(this),
        },
        userMessage,
        ctx,
        streamingCallback,
      )) {
        adapter?.forward(event);
        if (event.type === 'done') {
          result = {
            content: event.content,
            steps: event.steps,
            toolCalls: event.toolCalls,
          };
        }
      }

      // Persist conversation history for multi-turn continuity
      this.conversationHistory = [...ctx.messages];
      // Session report
      this.sessionReporter.reportFromContext(ctx);

      const parsed = parseStructuredOutput(result?.content ?? '');
      if (parsed) {
        result = { ...result!, structuredOutput: parsed };
      }
    } catch (error) {
      const msg = (error as Error).message;
      adapter?.forward({ type: 'error', message: msg });
      this.sessionReporter.report(
        startTime,
        0,
        { smart: 0, warning: 0, critical: 0, dumb: 0 },
        0,
        { transient: 0, recoverable: 0, fatal: 1 },
        { total: 0, succeeded: 0, failed: 0, blocked: 0 },
        false,
      );
      return { content: `Agent loop failed: ${msg}`, steps: 0, toolCalls: [] };
    }

    return result ?? { content: 'No output produced.', steps: 0, toolCalls: [] };
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

  /** Resume from a saved checkpoint (prefer in-memory buffer if available). */
  async resume(userMessage: string): Promise<AgentResult> {
    const state = this.checkpointManager.load(this.options.sessionId);
    if (!state) {
      return this.run(userMessage);
    }
    return this.run(userMessage, state);
  }

  /**
   * Continue an ongoing interactive session with additional user input.
   * Preserves conversation history and re-uses the same AgentLoop configuration.
   */
  async continueWithUserInput(input: string, callback: StreamingCallback): Promise<AgentResult> {
    return this.runStreaming(input, callback);
  }

  /** Expose the accumulated conversation history (for debugging / external inspection). */
  getConversationHistory(): ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> {
    return this.conversationHistory;
  }

  /** Clear conversation history (e.g. when sub-agent is finalized). */
  clearConversationHistory(): void {
    this.conversationHistory = [];
  }

  /** Replace conversation history (e.g. for phase transition in interactive mode). */
  setConversationHistory(history: { role: 'user' | 'assistant'; content: string }[]): void {
    this.conversationHistory = [...history];
  }

  /** Set one-shot skill context to be injected into the system prompt on the next run. */
  setSkillContext(context: string | null): void {
    this.skillContext = context;
  }
}
