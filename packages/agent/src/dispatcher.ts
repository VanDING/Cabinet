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

// ── Types ──────────────────────────────────────────────────────

export type DispatchMode = 'pipeline' | 'parallel' | 'single';

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

export interface PipelineStep {
  role: AgentRoleType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: string;
  output?: string;
  error?: string;
  durationMs: number;
  steps: number;
}

export interface DispatchResult {
  mode: DispatchMode;
  steps: PipelineStep[];
  finalOutput: string;
  totalSteps: number;
  totalDurationMs: number;
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
      maxSteps: 10,
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

    let currentInput = options.request;

    for (const roleType of roleTypes) {
      const step = await this.runAgentStep(roleType, currentInput, options);
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

      // Feed output as input to the next role in the pipeline
      currentInput = [
        `Previous step (${roleType}) output:`,
        step.output,
        '',
        `Original request: ${options.request}`,
      ].join('\n');
    }

    const final = steps[steps.length - 1];
    return {
      mode: 'pipeline',
      steps,
      finalOutput: final?.output ?? 'No output produced.',
      totalSteps,
      totalDurationMs: Date.now() - startTime,
    };
  }

  // ── Parallel Mode ─────────────────────────────────────────

  private async runParallel(options: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now();
    const roleTypes = options.roles ?? ['secretary'];

    const promises = roleTypes.map((role) => this.runAgentStep(role, options.request, options));

    const steps = await Promise.all(promises);
    const totalSteps = steps.reduce((sum, s) => sum + s.steps, 0);

    const outputs = steps
      .filter((s) => s.status === 'completed')
      .map((s) => `[${s.role}] ${s.output}`);

    return {
      mode: 'parallel',
      steps,
      finalOutput: outputs.join('\n\n---\n\n') || 'No outputs produced.',
      totalSteps,
      totalDurationMs: Date.now() - startTime,
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
    };
  }

  // ── Agent Step Runner ─────────────────────────────────────

  private async runAgentStep(
    roleType: AgentRoleType | string,
    input: string,
    options: DispatchOptions,
  ): Promise<PipelineStep> {
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
        projectId: options.projectId,
        captainId: options.captainId,
        systemPrompt: role.systemPrompt,
        model: role.model,
        maxSteps: options.maxStepsPerAgent ?? this.baseOptions.maxSteps,
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
