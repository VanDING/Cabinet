import type Database from 'better-sqlite3';
import type { Decision, DecisionOption } from '@cabinet/types';

function rowToDecision(row: any): Decision {
  const options: DecisionOption[] = (() => {
    try {
      return JSON.parse(row.options ?? '[]');
    } catch {
      return [];
    }
  })();

  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    level: row.level,
    status: row.status,
    title: row.title,
    description: row.description,
    options,
    chosenOptionId: row.chosen_option_id ?? undefined,
    captainId: row.captain_id ?? undefined,
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
  };
}

export class DecisionRepository {
  constructor(private db: Database.Database) {}

  save(decision: Decision): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO decisions (id, project_id, type, level, status, title, description, options, chosen_option_id, captain_id, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        decision.id,
        decision.projectId,
        decision.type,
        decision.level,
        decision.status,
        decision.title,
        decision.description,
        JSON.stringify(decision.options),
        decision.chosenOptionId ?? null,
        decision.captainId ?? null,
        decision.createdAt.toISOString(),
        decision.resolvedAt?.toISOString() ?? null,
      );
  }

  get(id: string): Decision | null {
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as any;
    return row ? rowToDecision(row) : null;
  }

  listByProject(projectId: string): Decision[] {
    const rows = this.db
      .prepare('SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as any[];
    return rows.map(rowToDecision);
  }

  listPending(projectId?: string): Decision[] {
    if (projectId) {
      const rows = this.db
        .prepare(
          "SELECT * FROM decisions WHERE project_id = ? AND status = 'pending' ORDER BY created_at DESC",
        )
        .all(projectId) as any[];
      return rows.map(rowToDecision);
    }
    const rows = this.db
      .prepare("SELECT * FROM decisions WHERE status = 'pending' ORDER BY created_at DESC")
      .all() as any[];
    return rows.map(rowToDecision);
  }
}
