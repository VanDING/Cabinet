import Database from 'better-sqlite3';

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
  private db: Database.Database | null;

  constructor(db?: Database.Database) {
    this.db = db ?? null;
    if (this.db) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS project_context (
          project_id TEXT PRIMARY KEY,
          goals TEXT NOT NULL DEFAULT '[]',
          milestones TEXT NOT NULL DEFAULT '[]',
          key_decisions TEXT NOT NULL DEFAULT '[]',
          summary TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }
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

    if (this.db) {
      const row = this.db.prepare(
        'SELECT * FROM project_context WHERE project_id = ?',
      ).get(projectId) as any;
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
    if (this.db) {
      const rows = this.db.prepare('SELECT * FROM project_context').all() as any[];
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

  private persist(projectId: string, ctx: ProjectContext): void {
    if (!this.db) return;
    const db = this.db;
    db.prepare(
      `INSERT OR REPLACE INTO project_context (project_id, goals, milestones, key_decisions, summary, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      JSON.stringify(ctx.goals),
      JSON.stringify(ctx.milestones),
      JSON.stringify(ctx.keyDecisions),
      ctx.summary,
      ctx.updatedAt.toISOString(),
    );
  }
}
