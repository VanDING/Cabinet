import type { LLMGateway, LLMResponse, StreamingToolDefinition } from '@cabinet/gateway';
import type { EventBus } from '@cabinet/events';
import type { DelegationTier } from '@cabinet/types';
import { ToolExecutor } from './tool-executor.js';
import { SafetyChecker } from './safety.js';
import { withRetry } from './retry.js';
import { CheckpointManager, type CheckpointState } from './checkpoint.js';
import { ContextBuilder, type MemoryProvider, type ContextBuildResult } from './context-builder.js';
import { ContextMonitor, type ContextBreakdown } from './context-monitor.js';
import { ContextHandoff } from './context-handoff.js';
import { TaskTracker, type AgentTask } from './task-tracker.js';
import { ProjectSnapshot } from './project-snapshot.js';

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
  // Sub-agent orchestration events
  onSubAgentStart?(agentName: string, taskDescription: string): void;
  onSubAgentToolCall?(agentName: string, toolName: string, args: Record<string, unknown>): void;
  onSubAgentThinking?(agentName: string, content: string): void;
  onSubAgentDone?(agentName: string, result: string): void;
  onSubAgentError?(agentName: string, error: string): void;
  onDone(fullContent: string): void;
  onError?(error: string): void;
}

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
/** Try to extract a structured AgentOutput from LLM text containing a ```json block. */
function parseStructuredOutput(content: string): import('@cabinet/types').AgentOutput | undefined {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]!);
    if (parsed && typeof parsed === 'object' && (parsed.summary || parsed.findings || parsed.decisions)) {
      return {
        summary: String(parsed.summary ?? ''),
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        suggestedNextSteps: Array.isArray(parsed.suggestedNextSteps) ? parsed.suggestedNextSteps : [],
      };
    }
  } catch {
    // Ignore malformed JSON
  }
  return undefined;
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

  constructor(options: AgentLoopOptions) {
    this.gateway = options.gateway;
    this.toolExecutor = options.toolExecutor;
    this.safetyChecker = options.safetyChecker;
    this.checkpointManager = options.checkpointManager;
    this.contextBuilder = new ContextBuilder(options.memoryProvider);
    this.contextMonitor = options.eventBus
      ? ContextMonitor.forModel(options.model ?? 'claude-sonnet-4-6', options.eventBus, options.contextBudget)
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

    while (steps < maxSteps) {
      // Build context (reload short-term memory each iteration)
      const ctx: ContextBuildResult = await this.contextBuilder.build({
        sessionId: this.options.sessionId,
        projectId: this.options.projectId,
        captainId: this.options.captainId,
        systemPrompt: this.options.systemPrompt,
        activeFiles: this.options.activeFiles,
        taskDescription: this.options.taskDescription,
        memorySessionId: this.options.memorySessionId,
      });

      // ── Project snapshot injection ──
      let systemPrompt = ctx.systemPrompt;
      const snapshot = ProjectSnapshot.getCached(this.options.sessionId)
        ?? (() => {
          const captured = ProjectSnapshot.capture(this.options.projectRoot ?? process.cwd());
          ProjectSnapshot.store(this.options.sessionId, captured);
          return captured;
        })();
      if (snapshot && !this.options.systemPrompt) {
        systemPrompt = `${systemPrompt}\n\n## Project Structure\n${snapshot.summary}\n\nKey directories:\n${snapshot.tree.slice(0, 20).join('\n')}`;
      }

      // Combine system context messages with conversation messages
      const allMessages = [...ctx.messages, ...messages];

      // ── Context Utilization Check (before LLM call) ──
      if (this.contextMonitor) {
        const breakdown: ContextBreakdown = {
          systemPrompt: this.contextMonitor.estimateTokens(systemPrompt),
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
            // Soft handoff: preserve last 2 turns (up to 4 messages) and compress middle
            const keepRecent = 4;
            const recentMessages = messages.slice(-keepRecent);
            const middleMessages = messages.slice(0, -keepRecent);
            const middleSummary = middleMessages.length > 0
              ? `${middleMessages.length} prior messages summarized. Latest: ${middleMessages[middleMessages.length - 1]?.content.slice(0, 200) ?? ''}`
              : '';
            messages = [
              { role: 'user', content: result.handoffMessage },
              ...(middleMessages.length > 0
                ? [{ role: 'assistant' as const, content: `[context_compact] ${middleSummary}` }]
                : []),
              ...recentMessages,
            ];
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
              systemPrompt: systemPrompt,
              messages: allMessages,
              cacheSystemPrompt: true,
              ...(this.options.maxResponseTokens != null ? { maxTokens: this.options.maxResponseTokens } : {}),
              ...(this.options.temperature != null ? { temperature: this.options.temperature } : {}),
            }),
          new Error('LLM call'),
        );
      } catch (error) {
        errorCounts.fatal++;
        this.reportSession(startTime, steps, executedToolCalls, totalPromptTokens, totalCompletionTokens,
          zoneCounts, handoffCount, errorCounts, toolCounts, false);
        this.flushCheckpoint();
        this.checkpointManager.delete(this.options.sessionId);
        this.pendingCheckpoint = null;
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
        this.flushCheckpoint();
        this.checkpointManager.delete(this.options.sessionId);
        this.pendingCheckpoint = null;
        return {
          content: response.content,
          steps: steps + 1,
          toolCalls: executedToolCalls,
          usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
          structuredOutput: parseStructuredOutput(response.content),
        };
      }

      // ── Read-only tool names that can safely execute in parallel ──
      const READ_TOOL_NAMES = new Set([
        'read_file', 'file_info', 'list_directory', 'glob', 'grep',
        'search_memory', 'recall', 'query_decisions', 'get_decision',
        'get_recent_events', 'get_project_context', 'get_captain_preferences',
        'list_workflows', 'get_workflow', 'list_agents', 'list_projects',
        'list_scheduled_tasks', 'search_documents', 'web_fetch',
        'workspace_symbol', 'go_to_definition', 'find_references', 'diagnostics',
        'recent_files', 'watch_file',
      ]);

      // ── Write tool names that can parallelize when operating on different paths ──
      const WRITE_TOOL_NAMES = new Set([
        'write_file', 'edit_file', 'apply_patch', 'move_file', 'copy_file', 'make_directory',
        'delete_file', 'execute_command',
      ]);

      function hasResourceConflict(toolCalls: { name: string; arguments: Record<string, unknown> }[]): boolean {
        const filePaths = new Set<string>();
        for (const tc of toolCalls) {
          const fp = tc.arguments?.filePath as string | undefined;
          if (!fp) continue;
          if (filePaths.has(fp)) return true;
          filePaths.add(fp);
        }
        return false;
      }

      // Determine if all tool calls in this step are independent read-only operations
      const allReadOnly = response.toolCalls.every(tc => READ_TOOL_NAMES.has(tc.name));
      const uniqueResources = new Set(response.toolCalls.map(tc =>
        JSON.stringify({name: tc.name, filePath: tc.arguments?.filePath, query: tc.arguments?.query, pattern: tc.arguments?.pattern})
      ));
      const canParallelizeReads = allReadOnly && uniqueResources.size === response.toolCalls.length;

      // Write tools: parallel if operating on DIFFERENT file paths
      const allWrite = response.toolCalls.every(tc => WRITE_TOOL_NAMES.has(tc.name));
      const canParallelizeWrites = allWrite && !hasResourceConflict(response.toolCalls);

      const canParallelize = canParallelizeReads || canParallelizeWrites;

      // ── Execute a single tool call (used by both sequential and parallel paths) ──
      const executeOneTool = async (tc: { id: string; name: string; arguments: Record<string, unknown> }) => {
        // Per-tool timeout lookup
        const toolDef = this.toolExecutor.getToolDescriptor(tc.name);
        const toolTimeoutMs = toolDef?.timeoutMs ?? this.options.toolTimeoutMs ?? 300000;

        toolCounts.total++;

        // Idempotency check on resume: skip already-executed tool calls
        if (isResuming) {
          const alreadyDone = executedToolCalls.find(
            (prev) =>
              prev.name === tc.name &&
              JSON.stringify(prev.args) === JSON.stringify(tc.arguments) &&
              prev.result !== undefined,
          );
          if (alreadyDone) {
            toolCounts.succeeded++;
            return {
              tc,
              message: { role: 'user' as const, content: `Tool result for ${tc.name} (cached): ${JSON.stringify(alreadyDone.result)}` },
              handoffText: `${tc.name}(cached)`,
            };
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
          return null; // blocked — no message to add
        }

        // Execute with watchdog timeout
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
          // Emergency sync checkpoint before giving up
          this.pendingCheckpoint = {
            sessionId: this.options.sessionId,
            step: steps,
            messages,
            toolCallHistory: executedToolCalls,
            metadata: { projectId: this.options.projectId, crashed: true },
          };
          this.flushCheckpoint();
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

        const handoffText = `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}): ${JSON.stringify(result.error ?? result.output).slice(0, 80)}`;
        const msgText = `Tool result for ${tc.name}: ${JSON.stringify(result.error ?? result.output)}`;

        return {
          tc,
          message: { role: 'user' as const, content: msgText },
          handoffText,
        };
      };

      if (canParallelize) {
        // Execute all independent read-only tool calls concurrently
        const outcomes = await Promise.all(response.toolCalls.map(tc => executeOneTool(tc)));
        for (const outcome of outcomes) {
          if (outcome === null) continue; // blocked
          handoff.recordToolResult(outcome.handoffText);
          messages.push(outcome.message);
        }
      } else {
        // Sequential execution (write tools, or read tools on same resource)
        for (const tc of response.toolCalls) {
          const outcome = await executeOneTool(tc);
          if (outcome === null) continue; // blocked
          handoff.recordToolResult(outcome.handoffText);
          messages.push(outcome.message);
        }
      }

      steps++;

      // Record step for context handoff tracking
      const executedCount = executedToolCalls.filter(t => !String(t.result).includes('BLOCKED')).length;
      handoff.recordStep(`Step ${steps}: ${executedCount} tool calls executed in ${this.contextMonitor?.current?.zone ?? 'unknown'} zone`);

      // Buffer checkpoint in memory; batch flush every 5 steps
      this.pendingCheckpoint = {
        sessionId: this.options.sessionId,
        step: steps,
        messages,
        toolCallHistory: executedToolCalls,
        metadata: { projectId: this.options.projectId },
      };
      if (steps - this.lastSavedStep >= 5) {
        this.flushCheckpoint();
      }
    }

    this.reportSession(startTime, steps, executedToolCalls, totalPromptTokens, totalCompletionTokens,
      zoneCounts, handoffCount, errorCounts, toolCounts, false);
    this.flushCheckpoint();
    this.checkpointManager.delete(this.options.sessionId);
    this.pendingCheckpoint = null;
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
  async runStreaming(
    userMessage: string,
    callback: StreamingCallback,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const executedToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
    const errorCounts = { transient: 0, recoverable: 0, fatal: 0 };
    const toolCounts = { total: 0, succeeded: 0, failed: 0, blocked: 0 };

    // Build context
    const ctx = await this.contextBuilder.build({
      sessionId: this.options.sessionId,
      projectId: this.options.projectId,
      captainId: this.options.captainId,
      systemPrompt: this.options.systemPrompt,
      activeFiles: this.options.activeFiles,
      taskDescription: this.options.taskDescription,
      memorySessionId: this.options.memorySessionId,
    });

    // Inject project snapshot into system prompt for streaming too
    let streamingSystemPrompt = ctx.systemPrompt;
    const snap = ProjectSnapshot.getCached(this.options.sessionId);
    if (snap && !this.options.systemPrompt) {
      streamingSystemPrompt = `${streamingSystemPrompt}\n\n## Project Structure\n${snap.summary}\n\nKey directories:\n${snap.tree.slice(0, 20).join('\n')}`;
    }

    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...ctx.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userMessage },
    ];

    // Convert ToolExecutor tools to StreamingToolDefinition
    const toolDescriptors = this.toolExecutor.getToolDescriptors();
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
          const result = await this.toolExecutor.execute(td.name, `stream_${Date.now()}`, args);
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
    const taskMap = new Map<string, string>(); // toolCallId -> taskId
    let fullText = '';
    try {
      for await (const chunk of this.gateway.streamText({
        model: this.options.model ?? 'claude-sonnet-4-6',
        systemPrompt: streamingSystemPrompt,
        messages,
        tools: streamingTools,
        maxSteps: this.options.maxSteps ?? 50,
        ...(this.options.maxResponseTokens != null ? { maxTokens: this.options.maxResponseTokens } : {}),
        ...(this.options.temperature != null ? { temperature: this.options.temperature } : {}),
        ...(this.options.thinkingBudget != null ? { thinkingBudget: this.options.thinkingBudget } : {}),
      })) {
        if (chunk.type === 'thinking') {
          callback.onThinking?.(chunk.content ?? '');
        } else if (chunk.type === 'thinking_done') {
          callback.onThinkingDone?.();
        } else if (chunk.type === 'text') {
          fullText += (chunk.content ?? '');
          callback.onChunk(chunk.content ?? '');
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          const taskName = formatToolTaskName(chunk.toolCall.name, chunk.toolCall.args);
          const taskId = taskTracker.addTask(taskName);
          taskMap.set(chunk.toolCall.id, taskId);
          callback.onTaskUpdate?.(taskTracker.getTasks());
          callback.onToolCall?.(chunk.toolCall.name, chunk.toolCall.args);
        } else if (chunk.type === 'tool_result' && chunk.toolResult) {
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
        } else if (chunk.type === 'done' && chunk.usage) {
          callback.onUsage?.(chunk.usage);
        }
      }
    } catch (e) {
      errorCounts.fatal++;
      const msg = (e as Error).message;
      callback.onError?.(msg);
      this.reportSession(startTime, 0, executedToolCalls, 0, 0,
        { smart: 0, warning: 0, critical: 0, dumb: 0 }, 0, errorCounts, toolCounts, false);
      return { content: `Streaming error: ${msg}`, steps: 0, toolCalls: executedToolCalls };
    }

    callback.onDone(fullText);
    this.reportSession(startTime, 1, executedToolCalls, 0, 0,
      { smart: 1, warning: 0, critical: 0, dumb: 0 }, 0, errorCounts, toolCounts, true);
    return {
      content: fullText,
      steps: 1,
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
}
