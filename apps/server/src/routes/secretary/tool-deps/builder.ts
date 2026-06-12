import type { ServerContext } from '../../../context.js';
import type { ToolDependencies } from '@cabinet/agent';
import { buildDecisionTools } from './decision-tools.js';
import { buildWorkflowTools } from './workflow-tools.js';
import { buildMemoryTools } from './memory-tools.js';
import { buildEmployeeTools } from './employee-tools.js';
import { buildAgentTools } from './agent-tools.js';
import { buildProjectTools } from './project-tools.js';
import { buildDashboardTools } from './dashboard-tools.js';
import { buildFileTools } from './file-tools.js';
import { buildWebTools } from './web-tools.js';
import { buildShellTools } from './shell-tools.js';
import { buildKnowledgeTools } from './knowledge-tools.js';
import { buildLSPTools } from './lsp-tools.js';
import { buildEvalTools } from './eval-tools.js';
import { buildSchedulerTools } from './scheduler-tools.js';
import { buildSystemKnowledgeTools } from './system-knowledge-tools.js';
import { buildCapsTools } from './caps-tools.js';

export function buildToolDependencies(
  ctx: ServerContext,
  activeProjectId?: string,
  _inject?: Record<string, unknown>,
): ToolDependencies {
  return {
    // ── Read path ──
    eventBus: ctx.eventBus,
    shortTerm: ctx.shortTerm,
    longTerm: ctx.longTerm,
    entity: ctx.entity,
    project: ctx.project,
    memoryFacade: ctx.memoryFacade,

    ...buildDecisionTools(ctx),
    ...buildWorkflowTools(ctx, activeProjectId),
    ...buildMemoryTools(ctx),
    ...buildEmployeeTools(ctx, activeProjectId),
    ...buildAgentTools(ctx, activeProjectId, _inject),
    ...buildProjectTools(ctx, activeProjectId),
    ...buildDashboardTools(ctx, activeProjectId),
    ...buildFileTools(ctx),
    ...buildWebTools(),
    ...buildShellTools(ctx),
    ...buildKnowledgeTools(ctx),
    ...buildLSPTools(),
    ...buildEvalTools(ctx),
    ...buildSchedulerTools(ctx, activeProjectId),
    ...buildSystemKnowledgeTools(ctx),
    ...buildCapsTools(),
  } as ToolDependencies;
}
