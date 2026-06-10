import { EventEmitter } from 'node:events';
import type { LLMGateway } from '@cabinet/gateway';
import type { AgentEvent } from '@cabinet/events';
import { AgentLoop, type AgentLoopOptions, type StreamingCallback } from '../agent-loop.js';
import { ToolExecutor } from '../tool-executor.js';
import { SafetyChecker } from '../safety.js';
import { CheckpointManager } from '../checkpoint.js';
import { ORGANIZE_ROLE, getOrganizePlanningTools, ORGANIZE_DEPLOY_TOOLS } from '../agent-roles.js';
import type { InteractiveSubAgent, InitContext, Deliverable } from '../interactive-sub-agent.js';

type Phase = 'planning' | 'reviewing' | 'deploying' | 'completed' | 'error';
type Mode = 'interactive' | 'autonomous';

const DEPLOY_TOOL_SET = new Set<string>(ORGANIZE_DEPLOY_TOOLS);

export class OrganizeInteractiveAgent implements InteractiveSubAgent {
  readonly onEvent = new EventEmitter<{ event: [AgentEvent] }>();

  private planningLoop: AgentLoop | null = null;
  private deployLoop: AgentLoop | null = null;
  private phase: Phase = 'planning';
  private currentBlueprint: Record<string, unknown> | null = null;
  private context!: InitContext;
  private baseOptions: Omit<AgentLoopOptions, 'sessionId' | 'projectId' | 'captainId'>;
  private resolveModel: (tier: string) => string;
  private mode: Mode = 'interactive';
  private maxRetries = 2;
  private retryCount = 0;

  constructor(
    private readonly gateway: LLMGateway,
    private readonly toolExecutor: ToolExecutor,
    resolveModel?: string | ((tier: string) => string),
    mode?: Mode,
    maxRetries?: number,
  ) {
    this.mode = mode ?? 'interactive';
    this.maxRetries = maxRetries ?? 2;
    this.baseOptions = {
      gateway,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(null as any),
      memoryProvider: {
        getShortTerm: async () => [],
        getProjectContext: async () => '',
        getEntityPreferences: async () => ({}),
        searchLongTerm: async () => [],
      },
    };
    if (typeof resolveModel === 'string') {
      const model = resolveModel;
      this.resolveModel = () => model;
    } else {
      this.resolveModel = resolveModel ?? ((tier: string) => tier);
    }
  }

  getStatus(): 'running' | 'waiting_for_user' | 'completed' | 'error' {
    switch (this.phase) {
      case 'planning':
      case 'deploying':
        return 'running';
      case 'reviewing':
        return 'waiting_for_user';
      case 'completed':
        return 'completed';
      case 'error':
        return 'error';
    }
  }

  async init(context: InitContext): Promise<void> {
    this.context = context;
    this.phase = 'planning';

    // Build planning loop — restricted tools (no deploy tools)
    const planningTools = getOrganizePlanningTools();
    const planningView = this.toolExecutor.createView(planningTools);
    const model = context.model ?? this.resolveModel(ORGANIZE_ROLE.modelTier);

    this.planningLoop = new AgentLoop({
      ...this.baseOptions,
      sessionId: context.sessionId,
      projectId: context.projectId,
      captainId: context.captainId,
      model,
      maxSteps: ORGANIZE_ROLE.maxSteps,
      temperature: ORGANIZE_ROLE.temperature,
      contextBudget: ORGANIZE_ROLE.contextBudget,
      maxResponseTokens: ORGANIZE_ROLE.maxResponseTokens,
      toolExecutor: planningView,
      systemPrompt: ORGANIZE_ROLE.modules.identity,
    });

    // Inject interactive planning mode instructions
    this.planningLoop.setSkillContext(`## INTERACTIVE MODE — PLANNING PHASE

You are operating in interactive mode. Design the blueprint and present it
for user review BEFORE any deployment.

1. Complete Steps 1–3 of the Six-Step Method (Clarify, Design, Implementation Plan).
2. Do NOT execute Step 4 (Execute/deploy). Do NOT call register_agent, create_workflow,
   update_workflow, or run_workflow.
3. When your design is complete, call \`present_for_review\` with the full blueprint JSON
   and a human-readable summary.
4. The user will review and provide feedback.`);

    const wrappedCallback = this.createWrappedCallback();

    try {
      await this.planningLoop.runStreaming(context.message, wrappedCallback);
    } catch (err) {
      this.phase = 'error';
      this.emitEvent({ type: 'error', message: (err as Error).message, timestamp: Date.now() });
      this.emitStatus();
      return;
    }

    // After planning loop completes, check if blueprint was extracted
    if (this.currentBlueprint) {
      if (this.mode === 'autonomous') {
        // Skip review in autonomous mode
        await this.executeDeployment();
        return;
      }
      this.phase = 'reviewing';
    } else {
      // Graceful fallback: LLM didn't call present_for_review but finished successfully
      if (this.mode === 'autonomous' && this.retryCount < this.maxRetries) {
        this.retryCount++;
        await this.init(this.context);
        return;
      }
      this.phase = 'reviewing';
    }
    this.emitStatus();
  }

