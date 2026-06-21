//
// DecisionCommentRepository — CRUD for decision discussion threads (M4).
//

import type Database from 'better-sqlite3';

// ── Row type ──────────────────────────────────────────────────────

export interface DecisionCommentRow {
  id: string;
  decision_id: string;
  author_id: string;
  author_name: string;
  content: string;
  parent_comment_id: string | null;
  created_at: string;
}

// ── Repository ────────────────────────────────────────────────────

export class DecisionCommentRepository {
  constructor(private readonly db: Database.Database) {}

  /** Add a comment to a decision. Returns the new comment ID. */
  addComment(params: {
    decisionId: string;
    authorId?: string;
    authorName?: string;
    content: string;
    parentCommentId?: string;
  }): string {
    const id = `dcc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .prepare(
        `INSERT INTO decision_comments (id, decision_id, author_id, author_name, content, parent_comment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        id,
        params.decisionId,
        params.authorId ?? 'captain',
        params.authorName ?? 'Captain',
        params.content,
        params.parentCommentId ?? null,
      );
    return id;
  }

  /** Get all comments for a decision, ordered by creation time. */
  getComments(decisionId: string): DecisionCommentRow[] {
    return this.db
      .prepare('SELECT * FROM decision_comments WHERE decision_id = ? ORDER BY created_at ASC')
      .all(decisionId) as DecisionCommentRow[];
  }

  /** Get a single comment by ID. */
  getComment(id: string): DecisionCommentRow | null {
    const row = this.db.prepare('SELECT * FROM decision_comments WHERE id = ?').get(id) as
      | DecisionCommentRow
      | undefined;
    return row ?? null;
  }

  /** Get threaded comments: top-level first, then replies nested. */
  getThreadedComments(
    decisionId: string,
  ): Array<DecisionCommentRow & { replies: DecisionCommentRow[] }> {
    const all = this.getComments(decisionId);
    const topLevel = all.filter((c) => !c.parent_comment_id);
    return topLevel.map((comment) => ({
      ...comment,
      replies: all.filter((c) => c.parent_comment_id === comment.id),
    }));
  }

  /** Update a comment's content. */
  updateComment(id: string, content: string): boolean {
    const result = this.db
      .prepare('UPDATE decision_comments SET content = ? WHERE id = ?')
      .run(content, id);
    return result.changes > 0;
  }

  /** Delete a comment. */
  deleteComment(id: string): boolean {
    // Nullify parent references in replies before deleting
    this.db
      .prepare('UPDATE decision_comments SET parent_comment_id = NULL WHERE parent_comment_id = ?')
      .run(id);
    const result = this.db.prepare('DELETE FROM decision_comments WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Get the comment count for a decision. */
  countComments(decisionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM decision_comments WHERE decision_id = ?')
      .get(decisionId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Delete all comments for a decision. */
  deleteByDecision(decisionId: string): void {
    this.db.prepare('DELETE FROM decision_comments WHERE decision_id = ?').run(decisionId);
  }
}
