import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const documentsRouter = new Hono();

// GET /api/projects/:id/documents — list indexed documents
documentsRouter.get('/:id/documents', (c) => {
  const projectId = c.req.param('id');
  const ctx = getServerContext();

  try {
    const rows = ctx.db
      .prepare(
        `SELECT source_path, COUNT(*) as chunk_count, MAX(created_at) as indexed_at
         FROM document_chunks WHERE project_id = ?
         GROUP BY source_path ORDER BY indexed_at DESC LIMIT 100`,
      )
      .all(projectId) as any[];

    return c.json({
      documents: rows.map((r: any) => ({
        path: r.source_path,
        chunks: r.chunk_count,
        indexedAt: r.indexed_at,
      })),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/projects/:id/documents/:path — get chunks for a specific document
// Note: path is URL-encoded, e.g. /api/projects/default/documents/src%2Ffile.ts
documentsRouter.get('/:id/documents/*', (c) => {
  const projectId = c.req.param('id');
  const filePath = c.req.param('*') ?? '';
  const ctx = getServerContext();
  if (!filePath) return c.json({ error: 'path required' }, 400);

  try {
    const rows = ctx.db
      .prepare(
        `SELECT id, chunk_index, content, metadata, created_at
         FROM document_chunks WHERE project_id = ? AND source_path = ?
         ORDER BY chunk_index`,
      )
      .all(projectId, decodeURIComponent(filePath)) as any[];

    return c.json({
      path: filePath,
      chunks: rows.map((r: any) => ({
        id: r.id,
        index: r.chunk_index,
        content: r.content.slice(0, 2000),
        metadata: JSON.parse(r.metadata ?? '{}'),
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// DELETE /api/projects/:id/documents — clear all for project
// DELETE /api/projects/:id/documents/:path — clear for a specific file
documentsRouter.delete('/:id/documents', (c) => {
  const projectId = c.req.param('id');
  const filePath = c.req.query('path');
  const ctx = getServerContext();

  try {
    let result;
    if (filePath) {
      result = ctx.db
        .prepare('DELETE FROM document_chunks WHERE project_id = ? AND source_path = ?')
        .run(projectId, filePath);
    } else {
      result = ctx.db.prepare('DELETE FROM document_chunks WHERE project_id = ?').run(projectId);
    }
    return c.json({ cleared: true, removed: result.changes });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
