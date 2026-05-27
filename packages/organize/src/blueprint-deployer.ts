import type { Blueprint } from '@cabinet/types';
import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';

export interface DeployerDependencies {
  registerAgent: (input: {
    name: string;
    description: string;
    systemPrompt: string;
    model: string;
    temperature: number;
    maxResponseTokens: number;
    allowedTools: string[];
    contextBudget: number;
  }) => { type: string; name: string };

  listAgents: () => { type: string; name: string; description: string; builtIn: boolean }[];

  createWorkflow: (input: { name: string; projectId: string; definition: unknown }) => {
    id: string;
  };
  runWorkflow: (id: string) => Promise<{ runId: string; status: string; steps?: unknown[] }>;

  eventBus: EventBus;
  projectId: string;
}

export interface DeployResult {
  success: boolean;
  agentsCreated: string[];
  agentsReused: string[];
  workflowId: string | null;
  runId: string | null;
  errors: DeployError[];
}

export interface DeployError {
  phase: 'agent_registration' | 'workflow_creation' | 'workflow_execution';
  detail: string;
  agentName?: string;
  error: string;
}

export class BlueprintDeployer {
  constructor(private readonly deps: DeployerDependencies) {}

  async deploy(blueprint: Blueprint): Promise<DeployResult> {
    const result: DeployResult = {
      success: false,
      agentsCreated: [],
      agentsReused: [],
      workflowId: null,
      runId: null,
      errors: [],
    };

    for (const agent of blueprint.agents ?? []) {
      try {
        if (agent.action === 'create_new') {
          const registered = this.deps.registerAgent({
            name: agent.name,
            description: `Agent created from Organize blueprint: ${blueprint.meta?.goal ?? 'no goal'}`,
            systemPrompt: agent.prompt ?? `You are ${agent.name}. Execute your designated tasks.`,
            model: 'fast_execution',
            temperature: 0.3,
            maxResponseTokens: 4000,
            allowedTools: [],
            contextBudget: 0.3,
          });
          result.agentsCreated.push(registered.name);
        } else if (agent.action === 'use_existing') {
          result.agentsReused.push(agent.name);
        }
      } catch (error) {
        result.errors.push({
          phase: 'agent_registration',
          detail: `Failed to register agent "${agent.name}"`,
          agentName: agent.name,
          error: (error as Error).message,
        });
      }
    }

    let workflowId: string | null = null;
    try {
      const workflowSteps = blueprint.workflow?.steps ?? [];
      if (workflowSteps.length > 0) {
        const wfResult = this.deps.createWorkflow({
          name: `Organize: ${blueprint.meta?.goal?.slice(0, 60) ?? 'Untitled Blueprint'}`,
          projectId: this.deps.projectId,
          definition: { steps: workflowSteps },
        });
        workflowId = wfResult.id;
        result.workflowId = workflowId;
      }
    } catch (error) {
      result.errors.push({
        phase: 'workflow_creation',
        detail: 'Failed to create workflow from blueprint',
        error: (error as Error).message,
      });
    }

    if (workflowId) {
      try {
        const runResult = await this.deps.runWorkflow(workflowId);
        result.runId = runResult.runId;
      } catch (error) {
        result.errors.push({
          phase: 'workflow_execution',
          detail: `Failed to run workflow ${workflowId}`,
          error: (error as Error).message,
        });
      }
    }

    result.success = result.errors.length === 0;
    await this.deps.eventBus.publish({
      messageId: `organize_deploy_${Date.now()}`,
      correlationId: `organize_deploy_${Date.now()}`,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: {
        type: 'blueprint_deployed',
        message: result.success
          ? 'Blueprint deployed successfully'
          : `Blueprint deployed with ${result.errors.length} errors`,
        data: {
          success: result.success,
          agentsCreated: result.agentsCreated,
          agentsReused: result.agentsReused,
          workflowId: result.workflowId,
          runId: result.runId,
          errorCount: result.errors.length,
        },
      },
    });

    return result;
  }
}
