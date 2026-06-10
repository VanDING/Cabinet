import type { LLMGateway, LLMResponse, StreamingToolDefinition } from '@cabinet/gateway';
import type { EventBus } from '@cabinet/events';
import { MessageType, type DelegationTier } from '@cabinet/types';
import { ToolExecutor, type ToolResult } from './tool-executor.js';
import { SafetyChecker } from './safety.js';
import { withRetry } from './retry.js';
import { CheckpointManager, type CheckpointState } from './checkpoint.js';
import {
  ContextBuilder,
  type MemoryProvider,
  type ContextBuildResult,
  type PrebuiltContext,
} from './context-builder.js';
import type { RulesLoader } from './rules-loader.js';
import { ContextMonitor, type ContextBreakdown } from './context-monitor.js';
import { ContextHandoff } from './context-handoff.js';
import { TaskTracker, type AgentTask, SemanticTaskTracker } from './task-tracker.js';
import { ProjectSnapshot } from './project-snapshot.js';
import { ToolPruner } from './tool-pruner.js';
import type { PromptModules } from './prompt-assembler.js';
import {
  ObserverPipeline,
  type AgentEvent,
  type AgentExecutionContext,
  type AgentObserver,
} from './observer-pipeline.js';
import { ContextMonitorObserver } from './observers/context-monitor.js';
import { HandoffObserver } from './observers/handoff.js';
import { SafetyCheckObserver } from './observers/safety.js';
import { ToolExecuteObserver } from './observers/tool-execute.js';
import { CheckpointObserver } from './observers/checkpoint.js';
import { StepEventObserver, type StepEventConfig } from './observers/step-event-observer.js';
import {
  ProcessIdentityObserver,
  type PISObserverConfig,
} from './observers/process-identity-observer.js';
import {
  AdaptiveContextMonitor,
  classifyTaskCategory,
  type AdaptiveThresholdConfig,
} from './context-monitor-adaptive.js';
import type { SessionMetricsRepository } from '@cabinet/storage';
import type Database from 'better-sqlite3';
import { AgentBlackboard } from './blackboard.js';
import { injectBlackboardSnapshot } from './blackboard-compress.js';
import { BlackboardObserver } from './observers/blackboard-observer.js';
import { ContentGuardObserver } from './observers/content-guard.js';
import type { ContentFilterConfig } from './guard/content-filter.js';
import { AutoReplanObserver, type AutoReplanConfig } from './observers/auto-replan.js';
import { SelfConsistencyEngine, type SelfConsistencyConfig } from './reasoning/self-consistency.js';
import { ReflectionObserver, type ReflectionConfig } from './observers/reflection.js';
import { JudgeObserver, type JudgeConfig } from './observers/judge.js';
import { EmbeddingService } from './embedding-service.js';
import { collectToolVariety } from './tool-variety-collector.js';

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
  /** Detailed tool call history for skill extraction and debugging. */
  toolCallHistory?: { name: string; args: Record<string, unknown>; result: unknown }[];
}

export type SessionCompleteCallback = (summary: AgentSessionSummary) => void;

/** Callback for streaming LLM output chunk by chunk. */
export interface StreamingCallback {
  onChunk(content: string): void;
  onRoutingStart?(targetAgent: string): void;
  onToolCall?(name: string, args: Record<string, unknown>): void;
  onToolResult?(name: string, result: unknown): void;
  onThinking?(content: string): void;
  onThinkingDone?(): void;
  onUsage?(usage: { promptTokens: number; completionTokens: number }): void;
  onTaskUpdate?(tasks: AgentTask[]): void;
  onSemanticTaskUpdate?(tasks: import('./task-tracker.js').SemanticTask[]): void;
  onStepBudgetWarning?(remaining: number, maxSteps: number): void;
  // Sub-agent orchestration events
  onSubAgentStart?(agentName: string, taskDescription: string): void;
  onSubAgentToolCall?(agentName: string, toolName: string, args: Record<string, unknown>): void;
  onSubAgentThinking?(agentName: string, content: string): void;
  onSubAgentDone?(agentName: string, result: string): void;
  onSubAgentError?(agentName: string, error: string): void;
  onQualityReview?(result: { pass: boolean; score: number; issues: any[] }): void;
  onDone(fullContent: string): void;
  onError?(error: string): void;
}

export type TrustLevel = 'T0' | 'T1' | 'T2' | 'T3';

const TRUST_THRESHOLDS: Record<
  TrustLevel,
  { maxConsecutiveErrors: number; maxProbeTools: number }
