import { ProjectContextRepository, type Database } from '@cabinet/storage';

export interface ProjectContext {
  projectId: string;
  goals: string[];
  milestones: { title: string; status: 'pending' | 'done'; date?: Date }[];
  keyDecisions: { title: string; outcome: string; date: Date }[];
  summary: string;
  updatedAt: Date;
}

export class ProjectMemory {
  private projects = new Map<string, ProjectContext>();
  private repo: ProjectContextRepository | null;

  constructor(db?: Database) {
    this.repo = db ? new ProjectContextRepository(db) : null;
  }

  initialize(projectId: string, goals: string[]): ProjectContext {
    const ctx: ProjectContext = {
      projectId,
      goals,
      milestones: [],
      keyDecisions: [],
      summary: `Project initialized with ${goals.length} goals.`,
      updatedAt: new Date(),
    };
    this.projects.set(projectId, ctx);
    this.persist(projectId, ctx);
    return ctx;
  }

  get(projectId: string): ProjectContext | null {
    const cached = this.projects.get(projectId);
    if (cached) return cached;

    if (this.repo) {
      const row = this.repo.findByProjectId(projectId);
      if (row) {
        const ctx: ProjectContext = {
          projectId: row.project_id,
          goals: JSON.parse(row.goals ?? '[]'),
          milestones: JSON.parse(row.milestones ?? '[]'),
          keyDecisions: JSON.parse(row.key_decisions ?? '[]'),
          summary: row.summary ?? '',
          updatedAt: new Date(row.updated_at ?? Date.now()),
        };
        this.projects.set(projectId, ctx);
        return ctx;
      }
    }
    return null;
  }

  getAll(): Record<string, ProjectContext> {
    // Load all from DB first
    if (this.repo) {
      const rows = this.repo.findAll();
      for (const row of rows) {
        if (!this.projects.has(row.project_id)) {
          this.projects.set(row.project_id, {
            projectId: row.project_id,
            goals: JSON.parse(row.goals ?? '[]'),
            milestones: JSON.parse(row.milestones ?? '[]'),
            keyDecisions: JSON.parse(row.key_decisions ?? '[]'),
            summary: row.summary ?? '',
            updatedAt: new Date(row.updated_at ?? Date.now()),
          });
        }
      }
    }
    const result: Record<string, ProjectContext> = {};
    for (const [k, v] of this.projects) result[k] = v;
    return result;
  }

  private ensure(projectId: string): ProjectContext {
    const existing = this.projects.get(projectId) ?? this.get(projectId);
    if (existing) return existing;
    return this.initialize(projectId, []);
  }

  addMilestone(projectId: string, title: string): void {
    const ctx = this.ensure(projectId);
    ctx.milestones.push({ title, status: 'pending' });
    ctx.updatedAt = new Date();
    this.persist(projectId, ctx);
  }

  addDecision(projectId: string, title: string, outcome: string): void {
    const ctx = this.ensure(projectId);
    ctx.keyDecisions.push({ title, outcome, date: new Date() });
    ctx.updatedAt = new Date();
    this.persist(projectId, ctx);
  }

  updateSummary(projectId: string, summary: string): void {
    const ctx = this.ensure(projectId);
    ctx.summary = summary;
    ctx.updatedAt = new Date();
    this.persist(projectId, ctx);
  }

  delete(projectId: string): void {
    this.projects.delete(projectId);
    this.repo?.delete(projectId);
  }

  private persist(projectId: string, ctx: ProjectContext): void {
    if (!this.repo) return;
    this.repo.upsert({
      project_id: projectId,
      summary: ctx.summary,
      goals: JSON.stringify(ctx.goals),
      milestones: JSON.stringify(ctx.milestones),
      key_decisions: JSON.stringify(ctx.keyDecisions),
      constraints: '[]',
      tech_summary: '',
      risk_map: '{}',
      updated_at: ctx.updatedAt.toISOString(),
    });
  }
}
