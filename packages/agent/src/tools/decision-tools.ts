import { DEFAULT_CAPTAIN_ID, type Decision } from '@cabinet/types';
import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createDecisionTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Decision Tools (read)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'query_decisions',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description:
              'Filter by status: pending, approved, rejected, expired, archived, or all (default: pending)',
          },
          projectId: {
            type: 'string',
            description: 'Filter by project ID (omit for all projects)',
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const status = (args.status as string) ?? 'pending';
        const projectId = args.projectId as string | undefined;
        if (projectId) {
          return deps.decisionStore
            .listByProject(projectId)
            .filter((d: Decision) => status === 'all' || d.status === status);
        }
        return status === 'all'
          ? deps.decisionStore.listAll()
          : deps.decisionStore.listAllPending();
      },
    },
    {
      name: 'get_decision',
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'ID of the decision to retrieve' },
        },
        required: ['decisionId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const id = args.decisionId as string;
        const decision = deps.decisionStore.get(id);
        if (!decision) return { error: `Decision not found: ${id}` };
        return decision;
      },
    },
    {
      name: 'get_decision_audit',
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'ID of the decision to get audit trail for' },
        },
        required: ['decisionId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const decisionId = args.decisionId as string;
        if (!decisionId) return { error: 'decisionId is required' };
        const entries = deps.getDecisionAudit(decisionId);
        return { decisionId, entries };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Decision Tools (write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'create_decision',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Decision title (short, actionable)' },
          description: {
            type: 'string',
            description: 'Detailed description of what is being decided',
          },
          type: {
            type: 'string',
            description:
              'Decision type: strategic, technical, resource, or process (default: strategic)',
          },
          projectId: { type: 'string', description: 'Project ID (default: "default")' },
          options: { type: 'array', description: 'Array of {id, label, impact} option objects' },
          scopeDescription: {
            type: 'string',
            description: 'Scope description for level classification',
          },
          estimatedCost: {
            type: 'number',
            description: 'Estimated cost in RMB for level classification',
          },
          involvesFunds: {
            type: 'boolean',
            description: 'Whether decision involves financial transactions',
          },
          involvesPermissions: {
            type: 'boolean',
            description: 'Whether decision involves permission changes',
          },
          involvesDataDeletion: {
            type: 'boolean',
            description: 'Whether decision involves data deletion',
          },
          involvesOrgConfig: {
            type: 'boolean',
            description: 'Whether decision involves org-wide config changes',
          },
        },
        required: ['title'],
      },
      execute: async (args: Record<string, unknown>) => {
        const title = args.title as string;
        const description = (args.description as string) ?? '';
        const type = (args.type as import('@cabinet/types').DecisionType) ?? 'strategic';
        const projectId = (args.projectId as string) ?? 'default';
        const captainId = args.captainId as string | undefined;
        const options = (args.options as { id: string; label: string; impact: string }[]) ?? [
          { id: 'opt_approve', label: 'Approve', impact: 'Proceed as described' },
          { id: 'opt_reject', label: 'Reject', impact: 'Do not proceed' },
        ];
        const classification = {
          scopeDescription: (args.scopeDescription as string) ?? description.slice(0, 200),
          isCrossSession: (args.isCrossSession as boolean) ?? false,
          optionCount: (args.optionCount as number) ?? options.length,
          estimatedCost: (args.estimatedCost as number) ?? 0,
          involvesFunds: (args.involvesFunds as boolean) ?? false,
          involvesPermissions: (args.involvesPermissions as boolean) ?? false,
          involvesDataDeletion: (args.involvesDataDeletion as boolean) ?? false,
          involvesOrgConfig: (args.involvesOrgConfig as boolean) ?? false,
        };
        const result = deps.createDecision({
          projectId,
          type,
          title,
          description,
          options,
          classification,
          captainId,
        });
        // Link decision to project context so it appears in get_project_context
        try {
          deps.project.addDecision(projectId, title, `Decision created (${type})`);
        } catch {
          /* best-effort: project context linking is non-critical */
        }
        return result;
      },
    },
    {
      name: 'approve_decision',
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'ID of the decision to approve' },
          chosenOptionId: { type: 'string', description: 'ID of the chosen option' },
          captainId: {
            type: 'string',
            description: 'ID of the Captain approving (default: current user)',
          },
        },
        required: ['decisionId', 'chosenOptionId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const decisionId = args.decisionId as string;
        const captainId = (args.captainId as string) ?? DEFAULT_CAPTAIN_ID;
        const chosenOptionId = (args.chosenOptionId as string) ?? (args.optionId as string);
        if (!decisionId || !chosenOptionId) {
          return { error: 'decisionId and chosenOptionId are required' };
        }
        return deps.approveDecision(decisionId, captainId, chosenOptionId);
      },
    },
    {
      name: 'reject_decision',
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'ID of the decision to reject' },
          captainId: {
            type: 'string',
            description: 'ID of the Captain rejecting (default: current user)',
          },
        },
        required: ['decisionId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const decisionId = args.decisionId as string;
        const captainId = (args.captainId as string) ?? DEFAULT_CAPTAIN_ID;
        if (!decisionId) return { error: 'decisionId is required' };
        return deps.rejectDecision(decisionId, captainId);
      },
    },
  ];
}