> = {
  T0: { maxConsecutiveErrors: 2, maxProbeTools: 3 },
  T1: { maxConsecutiveErrors: 3, maxProbeTools: 5 },
  T2: { maxConsecutiveErrors: 5, maxProbeTools: 10 },
  T3: { maxConsecutiveErrors: 10, maxProbeTools: Infinity },
};

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
  /** Session ID used for memory lookups (defaults to sessionId if omitted). Allows specialist agents to share conversation context while keeping separate checkpoints. */
  memorySessionId?: string;
  /** Called when the agent session completes (success or failure). */
  onSessionComplete?: SessionCompleteCallback;
  /** Max output tokens for LLM calls (undefined = model default, no artificial limit). */
  maxResponseTokens?: number;
  /** Temperature for LLM calls (undefined = model default). */
  temperature?: number;
  /** Context window budget as fraction of model window (0-1, default 0.4 = 40%). */
  contextBudget?: number;
  /** Anthropic extended thinking budget in tokens (1024–128000). */
  thinkingBudget?: number;
  /** Project root directory for snapshot caching (defaults to process.cwd()). */
  projectRoot?: string;
  /** Optional rules loader for hierarchical rule injection. */
  rulesLoader?: RulesLoader;
  /** Optional cost tracker for per-LLM-call cost recording. */
  costTracker?: {
    record(
      model: string,
      promptTokens: number,
      completionTokens: number,
      cachedPromptTokens?: number,
    ): void;
  };
  /** Pre-built context for strict consistency (skips self-collection in ContextBuilder). */
  prebuiltContext?: PrebuiltContext;
  /** User-configurable trust level (T0-T3) for error tolerance and tool limits. */
  trustLevel?: TrustLevel;
  /** Optional dynamic tool pruner — reduces exposed tools per-turn by task relevance. */
  toolPruner?: ToolPruner;
  /** Role modules for modular prompt assembly (preferred over systemPrompt). */
  roleModules?: PromptModules;
  /** SQLite database for step-event recording (4.0). */
  db?: Database.Database;
  /** Step event observer config (4.0). */
  stepEvents?: StepEventConfig;
  /** Adaptive threshold monitor config (4.1). */
  adaptiveMonitor?: AdaptiveThresholdConfig & { metricsRepo?: SessionMetricsRepository };
  /** Process Identity Score config (4.3). */
  pis?: PISObserverConfig;
  /** Agent Blackboard for shared state injection (4.2). */
  blackboard?: AgentBlackboard;
  /** MCP resource metadata for system prompt injection (4.4). */
  mcpResources?: Array<{ uri: string; name: string; description?: string }>;
  /** MCP prompt metadata for system prompt injection (4.4). */
  mcpPrompts?: Array<{ name: string; description?: string }>;
  /** Content guardrails config (P0-2). */
  guardrails?: ContentFilterConfig;
  /** Reflection config (P0-1). */
  reflection?: ReflectionConfig;
  /** Judge config (P0-3). */
  judge?: JudgeConfig;
  /** Auto-replan config (P1-5). */
  autoReplan?: AutoReplanConfig;
  /** Self-consistency config (P1-6). Engine exposed via getSelfConsistencyEngine(). */
  selfConsistency?: SelfConsistencyConfig;
}

export interface AgentResult {
  content: string;
  steps: number;
  toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
  usage?: { promptTokens: number; completionTokens: number };
  /** Parsed structured output if the agent emitted a JSON block. */
  structuredOutput?: import('@cabinet/types').AgentOutput;
}

/** Format a human-readable task name from a tool call. */
/** Try to extract a structured AgentOutput from LLM text. Multi-level fallback:
 *  1. ```json fence block
 *  2. Bare JSON (balanced bracket extraction)
 *  3. Any code fence block (``` without json tag)
 */
function parseStructuredOutput(content: string): import('@cabinet/types').AgentOutput | undefined {
  // Level 1: Try ```json fence (most reliable)
  const fenceMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    const result = tryParseAgentOutput(fenceMatch[1]!);
    if (result) return result;
  }

  // Level 2: Try bare JSON — extract first balanced { or [ block
  const bracketMatch = extractBalancedJSON(content);
  if (bracketMatch) {
    const result = tryParseAgentOutput(bracketMatch);
    if (result) return result;
  }

  // Level 3: Try any code fence (``` without json tag, ```javascript, etc.)
  const anyFenceMatch = content.match(/```\w*\s*([\s\S]*?)\s*```/);
  if (anyFenceMatch) {
    const result = tryParseAgentOutput(anyFenceMatch[1]!);
    if (result) return result;
  }

  return undefined;
}

