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

import type {
  DispatchMode,
  PipelineStep,
  AgentOutput,
  PipelineContext,
  PipelineStepContext,
} from '@cabinet/types';
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
    switch (options.mode) {
      case 'pipeline':
        return this.runPipeline(options);
      case 'parallel':
        return this.runParallel(options);
      case 'single':
        return this.runSingle(options);
      default:
        return this.runSingle(options);
    }
  }

  // ── Pipeline Mode ────────────────────────────────────────

  private async runPipeline(options: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now();
    const steps: PipelineStep[] = [];
    let totalSteps = 0;
    const roleTypes = options.roles ?? ['secretary'];

    const pipelineContext: PipelineContext = {
      originalRequest: options.request,
      steps: [],
    };

    for (const roleType of roleTypes) {
      const input = this.serializePipelineContext(pipelineContext);
      const step = await this.runAgentStep(roleType, input, options);
      steps.push(step);
      totalSteps += step.steps;

      if (step.status === 'failed') {
        return {
          mode: 'pipeline',
          steps,
          finalOutput: `${roleType} failed: ${step.error}`,
          totalSteps,
          totalDurationMs: Date.now() - startTime,
        };
      }

      // Accumulate structured context for the next step
      pipelineContext.steps.push({
        role: roleType,
        summary: step.structuredOutput?.summary ?? step.output?.slice(0, 500) ?? '',
        findings: step.structuredOutput?.findings ?? [],
        decisions: step.structuredOutput?.decisions ?? [],
      });
    }

    const final = steps[steps.length - 1];
    return {
      mode: 'pipeline',
      steps,
      finalOutput: final?.output ?? 'No output produced.',
      totalSteps,
      totalDurationMs: Date.now() - startTime,
      structuredOutput: final?.structuredOutput,
    };
  }

  private serializePipelineContext(ctx: PipelineContext): string {
    const parts: string[] = [];
    parts.push(`Original request: ${ctx.originalRequest}`);
    if (ctx.steps.length > 0) {
      parts.push('\n## Previous steps');
      for (const step of ctx.steps) {
        parts.push(`\n### ${step.role}`);
        parts.push(`Summary: ${step.summary}`);
        if (step.findings.length > 0) {
          parts.push('Findings:');
          for (const f of step.findings) {
            parts.push(`- [${f.type}${f.severity ? `/${f.severity}` : ''}] ${f.detail}`);
          }
        }
        if (step.decisions.length > 0) {
          parts.push('Decisions:');
          for (const d of step.decisions) {
            parts.push(`- ${d.decision}`);
          }
        }
      }
    }
    return parts.join('\n');
  }

  // ── Parallel Mode ─────────────────────────────────────────

  private async runParallel(options: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now();
    const roleTypes = options.roles ?? ['secretary'];

    // Dynamic concurrency based on rate limit tracker
    let maxConcurrency = 3;
    if (this.rateLimitTracker) {
      const provider = this.inferProviderFromModel(options.roles?.[0] ?? 'secretary');
      const remaining = this.rateLimitTracker.getRemaining(provider);
      if (remaining !== Infinity) {
        maxConcurrency = Math.min(3, Math.floor(remaining / 2));
        maxConcurrency = Math.max(1, maxConcurrency);
      }
    }

    const steps: PipelineStep[] = [];
    for (let i = 0; i < roleTypes.length; i += maxConcurrency) {
      const batch = roleTypes.slice(i, i + maxConcurrency);
      const batchSteps = await Promise.all(
        batch.map((role) => this.runAgentStep(role, options.request, options)),
      );
      steps.push(...batchSteps);
    }
    const totalSteps = steps.reduce((sum, s) => sum + s.steps, 0);

    const structuredOutputs = steps.map((s) => s.structuredOutput).filter(Boolean) as AgentOutput[];

    let finalOutput: string;
    let synthesized: AgentOutput | undefined;
    if (structuredOutputs.length > 0) {
      const synthesizer = new ResultSynthesizer();
      synthesized = synthesizer.synthesize(structuredOutputs);
      finalOutput = [
        ...steps.map((s) => `[${s.role}] ${s.output}`),
        '',
        '--- Synthesized ---',
        synthesized.summary,
        ...(synthesized.findings.length > 0
          ? ['\nFindings:', ...synthesized.findings.map((f) => `- [${f.type}] ${f.detail}`)]
          : []),
      ].join('\n');
    } else {
      finalOutput =
        steps
          .filter((s) => s.status === 'completed')
          .map((s) => `[${s.role}] ${s.output}`)
          .join('\n\n---\n\n') || 'No outputs produced.';
    }

    return {
      mode: 'parallel',
      steps,
      finalOutput,
      totalSteps,
      totalDurationMs: Date.now() - startTime,
      structuredOutput: synthesized,
    };
  }

  // ── Single Mode ───────────────────────────────────────────

  private async runSingle(options: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now();
    const role = options.roles?.[0] ?? 'secretary';

    const step = await this.runAgentStep(role, options.request, options);

    return {
      mode: 'single',
      steps: [step],
      finalOutput: step.output ?? step.error ?? 'No output.',
      totalSteps: step.steps,
      totalDurationMs: Date.now() - startTime,
      structuredOutput: step.structuredOutput,
    };
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
        systemPrompt: role.systemPrompt,
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
