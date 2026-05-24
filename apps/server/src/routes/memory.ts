import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const memoryRouter = new Hono();

// GET /api/memory — query across all memory layers
// Query params: layer (short_term|long_term|entity|project|all), query (search text), limit (default 20)
memoryRouter.get('/', async (c) => {
  const { shortTerm, longTerm, entity, project, logger } = getServerContext();
  const layer = c.req.query('layer') ?? 'all';
  const query = c.req.query('query') ?? '';
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  const entries: {
    id: string;
    layer: string;
    content: string;
    metadata: any;
    timestamp: string;
  }[] = [];

  if (layer === 'all' || layer === 'short_term') {
    for (const sessionId of getAllSessionIds(shortTerm)) {
      const data = shortTerm.getAll(sessionId);
      for (const [key, value] of Object.entries(data)) {
        const content = typeof value === 'string' ? value : JSON.stringify(value);
        if (!query || content.toLowerCase().includes(query.toLowerCase())) {
          entries.push({
            id: `st_${sessionId}_${key}`,
            layer: 'short_term',
            content,
            metadata: { sessionId, key },
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  if (layer === 'all' || layer === 'long_term') {
    try {
      const results = await longTerm.search(query || '*', limit);
      for (const r of results) {
        const meta = r.metadata ?? {};
        entries.push({
          id: r.id ?? `lt_${Date.now()}`,
          layer: 'long_term',
          content: r.content,
          metadata: meta,
          timestamp: r.timestamp?.toISOString?.() ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.warn('Long-term memory unavailable', { error: (err as Error).message });
    }
  }

  if (layer === 'all' || layer === 'entity') {
    const allPrefs = entity.getAllPreferences?.() ?? {};
    for (const [captainId, prefs] of Object.entries(allPrefs)) {
      const content = JSON.stringify(prefs);
      if (!query || content.toLowerCase().includes(query.toLowerCase())) {
        entries.push({
          id: `ent_${captainId}`,
          layer: 'entity',
          content,
          metadata: { captainId },
          timestamp: new Date().toISOString(),
        });
      }
    }
    const allEmployees = entity.getAllEmployees?.() ?? {};
    for (const [empId, emp] of Object.entries(allEmployees)) {
      const content = JSON.stringify(emp);
      if (!query || content.toLowerCase().includes(query.toLowerCase())) {
        entries.push({
          id: `emp_${empId}`,
          layer: 'entity',
          content,
          metadata: { employeeId: empId },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  if (layer === 'all' || layer === 'project') {
    const allProjects = project.getAll?.() ?? {};
    for (const [projId, ctx] of Object.entries(allProjects)) {
      const content = JSON.stringify(ctx);
      if (!query || content.toLowerCase().includes(query.toLowerCase())) {
        entries.push({
          id: `proj_${projId}`,
          layer: 'project',
          content,
          metadata: { projectId: projId },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Sort by timestamp desc, cap at limit
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const sliced = entries.slice(0, limit);

  return c.json({
    entries: sliced,
    total: entries.length,
    layers: {
      short_term: entries.filter((e) => e.layer === 'short_term').length,
      long_term: entries.filter((e) => e.layer === 'long_term').length,
      entity: entries.filter((e) => e.layer === 'entity').length,
      project: entries.filter((e) => e.layer === 'project').length,
    },
  });
});

// DELETE /api/memory/:id — delete entry
memoryRouter.delete('/:id', async (c) => {
  const { longTerm, logger } = getServerContext();
  const id = c.req.param('id');
  try {
    await longTerm.delete(id);
    return c.json({ status: 'deleted' });
  } catch (err) {
    logger.warn('Failed to delete memory entry', { error: (err as Error).message, id });
    return c.json({ error: 'Delete failed' }, 500);
  }
});

// POST /api/memory/consolidate — manually trigger basic consolidation
memoryRouter.post('/consolidate', async (c) => {
  const { shortTerm, longTerm, logger } = getServerContext();
  let migrated = 0;
  try {
    for (const sessionId of getAllSessionIds(shortTerm)) {
      const data = shortTerm.getAll(sessionId);
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 50) {
          await longTerm.store({
            content: value,
            metadata: { key, sessionId, source: 'manual_consolidation' },
            timestamp: new Date(),
          });
          migrated++;
        }
      }
      shortTerm.clear(sessionId);
    }
    logger.info('Manual consolidation completed', { migrated });
    return c.json({ migrated, status: 'completed' });
  } catch (e: any) {
    return c.json({ error: e.message, migrated }, 500);
  }
});

// GET /api/memory/graph — return knowledge graph entities and relations
memoryRouter.get('/graph', (c) => {
  const { knowledgeGraph, logger } = getServerContext();
  try {
    const db = (knowledgeGraph as any).db;
    const entities = db.prepare('SELECT * FROM memory_entities ORDER BY frequency DESC LIMIT 200').all() as any[];
    const relations = db.prepare('SELECT * FROM memory_relations LIMIT 500').all() as any[];
    return c.json({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        frequency: e.frequency,
      })),
      relations: relations.map((r) => ({
        id: r.id,
        from: r.from_entity_id,
        to: r.to_entity_id,
        relation: r.relation,
        strength: r.strength,
      })),
    });
  } catch (err) {
    logger.warn('Knowledge graph query failed', { error: (err as Error).message });
    return c.json({ entities: [], relations: [] });
  }
});

// Helper: get tracked session IDs from ShortTermMemory
function getAllSessionIds(shortTerm: any): string[] {
  try {
    if (typeof shortTerm.getSessionIds === 'function') return shortTerm.getSessionIds();
    if (shortTerm._store instanceof Map) return [...shortTerm._store.keys()];
  } catch {
    /* session IDs not available */
  }
  return ['default'];
}