  async onUserInput(input: string): Promise<void> {
    if (this.phase === 'completed' || this.phase === 'error') return;

    const intent = this.classifyInput(input);

    this.emitEvent({
      type: 'user_input_received',
      content: input,
      timestamp: Date.now(),
    });

    if (intent === 'approve') {
      await this.executeDeployment();
    } else if (intent === 'reject') {
      this.phase = 'completed';
      this.currentBlueprint = null;
      this.emitStatus();
    } else {
      // Feedback — iterate on the blueprint
      await this.reviseBlueprint(input);
    }
  }

  async finalize(): Promise<Deliverable> {
    return {
      type: 'blueprint',
      content: this.currentBlueprint,
    };
  }

  // ── Private helpers ──

  private createWrappedCallback(): StreamingCallback {
    let foundBlueprint = false;

    return {
      onChunk: (content) => {
        this.emitEvent({ type: 'stream_chunk', content, timestamp: Date.now() });
      },
      onThinking: (content) => {
        this.emitEvent({ type: 'thinking', content, timestamp: Date.now() });
      },
      onToolCall: (name, args) => {
        this.emitEvent({ type: 'tool_call', name, args, timestamp: Date.now() });
        // Detect present_for_review call
        if (name === 'present_for_review' && args.blueprint) {
          this.currentBlueprint = args.blueprint as Record<string, unknown>;
          foundBlueprint = true;
        }
      },
      onToolResult: (name, result) => {
        this.emitEvent({ type: 'tool_result', name, result, timestamp: Date.now() });
      },
      onDone: (fullContent) => {
        this.emitEvent({ type: 'output', content: fullContent, timestamp: Date.now() });
        // If planning loop completed but blueprint wasn't detected via tool call,
        // try to extract it from the final content
        if (!foundBlueprint && this.phase === 'planning') {
          const extracted = this.extractBlueprintFromText(fullContent);
          if (extracted) {
            this.currentBlueprint = extracted;
          }
        }
      },
      onError: (error) => {
        this.emitEvent({ type: 'error', message: error, timestamp: Date.now() });
      },
    };
  }

  private async reviseBlueprint(feedback: string): Promise<void> {
    if (!this.planningLoop) return;

    this.phase = 'planning';
    this.emitStatus();

    // Inject revision instructions
    this.planningLoop.setSkillContext(`## INTERACTIVE MODE — REVISION

User feedback: ${feedback}

Revise the blueprint based on this feedback, then call \`present_for_review\` again
with the updated blueprint and a summary of what changed.`);

    const wrappedCallback = this.createWrappedCallback();
    try {
      await this.planningLoop.continueWithUserInput(feedback, wrappedCallback);
    } catch (err) {
      this.phase = 'error';
      this.emitEvent({ type: 'error', message: (err as Error).message, timestamp: Date.now() });
      this.emitStatus();
      return;
    }

    this.phase = 'reviewing';
    this.emitStatus();
  }

