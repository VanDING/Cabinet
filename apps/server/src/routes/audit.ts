import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const auditRouter = new Hono();

auditRouter.get('/', (c) => {
  const { auditLogRepo } = getServerContext();
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const entityType = c.req.query('entityType');
  const entityId = c.req.query('entityId');

  let rows;
  if (entityType && entityId) {
    rows = auditLogRepo.findByEntity(entityType, entityId, { limit });
  } else if (entityType) {
    rows = auditLogRepo.findByType(entityType, { limit });
  } else {
    rows = auditLogRepo.findAll({ limit });
  }

  const entries = rows.map((r) => ({
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
