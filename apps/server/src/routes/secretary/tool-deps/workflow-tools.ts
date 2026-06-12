import type { ServerContext } from '../../../context.js';
import { runWorkflowById } from '../../workflows.js';

async function executeWorkflowById(
  workflowId: string,
  _ctx: ServerContext,
): Promise<{ runId: string; status: string; steps?: unknown[] }> {
  const result = await runWorkflowById(workflowId);
  return { runId: result.runId, status: result.status, steps: result.steps };
}

export function buildWorkflowTools(ctx: ServerContext, activeProjectId?: string) {
  return {
    listWorkflows() {
      const targetProjectId = activeProjectId ?? 'default';
      const rows = ctx.db
        .prepare(
          'SELECT id, name, definition, status FROM workflows WHERE project_id = ? ORDER BY created_at DESC',
        )
        .all(targetProjectId) as any[];
      return rows.map((r: any) => {
        const def = JSON.parse(r.definition ?? '{}');
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          stepCount: def.steps ? def.steps.length : (def.nodes ?? []).length,
        };
      });
    },
    getWorkflow(id: string) {
      const row = ctx.db
        .prepare('SELECT id, name, definition, status FROM workflows WHERE id = ?')
        .get(id) as any;
      if (!row) return undefined;
      return {
        id: row.id,
        name: row.name,
        definition: JSON.parse(row.definition ?? '{}'),
        status: row.status,
      };
    },

    createWorkflow(input: any) {
      let projectId = input.projectId;
      if (!projectId || projectId === 'global') {
        const activeProjects = ctx.projectRepo.listByStatus('active');
        const fallback = activeProjects[0];
        if (!fallback) {
          throw new Error(
            'No active project available. Create a project first before creating a workflow.',
          );
        }
        projectId = fallback.id;
      }
      // Verify the project exists to satisfy foreign key constraint
      const project = ctx.projectRepo.findById(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const id = `wf_${Date.now()}`;
      ctx.db
        .prepare(
          'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, projectId, input.name, JSON.stringify(input.definition ?? {}), 'draft');
      ctx.logger.info('Workflow created via tool', { id, name: input.name, projectId });
      return { id };
    },
    updateWorkflow(id: string, input: any) {
      if (input.name !== undefined || input.definition !== undefined) {
        const name = input.name;
        const definition = input.definition;
        if (name !== undefined && definition !== undefined) {
          ctx.workflowRepo.updateNameAndDefinition(id, name, JSON.stringify(definition));
        } else if (name !== undefined) {
          ctx.workflowRepo.updateNameAndDefinition(id, name);
        } else if (definition !== undefined) {
          ctx.workflowRepo.updateNameAndDefinition(id, undefined, JSON.stringify(definition));
        }
      }
    },
    deleteWorkflow(id: string) {
      ctx.workflowRepo.delete(id);
      ctx.logger.info('Workflow deleted via tool', { id });
    },
    async runWorkflow(id: string) {
      return executeWorkflowById(id, ctx);
    },
    getWorkflowRun(runId: string) {
      const row = ctx.workflowRepo.findRunById(runId);
      if (!row) return null;
      let steps: unknown[] = [];
      try {
        steps = ctx.workflowRepo.findStepsByRunId(runId);
      } catch {
        /* non-fatal */
      }
      return {
        runId: row.run_id,
        workflowId: row.workflow_id,
        status: row.status,
        steps,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
      };
    },
    listWorkflowRuns(workflowId: string) {
      const rows = ctx.workflowRepo.findRunsByWorkflow(workflowId);
      return rows.map((r) => ({
        runId: r.run_id,
        workflowId: r.workflow_id,
        status: r.status,
        startedAt: r.started_at,
        updatedAt: r.updated_at,
      }));
    },
  };
}