  private async executeDeployment(): Promise<void> {
    if (!this.planningLoop) return;

    this.phase = 'deploying';
    this.emitStatus();

    // Create deploy loop with full tools
    const model = this.resolveModel(ORGANIZE_ROLE.modelTier);
    this.deployLoop = new AgentLoop({
      ...this.baseOptions,
      sessionId: this.context.sessionId,
      projectId: this.context.projectId,
      captainId: this.context.captainId,
      model,
      maxSteps: ORGANIZE_ROLE.maxSteps,
      temperature: ORGANIZE_ROLE.temperature,
      contextBudget: ORGANIZE_ROLE.contextBudget,
      maxResponseTokens: ORGANIZE_ROLE.maxResponseTokens,
      toolExecutor: this.toolExecutor, // full tools — includes deploy tools
      systemPrompt: ORGANIZE_ROLE.modules.identity,
    });

    // Copy conversation history from planning loop
    const history = this.planningLoop.getConversationHistory();
    this.deployLoop.setConversationHistory([...history]);

    // Inject deployment instructions
    this.deployLoop.setSkillContext(`## INTERACTIVE MODE — DEPLOYMENT PHASE

The user has approved the blueprint. Proceed with execution:
1. Execute Steps 4–6 of the Six-Step Method.
2. Call register_agent, create_workflow, and run_workflow as planned.
3. Report results to the user.

Approved blueprint: ${JSON.stringify(this.currentBlueprint, null, 2)}`);

    const wrappedCallback = this.createWrappedCallback();
    try {
      await this.deployLoop.runStreaming(
        'User has approved the blueprint. Deploy it now.',
        wrappedCallback,
      );
    } catch (err) {
      if (this.mode === 'autonomous' && this.retryCount < this.maxRetries) {
        this.retryCount++;
        this.phase = 'planning';
        await this.init(this.context);
        return;
      }
      this.phase = 'error';
      this.emitEvent({ type: 'error', message: (err as Error).message, timestamp: Date.now() });
      this.emitStatus();
      return;
    }

    this.phase = 'completed';
    this.emitStatus();
  }

  private classifyInput(input: string): 'approve' | 'reject' | 'feedback' {
    const lower = input.toLowerCase().trim();
    const approvePatterns = [
      /^(approve|approved|deploy|looks good|go ahead|yes|ok|确认|执行|部署|可以|同意|好的|没问题|批准)$/i,
      /^lgtm/i,
    ];
    const rejectPatterns = [
      /^(cancel|abort|stop|reject|no|none|取消|不要|不行|拒绝|算了|不用了)$/i,
    ];

    if (approvePatterns.some((p) => p.test(lower))) return 'approve';
    if (rejectPatterns.some((p) => p.test(lower))) return 'reject';
    return 'feedback';
  }

  /** Best-effort extraction of blueprint JSON from LLM text output (fallback). */
  private extractBlueprintFromText(text: string): Record<string, unknown> | null {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
    if (fenceMatch) {
      for (const block of fenceMatch) {
        const inner = block.replace(/```(?:json)?\s*|```/g, '').trim();
        try {
          const parsed = JSON.parse(inner);
          if ('meta' in parsed || 'agents' in parsed || 'workflow' in parsed) {
            return parsed;
          }
        } catch {
          /* try next block */
        }
      }
    }
    const bareMatch = text.match(/\{[\s\S]*"agents"[\s\S]*"workflow"[\s\S]*\}/);
    if (bareMatch) {
      try {
        return JSON.parse(bareMatch[0]);
      } catch {
        /* not valid JSON */
      }
    }
    return null;
  }

  private emitEvent(event: AgentEvent): void {
    this.onEvent.emit('event', event);
  }

  private emitStatus(): void {
    this.emitEvent({
      type: 'status',
      status: this.getStatus(),
      timestamp: Date.now(),
    });
  }
}
