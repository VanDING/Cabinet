import type { EventBus } from '@cabinet/events';
import { MessageType, type DelegationTier } from '@cabinet/types';
import type { AgentRoleRegistry } from '@cabinet/agent';
import type { ObservabilityCollector } from './observability.js';

export interface AdjustmentAction {
  type:
    | 'model_swap'
    | 'context_budget_reduce'
    | 'temperature_adjust'
    | 'retry_config_update'
    | 'evaluator_frequency_increase'
    | 'trigger_reconsolidation'
    | 'notify_captain';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  details: Record<string, unknown>;
  requiresCaptainApproval: boolean;
  applied: boolean;
  timestamp: string;
}

export type AdjustmentNotifyCallback = (action: AdjustmentAction) => Promise<boolean>;

type Health = ReturnType<ObservabilityCollector['getHealth']>;

export class AutoAdjuster {
  private actionHistory: AdjustmentAction[] = [];

  constructor(
    private readonly observability: ObservabilityCollector,
    private readonly agentRegistry: AgentRoleRegistry,
    private readonly eventBus: EventBus,
    private readonly modelMappingUpdater?: (tier: string, model: string) => void,
    private readonly notifyCallback?: AdjustmentNotifyCallback,
  ) {}

  async runHealthCheck(tier: DelegationTier): Promise<AdjustmentAction[]> {
    const health = this.observability.getHealth();
    const actions: AdjustmentAction[] = [];
    const needsApproval = tier === 'T0' || tier === 'T1';

    if (health.toolHealth !== 'healthy') {
      const toolActions = await this.handleToolDegradation(health, needsApproval);
      actions.push(...toolActions);
    }

    if (health.contextHealth !== 'healthy') {
      const ctxActions = await this.handleContextPressure(health, needsApproval);
      actions.push(...ctxActions);
    }

    if (health.successRate < 0.7) {
      const successActions = await this.handleLowSuccessRate(health, needsApproval);
      actions.push(...successActions);
    }

    for (const a of actions) {
      if (a.applied) {
        await this.eventBus.publish({
          messageId: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          correlationId: `hc_${Date.now()}`,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: { ...a, type: 'auto_adjustment' as const },
        });
      }
    }

    this.actionHistory.push(...actions);
    if (this.actionHistory.length > 100) {
      this.actionHistory.splice(0, this.actionHistory.length - 100);
    }
    return actions;
  }

  getHistory(): readonly AdjustmentAction[] {
    return this.actionHistory;
  }

  private async handleToolDegradation(
    health: Health,
    needsApproval: boolean,
  ): Promise<AdjustmentAction[]> {
    const toolHealth = this.observability.getToolHealth();
    const failingTools = toolHealth.filter((t) => {
      const errRate = t.failureCount / Math.max(t.totalCalls, 1);
      return errRate >= 0.1;
    });

    if (failingTools.length === 0) return [];

    const action: AdjustmentAction = {
      type: 'model_swap',
      severity: health.toolHealth === 'unhealthy' ? 'critical' : 'warning',
      description: `${failingTools.length} tools degraded. Upgrading model for reliability.`,
      details: {
        failingTools: failingTools.map((t) => t.toolName),
        toolHealth: health.toolHealth,
      },
      requiresCaptainApproval: needsApproval,
      applied: false,
      timestamp: new Date().toISOString(),
    };

    if (needsApproval && this.notifyCallback) {
      action.applied = await this.notifyCallback(action);
    } else if (this.modelMappingUpdater) {
      this.modelMappingUpdater('fast_execution', 'anthropic/claude-sonnet-4-6');
      action.applied = true;
      action.details = {
        ...action.details,
        previousModel: 'claude-haiku-4-5',
        newModel: 'anthropic/claude-sonnet-4-6',
      };
    }
    return [action];
  }

  private async handleContextPressure(
    health: Health,
    needsApproval: boolean,
  ): Promise<AdjustmentAction[]> {
    const changes: Record<string, number> = {};

    const action: AdjustmentAction = {
      type: 'context_budget_reduce',
      severity: health.contextHealth === 'critical' ? 'critical' : 'warning',
      description: `Context health is ${health.contextHealth}. Reducing agent context budgets.`,
      details: { contextHealth: health.contextHealth, changes },
      requiresCaptainApproval: needsApproval,
      applied: false,
      timestamp: new Date().toISOString(),
    };

    if (needsApproval && this.notifyCallback) {
      action.applied = await this.notifyCallback(action);
    } else {
      for (const role of this.agentRegistry.list()) {
        const newBudget = Math.round(Math.max(0.1, role.contextBudget - 0.1) * 10) / 10;
        if (newBudget < role.contextBudget) {
          this.agentRegistry.update(role.type, { contextBudget: newBudget });
          changes[role.type] = newBudget;
        }
      }
      action.applied = Object.keys(changes).length > 0;
    }
    return [action];
  }

  private async handleLowSuccessRate(
    health: Health,
    needsApproval: boolean,
  ): Promise<AdjustmentAction[]> {
    const changes: Record<string, number> = {};

    const action: AdjustmentAction = {
      type: 'temperature_adjust',
      severity: health.successRate < 0.5 ? 'critical' : 'warning',
      description: `Success rate at ${(health.successRate * 100).toFixed(0)}%. Reducing temperature for determinism.`,
      details: { successRate: health.successRate, changes },
      requiresCaptainApproval: needsApproval,
      applied: false,
      timestamp: new Date().toISOString(),
    };

    if (needsApproval && this.notifyCallback) {
      action.applied = await this.notifyCallback(action);
    } else {
      for (const role of this.agentRegistry.list()) {
        if (role.temperature > 0.1) {
          const newTemp = Math.round((role.temperature - 0.1) * 10) / 10;
          this.agentRegistry.update(role.type, { temperature: Math.max(0, newTemp) });
          changes[role.type] = newTemp;
        }
      }
      action.applied = Object.keys(changes).length > 0;
    }
    return [action];
  }
}
