import type Database from 'better-sqlite3';

export interface EvaluationResultRow {
  id: number;
  project_id: string | null;
  session_id: string | null;
  source_type: string | null;
  source_id: string | null;
  overall_score: number | null;
  dimensions: string;
  feedback: string | null;
  evaluator_model: string | null;
  created_at: string;
}

export class EvaluationResultRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(opts?: { limit?: number; offset?: number }): EvaluationResultRow[] {
    const rows = this.db
      .prepare('SELECT * FROM evaluation_results ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToResult(r));
  }

  findByProject(projectId: string): EvaluationResultRow[] {
    const rows = this.db
      .prepare('SELECT * FROM evaluation_results WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToResult(r));
  }

  findBySource(sourceType: string, sourceId: string): EvaluationResultRow[] {
    const rows = this.db
      .prepare('SELECT * FROM evaluation_results WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC')
      .all(sourceType, sourceId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToResult(r));
  }

  insert(result: Omit<EvaluationResultRow, 'id' | 'created_at'>): void {
    this.db
      .prepare(
        `INSERT INTO evaluation_results (project_id, session_id, source_type, source_id, overall_score, dimensions, feedback, evaluator_model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(result.project_id, result.session_id, result.source_type, result.source_id, result.overall_score, result.dimensions, result.feedback, result.evaluator_model);
  }

  private rowToResult(row: Record<string, unknown>): EvaluationResultRow {
    return {
      id: row.id as number,
      project_id: row.project_id as string | null,
      session_id: row.session_id as string | null,
      source_type: row.source_type as string | null,
      source_id: row.source_id as string | null,
      overall_score: row.overall_score as number | null,
      dimensions: row.dimensions as string,
      feedback: row.feedback as string | null,
      evaluator_model: row.evaluator_model as string | null,
      created_at: row.created_at as string,
    };
  }
}
