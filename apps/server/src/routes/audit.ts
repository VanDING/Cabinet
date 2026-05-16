import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const auditRouter = new Hono();

auditRouter.get('/', (c) => {
  const { db } = getServerContext();
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const entityType = c.req.query('entityType');
  const entityId = c.req.query('entityId');

  let query = 'SELECT * FROM audit_log';
  const conditions: string[] = [];
  const params: any[] = [];

  if (entityType) { conditions.push('entity_type = ?'); params.push(entityType); }
  if (entityId) { conditions.push('entity_id = ?'); params.push(entityId); }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];
  const entries = rows.map((r: any) => ({
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    actor: r.actor,
    changes: JSON.parse(r.changes ?? '{}'),
    timestamp: r.timestamp,
  }));

  return c.json({ entries, total: entries.length });
});
