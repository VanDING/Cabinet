import type { LLMGateway, LLMResponse, StreamingToolDefinition } from '@cabinet/gateway';
import type { EventBus } from '@cabinet/events';
import type { DelegationTier } from '@cabinet/types';
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
import { StateGraph, Annotation, END } from '@cabinet/graph';

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
  costTracker?: { record(model: string, promptTokens: number, completionTokens: number, cachedPromptTokens?: number): void };
  /** Pre-built context for strict consistency (skips self-collection in ContextBuilder). */
  prebuiltContext?: PrebuiltContext;
  /** User-configurable trust level (T0-T3) for error tolerance and tool limits. */
  trustLevel?: TrustLevel;
  /** Optional dynamic tool pruner — reduces exposed tools per-turn by task relevance. */
  toolPruner?: ToolPruner;
  /** Role modules for modular prompt assembly (preferred over systemPrompt). */
  roleModules?: PromptModules;
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
    case 'startMeeting':
      return 'Start meeting';
    default:
      return toolName;
  }
}

const AgentStateSchema = {
  messages: Annotation<{ role: 'user' | 'assistant'; content: string }[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [] as { role: 'user' | 'assistant'; content: string }[],
  }),
  executedToolCalls: Annotation<{ name: string; args: Record<string, unknown>; result: unknown }[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [] as { name: string; args: Record<string, unknown>; result: unknown }[],
  }),
  systemPrompt: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  contextZone: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => 'smart',
  }),
  stepCount: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  consecutiveErrors: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  handoffActive: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  finalContent: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  _pendingToolCalls: Annotation<LLMResponse['toolCalls']>({
    reducer: (_a, b) => b,
    default: () => undefined,
  }),
};

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
  /** In-memory checkpoint buffer for async batch writes. */
  private pendingCheckpoint: CheckpointState | null = null;
  private lastSavedStep = 0;
  /** Conversation history persisted across continueWithUserInput calls. */
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  /** One-shot skill context to inject into the system prompt on the next run. */
  private skillContext: string | null = null;

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
  }

  /** Resolve the active tool executor, applying dynamic pruning if configured.
   *  Falls back to the full tool set on any pruning failure to avoid blocking execution. */
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

  /** Set a callback for session observability (after construction). */
  set onSessionComplete(callback: SessionCompleteCallback | undefined) {
    this.options.onSessionComplete = callback;
  }
  /** Expose the context monitor for external querying. */
  get monitor(): ContextMonitor | null {
    return this.contextMonitor;
  }

  /** Update delegation tier on the cached safety checker (called when user changes tier in UI). */
  setDelegationTier(tier: DelegationTier): void {
    this.safetyChecker.setTier(tier);
  }

  async run(userMessage: string, resumeState?: CheckpointState | null): Promise<AgentResult> {
    const maxSteps = this.options.maxSteps ?? 50;
    const startTime = Date.now();

    // Try to restore from checkpoint (unless caller already provided state)
    const state = resumeState ?? this.checkpointManager.load(this.options.sessionId);
    const isResuming = state !== null && state !== undefined;
    let steps = state?.step ?? 0;
    const executedToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] =
      (state?.toolCallHistory as { name: string; args: Record<string, unknown>; result: unknown }[]) ?? [];

    // If resuming from a crashed session, skip re-adding the user message (it's already in checkpoint)
    let messages: { role: 'user' | 'assistant'; content: string }[] = state?.messages ?? [];
    const wasCrashed = (state?.metadata as Record<string, unknown>)?.crashed === true;
    if (wasCrashed) {
      messages.push({
        role: 'assistant',
        content: '[System: Previous session crashed. Resuming from checkpoint — some progress may have been lost. Review the last tool result for idempotency.]',
      });
    }

    // Observability tracking
    const zoneCounts = { smart: 0, warning: 0, critical: 0, dumb: 0 };
    let handoffCount = 0;
    const errorCounts = { transient: 0, recoverable: 0, fatal: 0 };
    const toolCounts = { total: 0, succeeded: 0, failed: 0, blocked: 0 };
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // Add user message — always deduplicate against last message in history
    if (messages.length > 0) {
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

    let warnedThreshold = false;
    let consecutiveErrors = 0;
    const trust = TRUST_THRESHOLDS[this.options.trustLevel ?? 'T1'];
    const activeToolExecutor = await this.resolveToolExecutor(this.options.taskDescription);

    // Wrap mutable counters in object refs for closure capture in graph nodes
    const counters = {
      zoneCounts,
      handoffCount,
      errorCounts,
      toolCounts,
      totalPromptTokens,
      totalCompletionTokens,
      consecutiveErrors,
    };

    // Build and compile the graph
    const graph = this.buildRunGraph(
      maxSteps, trust, activeToolExecutor, handoff,
      executedToolCalls, counters, isResuming,
    );

    const compileResult = graph.compile({ entry: 'buildContext' });
    if (!compileResult.ok) {
      const errMsgs = compileResult.errors?.map((e) => e.message).join('; ') ?? 'unknown';
      this.reportSession(startTime, steps, executedToolCalls, counters.totalPromptTokens,
        counters.totalCompletionTokens, zoneCounts, handoffCount, errorCounts, toolCounts, false);
      this.flushCheckpoint();
      this.checkpointManager.delete(this.options.sessionId);
      this.pendingCheckpoint = null;
      return { content: `Graph compilation failed: ${errMsgs}`, steps, toolCalls: executedToolCalls };
    }

    const initialState = {
      messages,
      executedToolCalls,
      stepCount: steps,
      consecutiveErrors: 0,
      handoffActive: false,
      finalContent: '',
      systemPrompt: '',
      contextZone: 'smart',
      _pendingToolCalls: undefined,
    } as any;

    let finalState: Record<string, unknown>;
    try {
      finalState = await compileResult.graph!.invoke(initialState, { maxSteps: maxSteps * 5 });
    } catch (error) {
      counters.errorCounts.fatal++;
      this.reportSession(startTime, steps, executedToolCalls, counters.totalPromptTokens,
        counters.totalCompletionTokens, zoneCounts, handoffCount, errorCounts, toolCounts, false);
      this.flushCheckpoint();
      this.checkpointManager.delete(this.options.sessionId);
      this.pendingCheckpoint = null;
      return {
        content: `Agent loop failed: ${(error as Error).message}`,
        steps,
        toolCalls: executedToolCalls,
      };
    }

    const finalContent: string = (finalState.finalContent as string) ||
      `Agent reached max steps (${maxSteps}) without final response.`;
    const finalSteps: number = (finalState.stepCount as number) ?? steps;
    const finalMessages = (finalState.messages as { role: 'user' | 'assistant'; content: string }[]) ?? [];

    if (finalContent) {
      this.reportSession(startTime, finalSteps, executedToolCalls, counters.totalPromptTokens,
        counters.totalCompletionTokens, zoneCounts, handoffCount, errorCounts, toolCounts, true);
      this.flushCheckpoint();
      this.checkpointManager.delete(this.options.sessionId);
      this.pendingCheckpoint = null;
      this.conversationHistory = [...finalMessages];
      return {
        content: finalContent,
        steps: finalSteps,
        toolCalls: executedToolCalls,
        usage: { promptTokens: counters.totalPromptTokens, completionTokens: counters.totalCompletionTokens },
        structuredOutput: parseStructuredOutput(finalContent),
      };
    }

    this.reportSession(startTime, finalSteps, executedToolCalls, counters.totalPromptTokens,
      counters.totalCompletionTokens, zoneCounts, handoffCount, errorCounts, toolCounts, false);
    this.flushCheckpoint();
    this.checkpointManager.delete(this.options.sessionId);
    this.pendingCheckpoint = null;
    this.conversationHistory = [...finalMessages];
    return {
      content: finalContent,
      steps: finalSteps,
      toolCalls: executedToolCalls,
    };
  }

  private buildRunGraph(
    maxSteps: number,
    trust: { maxConsecutiveErrors: number; maxProbeTools: number },
    activeToolExecutor: ToolExecutor,
    handoff: ContextHandoff,
    executedToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[],
    counters: {
      zoneCounts: { smart: number; warning: number; critical: number; dumb: number };
      handoffCount: number;
      errorCounts: { transient: number; recoverable: number; fatal: number };
      toolCounts: { total: number; succeeded: number; failed: number; blocked: number };
      totalPromptTokens: number;
      totalCompletionTokens: number;
      consecutiveErrors: number;
    },
    isResuming: boolean,
  ): StateGraph<typeof AgentStateSchema> {
    const self = this;

    const READ_TOOL_NAMES = new Set([
      'read_file', 'file_info', 'list_directory', 'glob', 'grep',
      'search_memory', 'recall', 'query_decisions', 'get_decision',
      'get_recent_events', 'get_project_context', 'get_captain_preferences',
      'list_workflows', 'get_workflow', 'list_agents', 'list_projects',
      'list_scheduled_tasks', 'search_documents', 'web_fetch',
      'workspace_symbol', 'go_to_definition', 'find_references', 'diagnostics',
      'recent_files', 'watch_file',
    ]);

    return new StateGraph(AgentStateSchema)
      // ── Node: buildContext ──
      .addNode('buildContext', async (s) => {
        const ctx = await self.contextBuilder.build({
          sessionId: self.options.sessionId,
          projectId: self.options.projectId,
          captainId: self.options.captainId,
          roleSystemPrompt: self.options.systemPrompt,
          activeFiles: self.options.activeFiles,
          taskDescription: s.stepCount === 0 ? self.options.taskDescription : undefined,
          memorySessionId: self.options.memorySessionId,
          prebuiltContext: self.options.prebuiltContext,
          roleModules: self.options.roleModules,
        });

        let sysPrompt = ctx.systemPrompt;
        const projectRoot = self.options.projectRoot ?? process.cwd();
        const snapshot = ProjectSnapshot.getCached(projectRoot)
          ?? (() => { const c = ProjectSnapshot.capture(projectRoot); ProjectSnapshot.store(projectRoot, c); return c; })();
        if (snapshot && !self.options.systemPrompt && !self.options.roleModules) {
          sysPrompt = `${sysPrompt}\n\n## Project Structure\n${snapshot.summary}\n\nKey directories:\n${snapshot.tree.slice(0, 20).join('\n')}`;
        }
        if (self['skillContext']) {
          sysPrompt = `${sysPrompt}\n\n## Active Skill Context\n${self['skillContext']}`;
          self['skillContext'] = null;
        }

        const internalContents = new Set(s.messages.map((m) => m.content));
        const uniqueCtxMessages = ctx.messages.filter((m) => !internalContents.has(m.content));
        const allMsgs = [...uniqueCtxMessages, ...s.messages];

        return { systemPrompt: sysPrompt, messages: allMsgs };
      })
      // ── Node: contextCheck ──
      .addNode('contextCheck', async (s) => {
        if (!self.contextMonitor) return { contextZone: 'smart' };
        const breakdown: ContextBreakdown = {
          systemPrompt: self.contextMonitor.estimateTokens(s.systemPrompt),
          messages: self.contextMonitor.estimateTokens(s.messages.map((m) => m.content).join('\n')),
          toolResults: self.contextMonitor.estimateTokens(
            s.messages.filter((m) => m.role === 'user' && m.content.startsWith('Tool result'))
              .map((m) => m.content).join('\n'),
          ),
          memory: 0,
        };
        const snap = self.contextMonitor.snapshot(breakdown);
        counters.zoneCounts[snap.zone]++;
        return { contextZone: snap.zone };
      })
      // ── Node: compressContext ──
      .addNode('compressContext', async (s) => {
        if (!self.contextMonitor) return { handoffActive: false };
        const snap = self.contextMonitor.current;
        if (!snap) return { handoffActive: false };
        if (!handoff.shouldHandoff(snap)) return { handoffActive: false };

        const result = handoff.performHandoff(snap);
        counters.handoffCount++;

        const keepRecent = 4;
        const recentMessages = s.messages.slice(-keepRecent);
        const middleMessages = s.messages.slice(0, -keepRecent);
        const middleSummary = middleMessages.length > 0
          ? `${middleMessages.length} prior messages summarized.`
          : '';
        const newMessages: { role: 'user' | 'assistant'; content: string }[] = [
          { role: 'user', content: result.handoffMessage },
          ...(middleMessages.length > 0
            ? [{ role: 'assistant' as const, content: `[context_compact] ${middleSummary}` }]
            : []),
          ...recentMessages,
        ];
        handoff.reset();
        return { messages: newMessages, handoffActive: false };
      })
      // ── Node: llm ──
      .addNode('llm', async (s) => {
        if (counters.consecutiveErrors >= trust.maxConsecutiveErrors) {
          const msg = `Agent stopped after ${counters.consecutiveErrors} consecutive errors (trust level: ${self.options.trustLevel ?? 'T1'}).`;
          return { finalContent: msg };
        }

        let response: LLMResponse;
        try {
          response = await withRetry(
            () => self.gateway.generateText({
              model: self.options.model ?? 'claude-sonnet-4-6',
              systemPrompt: s.systemPrompt,
              messages: s.messages,
              tools: activeToolExecutor.getToolDescriptors(),
              cacheSystemPrompt: true,
              ...(self.options.maxResponseTokens != null ? { maxTokens: self.options.maxResponseTokens } : {}),
              ...(self.options.temperature != null ? { temperature: self.options.temperature } : {}),
            }),
            new Error('LLM call'),
          );
        } catch (_error) {
          counters.errorCounts.fatal++;
          return { consecutiveErrors: s.consecutiveErrors + 1, finalContent: `Agent loop failed at step ${s.stepCount}: ${(_error as Error).message}` };
        }

        counters.totalPromptTokens += response.usage?.promptTokens ?? 0;
        counters.totalCompletionTokens += response.usage?.completionTokens ?? 0;

        if (self.options.costTracker && response.usage) {
          self.options.costTracker.record(
            response.model,
            response.usage.promptTokens,
            response.usage.completionTokens,
            response.usage.cachedPromptTokens ?? 0,
          );
        }

        if (!response.toolCalls || response.toolCalls.length === 0) {
          const finalText = response.content;
          handoff.recordDecision(response.content.slice(0, 200), 'agent final response');
          return {
            messages: [...s.messages, { role: 'assistant' as const, content: finalText }],
            finalContent: finalText,
            stepCount: s.stepCount + 1,
            consecutiveErrors: 0,
          };
        }

        const assistantMsg = { role: 'assistant' as const, content: response.content };
        return {
          messages: [...s.messages, assistantMsg],
          stepCount: s.stepCount + 1,
          consecutiveErrors: 0,
          _pendingToolCalls: response.toolCalls as any,
        };
      })
      // ── Node: safetyCheck ──
      .addNode('safetyCheck', (s) => {
        const tcs = (s._pendingToolCalls ?? []) as NonNullable<LLMResponse['toolCalls']>;
        if (tcs.length === 0) return {};
        const allAllowed = tcs.every((tc) => self.safetyChecker.check(tc.name, tc.arguments).allowed);
        if (allAllowed) return {};
        // At least one blocked — mark it
        for (const tc of tcs) {
          const safety = self.safetyChecker.check(tc.name, tc.arguments);
          if (!safety.allowed) {
            counters.toolCounts.blocked++;
            counters.toolCounts.total++;
            executedToolCalls.push({
              name: tc.name,
              args: tc.arguments,
              result: `BLOCKED: ${safety.reason}`,
            });
          }
        }
        return { _pendingToolCalls: undefined };
      })
      // ── Node: tools ──
      .addNode('tools', async (s) => {
        const tcs = (s._pendingToolCalls ?? []) as NonNullable<LLMResponse['toolCalls']>;
        if (tcs.length === 0) return {};

        const allReadOnly = tcs.every((tc) => READ_TOOL_NAMES.has(tc.name));
        const results: { role: 'user'; content: string }[] = [];

        const executeOne = async (tc: { id: string; name: string; arguments: Record<string, unknown> }) => {
          counters.toolCounts.total++;

          if (isResuming) {
            const alreadyDone = executedToolCalls.find(
              (prev) => prev.name === tc.name &&
                JSON.stringify(prev.args) === JSON.stringify(tc.arguments) &&
                prev.result !== undefined,
            );
            if (alreadyDone) {
              counters.toolCounts.succeeded++;
              return { role: 'user' as const, content: `Tool result for ${tc.name} (cached): ${JSON.stringify(alreadyDone.result)}` };
            }
          }

          try {
            const result = await Promise.race([
              self.toolExecutor.execute(tc.name, tc.id, tc.arguments, { sessionId: self.options.sessionId }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Tool '${tc.name}' timed out`)),
                self.options.toolTimeoutMs ?? 300000),
              ),
            ]);
            if (result.error) {
              counters.toolCounts.failed++;
              counters.consecutiveErrors++;
            } else {
              counters.toolCounts.succeeded++;
              counters.consecutiveErrors = 0;
            }
            executedToolCalls.push({ name: tc.name, args: tc.arguments, result: result.error ?? result.output });
            const errorLabel = result.errorType ? `[${result.errorType}] ` : '';
            handoff.recordToolResult(`${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}): ${errorLabel}${JSON.stringify(result.error ?? result.output).slice(0, 80)}`);
            return { role: 'user' as const, content: `Tool result for ${tc.name}: ${errorLabel}${JSON.stringify(result.error ?? result.output)}` };
          } catch (timeoutError) {
            self.pendingCheckpoint = {
              sessionId: self.options.sessionId,
              step: s.stepCount,
              messages: s.messages,
              toolCallHistory: executedToolCalls,
              metadata: { projectId: self.options.projectId, crashed: true },
            };
            self.flushCheckpoint();
            throw timeoutError;
          }
        };

        if (allReadOnly) {
          const outcomes = await Promise.all(tcs.map(executeOne));
          results.push(...outcomes);
        } else {
          for (const tc of tcs) {
            results.push(await executeOne(tc));
          }
        }

        // Buffer checkpoint every 5 steps
        if (s.stepCount - (self as any).lastSavedStep >= 5) {
          self.pendingCheckpoint = {
            sessionId: self.options.sessionId,
            step: s.stepCount,
            messages: s.messages,
            toolCallHistory: executedToolCalls,
            metadata: { projectId: self.options.projectId },
          };
          self.flushCheckpoint();
        }

        const executedCount = executedToolCalls.filter((t) => !String(t.result).includes('BLOCKED')).length;
        handoff.recordStep(`Step ${s.stepCount}: ${executedCount} tool calls executed in ${self.contextMonitor?.current?.zone ?? 'unknown'} zone`);

        return { messages: [...s.messages, ...results], _pendingToolCalls: undefined };
      })
      // ── Edges ──
      .addEdge('buildContext', 'contextCheck')
      .addConditionalEdges('contextCheck', (s) => {
        if (s.contextZone === 'critical' || s.contextZone === 'dumb') {
          if (self.contextMonitor && handoff.shouldHandoff(self.contextMonitor.current!)) {
            return 'compress';
          }
        }
        return 'llm';
      }, { compress: 'compressContext', llm: 'llm', '__default__': 'llm' })
      .addEdge('compressContext', 'contextCheck')
      .addConditionalEdges('llm', (s) => {
        if (s.finalContent) return 'done';
        if (s._pendingToolCalls && (s._pendingToolCalls as any[]).length > 0) return 'safety';
        return 'done';
      }, { safety: 'safetyCheck', done: '__END__', '__default__': '__END__' })
      .addConditionalEdges('safetyCheck', (s) => {
        const tcs = (s._pendingToolCalls ?? []) as any[];
        if (tcs.length === 0) return 'llm';
        return 'tools';
      }, { tools: 'tools', llm: 'llm', '__default__': 'llm' })
      .addEdge('tools', 'llm')
      .addErrorEdge('tools', 'llm');
  }

  private reportSession(
    startTime: number,
    steps: number,
    toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[],
    promptTokens: number,
    completionTokens: number,
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
      totalTokens: { prompt: promptTokens, completion: completionTokens },
      toolCalls: tools,
      contextZones: zones,
      contextHandoffs: handoffs,
      errors,
      durationMs: Date.now() - startTime,
      success,
      startTime: new Date(startTime).toISOString(),
      toolCallHistory: toolCalls,
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

  /**
   * Streaming variant of run(). Uses gateway.streamText() for real token-level
   * streaming with tool calling via AI SDK maxSteps. Does NOT support checkpoint
   * resumption or context monitoring (use run() for those).
   */
  async runStreaming(userMessage: string, callback: StreamingCallback): Promise<AgentResult> {
    const startTime = Date.now();
    const executedToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] =
      [];
    const errorCounts = { transient: 0, recoverable: 0, fatal: 0 };
    const toolCounts = { total: 0, succeeded: 0, failed: 0, blocked: 0 };

    // Build context
    const ctx = await this.contextBuilder.build({
      sessionId: this.options.sessionId,
      projectId: this.options.projectId,
      captainId: this.options.captainId,
      roleSystemPrompt: this.options.systemPrompt,
      activeFiles: this.options.activeFiles,
      taskDescription: this.options.taskDescription,
      memorySessionId: this.options.memorySessionId,
      prebuiltContext: this.options.prebuiltContext,
      roleModules: this.options.roleModules,
    });

    // Resolve pruned tool set for this task
    const activeToolExecutor = await this.resolveToolExecutor(this.options.taskDescription);

    // Inject project snapshot into system prompt for streaming too
    let streamingSystemPrompt = ctx.systemPrompt;
    const streamingRoot = this.options.projectRoot ?? process.cwd();
    const snap = ProjectSnapshot.getCached(streamingRoot);
    if (snap && !this.options.systemPrompt) {
      streamingSystemPrompt = `${streamingSystemPrompt}\n\n## Project Structure\n${snap.summary}\n\nKey directories:\n${snap.tree.slice(0, 20).join('\n')}`;
    }

    // One-shot skill context injection
    if (this.skillContext) {
      streamingSystemPrompt = `${streamingSystemPrompt}\n\n## Active Skill Context\n${this.skillContext}`;
      this.skillContext = null;
    }

    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...ctx.messages.map((m) => ({ role: m.role, content: m.content })),
      ...this.conversationHistory,
      { role: 'user' as const, content: userMessage },
    ];

    // Convert ToolExecutor tools to StreamingToolDefinition
    const toolDescriptors = activeToolExecutor.getToolDescriptors();
    const streamingTools: StreamingToolDefinition[] = toolDescriptors.map((td) => ({
      name: td.name,
      description: td.description,
      parameters: td.parameters,
      execute: async (args: Record<string, unknown>) => {
        const safety = this.safetyChecker.check(td.name, args);
        if (!safety.allowed) {
          toolCounts.blocked++;
          return `BLOCKED: ${safety.reason}`;
        }
        toolCounts.total++;
        const start = Date.now();
        try {
          const result = await this.toolExecutor.execute(td.name, `stream_${Date.now()}`, args, {
            sessionId: this.options.sessionId,
          });
          if (result.error) {
            toolCounts.failed++;
          } else {
            toolCounts.succeeded++;
          }
          executedToolCalls.push({ name: td.name, args, result: result.error ?? result.output });
          return result.error ?? result.output;
        } catch (e) {
          toolCounts.failed++;
          throw e;
        }
      },
    }));

    const taskTracker = new TaskTracker();
    const semanticTracker = new SemanticTaskTracker();
    const taskMap = new Map<string, string>(); // toolCallId -> taskId
    let fullText = '';
    let estimatedSteps = 1;
    let afterToolResult = false;
    let warnedBudget = false;
    const maxSteps = this.options.maxSteps ?? 50;
    try {
      for await (const chunk of this.gateway.streamText({
        model: this.options.model ?? 'claude-sonnet-4-6',
        systemPrompt: streamingSystemPrompt,
        messages,
        tools: streamingTools,
        maxSteps,
        ...(this.options.maxResponseTokens != null
          ? { maxTokens: this.options.maxResponseTokens }
          : {}),
        ...(this.options.temperature != null ? { temperature: this.options.temperature } : {}),
        ...(this.options.thinkingBudget != null
          ? { thinkingBudget: this.options.thinkingBudget }
          : {}),
      })) {
        // Step boundary detection: after a tool_result, the next LLM output starts a new step
        if (
          afterToolResult &&
          (chunk.type === 'text' || chunk.type === 'tool_call' || chunk.type === 'thinking')
        ) {
          estimatedSteps++;
          afterToolResult = false;
          semanticTracker.completeCurrentStep();
          // Budget warning
          const remaining = maxSteps - estimatedSteps;
          if (!warnedBudget && remaining <= Math.ceil(maxSteps * 0.25)) {
            warnedBudget = true;
            callback.onStepBudgetWarning?.(remaining, maxSteps);
          }
        }

        if (chunk.type === 'thinking') {
          callback.onThinking?.(chunk.content ?? '');
        } else if (chunk.type === 'thinking_done') {
          callback.onThinkingDone?.();
        } else if (chunk.type === 'text') {
          fullText += chunk.content ?? '';
          callback.onChunk(chunk.content ?? '');
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          const taskName = formatToolTaskName(chunk.toolCall.name, chunk.toolCall.args);
          const taskId = taskTracker.addTask(taskName);
          taskMap.set(chunk.toolCall.id, taskId);
          callback.onTaskUpdate?.(taskTracker.getTasks());
          callback.onToolCall?.(chunk.toolCall.name, chunk.toolCall.args);
          // Semantic task tracking
          const commandHint =
            chunk.toolCall.name === 'execCommand' || chunk.toolCall.name === 'exec_command'
              ? String(chunk.toolCall.args?.command ?? '')
              : undefined;
          semanticTracker.addToolCall(chunk.toolCall.id, chunk.toolCall.name, commandHint);
          callback.onSemanticTaskUpdate?.(semanticTracker.getTasks());
        } else if (chunk.type === 'tool_result' && chunk.toolResult) {
          afterToolResult = true;
          const taskId = taskMap.get(chunk.toolResult.id);
          if (taskId) {
            const hasError =
              typeof chunk.toolResult.result === 'string' &&
              chunk.toolResult.result.startsWith('Error');
            taskTracker.completeTask(taskId, !hasError);
            callback.onTaskUpdate?.(taskTracker.getTasks());
          }
          callback.onToolResult?.(chunk.toolResult.name, chunk.toolResult.result);
        } else if (chunk.type === 'error') {
          errorCounts.fatal++;
          callback.onError?.(chunk.content ?? 'Unknown streaming error');
        } else if (chunk.type === 'done') {
          if (chunk.usage) {
            callback.onUsage?.(chunk.usage);
          }
          // Prefer real step count from gateway if available, else fallback to estimate
          if (typeof chunk.steps === 'number' && chunk.steps > 0) {
            estimatedSteps = chunk.steps;
          }
        }
      }
    } catch (e) {
      errorCounts.fatal++;
      const msg = (e as Error).message;
      callback.onError?.(msg);
      semanticTracker.finalizeAll(false);
      this.reportSession(
        startTime,
        0,
        executedToolCalls,
        0,
        0,
        { smart: 0, warning: 0, critical: 0, dumb: 0 },
        0,
        errorCounts,
        toolCounts,
        false,
      );
      return { content: `Streaming error: ${msg}`, steps: 0, toolCalls: executedToolCalls };
    }

    // Append incomplete marker if max steps was likely reached
    const effectiveSteps = estimatedSteps;
    if (effectiveSteps >= maxSteps && !fullText.includes('[INCOMPLETE: max_steps_reached]')) {
      fullText += '\n\n[INCOMPLETE: max_steps_reached]';
    }

    semanticTracker.finalizeAll(true);
    callback.onSemanticTaskUpdate?.(semanticTracker.getTasks());
    callback.onDone(fullText);
    this.reportSession(
      startTime,
      estimatedSteps,
      executedToolCalls,
      0,
      0,
      { smart: 1, warning: 0, critical: 0, dumb: 0 },
      0,
      errorCounts,
      toolCounts,
      true,
    );
    // Reconstruct conversation history from streaming context
    this.conversationHistory = [
      ...this.conversationHistory,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: fullText },
      ...executedToolCalls.map((tc) => ({
        role: 'user' as const,
        content: `Tool result for ${tc.name}: ${JSON.stringify(tc.result)}`,
      })),
    ];
    return {
      content: fullText,
      steps: estimatedSteps,
      toolCalls: executedToolCalls,
      structuredOutput: parseStructuredOutput(fullText),
    };
  }

  /** Flush the in-memory checkpoint to persistent storage synchronously. */
  private flushCheckpoint(): void {
    if (!this.pendingCheckpoint) return;
    this.checkpointManager.save(this.pendingCheckpoint);
    this.lastSavedStep = this.pendingCheckpoint.step;
  }

  /** Resume from a saved checkpoint (prefer in-memory buffer if available). */
  async resume(userMessage: string): Promise<AgentResult> {
    const state = this.pendingCheckpoint ?? this.checkpointManager.load(this.options.sessionId);
    if (!state) {
      return this.run(userMessage);
    }
    return this.run(userMessage, state);
  }

  /**
   * Continue an ongoing interactive session with additional user input.
   * Preserves conversation history and re-uses the same AgentLoop configuration.
   * Suitable for sub-agents that support mid-flight user refinement.
   */
  async continueWithUserInput(
    input: string,
    callback: StreamingCallback,
  ): Promise<AgentResult> {
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

  /** Set one-shot skill context to be injected into the system prompt on the next run. */
  setSkillContext(context: string | null): void {
    this.skillContext = context;
  }
}