/** Parse a JSON string into AgentOutput with relaxed shape validation. */
function tryParseAgentOutput(json: string): import('@cabinet/types').AgentOutput | undefined {
  try {
    const parsed = JSON.parse(json.trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const hasKnownField = !!(
      parsed.summary ||
      parsed.findings ||
      parsed.decisions ||
      parsed.openQuestions ||
      parsed.confidence !== undefined
    );
    const hasMultipleFields = Object.keys(parsed).length >= 2;
    if (hasKnownField || hasMultipleFields) {
      return {
        summary: String(parsed.summary ?? ''),
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
        confidence:
          typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        suggestedNextSteps: Array.isArray(parsed.suggestedNextSteps)
          ? parsed.suggestedNextSteps
          : [],
      };
    }
  } catch {
    /* not valid JSON */
  }
  return undefined;
}

/** Extract the first balanced JSON object or array from text using bracket matching. */
function extractBalancedJSON(text: string): string | null {
  const startBrace = text.indexOf('{');
  const startBracket = text.indexOf('[');
  let start = -1;
  let openChar = '';
  let closeChar = '';
  if (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) {
    start = startBrace;
    openChar = '{';
    closeChar = '}';
  } else if (startBracket !== -1) {
    start = startBracket;
    openChar = '[';
    closeChar = ']';
  }
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Format a human-readable task name from a tool call. */
function formatToolTaskName(toolName: string, args: Record<string, unknown>): string {
  const preview = (val: unknown) => {
    const s = String(val ?? '');
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  };
  switch (toolName) {
    case 'read_file':
      return args.filePath ? `Read ${preview(args.filePath)}` : 'Read file';
    case 'writeFile':
      return args.filePath ? `Write ${preview(args.filePath)}` : 'Write file';
    case 'editFile':
      return args.filePath ? `Edit ${preview(args.filePath)}` : 'Edit file';
    case 'execCommand':
      return args.command ? `Run ${preview(args.command)}` : 'Run command';
    case 'searchFiles':
      return args.pattern ? `Search ${preview(args.pattern)}` : 'Search files';
    case 'searchContent':
      return args.pattern ? `Search content ${preview(args.pattern)}` : 'Search content';
    case 'listDirectory':
      return args.dirPath ? `List ${preview(args.dirPath)}` : 'List directory';
    case 'webFetch':
      return args.url ? `Fetch ${preview(args.url)}` : 'Fetch URL';
    case 'httpRequest':
      return args.url ? `HTTP ${preview(args.url)}` : 'HTTP request';
    case 'runWorkflow':
      return 'Run workflow';
    default:
      return toolName;
  }
}

/** Adapts AgentEvent stream to the legacy StreamingCallback interface. */
class StreamingCallbackAdapter {
  private fullText = '';
  private estimatedSteps = 1;
  private warnedBudget = false;
  private taskTracker = new TaskTracker();
  private semanticTracker = new SemanticTaskTracker();
  private taskMap = new Map<string, string>();
  private afterToolResult = false;
  private readonly maxSteps: number;

  constructor(
    private callback: StreamingCallback,
    maxSteps = 50,
  ) {
    this.maxSteps = maxSteps;
  }

  forward(event: AgentEvent): void {
    switch (event.type) {
      case 'text': {
        if (this.afterToolResult) {
          this.estimatedSteps++;
          this.afterToolResult = false;
          this.semanticTracker.completeCurrentStep();
          const remaining = this.maxSteps - this.estimatedSteps;
          if (!this.warnedBudget && remaining <= Math.ceil(this.maxSteps * 0.25)) {
            this.warnedBudget = true;
            this.callback.onStepBudgetWarning?.(remaining, this.maxSteps);
          }
        }
        this.fullText += event.content;
        this.callback.onChunk?.(event.content);
        break;
      }
      case 'thinking':
        this.callback.onThinking?.(event.content);
        break;
      case 'thinking_done':
        this.callback.onThinkingDone?.();
        break;
      case 'tool_call': {
        this.afterToolResult = false;
        const taskName = formatToolTaskName(event.name, event.args);
        const taskId = this.taskTracker.addTask(taskName);
        this.taskMap.set(event.id, taskId);
        this.callback.onTaskUpdate?.(this.taskTracker.getTasks());
        this.callback.onToolCall?.(event.name, event.args);
        const commandHint =
          event.name === 'execCommand' || event.name === 'exec_command'
            ? String(event.args?.command ?? '')
            : undefined;
        this.semanticTracker.addToolCall(event.id, event.name, commandHint);
        this.callback.onSemanticTaskUpdate?.(this.semanticTracker.getTasks());
        break;
      }
      case 'tool_result': {
        this.afterToolResult = true;
        const taskId = this.taskMap.get(event.id);
        if (taskId) {
          const hasError = typeof event.result === 'string' && event.result.startsWith('Error');
          this.taskTracker.completeTask(taskId, !hasError);
          this.callback.onTaskUpdate?.(this.taskTracker.getTasks());
        }
        this.callback.onToolResult?.(event.name, event.result);
        break;
      }
      case 'usage':
        this.callback.onUsage?.(event.usage);
        break;
      case 'step_budget_warning':
        this.callback.onStepBudgetWarning?.(event.remaining, event.max);
        break;
      case 'error':
        this.callback.onError?.(event.message);
        this.semanticTracker.finalizeAll(false);
        this.callback.onSemanticTaskUpdate?.(this.semanticTracker.getTasks());
        break;
      case 'done': {
        if (
          this.estimatedSteps >= this.maxSteps &&
          !this.fullText.includes('[INCOMPLETE: max_steps_reached]')
        ) {
          this.fullText += '\n\n[INCOMPLETE: max_steps_reached]';
        }
        this.semanticTracker.finalizeAll(true);
        this.callback.onSemanticTaskUpdate?.(this.semanticTracker.getTasks());
        this.callback.onDone?.(this.fullText);
        break;
      }
    }
  }
}

export class AgentLoop {
  private readonly gateway: LLMGateway;
  private readonly toolExecutor: ToolExecutor;
  private readonly safetyChecker: SafetyChecker;
  private readonly checkpointManager: CheckpointManager;
  private readonly contextBuilder: ContextBuilder;
  private readonly contextMonitor: ContextMonitor | null;
  private readonly options: AgentLoopOptions;
  private readonly observerPipeline: ObserverPipeline;

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
    // Adaptive monitor (4.1)
    if (
      options.adaptiveMonitor?.enabled &&
      options.adaptiveMonitor.metricsRepo &&
      options.eventBus
    ) {
      const adaptive = new AdaptiveContextMonitor(
        options.eventBus,
        options.adaptiveMonitor.metricsRepo,
        options.adaptiveMonitor,
        options.model,
      );
      adaptive
        .recalibrate(
          options.model ?? 'claude-sonnet-4-6',
          undefined,
          classifyTaskCategory(options.taskDescription ?? ''),
        )
        .catch(() => {});
      this.contextMonitor = adaptive;
    } else {
      this.contextMonitor = options.eventBus
        ? ContextMonitor.forModel(
            options.model ?? 'claude-sonnet-4-6',
            options.eventBus,
            options.contextBudget,
          )
        : null;
    }
    this.options = options;

    // Pre-compile Observer Pipeline
    const observers: AgentObserver[] = [
      new SafetyCheckObserver(this.safetyChecker),
      new ToolExecuteObserver(),
    ];

    // Step event recorder (4.0)
    if (options.stepEvents?.enabled && options.db) {
      observers.push(new StepEventObserver(options.sessionId, options.stepEvents, options.db));
    }

    if (this.contextMonitor) {
      observers.push(new ContextMonitorObserver(this.contextMonitor));
      observers.push(new HandoffObserver());
    }

    // Process Identity Score observer (4.3)
    if (options.pis?.enabled) {
      observers.push(
        new ProcessIdentityObserver(
          options.taskDescription ?? '',
          options.pis,
          options.eventBus,
          new EmbeddingService(this.gateway),
        ),
      );
    }

    // Blackboard mid-session sync observer (B.1)
    if (options.eventBus && options.blackboard) {
      observers.push(new BlackboardObserver(options.eventBus, ['discoveries']));
    }

    // Content guardrails observer (P0-2)
    if (options.guardrails?.enabled) {
      observers.unshift(new ContentGuardObserver(options.guardrails));
    }

    // Reflection observer (P0-1) — placed before HandoffObserver so handoff happens after critique
    if (options.reflection?.enabled) {
      observers.push(new ReflectionObserver(options.reflection, options.gateway));
    }

    // Judge observer (P0-3) — evaluates output quality
    if (options.judge?.enabled) {
      observers.push(new JudgeObserver(options.judge, options.gateway, options.taskDescription));
    }

    // Auto-replan observer (P1-5) — detects tool errors and triggers LLM analysis
    if (options.autoReplan?.enabled) {
      observers.push(new AutoReplanObserver(options.autoReplan, options.gateway));
    }

    // Self-consistency engine (P1-6) — exposed for callers to use on high-stakes tasks
    if (options.selfConsistency?.enabled) {
      this.selfConsistencyEngine = new SelfConsistencyEngine(
        options.selfConsistency,
        options.gateway,
      );
    }

    observers.push(new CheckpointObserver(this.checkpointManager));
    this.observerPipeline = new ObserverPipeline(observers);
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
  private async resolveToolExecutor(taskDescription?: string): Promise<ToolExecutor> {
    if (!this.options.toolPruner || !taskDescription) {
      return this.toolExecutor;
    }
    try {
      if (!this.options.toolPruner.isIndexed()) {
        await this.options.toolPruner.indexTools(this.toolExecutor);
      }
      const pruned = await this.options.toolPruner.prune(taskDescription);
      return this.toolExecutor.createView(pruned.allowedTools);
    } catch {
      return this.toolExecutor;
    }
  }

  async run(userMessage: string, resumeState?: CheckpointState | null): Promise<AgentResult> {
    const startTime = Date.now();
    let result: AgentResult | undefined;

    try {
      for await (const event of this._execute(userMessage, resumeState)) {
        if (event.type === 'done') {
          result = {
            content: event.content,
            steps: event.steps,
            toolCalls: event.toolCalls,
          };
        }
      }
    } catch (error) {
      const msg = (error as Error).message;
      this._reportSession(
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

  async runStreaming(userMessage: string, callback: StreamingCallback): Promise<AgentResult> {
    const adapter = new StreamingCallbackAdapter(callback, this.options.maxSteps ?? 50);
    let result: AgentResult | undefined;

    try {
      for await (const event of this._execute(userMessage, undefined, callback)) {
        adapter.forward(event);
        if (event.type === 'done') {
          result = {
            content: event.content,
            steps: event.steps,
            toolCalls: event.toolCalls,
          };
        }
      }
    } catch (error) {
      const msg = (error as Error).message;
      adapter.forward({ type: 'error', message: msg });
      this._reportSession(
        Date.now(),
        0,
        { smart: 0, warning: 0, critical: 0, dumb: 0 },
        0,
        { transient: 0, recoverable: 0, fatal: 1 },
        { total: 0, succeeded: 0, failed: 0, blocked: 0 },
        false,
      );
      return { content: `Streaming error: ${msg}`, steps: 0, toolCalls: [] };
    }

    return result ?? { content: 'No output produced.', steps: 0, toolCalls: [] };
  }

  private async *_execute(
    userMessage: string,
    resumeState?: CheckpointState | null,
    _streamingCallback?: StreamingCallback,
  ): AsyncGenerator<AgentEvent> {
    const maxSteps = this.options.maxSteps ?? 50;
    const trust = TRUST_THRESHOLDS[this.options.trustLevel ?? 'T1'];
    const pipeline = this.observerPipeline;

    // 1. Assemble execution context
    const ctx = await this._assembleContext(userMessage, resumeState);

    // 2. Notify stream start
    await pipeline.notify('onStreamStart', ctx);

    // 2.5. Check user input for injection attempts (P0-2)
    const inputChecks = await pipeline.notify('onUserInput', ctx, userMessage);
    const blocked = inputChecks.find(
      (r): r is { blocked: boolean; reason?: string } =>
        r !== null && typeof r === 'object' && (r as any).blocked === true,
    );
    if (blocked) {
      ctx.finalContent = `[BLOCKED] ${blocked.reason ?? 'Input blocked by content guard'}`;
      yield { type: 'done', content: ctx.finalContent, steps: 0, toolCalls: [] };
      await pipeline.notify('onStreamEnd', ctx);
      return;
    }

    // 3. Resolve tools
    const activeToolExecutor = await this.resolveToolExecutor(this.options.taskDescription);
    const toolDescriptors = activeToolExecutor.getToolDescriptors();

    // 4. Main execution loop
    while (ctx.stepCount < maxSteps) {
      if (ctx.consecutiveErrors >= trust.maxConsecutiveErrors) {
        ctx.finalContent = `Agent stopped after ${ctx.consecutiveErrors} consecutive errors (trust level: ${this.options.trustLevel ?? 'T1'}).`;
        break;
      }

      ctx.currentStepText = '';
      ctx.currentStepToolCalls = [];

      // Inject mid-session Blackboard updates before next LLM call
      if (ctx.pendingBlackboardUpdates && ctx.pendingBlackboardUpdates.length > 0) {
        const updates = ctx.pendingBlackboardUpdates;
        const lines = updates.map(
          (u) =>
            `- [BLACKBOARD UPDATE @${new Date().toISOString()}] ${u.topic}: ${JSON.stringify(u.payload).slice(0, 300)}`,
        );
        ctx.messages.push({
          role: 'user',
          content: '[Shared Context Update]\n' + lines.join('\n'),
        });
        ctx.pendingBlackboardUpdates = [];
      }

      // 4.1 LLM call
      let response: LLMResponse;
      try {
        response = await withRetry(
          () =>
            this.gateway.generateText({
              model: this.options.model ?? 'claude-sonnet-4-6',
              systemPrompt: ctx.systemPrompt,
              messages: ctx.messages,
              tools: toolDescriptors,
              cacheSystemPrompt: true,
              ...(this.options.maxResponseTokens != null
                ? { maxTokens: this.options.maxResponseTokens }
                : {}),
              ...(this.options.temperature != null
                ? { temperature: this.options.temperature }
                : {}),
            }),
          new Error('LLM call'),
        );
      } catch (error) {
        ctx.errorCounts.fatal++;
        ctx.consecutiveErrors++;
        ctx.finalContent = `Agent loop failed at step ${ctx.stepCount}: ${(error as Error).message}`;
        break;
      }

      ctx.totalPromptTokens += response.usage?.promptTokens ?? 0;
      ctx.totalCompletionTokens += response.usage?.completionTokens ?? 0;

      if (this.options.costTracker && response.usage) {
        this.options.costTracker.record(
          response.model,
          response.usage.promptTokens,
          response.usage.completionTokens,
          response.usage.cachedPromptTokens ?? 0,
        );
      }

      // 4.2 Final response (no tool calls)
      if (!response.toolCalls || response.toolCalls.length === 0) {
        ctx.finalContent = response.content;
        ctx.messages.push({ role: 'assistant', content: response.content });
        if (ctx.handoff) {
          ctx.handoff.recordDecision(response.content.slice(0, 200), 'agent final response');
        }

        // Simulate streaming for UI
        for (let i = 0; i < response.content.length; i += 4) {
          yield { type: 'text', content: response.content.slice(i, i + 4) };
          if (_streamingCallback) await new Promise((r) => setTimeout(r, 8));
        }

        ctx.stepCount++;
        const stepResults = await pipeline.notify('onStepEnd', ctx);
        const shouldContinue = stepResults.some(
          (r) => r !== null && typeof r === 'object' && (r as any).handoff === true,
        );
        if (shouldContinue) {
          ctx.currentStepText = '';
          ctx.currentStepToolCalls = [];
          continue;
        }
        break;
      }

      // 4.3 Tool calls present
      ctx.messages.push({ role: 'assistant', content: response.content });
      ctx.currentStepToolCalls = response.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.arguments,
      }));

      const toolResults: { role: 'user'; content: string }[] = [];

      const READ_TOOL_NAMES = new Set([
        'read_file',
        'file_info',
        'list_directory',
        'glob',
        'grep',
        'search_memory',
        'recall',
        'query_decisions',
        'get_decision',
        'get_recent_events',
        'get_project_context',
        'get_captain_preferences',
        'list_workflows',
        'get_workflow',
        'list_agents',
        'list_projects',
        'list_scheduled_tasks',
        'search_documents',
        'web_fetch',
        'workspace_symbol',
        'go_to_definition',
        'find_references',
        'diagnostics',
        'recent_files',
        'watch_file',
      ]);
      const allReadOnly = response.toolCalls.every((tc) => READ_TOOL_NAMES.has(tc.name));

      if (allReadOnly) {
        // Parallel execution for read-only tools
        const pending = response.toolCalls.map(async (tc) => {
          const safetyResults = await pipeline.notify(
            'onToolCall',
            { id: tc.id, name: tc.name, args: tc.arguments },
            ctx,
          );
          const blocked = safetyResults.find(
            (r): r is { blocked: boolean; reason?: string } =>
              r !== null && typeof r === 'object' && (r as any).blocked === true,
          );
          if (blocked) {
            const blockedResult = `BLOCKED: ${blocked.reason}`;
            await pipeline.notify(
              'onToolResult',
              { id: tc.id, name: tc.name, args: tc.arguments },
              blockedResult,
              ctx,
            );
            return {
              role: 'user' as const,
              content: `Tool result for ${tc.name}: ${blockedResult}`,
              event: {
                type: 'tool_result' as const,
                id: tc.id,
                name: tc.name,
                result: blockedResult,
              },
            };
          }
          const execResult = await Promise.race([
            activeToolExecutor.execute(tc.name, tc.id, tc.arguments, {
              sessionId: this.options.sessionId,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Tool '${tc.name}' timed out`)),
                this.options.toolTimeoutMs ?? 300_000,
              ),
            ),
          ]);
          const result = execResult.error ?? execResult.output;
          await pipeline.notify(
            'onToolResult',
            { id: tc.id, name: tc.name, args: tc.arguments },
            result,
            ctx,
          );
          return {
            role: 'user' as const,
            content: `Tool result for ${tc.name}: ${JSON.stringify(result)}`,
            event: { type: 'tool_result' as const, id: tc.id, name: tc.name, result },
          };
        });
        const outcomes = await Promise.all(pending);
        for (const tc of response.toolCalls) {
          yield { type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments };
        }
        for (const outcome of outcomes) {
          yield outcome.event;
          toolResults.push({ role: outcome.role, content: outcome.content });
        }
      } else {
        for (const tc of response.toolCalls) {
          yield { type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments };

          const safetyResults = await pipeline.notify(
            'onToolCall',
            { id: tc.id, name: tc.name, args: tc.arguments },
            ctx,
          );
          const blocked = safetyResults.find(
            (r): r is { blocked: boolean; reason?: string } =>
              r !== null && typeof r === 'object' && (r as any).blocked === true,
          );

          if (blocked) {
            const blockedResult = `BLOCKED: ${blocked.reason}`;
            yield { type: 'tool_result', id: tc.id, name: tc.name, result: blockedResult };
            await pipeline.notify(
              'onToolResult',
              { id: tc.id, name: tc.name, args: tc.arguments },
              blockedResult,
              ctx,
            );
            toolResults.push({
              role: 'user',
              content: `Tool result for ${tc.name}: ${blockedResult}`,
            });
            continue;
          }

          let result: unknown;
          try {
            const execResult = await Promise.race([
              activeToolExecutor.execute(tc.name, tc.id, tc.arguments, {
                sessionId: this.options.sessionId,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Tool '${tc.name}' timed out`)),
                  this.options.toolTimeoutMs ?? 300_000,
                ),
              ),
            ]);
            result = execResult.error ?? execResult.output;
          } catch (timeoutError) {
            this.checkpointManager.save({
              sessionId: this.options.sessionId,
              step: ctx.stepCount,
              messages: ctx.messages,
              toolCallHistory: ctx.toolCallHistory,
              metadata: { projectId: this.options.projectId, crashed: true },
            });
            throw timeoutError;
          }

          yield { type: 'tool_result', id: tc.id, name: tc.name, result };
          await pipeline.notify(
            'onToolResult',
            { id: tc.id, name: tc.name, args: tc.arguments },
            result,
            ctx,
          );
          toolResults.push({
            role: 'user',
            content: `Tool result for ${tc.name}: ${JSON.stringify(result)}`,
          });
        }
      }

      ctx.messages.push(...toolResults);
      ctx.stepCount++;

      const stepResults = await pipeline.notify('onStepEnd', ctx);
      const shouldHandoff = stepResults.some(
        (r) => r !== null && typeof r === 'object' && (r as any).handoff === true,
      );
      if (shouldHandoff) {
        continue;
      }
    }

    // 5. Stream end
    await pipeline.notify('onStreamEnd', ctx);

    // 6. Persist conversation history for multi-turn continuity
    this.conversationHistory = [...ctx.messages];

    // 7. Session report
    this._reportSessionFromContext(ctx);

    yield {
      type: 'done',
      content: ctx.finalContent,
      steps: ctx.stepCount,
      toolCalls: ctx.toolCallHistory,
    };
  }

  private async _assembleContext(
    userMessage: string,
    resumeState?: CheckpointState | null,
  ): Promise<AgentExecutionContext> {
    // Try to restore from checkpoint
    const state = resumeState ?? this.checkpointManager.load(this.options.sessionId);
    const isResuming = state !== null && state !== undefined;
    const steps = state?.step ?? 0;
    const executedToolCalls: {
      name: string;
      args: Record<string, unknown>;
      result: unknown;
    }[] =
      (state?.toolCallHistory as {
        name: string;
        args: Record<string, unknown>;
        result: unknown;
      }[]) ?? [];

    const messages: { role: 'user' | 'assistant'; content: string }[] = state?.messages ?? [];
    const wasCrashed = (state?.metadata as Record<string, unknown>)?.crashed === true;
    if (wasCrashed) {
      messages.push({
        role: 'assistant',
        content:
          '[System: Previous session crashed. Resuming from checkpoint — some progress may have been lost. Review the last tool result for idempotency.]',
      });
    }

    // Merge conversation history
    if (this.conversationHistory.length > 0) {
      const existingContents = new Set(messages.map((m) => m.content));
      const newHistory = this.conversationHistory.filter((m) => !existingContents.has(m.content));
      messages.unshift(...newHistory);
    }

    // Deduplicate user message
    if (messages.length > 0 && messages[messages.length - 1]!.content === userMessage) {
      // already present
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    // Initialize or reuse handoff tracker
    if (!this.sessionHandoff) {
      this.sessionHandoff = new ContextHandoff(userMessage);
    }

    // Build context
    const ctxBuild = await this.contextBuilder.build({
      sessionId: this.options.sessionId,
      projectId: this.options.projectId,
      captainId: this.options.captainId,
      roleSystemPrompt: this.options.systemPrompt,
      activeFiles: this.options.activeFiles,
      taskDescription: steps === 0 ? this.options.taskDescription : undefined,
      memorySessionId: this.options.memorySessionId,
      prebuiltContext: this.options.prebuiltContext,
      roleModules: this.options.roleModules,
    });

    let sysPrompt = ctxBuild.systemPrompt;
    const projectRoot = this.options.projectRoot ?? process.cwd();
    const snapshot =
      ProjectSnapshot.getCached(projectRoot) ??
      (() => {
        const c = ProjectSnapshot.capture(projectRoot);
        ProjectSnapshot.store(projectRoot, c);
        return c;
      })();
    if (snapshot && !this.options.systemPrompt && !this.options.roleModules) {
      sysPrompt = `${sysPrompt}\n\n## Project Structure\n${snapshot.summary}\n\nKey directories:\n${snapshot.tree.slice(0, 20).join('\n')}`;
    }
    if (this.skillContext) {
      sysPrompt = `${sysPrompt}\n\n## Active Skill Context\n${this.skillContext}`;
      this.skillContext = null;
    }

    // Inject Blackboard snapshot (4.2)
    if (this.options.blackboard) {
      const bbSnapshot = this.options.blackboard.snapshot();
      if (bbSnapshot) {
        sysPrompt = injectBlackboardSnapshot(sysPrompt, bbSnapshot, 2000);
      }
    }

    // Inject MCP resources/prompts metadata (4.4)
    if (this.options.mcpResources && this.options.mcpResources.length > 0) {
      const resLines = this.options.mcpResources
        .map((r) => `- ${r.name}: ${r.uri}${r.description ? ` — ${r.description}` : ''}`)
        .join('\n');
      sysPrompt += `\n\n## Available MCP Resources\n${resLines}\n\nTo read a resource, include "read resource://<uri>" in your response.`;
    }
    if (this.options.mcpPrompts && this.options.mcpPrompts.length > 0) {
      const promptLines = this.options.mcpPrompts
        .map((p) => `- ${p.name}${p.description ? ` — ${p.description}` : ''}`)
        .join('\n');
      sysPrompt += `\n\n## Available MCP Prompts\n${promptLines}\n\nTo use a prompt, include "use prompt:<name>" in your response.`;
    }

    // Deduplicate context messages against internal history
    const internalContents = new Set(messages.map((m) => m.content));
    const uniqueCtxMessages = ctxBuild.messages.filter((m) => !internalContents.has(m.content));
    const allMsgs = [...uniqueCtxMessages, ...messages];

    return {
      sessionId: this.options.sessionId,
      projectId: this.options.projectId,
      captainId: this.options.captainId,
      model: this.options.model ?? 'claude-sonnet-4-6',
      messages: allMsgs,
      systemPrompt: sysPrompt,
      stepCount: steps,
      consecutiveErrors: 0,
      zoneCounts: { smart: 0, warning: 0, critical: 0, dumb: 0 },
      handoffCount: 0,
      errorCounts: { transient: 0, recoverable: 0, fatal: 0 },
      toolCounts: { total: 0, succeeded: 0, failed: 0, blocked: 0 },
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      zone: 'smart',
      toolCallHistory: executedToolCalls,
      zoneCrossings: [],
      currentStepText: '',
      currentStepToolCalls: [],
      handoff: this.sessionHandoff,
      finalContent: '',
      startTime: Date.now(),
    };
  }

  private _reportSessionFromContext(ctx: AgentExecutionContext): void {
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

  private _reportSession(
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
