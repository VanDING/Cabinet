import { buildUpdateSql } from './base-repo.js';
import type Database from 'better-sqlite3';
import type { Decision, DecisionOption } from '@cabinet/types';

function rowToDecision(row: Record<string, unknown>): Decision {
  const options: DecisionOption[] = (() => {
    try {
      return JSON.parse((row.options as string) ?? '[]') as DecisionOption[];
    } catch {
      return [];
    }
  })();

  return {
    id: row.id as string,
    projectId: row.project_id as string,
    type: row.type as Decision['type'],
    level: row.level as Decision['level'],
    status: row.status as Decision['status'],
    title: row.title as string,
    description: row.description as string,
    options,
    chosenOptionId: row.chosen_option_id as string | undefined,
    captainId: row.captain_id as string | undefined,
    analysis: row.analysis as string | undefined,
    createdAt: new Date(row.created_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : undefined,
  };
}

export class DecisionRepository {
  constructor(private readonly db: Database.Database) {}

  save(decision: Decision): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO decisions (id, project_id, type, level, status, title, description, options, chosen_option_id, captain_id, analysis, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        decision.analysis ?? null,
        decision.createdAt.toISOString(),
        decision.resolvedAt?.toISOString() ?? null,
      );
  }

  get(id: string): Decision | null {
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToDecision(row) : null;
  }

  listByProject(projectId: string, opts?: { limit?: number; offset?: number }): Decision[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .all(projectId, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  listAll(opts?: { limit?: number; offset?: number }): Decision[] {
    const rows = this.db
      .prepare('SELECT * FROM decisions ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  listPending(projectId: string, opts?: { limit?: number; offset?: number }): Decision[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM decisions WHERE project_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .all(projectId, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  listAllPending(opts?: { limit?: number; offset?: number }): Decision[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM decisions WHERE status = 'pending' ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .all(opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  listByStatus(status: string, opts?: { limit?: number; offset?: number }): Decision[] {
    const rows = this.db
      .prepare('SELECT * FROM decisions WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(status, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  listByLevel(level: string, opts?: { limit?: number; offset?: number }): Decision[] {
    const rows = this.db
      .prepare('SELECT * FROM decisions WHERE level = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(level, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  update(
    id: string,
    changes: Partial<Pick<Decision, 'status' | 'chosenOptionId' | 'resolvedAt'>>,
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (changes.status !== undefined) {
      sets.push('status = ?');
      values.push(changes.status);
    }
    if (changes.chosenOptionId !== undefined) {
      sets.push('chosen_option_id = ?');
      values.push(changes.chosenOptionId);
    }
    if (changes.resolvedAt !== undefined) {
      sets.push('resolved_at = ?');
      values.push(changes.resolvedAt.toISOString());
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE decisions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  expireOlderThan(hours: number): void {
    this.db
      .prepare(
        `UPDATE decisions SET status = 'expired' WHERE status = 'pending' AND created_at < datetime('now', ?)`,
      )
      .run(`-${hours} hours`);
  }

  archiveExpired(): void {
    this.db.prepare("UPDATE decisions SET status = 'archived' WHERE status = 'expired'").run();
  }

  deleteByProject(projectId: string): void {
    this.db.prepare('DELETE FROM decisions WHERE project_id = ?').run(projectId);
  }

  countByStatus(status: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM decisions WHERE status = ?')
      .get(status) as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
