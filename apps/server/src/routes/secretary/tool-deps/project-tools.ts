import type { ServerContext } from '../../../context.js';

export function buildProjectTools(ctx: ServerContext, activeProjectId?: string) {
  return {
    setProjectContext(projectId: string) {
      const row = ctx.projectRepo.findById(projectId);
      if (!row) throw new Error(`Project not found: ${projectId}`);
      return { id: row.id, name: row.name };
    },
    createProject(input: any) {
      const id = `proj_${Date.now()}`;
      ctx.projectRepo.create({
        id,
        name: input.name,
        description: input.description ?? '',
        status: 'active' as const,
        rootPath: input.rootPath ?? '',
        createdAt: new Date(),
      });
      ctx.projectContextRepo.insert({
        project_id: id,
        summary: '',
        goals: '[]',
        milestones: '[]',
        constraints: '{}',
        tech_summary: '',
        risk_map: '[]',
        key_decisions: '[]',
        updated_at: new Date().toISOString(),
      });
      // Initialize project memory so context is immediately available to agents
      ctx.project.initialize(id, []);
      ctx.logger.info('Project created via tool', { id, name: input.name });
      return { id, name: input.name };
    },
    listProjects() {
      const rows = ctx.projectRepo.listByStatus('active');
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        lastActivityAt: r.lastActivityAt,
        activeWorkflowCount: 0,
      }));
    },
    getProjectContext(projectId: string) {
      const project = ctx.projectRepo.findById(projectId);
      if (!project) return null;
      const pctx = ctx.projectContextRepo.findByProjectId(projectId);
      const decisions = ctx.decisionRepo.listByProject(projectId, { limit: 5 });
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        rootPath: project.rootPath ?? '',
        summary: pctx?.summary ?? '',
        goals: JSON.parse(pctx?.goals ?? '[]'),
        constraints: JSON.parse(pctx?.constraints ?? '{}'),
        recentDecisions: decisions,
      };
    },
  };
}
