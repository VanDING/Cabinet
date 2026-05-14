import { ToolExecutor, type ToolDefinition } from '../tool-executor.js';
import type { DecisionStore } from '@cabinet/decision';
import type { EventBus } from '@cabinet/events';
import type { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import { MessageType } from '@cabinet/types';

export interface ToolDependencies {
  decisionStore: DecisionStore;
  eventBus: EventBus;
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
}

export function createCabinetTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ── Decision Tools ──
    {
      name: 'query_decisions',
      execute: async (args: Record<string, unknown>) => {
        const status = (args.status as string) ?? 'pending';
        const projectId = args.projectId as string | undefined;
        if (projectId) {
          return deps.decisionStore.listByProject(projectId).filter(d => status === 'all' || d.status === status);
        }
        return deps.decisionStore.listPending(projectId ?? 'all');
      },
    },
    {
      name: 'get_decision',
      execute: async (args: Record<string, unknown>) => {
        const id = args.decisionId as string;
        const decision = deps.decisionStore.get(id);
        if (!decision) return { error: `Decision not found: ${id}` };
        return decision;
      },
    },

    // ── Event/Monitoring Tools ──
    {
      name: 'get_recent_events',
      execute: async (args: Record<string, unknown>) => {
        const correlationId = args.correlationId as string | undefined;
        if (correlationId) {
          return deps.eventBus.getCausationChain(correlationId);
        }
        return { message: 'Provide correlationId to trace event chain' };
      },
    },
    {
      name: 'publish_notification',
      execute: async (args: Record<string, unknown>) => {
        const messageId = `tool_notify_${Date.now()}`;
        await deps.eventBus.publish({
          messageId,
          correlationId: messageId,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: { message: args.message as string, level: (args.level as string) ?? 'info' },
        });
        return { published: true, messageId };
      },
    },

    // ── Memory Tools ──
    {
      name: 'remember',
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.sessionId as string;
        const key = args.key as string;
        const value = args.value;
        deps.shortTerm.set(sessionId, key, value, (args.ttlMs as number) ?? undefined);
        return { remembered: true, key };
      },
    },
    {
      name: 'recall',
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.sessionId as string;
        const key = args.key as string | undefined;
        if (key) {
          const val = deps.shortTerm.get(sessionId, key);
          return val !== null ? { key, value: val } : { key, notFound: true };
        }
        return deps.shortTerm.getAll(sessionId);
      },
    },
    {
      name: 'search_memory',
      execute: async (args: Record<string, unknown>) => {
        const query = args.query as string;
        const limit = (args.limit as number) ?? 5;
        const results = await deps.longTerm.search(query, limit);
        return results.map(r => ({ content: r.content, timestamp: r.timestamp, metadata: r.metadata }));
      },
    },

    // ── Project Tools ──
    {
      name: 'get_project_context',
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        const ctx = deps.project.get(projectId);
        if (!ctx) return { error: `Project not found: ${projectId}` };
        return {
          goals: ctx.goals,
          milestones: ctx.milestones,
          keyDecisions: ctx.keyDecisions,
          summary: ctx.summary,
        };
      },
    },
    {
      name: 'get_captain_preferences',
      execute: async (args: Record<string, unknown>) => {
        const captainId = args.captainId as string;
        const prefs = deps.entity.getPreferences(captainId);
        return prefs ?? { captainId, preferences: {} };
      },
    },

    // ── Status/Health Tools ──
    {
      name: 'get_status',
      execute: async (_args: Record<string, unknown>) => {
        return {
          status: 'operational',
          timestamp: new Date().toISOString(),
          toolsAvailable: 10,
        };
      },
    },
  ];
}

export function registerCabinetTools(executor: ToolExecutor, deps: ToolDependencies): ToolExecutor {
  const tools = createCabinetTools(deps);
  for (const tool of tools) {
    executor.register(tool);
  }
  return executor;
}
