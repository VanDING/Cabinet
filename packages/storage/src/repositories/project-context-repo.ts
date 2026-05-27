import type Database from 'better-sqlite3';

export interface ProjectContextRow {
  project_id: string;
  summary: string;
  goals: string;
  milestones: string;
  constraints: string;
  tech_summary: string;
  risk_map: string;
  key_decisions: string;
  updated_at: string;
}

export class ProjectContextRepository {
  constructor(private readonly db: Database.Database) {}

  findByProjectId(projectId: string): ProjectContextRow | null {
    const row = this.db
      .prepare('SELECT * FROM project_context WHERE project_id = ?')
      .get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToContext(row);
  }

  findAll(): ProjectContextRow[] {
    const rows = this.db.prepare('SELECT * FROM project_context').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToContext(r));
  }

  insert(ctx: ProjectContextRow): void {
    this.db
      .prepare(
        `INSERT INTO project_context (project_id, summary, goals, milestones, constraints, tech_summary, risk_map, key_decisions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ctx.project_id,
        ctx.summary,
        ctx.goals,
        ctx.milestones,
        ctx.constraints,
        ctx.tech_summary,
        ctx.risk_map,
        ctx.key_decisions,
      );
  }

  upsert(ctx: ProjectContextRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_context (project_id, summary, goals, milestones, constraints, tech_summary, risk_map, key_decisions, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        ctx.project_id,
        ctx.summary,
        ctx.goals,
        ctx.milestones,
        ctx.constraints,
        ctx.tech_summary,
        ctx.risk_map,
        ctx.key_decisions,
      );
  }

  update(
    projectId: string,
    changes: { summary?: string; goals?: string; tech_summary?: string },
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (changes.summary !== undefined) {
      sets.push('summary = ?');
      values.push(changes.summary);
    }
    if (changes.goals !== undefined) {
      sets.push('goals = ?');
      values.push(changes.goals);
    }
    if (changes.tech_summary !== undefined) {
      sets.push('tech_summary = ?');
      values.push(changes.tech_summary);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    values.push(projectId);
    this.db
      .prepare(`UPDATE project_context SET ${sets.join(', ')} WHERE project_id = ?`)
      .run(...values);
  }

  delete(projectId: string): void {
    this.db.prepare('DELETE FROM project_context WHERE project_id = ?').run(projectId);
  }

  private rowToContext(row: Record<string, unknown>): ProjectContextRow {
    return {
      project_id: row.project_id as string,
      summary: row.summary as string,
      goals: row.goals as string,
      milestones: row.milestones as string,
      constraints: row.constraints as string,
      tech_summary: row.tech_summary as string,
      risk_map: row.risk_map as string,
      key_decisions: row.key_decisions as string,
      updated_at: row.updated_at as string,
    };
  }
}
