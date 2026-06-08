//
// Agent Dispatcher — routes tasks to specialized agents.
//
// Supports three execution modes:
//   1. Pipeline:  Run a sequence of roles, each feeding output to the next
//   2. Parallel:  Run multiple roles concurrently on the same request
//   3. Single:    Run a single role (default: secretary)
//
// Each agent runs in its own AgentLoop with role-specific:
//   - System prompt
//   - Model selection
//   - Tool subset
//   - Context budget
//

import { assemblePrompt } from './prompt-assembler.js';
import type { LLMGateway } from '@cabinet/gateway';
import type { EventBus } from '@cabinet/events';
import type { ToolExecutor } from './tool-executor.js';
import type { MemoryProvider } from './context-builder.js';
import type { AgentRole, AgentRoleType } from './agent-roles.js';
import { AgentRoleRegistry } from './agent-roles.js';
import { AgentLoop, type AgentLoopOptions, type AgentResult } from './agent-loop.js';
import { SafetyChecker } from './safety.js';
import { CheckpointManager } from './checkpoint.js';
import type { Database } from '@cabinet/storage';
import { executeDispatchGraph } from './dispatch-graph.js';

import type { DispatchMode, PipelineStep, AgentOutput } from '@cabinet/types';
import type { RateLimitTracker } from '@cabinet/gateway';

// ── Types ──────────────────────────────────────────────────────

export type { DispatchMode, PipelineStep };

export interface DispatchOptions {
  mode: DispatchMode;
  /** The user's request. */
  request: string;
  /** Project/session context. */
  sessionId: string;
  projectId: string;
  captainId: string;
  /** Target role for single mode, or role sequence for pipeline. */
  roles?: AgentRoleType[];
  /** Max steps per agent. */
  maxStepsPerAgent?: number;
}

export interface DispatchResult {
  mode: DispatchMode;
  steps: PipelineStep[];
  finalOutput: string;
  totalSteps: number;
  totalDurationMs: number;
  /** Structured output from the final step, if available. */
  structuredOutput?: AgentOutput;
}

// ── Result Synthesizer (for Parallel mode) ────────────────────

class ResultSynthesizer {
  synthesize(outputs: AgentOutput[]): AgentOutput {
    const summary = outputs
      .map((o) => o.summary)
      .filter(Boolean)
      .join('\n');
    const allFindings = outputs.flatMap((o) => o.findings ?? []);
    const dedupedFindings = this.deduplicateFindings(allFindings);
    const decisions = outputs.flatMap((o) => o.decisions ?? []);
    const openQuestions = [...new Set(outputs.flatMap((o) => o.openQuestions ?? []))];
    const avgConfidence =
      outputs.length > 0
        ? outputs.reduce((sum, o) => sum + (o.confidence ?? 0.5), 0) / outputs.length
        : 0.5;
    const suggestedNextSteps = [...new Set(outputs.flatMap((o) => o.suggestedNextSteps ?? []))];

    return {
      summary,
      findings: dedupedFindings,
      decisions,
      openQuestions,
      confidence: avgConfidence,
      suggestedNextSteps,
    };
  }

  private deduplicateFindings(findings: AgentOutput['findings']): AgentOutput['findings'] {
    const seen = new Set<string>();
    const result: AgentOutput['findings'] = [];
    for (const f of findings) {
      const key = `${f.type}:${f.detail}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(f);
      }
    }
    // Sort by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return result.sort(
      (a, b) =>
        (severityOrder[a.severity ?? 'low'] ?? 2) - (severityOrder[b.severity ?? 'low'] ?? 2),
    );
  }
}

// ── Dispatcher ─────────────────────────────────────────────────

export class AgentDispatcher {
  private readonly registry: AgentRoleRegistry;
  private readonly baseOptions: Omit<AgentLoopOptions, 'systemPrompt' | 'model'>;

  constructor(
    private readonly gateway: LLMGateway,
    private readonly toolExecutor: ToolExecutor,
    private readonly db: Database,
    private readonly memoryProvider: MemoryProvider,
    private readonly eventBus?: EventBus,
    externalRegistry?: AgentRoleRegistry,
    private readonly rateLimitTracker?: RateLimitTracker,
  ) {
    this.registry = externalRegistry ?? new AgentRoleRegistry();
    this.baseOptions = {
      gateway,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider,
      sessionId: '',
      projectId: '',
      captainId: '',
      maxSteps: 50,
    };
  }

  /** Register a custom role. */
  registerRole(role: AgentRole): void {
    this.registry.register(role);
  }

  /** Get the role registry (for routing decisions). */
  getRegistry(): AgentRoleRegistry {
    return this.registry;
  }

  /** Dispatch a request in the specified mode. */
  async dispatch(options: DispatchOptions): Promise<DispatchResult> {
    const synthesizer = new ResultSynthesizer();

    // Compute concurrency limit for parallel mode
    let maxConcurrency = 3;
    if (this.rateLimitTracker && options.mode === 'parallel') {
      const provider = this.inferProviderFromModel(options.roles?.[0] ?? 'secretary');
      const remaining = this.rateLimitTracker.getRemaining(provider);
      if (remaining !== Infinity) {
        maxConcurrency = Math.min(3, Math.floor(remaining / 2));
        maxConcurrency = Math.max(1, maxConcurrency);
      }
    }

    return executeDispatchGraph({
      mode: options.mode,
      roles: options.roles ?? ['secretary'],
      request: options.request,
      agentStep: (role, input) => this.runAgentStep(role, input, options),
      synthesize: (outputs) => synthesizer.synthesize(outputs),
      maxConcurrency,
    });
  }

  /** Infer a provider name from the first role's model configuration. */
  private inferProviderFromModel(_roleType: string): string {
    // Model is resolved at runtime via gateway; default to 'default' for rate-limit checks.
    return 'default';
  }

  // ── Agent Step Runner ─────────────────────────────────────

  private async runAgentStep(
    roleType: AgentRoleType | string,
    input: string,
    options: DispatchOptions,
  ): Promise<PipelineStep & { structuredOutput?: AgentOutput }> {
    const startTime = Date.now();
    const role = this.registry.get(roleType);
    if (!role) {
      return {
        role: roleType as AgentRoleType,
        status: 'failed',
        input,
        error: `Unknown role: ${roleType}`,
        durationMs: 0,
        steps: 0,
      };
    }

    try {
      const agentOptions: AgentLoopOptions = {
        ...this.baseOptions,
        sessionId: `${options.sessionId}-${role.type}`,
        memorySessionId: options.sessionId,
        projectId: options.projectId,
        captainId: options.captainId,
        systemPrompt: assemblePrompt({
          modules: role.modules,
          toolExecutor: this.baseOptions.toolExecutor,
        }),
        model: (this.gateway as any).resolveModelString?.(role.modelTier) ?? role.modelTier,
        maxSteps: options.maxStepsPerAgent ?? role.maxSteps ?? this.baseOptions.maxSteps,
        eventBus: this.eventBus,
        taskDescription: input,
        maxResponseTokens: role.maxResponseTokens,
        temperature: role.temperature,
        contextBudget: role.contextBudget,
      };

      const loop = new AgentLoop(agentOptions);
      const result: AgentResult = await loop.run(input);

      return {
        role: role.type,
        status: 'completed',
        input,
        output: result.content,
        durationMs: Date.now() - startTime,
        steps: result.steps,
        structuredOutput: result.structuredOutput,
      };
    } catch (error) {
      return {
        role: role.type,
        status: 'failed',
        input,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
        steps: 0,
      };
    }
  }
}
