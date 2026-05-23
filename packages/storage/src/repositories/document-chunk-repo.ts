import type Database from 'better-sqlite3';

export interface DocumentChunkRow {
  id: number;
  project_id: string;
  source_path: string;
  file_path?: string;
  chunk_index: number;
  content: string;
  embedding: string | null;
  metadata: string;
  created_at: string;
}

export class DocumentChunkRepository {
  constructor(private readonly db: Database.Database) {}

  findByProject(projectId: string): DocumentChunkRow[] {
    const rows = this.db
      .prepare('SELECT * FROM document_chunks WHERE project_id = ? ORDER BY source_path, chunk_index')
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToChunk(r));
  }

  findDistinctPaths(projectId: string): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT file_path FROM document_chunks WHERE project_id = ?')
      .all(projectId) as Array<{ file_path: string }>;
    return rows.map((r) => r.file_path);
  }

  insert(chunk: Omit<DocumentChunkRow, 'id' | 'created_at'>): void {
    this.db
      .prepare(
        'INSERT INTO document_chunks (project_id, source_path, file_path, chunk_index, content, embedding, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(chunk.project_id, chunk.source_path, chunk.file_path ?? chunk.source_path, chunk.chunk_index, chunk.content, chunk.embedding, chunk.metadata);
  }

  deleteByPath(projectId: string, sourcePath: string): void {
    this.db
      .prepare('DELETE FROM document_chunks WHERE project_id = ? AND source_path = ?')
      .run(projectId, sourcePath);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare('DELETE FROM document_chunks WHERE project_id = ?').run(projectId);
  }

  private rowToChunk(row: Record<string, unknown>): DocumentChunkRow {
    return {
      id: row.id as number,
      project_id: row.project_id as string,
      source_path: row.source_path as string,
      file_path: row.file_path as string | undefined,
      chunk_index: row.chunk_index as number,
      content: row.content as string,
      embedding: row.embedding as string | null,
      metadata: row.metadata as string,
      created_at: row.created_at as string,
    };
  }
}
